import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getBookmarks, addBookmark, removeBookmark } from '../lib/userProfile'
import { getApiBase } from '../lib/api'
import { trackInteraction } from '../lib/interactions'
import { supabase } from '../lib/supabase'
import BillCard from '../components/BillCard.jsx'
import styles from './Search.module.css'

const API_BASE = getApiBase()

function makeBillId(bill) {
  if (bill.legiscan_bill_id) return `ls-${bill.legiscan_bill_id}`
  return `${bill.type}${bill.number}-${bill.congress}`
}

export default function Search() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  const initialQuery = searchParams.get('q') || ''
  const [inputValue, setInputValue] = useState(initialQuery)
  const [bills, setBills] = useState([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [totalResults, setTotalResults] = useState(0)
  const [hasSearched, setHasSearched] = useState(false)

  // Personalization state — on-demand per bill
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

  // Load bookmarks for logged-in users
  useEffect(() => {
    if (!user) return
    getBookmarks(user.id).then(bm => setBookmarkedIds(new Set(bm.map(b => b.bill_id))))
  }, [user])

  // Fetch when URL search param changes
  const activeQuery = searchParams.get('q') || ''
  useEffect(() => {
    if (activeQuery) {
      setInputValue(activeQuery)
      fetchResults(activeQuery, 1, true)
    }
  }, [activeQuery])

  async function fetchResults(query, pageNum, reset = false) {
    if (reset) {
      setLoading(true)
      setBills([])
      setPage(1)
    } else {
      setLoadingMore(true)
    }
    setError('')
    setHasSearched(true)

    try {
      const resp = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(query)}&page=${pageNum}`)
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

  function handleSubmit(e) {
    e.preventDefault()
    const q = inputValue.trim()
    if (!q || q.length < 2) return
    // Update URL which triggers the useEffect fetch
    setSearchParams({ q })
  }

  function handleLoadMore() {
    if (activeQuery) fetchResults(activeQuery, page + 1, false)
  }

  // On-demand personalization for a single bill
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

  return (
    <main className={styles.page}>
      <div className={styles.container}>

        <div className={styles.header}>
          <h1 className={styles.heading}>Search Bills</h1>
          <p className={styles.subhead}>Find any federal or state bill by keyword.</p>
        </div>

        <form className={styles.searchForm} onSubmit={handleSubmit}>
          <input
            className={styles.searchInput}
            type="text"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            placeholder="e.g. student loans, climate, minimum wage..."
            autoFocus
          />
          <button
            className={styles.searchBtn}
            type="submit"
            disabled={loading || inputValue.trim().length < 2}
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </form>

        {/* Profile hint for personalization */}
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
        {!loading && !error && bills.length > 0 && (
          <>
            <div className={styles.meta}>
              {totalResults} result{totalResults !== 1 ? 's' : ''} for "{activeQuery}"
            </div>
            <div className={styles.grid}>
              {bills.map((bill, i) => {
                const billId = makeBillId(bill)
                return (
                  <BillCard
                    key={billId}
                    bill={bill}
                    analysis={analyses[billId] || null}
                    personalizationFailed={failedBills.has(billId)}
                    personalizing={personalizingBills.has(billId)}
                    onPersonalize={profile ? () => personalizeBill(bill) : undefined}
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
            <p className={styles.promptHeading}>What legislation are you looking for?</p>
            <p>Search by topic, keyword, or bill number.</p>
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
