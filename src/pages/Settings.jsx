import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { getApiBase } from '../lib/api'
import styles from './Settings.module.css'

const API_BASE = getApiBase()

export default function Settings() {
  const navigate = useNavigate()
  const { user, signOut } = useAuth()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

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
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        setError('Please sign in again to delete your account.')
        setDeleting(false)
        return
      }

      const resp = await fetch(`${API_BASE}/api/account`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })

      if (resp.ok) {
        sessionStorage.clear()
        await signOut()
        navigate('/')
      } else {
        const data = await resp.json().catch(() => ({}))
        setError(data.error || 'Failed to delete account. Please try again.')
        setDeleting(false)
      }
    } catch {
      setError('Network error. Please check your connection and try again.')
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
