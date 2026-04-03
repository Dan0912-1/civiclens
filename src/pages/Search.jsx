import { useState, useEffect, useCallback, useMemo } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getBookmarks, addBookmark, removeBookmark } from '../lib/userProfile'
import { getApiBase } from '../lib/api'
import { trackInteraction } from '../lib/interactions'
import { supabase } from '../lib/supabase'
import BillCard from '../components/BillCard.jsx'
import styles from './Search.module.css'

const API_BASE = getApiBase()

const SUGGESTION_CHIPS = [
  'Student Loans',
  'Climate',
  'Healthcare',
  'Gun Policy',
  'Immigration',
  'Education',
]

function makeBillId(bill) {
  if (bill.legiscan_bill_id) return `ls-${bill.legiscan_bill_id}`
  return `${bill.type}${bill.number}-${bill.congress}`
}

export default function Search() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const { user } = useAuth()

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

  // Personalization state
  const [analyses, setAnalyses] = useState({})
  const [personalizingBills, setPersonalizingBills] = useState(new Set())
  const [failedBills, setFailedBills] = useState(new Set())
  const [bookmarkedIds, setBookmarkedIds] = useState(new Set())

  const profile = (() => {
    try {
      const stored = sessionStorage.getItem('civicProfile')
      return stored ? JSON.parse(stored) : null
    } catch { return null }
  })()

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

  useEffect(() => {
    if (activeQuery) {
      setInputValue(activeQuery)
      fetchResults(activeQuery, 1, true, activeTab)
    }
  }, [activeQuery, activeTab])

  async function fetchResults(query, pageNum, reset = false, tab = activeTab) {
    if (reset) {
      setLoading(true)
      setBills([])
      setPage(1)
    } else {
      setLoadingMore(true)
    }
    setError('')
    setHasSearched(true)

    const stateParam = tab === 'state' ? 'CT' : 'US'
    try {
      const resp = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(query)}&page=${pageNum}&state=${stateParam}`)
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}))
        throw new Error(data.error || 'Search failed')
      }
      const data = await resp.json()
      if (reset) {
        setBills(data.bills || [])
      } else {
        setBills(prev => [...prev, ...(data.bills || [])])
      }
      setPage(pageNum)
      setHasMore(data.pagination?.hasMore || false)
      setTotalResults(data.pagination?.totalResults || 0)
    } catch (err) {
      setError(err.message || 'Unable to search. Please try again.')
    } finally {
      setLoading(false)
      setLoadingMore(false)
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

  async function personalizeBill(bill) {
    if (!profile) {
      navigate('/profile')
      return
    }
    const billId = makeBillId(bill)
    setPersonalizingBills(prev => new Set(prev).add(billId))

    try {
      const resp = await fetch(`${API_BASE}/api/personalize-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bills: [bill], profile })
      })
      if (resp.ok) {
        const data = await resp.json()
        if (data.results) {
          for (const [id, result] of Object.entries(data.results)) {
            if (result?.analysis) {
              setAnalyses(prev => ({ ...prev, [id]: result.analysis }))
            }
          }
        }
        if (data.errors) {
          for (const id of Object.keys(data.errors)) {
            setFailedBills(prev => new Set(prev).add(id))
          }
        }
      }
    } catch {
      setFailedBills(prev => new Set(prev).add(billId))
    } finally {
      setPersonalizingBills(prev => {
        const next = new Set(prev)
        next.delete(billId)
        return next
      })
    }
  }

  const handleTrackInteraction = useCallback(async ({ billId, actionType, topicTag }) => {
    let token = null
    if (user && supabase) {
      const { data: { session } } = await supabase.auth.getSession()
      token = session?.access_token
    }
    trackInteraction(user?.id, token, { billId, actionType, topicTag })
  }, [user])

  async function toggleBookmark(billId, bill, analysis) {
    if (!user) return
    if (bookmarkedIds.has(billId)) {
      setBookmarkedIds(prev => { const next = new Set(prev); next.delete(billId); return next })
      await removeBookmark(user.id, billId)
    } else {
      setBookmarkedIds(prev => new Set(prev).add(billId))
      await addBookmark(user.id, billId, { bill, analysis })
    }
  }

  const filterLabel = [
    activeTab === 'state' ? 'Connecticut' : 'Federal',
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
                autoFocus
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
              State (CT)
            </button>
          </div>
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
            <button className={styles.profileHintLink} onClick={() => navigate('/profile')}>
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
            <div className={styles.meta}>
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
                    onPersonalize={() => personalizeBill(bill)}
                    isBookmarked={bookmarkedIds.has(billId)}
                    onToggleBookmark={user ? () => toggleBookmark(billId, bill, analyses[billId]) : undefined}
                    onTrackInteraction={handleTrackInteraction}
                    style={{ animationDelay: `${i * 0.08}s` }}
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
