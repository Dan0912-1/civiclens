import { useState, useEffect } from 'react'
import { getSessionSafe } from '../lib/supabase'
import { makeBillId } from '../lib/billId'
import { listGoogleCourses, createGoogleCoursework, getGoogleConnectUrl, googleErrorMessage } from '../lib/googleClassroom'
import { Capacitor } from '@capacitor/core'
import { Browser } from '@capacitor/browser'
import { App } from '@capacitor/app'
import styles from './GoogleAssignModal.module.css'

const isNative = Capacitor.getPlatform() !== 'web'

// Teacher-facing modal to push the current bill into a Google Classroom course.
// Draft by default; "Assign now" publishes immediately. Opened from BillDetail.
//
// A teacher who hasn't connected Google yet can do it from right here. The
// first version told them to "connect on the Classrooms page" and left them to
// find it, then find their way back to this bill — the modal now runs the
// consent flow itself and returns to this same bill with the modal reopened.
export default function GoogleAssignModal({ bill, onClose }) {
  const [courses, setCourses] = useState(null) // null = loading
  const [courseId, setCourseId] = useState('')
  const [publish, setPublish] = useState(false) // default: Save as draft
  const [points, setPoints] = useState(100)
  const [instructions, setInstructions] = useState('')
  const [dueAt, setDueAt] = useState('') // local "YYYY-MM-DDTHH:MM"
  const [busy, setBusy] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState('')
  // 'not_connected' | 'reconnect' — set when Google itself is the blocker, so
  // we show the connect panel instead of an error the teacher can't act on.
  const [connectNeeded, setConnectNeeded] = useState(null)
  const [result, setResult] = useState(null)

  useEffect(() => { loadCourses() }, [])

  // Native: the consent flow runs in an in-app browser and comes back as a
  // custom-scheme deep link. Catch it here so the modal picks up the new
  // connection without the teacher having to close and reopen it.
  useEffect(() => {
    if (!isNative) return
    let handle
    App.addListener('appUrlOpen', async (event) => {
      const url = event?.url || ''
      if (!url.includes('google-connected')) return
      try { await Browser.close() } catch { /* already closed */ }
      const params = new URLSearchParams(url.split('?')[1] || '')
      setConnecting(false)
      if (params.get('google') === 'connected') loadCourses()
      else setError(googleErrorMessage(params.get('reason')))
    }).then(h => { handle = h })
    return () => { handle?.remove() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadCourses() {
    setError('')
    setConnectNeeded(null)
    setCourses(null)
    try {
      const session = await getSessionSafe()
      const token = session?.access_token
      if (!token) { setError('Please sign in again.'); setCourses([]); return }
      const list = await listGoogleCourses(token)
      setCourses(list)
      if (list.length) setCourseId(list[0].id)
    } catch (err) {
      setCourses([])
      if (err.code === 'not_connected' || err.code === 'reconnect') setConnectNeeded(err.code)
      else setError(err.message || 'Could not reach Google Classroom.')
    }
  }

  // Start Google consent, returning to THIS bill with the modal reopened.
  async function handleConnect() {
    setConnecting(true)
    setError('')
    try {
      const session = await getSessionSafe()
      const token = session?.access_token
      if (!token) { setError('Please sign in again.'); setConnecting(false); return }
      const params = new URLSearchParams(window.location.search)
      params.set('gassign', '1')
      const returnTo = `${window.location.pathname}?${params.toString()}`
      const url = await getGoogleConnectUrl(token, { platform: isNative ? 'native' : 'web', returnTo })
      if (isNative) {
        // The deep-link listener on this page closes the browser and reloads
        // the course list; keep the modal open behind it.
        await Browser.open({ url })
        setConnecting(false)
      } else {
        window.location.href = url
      }
    } catch (err) {
      setError(err.message || 'Could not start Google connect.')
      setConnecting(false)
    }
  }

  function billData() {
    return {
      title: bill.title,
      type: bill.type ?? bill.bill_type,
      number: bill.number ?? bill.bill_number,
      congress: bill.congress,
      topics: bill.topics,
      latestAction: bill.latestAction ?? bill.latest_action,
      state: bill.state,
      jurisdiction: bill.jurisdiction,
      session: bill.session,
      legiscan_bill_id: bill.legiscan_bill_id,
    }
  }

  async function handlePush() {
    if (!courseId) { setError('Pick a class.'); return }
    setBusy(true); setError('')
    try {
      const session = await getSessionSafe()
      const token = session?.access_token
      if (!token) { setError('Please sign in again.'); setBusy(false); return }
      const course = (courses || []).find(c => c.id === courseId)
      // Convert the teacher's local datetime to a UTC timestamp for Google;
      // keep the local date for the CapitolKey assignment row.
      let dueDate, dueDateTime
      if (dueAt) {
        const d = new Date(dueAt)
        if (!isNaN(d.getTime())) { dueDate = dueAt.slice(0, 10); dueDateTime = d.toISOString() }
      }
      const res = await createGoogleCoursework(token, {
        courseId,
        courseName: course?.name || '',
        billId: makeBillId(bill),
        billData: billData(),
        instructions: instructions.trim() || undefined,
        dueDate,
        dueDateTime,
        maxPoints: Number(points) || 100,
        publish,
      })
      setResult({ alternateLink: res.alternateLink, state: res.state, alreadyPushed: res.alreadyPushed })
    } catch (err) {
      if (err.code === 'not_connected' || err.code === 'reconnect') setConnectNeeded(err.code)
      else setError(err.message || 'Could not reach Google Classroom.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>Assign in Google Classroom</h2>
          <button className={styles.close} onClick={onClose} aria-label="Close">×</button>
        </div>

        <p className={styles.billTitle}>{bill.title}</p>

        {result ? (
          <div className={styles.success}>
            <p className={styles.successMsg}>
              {result.alreadyPushed
                ? 'This bill is already assigned in that class.'
                : result.state === 'PUBLISHED'
                  ? 'Posted to Google Classroom. Your students can see it now.'
                  : 'Saved as a draft in Google Classroom. Review it there, then post when ready.'}
            </p>
            {result.alternateLink && (
              <a className={styles.openBtn} href={result.alternateLink} target="_blank" rel="noopener noreferrer">
                Open in Google Classroom
              </a>
            )}
            <button className={styles.doneBtn} onClick={onClose}>Done</button>
          </div>
        ) : connectNeeded ? (
          <div className={styles.connectPanel}>
            <p className={styles.connectMsg}>
              {connectNeeded === 'reconnect'
                ? 'Your Google Classroom connection expired. Reconnect to keep posting assignments and sending grades.'
                : 'Connect your Google account to post this bill straight into one of your Google Classroom classes.'}
            </p>
            <p className={styles.connectDetail}>
              CapitolKey only sees your class list and the assignments it creates. We never read student work or your roster.
            </p>
            {error && <div className={styles.error}>{error}</div>}
            <div className={styles.actions}>
              <button className={styles.cancel} onClick={onClose} disabled={connecting}>Cancel</button>
              <button className={styles.assign} onClick={handleConnect} disabled={connecting}>
                {connecting ? 'Opening Google...' : connectNeeded === 'reconnect' ? 'Reconnect Google' : 'Connect Google Classroom'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <label className={styles.label} htmlFor="gc-course">Class</label>
            {courses === null ? (
              <div className={styles.loading}>Loading your classes...</div>
            ) : courses.length === 0 ? (
              <div className={styles.empty}>
                {error || 'No active Google Classroom classes found. Create or unarchive a class in Google Classroom, then try again.'}
              </div>
            ) : (
              <select id="gc-course" className={styles.select} value={courseId} onChange={e => setCourseId(e.target.value)}>
                {courses.map(c => (
                  <option key={c.id} value={c.id}>{c.name}{c.section ? ` · ${c.section}` : ''}</option>
                ))}
              </select>
            )}

            <label className={styles.label} htmlFor="gc-instructions">Instructions (optional)</label>
            <textarea
              id="gc-instructions"
              className={styles.textarea}
              value={instructions}
              maxLength={500}
              onChange={e => setInstructions(e.target.value)}
              placeholder="What should students do with this bill?"
            />

            <div className={styles.row}>
              <div className={styles.col}>
                <label className={styles.label} htmlFor="gc-due">Due (optional)</label>
                <input id="gc-due" type="datetime-local" className={styles.input} value={dueAt} onChange={e => setDueAt(e.target.value)} />
              </div>
              <div className={styles.col}>
                <label className={styles.label} htmlFor="gc-points">Points</label>
                <input id="gc-points" type="number" min="1" max="1000" className={styles.input} value={points} onChange={e => setPoints(e.target.value)} />
              </div>
            </div>
            <p className={styles.hint}>
              Students earn full points once they read the bill. The grade lands in Google Classroom on its own.
            </p>

            <label className={styles.label}>Post as</label>
            <div className={styles.toggle}>
              <button type="button" className={!publish ? styles.toggleActive : styles.toggleBtn} onClick={() => setPublish(false)}>
                Save as draft
              </button>
              <button type="button" className={publish ? styles.toggleActive : styles.toggleBtn} onClick={() => setPublish(true)}>
                Assign now
              </button>
            </div>
            <p className={styles.hint}>
              {publish
                ? 'Students get it immediately.'
                : 'You review it in Google Classroom before students see it. Grades only start syncing once you post it.'}
            </p>

            {error && courses && courses.length > 0 && <div className={styles.error}>{error}</div>}

            <div className={styles.actions}>
              <button className={styles.cancel} onClick={onClose} disabled={busy}>Cancel</button>
              <button className={styles.assign} onClick={handlePush} disabled={busy || !courseId || courses === null || courses.length === 0}>
                {busy ? 'Pushing...' : publish ? 'Assign now' : 'Save draft'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
