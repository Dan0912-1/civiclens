import { createContext, useContext, useState, useEffect, useRef } from 'react'
import { supabase, getSessionSafe, withAuthTimeout, broadcastAuthChange, onAuthBroadcast } from '../lib/supabase'
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
  // Tracks whether onAuthStateChange has already delivered a session so the
  // mount-time getSession race doesn't clobber a valid user with null when
  // its 3s timeout arm fires.
  const authResolvedRef = useRef(false)

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }

    // Let Supabase process OAuth params FIRST (code= for PKCE, access_token for implicit)
    // Do NOT strip URL params before getSession — Supabase needs them to exchange the code.
    //
    // If OAuth params are present, we *must* let supabase.auth.getSession() run so it can
    // exchange the code. Otherwise, use getSessionSafe which bypasses the lock on timeout —
    // this stops Tab B from hanging forever in loading=true when Tab A holds the lock.
    const hasOAuthParams = window.location.hash.includes('access_token')
      || window.location.search.includes('code=')
    const sessionLoader = hasOAuthParams
      ? supabase.auth.getSession().then(({ data }) => data?.session ?? null).catch(() => null)
      : getSessionSafe()
    Promise.race([
      sessionLoader,
      new Promise((r) => setTimeout(() => r(null), 3000)),
    ]).then((session) => {
      // If onAuthStateChange already resolved the session, don't overwrite it.
      // Otherwise the 3s-timeout arm can null a valid user mid-hydration.
      if (!authResolvedRef.current) {
        setUser(session?.user ?? null)
      }
      setLoading(false)
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
      authResolvedRef.current = true
      setUser(session?.user ?? null)
      // Once supabase has fired any event we trust its view — flip loading off
      // even if the mount-time race is still in flight.
      setLoading(false)
      cleanOAuthParams()

      // Tell other tabs so they reload and pick up the new session (or the
      // absence of one). SIGNED_IN and SIGNED_OUT are the auth changes other
      // tabs care about; TOKEN_REFRESHED happens on every tick and shouldn't
      // reload peer tabs.
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
        broadcastAuthChange(event)
      }

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

        // Migrate any classrooms the student joined anonymously so signing up
        // doesn't silently drop their class membership. Each peek-joined room
        // is re-joined via the authenticated endpoint; already-member responses
        // (409) are harmless.
        try {
          const joinedRaw = sessionStorage.getItem('ck_joined_classrooms')
          if (joinedRaw && session.access_token) {
            const joined = JSON.parse(joinedRaw)
            if (Array.isArray(joined) && joined.length) {
              const { joinClassroom } = await import('../lib/classroom')
              for (const entry of joined) {
                if (!entry?.code) continue
                try { await joinClassroom(session.access_token, entry.code) } catch {}
              }
              sessionStorage.removeItem('ck_joined_classrooms')
            }
          }
        } catch {}
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  // Cross-tab auth coordination. If another tab signs in or out, re-read
  // the session in-place so we pick up the fresh one (or clear a stale one)
  // without a full page reload — reloads interrupted navigation and caused
  // protected pages like /settings to briefly render their signed-out
  // fallback while the AuthProvider rehydrated.
  useEffect(() => {
    return onAuthBroadcast(async (msg) => {
      if (!msg?.event) return
      if (msg.event === 'SIGNED_OUT') {
        setUser(null)
        sessionStorage.removeItem('civicProfile')
        sessionStorage.removeItem('civicInteractions')
        sessionStorage.removeItem('ck_joined_classrooms')
        localStorage.removeItem('ck_offline_queue')
        resetPushState()
        return
      }
      if (msg.event === 'SIGNED_IN') {
        // Small delay so the tab that fired the broadcast can finish
        // writing localStorage before we read it.
        await new Promise((r) => setTimeout(r, 150))
        const session = await getSessionSafe()
        setUser(session?.user ?? null)
      }
    })
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
        await withAuthTimeout(
          supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }),
          { label: 'setSession' },
        )
      }
    }).then(h => { handle = h })
    return () => { handle?.remove() }
  }, [])

  async function signInWithGoogle() {
    if (!supabase) return { error: { message: 'Auth not configured' } }

    try {
      if (isNative) {
        const { data, error } = await withAuthTimeout(
          supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
              redirectTo: 'com.danieljacius.capitolkey://auth-callback',
              skipBrowserRedirect: true,
            },
          }),
          { label: 'Google sign-in' },
        )
        if (error) return { error }
        if (data?.url) await Browser.open({ url: data.url })
        return { error: null }
      }

      return await withAuthTimeout(
        supabase.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: window.location.origin },
        }),
        { label: 'Google sign-in' },
      )
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

        const { data, error } = await withAuthTimeout(
          supabase.auth.signInWithIdToken({
            provider: 'apple',
            token: idToken,
            nonce: nonce,
          }),
          { label: 'Apple sign-in' },
        )
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
      const { data, error } = await withAuthTimeout(
        supabase.auth.signInWithOAuth({
          provider: 'apple',
          options: {
            redirectTo: 'com.danieljacius.capitolkey://auth-callback',
            skipBrowserRedirect: true,
          },
        }),
        { label: 'Apple sign-in' },
      )
      if (error) return { error }
      if (data?.url) await Browser.open({ url: data.url })
      return { error: null }
    }

    // Web
    return withAuthTimeout(
      supabase.auth.signInWithOAuth({
        provider: 'apple',
        options: { redirectTo: window.location.origin },
      }),
      { label: 'Apple sign-in' },
    )
  }

  async function signInWithEmail(email, password) {
    if (!supabase) return { error: { message: 'Auth not configured' } }
    const result = await withAuthTimeout(
      supabase.auth.signInWithPassword({ email, password }),
      { label: 'Sign in' },
    )
    if (result.error?.message === 'Email not confirmed') {
      // Resend confirmation and give user a better message
      await withAuthTimeout(
        supabase.auth.resend({ type: 'signup', email }),
        { label: 'Resend confirmation' },
      )
      return { error: { message: 'Please check your email for a confirmation link. We just resent it.' } }
    }
    return result
  }

  async function signUpWithEmail(email, password) {
    if (!supabase) return { error: { message: 'Auth not configured' } }
    const redirectTo = isNative
      ? 'com.danieljacius.capitolkey://auth-callback'
      : window.location.origin
    const result = await withAuthTimeout(
      supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: redirectTo },
      }),
      { label: 'Sign up' },
    )
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
    return withAuthTimeout(
      supabase.auth.resetPasswordForEmail(email, { redirectTo }),
      { label: 'Password reset' },
    )
  }

  async function handleSignOut() {
    if (!supabase) return

    // Update the UI FIRST so sign-out feels instant. Everything below — push
    // teardown, supabase signOut, storage wipe — runs in the background with
    // its own timeouts. Previously we awaited all of that before flipping
    // setUser(null), which left the UI in a signed-in state for up to 4s
    // while the Supabase auth lock drained.
    setUser(null)
    sessionStorage.removeItem('civicProfile')
    sessionStorage.removeItem('civicInteractions')
    sessionStorage.removeItem('ck_joined_classrooms')
    localStorage.removeItem('ck_offline_queue')
    resetPushState()
    // Tell peer tabs immediately so they also drop state without waiting on
    // the local teardown to finish.
    broadcastAuthChange('SIGNED_OUT')

    // Revoke the FCM/APNs subscription on the backend BEFORE the JWT is
    // invalidated. The in-memory reset above is not enough — the server row
    // survives and the old device keeps receiving pushes for the logged-out
    // user.
    //
    // Both getSession() and signOut() can hang on an orphaned Supabase
    // LocalLock (see getSessionSafe in src/lib/supabase.js). Every await is
    // bounded by a timeout, and we fall through to manually purging
    // sb-*-auth-token storage so persisted state matches the in-memory
    // setUser(null) above even if supabase-js never resolves.
    ;(async () => {
      try {
        const session = await getSessionSafe()
        const accessToken = session?.access_token
        if (accessToken) {
          await Promise.race([
            teardownPushNotifications(accessToken),
            new Promise((r) => setTimeout(r, 2000)),
          ])
        }
      } catch {
        // non-fatal
      }

      try {
        await Promise.race([
          supabase.auth.signOut({ scope: 'local' }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('signOut timeout')), 2000)),
        ])
      } catch {
        try {
          const keys = Object.keys(localStorage).filter((k) => k.startsWith('sb-'))
          keys.forEach((k) => localStorage.removeItem(k))
        } catch {}
      }
    })()
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
