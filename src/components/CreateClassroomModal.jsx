import { useState } from 'react'
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
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
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
