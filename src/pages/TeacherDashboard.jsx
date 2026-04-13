import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getSessionSafe } from '../lib/supabase'
import { getMyClassrooms, getJoinedClassrooms } from '../lib/classroom'
import CreateClassroomModal from '../components/CreateClassroomModal.jsx'
import styles from './TeacherDashboard.module.css'

export default function TeacherDashboard() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [classrooms, setClassrooms] = useState([])
  const [anonClassrooms, setAnonClassrooms] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [codeCopied, setCodeCopied] = useState(null)

  useEffect(() => {
    loadClassrooms()
  }, [user])

  async function loadClassrooms() {
    setLoading(true)

    // Load anonymous joined classrooms from sessionStorage
    const localJoined = getJoinedClassrooms()
    setAnonClassrooms(localJoined)

    // Load server-side classrooms for logged-in users
    if (user) {
      try {
        const session = await getSessionSafe()
        const token = session?.access_token
        if (token) {
          const data = await getMyClassrooms(token)
          setClassrooms(data)
        }
      } catch {}
    }
    setLoading(false)
  }

  function handleCreated() {
    setShowCreate(false)
    loadClassrooms()
  }

  async function copyCode(code, id) {
    try {
      await navigator.clipboard.writeText(code)
      setCodeCopied(id)
      setTimeout(() => setCodeCopied(null), 2000)
    } catch {}
  }

  const teacherClasses = classrooms.filter(c => c.role === 'teacher')
  const studentClasses = classrooms.filter(c => c.role === 'student')
  const hasAnything = classrooms.length > 0 || anonClassrooms.length > 0

  if (loading) {
    return (
      <main className={styles.page}>
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <span>Loading classrooms...</span>
        </div>
      </main>
    )
  }

  return (
    <main className={styles.page}>
      <div className={styles.container}>

        <div className={styles.header}>
          <h1>Classrooms</h1>
          <div className={styles.actions}>
            {user && (
              <button className={styles.btnPrimary} onClick={() => setShowCreate(true)}>
                Create Class
              </button>
            )}
            <button className={styles.btnSecondary} onClick={() => navigate('/classroom/join')}>
              Join a Class
            </button>
          </div>
        </div>

        {!hasAnything && (
          <div className={styles.empty}>
            <h2>Welcome to Classrooms</h2>
            <p>Join a class with a code from your teacher to see assigned bills. Teachers can sign in to create classes and track engagement.</p>
            <div className={styles.emptyActions}>
              <button className={styles.btnSecondary} onClick={() => navigate('/classroom/join')}>
                Join with Code
              </button>
            </div>
          </div>
        )}

        {teacherClasses.length > 0 && (
          <section>
            <h2 className={styles.sectionTitle}>Your Classes</h2>
            <div className={styles.grid}>
              {teacherClasses.map(c => (
                <button
                  key={c.id}
                  className={styles.card}
                  onClick={() => navigate(`/classroom/${c.id}`)}
                >
                  <div className={styles.cardTop}>
                    <span className={styles.cardName}>{c.name}</span>
                    {c.archived && <span className={styles.archiveBadge}>Archived</span>}
                  </div>
                  <div className={styles.cardStats}>
                    <span>{c.studentCount} student{c.studentCount !== 1 ? 's' : ''}</span>
                    <span>{c.assignmentCount} assignment{c.assignmentCount !== 1 ? 's' : ''}</span>
                  </div>
                  <div className={styles.cardCode}>
                    <span className={styles.codeLabel}>Join code</span>
                    <span
                      className={styles.code}
                      onClick={e => { e.stopPropagation(); copyCode(c.join_code, c.id) }}
                    >
                      {c.join_code}
                      <span className={styles.copyHint}>
                        {codeCopied === c.id ? 'Copied' : 'Copy'}
                      </span>
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {studentClasses.length > 0 && (
          <section>
            <h2 className={styles.sectionTitle}>Classes You've Joined</h2>
            <div className={styles.grid}>
              {studentClasses.map(c => (
                <button
                  key={c.id}
                  className={styles.card}
                  onClick={() => navigate(`/classroom/${c.id}`)}
                >
                  <div className={styles.cardTop}>
                    <span className={styles.cardName}>{c.name}</span>
                  </div>
                  <div className={styles.cardStats}>
                    <span>{c.assignmentCount} assignment{c.assignmentCount !== 1 ? 's' : ''}</span>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Anonymous joined classrooms (via code, no account) */}
        {anonClassrooms.length > 0 && studentClasses.length === 0 && (
          <section>
            <h2 className={styles.sectionTitle}>Your Classes</h2>
            <div className={styles.grid}>
              {anonClassrooms.map(c => (
                <button
                  key={c.code}
                  className={styles.card}
                  onClick={() => navigate(`/classroom/view/${c.code}`)}
                >
                  <div className={styles.cardTop}>
                    <span className={styles.cardName}>{c.name}</span>
                  </div>
                  <div className={styles.cardStats}>
                    <span>Joined via code</span>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

      </div>

      {showCreate && (
        <CreateClassroomModal
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}
    </main>
  )
}
