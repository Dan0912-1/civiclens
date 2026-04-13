import styles from './Toast.module.css'

export default function Toast({ message, type = 'success', onDismiss }) {
  return (
    <div
      className={`${styles.toast} ${styles[type]}`}
      role="status"
      aria-live="polite"
      onClick={onDismiss}
    >
      {message}
    </div>
  )
}
