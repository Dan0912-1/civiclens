import { useState, useRef, useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import { useAuth } from '../context/AuthContext'
import styles from './AuthModal.module.css'

const isIOS = Capacitor.getPlatform() === 'ios'

export default function AuthModal({ isOpen, onClose }) {
  const { signInWithGoogle, signInWithApple, signInWithEmail, signUpWithEmail, resetPassword } = useAuth()
  const [mode, setMode] = useState('signin') // 'signin' | 'signup' | 'forgot'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [signupSuccess, setSignupSuccess] = useState(false)
  const [resetSent, setResetSent] = useState(false)

  const modalRef = useRef(null)

  useEffect(() => {
    if (!isOpen) return
    const previouslyFocused = document.activeElement
    const modal = modalRef.current
    if (!modal) return

    const focusableSelector = 'a[href], button:not([disabled]), textarea, input:not([disabled]), select, [tabindex]:not([tabindex="-1"])'
    const getFocusable = () => Array.from(modal.querySelectorAll(focusableSelector))

    // Focus first focusable element
    const focusable = getFocusable()
    if (focusable.length) focusable[0].focus()

    function handleKeyDown(e) {
      if (e.key !== 'Tab') return
      const els = getFocusable()
      if (!els.length) return
      const first = els[0]
      const last = els[els.length - 1]
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus() }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }

    modal.addEventListener('keydown', handleKeyDown)
    return () => {
      modal.removeEventListener('keydown', handleKeyDown)
      if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus()
    }
  }, [isOpen])

  if (!isOpen) return null

  function reset() {
    setEmail('')
    setPassword('')
    setError('')
    setLoading(false)
    setSignupSuccess(false)
    setResetSent(false)
    setMode('signin')
  }

  function handleClose() {
    reset()
    onClose()
  }

  function friendlyError(msg) {
    if (!msg) return 'Something went wrong. Please try again.'
    if (msg.includes('Invalid login credentials')) return "That email/password combo didn't work. Double-check and try again."
    if (msg.includes('Email not confirmed')) return 'Check your inbox for a confirmation email, then try again.'
    if (msg.includes('already registered') || msg.includes('already been registered')) return 'An account with this email already exists. Try signing in instead.'
    if (msg.includes('Password should be at least')) return 'Your password needs to be at least 6 characters.'
    if (msg.includes('rate limit') || msg.includes('too many requests')) return 'Too many attempts. Please wait a minute and try again.'
    return msg
  }

  async function handleGoogle() {
    setError('')
    setLoading(true)
    try {
      const result = await signInWithGoogle()
      if (result?.error) setError(friendlyError(result.error.message))
    } catch (err) {
      console.error('[Google Sign In] Error:', err)
      setError(friendlyError(err?.message))
    } finally {
      setLoading(false)
    }
  }

  async function handleApple() {
    setError('')
    setLoading(true)
    try {
      const result = await signInWithApple()
      if (result?.error) {
        const msg = result.error.message
        if (msg?.includes('provider is not enabled') || msg?.includes('Unsupported provider')) {
          setError('Apple sign-in is not configured yet. Please use email or Google to sign in.')
        } else {
          setError(msg)
        }
      }
    } catch (err) {
      console.error('[Apple Sign In] Error:', err)
      setError(friendlyError(err?.message))
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const trimmedEmail = email.trim()
    const trimmedPassword = password

    if (mode === 'signin') {
      const { error } = await signInWithEmail(trimmedEmail, trimmedPassword)
      if (error) {
        setError(friendlyError(error.message))
        setLoading(false)
      } else {
        handleClose()
      }
    } else {
      const { error } = await signUpWithEmail(trimmedEmail, trimmedPassword)
      if (error) {
        setError(friendlyError(error.message))
        setLoading(false)
      } else {
        setSignupSuccess(true)
        setLoading(false)
      }
    }
  }

  return (
    <div className={styles.overlay} onClick={handleClose} onKeyDown={e => { if (e.key === 'Escape') handleClose() }}>
      <div ref={modalRef} className={styles.modal} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <button className={styles.closeBtn} onClick={handleClose} aria-label="Close">
          &times;
        </button>

        <h2 className={styles.heading}>
          {mode === 'forgot' ? 'Reset password' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </h2>
        <p className={styles.sub}>
          {mode === 'forgot'
            ? "Enter your email and we'll send a reset link."
            : 'Save your profile and bookmark bills between sessions.'}
        </p>

        {signupSuccess ? (
          <div className={styles.success}>
            Check your email to confirm your account, then sign in.
          </div>
        ) : resetSent ? (
          <div className={styles.success}>
            Password reset link sent! Check your email.
            <button className={styles.backToSignin} onClick={() => { setResetSent(false); setMode('signin'); setError('') }}>
              Back to sign in
            </button>
          </div>
        ) : mode === 'forgot' ? (
          <>
            <form className={styles.form} onSubmit={async (e) => {
              e.preventDefault()
              setError('')
              setLoading(true)
              const { error } = await resetPassword(email)
              setLoading(false)
              if (error) {
                setError(error.message)
              } else {
                setResetSent(true)
              }
            }}>
              <input
                type="email"
                placeholder="Email"
                className={styles.input}
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
              {error && <p className={styles.error}>{error}</p>}
              <button className={styles.submitBtn} type="submit" disabled={loading}>
                {loading ? '...' : 'Send reset link'}
              </button>
            </form>
            <p className={styles.toggle}>
              <button onClick={() => { setMode('signin'); setError('') }}>Back to sign in</button>
            </p>
          </>
        ) : (
          <>
            {isIOS && (
              <button className={styles.appleBtn} onClick={handleApple} disabled={loading}>
                <svg width="16" height="16" viewBox="0 0 814 1000" fill="none" aria-hidden="true">
                  <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57.8-155.5-127.4c-58.3-81.5-105.9-207.2-105.9-327.6 0-192.8 125.3-294.9 248.7-294.9 65.6 0 120.2 43.1 161.3 43.1 39.2 0 100.2-45.7 174.5-45.7 28.2 0 129.5 2.6 196.9 99.5zm-281.7-92.1c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.2 32.4-55.7 83.6-55.7 135.5 0 7.8.6 15.6 1.3 18.2 2.6.6 6.4 1.3 10.2 1.3 45.4 0 103.4-30.4 140.1-71.4z" fill="white"/>
                </svg>
                Continue with Apple
              </button>
            )}

            <button className={styles.googleBtn} onClick={handleGoogle} disabled={loading}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
                <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
                <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.997 8.997 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
              </svg>
              Continue with Google
            </button>

            <div className={styles.divider}>
              <span>or</span>
            </div>

            <form className={styles.form} onSubmit={handleSubmit}>
              <input
                type="email"
                placeholder="Email"
                className={styles.input}
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
              <input
                type="password"
                placeholder="Password"
                className={styles.input}
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                required
                minLength={6}
              />
              {mode === 'signin' && (
                <button type="button" className={styles.forgotBtn} onClick={() => { setMode('forgot'); setError('') }}>
                  Forgot password?
                </button>
              )}
              {error && <p className={styles.error}>{error}</p>}
              <button className={styles.submitBtn} type="submit" disabled={loading}>
                {loading ? '...' : mode === 'signin' ? 'Sign in' : 'Create account'}
              </button>
            </form>

            <p className={styles.toggle}>
              {mode === 'signin' ? (
                <>No account? <button onClick={() => { setMode('signup'); setError('') }}>Create one</button></>
              ) : (
                <>Already have an account? <button onClick={() => { setMode('signin'); setError('') }}>Sign in</button></>
              )}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
