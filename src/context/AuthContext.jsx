import { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Capacitor } from '@capacitor/core'
import { Browser } from '@capacitor/browser'
import { App } from '@capacitor/app'
import { SignInWithApple } from '@capacitor-community/apple-sign-in'

const isNative = Capacitor.getPlatform() !== 'web'
const isIOS = Capacitor.getPlatform() === 'ios'

function generateNonce(length = 32) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const values = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(values, (v) => chars[v % chars.length]).join('')
}

async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message)
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

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

  // On native: listen for deep-link callback after Google OAuth
  useEffect(() => {
    if (!isNative || !supabase) return
    let handle
    App.addListener('appUrlOpen', async (event) => {
      const url = event?.url || ''
      if (!url.includes('auth-callback')) return
      try { await Browser.close() } catch (_) {}
      const fragment = url.split('#')[1] || url.split('?')[1] || ''
      const params = new URLSearchParams(fragment)
      const accessToken = params.get('access_token')
      const refreshToken = params.get('refresh_token')
      if (accessToken && refreshToken) {
        await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
      }
    }).then(h => { handle = h })
    return () => { handle?.remove() }
  }, [])

  async function signInWithGoogle() {
    if (!supabase) return { error: { message: 'Auth not configured' } }

    if (isNative) {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: 'com.danieljacius.capitolkey://auth-callback',
          skipBrowserRedirect: true,
        },
      })
      if (error) return { error }
      if (data?.url) await Browser.open({ url: data.url })
      return { error: null }
    }

    return supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
  }

  async function signInWithApple() {
    if (!supabase) return { error: { message: 'Auth not configured' } }

    // On iOS, use native Sign in with Apple
    if (isIOS) {
      try {
        // Generate a nonce — Supabase requires it to verify Apple's identity token
        const nonce = generateNonce()
        const hashedNonce = await sha256(nonce)

        const result = await SignInWithApple.authorize({
          clientId: 'com.danieljacius.capitolkey',
          redirectURI: 'https://drljemedyhpyvrzumusd.supabase.co/auth/v1/callback',
          scopes: 'email name',
          nonce: hashedNonce,
        })
        const idToken = result?.response?.identityToken
        if (!idToken) {
          console.error('[Apple Sign In] No identity token in response:', JSON.stringify(result))
          return { error: { message: 'No identity token from Apple. Please try again.' } }
        }

        const { data, error } = await supabase.auth.signInWithIdToken({
          provider: 'apple',
          token: idToken,
          nonce: nonce,
        })
        if (error) {
          console.error('[Apple Sign In] Supabase token exchange failed:', error.message, error)
        }
        return { error: error || null }
      } catch (err) {
        if (err?.message?.includes('1001') || err?.code === '1001') {
          return { error: null } // User cancelled
        }
        console.error('[Apple Sign In] Plugin error:', err?.message, err)
        return { error: { message: err?.message || 'Apple sign-in failed. Please try again.' } }
      }
    }

    // On Android native, use OAuth browser flow
    if (isNative) {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'apple',
        options: {
          redirectTo: 'com.danieljacius.capitolkey://auth-callback',
          skipBrowserRedirect: true,
        },
      })
      if (error) return { error }
      if (data?.url) await Browser.open({ url: data.url })
      return { error: null }
    }

    // Web
    return supabase.auth.signInWithOAuth({
      provider: 'apple',
      options: { redirectTo: window.location.origin },
    })
  }

  async function signInWithEmail(email, password) {
    if (!supabase) return { error: { message: 'Auth not configured' } }
    const result = await supabase.auth.signInWithPassword({ email, password })
    if (result.error?.message === 'Email not confirmed') {
      // Resend confirmation and give user a better message
      await supabase.auth.resend({ type: 'signup', email })
      return { error: { message: 'Please check your email for a confirmation link. We just resent it.' } }
    }
    return result
  }

  async function signUpWithEmail(email, password) {
    if (!supabase) return { error: { message: 'Auth not configured' } }
    const redirectTo = isNative
      ? 'com.danieljacius.capitolkey://auth-callback'
      : window.location.origin
    const result = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: redirectTo },
    })
    // If identities array is empty, email is already registered
    if (result.data?.user?.identities?.length === 0) {
      return { error: { message: 'An account with this email already exists. Try signing in instead.' } }
    }
    return result
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
