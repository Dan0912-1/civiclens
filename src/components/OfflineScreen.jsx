import { useState, useEffect } from 'react'
import { flush } from '../lib/offlineQueue'
import { getApiBase } from '../lib/api'
import styles from './OfflineScreen.module.css'

// navigator.onLine lies on captive portals, corp Wi-Fi that strips your
// traffic, and some mobile networks — it returns true whenever the link
// layer is up even if nothing can reach the backend. The browser event
// listeners inherit the same lie. An active fetch against /api/health is
// the only way to know whether the server is actually reachable.
const HEALTH_URL = `${getApiBase()}/api/health`
const PROBE_TIMEOUT_MS = 4000
const PROBE_INTERVAL_MS = 30_000 // poll when online (cheap HEAD)
const FAST_RETRY_MS = 5_000 // poll faster once we've seen offline

async function probeBackend() {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
    const res = await fetch(HEALTH_URL, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    })
    clearTimeout(timer)
    return res.ok
  } catch {
    return false
  }
}

export default function OfflineScreen() {
  const [offline, setOffline] = useState(!navigator.onLine)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let cancelled = false
    let timer = null

    async function check() {
      if (cancelled) return
      // Short-circuit: if the browser says definitely offline, skip the probe
      // and mark offline immediately. We only do active healthchecks to catch
      // the false-positive-online case.
      if (!navigator.onLine) {
        setOffline(true)
        setDismissed(false)
        timer = setTimeout(check, FAST_RETRY_MS)
        return
      }
      const reachable = await probeBackend()
      if (cancelled) return
      setOffline(prev => {
        if (!reachable) {
          if (!prev) setDismissed(false)
          return true
        }
        if (prev) flush()
        return false
      })
      timer = setTimeout(check, reachable ? PROBE_INTERVAL_MS : FAST_RETRY_MS)
    }

    const onBrowserOffline = () => {
      setOffline(true)
      setDismissed(false)
    }
    const onBrowserOnline = () => {
      // Re-probe immediately on link-layer recovery — don't trust it alone
      clearTimeout(timer)
      check()
    }

    window.addEventListener('offline', onBrowserOffline)
    window.addEventListener('online', onBrowserOnline)
    check()

    return () => {
      cancelled = true
      clearTimeout(timer)
      window.removeEventListener('offline', onBrowserOffline)
      window.removeEventListener('online', onBrowserOnline)
    }
  }, [])

  if (!offline || dismissed) return null

  return (
    <div className={styles.banner}>
      <span className={styles.text}>
        &#9888; You're offline. Showing cached content.
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
