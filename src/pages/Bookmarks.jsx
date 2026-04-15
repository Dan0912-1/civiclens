import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getBookmarks, removeBookmark, getNotificationPrefs, setNotificationPrefs } from '../lib/userProfile'
import { useToast } from '../context/ToastContext'
import { supabase } from '../lib/supabase'
import usePullToRefresh from '../hooks/usePullToRefresh'
import BillCard from '../components/BillCard.jsx'
import AuthModal from '../components/AuthModal.jsx'
import styles from './Bookmarks.module.css'

function isNativePlatform() {
  try {
    // Dynamic import would be async; check the global instead
    return window.Capacitor?.isNativePlatform?.() ?? false
  } catch {
    return false
  }
}

// Turn status_stage enum values into human-readable labels for the staleness
// banner. Matches the 5-bucket scheme in api/server.js billStatusBucket.
function prettyStage(stage) {
  const map = {
    introduced: 'Introduced',
    in_committee: 'In Committee',
    passed_one: 'Passed one chamber',
    passed_both: 'Passed both chambers',
    enacted: 'Enacted',
    vetoed: 'Vetoed',
    failed: 'Failed',
  }
  return map[stage] || stage || 'Unknown'
}

export default function Bookmarks() {
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()
  const { showToast } = useToast()
  const [bookmarks, setBookmarks] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAuth, setShowAuth] = useState(false)
  const [emailNotif, setEmailNotif] = useState(false)
  const [pushNotif, setPushNotif] = useState(true)
  const [isNative] = useState(isNativePlatform)

  const refreshBookmarks = useCallback(async () => {
    if (!user) return
    const bm = await getBookmarks(user.id)
    setBookmarks(bm)
  }, [user])

  const { refreshing, pullProgress } = usePullToRefresh(refreshBookmarks)

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      setLoading(false)
      return
    }
    getBookmarks(user.id).then(bm => {
      setBookmarks(bm)
      setLoading(false)
    }).catch(() => setLoading(false))
    // Load notification preferences
    if (supabase) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.access_token) {
          getNotificationPrefs(session.access_token).then(prefs => {
            setEmailNotif(prefs.email_notifications ?? false)
            setPushNotif(prefs.push_notifications ?? true)
          })
        }
      })
    }
  }, [user, authLoading])

  async function toggleEmailNotif() {
    const next = !emailNotif
    setEmailNotif(next)
    if (supabase) {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.access_token) {
        await setNotificationPrefs(session.access_token, { email_notifications: next })
      }
    }
  }

  async function togglePushNotif() {
    const next = !pushNotif
    setPushNotif(next)
    if (supabase) {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.access_token) {
        await setNotificationPrefs(session.access_token, { push_notifications: next })
      }
    }
  }

  async function handleRemove(billId) {
    if (!user) return
    const prev = bookmarks
    setBookmarks(b => b.filter(bm => bm.bill_id !== billId))
    const ok = await removeBookmark(user.id, billId)
    if (ok) {
      showToast('Bookmark removed')
    } else {
      setBookmarks(prev) // rollback on failure
      showToast('Could not remove bookmark', 'error')
    }
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
      {(pullProgress > 0 || refreshing) && (
        <div className={styles.pullIndicator} style={{ opacity: refreshing ? 1 : pullProgress }}>
          <div className={refreshing ? styles.pullSpinnerActive : styles.pullSpinner}
               style={refreshing ? {} : { transform: `rotate(${pullProgress * 360}deg)` }} />
        </div>
      )}
      <div className={styles.container}>
        <div className={styles.header}>
          <h1 className={styles.heading}>Saved Bills</h1>
          <p className={styles.subhead}>
            {bookmarks.length} bookmarked bill{bookmarks.length !== 1 ? 's' : ''}
          </p>
        </div>

        {/* Notification preferences */}
        {isNative && (
          <div className={styles.notifBar}>
            <div>
              <div className={styles.notifLabel}>Push notifications</div>
              <div className={styles.notifDesc}>Get push alerts on your phone when a saved bill changes status</div>
            </div>
            <button
              className={styles.toggle}
              data-on={pushNotif}
              onClick={togglePushNotif}
              aria-label={pushNotif ? 'Disable push notifications' : 'Enable push notifications'}
            >
              <div className={styles.toggleKnob} />
            </button>
          </div>
        )}
        <div className={styles.notifBar}>
          <div>
            <div className={styles.notifLabel}>Email notifications</div>
            <div className={styles.notifDesc}>Get emailed when a saved bill changes status on Congress.gov</div>
          </div>
          <button
            className={styles.toggle}
            data-on={emailNotif}
            onClick={toggleEmailNotif}
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
              <div key={bm.bill_id} style={{ animationDelay: `${i * 0.08}s` }}>
                {bm.is_stale && (
                  <div
                    role="status"
                    style={{
                      background: '#fff5e6',
                      border: '1px solid #e8a020',
                      borderRadius: '8px 8px 0 0',
                      padding: '10px 14px',
                      marginBottom: '-1px',
                      fontSize: '0.92rem',
                      color: '#0d1b2a',
                    }}
                  >
                    ⚠️ Status changed from <strong>{prettyStage(bm.saved_status_stage)}</strong> to{' '}
                    <strong>{prettyStage(bm.current_status_stage)}</strong> since you saved this. The
                    analysis below reflects the earlier status. Open the bill for the latest take.
                  </div>
                )}
                <BillCard
                  bill={bm.bill_data.bill}
                  analysis={bm.bill_data.analysis}
                  isBookmarked={true}
                  onToggleBookmark={() => handleRemove(bm.bill_id)}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
