import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getSessionSafe } from '../lib/supabase'
import { useToast } from '../context/ToastContext'
import {
  getClassroomDetail, getAssignments, removeAssignment,
  getClassroomStats, getCompletions, exportClassroomCsv, regenerateCode,
  updateClassroom, leaveClassroom
} from '../lib/classroom'
import AssignBillModal from '../components/AssignBillModal.jsx'
import styles from './ClassroomDetail.module.css'

export default function ClassroomDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()
  const { showToast } = useToast()
  const [classroom, setClassroom] = useState(null)
  const [assignments, setAssignments] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('assignments')
  const [showAssign, setShowAssign] = useState(false)
  const [codeCopied, setCodeCopied] = useState(false)
  const [token, setToken] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [completionsData, setCompletionsData] = useState(null)
  const [completionsLoading, setCompletionsLoading] = useState(false)
  // Tracks the latest in-flight stats request so that navigating away or
  // reloading the classroom doesn't let an old response stomp the new one
  // (and doesn't trigger a setState-on-unmounted-component warning).
  const statsAbortRef = useRef(null)

  useEffect(() => {
    if (authLoading) return
    if (!user) { navigate('/'); return }
    loadData()
    return () => {
      // Cancel any in-flight stats request when the effect re-runs or the
      // component unmounts.
      statsAbortRef.current?.abort()
    }
  }, [user, authLoading, id])

  async function getToken() {
    try {
      const session = await getSessionSafe()
      const t = session?.access_token || null
      setToken(t)
      return t
    } catch { return null }
  }

  async function loadData() {
    setLoading(true)
    setLoadError(null)
    const t = await getToken()
    if (!t) { setLoading(false); setLoadError('Could not sign in. Please sign in again.'); return }

    try {
      // Settle both so a single failure doesn't drop the other half's data.
      const [crResult, aResult] = await Promise.allSettled([
        getClassroomDetail(t, id),
        getAssignments(t, id),
      ])
      const cr = crResult.status === 'fulfilled' ? crResult.value : null
      if (!cr) {
        if (crResult.status === 'rejected' && crResult.reason?.isAuthError) {
          setLoadError('Your session expired. Please sign in again.')
        } else {
          setLoadError('Classroom not found or you don\u2019t have access.')
        }
        setLoading(false)
        return
      }
      setClassroom(cr)
      if (aResult.status === 'fulfilled') {
        setAssignments(aResult.value)
      } else {
        // Assignments failed but classroom loaded — surface a toast but keep
        // the page usable instead of showing a generic error.
        setAssignments([])
        showToast('Could not load assignments. Pull down to retry.', 'error')
      }
      setLoading(false)

      // Load stats in background for teachers. Abortable so navigating to
      // another classroom mid-flight doesn't write stale stats over fresh.
      if (cr?.role === 'teacher') {
        statsAbortRef.current?.abort()
        const controller = new AbortController()
        statsAbortRef.current = controller
        try {
          const s = await getClassroomStats(t, id, controller.signal)
          if (!controller.signal.aborted) setStats(s)
        } catch { /* aborted or failed silently */ }
      }
    } catch (err) {
      if (err?.isAuthError) {
        setLoadError('Your session expired. Please sign in again.')
      } else {
        setLoadError('Could not load classroom. Check your connection and try again.')
      }
      setLoading(false)
    }
  }

  async function handleRemoveAssignment(assignmentId) {
    const t = await getToken()
    if (!t) return
    // Optimistic remove — preserve the previous list so we can roll back if
    // the server rejects the deletion (e.g. auth expired, 5xx).
    const previous = assignments
    setAssignments(prev => prev.filter(a => a.id !== assignmentId))
    try {
      await removeAssignment(t, id, assignmentId)
    } catch (err) {
      setAssignments(previous)
      showToast(err?.message || 'Could not remove assignment', 'error')
    }
  }

  async function handleExport() {
    const t = await getToken()
    if (!t) return
    try {
      const blob = await exportClassroomCsv(t, id)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${(classroom?.name || 'classroom').replace(/[^a-zA-Z0-9]/g, '_')}_report.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch {}
  }

  async function handleRegenerateCode() {
    const t = await getToken()
    if (!t) return
    try {
      const newCode = await regenerateCode(t, id)
      setClassroom(prev => ({ ...prev, join_code: newCode }))
    } catch (err) {
      showToast(err?.message || 'Could not regenerate code', 'error')
    }
  }

  async function handleArchive() {
    const t = await getToken()
    if (!t) return
    const wasArchived = classroom.archived
    // Optimistic toggle with rollback on failure.
    setClassroom(prev => ({ ...prev, archived: !prev.archived }))
    try {
      await updateClassroom(t, id, { archived: !wasArchived })
    } catch (err) {
      setClassroom(prev => ({ ...prev, archived: wasArchived }))
      showToast(err?.message || 'Could not update classroom', 'error')
    }
  }

  async function handleLeave() {
    const t = await getToken()
    if (!t) return
    try {
      await leaveClassroom(t, id)
      navigate('/classroom')
    } catch (err) {
      showToast(err?.message || 'Could not leave classroom', 'error')
    }
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(classroom.join_code)
      setCodeCopied(true)
      setTimeout(() => setCodeCopied(false), 2000)
    } catch {}
  }

  function handleAssigned() {
    setShowAssign(false)
    loadData()
  }

  async function loadCompletions() {
    setCompletionsLoading(true)
    const t = token || await getToken()
    if (!t) { setCompletionsLoading(false); return }
    try {
      const data = await getCompletions(t, id)
      setCompletionsData(data)
    } catch { setCompletionsData(null) }
    setCompletionsLoading(false)
  }

  function formatTimeSpent(sec) {
    if (!sec) return ''
    if (sec < 60) return `${sec}s`
    return `${Math.round(sec / 60)} min`
  }

  if (loading) {
    return (
      <main className={styles.page}>
        <div className={styles.loading} role="status" aria-live="polite">
          <div className={styles.spinner} />
          <span>Loading classroom…</span>
        </div>
      </main>
    )
  }

  if (!classroom) {
    return (
      <main className={styles.page}>
        <div className={styles.container}>
          <p className={styles.error}>{loadError || 'Classroom not found'}</p>
          <button className={styles.back} onClick={() => loadData()} style={{ marginBottom: '0.5rem' }}>Try Again</button>
          <button className={styles.back} onClick={() => navigate('/classroom')}>Back to Classrooms</button>
        </div>
      </main>
    )
  }

  const isTeacher = classroom.role === 'teacher'

  return (
    <main className={styles.page}>
      <div className={styles.container}>

        {/* Header */}
        <button className={styles.back} onClick={() => navigate('/classroom')}>Back</button>
        <div className={styles.header}>
          <div>
            <h1>{classroom.name}</h1>
            {classroom.archived && <span className={styles.archiveBadge}>Archived</span>}
          </div>
          {isTeacher && (
            <div className={styles.headerMeta}>
              <div className={styles.codeBlock}>
                <span className={styles.codeLabel}>Join code</span>
                <button
                  type="button"
                  className={styles.code}
                  onClick={copyCode}
                  aria-label={`Join code ${classroom.join_code}. Click to copy.`}
                >
                  {classroom.join_code}
                </button>
                <span className={styles.copyHint} aria-live="polite">{codeCopied ? 'Copied' : 'Click to copy'}</span>
              </div>
              <span className={styles.studentCount}>
                {classroom.studentCount} student{classroom.studentCount !== 1 ? 's' : ''}
              </span>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${tab === 'assignments' ? styles.tabActive : ''}`}
            onClick={() => setTab('assignments')}
          >
            Assignments
          </button>
          {isTeacher && (
            <button
              className={`${styles.tab} ${tab === 'students' ? styles.tabActive : ''}`}
              onClick={() => {
                setTab('students')
                if (!completionsData && !completionsLoading) loadCompletions()
              }}
            >
              Students
            </button>
          )}
          {isTeacher && (
            <button
              className={`${styles.tab} ${tab === 'dashboard' ? styles.tabActive : ''}`}
              onClick={() => setTab('dashboard')}
            >
              Dashboard
            </button>
          )}
          {isTeacher && (
            <button
              className={`${styles.tab} ${tab === 'settings' ? styles.tabActive : ''}`}
              onClick={() => setTab('settings')}
            >
              Settings
            </button>
          )}
        </div>

        {/* Assignments tab */}
        {tab === 'assignments' && (
          <div className={styles.tabContent}>
            {isTeacher && (
              <button className={styles.btnPrimary} onClick={() => setShowAssign(true)}>
                Assign a Bill
              </button>
            )}

            {assignments.length === 0 ? (
              <p className={styles.emptyState}>
                {isTeacher ? 'No assignments yet. Assign a bill to get started.' : 'No assignments yet.'}
              </p>
            ) : (
              <div className={styles.assignmentList}>
                {assignments.map(a => (
                  <div key={a.id} className={styles.assignmentCard}>
                    <div className={styles.assignmentTop}>
                      <button
                        className={styles.assignmentTitle}
                        onClick={() => {
                          const bd = a.bill_data || {}
                          const congress = bd.congress
                          const type = (bd.type || bd.bill_type || '').toLowerCase()
                          const number = bd.number || bd.bill_number
                          if (congress && type && number) {
                            const legiscanParam = bd.legiscan_bill_id ? `?legiscan_id=${bd.legiscan_bill_id}` : ''
                            const { analysis: _tAnalysis, ...billOnly } = bd
                            navigate(`/bill/${congress}/${type}/${number}${legiscanParam}`, {
                              state: {
                                bill: billOnly,
                                assignment: a.id,
                                classroom: id,
                                assignmentInstructions: a.instructions || '',
                              },
                            })
                          }
                        }}
                      >
                        <span className={styles.billNum}>
                          {a.bill_data?.type || a.bill_data?.bill_type} {a.bill_data?.number || a.bill_data?.bill_number}
                        </span>
                        {(a.bill_data?.title || a.bill_id).slice(0, 100)}
                      </button>
                      {a.completed && <span className={styles.completedBadge}>Completed</span>}
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
                      {isTeacher && typeof a.completions === 'number' && (
                        <span className={styles.completionCount}>
                          {a.completions}/{a.totalStudents} completed
                        </span>
                      )}
                      {isTeacher && (
                        <button
                          className={styles.removeBtn}
                          onClick={() => handleRemoveAssignment(a.id)}
                        >
                          Remove
                        </button>
                      )}
                    </div>

                    {isTeacher && a.totalStudents > 0 && (
                      <div className={styles.progressBar}>
                        <div
                          className={styles.progressFill}
                          style={{ width: `${Math.round((a.completions / a.totalStudents) * 100)}%` }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Students tab (teacher only) */}
        {tab === 'students' && isTeacher && (
          <div className={styles.tabContent}>
            {completionsLoading ? (
              <div className={styles.loading}>
                <div className={styles.spinner} />
                <span>Loading student data...</span>
              </div>
            ) : !completionsData || completionsData.students.length === 0 ? (
              <p className={styles.emptyState}>No students yet. Share the join code to get started.</p>
            ) : completionsData.assignments.length === 0 ? (
              <p className={styles.emptyState}>No assignments yet. Create one from the Assignments tab.</p>
            ) : (
              <div className={styles.completionGrid}>
                <div className={styles.gridScrollWrapper}>
                  <table className={styles.completionTable}>
                    <thead>
                      <tr>
                        <th className={styles.studentHeader}>Student</th>
                        {completionsData.assignments.map(a => (
                          <th key={a.id} className={styles.assignmentHeader}>
                            <span className={styles.assignmentHeaderType}>
                              {a.billType} {a.billNumber}
                            </span>
                            <span className={styles.assignmentHeaderTitle}>
                              {(a.title || '').slice(0, 40)}
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {completionsData.students.map(student => (
                        <tr key={student.id} className={styles.studentRow}>
                          <td className={styles.studentName}>{student.name}</td>
                          {completionsData.assignments.map(a => {
                            const completion = completionsData.completions?.[student.id]?.[a.id]
                            return (
                              <td
                                key={a.id}
                                className={styles.completionCell}
                                title={completion
                                  ? `Completed ${new Date(completion.completedAt).toLocaleDateString()}${completion.timeSpent ? ' · ' + formatTimeSpent(completion.timeSpent) : ''}`
                                  : 'Not completed'
                                }
                              >
                                {completion ? (
                                  <span className={styles.checkmark} aria-label={`Completed ${new Date(completion.completedAt).toLocaleDateString()}`}>&#10003;</span>
                                ) : (
                                  <span className={styles.pending} aria-label="Not completed">&mdash;</span>
                                )}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Dashboard tab (teacher only) */}
        {tab === 'dashboard' && isTeacher && (
          <div className={styles.tabContent}>
            {!stats ? (
              <div className={styles.loading}>
                <div className={styles.spinner} />
                <span>Loading stats...</span>
              </div>
            ) : (
              <>
                <div className={styles.kpiRow}>
                  <div className={styles.kpi}>
                    <div className={styles.kpiLabel}>Students</div>
                    <div className={styles.kpiValue}>{stats.totalStudents}</div>
                  </div>
                  <div className={styles.kpi}>
                    <div className={styles.kpiLabel}>Active This Week</div>
                    <div className={styles.kpiValue}>{stats.activeThisWeek}</div>
                  </div>
                  <div className={styles.kpi}>
                    <div className={styles.kpiLabel}>Assignments</div>
                    <div className={styles.kpiValue}>{(stats.assignments || []).length}</div>
                  </div>
                </div>

                {/* Per-assignment completion */}
                {(stats.assignments || []).length > 0 && (
                  <div className={styles.panel}>
                    <div className={styles.panelTitle}>Assignment Completion</div>
                    {stats.assignments.map(a => {
                      const pct = a.totalStudents > 0 ? Math.round((a.completions / a.totalStudents) * 100) : 0
                      return (
                        <div key={a.id} className={styles.statAssignment}>
                          <div className={styles.statAssignmentHeader}>
                            <span className={styles.statAssignmentTitle}>
                              {(a.title || a.billId).slice(0, 60)}
                            </span>
                            <span className={styles.statAssignmentPct}>{pct}%</span>
                          </div>
                          <div className={styles.progressBar}>
                            <div className={styles.progressFill} style={{ width: `${pct}%` }} />
                          </div>
                          <div className={styles.statAssignmentMeta}>
                            {a.completions}/{a.totalStudents} completed
                            {a.avgTimeSec && ` · Avg ${Math.round(a.avgTimeSec / 60)} min`}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Topic engagement */}
                {(stats.topicEngagement || []).length > 0 && (
                  <div className={styles.panel}>
                    <div className={styles.panelTitle}>Topic Engagement</div>
                    {stats.topicEngagement.map(([topic, count]) => (
                      <div key={topic} className={styles.topicRow}>
                        <span className={styles.topicName}>{topic}</span>
                        <div className={styles.topicBar}>
                          <div
                            className={styles.topicFill}
                            style={{ width: `${(count / stats.topicEngagement[0][1]) * 100}%` }}
                          />
                        </div>
                        <span className={styles.topicCount}>{count}</span>
                      </div>
                    ))}
                  </div>
                )}

                <button className={styles.exportBtn} onClick={handleExport}>
                  Export CSV Report
                </button>
              </>
            )}
          </div>
        )}

        {/* Settings tab (teacher only) */}
        {tab === 'settings' && isTeacher && (
          <div className={styles.tabContent}>
            <div className={styles.panel}>
              <div className={styles.panelTitle}>Class Settings</div>
              <div className={styles.settingRow}>
                <span>Join Code</span>
                <div className={styles.settingActions}>
                  <span className={styles.code}>{classroom.join_code}</span>
                  <button className={styles.linkBtn} onClick={handleRegenerateCode}>
                    Regenerate
                  </button>
                </div>
              </div>
              <div className={styles.settingRow}>
                <span>Status</span>
                <button className={styles.linkBtn} onClick={handleArchive}>
                  {classroom.archived ? 'Unarchive' : 'Archive'} Class
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Student: leave option */}
        {!isTeacher && (
          <div style={{ marginTop: '2rem', textAlign: 'center' }}>
            <button className={styles.linkBtn} onClick={handleLeave} style={{ color: 'var(--status-failed)' }}>
              Leave this classroom
            </button>
          </div>
        )}

      </div>

      {showAssign && (
        <AssignBillModal
          classroomId={id}
          onClose={() => setShowAssign(false)}
          onAssigned={handleAssigned}
        />
      )}
    </main>
  )
}
