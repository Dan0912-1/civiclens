import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase, getSessionSafe } from '../lib/supabase'
import { getApiBase } from '../lib/api'
import { trackInteraction } from '../lib/interactions'
import {
  addBookmark, removeBookmark, getBookmarks,
  readCachedProfile, resolveProfile, isPersonalizable,
} from '../lib/userProfile'
import { useToast } from '../context/ToastContext'
import { markComplete, markCompleteAnon, getMyClassrooms, createAssignment } from '../lib/classroom'
import { completeGoogleAssignment, gradeReasonMessage, googleErrorMessage } from '../lib/googleClassroom'
import GoogleAssignModal from '../components/GoogleAssignModal.jsx'
import { makeBillId, makeCongressBillId, sameBillId } from '../lib/billId'
import { billHref, congressGovUrl, congressGovTextUrl, isRepFinderUrl, trimDanglingConnector } from '../lib/billUrl'
import RepsPanel from '../components/RepsPanel'
import { stageToDot, stageLabels } from '../lib/billStage'
import { isReadBillAction, splitActionText } from '../lib/actionLinks'
import { formatBillText } from '../lib/billText'
import styles from './BillDetail.module.css'

const API_BASE = getApiBase()

async function openInAppBrowser(url) {
  try {
    const { Capacitor } = await import('@capacitor/core')
    if (Capacitor.isNativePlatform()) {
      const { Browser } = await import('@capacitor/browser')
      await Browser.open({ url, presentationStyle: 'popover' })
      return
    }
  } catch {}
  // Fallback for web
  window.open(url, '_blank', 'noopener,noreferrer')
}

const TAG_COLORS = {
  Education:     'blue',
  Healthcare:    'green',
  Economy:       'purple',
  Environment:   'teal',
  Technology:    'red',
  Housing:       'orange',
  'Civil Rights':'violet',
  Immigration:   'amber',
  Community:     'slate',
  Other:         'gray',
}

/**
 * One block of the bill as its official printing sets it.
 *
 * The printed document carries its structure entirely through layout — the
 * masthead, the centered display lines, the section rules, and above all the
 * indentation ladder that shows which clause sits inside which subsection.
 * formatBillText recovers that structure from the collapsed text; this renders
 * it back with real typography instead of a monospace column.
 */
function BillTextBlock({ block, showDeleted, styles }) {
  // States mark repealed language by bracketing it mid-sentence. Hiding it
  // shows the statute as the bill would leave it; the reader's toggle strikes
  // it through instead.
  const body = block.runs
    ? block.runs
      .filter(run => showDeleted || !run.struck)
      .map((run, index) => (run.struck
        ? <del key={index} className={styles.billTextStruck}>{run.text}</del>
        : <span key={index}>{run.text}</span>))
    : block.text

  const deletedClass = block.deleted ? styles.billTextDeleted : ''

  if (block.type === 'masthead') {
    return <p className={styles.billTextMasthead}>{block.text}</p>
  }

  if (block.type === 'display') {
    return <h3 className={`${styles.billTextDisplay} ${deletedClass}`}>{block.text}</h3>
  }

  if (block.type === 'heading') {
    return (
      <h4 className={`${styles.billTextDocumentHeading} ${deletedClass}`}>
        {block.marker && <span className={styles.billTextSectionNumber}>{block.marker}</span>}
        {block.text && <span className={styles.billTextSectionTitle}>{block.text}</span>}
      </h4>
    )
  }

  if (block.type === 'enacting') {
    return <p className={`${styles.billTextEnacting} ${deletedClass}`}>{body}</p>
  }

  if (block.type === 'provision') {
    return (
      <p
        className={[
          styles.billTextProvision,
          block.quoted ? styles.billTextQuoted : '',
          deletedClass,
        ].filter(Boolean).join(' ')}
        style={{ '--depth': block.depth || 0 }}
      >
        <span className={styles.billTextMarker}>{block.marker}</span>
        <span className={styles.billTextProvisionBody}>{body}</span>
      </p>
    )
  }

  return <p className={`${styles.billTextParagraph} ${deletedClass}`}>{body}</p>
}

