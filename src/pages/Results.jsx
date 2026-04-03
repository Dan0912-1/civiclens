import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { loadProfile, getBookmarks, addBookmark, removeBookmark } from '../lib/userProfile'
import { getApiBase } from '../lib/api'
import { trackInteraction, getInteractionSummary, computeLocalSummary, getLocalInteractions, syncLocalInteractions } from '../lib/interactions'
import { supabase } from '../lib/supabase'
import usePullToRefresh from '../hooks/usePullToRefresh'
import BillCard from '../components/BillCard.jsx'
import styles from './Results.module.css'

const API_BASE = getApiBase()
const BILLS_PER_PAGE = 5

function makeBillId(bill) {
  if (bill.legiscan_bill_id) return `ls-${bill.legiscan_bill_id}`
  return `${bill.type}${bill.number}-${bill.congress}`
}

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
  const [interactionSummary, setInteractionSummary] = useState(null)
  const [visibleCount, setVisibleCount] = useState(BILLS_PER_PAGE)
  const [loadingMore, setLoadingMore] = useState(false)
  const [activeTab, setActiveTab] = useState('federal') // 'federal' or 'state'
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
      }
      const stored = sessionStorage.getItem('civicProfile')
      if (!stored) {
        navigate('/profile')
        return
      }
      setProfile(JSON.parse(stored))
    }
    load()
  }, [navigate, user])

  // Fetch interaction summary and sync local interactions on login
  useEffect(() => {
    async function loadInteractions() {
      if (user && supabase) {
        // Sync local interactions to server if user just logged in
        if (!prevUserRef.current) {
          const { data: { session } } = await supabase.auth.getSession()
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

  // Fetch bills when profile is ready
  useEffect(() => {
    if (!profile) return
    fetchBills()
  }, [profile])

  // Personalize a batch of bills in a single API call (all Groq calls run in parallel server-side)
  async function personalizeBillsBatch(billsToPersonalize) {
    if (!billsToPersonalize.length) return
    try {
      const resp = await fetch(`${API_BASE}/api/personalize-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bills: billsToPersonalize, profile })
      })
      if (resp.ok) {
        const data = await resp.json()
        if (data.results) {
          // Update all analyses at once
          setAnalyses(prev => {
            const next = { ...prev }
            for (const [billId, result] of Object.entries(data.results)) {
              if (result?.analysis) next[billId] = result.analysis
            }
            return next
          })
          // Mark all as settled
          const settledIds = Object.keys(data.results)
          setSettledBills(prev => {
            const next = new Set(prev)
            settledIds.forEach(id => next.add(id))
            return next
          })
        }
        if (data.errors) {
          setFailedBills(prev => {
            const next = new Set(prev)
            Object.keys(data.errors).forEach(id => next.add(id))
            return next
          })
          setSettledBills(prev => {
            const next = new Set(prev)
            Object.keys(data.errors).forEach(id => next.add(id))
            return next
          })
        }
      }
    } catch (err) {
      console.error('Batch personalization failed:', err)
      // Mark all as failed
      setFailedBills(prev => {
        const next = new Set(prev)
        billsToPersonalize.forEach(b => next.add(makeBillId(b)))
        return next
      })
      setSettledBills(prev => {
        const next = new Set(prev)
        billsToPersonalize.forEach(b => next.add(makeBillId(b)))
        return next
      })
    }
  }

  async function fetchBills() {
    setLoadingBills(true)
    setBillError('')
    setSettledBills(new Set())
    setFailedBills(new Set())
    setVisibleCount(BILLS_PER_PAGE)
    try {
      const body = {
        interests: profile.interests,
        grade: profile.grade,
        state: profile.state,
      }
      if (interactionSummary && interactionSummary.totalInteractions > 0) {
        body.interactionSummary = interactionSummary
      }
      const resp = await fetch(`${API_BASE}/api/legislation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      const data = await resp.json()
      if (data.bills) {
        setBills(data.bills)
        // Personalize first 5 in one batch call (all parallel server-side)
        const firstBatch = data.bills.slice(0, BILLS_PER_PAGE)
        personalizeBillsBatch(firstBatch).then(() => {
          // Background: personalize remaining bills
          const rest = data.bills.slice(BILLS_PER_PAGE)
          if (rest.length) personalizeBillsBatch(rest)
        })
      } else {
        setBillError('Could not load bills. Please try again.')
      }
    } catch (err) {
      setBillError('Unable to connect. Please check your internet connection and try again.')
    } finally {
      setLoadingBills(false)
    }
  }

  function handleLoadMore() {
    setLoadingMore(true)
    setVisibleCount(prev => {
      const next = prev + BILLS_PER_PAGE
      setLoadingMore(false)
      return next
    })
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
    return [...filtered].sort((a, b) => {
      const relA = analyses[makeBillId(a)]?.relevance ?? -1
      const relB = analyses[makeBillId(b)]?.relevance ?? -1
      return relB - relA
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
            📍 {profile.state} · Grade {profile.grade}
            {profile.hasJob ? ' · Works' : ''}
          </div>
          <h1 className={styles.heading}>Your Legislation</h1>
          <p className={styles.subhead}>
            Real bills — explained for your life.
          </p>
          <button className={styles.editBtn} onClick={() => navigate('/profile')}>
            ← Edit my profile
          </button>
        </div>

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

        {/* Trending interests */}
        {interactionSummary && interactionSummary.totalInteractions > 5 && (
          <div className={styles.trendingBar}>
            <span className={styles.trendingLabel}>Your trending interests</span>
            <div className={styles.trendingPills}>
              {Object.entries(interactionSummary.topicCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([topic, count]) => (
                  <button
                    key={topic}
                    className={styles.trendingPill}
                    data-topic={topic}
                    onClick={() => setActiveFilter(topic)}
                  >
                    {topic} <span className={styles.trendingCount}>{count}</span>
                  </button>
                ))
              }
            </div>
          </div>
        )}

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
            {[...Array(6)].map((_, i) => (
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
                <button className={styles.loadMoreBtn} onClick={handleLoadMore} disabled={loadingMore}>
                  {loadingMore ? 'Loading...' : `Show more bills (${allFilteredBills.length - visibleCount} remaining)`}
                </button>
              </div>
            )}
          </>
        )}

        {/* Empty state */}
        {!loadingBills && !billError && filteredBills.length === 0 && (
          <div className={styles.empty}>
            <p>No bills found for this filter. Try selecting "All".</p>
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
