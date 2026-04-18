import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = url && anonKey ? createClient(url, anonKey, {
  auth: {
    detectSessionInUrl: true,
    flowType: 'pkce',
    autoRefreshToken: true,
    persistSession: true,
  },
}) : null

// Force-wipe all Supabase auth storage. Used as a fallback when the
// navigator.locks-based cross-tab serialization wedges (orphaned lock from
// a hot-reload, Safari bug, or a concurrent tab holding the lock).
export function wipeAuthStorage() {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('sb-'))
      .forEach((k) => localStorage.removeItem(k))
  } catch {}
}

// Race a supabase.auth.* call against a timeout. On timeout, wipe any
// stored session so the next attempt starts clean, and return a normalized
// { data, error } shape that mirrors supabase-js.
//
// Use for write-path auth ops (signIn*, signUp, setSession, resend,
// resetPasswordForEmail). For reads, use getSessionSafe().
export async function withAuthTimeout(op, { timeoutMs = 8000, label = 'auth' } = {}) {
  let timeoutId
  const timeoutPromise = new Promise((resolve) => {
    timeoutId = setTimeout(() => {
      wipeAuthStorage()
      resolve({
        data: null,
        error: {
          message: `${label} timed out. Close other CapitolKey tabs and try again.`,
          __timeout: true,
        },
      })
    }, timeoutMs)
  })
  try {
    return await Promise.race([op, timeoutPromise])
  } finally {
    clearTimeout(timeoutId)
  }
}

// getSession() can hang for 5+ seconds due to orphaned Supabase auth locks.
// This helper tries getSession() with a 2s timeout, then falls back to reading
// the token directly from localStorage (bypassing the lock entirely).
export async function getSessionSafe() {
  if (!supabase) return null
  try {
    const result = await Promise.race([
      supabase.auth.getSession(),
      new Promise(r => setTimeout(() => r(null), 2000)),
    ])
    const session = result?.data?.session
    if (session?.access_token) {
      if (!session.expires_at || session.expires_at > Math.floor(Date.now() / 1000)) {
        return session
      }
      // fall through to refresh path below with the refresh_token we have
    }
  } catch {}

  // Fallback: read token directly from localStorage (bypass lock)
  let stored = null
  try {
    const key = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'))
    if (key) {
      const parsed = JSON.parse(localStorage.getItem(key))
      stored = parsed?.access_token ? parsed : parsed?.currentSession
    }
  } catch {}

  if (!stored?.access_token) return null

  // Token still valid: return it
  if (!stored.expires_at || stored.expires_at > Math.floor(Date.now() / 1000)) {
    return stored
  }

  // Token expired but we have a refresh_token: try to refresh. This is the
  // common path when a tab sits idle past the 1hr access-token lifetime —
  // without this, createClassroom / assign / etc. would bounce to "Please
  // sign in" even though the user has a live refresh_token.
  if (stored.refresh_token) {
    try {
      const result = await Promise.race([
        supabase.auth.refreshSession({ refresh_token: stored.refresh_token }),
        new Promise(r => setTimeout(() => r(null), 5000)),
      ])
      if (result?.data?.session?.access_token) return result.data.session
    } catch {}

    // If supabase-js's refreshSession hung or failed (typically because the
    // LocalLock is wedged — the same cause that timed out getSession above),
    // hit the token endpoint directly. Bypasses supabase-js entirely so a
    // stuck lock can't block account deletion / any other auth-gated write.
    try {
      const resp = await Promise.race([
        fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: anonKey,
            Authorization: `Bearer ${anonKey}`,
          },
          body: JSON.stringify({ refresh_token: stored.refresh_token }),
        }),
        new Promise((r) => setTimeout(() => r(null), 5000)),
      ])
      if (resp?.ok) {
        const data = await resp.json().catch(() => null)
        if (data?.access_token) {
          return {
            access_token: data.access_token,
            refresh_token: data.refresh_token || stored.refresh_token,
            expires_at:
              data.expires_at ||
              Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
            token_type: data.token_type || 'bearer',
            user: data.user || stored.user,
          }
        }
      }
    } catch {}
  }

  return null
}

// Cross-tab auth coordination. Supabase-js v2 broadcasts auth changes via
// its own BroadcastChannel, but that can miss when a sign-in on one tab
// races with a live session on another. We add a belt-and-suspenders
// channel so any tab that signs in/out triggers a reload of its peers.
const AUTH_CHANNEL_NAME = 'capitolkey-auth'
let authChannel = null
try {
  if (typeof BroadcastChannel !== 'undefined') {
    authChannel = new BroadcastChannel(AUTH_CHANNEL_NAME)
  }
} catch {}

export function broadcastAuthChange(event) {
  try {
    authChannel?.postMessage({ event, at: Date.now() })
  } catch {}
}

export function onAuthBroadcast(handler) {
  if (!authChannel) return () => {}
  const listener = (e) => handler(e.data)
  authChannel.addEventListener('message', listener)
  return () => authChannel.removeEventListener('message', listener)
}
