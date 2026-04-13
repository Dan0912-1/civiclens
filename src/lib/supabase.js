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
