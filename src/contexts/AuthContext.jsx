import { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  async function signInWithGoogle() {
    if (!supabase) return
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin }
    })
  }

  async function signOut() {
    if (!supabase) return
    await supabase.auth.signOut()
    setUser(null)
  }

  async function saveProfile(profile) {
    if (!supabase || !user) {
      sessionStorage.setItem('civicProfile', JSON.stringify(profile))
      return
    }
    sessionStorage.setItem('civicProfile', JSON.stringify(profile))
    await supabase.from('user_profiles').upsert({
      id: user.id,
      profile,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' })
  }

  async function loadProfile() {
    const local = sessionStorage.getItem('civicProfile')
    if (local) return JSON.parse(local)

    if (!supabase || !user) return null

    const { data } = await supabase
      .from('user_profiles')
      .select('profile')
      .eq('id', user.id)
      .single()

    if (data?.profile) {
      sessionStorage.setItem('civicProfile', JSON.stringify(data.profile))
      return data.profile
    }
    return null
  }

  return (
    <AuthContext.Provider value={{ user, loading, signInWithGoogle, signOut, saveProfile, loadProfile, supabaseAvailable: !!supabase }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
