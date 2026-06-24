import { useState, useEffect } from 'react'
import { getSessionSafe } from '../lib/supabase'
import { makeBillId } from '../lib/billId'
import { listGoogleCourses, createGoogleCoursework } from '../lib/googleClassroom'
import styles from './GoogleAssignModal.module.css'

// Teacher-facing modal to push the current bill into a Google Classroom course.
// Draft by default; "Assign now" publishes immediately. Opened from BillDetail.
export default function GoogleAssignModal({ bill, onClose }) {
  const [courses, setCourses] = useState(null) // null = loading
  const [courseId, setCourseId] = useState('')
  const [publish, setPublish] = useState(false) // default: Save as draft
  const [points, setPoints] = useState(100)
  const [instructions, setInstructions] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  useEffect(() => { loadCourses() }, [])

  async function loadCourses() {
    setError('')
    try {
      const session = await getSessionSafe()
      const token = session?.access_token
      if (!token) { setError('Please sign in again.'); setCourses([]); return }
      const list = await listGoogleCourses(token)
      setCourses(list)
      if (list.length) setCourseId(list[0].id)
    } catch (err) {
      setCourses([])
      setError(connectError(err))
    }
  }

  function connectError(err) {
    if (err.code === 'not_connected') return 'Connect Google Classroom first, on the Classrooms page.'
    if (err.code === 'reconnect') return 'Your Google connection expired. Reconnect on the Classrooms page.'
    return err.message || 'Could not reach Google Classroom.'
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
      const res = await createGoogleCoursework(token, {
        courseId,
        courseName: course?.name || '',
        billId: makeBillId(bill),
        billData: billData(),
        instructions: instructions.trim() || undefined,
        dueDate: dueDate || undefined,
        maxPoints: Number(points) || 100,
        publish,
      })
      setResult({ alternateLink: res.alternateLink, state: res.state, alreadyPushed: res.alreadyPushed })
    } catch (err) {
      setError(connectError(err))
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
        ) : (
          <>
            <label className={styles.label}>Class</label>
            {courses === null ? (
              <div className={styles.loading}>Loading your classes...</div>
            ) : courses.length === 0 ? (
              <div className={styles.empty}>{error || 'No active Google Classroom classes found.'}</div>
            ) : (
              <select className={styles.select} value={courseId} onChange={e => setCourseId(e.target.value)}>
                {courses.map(c => (
                  <option key={c.id} value={c.id}>{c.name}{c.section ? ` · ${c.section}` : ''}</option>
                ))}
              </select>
            )}

            <label className={styles.label}>Instructions (optional)</label>
            <textarea
              className={styles.textarea}
              value={instructions}
              maxLength={500}
              onChange={e => setInstructions(e.target.value)}
              placeholder="What should students do with this bill?"
            />

            <div className={styles.row}>
              <div className={styles.col}>
                <label className={styles.label}>Due date (optional)</label>
                <input type="date" className={styles.input} value={dueDate} onChange={e => setDueDate(e.target.value)} />
              </div>
              <div className={styles.col}>
                <label className={styles.label}>Points</label>
                <input type="number" min="0" max="1000" className={styles.input} value={points} onChange={e => setPoints(e.target.value)} />
              </div>
            </div>

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
              {publish ? 'Students get it immediately.' : 'You review it in Google Classroom before students see it.'}
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
