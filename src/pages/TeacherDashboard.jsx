import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getSessionSafe } from '../lib/supabase'
import { getMyClassrooms, getJoinedClassrooms } from '../lib/classroom'
import CreateClassroomModal from '../components/CreateClassroomModal.jsx'
import AuthModal from '../components/AuthModal.jsx'
import styles from './TeacherDashboard.module.css'

export default function TeacherDashboard() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { user } = useAuth()
  const [classrooms, setClassrooms] = useState([])
  const [anonClassrooms, setAnonClassrooms] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [showAuth, setShowAuth] = useState(false)
  // Set when a "create a class" action is taken while logged out, so we can
  // open the create modal automatically once sign-in completes.
  const [pendingCreate, setPendingCreate] = useState(false)
  const [codeCopied, setCodeCopied] = useState(null)

  useEffect(() => {
    loadClassrooms()
  }, [user])

  // Honor ?create=1 (used by the /educators landing CTA). Logged-in teachers
  // jump straight into the create-class modal; logged-out teachers get the
  // sign-in modal first, then land in create via the pendingCreate effect.
  // Strip the param afterward so a refresh doesn't reopen the modal.
  useEffect(() => {
    if (searchParams.get('create') !== '1') return
    if (user) {
      setShowCreate(true)
    } else {
      setPendingCreate(true)
      setShowAuth(true)
    }
    const next = new URLSearchParams(searchParams)
    next.delete('create')
    setSearchParams(next, { replace: true })
  }, [searchParams, user, setSearchParams])

  // Once a logged-out teacher signs in via the "create a class" path, open the
  // create modal so the action they intended completes without an extra click.
  useEffect(() => {
    if (user && pendingCreate) {
      setPendingCreate(false)
      setShowAuth(false)
      setShowCreate(true)
    }
  }, [user, pendingCreate])

  function startCreate() {
    if (user) {
      setShowCreate(true)
    } else {
      setPendingCreate(true)
      setShowAuth(true)
    }
  }

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
            <button className={styles.btnPrimary} onClick={startCreate}>
              {user ? 'Create Class' : 'Sign in to create'}
            </button>
            <button className={styles.btnSecondary} onClick={() => navigate('/classroom/join')}>
              Join a Class
            </button>
          </div>
        </div>

        {!hasAnything && (
          <div className={styles.empty}>
            <h2>Welcome to Classrooms</h2>
            <p>Teachers: create a class in about two minutes and share the join code with your students. Students: join a class with the code from your teacher to see assigned bills.</p>
            <div className={styles.emptyActions}>
              <button className={styles.btnPrimary} onClick={startCreate}>
                {user ? 'Create a class' : 'Sign in to create a class'}
              </button>
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

      <AuthModal
        isOpen={showAuth}
        onClose={() => { setShowAuth(false); setPendingCreate(false) }}
      />
    </main>
  )
}
