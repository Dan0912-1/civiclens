import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  getBookmarks, addBookmark, removeBookmark,
  readCachedProfile, resolveProfile,
} from '../lib/userProfile'
import { getApiBase } from '../lib/api'
import { trackInteraction } from '../lib/interactions'
import { supabase, getSessionSafe } from '../lib/supabase'
import BillCard from '../components/BillCard.jsx'
import { makeBillId, stripBillForPersonalize } from '../lib/billId'
import styles from './Search.module.css'

const API_BASE = getApiBase()

const US_STATES = [
  { code: 'AL', name: 'Alabama' }, { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' }, { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' }, { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' }, { code: 'DE', name: 'Delaware' },
  { code: 'FL', name: 'Florida' }, { code: 'GA', name: 'Georgia' },
  { code: 'HI', name: 'Hawaii' }, { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' }, { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' }, { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' }, { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' }, { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' }, { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' }, { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' }, { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' }, { code: 'NV', name: 'Nevada' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' }, { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' }, { code: 'ND', name: 'North Dakota' },
  { code: 'OH', name: 'Ohio' }, { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' }, { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' }, { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' }, { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' }, { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' }, { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' }, { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' }, { code: 'WY', name: 'Wyoming' },
]

const SUGGESTION_CHIPS = [
  'Student Loans',
  'Climate',
  'Healthcare',
  'Gun Policy',
  'Immigration',
  'Education',
]

export default function Search() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { user, loading: authLoading } = useAuth()

  // Seeded synchronously from this tab's cache (the old code read it in a
  // useMemo; the object identity still has to be stable or personalizeBill's
  // memoization breaks). A signed-in student in a fresh tab has no cache, so
  // the effect below fills it in from Supabase — without it, "personalize this
  // result" bounced them to the questionnaire they'd already completed.
  const [profile, setProfile] = useState(readCachedProfile)

  useEffect(() => {
    if (profile || authLoading || !user) return
    let cancelled = false
    resolveProfile(user).then(p => {
      if (!cancelled && p) setProfile(p)
    })
    return () => { cancelled = true }
  }, [profile, authLoading, user])

  const initialQuery = searchParams.get('q') || ''
  const initialTab = searchParams.get('tab') || 'federal'
  const [inputValue, setInputValue] = useState(initialQuery)
  const [bills, setBills] = useState([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [totalResults, setTotalResults] = useState(0)
  const [hasSearched, setHasSearched] = useState(false)

  // Filters
  const [activeTab, setActiveTab] = useState(initialTab)
  const [chamberFilter, setChamberFilter] = useState('All')
  const [selectedState, setSelectedState] = useState(profile?.state || '')

  // Personalization state
  const [analyses, setAnalyses] = useState({})
  const [personalizingBills, setPersonalizingBills] = useState(new Set())
  const [failedBills, setFailedBills] = useState(new Set())
  const [bookmarkedIds, setBookmarkedIds] = useState(new Set())

  useEffect(() => {
    if (!user) return
    getBookmarks(user.id).then(bm => setBookmarkedIds(new Set(bm.map(b => b.bill_id))))
  }, [user])

  // Fetch when URL search param changes
  const activeQuery = searchParams.get('q') || ''
  const activeTabParam = searchParams.get('tab') || 'federal'

  useEffect(() => {
    if (activeTabParam !== activeTab) setActiveTab(activeTabParam)
  }, [activeTabParam])

  // Single AbortController shared by EVERY fetch path (URL-driven effect,
  // load-more, retry, state-select). Each new search aborts the previous one,
  // so a quick state-A → state-B switch can't land A's results last. The
  // effect-only controller used to cover just the URL-driven path.
  const abortRef = useRef(null)

  useEffect(() => {
    if (!activeQuery) return
    if (activeTab === 'state' && !(selectedState || profile?.state)) {
      abortRef.current?.abort()
      setBills([])
      setTotalResults(0)
      setHasMore(false)
      setHasSearched(false)
      setLoading(false)
      return
    }
    setInputValue(activeQuery)
    fetchResults(activeQuery, 1, true, activeTab)
    return () => abortRef.current?.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeQuery, activeTab, selectedState, profile?.state])

  async function fetchResults(query, pageNum, reset = false, tab = activeTab, stateOverride) {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const { signal } = controller

    if (reset) {
      setLoading(true)
      setBills([])
      setPage(1)
      setAnalyses({})
      setPersonalizingBills(new Set())
      setFailedBills(new Set())
    } else {
      setLoadingMore(true)
    }
    setError('')
    setHasSearched(true)

    const stateParam = tab === 'state' ? (stateOverride || selectedState || profile?.state || 'US') : 'US'
    try {
      const resp = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(query)}&page=${pageNum}&state=${stateParam}`, { signal })
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}))
        throw new Error(data.error || 'Search failed')
      }
      const data = await resp.json()
      if (signal.aborted) return
      if (reset) {
        setBills(data.bills || [])
      } else {
        setBills(prev => [...prev, ...(data.bills || [])])
      }
      setPage(pageNum)
      setHasMore(data.pagination?.hasMore || false)
      setTotalResults(data.pagination?.totalResults || 0)
    } catch (err) {
      if (err.name === 'AbortError' || signal.aborted) return
      setError(err.message || 'Unable to search. Please try again.')
    } finally {
      // A superseding search already owns the loading flags — don't let the
      // aborted request clear them mid-flight.
      if (!signal.aborted) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }

  // Client-side chamber filter
  const filteredBills = useMemo(() => {
    if (chamberFilter === 'All') return bills
    return bills.filter(b => b.originChamber === chamberFilter)
  }, [bills, chamberFilter])

  function handleSubmit(e) {
    e.preventDefault()
    const q = inputValue.trim()
    if (!q || q.length < 2) return
    setSearchParams({ q, tab: activeTab })
  }

  function handleTabSwitch(tab) {
    setActiveTab(tab)
    setChamberFilter('All')
    if (activeQuery) {
      setSearchParams({ q: activeQuery, tab })
    }
  }

  function handleChipClick(topic) {
    setInputValue(topic)
    setSearchParams({ q: topic, tab: activeTab })
  }

  function handleLoadMore() {
    if (activeQuery) fetchResults(activeQuery, page + 1, false)
  }

  const personalizeBill = useCallback(async (bill) => {
    // Resolve rather than trusting the render-time value: the student may have
    // tapped before the Supabase fallback landed, and bouncing them to the
    // questionnaire they already filled out is the bug we're fixing.
    const resolved = profile || (authLoading ? null : await resolveProfile(user))
    if (!resolved) {
      navigate('/profile', {
        state: {
          returnTo: `/search?${searchParams.toString()}`,
          returnState: { personalizeBill: stripBillForPersonalize(bill) },
        },
      })
      return
    }
    const billId = makeBillId(bill)
    setPersonalizingBills(prev => new Set(prev).add(billId))

    // Single attempt; returns true if analysis came back successfully
    const attempt = async () => {
      try {
        const resp = await fetch(`${API_BASE}/api/personalize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bill: stripBillForPersonalize(bill), profile: resolved })
        })
        if (!resp.ok) return false
        const data = await resp.json()
        if (data?.analysis) {
          setAnalyses(prev => ({ ...prev, [billId]: data.analysis }))
          return true
        }
        return false
      } catch {
        return false
      }
    }

    try {
      let success = await attempt()
      if (!success) {
        // Client-side retry once after a brief delay (server already retries 4x)
        await new Promise(r => setTimeout(r, 1500))
        success = await attempt()
      }
      if (!success) {
        setFailedBills(prev => new Set(prev).add(billId))
      }
    } finally {
      setPersonalizingBills(prev => {
        const next = new Set(prev)
        next.delete(billId)
        return next
      })
    }
  }, [profile, authLoading, user, navigate, searchParams])

  // Completing a profile resumes the exact action the student initiated.
  // Clear the route state first so rerenders and back/forward navigation
  // cannot accidentally trigger another LLM request.
  const resumedPersonalizationRef = useRef(false)
  useEffect(() => {
    const pendingBill = location.state?.personalizeBill
    if (!pendingBill || !profile || resumedPersonalizationRef.current) return
    resumedPersonalizationRef.current = true
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null })
    personalizeBill(pendingBill)
  }, [location.pathname, location.search, location.state, navigate, personalizeBill, profile])

  const handleTrackInteraction = useCallback(async ({ billId, actionType, topicTag }) => {
    let token = null
    if (user && supabase) {
      const session = await getSessionSafe()
      token = session?.access_token
    }
    trackInteraction(user?.id, token, { billId, actionType, topicTag })
  }, [user])

  // Ref mirror keeps this callback stable (see Results.jsx for rationale —
  // memoized BillCards need stable handler identities).
  const bookmarkedIdsRef = useRef(bookmarkedIds)
  useEffect(() => { bookmarkedIdsRef.current = bookmarkedIds }, [bookmarkedIds])

  const toggleBookmark = useCallback(async (billId, bill, analysis) => {
    if (!user) return
    if (bookmarkedIdsRef.current.has(billId)) {
      setBookmarkedIds(prev => { const next = new Set(prev); next.delete(billId); return next })
      await removeBookmark(user.id, billId)
    } else {
      setBookmarkedIds(prev => new Set(prev).add(billId))
      await addBookmark(user.id, billId, { bill, analysis })
    }
  }, [user])

  const filterLabel = [
    activeTab === 'state'
      ? (US_STATES.find(s => s.code === (selectedState || profile?.state))?.name || 'State')
      : 'Federal',
    chamberFilter !== 'All' ? chamberFilter : null,
  ].filter(Boolean).join(' \u00B7 ')

  return (
    <main className={styles.page}>
      <div className={styles.container}>

        <div className={styles.header}>
          <h1 className={styles.heading}>Search Bills</h1>
          <p className={styles.subhead}>Search federal and state legislation by keyword, topic, or bill number.</p>
        </div>

        {/* Search card */}
        <div className={styles.searchCard}>
          <form className={styles.searchForm} onSubmit={handleSubmit}>
            <div className={styles.searchInputWrap}>
              <svg className={styles.searchIcon} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                className={styles.searchInput}
                type="text"
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                placeholder="Search bills..."
                aria-label="Search bills"
              />
            </div>
            <button
              className={styles.searchBtn}
              type="submit"
              disabled={loading || inputValue.trim().length < 2}
            >
              {loading ? 'Searching...' : 'Search'}
            </button>
          </form>
          <p className={styles.searchHint}>
            Try a topic like "climate" or a bill number like "HR 1234" or "S 5678"
          </p>
        </div>

        {/* Filter bar */}
        <div className={styles.filterSection}>
          <div className={styles.tabBar}>
            <button
              className={`${styles.tab} ${activeTab === 'federal' ? styles.tabActive : ''}`}
              onClick={() => handleTabSwitch('federal')}
            >
              Federal
            </button>
            <button
              className={`${styles.tab} ${activeTab === 'state' ? styles.tabActive : ''}`}
              onClick={() => handleTabSwitch('state')}
            >
              State
            </button>
          </div>
          {activeTab === 'state' && (
            <>
              <select
                className={styles.stateSelect}
                value={selectedState}
                onChange={e => {
                  const code = e.target.value
                  setSelectedState(code)
                  setChamberFilter('All')
                }}
              >
                <option value="">Select a state</option>
                {US_STATES.map(s => (
                  <option key={s.code} value={s.code}>{s.name}</option>
                ))}
              </select>
              <p className={styles.stateNote}>
                New Hampshire isn't currently supported. The NH legislature's website uses bot-protection that blocks automated access to bill text. We're working on a solution.
              </p>
            </>
          )}
          <div className={styles.filterBar}>
            {['All', 'House', 'Senate'].map(chamber => (
              <button
                key={chamber}
                className={`${styles.filterBtn} ${chamberFilter === chamber ? styles.filterActive : ''}`}
                onClick={() => setChamberFilter(chamber)}
              >
                {chamber}
              </button>
            ))}
          </div>
        </div>

        {/* Profile hint */}
        {!profile && hasSearched && bills.length > 0 && (
          <div className={styles.profileHint}>
            Want personalized explanations?{' '}
            <button className={styles.profileHintLink} onClick={() => navigate('/profile', { state: { returnTo: `/search?${searchParams.toString()}` } })}>
              Set up your profile
            </button>{' '}
            to unlock the Personalize button on each bill.
          </div>
        )}

        {/* Loading skeletons */}
        {loading && (
          <div className={styles.loadingGrid}>
            {[...Array(4)].map((_, i) => (
              <div key={i} className={styles.skeleton} style={{ animationDelay: `${i * 0.1}s` }} />
            ))}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className={styles.error}>
            <p>{error}</p>
            <button className={styles.retryBtn} onClick={() => activeQuery && fetchResults(activeQuery, 1, true)}>
              Try again
            </button>
          </div>
        )}

        {/* Results */}
        {!loading && !error && filteredBills.length > 0 && (
          <>
            <div className={styles.meta} role="status" aria-live="polite">
              {totalResults} result{totalResults !== 1 ? 's' : ''} for "{activeQuery}" &middot; {filterLabel}
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
                    personalizing={personalizingBills.has(billId)}
                    onPersonalize={personalizeBill}
                    isBookmarked={bookmarkedIds.has(billId)}
                    onToggleBookmark={user ? toggleBookmark : undefined}
                    onTrackInteraction={handleTrackInteraction}
                    animationDelay={`${i * 0.08}s`}
                  />
                )
              })}
            </div>
            {hasMore && (
              <div className={styles.loadMoreWrap}>
                <button className={styles.loadMoreBtn} onClick={handleLoadMore} disabled={loadingMore}>
                  {loadingMore ? 'Loading...' : 'Load more results'}
                </button>
              </div>
            )}
          </>
        )}

        {/* Chamber filter empty (bills exist but none match chamber) */}
        {!loading && !error && hasSearched && bills.length > 0 && filteredBills.length === 0 && (
          <div className={styles.empty}>
            <p className={styles.emptyHeading}>No {chamberFilter} bills found</p>
            <p>Try selecting "All" to see all results, or adjust your search.</p>
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && hasSearched && bills.length === 0 && (
          <div className={styles.empty}>
            <p className={styles.emptyHeading}>No bills found</p>
            <p>Try a different search term or check your spelling.</p>
          </div>
        )}

        {/* Initial prompt before any search */}
        {!hasSearched && !loading && (
          <div className={styles.prompt}>
            <svg className={styles.promptIcon} width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            {activeTab === 'state' && !(selectedState || profile?.state) ? (
              <>
                <p className={styles.promptHeading}>Select a state to search</p>
                <p className={styles.promptSub}>Choose the legislature you want to search from the menu above.</p>
              </>
            ) : (
              <>
                <p className={styles.promptHeading}>What legislation are you looking for?</p>
                <p className={styles.promptSub}>Search by topic, keyword, or bill number.</p>
                <div className={styles.suggestionChips}>
                  {SUGGESTION_CHIPS.map(chip => (
                    <button
                      key={chip}
                      className={styles.suggestionChip}
                      onClick={() => handleChipClick(chip)}
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        <div className={styles.disclaimer}>
          <strong>CapitolKey is strictly nonpartisan.</strong> We explain impact, not position.
          Bill data from <a href="https://legiscan.com" target="_blank" rel="noopener noreferrer">LegiScan</a>.
          Personalizations generated by AI.
        </div>

      </div>
    </main>
  )
}
