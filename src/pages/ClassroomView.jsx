import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { peekClassroom, removeJoinedClassroom } from '../lib/classroom'
import styles from './ClassroomDetail.module.css'

export default function ClassroomView() {
  const { code } = useParams()
  const navigate = useNavigate()
  const [classroom, setClassroom] = useState(null)
  const [assignments, setAssignments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    async function load() {
      setLoading(true)
      setError('')
      try {
        const data = await peekClassroom(code, controller.signal)
        if (cancelled) return
        setClassroom(data.classroom)
        setAssignments(data.assignments || [])
      } catch (err) {
        if (cancelled || err?.name === 'AbortError') return
        setError(err?.message || 'Failed to load classroom')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [code])

  function handleLeave() {
    removeJoinedClassroom(code)
    navigate('/classroom')
  }

  if (loading) {
    return (
      <main className={styles.page}>
        <div className={styles.loading} role="status" aria-live="polite">
          <div className={styles.spinner} />
          <span>Loading…</span>
        </div>
      </main>
    )
  }

  if (error || !classroom) {
    return (
      <main className={styles.page}>
        <div className={styles.container}>
          <p className={styles.error}>{error || 'Classroom not found'}</p>
          <button className={styles.back} onClick={() => navigate('/classroom')}>Back to Classrooms</button>
        </div>
      </main>
    )
  }

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <button className={styles.back} onClick={() => navigate('/classroom')}>Back</button>

        <div className={styles.header}>
          <div>
            <h1>{classroom.name}</h1>
          </div>
        </div>

        <div className={styles.tabContent}>
          {assignments.length === 0 ? (
            <p className={styles.emptyState}>
              Your teacher hasn&rsquo;t posted any assignments yet. Check back soon.
            </p>
          ) : (
            <div className={styles.assignmentList}>
              {assignments.map(a => {
                const bd = a.bill_data || {}
                const congress = bd.congress
                const billType = (bd.type || bd.bill_type || '').toLowerCase()
                const billNum = bd.number || bd.bill_number
                return (
                  <div key={a.id} className={styles.assignmentCard}>
                    <div className={styles.assignmentTop}>
                      <button
                        className={styles.assignmentTitle}
                        onClick={() => {
                          if (congress && billType && billNum) {
                            const legiscanParam = bd.legiscan_bill_id ? `?legiscan_id=${bd.legiscan_bill_id}` : ''
                            const { analysis: _tAnalysis, ...billOnly } = bd
                            navigate(`/bill/${congress}/${billType}/${billNum}${legiscanParam}`, {
                              state: {
                                bill: billOnly,
                                assignment: a.id,
                                classroom: classroom?.id,
                                assignmentInstructions: a.instructions || '',
                              },
                            })
                          }
                        }}
                      >
                        <span className={styles.billNum}>
                          {bd.type || bd.bill_type} {bd.number || bd.bill_number}
                        </span>
                        {(bd.title || a.bill_id).slice(0, 100)}
                      </button>
                    </div>

                    {a.instructions && (
                      <p className={styles.assignmentInstructions}>{a.instructions}</p>
                    )}

                    <div className={styles.assignmentMeta}>
                      {a.due_date && (
                        <span className={styles.dueDate}>
                          Due {new Date(a.due_date + 'T00:00').toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div style={{ marginTop: '2rem', textAlign: 'center' }}>
          <button className={styles.linkBtn} onClick={handleLeave} style={{ color: 'var(--status-failed)' }}>
            Leave this classroom
          </button>
        </div>
      </div>
    </main>
  )
}
