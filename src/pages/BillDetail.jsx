import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase, getSessionSafe } from '../lib/supabase'
import { getApiBase } from '../lib/api'
import { trackInteraction } from '../lib/interactions'
import { addBookmark, removeBookmark, getBookmarks } from '../lib/userProfile'
import { useToast } from '../context/ToastContext'
import { markComplete, getMyClassrooms, createAssignment } from '../lib/classroom'
import { makeBillId, makeCongressBillId, sameBillId } from '../lib/billId'
import { stageToDot, stageLabels } from '../lib/billStage'
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

function isProfileIncomplete() {
  try {
    const stored = sessionStorage.getItem('civicProfile')
    if (!stored) return true
    const profile = JSON.parse(stored)
    return !profile?.state || !profile?.grade || !profile?.interests?.length
  } catch {
    return true
  }
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

export default function BillDetail() {
  const { congress, type, number } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const { showToast } = useToast()
  const trackedRef = useRef(false)

  // Data passed from Results page via router state
  const passedBill = location.state?.bill || null
  const passedAnalysis = location.state?.analysis || null
  const skipPersonalization = location.state?.skipPersonalization || false
  const assignmentId = location.state?.assignment || null
  const assignmentClassroomId = location.state?.classroom || null
  const assignmentInstructions = location.state?.assignmentInstructions || ''

  const [bill, setBill] = useState(passedBill)
  const [analysis, setAnalysis] = useState(passedAnalysis)
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [personalizationError, setPersonalizationError] = useState(false)
  // Read profile completeness synchronously so first paint shows the right
  // branch — otherwise students see "Personalizing..." flash before
  // "Tell us about yourself..." resolves on the next render.
  const [noProfile, setNoProfile] = useState(() => isProfileIncomplete())
  const [historyOpen, setHistoryOpen] = useState(false)
  const [bookmarked, setBookmarked] = useState(false)
  const [bookmarkBusy, setBookmarkBusy] = useState(false)
  const [shareMsg, setShareMsg] = useState('')
  const [assignmentCompleted, setAssignmentCompleted] = useState(false)
  const assignmentTimerRef = useRef(null)
  const [assignOpen, setAssignOpen] = useState(false)
  const [assignClassrooms, setAssignClassrooms] = useState([])
  const [assignLoading, setAssignLoading] = useState(false)
  const assignRef = useRef(null)

  // Reset per-bill state whenever the route params change so navigating from
  // Bill A → Bill B doesn't show stale A data for a frame.
  useEffect(() => {
    trackedRef.current = false
    setAnalysis(passedAnalysis)
    setBill(passedBill)
    setDetail(null)
    setError('')
    setPersonalizationError(false)
    setNoProfile(isProfileIncomplete())
    setShareMsg('')
    setBookmarked(false)
    setBookmarkBusy(false)
    setHistoryOpen(false)
    // intentionally excluding passedBill/passedAnalysis — they're read as
    // initial snapshots, not reactive dependencies. Re-running on route
    // param change is what we want.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [congress, type, number])

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

  // Assignment completion: start timer when page loads with assignment context
  useEffect(() => {
    if (!assignmentId || !assignmentClassroomId || !user) return
    assignmentTimerRef.current = Date.now()
    return () => { assignmentTimerRef.current = null }
  }, [assignmentId, assignmentClassroomId, user])

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

  async function handleMarkComplete() {
    if (!assignmentId || !assignmentClassroomId || !user || assignmentCompleted) return
    const session = await supabase?.auth.getSession()
    const token = session?.data?.session?.access_token
    if (!token) return
    const elapsed = assignmentTimerRef.current ? Math.round((Date.now() - assignmentTimerRef.current) / 1000) : null
    try {
      await markComplete(token, assignmentClassroomId, assignmentId, elapsed)
      setAssignmentCompleted(true)
      showToast('Marked as read!')
    } catch (err) {
      showToast(err.message || 'Could not mark as read', 'error')
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
        const legiscanId = passedBill?.legiscan_bill_id
          || new URLSearchParams(window.location.search).get('legiscan_id')
          || ''
        const url = legiscanId
          ? `${API_BASE}/api/bill/${congress}/${type}/${number}?legiscan_id=${legiscanId}`
          : `${API_BASE}/api/bill/${congress}/${type}/${number}`
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
  }, [congress, type, number])

  // Re-fetch personalization once bill data loads. Same cancellation pattern
  // so a pending Bill A request can't overwrite Bill B's analysis after
  // navigation.
  useEffect(() => {
    if (!bill || analysis || skipPersonalization) return
    let cancelled = false
    // Capture the in-flight bill identity; abort if the route changes.
    const requestBillId = makeBillId(bill)
    const currentRouteId = makeCongressBillId(type, number, congress)
    if (!sameBillId(requestBillId, currentRouteId)) return

    async function run() {
      const stored = sessionStorage.getItem('civicProfile')
      if (!stored) { setNoProfile(true); return }
      let profile
      try { profile = JSON.parse(stored) } catch { setNoProfile(true); return }
      // Require the three questionnaire answers before personalizing.
      // The Google-sign-in seed only has name+email; a half-filled manual
      // profile might have state but no interests. Either case → prompt.
      if (!profile?.state || !profile?.grade || !profile?.interests?.length) {
        setNoProfile(true)
        return
      }
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
  }, [bill, analysis, congress, type, number])

  // Manual retry handler used by the "Try again" button in the UI.
  async function retryPersonalization() {
    const stored = sessionStorage.getItem('civicProfile')
    if (!stored || !bill) return
    setPersonalizationError(false)
    const profile = JSON.parse(stored)
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
  // Build a human-readable bill URL. LegiScan URLs (from passedBill/detail) are
  // already good. The fallback constructs a Congress.gov or LegiScan URL. Filter
  // out any API-style URLs (e.g. api.congress.gov) that aren't meant for users.
  const rawUrl = passedBill?.url || detail?.url || ''
  const isApiUrl = rawUrl.includes('api.congress.gov') || rawUrl.includes('api.legiscan.com')
  const billUrl = (rawUrl && !isApiUrl) ? rawUrl : (
    (passedBill?.isStateBill || bill?.isStateBill)
      ? `https://legiscan.com/${passedBill?.state || bill?.state}/bill/${type.toUpperCase()}${number}/2026`
      : `https://www.congress.gov/bill/${congress}th-congress/${
          type === 's' ? 'senate-bill' : type === 'hr' ? 'house-bill' : type === 'sjres' ? 'senate-joint-resolution' : 'house-joint-resolution'
        }/${number}`
  )

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
          <button className={styles.backBtn} onClick={() => window.history.length > 2 ? navigate(-1) : navigate('/results')}>
            ← Go back
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <button className={styles.backBtn} onClick={() => window.history.length > 2 ? navigate(-1) : navigate('/results')}>
          ← Back to results
        </button>

        {assignmentId && (
          <div className={styles.assignmentBanner}>
            <div className={styles.assignmentBannerMain}>
              <span className={styles.assignmentBannerText}>
                {assignmentCompleted ? 'Assignment completed' : 'Assigned by your class'}
              </span>
              {!assignmentCompleted && user && (
                <button className={styles.markCompleteBtn} onClick={handleMarkComplete}>
                  Mark as Read
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

            {analysis.civic_actions?.length > 0 && (
              <div className={styles.actionsSection}>
                <h3 className={styles.actionsHeading}>Take action</h3>
                <div className={styles.actionsGrid}>
                  {analysis.civic_actions.map((a, i) => (
                    <div key={i} className={styles.actionCard}>
                      <div className={styles.actionTitle}>{a.action}</div>
                      <p className={styles.actionHow}>{
                        a.how.split(/(https?:\/\/[^\s,)]+)/g).map((part, j) =>
                          /^https?:\/\//.test(part)
                            ? <a key={j} href={part} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--amber)', textDecoration: 'underline' }}>{part}</a>
                            : part
                        )
                      }</p>
                      {a.time && <span className={styles.actionTime}>~{a.time}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className={styles.sourceAttribution}>
              Powered by AI analysis of {analysis.sources?.length > 0
                ? analysis.sources.join(' and ')
                : 'bill data from LegiScan'}
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
        ) : noProfile || skipPersonalization ? (
          <div className={styles.loadingAnalysis}>
            <span>Tell us about yourself so we can personalize this bill for you.</span>
            <button
              className={styles.retryBtn}
              onClick={() => navigate('/profile', {
                state: {
                  returnTo: location.pathname,
                  returnState: {
                    bill: bill || passedBill,
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

        {/* Bill metadata from detail API */}
        {detail && (
          <div className={styles.metaSection}>
            <h3 className={styles.metaHeading}>Bill details</h3>
            <div className={styles.metaGrid}>
              {detail.sponsors?.length > 0 && (
                <div className={styles.metaItem}>
                  <span className={styles.metaLabel}>Sponsor</span>
                  <span className={styles.metaValue}>
                    {detail.sponsors.map(s =>
                      `${s.firstName} ${s.lastName} (${s.party}-${s.state})`
                    ).join(', ')}
                  </span>
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
                const shareUrl = `${origin}/bill/${congress}/${type.toLowerCase()}/${number}`
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
                    {assignLoading ? (
                      <div className={styles.assignItem} style={{ color: 'var(--text-muted)' }}>Loading...</div>
                    ) : assignClassrooms.length === 0 ? (
                      <div className={styles.assignItem} style={{ color: 'var(--text-muted)' }}>No classrooms found</div>
                    ) : (
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
          <button
            className={styles.congressLink}
            onClick={() => openInAppBrowser(billUrl)}
          >
            Read full bill text →
          </button>
        </div>
      </div>
    </main>
  )
}
