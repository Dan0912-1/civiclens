import { useState, useEffect, useRef } from 'react'
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
// Require N consecutive failed probes before showing the banner. A single
// failed probe during a backend redeploy or a transient blip would otherwise
// flash an alarming "you're offline" message at users whose network is fine.
// With FAST_RETRY_MS=5s and PROBE_TIMEOUT_MS=4s, a threshold of 3 means the
// banner only appears after ~10-22s of sustained failures — long enough to
// ride out a Railway restart, short enough that real outages still surface.
const FAIL_THRESHOLD = 3

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
  // Consecutive-failure counter. A ref (not state) because incrementing it
  // doesn't need to re-render — only crossing FAIL_THRESHOLD does.
  const failCountRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    let timer = null

    async function check() {
      if (cancelled) return
      // Short-circuit: if the browser says definitely offline, skip the probe
      // and mark offline immediately. The OS-level offline signal is reliable
      // (unlike the false-positive-online case), so no debounce needed.
      if (!navigator.onLine) {
        failCountRef.current = FAIL_THRESHOLD
        setOffline(true)
        setDismissed(false)
        timer = setTimeout(check, FAST_RETRY_MS)
        return
      }
      const reachable = await probeBackend()
      if (cancelled) return

      if (reachable) {
        // Any successful probe immediately resets — recovery should be fast,
        // queued writes flush, and the banner clears (if shown).
        const wasOffline = failCountRef.current >= FAIL_THRESHOLD
        failCountRef.current = 0
        setOffline(prev => {
          if (prev) flush()
          return false
        })
        timer = setTimeout(check, PROBE_INTERVAL_MS)
        return
      }

      // Failed probe — bump the counter but only show the banner once we've
      // crossed the threshold. Brief blips (Railway redeploy, single dropped
      // packet) don't reach the user.
      failCountRef.current += 1
      if (failCountRef.current >= FAIL_THRESHOLD) {
        setOffline(prev => {
          if (!prev) setDismissed(false)
          return true
        })
      }
      timer = setTimeout(check, FAST_RETRY_MS)
    }

    const onBrowserOffline = () => {
      failCountRef.current = FAIL_THRESHOLD
      setOffline(true)
      setDismissed(false)
    }
    const onBrowserOnline = () => {
      // Re-probe immediately on link-layer recovery — don't trust it alone.
      // Don't reset the counter yet — wait for the probe to confirm.
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
