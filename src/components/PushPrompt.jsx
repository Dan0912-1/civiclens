import { useState, useEffect } from 'react'
import { canRequestPush } from '../lib/pushNotifications'
import styles from './PushPrompt.module.css'

export default function PushPrompt({ onAccept }) {
  const [show, setShow] = useState(false)

  useEffect(() => {
    // Only show if user hasn't dismissed before and we're on native
    const dismissed = sessionStorage.getItem('pushPromptDismissed')
    if (dismissed) return

    canRequestPush().then(canRequest => {
      if (canRequest) setShow(true)
    })
  }, [])

  function handleAccept() {
    setShow(false)
    sessionStorage.setItem('pushPromptDismissed', '1')
    onAccept()
  }

  function handleDismiss() {
    setShow(false)
    sessionStorage.setItem('pushPromptDismissed', '1')
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
