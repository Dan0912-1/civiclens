import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import BillCard from '../components/BillCard.jsx'
import styles from './Results.module.css'

// Backend URL — hardcoded so it's always baked into the bundle at build time.
// Local dev: Vite proxy forwards /api/* to localhost:3001 regardless of this value.
const API_BASE = 'https://civiclens-production-07ed.up.railway.app'

export default function Results() {
  const navigate = useNavigate()
  const [profile, setProfile] = useState(null)
  const [bills, setBills] = useState([])
  const [analyses, setAnalyses] = useState({}) // billId → analysis
  const [loadingBills, setLoadingBills] = useState(true)
  const [billError, setBillError] = useState('')
  const [activeFilter, setActiveFilter] = useState('All')
  const [settledBills, setSettledBills] = useState(new Set())

  // Load profile from session
  useEffect(() => {
    const stored = sessionStorage.getItem('civicProfile')
    if (!stored) {
      navigate('/profile')
      return
    }
    setProfile(JSON.parse(stored))
  }, [navigate])

  // Fetch bills when profile is ready
  useEffect(() => {
    if (!profile) return
    fetchBills()
  }, [profile])

  async function fetchBills() {
    setLoadingBills(true)
    setBillError('')
    setSettledBills(new Set())
    try {
      const resp = await fetch(`${API_BASE}/api/legislation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          interests: profile.interests,
          grade: profile.grade,
          state: profile.state,
        })
      })
      const data = await resp.json()
      if (data.bills) {
        setBills(data.bills)
        // Start personalizing each bill (non-blocking)
        data.bills.forEach(bill => personalizeBill(bill))
      } else {
        setBillError('Could not load bills. Please try again.')
      }
    } catch (err) {
      setBillError('Network error. Is the server running?')
    } finally {
      setLoadingBills(false)
    }
  }

  async function personalizeBill(bill) {
    const billId = `${bill.type}${bill.number}-${bill.congress}`
    try {
      const resp = await fetch(`${API_BASE}/api/personalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bill, profile })
      })
      if (resp.ok) {
        const data = await resp.json()
        if (data.analysis) {
          setAnalyses(prev => ({ ...prev, [billId]: data.analysis }))
        }
      }
    } catch (err) {
      console.error('Personalization failed for', billId, err)
    } finally {
      setSettledBills(prev => new Set([...prev, billId]))
    }
  }

  // Collect all topic tags for filter bar
  const topicTags = ['All', ...new Set(
    Object.values(analyses).map(a => a.topic_tag).filter(Boolean)
  )]

  const filteredBills = activeFilter === 'All'
    ? bills
    : bills.filter(b => {
        const id = `${b.type}${b.number}-${b.congress}`
        return analyses[id]?.topic_tag === activeFilter
      })

  if (!profile) return null

  return (
    <main className={styles.page}>
      <div className={styles.container}>

        {/* Header */}
        <div className={styles.header}>
          <div className={styles.profilePill}>
            📍 {profile.state} · Grade {profile.grade}
            {profile.hasJob ? ' · Works' : ''}
          </div>
          <h1 className={styles.heading}>Your Legislation</h1>
          <p className={styles.subhead}>
            Real bills moving through Congress right now — explained for your life.
          </p>
          <button className={styles.editBtn} onClick={() => navigate('/profile')}>
            ← Edit my profile
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
              Showing {filteredBills.length} bill{filteredBills.length !== 1 ? 's' : ''}
              {bills.some(b => !settledBills.has(`${b.type}${b.number}-${b.congress}`)) && (
                <span className={styles.analyzing}> · Personalizing remaining bills...</span>
              )}
            </div>
            <div className={styles.grid}>
              {filteredBills.map((bill, i) => {
                const billId = `${bill.type}${bill.number}-${bill.congress}`
                return (
                  <BillCard
                    key={billId}
                    bill={bill}
                    analysis={analyses[billId] || null}
                    style={{ animationDelay: `${i * 0.08}s` }}
                  />
                )
              })}
            </div>
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
          <strong>CivicLens is strictly nonpartisan.</strong> We explain impact, not position.
          Bill data from <a href="https://api.congress.gov" target="_blank" rel="noopener noreferrer">Congress.gov</a> via the official API.
          Personalizations generated by Claude AI (Anthropic).
        </div>

      </div>
    </main>
  )
}
