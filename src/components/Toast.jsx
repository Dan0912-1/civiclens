import styles from './Toast.module.css'

// The toast body is a real <button> so keyboard users can dismiss it (it was
// a click-only div). The wrapping div carries the live-region semantics so
// screen readers announce the message on appearance.
export default function Toast({ message, type = 'success', onDismiss }) {
  return (
    <div role="status" aria-live="polite">
      <button
        type="button"
        className={`${styles.toast} ${styles[type]}`}
        onClick={onDismiss}
        aria-label={`Dismiss notification: ${message}`}
      >
        {message}
      </button>
    </div>
  )
}
