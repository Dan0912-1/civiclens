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
    if (result?.data?.session) return result.data.session
  } catch {}

  // Fallback: read token directly from localStorage (bypass lock)
  // Check expires_at to avoid returning stale/expired tokens
  try {
    const key = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'))
    if (key) {
      const parsed = JSON.parse(localStorage.getItem(key))
      const session = parsed?.access_token ? parsed : parsed?.currentSession
      if (session?.access_token) {
        // Reject expired tokens (expires_at is Unix seconds)
        if (session.expires_at && session.expires_at < Math.floor(Date.now() / 1000)) {
          return null // token expired — force re-auth
        }
        return session
      }
    }
  } catch {}

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
