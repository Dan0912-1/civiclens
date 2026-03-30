import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getBookmarks, removeBookmark, getNotificationPrefs, setNotificationPrefs } from '../lib/userProfile'
import { supabase } from '../lib/supabase'
import BillCard from '../components/BillCard.jsx'
import AuthModal from '../components/AuthModal.jsx'
import styles from './Bookmarks.module.css'

export default function Bookmarks() {
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()
  const [bookmarks, setBookmarks] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAuth, setShowAuth] = useState(false)
  const [emailNotif, setEmailNotif] = useState(true)

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      setLoading(false)
      return
    }
    getBookmarks(user.id).then(bm => {
      setBookmarks(bm)
      setLoading(false)
    })
    // Load notification preference
    if (supabase) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.access_token) {
          getNotificationPrefs(session.access_token).then(prefs => {
            setEmailNotif(prefs.email_notifications)
          })
        }
      })
    }
  }, [user, authLoading])

  async function toggleNotifications() {
    const next = !emailNotif
    setEmailNotif(next)
    if (supabase) {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.access_token) {
        await setNotificationPrefs(session.access_token, next)
      }
    }
  }

  async function handleRemove(billId) {
    if (!user) return
    setBookmarks(prev => prev.filter(b => b.bill_id !== billId))
    await removeBookmark(user.id, billId)
  }

  if (authLoading || loading) {
    return (
      <main className={styles.page}>
        <div className={styles.container}>
          <div className={styles.loadingGrid}>
            {[...Array(3)].map((_, i) => (
              <div key={i} className={styles.skeleton} style={{ animationDelay: `${i * 0.1}s` }} />
            ))}
          </div>
        </div>
      </main>
    )
  }

  if (!user) {
    return (
      <main className={styles.page}>
        <div className={styles.container}>
          <div className={styles.empty}>
            <h2>Saved Bills</h2>
            <p>Sign in to save and view your bookmarked bills.</p>
            <button className={styles.ctaBtn} onClick={() => setShowAuth(true)}>
              Sign in
            </button>
          </div>
          <AuthModal isOpen={showAuth} onClose={() => setShowAuth(false)} />
        </div>
      </main>
    )
  }

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1 className={styles.heading}>Saved Bills</h1>
          <p className={styles.subhead}>
            {bookmarks.length} bookmarked bill{bookmarks.length !== 1 ? 's' : ''}
          </p>
        </div>

        {/* Notification preferences */}
        <div className={styles.notifBar}>
          <div>
            <div className={styles.notifLabel}>Email notifications</div>
            <div className={styles.notifDesc}>Get emailed when a saved bill changes status on Congress.gov</div>
          </div>
          <button
            className={styles.toggle}
            data-on={emailNotif}
            onClick={toggleNotifications}
            aria-label={emailNotif ? 'Disable email notifications' : 'Enable email notifications'}
          >
            <div className={styles.toggleKnob} />
          </button>
        </div>

        {bookmarks.length === 0 ? (
          <div className={styles.empty}>
            <p>No bookmarked bills yet. Browse your legislation and bookmark bills you want to track.</p>
            <button className={styles.ctaBtn} onClick={() => navigate('/results')}>
              View my legislation
            </button>
          </div>
        ) : (
          <div className={styles.grid}>
            {bookmarks.map((bm, i) => (
              <BillCard
                key={bm.bill_id}
                bill={bm.bill_data.bill}
                analysis={bm.bill_data.analysis}
                isBookmarked={true}
                onToggleBookmark={() => handleRemove(bm.bill_id)}
                style={{ animationDelay: `${i * 0.08}s` }}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
