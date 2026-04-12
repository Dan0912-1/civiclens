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

// getSession() can hang for 5+ seconds due to orphaned auth locks.
// This helper races it against a 3-second timeout so callers never block.
export async function getSessionSafe() {
  if (!supabase) return null
  try {
    const result = await Promise.race([
      supabase.auth.getSession(),
      new Promise(r => setTimeout(() => r({ data: { session: null } }), 3000)),
    ])
    return result?.data?.session || null
  } catch {
    return null
  }
}
