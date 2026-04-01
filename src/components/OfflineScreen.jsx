import { useState, useEffect } from 'react'
import styles from './OfflineScreen.module.css'

export default function OfflineScreen() {
  const [offline, setOffline] = useState(!navigator.onLine)

  useEffect(() => {
    const goOffline = () => setOffline(true)
    const goOnline = () => setOffline(false)
    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
    }
  }, [])

  if (!offline) return null

  return (
    <div className={styles.overlay}>
      <div className={styles.card}>
        <div className={styles.icon}>&#9888;</div>
        <h2>No connection</h2>
        <p>
          CapitolKey needs an internet connection to load legislation data.
          Check your Wi-Fi or cellular connection and try again.
        </p>
        <button
          className={styles.retry}
          onClick={() => {
            if (navigator.onLine) setOffline(false)
          }}
        >
          Try again
        </button>
      </div>
    </div>
  )
}
