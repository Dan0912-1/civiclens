import { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { saveProfile, loadProfile } from '../lib/userProfile'
import { resetPushState, teardownPushNotifications } from '../lib/pushNotifications'
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
  resetPassword: () => {},
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

    // Let Supabase process OAuth params FIRST (code= for PKCE, access_token for implicit)
    // Do NOT strip URL params before getSession — Supabase needs them to exchange the code
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setLoading(false)
      // Clean up OAuth params from URL AFTER session is established
      cleanOAuthParams()
    })

    function cleanOAuthParams() {
      const hasParams = window.location.hash.includes('access_token')
        || window.location.search.includes('access_token')
        || window.location.search.includes('code=')
      if (hasParams) {
        window.history.replaceState(null, '', window.location.pathname)
      }
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      setUser(session?.user ?? null)
      cleanOAuthParams()

      // Auto-create profile row for new OAuth sign-ups so they don't appear "profileless"
      if (event === 'SIGNED_IN' && session?.user) {
        const existing = await loadProfile(session.user.id)
        // Merge local sessionStorage profile into cloud on first sign-in
        // so students who filled out their profile before creating an
        // account don't lose their work.
        const localRaw = sessionStorage.getItem('civicProfile')
        let localProfile = null
        if (localRaw) {
          try { localProfile = JSON.parse(localRaw) } catch {}
        }
        if (!existing && localProfile && localProfile.interests?.length) {
          // Local profile is richer than a bare seed — upload it
          const meta = session.user.user_metadata || {}
          await saveProfile(session.user.id, {
            ...localProfile,
            name: meta.full_name || meta.name || localProfile.name || '',
            email: meta.email || session.user.email || localProfile.email || '',
          })
        } else if (!existing) {
          // No local profile — seed an empty one so they don't appear "profileless"
          const meta = session.user.user_metadata || {}
          await saveProfile(session.user.id, {
            name: meta.full_name || meta.name || '',
            email: meta.email || session.user.email || '',
          })
        } else if (existing && localProfile && localProfile.interests?.length && !existing.interests?.length) {
          // Cloud profile exists but is bare; local is richer — merge up
          const meta = session.user.user_metadata || {}
          await saveProfile(session.user.id, {
            ...localProfile,
            name: existing.name || meta.full_name || localProfile.name || '',
            email: existing.email || meta.email || localProfile.email || '',
          })
        }
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

    try {
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

      return await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      })
    } catch (err) {
      console.error('[Google OAuth] Failed:', err)
      return { error: { message: err?.message || 'Google sign-in failed. Please try again.' } }
    }
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
          redirectURI: 'https://auth.capitolkey.org/auth/v1/callback',
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

  async function resetPassword(email) {
    if (!supabase) return { error: { message: 'Auth not configured' } }
    const redirectTo = isNative
      ? 'com.danieljacius.capitolkey://auth-callback'
      : window.location.origin
    return supabase.auth.resetPasswordForEmail(email, { redirectTo })
  }

  async function handleSignOut() {
    if (!supabase) return
    // Revoke the FCM/APNs subscription on the backend BEFORE the JWT is
    // invalidated. resetPushState alone just clears the in-memory flag; the
    // server row survives and the old device keeps receiving pushes for the
    // logged-out user. Pull the access token from the current session so
    // the DELETE /api/push/register call passes auth.
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const accessToken = session?.access_token
      if (accessToken) {
        await teardownPushNotifications(accessToken)
      }
    } catch {
      // non-fatal — sign-out should still proceed
    }
    await supabase.auth.signOut()
    // Clear all app-specific storage to prevent data leakage between users
    sessionStorage.removeItem('civicProfile')
    sessionStorage.removeItem('civicInteractions')
    sessionStorage.removeItem('ck_joined_classrooms')
    localStorage.removeItem('ck_offline_queue')
    resetPushState()
  }

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      signInWithGoogle,
      signInWithApple,
      signInWithEmail,
      signUpWithEmail,
      resetPassword,
      signOut: handleSignOut,
    }}>
      {children}
    </AuthContext.Provider>
  )
}
