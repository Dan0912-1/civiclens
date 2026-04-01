import { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext({
  user: null,
  loading: true,
  signInWithGoogle: () => {},
  signInWithApple: () => {},
  signInWithEmail: () => {},
  signUpWithEmail: () => {},
  signOut: () => {},
})

export function useAuth() {
  return useContext(AuthContext)
}

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
      // Clean up OAuth hash fragments from URL
      if (window.location.hash.includes('access_token')) {
        window.history.replaceState(null, '', window.location.pathname)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function signInWithGoogle() {
    if (!supabase) return { error: { message: 'Auth not configured' } }
    return supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
  }

  async function signInWithApple() {
    if (!supabase) return { error: { message: 'Auth not configured' } }
    return supabase.auth.signInWithOAuth({
      provider: 'apple',
      options: { redirectTo: window.location.origin },
    })
  }

  async function signInWithEmail(email, password) {
    if (!supabase) return { error: { message: 'Auth not configured' } }
    return supabase.auth.signInWithPassword({ email, password })
  }

  async function signUpWithEmail(email, password) {
    if (!supabase) return { error: { message: 'Auth not configured' } }
    return supabase.auth.signUp({ email, password })
  }

  async function handleSignOut() {
    if (!supabase) return
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      signInWithGoogle,
      signInWithApple,
      signInWithEmail,
      signUpWithEmail,
      signOut: handleSignOut,
    }}>
      {children}
    </AuthContext.Provider>
  )
}
