import { useState, useRef, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { getSessionSafe } from '../lib/supabase'
import { createClassroom } from '../lib/classroom'
import styles from './CreateClassroomModal.module.css'

export default function CreateClassroomModal({ onClose, onCreated }) {
  const { user } = useAuth()
  const [name, setName] = useState('')
  const [requireName, setRequireName] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const modalRef = useRef(null)

  useEffect(() => {
    const previouslyFocused = document.activeElement
    const modal = modalRef.current
    if (!modal) return

    const focusableSelector = 'a[href], button:not([disabled]), textarea, input:not([disabled]), select, [tabindex]:not([tabindex="-1"])'
    const getFocusable = () => Array.from(modal.querySelectorAll(focusableSelector))

    const focusable = getFocusable()
    if (focusable.length) focusable[0].focus()

    function handleKeyDown(e) {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key !== 'Tab') return
      const els = getFocusable()
      if (!els.length) return
      const first = els[0]
      const last = els[els.length - 1]
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus() }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }

    modal.addEventListener('keydown', handleKeyDown)
    return () => {
      modal.removeEventListener('keydown', handleKeyDown)
      if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus()
    }
  }, [onClose])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    setError('')
    try {
      const session = await getSessionSafe()
      const token = session?.access_token
      if (!token) { setError('Please sign in'); setLoading(false); return }
      await createClassroom(token, name.trim(), requireName)
      onCreated()
    } catch (err) {
      setError(err.message || 'Failed to create classroom')
    }
    setLoading(false)
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div ref={modalRef} className={styles.modal} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <h2>Create a Classroom</h2>
        <p>Give your class a name. Students will join using a code — no account needed.</p>

        <form onSubmit={handleSubmit}>
          <label htmlFor="classroom-name" className={styles.label || undefined} style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Classroom name</label>
          <input
            id="classroom-name"
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. AP Government — Period 3"
            className={styles.input}
            maxLength={100}
            autoFocus
          />
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={requireName}
              onChange={e => setRequireName(e.target.checked)}
            />
            <span>Ask students for their name when joining</span>
          </label>
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.actions}>
            <button type="button" className={styles.btnCancel} onClick={onClose}>Cancel</button>
            <button
              type="submit"
              className={styles.btnCreate}
              disabled={loading || !name.trim()}
            >
              {loading ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
