import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { joinClassroom } from '../lib/classroom'
import styles from './JoinClassroom.module.css'

export default function JoinClassroom() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!user) { setError('Please sign in first'); return }
    const trimmed = code.trim().toUpperCase()
    if (trimmed.length !== 6) { setError('Code must be 6 characters'); return }

    setLoading(true)
    setError('')
    try {
      const session = await supabase?.auth.getSession()
      const token = session?.data?.session?.access_token
      if (!token) { setError('Please sign in first'); setLoading(false); return }
      await joinClassroom(token, trimmed)
      navigate('/classroom')
    } catch (err) {
      setError(err.message || 'Failed to join classroom')
    }
    setLoading(false)
  }

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <h1>Join a Classroom</h1>
        <p>Enter the 6-character code your teacher gave you.</p>

        <form className={styles.form} onSubmit={handleSubmit}>
          <input
            type="text"
            value={code}
            onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
            placeholder="ABC123"
            className={styles.codeInput}
            maxLength={6}
            autoFocus
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="submit"
            className={styles.btn}
            disabled={loading || code.trim().length !== 6}
          >
            {loading ? 'Joining...' : 'Join'}
          </button>
        </form>

        {error && <p className={styles.error}>{error}</p>}

        <button className={styles.back} onClick={() => navigate('/classroom')}>
          Back to Classrooms
        </button>
      </div>
    </main>
  )
}