export default function BillDetail() {
  // This component backs two routes:
  //   federal  /bill/:congress/:type/:number
  //   state    /states/:state/:session/:type/:number   (params.state is set)
  const params = useParams()
  const isStateRoute = Boolean(params.state)
  const state = params.state || null
  const session = params.session || null
  const type = params.type
  const number = params.number
  // State routes have no congress; use a stable synthetic so the
  // makeCongressBillId-based identity checks and effect deps still line up.
  const congress = params.congress ?? '0'
  const navigate = useNavigate()
  const location = useLocation()
  const { user, loading: authLoading, signInWithGoogle } = useAuth()
  const { showToast } = useToast()
  const trackedRef = useRef(false)
  const billTextTriggerRef = useRef(null)
  const billTextDialogRef = useRef(null)
  const billTextCloseRef = useRef(null)
  // Route id we've already POSTed to /api/personalize for. The effect below
  // re-runs when auth resolves (null → signed-in user), and without this a
  // request already in flight would be duplicated.
  const requestedRef = useRef(null)

  // Data passed from Results page via router state. For deep links (push
  // notification, shared URL) location.state is null; fall back to query
  // params so the "Mark as Read" button + assignment banner still render.
  const passedBill = location.state?.bill || null
  const passedAnalysis = location.state?.analysis || null
  const returnTo = location.state?.returnTo || '/results'
  const searchParams = new URLSearchParams(location.search)
  const assignmentId = location.state?.assignment || searchParams.get('assignment') || null
  const assignmentClassroomId = location.state?.classroom || searchParams.get('classroom') || null
  const assignmentInstructions = location.state?.assignmentInstructions || ''
  // Google Classroom student flow: the Classroom Link points here with ?gcr=<assignmentId>.
  const gcrAssignmentId = searchParams.get('gcr') || null

  const [bill, setBill] = useState(passedBill)
  const [analysis, setAnalysis] = useState(passedAnalysis)
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [personalizationError, setPersonalizationError] = useState(false)
  const [noProfile, setNoProfile] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [bookmarked, setBookmarked] = useState(false)
  const [bookmarkBusy, setBookmarkBusy] = useState(false)
  const [shareMsg, setShareMsg] = useState('')
  const [assignmentCompleted, setAssignmentCompleted] = useState(false)
  const [markCompleteBusy, setMarkCompleteBusy] = useState(false)
  const assignmentTimerRef = useRef(null)
  const [assignOpen, setAssignOpen] = useState(false)
  const [assignClassrooms, setAssignClassrooms] = useState([])
  const [assignLoading, setAssignLoading] = useState(false)
  const assignRef = useRef(null)
  const [showGoogleAssign, setShowGoogleAssign] = useState(false)
  const [gcrCompleted, setGcrCompleted] = useState(false)
  const [gcrBusy, setGcrBusy] = useState(false)
  const [gcrError, setGcrError] = useState(false)
  // Why the grade didn't reach Google, when it didn't. Kept separate from
  // gcrError: the work IS recorded, so this is a status note, not a failure.
  const [gcrGradeNote, setGcrGradeNote] = useState('')
  const [gcrNeedsSchoolAccount, setGcrNeedsSchoolAccount] = useState(false)
  const gcrAutoRef = useRef(false)
  const gassignPendingRef = useRef(false)
  const [fullText, setFullText] = useState(null) // { text, wordCount, version }
  const [fullTextLoading, setFullTextLoading] = useState(false)
  const [fullTextUnavailable, setFullTextUnavailable] = useState(false)
  const [fullTextOpen, setFullTextOpen] = useState(false)
  const [showDeletedText, setShowDeletedText] = useState(false)
  const [repsOpen, setRepsOpen] = useState(false)

  // Reset per-bill state whenever the route params change so navigating from
  // Bill A → Bill B doesn't show stale A data for a frame.
  useEffect(() => {
    trackedRef.current = false
    requestedRef.current = null
    setAnalysis(passedAnalysis)
    setBill(passedBill)
    setDetail(null)
    setError('')
    setPersonalizationError(false)
    setNoProfile(false)
    setShareMsg('')
    setBookmarked(false)
    setBookmarkBusy(false)
    setHistoryOpen(false)
    setFullText(null)
    setFullTextLoading(false)
    setFullTextUnavailable(false)
    setFullTextOpen(false)
    setShowDeletedText(false)
    setRepsOpen(false)
    // intentionally excluding passedBill/passedAnalysis — they're read as
    // initial snapshots, not reactive dependencies. Re-running on route
    // param change is what we want.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [congress, type, number, state, session])

  // The full text is long enough to deserve a focused reading surface rather
  // than a nested accordion. Lock page scroll, support Escape, keep keyboard
  // focus inside the dialog, then return focus to the launch button on close.
  useEffect(() => {
    if (!fullTextOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    billTextCloseRef.current?.focus()

    function handleReaderKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setFullTextOpen(false)
        return
      }
      if (event.key !== 'Tab' || !billTextDialogRef.current) return
      const focusable = [...billTextDialogRef.current.querySelectorAll(
        'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
      )]
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleReaderKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleReaderKeyDown)
      billTextTriggerRef.current?.focus()
    }
  }, [fullTextOpen])

  // Track view_detail interaction once we have analysis (for topic_tag)
  useEffect(() => {
    if (trackedRef.current || !analysis) return
    trackedRef.current = true
    const billId = makeCongressBillId(type, number, congress)
    const doTrack = async () => {
      let token = null
      if (user && supabase) {
        const session = await getSessionSafe()
        token = session?.access_token
      }
      trackInteraction(user?.id, token, {
        billId,
        actionType: 'view_detail',
        topicTag: analysis.topic_tag,
      })
    }
    doTrack()
  }, [analysis, user, congress, type, number])

  // Check if bill is bookmarked
  useEffect(() => {
    if (!user) return
    const bId = bill?.legiscan_bill_id
      ? makeBillId(bill)
      : makeCongressBillId(type, number, congress)
    getBookmarks(user.id).then(bms => {
      // Use case-insensitive compare so legacy uppercase bookmarks still match
      // the new canonical lowercase id produced by makeCongressBillId.
      setBookmarked(bms.some(b => sameBillId(b.bill_id, bId)))
    })
  }, [user, bill, congress, type, number])

  // Assignment completion: start timer when page loads with assignment context.
  // Anonymous students need the timer too so the teacher's "avg time" metric
  // reflects their sessions.
  useEffect(() => {
    if (!assignmentId || !assignmentClassroomId) return
    assignmentTimerRef.current = Date.now()
    return () => { assignmentTimerRef.current = null }
  }, [assignmentId, assignmentClassroomId])

  // A teacher who connected Google from inside the assign modal comes back to
  // this same bill carrying ?gassign=1. Record the intent and strip the OAuth
  // params immediately so a refresh doesn't reopen the modal forever.
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    if (params.get('gassign') !== '1') return
    if (params.get('google') === 'error') showToast(googleErrorMessage(params.get('reason')), 'error')
    else gassignPendingRef.current = true
    params.delete('gassign'); params.delete('google'); params.delete('reason')
    const qs = params.toString()
    window.history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : ''))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Open it only once auth has actually rehydrated. Supabase restores the
  // session asynchronously after the OAuth redirect, so opening on mount raced
  // it and greeted the returning teacher with "Please sign in again" — and it
  // popped the modal for anonymous visitors who happened to hit the URL.
  useEffect(() => {
    if (!gassignPendingRef.current || !user) return
    gassignPendingRef.current = false
    setShowGoogleAssign(true)
  }, [user])

  // Same time-on-task timer for the Google Classroom (?gcr=) flow.
  useEffect(() => {
    if (!gcrAssignmentId) return
    assignmentTimerRef.current = Date.now()
    return () => { assignmentTimerRef.current = null }
  }, [gcrAssignmentId])

  // Auto-submit a Google Classroom assignment for credit once the student has
  // received the bill (their personalization loaded, or the page settled with no
  // profile). No "I'm done" click required — fires once per visit.
  useEffect(() => {
    if (!gcrAssignmentId || !user || gcrCompleted || gcrBusy || gcrAutoRef.current) return
    const received = analysis || (!loading && (personalizationError || noProfile))
    if (!received) return
    gcrAutoRef.current = true
    handleGcrComplete()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gcrAssignmentId, user, analysis, loading, personalizationError, noProfile, gcrCompleted])

  // Close assign dropdown on outside click
  useEffect(() => {
    if (!assignOpen) return
    function handleClick(e) {
      if (assignRef.current && !assignRef.current.contains(e.target)) {
        setAssignOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [assignOpen])

  async function handleAssignOpen() {
    if (assignOpen) { setAssignOpen(false); return }
    setAssignLoading(true)
    setAssignOpen(true)
    try {
      const session = await supabase?.auth.getSession()
      const token = session?.data?.session?.access_token
      if (!token) { setAssignLoading(false); return }
      const rooms = await getMyClassrooms(token)
      // Only show classrooms where user is a teacher
      setAssignClassrooms(rooms.filter(r => r.role === 'teacher'))
    } catch {
      setAssignClassrooms([])
    }
    setAssignLoading(false)
  }

  async function handleAssignToClassroom(classroom) {
    const session = await supabase?.auth.getSession()
    const token = session?.data?.session?.access_token
    if (!token) return
    const billId = bill?.legiscan_bill_id
      ? makeBillId(bill)
      : makeCongressBillId(type, number, congress)
    try {
      await createAssignment(token, classroom.id, {
        billId,
        billData: { ...bill, analysis },
      })
      showToast(`Assigned to ${classroom.name}`)
      setAssignOpen(false)
    } catch (err) {
      showToast(err.message || 'Failed to assign', 'error')
    }
  }

  // Load the full bill text from our own storage (bill_text_cache + bills
  // table populated by our scrapers). If we don't have it locally, we'll
  // surface a fallback CTA pointing at the authoritative source on
  // Congress.gov or the state legislature. This keeps the reading flow in the
  // app instead of bouncing users out to a third-party site.
  async function handleOpenFullText() {
    if (fullText || fullTextUnavailable) {
      setFullTextOpen(true)
      return
    }
    setFullTextOpen(true)
    setFullTextLoading(true)
    setFullTextUnavailable(false)
    try {
      const legiscanId = bill?.legiscan_bill_id
        || new URLSearchParams(window.location.search).get('legiscan_id')
        || ''
      const url = legiscanId
        ? `${API_BASE}/api/bill/${congress}/${type}/${number}/text?legiscan_id=${legiscanId}`
        : `${API_BASE}/api/bill/${congress}/${type}/${number}/text`
      const resp = await fetch(url, { signal: AbortSignal.timeout(15000) })
      if (resp.ok) {
        const data = await resp.json()
        if (data?.text) {
          setFullText({ text: data.text, wordCount: data.wordCount || 0, version: data.version || '' })
        } else {
          setFullTextUnavailable(true)
        }
      } else {
        // 404 = no local text available; anything else = transient. Either way
        // we surface the external link as the fallback.
        setFullTextUnavailable(true)
      }
    } catch {
      setFullTextUnavailable(true)
    } finally {
      setFullTextLoading(false)
    }
  }

  async function handleMarkComplete() {
    if (!assignmentId || !assignmentClassroomId || assignmentCompleted || markCompleteBusy) return
    setMarkCompleteBusy(true)
    try {
      const elapsed = assignmentTimerRef.current
        ? Math.round((Date.now() - assignmentTimerRef.current) / 1000)
        : null
      if (user) {
        const session = await getSessionSafe()
        const token = session?.access_token
        if (!token) {
          showToast('Please sign in to mark this complete', 'error')
          return
        }
        await markComplete(token, assignmentClassroomId, assignmentId, elapsed)
      } else {
        // Anonymous student: the join-anon flow already created a member row
        // keyed on the localStorage anonymous_id, so the server can attribute
        // this completion back to the teacher's roster.
        await markCompleteAnon(assignmentClassroomId, assignmentId, elapsed)
      }
      setAssignmentCompleted(true)
      showToast('Assignment marked done — your teacher can see it')
    } catch (err) {
      showToast(err.message || 'Could not mark assignment done', 'error')
    } finally {
      setMarkCompleteBusy(false)
    }
  }

  // Student arrived from a Google Classroom assignment link and isn't signed in
  // yet. Stash where they are so we can bring them back after the one-tap Google
  // sign-in (which redirects to the app root).
  async function handleGoogleSignInForCredit() {
    try { sessionStorage.setItem('ck_return_to', location.pathname + location.search) } catch {}
    await signInWithGoogle()
  }

  async function handleGcrComplete() {
    if (!gcrAssignmentId || gcrBusy || gcrCompleted) return
    setGcrBusy(true)
    setGcrError(false)
    try {
      const session = await getSessionSafe()
      const token = session?.access_token
      if (!token) { showToast('Please sign in first', 'error'); setGcrBusy(false); return }
      const elapsed = assignmentTimerRef.current
        ? Math.round((Date.now() - assignmentTimerRef.current) / 1000)
        : null
      const res = await completeGoogleAssignment(token, gcrAssignmentId, elapsed)
      setGcrCompleted(true)
      if (res.graded) {
        setGcrGradeNote('')
        setGcrNeedsSchoolAccount(false)
        showToast('Submitted! Your grade is in Google Classroom.')
      } else {
        // "Your grade will sync shortly" was a lie when the real problem was a
        // personal Gmail that isn't on the class roster — nothing would ever
        // sync. Say which case it is, and keep it on screen rather than in a
        // toast the student can miss.
        const note = gradeReasonMessage(res.gradeReason)
        setGcrGradeNote(note)
        setGcrNeedsSchoolAccount(!!res.studentActionable)
        showToast(note, res.studentActionable ? 'error' : 'success')
      }
    } catch (err) {
      setGcrError(true)
      showToast(err.message || 'Could not submit for credit', 'error')
    } finally {
      setGcrBusy(false)
    }
  }

  // Fetch bill detail when route params change. Guarded by a cancelled flag
  // so that if the user navigates away (or to a different bill) mid-fetch we
  // drop the stale response on the floor instead of calling setState on an
  // unmounted component or overwriting the new bill's data.
  useEffect(() => {
    let cancelled = false
    async function run() {
      setLoading(true)
      try {
        let url
        if (isStateRoute) {
          // State bills resolve from the path alone (no legiscan_id needed).
          url = `${API_BASE}/api/state-bill/${state}/${type}/${number}`
            + (session ? `?session=${encodeURIComponent(session)}` : '')
        } else {
          const legiscanId = passedBill?.legiscan_bill_id
            || new URLSearchParams(window.location.search).get('legiscan_id')
            || ''
          url = legiscanId
            ? `${API_BASE}/api/bill/${congress}/${type}/${number}?legiscan_id=${legiscanId}`
            : `${API_BASE}/api/bill/${congress}/${type}/${number}`
        }
        const resp = await fetch(url)
        if (cancelled) return
        if (resp.ok) {
          const data = await resp.json()
          if (cancelled) return
          setDetail(data.bill || data)
          if (!bill && data.bill) {
            setBill({
              congress: data.bill.congress,
              type: data.bill.type,
              number: data.bill.number,
              title: data.bill.title,
              originChamber: data.bill.originChamber,
              latestAction: data.bill.latestAction?.text || 'No recent action',
              latestActionDate: data.bill.latestAction?.actionDate || '',
              url: data.bill.url,
              legiscan_bill_id: data.bill.legiscan_bill_id,
              state: data.bill.state,
              session: data.bill.session,
              isStateBill: data.bill.state && data.bill.state !== 'US',
            })
          }
        } else {
          setError('Could not load bill details.')
        }
      } catch {
        if (!cancelled) setError('Network error loading bill details.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [congress, type, number, state, session])

  // Re-fetch personalization once bill data loads. Same cancellation pattern
  // so a pending Bill A request can't overwrite Bill B's analysis after
  // navigation.
  useEffect(() => {
    if (!bill || analysis) return
    let cancelled = false
    // Abort if the loaded bill doesn't match the current route — can happen
    // mid-navigation before the route-param effect has reset bill state.
    // Compare on the Congress (type/number/congress) axis, not makeBillId,
    // because LegiScan-backed bills return `ls-<id>` from makeBillId while
    // the route only carries Congress params — they'd never match and the
    // fetch would silently never fire. This used to strand classroom
    // students on an endless "Personalizing this bill for you..." spinner.
    const billCongressId = makeCongressBillId(
      bill.type ?? bill.bill_type,
      bill.number ?? bill.bill_number,
      bill.congress,
    )
    const currentRouteId = makeCongressBillId(type, number, congress)
    if (!sameBillId(billCongressId, currentRouteId)) return
    if (requestedRef.current === currentRouteId) return

    // Nothing usable cached and auth hasn't settled yet: wait. Declaring "no
    // profile" while `user` is still null would prompt a signed-in student to
    // build the profile they already have. The effect re-runs when authLoading
    // flips.
    if (!isPersonalizable(readCachedProfile()) && authLoading) return

    async function run() {
      const profile = await resolveProfile(user, isPersonalizable)
      if (cancelled) return
      if (!profile) { setNoProfile(true); return }
      setNoProfile(false)
      // Mark only once we're actually going to POST, so a run that ended in
      // the profile prompt can still re-check after the student signs in.
      requestedRef.current = currentRouteId
      setPersonalizationError(false)
      try {
        const resp = await fetch(`${API_BASE}/api/personalize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bill, profile }),
          signal: AbortSignal.timeout(30000),
        })
        if (cancelled) return
        if (resp.ok) {
          const data = await resp.json()
          if (cancelled) return
          if (data.analysis) setAnalysis(data.analysis)
          else setPersonalizationError(true)
        } else {
          setPersonalizationError(true)
        }
      } catch {
        if (!cancelled) setPersonalizationError(true)
      }
    }
    run()
    return () => { cancelled = true }
  }, [bill, analysis, congress, type, number, user, authLoading])

  // Manual retry handler used by the "Try again" button in the UI.
  async function retryPersonalization() {
    if (!bill) return
    const profile = await resolveProfile(user, isPersonalizable)
    if (!profile) { setNoProfile(true); return }
    setNoProfile(false)
    setPersonalizationError(false)
    try {
      const resp = await fetch(`${API_BASE}/api/personalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bill, profile }),
        signal: AbortSignal.timeout(30000),
      })
      if (resp.ok) {
        const data = await resp.json()
        if (data.analysis) setAnalysis(data.analysis)
        else setPersonalizationError(true)
      } else {
        setPersonalizationError(true)
      }
    } catch {
      setPersonalizationError(true)
    }
  }

  // Mobile resilience: if the app was backgrounded while a personalization
  // request was in-flight, the JS execution pauses and the response may be
  // lost. On resume, retry if we still have no analysis and no error.
  useEffect(() => {
    function onResume() {
      if (!bill || analysis || personalizationError || noProfile) return
      retryPersonalization()
    }
    window.addEventListener('ck:app-resumed', onResume)
    return () => window.removeEventListener('ck:app-resumed', onResume)
  }, [bill, analysis, personalizationError, noProfile])

  const tagColor = TAG_COLORS[analysis?.topic_tag] || 'gray'
  const displayTitle = bill?.title || detail?.title || `${type.toUpperCase()} ${number}`

  // Sponsors. The API now returns a display-ready `name` plus the pieces that
  // identify the seat, so the page no longer stitches a name out of
  // firstName/lastName and renders "(D-)" when the source has no state on the
  // record — or, on federal bills, shows nothing at all because we never asked
  // Congress.gov for the sponsor in the first place.
  const allSponsors = detail?.sponsors || []
  const leadSponsors = allSponsors.filter(s => s.isPrimary)
  // Older payloads had no isPrimary flag; treat the first entry as the lead.
  const shownSponsors = leadSponsors.length ? leadSponsors : allSponsors.slice(0, 1)
  const sponsorLine = shownSponsors.map(s => {
    const name = s.name || `${s.firstName || ''} ${s.lastName || ''}`.trim()
    if (!name) return ''
    // A committee has no party or district. Federal districts are bare
    // numbers and need the state to mean anything ("CO-3"); state districts
    // already carry their own chamber prefix ("SD-005"), so they stand alone.
    const district = /^\d+$/.test(String(s.district || ''))
      ? [s.state, s.district].filter(Boolean).join('-')
      : (s.district || s.state || '')
    const seat = [s.party, district].filter(Boolean).join('-')
    const title = s.role ? `${s.role}. ` : ''
    return seat ? `${title}${name} (${seat})` : `${title}${name}`
  }).filter(Boolean).join(', ')
  // Build a human-readable bill URL. LegiScan URLs (from passedBill/detail) are
  // already good. The fallback constructs a Congress.gov or LegiScan URL. Filter
  // out any API-style URLs (e.g. api.congress.gov) that aren't meant for users.
  const rawUrl = passedBill?.url || detail?.url || ''
  const isApiUrl = rawUrl.includes('api.congress.gov') || rawUrl.includes('api.legiscan.com')
  const billUrl = (rawUrl && !isApiUrl) ? rawUrl : (
    (passedBill?.isStateBill || bill?.isStateBill)
      // Session year guess for the LegiScan fallback URL (was hardcoded 2026,
      // which would go stale every January). LegiScan redirects to the right
      // session page when the year is close, and detail/url usually wins
      // before this fallback is used at all.
      ? `https://legiscan.com/${passedBill?.state || bill?.state}/bill/${type.toUpperCase()}${number}/${new Date().getFullYear()}`
      // Covers all eight federal types. The old inline ternary treated
      // everything that wasn't s/hr/sjres as a house joint resolution, so
      // every hres, sres, hconres and sconres linked to the wrong document.
      : congressGovUrl(congress, type, number)
        || `https://www.congress.gov/search?q=${encodeURIComponent(`${type.toUpperCase()} ${number}`)}`
  )

  // Where "read the text" links go when we can't serve the text in-app. The
  // bill's landing page is NOT that place: congress.gov opens on the Summary
  // tab and LegiScan on an overview, leaving the student to spot a "Text" tab
  // and click it a second time. The API hands us a URL that opens on the
  // document itself — congress.gov's /text tab federally, and the state
  // legislature's own copy of the bill for state bills.
  const billTextUrl = detail?.textUrl
    || (isStateRoute || passedBill?.isStateBill || bill?.isStateBill
      ? billUrl
      : congressGovTextUrl(congress, type, number) || billUrl)
  const civicActions = analysis?.civic_actions?.filter(action => !isReadBillAction(action)) || []
  const fullTextBlocks = fullText ? formatBillText(fullText.text) : []
  // Congress marks a whole provision as removed; states strike words inside an
  // otherwise current sentence. Both feed the same reader toggle.
  const billTextHasDeletions = fullTextBlocks.some(block => (
    block.deleted || block.runs?.some(run => run.struck)
  ))
  const visibleFullTextBlocks = fullTextBlocks.filter(block => (
    block.type !== 'metadata' && (showDeletedText || !block.deleted)
  ))

  if (loading && !bill) {
    return (
      <main className={styles.page}>
        <div className={styles.container}>
          <div className={styles.skeletonBack} />
          <div className={styles.skeletonHeader}>
            <div className={styles.skeletonTag} />
            <div className={styles.skeletonTitle} />
            <div className={styles.skeletonLine} />
          </div>
          <div className={styles.skeletonAnalysis}>
            <div className={styles.skeletonHeadline} />
            <div className={styles.skeletonBar} />
            <div className={styles.skeletonLine} />
            <div className={styles.skeletonLine} style={{ width: '80%' }} />
            <div className={styles.skeletonLine} style={{ width: '60%' }} />
          </div>
          <div className={styles.skeletonMeta}>
            <div className={styles.skeletonLine} />
            <div className={styles.skeletonLine} style={{ width: '70%' }} />
          </div>
        </div>
      </main>
    )
  }

  if (error && !bill) {
    return (
      <main className={styles.page}>
        <div className={styles.container}>
          <p className={styles.error}>{error}</p>
          <button className={styles.backBtn} onClick={() => navigate(returnTo)}>
            ← Go back
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <button className={styles.backBtn} onClick={() => navigate(returnTo)}>
          ← Back to results
        </button>

        {gcrAssignmentId && (
          <div className={styles.assignmentBanner}>
            <div className={styles.assignmentBannerMain}>
              <span className={styles.assignmentBannerText}>
                {gcrCompleted
                  ? (gcrGradeNote || '✓ Submitted for credit in Google Classroom')
                  : !user
                    ? 'This is your Google Classroom assignment. Sign in with your school Google account to get credit.'
                    : gcrError
                      ? 'We could not submit your credit automatically.'
                      : gcrBusy
                        ? 'Submitting for credit...'
                        : 'This is your Google Classroom assignment. We submit it for credit automatically as you read.'}
              </span>
              {!gcrCompleted && (!user ? (
                <button className={styles.markCompleteBtn} onClick={handleGoogleSignInForCredit}>
                  Sign in with Google
                </button>
              ) : gcrError ? (
                <button
                  className={styles.markCompleteBtn}
                  onClick={handleGcrComplete}
                  disabled={gcrBusy}
                  aria-busy={gcrBusy || undefined}
                >
                  {gcrBusy ? 'Submitting...' : 'Submit for credit'}
                </button>
              ) : null)}
              {/* The one failure the student can fix themselves: they're signed
                  in with an account that isn't on the Google Classroom roster.
                  Re-running Google sign-in lets them pick the school one. */}
              {gcrCompleted && gcrNeedsSchoolAccount && (
                <button className={styles.markCompleteBtn} onClick={handleGoogleSignInForCredit}>
                  Switch Google account
                </button>
              )}
            </div>
          </div>
        )}

        {showGoogleAssign && bill && (
          <GoogleAssignModal
            bill={{
              ...bill,
              type: bill.type ?? type,
              number: bill.number ?? number,
              congress: bill.congress ?? (isStateRoute ? undefined : congress),
              state: bill.state ?? (isStateRoute ? state : undefined),
              session: bill.session ?? session,
            }}
            onClose={() => setShowGoogleAssign(false)}
          />
        )}

        {assignmentId && (
          <div className={styles.assignmentBanner}>
            <div className={styles.assignmentBannerMain}>
              <span className={styles.assignmentBannerText}>
                {assignmentCompleted
                  ? '✓ You finished this assignment'
                  : 'Assigned by your class — mark done when you finish reading'}
              </span>
              {!assignmentCompleted && (
                <button
                  className={styles.markCompleteBtn}
                  onClick={handleMarkComplete}
                  disabled={markCompleteBusy}
                  aria-busy={markCompleteBusy || undefined}
                  title="Tells your teacher you've read the bill"
                >
                  {markCompleteBusy ? 'Saving…' : 'Mark assignment done'}
                </button>
              )}
            </div>
            {assignmentInstructions && (
              <p className={styles.assignmentBannerInstructions}>
                <strong>Your teacher's note:</strong> {assignmentInstructions}
              </p>
            )}
          </div>
        )}

        <div className={styles.header}>
          <div className={styles.headerMeta}>
            {analysis && (
              <span className={`${styles.tag} ${styles[`tag_${tagColor}`]}`}>
                {analysis.topic_tag}
              </span>
            )}
            <span className={styles.billId}>
              {type.toUpperCase()} {number}{bill?.isStateBill ? ` · ${bill.state}` : ` · ${congress}th Congress`}
            </span>
            <span className={styles.chamber}>
              {bill?.originChamber || detail?.originChamber || 'Congress'}
            </span>
          </div>
          <h1 className={styles.title}>{displayTitle}</h1>
          {bill?.latestAction && (
            <p className={styles.action}>
              <strong>Last action:</strong> {bill.latestAction}
              {bill.latestActionDate && <span className={styles.date}> · {bill.latestActionDate}</span>}
            </p>
          )}
        </div>

        {/* Bill progress timeline. LegiScan event IDs → 1..5 dot position.
            Event IDs are not ordinal (6 is Failed, not "after 5"), so the
            mapping is explicit. Vetoed/failed/signed share dot 5 with a
            label that reflects the terminal state. */}
        {stageToDot(detail?.statusStage) > 0 && (() => {
          const current = stageToDot(detail.statusStage)
          const labels = stageLabels(detail.statusStage)
          const eventToStage = {
            1: 1, // Introduced
            9: 2, // Referred to committee
            2: 3, // Engrossed / passed one chamber
            3: 4, // Enrolled / passed both
            4: 4, // Passed
            5: 5, // Vetoed
            6: 5, // Failed
            7: 5, // Override → enacted
            8: 5, // Signed / chaptered
          }
          return (
            <div className={styles.progressSection}>
              <h3 className={styles.progressHeading}>Bill progress</h3>
              <div className={styles.progressBar}>
                {labels.map((label, i) => {
                  const stage = i + 1
                  const reached = current >= stage
                  const isCurrent = current === stage
                  const progressDate = detail.progress?.find(p => eventToStage[p.event] === stage)?.date
                  return (
                    <div key={label} className={`${styles.progressStep} ${reached ? styles.progressReached : ''} ${isCurrent ? styles.progressCurrent : ''}`}>
                      <div className={styles.progressDot} />
                      {i < 4 && <div className={styles.progressLine} />}
                      <span className={styles.progressLabel}>{label}</span>
                      {reached && progressDate && (
                        <span className={styles.progressDate}>{progressDate}</span>
                      )}
                    </div>
                  )
                })}
              </div>

            {detail.history?.length > 0 && (
              <>
                <button
                  className={styles.historyToggle}
                  onClick={() => setHistoryOpen(o => !o)}
                  aria-expanded={historyOpen}
                >
                  {historyOpen ? 'Hide history ↑' : `Show full history (${detail.history.length}) ↓`}
                </button>

                {historyOpen && (
                  <div className={styles.historyTimeline}>
                    {detail.history.slice().reverse().slice(0, 20).map((h, i) => (
                      <div key={i} className={`${styles.historyItem} ${h.importance ? styles.historyMajor : ''}`}>
                        <div className={styles.historyDot} />
                        <div className={styles.historyContent}>
                          <span className={styles.historyDate}>{h.date}{h.chamber ? ` · ${h.chamber}` : ''}</span>
                          <span className={styles.historyAction}>{h.action}</span>
                        </div>
                      </div>
                    ))}
                    {detail.history.length > 20 && (
                      <button
                        className={styles.historyMore}
                        onClick={() => openInAppBrowser(billUrl)}
                      >
                        View all on LegiScan →
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
          )
        })()}

        {/* Personalized analysis */}
        {analysis ? (
          <div className={styles.analysisSection}>
            <div className={`${styles.headline} ${styles[`headline_${tagColor}`]}`}>
              {analysis.headline}
            </div>

            <div className={styles.relevanceRow}>
              <div className={styles.relevanceBar}>
                <div
                  className={styles.relevanceFill}
                  style={{
                    width: `${Math.round((analysis.relevance / 10) * 100)}%`,
                    background: analysis.relevance >= 7 ? '#355c2a' : analysis.relevance >= 4 ? '#6b3d8f' : '#8a7090'
                  }}
                />
              </div>
              <span className={styles.relevanceLabel} style={{
                color: analysis.relevance >= 7 ? '#355c2a' : analysis.relevance >= 4 ? '#6b3d8f' : '#8a7090'
              }}>
                {analysis.relevance >= 7 ? 'Highly relevant' : analysis.relevance >= 4 ? 'Somewhat relevant' : 'Low relevance'}
                {' '}({analysis.relevance}/10)
              </span>
            </div>

            <p className={styles.summary}>{analysis.summary}</p>

            <div className={styles.scenarios}>
              <div className={styles.scenario}>
                <div className={styles.scenarioLabel}>If it passes</div>
                <p>{analysis.if_it_passes}</p>
              </div>
              <div className={styles.scenario}>
                <div className={styles.scenarioLabel}>If it fails</div>
                <p>{analysis.if_it_fails}</p>
              </div>
            </div>

            {civicActions.length > 0 && (
              <div className={styles.actionsSection}>
                <h3 className={styles.actionsHeading}>Take action</h3>
                <div className={styles.actionsGrid}>
                  {civicActions.map((a, i) => {
                    // A "find your rep" link is answered in-app rather than
                    // handed off: we know the student's state, and the panel
                    // can name the actual member from their ZIP. The URL is
                    // dropped from the prose (along with the "at"/"via" that
                    // introduced it) and replaced by the button below.
                    const parts = splitActionText(a.how)
                    const hasFinder = parts.some(p => p.href && isRepFinderUrl(p.href))
                    const shown = hasFinder
                      ? trimDanglingConnector(parts.filter(p => !(p.href && isRepFinderUrl(p.href))))
                      : parts
                    return (
                    <div key={i} className={styles.actionCard}>
                      <div className={styles.actionTitle}>{a.action}</div>
                      <p className={styles.actionHow}>{
                        shown.map((part, j) =>
                          part.href
                            ? <span key={j}><a href={part.href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--amber)', textDecoration: 'underline' }}>{part.text}</a>{part.trailing}</span>
                            : part.text
                        )
                      }</p>
                      <div className={styles.actionMeta}>
                        {hasFinder && (
                          <button className={styles.actionRepBtn} onClick={() => setRepsOpen(true)}>
                            <span>Contact your lawmakers</span>
                            <span aria-hidden="true">→</span>
                          </button>
                        )}
                        {a.time && <span className={styles.actionTime}>~{a.time}</span>}
                      </div>
                    </div>
                    )
                  })}
                </div>
              </div>
            )}

            <div className={styles.sourceAttribution}>
              Powered by AI analysis of {analysis.sources?.length > 0
                ? analysis.sources.join(' and ')
                : 'bill data from our database'}
            </div>
          </div>
        ) : personalizationError ? (
          <div className={styles.loadingAnalysis}>
            <span>Personalization unavailable right now.</span>
            <button
              className={styles.retryBtn}
              onClick={() => retryPersonalization()}
            >
              Try again
            </button>
          </div>
        ) : noProfile ? (
          <div className={styles.loadingAnalysis}>
            <span>Tell us about yourself so we can personalize this bill for you.</span>
            <button
              className={styles.retryBtn}
              onClick={() => navigate('/profile', {
                state: {
                  returnTo: location.pathname,
                  returnState: {
                    bill: bill || passedBill,
                    returnTo,
                    assignment: assignmentId,
                    classroom: assignmentClassroomId,
                    assignmentInstructions,
                  },
                },
              })}
            >
              Complete your profile
            </button>
          </div>
        ) : (
          <div className={styles.loadingAnalysis}>
            <div className={styles.spinner} />
            <span>Personalizing this bill for you...</span>
          </div>
        )}

        {/* One canonical entrance to an immersive document reader. */}
        <section className={styles.billTextSection} aria-labelledby="bill-text-card-heading">
          <span className={styles.billTextIcon} aria-hidden="true">
            <svg viewBox="0 0 24 24" width="24" height="24">
              <path d="M7 3.75h6.6L18 8.15v12.1H7z" />
              <path d="M13.5 3.9v4.4h4.35M9.5 12h6M9.5 15h6" />
            </svg>
          </span>
          <span className={styles.billTextCardCopy}>
            <span className={styles.billTextEyebrow}>Official source document</span>
            <h3 id="bill-text-card-heading" className={styles.billTextHeading}>Read the full bill</h3>
            <span className={styles.billTextDescription}>
              Open a focused, readable copy without leaving CapitolKey.
            </span>
          </span>
          <button
            ref={billTextTriggerRef}
            className={styles.billTextLaunchButton}
            onClick={handleOpenFullText}
            aria-haspopup="dialog"
          >
            <span>Read full text</span>
            <span aria-hidden="true">→</span>
          </button>
        </section>

        {fullTextOpen && (
          <div
            className={styles.billTextBackdrop}
            onMouseDown={event => {
              if (event.target === event.currentTarget) setFullTextOpen(false)
            }}
          >
            <section
              ref={billTextDialogRef}
              className={styles.billTextReader}
              role="dialog"
              aria-modal="true"
              aria-labelledby="bill-text-reader-title"
              aria-describedby="bill-text-reader-description"
            >
              <header className={styles.billTextReaderHeader}>
                <div className={styles.billTextReaderTitleGroup}>
                  <span className={styles.billTextReaderEyebrow}>Official source document</span>
                  <h2 id="bill-text-reader-title">Full bill text</h2>
                  <p id="bill-text-reader-description">
                    {displayTitle} · {type.toUpperCase()} {number}
                  </p>
                </div>
                <div className={styles.billTextReaderActions}>
                  <button
                    className={styles.billTextOriginalButton}
                    onClick={() => openInAppBrowser(billTextUrl)}
                  >
                    Original source ↗
                  </button>
                  <button
                    ref={billTextCloseRef}
                    className={styles.billTextCloseButton}
                    onClick={() => setFullTextOpen(false)}
                    aria-label="Close full bill text reader"
                  >
                    <span>Close</span>
                    <span className={styles.billTextCloseIcon} aria-hidden="true">×</span>
                  </button>
                </div>
              </header>

              <div className={styles.billTextReaderScroll} aria-live="polite">
                {fullText ? (
                  <>
                    <div className={styles.billTextReaderMeta}>
                      <span>{fullText.wordCount.toLocaleString()} words</span>
                      {fullText.version && <span>{fullText.version}</span>}
                    </div>

                    {billTextHasDeletions && (
                      <div className={styles.billTextChangeBar}>
                        <div>
                          <strong>{showDeletedText ? 'Showing amendment changes' : 'Showing the current text'}</strong>
                          <span>
                            {showDeletedText
                              ? 'Removed language appears struck through.'
                              : 'Removed language is hidden for easier reading.'}
                          </span>
                        </div>
                        <button
                          className={styles.billTextChangeButton}
                          onClick={() => setShowDeletedText(show => !show)}
                          aria-pressed={showDeletedText}
                        >
                          {showDeletedText ? 'Hide removed text' : 'Show removed text'}
                        </button>
                      </div>
                    )}

                    <article className={styles.billTextBody}>
                      {visibleFullTextBlocks.map((block, index) => (
                        <BillTextBlock key={index} block={block} showDeleted={showDeletedText} styles={styles} />
                      ))}
                      <footer className={styles.billTextEnd}>End of bill text</footer>
                    </article>
                  </>
                ) : fullTextUnavailable ? (
                  <div className={styles.billTextUnavailable}>
                    <span className={styles.billTextUnavailableIcon} aria-hidden="true">!</span>
                    <h3>We don’t have a readable copy yet</h3>
                    <p>The original source still has the complete bill text.</p>
                    <button onClick={() => openInAppBrowser(billTextUrl)}>
                      Read on the original source ↗
                    </button>
                  </div>
                ) : (
                  <div className={styles.billTextSkeleton}>
                    <div className={styles.spinner} />
                    <div>
                      <strong>Preparing the bill text</strong>
                      <span>This usually takes just a moment.</span>
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>
        )}

        {/* Bill metadata from detail API */}
        {detail && (
          <div className={styles.metaSection}>
            <h3 className={styles.metaHeading}>Bill details</h3>
            <div className={styles.metaGrid}>
              {sponsorLine && (
                <div className={styles.metaItem}>
                  <span className={styles.metaLabel}>
                    {leadSponsors.length > 1 ? 'Sponsors' : 'Sponsor'}
                  </span>
                  <span className={styles.metaValue}>{sponsorLine}</span>
                </div>
              )}
              {detail.cosponsors?.count > 0 && (
                <div className={styles.metaItem}>
                  <span className={styles.metaLabel}>Cosponsors</span>
                  <span className={styles.metaValue}>{detail.cosponsors.count}</span>
                </div>
              )}
              {detail.policyArea?.name && (
                <div className={styles.metaItem}>
                  <span className={styles.metaLabel}>Policy area</span>
                  <span className={styles.metaValue}>{detail.policyArea.name}</span>
                </div>
              )}
              {detail.introducedDate && (
                <div className={styles.metaItem}>
                  <span className={styles.metaLabel}>Introduced</span>
                  <span className={styles.metaValue}>{detail.introducedDate}</span>
                </div>
              )}
              {detail.committees?.count > 0 && (
                <div className={styles.metaItem}>
                  <span className={styles.metaLabel}>Committees</span>
                  <span className={styles.metaValue}>{detail.committees.count} committee(s) assigned</span>
                </div>
              )}
            </div>
          </div>
        )}

        <div className={styles.footer}>
          <div className={styles.footerActions}>
            {user && (
              <button
                className={`${styles.footerBtn} ${bookmarked ? styles.footerBtnActive : ''}`}
                disabled={bookmarkBusy}
                onClick={async () => {
                  if (bookmarkBusy) return
                  setBookmarkBusy(true)
                  try {
                    const bId = bill?.legiscan_bill_id
                      ? makeBillId(bill)
                      : makeCongressBillId(type, number, congress)
                    if (bookmarked) {
                      const ok = await removeBookmark(user.id, bId)
                      if (ok) { setBookmarked(false); showToast('Bookmark removed') }
                      else showToast('Could not remove bookmark', 'error')
                    } else {
                      const ok = await addBookmark(user.id, bId, { bill: { ...bill }, analysis })
                      if (ok) { setBookmarked(true); showToast('Bill saved to bookmarks') }
                      else showToast('Could not save bookmark', 'error')
                    }
                  } finally { setBookmarkBusy(false) }
                }}
              >
                {bookmarked ? '★ Saved' : '☆ Save'}
              </button>
            )}
            <button
              className={styles.footerBtn}
              onClick={async () => {
                const WEB_ORIGIN = 'https://capitolkey.org'
                const origin = window.location.origin.startsWith('capacitor://') ? WEB_ORIGIN : window.location.origin
                // Clean canonical URL: /states/... for state bills, /bill/... for federal.
                const shareSource = bill || { type, number, congress, state, session, isStateBill: isStateRoute }
                const shareUrl = `${origin}${billHref(shareSource, { canonical: true })}`
                const text = `${displayTitle}: ${analysis?.headline || ''}\n${shareUrl}`
                if (navigator.share) {
                  try { await navigator.share({ title: displayTitle, text, url: shareUrl }) } catch {}
                } else {
                  try {
                    await navigator.clipboard.writeText(text)
                    setShareMsg('Link copied!')
                  } catch { setShareMsg('Could not copy') }
                  setTimeout(() => setShareMsg(''), 2000)
                }
              }}
            >
              {shareMsg || 'Share'}
            </button>
            <button
              className={styles.footerBtn}
              onClick={() => setRepsOpen(true)}
            >
              Contact Lawmakers
            </button>
            {user && (
              <div className={styles.assignWrapper} ref={assignRef}>
                <button
                  className={styles.footerBtn}
                  onClick={handleAssignOpen}
                >
                  Assign to Class
                </button>
                {assignOpen && (
                  <div className={styles.assignDropdown}>
                    <button
                      className={styles.assignItem}
                      onClick={() => { setAssignOpen(false); setShowGoogleAssign(true) }}
                    >
                      Assign in Google Classroom
                    </button>
                    {assignLoading ? (
                      <div className={styles.assignItem} style={{ color: 'var(--text-muted)' }}>Loading your classes...</div>
                    ) : assignClassrooms.length > 0 && (
                      assignClassrooms.map(c => (
                        <button
                          key={c.id}
                          className={styles.assignItem}
                          onClick={() => handleAssignToClassroom(c)}
                        >
                          {c.name}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Who votes on this bill, and how to reach them. The bill's own
          sponsors are passed through because on a state bill they're the
          named legislators a student can actually contact about it. */}
      {repsOpen && (
        <RepsPanel
          bill={bill || detail || { type, number, congress, state, isStateBill: isStateRoute }}
          sponsors={allSponsors}
          onClose={() => setRepsOpen(false)}
        />
      )}
    </main>
  )
}
