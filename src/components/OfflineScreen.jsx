import { useState, useEffect } from 'react'
import { flush } from '../lib/offlineQueue'
import styles from './OfflineScreen.module.css'

export default function OfflineScreen() {
  const [offline, setOffline] = useState(!navigator.onLine)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const goOffline = () => { setOffline(true); setDismissed(false) }
    const goOnline = () => { setOffline(false); flush() }
    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
    }
  }, [])

  if (!offline || dismissed) return null

  return (
    <div className={styles.banner}>
      <span className={styles.text}>
        &#9888; You're offline — showing cached content
      </span>
      <button
        className={styles.dismiss}
        onClick={() => setDismissed(true)}
        aria-label="Dismiss offline notice"
      >
        &#10005;
      </button>
    </div>
  )
}
