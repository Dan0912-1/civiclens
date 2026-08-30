import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getMyClassrooms, getJoinedClassrooms } from '../lib/classroom'
import { getGoogleStatus, getGoogleConnectUrl, disconnectGoogle, googleErrorMessage } from '../lib/googleClassroom'
import CreateClassroomModal from '../components/CreateClassroomModal.jsx'
import { Capacitor } from '@capacitor/core'
import { Browser } from '@capacitor/browser'
import { App } from '@capacitor/app'
import styles from './TeacherDashboard.module.css'

const isNative = Capacitor.getPlatform() !== 'web'

export default function TeacherDashboard() {
  const navigate = useNavigate()
  const { user, getToken } = useAuth()
  const [classrooms, setClassrooms] = useState([])
  const [anonClassrooms, setAnonClassrooms] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [codeCopied, setCodeCopied] = useState(null)
  const [googleStatus, setGoogleStatus] = useState(null)
  const [googleBusy, setGoogleBusy] = useState(false)
  const [googleNotice, setGoogleNotice] = useState(null)

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
        const token = await getToken()
        if (token) {
          const data = await getMyClassrooms(token)
          setClassrooms(data)
        }
      } catch {}
    }
    setLoading(false)
  }

  // ─── Google Classroom connection ───────────────────────────────────────────
  // Status for logged-in users (teachers connect; students just won't bother).
  useEffect(() => {
    if (!user) { setGoogleStatus(null); return }
    refreshGoogleStatus()
  }, [user])

  // Surface the OAuth return on web (?google=connected | ?google=error&reason=).
  // Native is handled by the deep-link listener below.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const g = params.get('google')
    if (!g) return
    if (g === 'connected') setGoogleNotice({ type: 'success', msg: 'Google Classroom connected.' })
    else setGoogleNotice({ type: 'error', msg: googleErrorMessage(params.get('reason')) })
    window.history.replaceState(null, '', window.location.pathname)
  }, [])

  // Native: catch the custom-scheme deep link after the in-app browser flow.
  useEffect(() => {
    if (!isNative) return
    let handle
    App.addListener('appUrlOpen', async (event) => {
      const url = event?.url || ''
      if (!url.includes('google-connected')) return
      try { await Browser.close() } catch {}
      const params = new URLSearchParams(url.split('?')[1] || '')
      const g = params.get('google')
      if (g === 'connected') setGoogleNotice({ type: 'success', msg: 'Google Classroom connected.' })
      else setGoogleNotice({ type: 'error', msg: googleErrorMessage(params.get('reason')) })
      refreshGoogleStatus()
    }).then(h => { handle = h })
    return () => { handle?.remove() }
  }, [])

  async function refreshGoogleStatus() {
    try {
      const token = await getToken()
      if (!token) return
      setGoogleStatus(await getGoogleStatus(token))
    } catch {}
  }

  async function handleConnectGoogle() {
    setGoogleBusy(true)
    setGoogleNotice(null)
    try {
      const token = await getToken()
      if (!token) {
        setGoogleNotice({ type: 'error', msg: 'Please sign in first.' })
        setGoogleBusy(false)
        return
      }
      const url = await getGoogleConnectUrl(token, { platform: isNative ? 'native' : 'web', returnTo: '/classroom' })
      if (isNative) {
        await Browser.open({ url })
        setGoogleBusy(false) // deep-link listener finishes the flow
      } else {
        window.location.href = url // full navigation to Google consent
      }
    } catch (err) {
      setGoogleNotice({ type: 'error', msg: err.message || 'Could not start Google connect.' })
      setGoogleBusy(false)
    }
  }

  async function handleDisconnectGoogle() {
    if (!window.confirm('Disconnect Google Classroom? Assignments already pushed stay in Google Classroom, but CapitolKey can no longer send grades.')) return
    setGoogleBusy(true)
    try {
      const token = await getToken()
      if (token) {
        await disconnectGoogle(token)
        setGoogleNotice({ type: 'success', msg: 'Google Classroom disconnected.' })
      }
      await refreshGoogleStatus()
    } catch (err) {
      setGoogleNotice({ type: 'error', msg: err.message || 'Could not disconnect.' })
    } finally {
      setGoogleBusy(false)
    }
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

        {googleNotice && (
          <div className={`${styles.notice} ${googleNotice.type === 'success' ? styles.noticeSuccess : styles.noticeError}`}>
            {googleNotice.msg}
          </div>
        )}

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

        {user && googleStatus?.configured && (
          <div className={styles.googleCard}>
            <div className={styles.googleInfo}>
              <span className={styles.googleTitle}>Google Classroom</span>
              {googleStatus.connected ? (
                <span className={styles.googleMeta}>
                  {/* A stored token Google has since rejected — usually the
                      teacher removed CapitolKey in their Google account. The
                      card used to keep saying "Connected" while every assign
                      and grade sync silently failed. */}
                  {googleStatus.needsReconnect
                    ? `Your Google connection stopped working${googleStatus.email ? ` (${googleStatus.email})` : ''}. Reconnect to post assignments and send grades again.`
                    : `Connected${googleStatus.email ? ` as ${googleStatus.email}` : ''}.${googleStatus.needsReconsent ? ' Reconnect to finish enabling grade passback.' : ''}`}
                </span>
              ) : (
                <span className={styles.googleMeta}>
                  Push CapitolKey bills into your classes as graded assignments.
                </span>
              )}
            </div>
            <div className={styles.googleActions}>
              {googleStatus.connected ? (
                <>
                  {(googleStatus.needsReconsent || googleStatus.needsReconnect) && (
                    <button className={styles.btnPrimary} disabled={googleBusy} onClick={handleConnectGoogle}>
                      Reconnect
                    </button>
                  )}
                  <button className={styles.googleDisconnect} disabled={googleBusy} onClick={handleDisconnectGoogle}>
                    Disconnect
                  </button>
                </>
              ) : (
                <button className={styles.btnPrimary} disabled={googleBusy} onClick={handleConnectGoogle}>
                  {googleBusy ? 'Connecting...' : 'Connect Google Classroom'}
                </button>
              )}
            </div>
          </div>
        )}

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
