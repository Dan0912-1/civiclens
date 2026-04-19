import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getSessionSafe } from '../lib/supabase'
import { joinClassroom, peekClassroom, addJoinedClassroom, joinClassroomAnon } from '../lib/classroom'
import styles from './JoinClassroom.module.css'

export default function JoinClassroom() {
  const navigate = useNavigate()
  const { code: codeParam } = useParams()
  const { user } = useAuth()
  const [code, setCode] = useState(() => {
    const c = (codeParam || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
    return c
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Name prompt step
  const [nameStep, setNameStep] = useState(false)
  const [pendingData, setPendingData] = useState(null)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    const trimmed = code.trim().toUpperCase()
    if (trimmed.length !== 6) { setError('Code must be 6 characters'); return }

    setLoading(true)
    setError('')
    try {
      if (user) {
        const session = await getSessionSafe()
        const token = session?.access_token
        if (!token) { setError('Please sign in first'); setLoading(false); return }
        await joinClassroom(token, trimmed)
        navigate('/classroom')
      } else {
        const data = await peekClassroom(trimmed)
        // Clear any prior error from a previous failed submission so the
        // name-step form doesn't render a stale message above it.
        setError('')
        if (data.classroom.requireName) {
          // Show name prompt before proceeding
          setPendingData(data)
          setNameStep(true)
        } else {
          // Server-side join creates a classroom_members row keyed on the
          // student's anonymous_id so the teacher's analytics count this
          // join. Network failure here shouldn't block the student from
          // viewing the class, so log and continue to the local join.
          try { await joinClassroomAnon(trimmed) } catch (e) { console.warn('[classroom] anon join failed:', e.message) }
          addJoinedClassroom(trimmed, data.classroom.name, data.classroom.id)
          navigate(`/classroom/view/${trimmed}`)
        }
      }
    } catch (err) {
      setError(err.message || 'Failed to join classroom')
    }
    setLoading(false)
  }

  async function handleNameSubmit(e) {
    e.preventDefault()
    if (!firstName.trim()) { setError('First name is required'); return }
    const studentName = `${firstName.trim()} ${lastName.trim()}`.trim()
    const trimmed = code.trim().toUpperCase()
    try { await joinClassroomAnon(trimmed, studentName) } catch (err) { console.warn('[classroom] anon join failed:', err.message) }
    addJoinedClassroom(trimmed, pendingData.classroom.name, pendingData.classroom.id, studentName)
    navigate(`/classroom/view/${trimmed}`)
  }

  if (nameStep && pendingData) {
    return (
      <main className={styles.page}>
        <div className={styles.container}>
          <h1>{pendingData.classroom.name}</h1>
          <p>Your teacher asks that you enter your name.</p>

          <form className={styles.nameForm} onSubmit={handleNameSubmit}>
            <input
              type="text"
              value={firstName}
              onChange={e => setFirstName(e.target.value)}
              placeholder="First name"
              aria-label="First name"
              className={styles.nameInput}
              autoFocus
              autoComplete="given-name"
            />
            <input
              type="text"
              value={lastName}
              onChange={e => setLastName(e.target.value)}
              placeholder="Last name (optional)"
              aria-label="Last name"
              className={styles.nameInput}
              autoComplete="family-name"
            />
            <button
              type="submit"
              className={styles.btn}
              disabled={!firstName.trim()}
            >
              Join Class
            </button>
          </form>

          {error && <p className={styles.error}>{error}</p>}

          <button className={styles.back} onClick={() => { setNameStep(false); setPendingData(null) }}>
            Back
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <h1>Join a Classroom</h1>
        <p>Enter the 6-character code your teacher gave you.</p>

        <form className={styles.form} onSubmit={handleSubmit}>
          <label htmlFor="classroom-join-code" className={styles.visuallyHidden}>
            Classroom join code
          </label>
          <input
            id="classroom-join-code"
            type="text"
            value={code}
            onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
            placeholder="ABC123"
            className={styles.codeInput}
            maxLength={6}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            inputMode="text"
            aria-describedby={error ? 'classroom-join-error' : undefined}
            aria-invalid={error ? 'true' : undefined}
          />
          <button
            type="submit"
            className={styles.btn}
            disabled={loading || code.trim().length !== 6}
            aria-busy={loading || undefined}
          >
            {loading ? 'Joining…' : 'Join'}
          </button>
        </form>

        {error && <p id="classroom-join-error" role="alert" className={styles.error}>{error}</p>}

        <button className={styles.back} onClick={() => navigate('/classroom')}>
          Back to Classrooms
        </button>
      </div>
    </main>
  )
}
