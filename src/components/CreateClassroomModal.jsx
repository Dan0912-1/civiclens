import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { createClassroom } from '../lib/classroom'
import styles from './CreateClassroomModal.module.css'

export default function CreateClassroomModal({ onClose, onCreated }) {
  const { user } = useAuth()
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    setError('')
    try {
      const session = await supabase?.auth.getSession()
      const token = session?.data?.session?.access_token
      if (!token) { setError('Please sign in'); setLoading(false); return }
      await createClassroom(token, name.trim())
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
        <p>Give your class a name. Students will join using a code.</p>

        <form onSubmit={handleSubmit}>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. AP Government — Period 3"
            className={styles.input}
            maxLength={100}
            autoFocus
          />
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
