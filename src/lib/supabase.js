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
  try {
    const key = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'))
    if (key) {
      const parsed = JSON.parse(localStorage.getItem(key))
      if (parsed?.access_token) return parsed
      if (parsed?.currentSession?.access_token) return parsed.currentSession
    }
  } catch {}

  return null
}
