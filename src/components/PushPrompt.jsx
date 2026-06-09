import { useState, useEffect } from 'react'
import { canRequestPush } from '../lib/pushNotifications'
import styles from './PushPrompt.module.css'

// localStorage, not sessionStorage: sessionStorage dies with the app process
// on iOS, so a dismissed prompt would re-nag on every cold launch. "Not now"
// re-asks after 14 days; an accept never re-shows because the OS permission
// leaves the 'prompt' state and canRequestPush() returns false from then on.
const DISMISS_KEY = 'ck_push_prompt_dismissed_at'
const REASK_AFTER_MS = 14 * 24 * 60 * 60 * 1000

export default function PushPrompt({ onAccept }) {
  const [show, setShow] = useState(false)

  useEffect(() => {
    try {
      const dismissedAt = parseInt(localStorage.getItem(DISMISS_KEY) || '0', 10)
      if (dismissedAt && Date.now() - dismissedAt < REASK_AFTER_MS) return
    } catch {}

    // canRequestPush is true only on native when permission is undecided
    canRequestPush().then(canRequest => {
      if (canRequest) setShow(true)
    })
  }, [])

  function rememberDismissal() {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())) } catch {}
  }

  function handleAccept() {
    setShow(false)
    rememberDismissal()
    onAccept()
  }

  function handleDismiss() {
    setShow(false)
    rememberDismissal()
  }

  if (!show) return null

  return (
    <div className={styles.banner}>
      <div className={styles.inner}>
        <div className={styles.text}>
          <strong>Stay updated on your saved bills</strong>
          <p>Get notified when bills you bookmark have status changes in Congress.</p>
        </div>
        <div className={styles.actions}>
          <button className={styles.acceptBtn} onClick={handleAccept}>
            Enable notifications
          </button>
          <button className={styles.dismissBtn} onClick={handleDismiss}>
            Not now
          </button>
        </div>
      </div>
    </div>
  )
}
