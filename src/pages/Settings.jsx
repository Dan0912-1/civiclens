import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getSessionSafe } from '../lib/supabase'
import { getApiBase } from '../lib/api'
import styles from './Settings.module.css'

const API_BASE = getApiBase()

export default function Settings() {
  const navigate = useNavigate()
  const { user, loading, signOut } = useAuth()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  if (loading) {
    return (
      <main className={styles.page}>
        <div className={styles.container}>
          <div className={styles.loading}>
            <div className={styles.spinner} />
          </div>
        </div>
      </main>
    )
  }

  if (!user) {
    return (
      <main className={styles.page}>
        <div className={styles.container}>
          <button className={styles.backBtn} onClick={() => navigate(-1)}>
            ← Back
          </button>
          <h1>Settings</h1>
          <p className={styles.muted}>Sign in to manage your account settings.</p>
        </div>
      </main>
    )
  }

  async function handleDeleteAccount() {
    setDeleting(true)
    setError('')
    try {
      // getSessionSafe bypasses Supabase's orphaned LocalLock (see
      // src/lib/supabase.js) so the button can't silently hang.
      const session = await getSessionSafe()
      if (!session?.access_token) {
        setError('Please sign in again to delete your account.')
        setDeleting(false)
        return
      }

      // Bound the request so a stalled backend can't leave the button on
      // "Deleting..." forever. 15s covers the worst realistic cascade-
      // delete path (Supabase admin API + related-table cleanup) with
      // margin.
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 15000)
      let resp
      try {
        resp = await fetch(`${API_BASE}/api/account`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${session.access_token}` },
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timeoutId)
      }

      if (resp.ok) {
        // signOut() now clears user state synchronously before its async
        // teardown — no need to fire-and-forget or await completion.
        signOut()
        navigate('/')
      } else {
        const data = await resp.json().catch(() => ({}))
        console.error('[delete-account] server error:', resp.status, data)
        setError(data.error || `Failed to delete account (${resp.status}). Please try again.`)
        setDeleting(false)
      }
    } catch (err) {
      console.error('[delete-account] error:', err)
      if (err?.name === 'AbortError') {
        setError('The request timed out. Please try again.')
      } else {
        setError('Network error. Please check your connection and try again.')
      }
      setDeleting(false)
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <button className={styles.backBtn} onClick={() => navigate(-1)}>
          ← Back
        </button>

        <h1>Settings</h1>

        <div className={styles.section}>
          <h2>Account</h2>
          <div className={styles.infoRow}>
            <span className={styles.label}>Email</span>
            <span className={styles.value}>{user.email}</span>
          </div>
        </div>

        <div className={styles.section}>
          <h2>Your profile</h2>
          <p className={styles.muted}>
            Update your state, age, interests, and situation — the answers behind your personalized bills.
          </p>
          <button className={styles.linkBtn} onClick={() => navigate('/profile')}>
            Edit my profile →
          </button>
          <button className={styles.linkBtn} onClick={() => navigate('/bookmarks')}>
            Saved bills →
          </button>
        </div>

        <div className={styles.section}>
          <h2>Legal</h2>
          <button className={styles.linkBtn} onClick={() => navigate('/privacy')}>
            Privacy Policy
          </button>
        </div>

        <div className={styles.dangerZone}>
          <h2>Delete Account</h2>
          <p>
            This permanently deletes your profile, bookmarks, interaction
            history, and notification settings. This action cannot be undone.
          </p>

          {!confirmDelete ? (
            <button
              className={styles.deleteBtn}
              onClick={() => setConfirmDelete(true)}
            >
              Delete my account
            </button>
          ) : (
            <div className={styles.confirmBox}>
              <p className={styles.confirmText}>
                Are you sure? All your data will be permanently removed.
              </p>
              {error && <p className={styles.error}>{error}</p>}
              <div className={styles.confirmActions}>
                <button
                  className={styles.confirmDeleteBtn}
                  onClick={handleDeleteAccount}
                  disabled={deleting}
                >
                  {deleting ? 'Deleting...' : 'Yes, delete everything'}
                </button>
                <button
                  className={styles.cancelBtn}
                  onClick={() => { setConfirmDelete(false); setError('') }}
                  disabled={deleting}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
