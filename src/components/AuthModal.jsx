import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import styles from './AuthModal.module.css'

export default function AuthModal({ isOpen, onClose }) {
  const { signInWithGoogle, signInWithApple, signInWithEmail, signUpWithEmail } = useAuth()
  const [mode, setMode] = useState('signin') // 'signin' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [signupSuccess, setSignupSuccess] = useState(false)

  if (!isOpen) return null

  function reset() {
    setEmail('')
    setPassword('')
    setError('')
    setLoading(false)
    setSignupSuccess(false)
    setMode('signin')
  }

  function handleClose() {
    reset()
    onClose()
  }

  async function handleGoogle() {
    setError('')
    setLoading(true)
    const { error } = await signInWithGoogle()
    setLoading(false)
    if (error) setError(error.message)
  }

  async function handleApple() {
    setError('')
    setLoading(true)
    const { error } = await signInWithApple()
    setLoading(false)
    if (error) setError(error.message)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    if (mode === 'signin') {
      const { error } = await signInWithEmail(email, password)
      if (error) {
        setError(error.message)
        setLoading(false)
      } else {
        handleClose()
      }
    } else {
      const { error } = await signUpWithEmail(email, password)
      if (error) {
        setError(error.message)
        setLoading(false)
      } else {
        setSignupSuccess(true)
        setLoading(false)
      }
    }
  }

  return (
    <div className={styles.overlay} onClick={handleClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={handleClose} aria-label="Close">
          &times;
        </button>

        <h2 className={styles.heading}>
          {mode === 'signin' ? 'Sign in' : 'Create account'}
        </h2>
        <p className={styles.sub}>
          Save your profile and bookmark bills between sessions.
        </p>

        {signupSuccess ? (
          <div className={styles.success}>
            Check your email to confirm your account, then sign in.
          </div>
        ) : (
          <>
            <button className={styles.appleBtn} onClick={handleApple}>
              <svg width="17" height="20" viewBox="0 0 17 20" fill="none" aria-hidden="true">
                <path d="M13.508 10.6c-.02-2.17 1.773-3.22 1.854-3.272-1.01-1.477-2.583-1.68-3.143-1.703-1.337-.135-2.61.787-3.285.787-.675 0-1.714-.77-2.824-.748-1.449.02-2.785.843-3.532 2.137C.758 10.35 1.844 15.04 3.66 17.196c.898 1.05 1.967 2.224 3.372 2.176 1.356-.047 1.868-.873 3.507-.873 1.638 0 2.103.873 3.527.844 1.458-.023 2.384-1.063 3.272-2.12.994-1.195 1.41-2.364 1.432-2.424-.03-.013-2.75-1.053-2.773-4.199H13.508zm-2.6-7.7c.748-.9 1.25-2.146 1.113-3.4-1.074.044-2.38.715-3.15 1.614-.693.8-1.3 2.078-1.135 3.303 1.198.092 2.424-.607 3.172-1.517z" fill="white"/>
              </svg>
              Continue with Apple
            </button>

            <button className={styles.googleBtn} onClick={handleGoogle}>
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
                required
              />
              <input
                type="password"
                placeholder="Password"
                className={styles.input}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={6}
              />
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
