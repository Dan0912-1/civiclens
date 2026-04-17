import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { loadProfile, saveProfile, getBookmarks, addBookmark, removeBookmark } from '../lib/userProfile'
import { getApiBase } from '../lib/api'
import { trackInteraction, getInteractionSummary, computeLocalSummary, getLocalInteractions, syncLocalInteractions } from '../lib/interactions'
import { supabase, getSessionSafe } from '../lib/supabase'
import { getMyClassrooms, getAssignments, getJoinedClassrooms, peekClassroom } from '../lib/classroom'
import usePullToRefresh from '../hooks/usePullToRefresh'
import BillCard from '../components/BillCard.jsx'
import { makeBillId } from '../lib/billId'
import styles from './Results.module.css'

const API_BASE = getApiBase()
const BILLS_PER_PAGE = 3

export default function Results() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [profile, setProfile] = useState(null)
  const [bills, setBills] = useState([])
  const [analyses, setAnalyses] = useState({}) // billId → analysis
  const [loadingBills, setLoadingBills] = useState(true)
  const [billError, setBillError] = useState('')
  const [activeFilter, setActiveFilter] = useState('All')
  const [settledBills, setSettledBills] = useState(new Set())
  const [failedBills, setFailedBills] = useState(new Set())
  const [bookmarkedIds, setBookmarkedIds] = useState(new Set())
  const [bookmarkBusy, setBookmarkBusy] = useState(false)
  const [interactionSummary, setInteractionSummary] = useState(null)
  const [visibleCount, setVisibleCount] = useState(BILLS_PER_PAGE)
  const [activeTab, setActiveTab] = useState('federal') // 'federal' or 'state'
  // Backend may return _meta when the personalized pipeline fell back to a
  // broader query or when external sources failed entirely. Drives the
  // banner + empty-state copy below.
  const [billsMeta, setBillsMeta] = useState(null)
  const prevUserRef = useRef(null)

  const { refreshing, pullProgress } = usePullToRefresh(
    useCallback(async () => {
      if (profile) await fetchBills()
    }, [profile])
  )

  // Load profile — try Supabase first for logged-in users, fall back to sessionStorage
  useEffect(() => {
    async function load() {
      if (user) {
        const cloud = await loadProfile(user.id)
        if (cloud) {
          sessionStorage.setItem('civicProfile', JSON.stringify(cloud))
          setProfile(cloud)
          return
        }
        // No cloud profile — check sessionStorage and sync it to Supabase
        const stored = sessionStorage.getItem('civicProfile')
        if (stored) {
          let localProfile
          try { localProfile = JSON.parse(stored) } catch { navigate('/profile'); return }
          setProfile(localProfile)
          // Save local profile to Supabase so it persists across sessions
          saveProfile(user.id, localProfile)
          return
        }
        // No profile anywhere — send to profile setup
        navigate('/profile')
        return
      }
      const stored = sessionStorage.getItem('civicProfile')
      if (!stored) {
        navigate('/profile')
        return
      }
      try { setProfile(JSON.parse(stored)) } catch { navigate('/profile'); return }
    }
    load()
  }, [navigate, user])

  // Fetch interaction summary and sync local interactions on login
  useEffect(() => {
    async function loadInteractions() {
      if (user && supabase) {
        // Sync local interactions to server if user just logged in
        if (!prevUserRef.current) {
          const session = await getSessionSafe()
          if (session?.access_token) {
            await syncLocalInteractions(user.id, session.access_token)
            const summary = await getInteractionSummary(session.access_token)
            if (summary) setInteractionSummary(summary)
          }
        }
      } else {
        // Anonymous: compute locally
        const local = getLocalInteractions()
        if (local.length) setInteractionSummary(computeLocalSummary(local))
      }
      prevUserRef.current = user
    }
    loadInteractions()
  }, [user])

  // Load bookmarks for logged-in users
  useEffect(() => {
    if (!user) return
    getBookmarks(user.id).then(bm => setBookmarkedIds(new Set(bm.map(b => b.bill_id))))
  }, [user])

  // Load pending classroom assignments for students (logged-in or anonymous)
  const [pendingAssignments, setPendingAssignments] = useState([])
  useEffect(() => {
    async function loadAssignments() {
      const allAssignments = []

      // Logged-in: fetch from server
      if (user) {
        const session = await supabase?.auth.getSession()
        const token = session?.data?.session?.access_token
        if (token) {
          const classrooms = await getMyClassrooms(token)
          const studentClasses = classrooms.filter(c => c.role === 'student')
          for (const cls of studentClasses) {
            const assignments = await getAssignments(token, cls.id)
            for (const a of assignments) {
              if (!a.completed) allAssignments.push({ ...a, classroomName: cls.name, classroomId: cls.id })
            }
          }
        }
      }

      // Anonymous: fetch from sessionStorage codes via peek
      const localJoined = getJoinedClassrooms()
      for (const cls of localJoined) {
        try {
          const data = await peekClassroom(cls.code)
          for (const a of (data.assignments || [])) {
            allAssignments.push({ ...a, classroomName: cls.name, classroomId: cls.classroomId })
          }
        } catch {}
      }

      setPendingAssignments(allAssignments)
    }
    loadAssignments()
  }, [user])

  // Fetch bills when profile is ready. Also re-fetch once the interaction
  // summary loads so the interest-weighted ranking uses the user's click
  // history on the first render (otherwise new logins see generic ranking
  // until their next pull-to-refresh).
  //
  // Uses a cancelled flag to prevent a stale fetchBills() (triggered when
  // profile loads first) from corrupting state after a newer fetchBills()
  // starts (triggered when interactionSummary arrives).
  useEffect(() => {
    if (!profile) return
    let cancelled = false
    fetchBills({ cancelled: () => cancelled })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, interactionSummary])

  // Personalize a batch of bills in a single API call (all Claude calls run in parallel server-side).
  // Auto-retries any failed bills once to recover from transient errors before surfacing failure to the user.
  // Accepts an optional `isCancelled` function; when it returns true, state updates are skipped to
  // prevent a stale request from corrupting the current render cycle.
  async function personalizeBillsBatch(billsToPersonalize, { isCancelled } = {}) {
    if (!billsToPersonalize.length) return

    // One attempt against the batch endpoint. Returns { ok: Set<billId>, failed: Bill[] }.
    const attempt = async (bills) => {
      const ok = new Set()
      const failed = []
      try {
        const resp = await fetch(`${API_BASE}/api/personalize-batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bills, profile }),
          signal: AbortSignal.timeout(60000),
        })
        const data = await resp.json().catch(() => ({}))
        if (!resp.ok) throw new Error(data.error || `Server error ${resp.status}`)

        if (data.results) {
          if (isCancelled?.()) return { ok, failed: bills }
          setAnalyses(prev => {
            const next = { ...prev }
            for (const [billId, result] of Object.entries(data.results)) {
              if (result?.analysis) {
                next[billId] = result.analysis
                ok.add(billId)
              }
            }
            return next
          })
          // Make sure ok set reflects results even if state batching delayed
          for (const [billId, result] of Object.entries(data.results)) {
            if (result?.analysis) ok.add(billId)
          }
        }

        // Anything reported as error OR missing from results = failed
        for (const b of bills) {
          const id = makeBillId(b)
          if (!ok.has(id)) failed.push(b)
        }
      } catch (err) {
        console.error('Batch personalization request failed:', err)
        // Whole request failed — every bill in this attempt is failed
        for (const b of bills) failed.push(b)
      }
      return { ok, failed }
    }

    // First attempt
    let { ok: okFirst, failed } = await attempt(billsToPersonalize)
    if (isCancelled?.()) return

    // Mark successes as settled immediately so the UI can render them
    if (okFirst.size) {
      setSettledBills(prev => {
        const next = new Set(prev)
        okFirst.forEach(id => next.add(id))
        return next
      })
    }

    // Client-side retry pass for any bills that failed (server already retries 4x;
    // this catches network blips, cold-starts, and partial failures)
    if (failed.length) {
      if (import.meta.env.DEV) {
        console.log(`[personalize] retrying ${failed.length} failed bill(s) client-side`)
      }
      await new Promise(r => setTimeout(r, 1500))
      if (isCancelled?.()) return
      const second = await attempt(failed)
      if (isCancelled?.()) return

      if (second.ok.size) {
        setSettledBills(prev => {
          const next = new Set(prev)
          second.ok.forEach(id => next.add(id))
          return next
        })
      }

      // Anything still failing after retry → mark as failed + settled
      if (second.failed.length) {
        const stillFailedIds = second.failed.map(makeBillId)
        setFailedBills(prev => {
          const next = new Set(prev)
          stillFailedIds.forEach(id => next.add(id))
          return next
        })
        setSettledBills(prev => {
          const next = new Set(prev)
          stillFailedIds.forEach(id => next.add(id))
          return next
        })
      }
    }
  }

  async function fetchBills({ cancelled } = {}) {
    const isCancelled = cancelled ?? (() => false)
    setLoadingBills(true)
    setBillError('')
    setBillsMeta(null)
    setSettledBills(new Set())
    setFailedBills(new Set())
    setVisibleCount(BILLS_PER_PAGE)
    try {
      const body = {
        interests: profile.interests,
        grade: profile.grade,
        state: profile.state,
        subInterests: profile.subInterests || [],
        career: profile.career || '',
      }
      if (interactionSummary && interactionSummary.totalInteractions > 0) {
        body.interactionSummary = interactionSummary
      }
      const headers = { 'Content-Type': 'application/json' }
      // Pass auth token so backend can score bills using interaction history
      const session = supabase ? await getSessionSafe() : null
      if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`

      const resp = await fetch(`${API_BASE}/api/legislation`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      })
      if (isCancelled()) return
      const data = await resp.json()
      if (isCancelled()) return
      if (data.bills) {
        setBills(data.bills)
        setBillsMeta(data._meta || null)

        // Two-wave personalization: render the first 3 federal + first 3 state
        // bills as quickly as possible, then personalize the next 3 per
        // category in a second request. Anything beyond that trickles in as
        // a third wave. The server returns federal bills first (indexes 0-5)
        // followed by state bills (indexes 6-11), so slicing by index gives
        // us the top N per category without re-filtering.
        const federal = data.bills.filter(b => !b.isStateBill)
        const stateBills = data.bills.filter(b => b.isStateBill)

        const wave1 = [...federal.slice(0, 3), ...stateBills.slice(0, 3)]
        const wave2 = [...federal.slice(3, 6), ...stateBills.slice(3, 6)]
        const wave3 = [...federal.slice(6),    ...stateBills.slice(6)]

        // Fire wave 1 immediately. Once it resolves the first 6 cards settle
        // and the user sees content; then wave 2 (and any tail) runs
        // sequentially so the server's concurrency pool isn't split between
        // waves and the first batch isn't slowed down by the second.
        // Each wave checks cancellation before starting.
        ;(async () => {
          if (wave1.length && !isCancelled()) await personalizeBillsBatch(wave1, { isCancelled })
          if (wave2.length && !isCancelled()) await personalizeBillsBatch(wave2, { isCancelled })
          if (wave3.length && !isCancelled()) await personalizeBillsBatch(wave3, { isCancelled })
        })()
      } else {
        setBillError('Could not load bills. Please try again.')
      }
    } catch (err) {
      if (!isCancelled()) {
        setBillError('Unable to connect. Please check your internet connection and try again.')
      }
    } finally {
      if (!isCancelled()) {
        setLoadingBills(false)
      }
    }
  }

  function handleLoadMore() {
    setVisibleCount(prev => prev + BILLS_PER_PAGE)
  }

  const handleTrackInteraction = useCallback(async ({ billId, actionType, topicTag }) => {
    let token = null
    if (user && supabase) {
      const session = await getSessionSafe()
      token = session?.access_token
    }
    trackInteraction(user?.id, token, { billId, actionType, topicTag })
  }, [user])

  async function toggleBookmark(billId, bill, analysis) {
    if (!user || bookmarkBusy) return
    setBookmarkBusy(true)
    try {
      if (bookmarkedIds.has(billId)) {
        setBookmarkedIds(prev => { const next = new Set(prev); next.delete(billId); return next })
        const ok = await removeBookmark(user.id, billId)
        if (!ok) setBookmarkedIds(prev => new Set(prev).add(billId))
      } else {
        setBookmarkedIds(prev => new Set(prev).add(billId))
        const ok = await addBookmark(user.id, billId, { bill, analysis })
        if (!ok) setBookmarkedIds(prev => { const next = new Set(prev); next.delete(billId); return next })
      }
    } finally { setBookmarkBusy(false) }
  }

  // Collect all topic tags for filter bar
  const topicTags = useMemo(() => ['All', ...new Set(
    Object.values(analyses).map(a => a.topic_tag).filter(Boolean)
  )], [analyses])

  const allFilteredBills = useMemo(() => {
    // First filter by tab (federal vs state)
    let tabFiltered = bills.filter(b =>
      activeTab === 'federal' ? !b.isStateBill : b.isStateBill
    )
    // Then filter by topic tag
    const filtered = activeFilter === 'All'
      ? tabFiltered
      : tabFiltered.filter(b => {
          const id = makeBillId(b)
          return analyses[id]?.topic_tag === activeFilter
        })
    // Blend backend rankScore (algorithm) with Groq relevance (AI) for final ordering
    // When relevance is available: 50% algorithm + 50% AI relevance (normalized to 0-1)
    // When not yet personalized: fall back to algorithm score alone
    return [...filtered].sort((a, b) => {
      const relA = analyses[makeBillId(a)]?.relevance
      const relB = analyses[makeBillId(b)]?.relevance
      const algA = a.rankScore ?? 0.5
      const algB = b.rankScore ?? 0.5
      const scoreA = relA != null ? (algA * 0.5) + ((relA / 10) * 0.5) : algA
      const scoreB = relB != null ? (algB * 0.5) + ((relB / 10) * 0.5) : algB
      return scoreB - scoreA
    })
  }, [activeTab, activeFilter, bills, analyses])

  const filteredBills = useMemo(() =>
    allFilteredBills.slice(0, visibleCount)
  , [allFilteredBills, visibleCount])

  const hasMore = allFilteredBills.length > visibleCount

  if (!profile) return null

  return (
    <main className={styles.page}>
      {/* Pull-to-refresh indicator */}
      {(pullProgress > 0 || refreshing) && (
        <div className={styles.pullIndicator} style={{ opacity: refreshing ? 1 : pullProgress }}>
          <div className={refreshing ? styles.pullSpinnerActive : styles.pullSpinner}
               style={refreshing ? {} : { transform: `rotate(${pullProgress * 360}deg)` }} />
        </div>
      )}
      <div className={styles.container}>

        {/* Header */}
        <div className={styles.header}>
          <div className={styles.profilePill}>
            📍 {profile.state} · Age {profile.grade}
            {profile.hasJob ? ' · Works' : ''}
          </div>
          <h1 className={styles.heading}>Your Legislation</h1>
          <p className={styles.subhead}>
            Real bills, explained for your life.
          </p>
          <button className={styles.editBtn} onClick={() => navigate('/profile')}>
            ← Edit my profile
          </button>
        </div>

        {/* Classroom assignments */}
        {pendingAssignments.length > 0 && (
          <div className={styles.assignmentsSection}>
            <div className={styles.assignmentsHeader}>
              <span className={styles.assignmentsLabel}>Assigned to You</span>
              <span className={styles.assignmentsCount}>{pendingAssignments.length}</span>
            </div>
            <div className={styles.assignmentsList}>
              {pendingAssignments.map(a => {
                const bd = a.bill_data || {}
                const congress = bd.congress
                const billType = (bd.type || bd.bill_type || '').toLowerCase()
                const billNum = bd.number || bd.bill_number
                return (
                  <button
                    key={a.id}
                    className={styles.assignmentItem}
                    onClick={() => {
                      if (congress && billType && billNum) {
                        const legiscanParam = bd.legiscan_bill_id ? `?legiscan_id=${bd.legiscan_bill_id}` : ''
                        const { analysis: _tAnalysis, ...billOnly } = bd
                        navigate(`/bill/${congress}/${billType}/${billNum}${legiscanParam}`, {
                          state: { bill: billOnly, assignment: a.id, classroom: a.classroomId }
                        })
                      }
                    }}
                  >
                    <span className={styles.assignmentBillNum}>
                      {bd.type || bd.bill_type} {bd.number || bd.bill_number}
                    </span>
                    <span className={styles.assignmentTitle}>
                      {(bd.title || a.bill_id).slice(0, 80)}
                    </span>
                    <span className={styles.assignmentClass}>{a.classroomName}</span>
                    {a.due_date && (
                      <span className={styles.assignmentDue}>
                        Due {new Date(a.due_date + 'T00:00').toLocaleDateString()}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Federal / State tab switcher */}
        <div className={styles.tabBar}>
          <button
            className={`${styles.tab} ${activeTab === 'federal' ? styles.tabActive : ''}`}
            onClick={() => { setActiveTab('federal'); setVisibleCount(BILLS_PER_PAGE); setActiveFilter('All') }}
          >
            Federal
          </button>
          <button
            className={`${styles.tab} ${activeTab === 'state' ? styles.tabActive : ''}`}
            onClick={() => { setActiveTab('state'); setVisibleCount(BILLS_PER_PAGE); setActiveFilter('All') }}
          >
            {profile.state || 'State'}
          </button>
        </div>

        {/* Filter bar */}
        {topicTags.length > 1 && (
          <div className={styles.filterBar}>
            {topicTags.map(tag => (
              <button
                key={tag}
                className={`${styles.filterBtn} ${activeFilter === tag ? styles.filterActive : ''}`}
                onClick={() => setActiveFilter(tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        )}

        {/* Loading state */}
        {loadingBills && (
          <div className={styles.loadingGrid}>
            {[...Array(3)].map((_, i) => (
              <div key={i} className={styles.skeleton} style={{ animationDelay: `${i * 0.1}s` }} />
            ))}
          </div>
        )}

        {/* Error */}
        {billError && (
          <div className={styles.error}>
            <p>{billError}</p>
            <button className={styles.retryBtn} onClick={fetchBills}>Try again</button>
          </div>
        )}

        {/* Fallback / degraded banner — surfaces when the personalized pipeline
            fell back to broader results or when external sources failed. */}
        {!loadingBills && !billError && billsMeta?.fallback && (
          <div className={styles.fallbackBanner} role="status">
            <strong>Showing general legislation.</strong>{' '}
            {billsMeta.reason || 'Personalized matches were unavailable for your filters.'}
          </div>
        )}

        {/* Bill cards */}
        {!loadingBills && !billError && (
          <>
            <div className={styles.meta}>
              Showing {filteredBills.length} of {allFilteredBills.length} bill{allFilteredBills.length !== 1 ? 's' : ''}
              {bills.some(b => !settledBills.has(makeBillId(b))) && (
                <span className={styles.analyzing}> · Personalizing remaining bills...</span>
              )}
            </div>
            <div className={styles.grid}>
              {filteredBills.map((bill, i) => {
                const billId = makeBillId(bill)
                return (
                  <BillCard
                    key={billId}
                    bill={bill}
                    analysis={analyses[billId] || null}
                    personalizationFailed={failedBills.has(billId)}
                    onPersonalize={failedBills.has(billId) ? () => {
                      setFailedBills(prev => { const next = new Set(prev); next.delete(billId); return next })
                      setSettledBills(prev => { const next = new Set(prev); next.delete(billId); return next })
                      personalizeBillsBatch([bill])
                    } : undefined}
                    isBookmarked={bookmarkedIds.has(billId)}
                    onToggleBookmark={() => toggleBookmark(billId, bill, analyses[billId])}
                    onTrackInteraction={handleTrackInteraction}
                    style={{ animationDelay: `${i * 0.08}s` }}
                  />
                )
              })}
            </div>
            {hasMore && (
              <div className={styles.loadMoreWrap}>
                <button className={styles.loadMoreBtn} onClick={handleLoadMore}>
                  {`Show more bills (${allFilteredBills.length - visibleCount} remaining)`}
                </button>
              </div>
            )}
          </>
        )}

        {/* Empty state — three flavors:
            1. Service degraded (external sources failed) → show retry
            2. Topic filter narrowed everything out → suggest reset to "All"
            3. Nothing in this tab at all → suggest the other tab           */}
        {!loadingBills && !billError && filteredBills.length === 0 && (
          <div className={styles.empty}>
            {billsMeta?.degraded ? (
              <>
                <p><strong>Bill data is temporarily unavailable.</strong></p>
                <p>{billsMeta.reason || 'Our data sources are not responding right now.'}</p>
                <button className={styles.retryBtn} onClick={() => fetchBills()}>Try again</button>
              </>
            ) : activeFilter !== 'All' ? (
              <>
                <p>No <strong>{activeFilter}</strong> bills in this view.</p>
                <button className={styles.retryBtn} onClick={() => setActiveFilter('All')}>
                  Show all topics
                </button>
              </>
            ) : allFilteredBills.length === 0 && bills.length > 0 ? (
              <>
                <p>No {activeTab === 'federal' ? 'federal' : (profile.state || 'state')} bills right now.</p>
                <p>Try the {activeTab === 'federal' ? (profile.state || 'state') : 'federal'} tab — your other view has results.</p>
              </>
            ) : (
              <>
                <p>No bills loaded yet.</p>
                <button className={styles.retryBtn} onClick={() => fetchBills()}>Refresh</button>
              </>
            )}
          </div>
        )}

        {/* Footer note */}
        <div className={styles.disclaimer}>
          <strong>CapitolKey is strictly nonpartisan.</strong> We explain impact, not position.
          Bill data from <a href="https://legiscan.com" target="_blank" rel="noopener noreferrer">LegiScan</a>.
          Personalizations generated by AI.
        </div>

      </div>
    </main>
  )
}
