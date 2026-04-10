import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getApiBase } from '../lib/api'
import styles from './FeaturedBills.module.css'

/**
 * "Moving this week" homepage section.
 *
 * Data source: GET /api/featured — refreshed hourly by a background job on the
 * backend that pulls recently-updated bills from Congress.gov (isolated from
 * the main feed's LegiScan quota).
 *
 * Relevance scoring has three tiers:
 *   1. No profile at all          → generic "Civic Impact" score from backend
 *   2. Anonymous + sessionStorage → would use personalize endpoint (TODO)
 *   3. Logged in                  → would use cached personalization (TODO)
 *
 * For now we show the backend's `civic_score` for everyone and a profile CTA
 * on anonymous cards. Personalized scoring can be layered in later without
 * changing the UI.
 */

const TOPIC_STYLES = {
  Education:    { bg: 'transparent', fg: '#1A3557' },
  Healthcare:   { bg: 'transparent', fg: '#1F4D3A' },
  Environment:  { bg: 'transparent', fg: '#1F4D3A' },
  Economy:      { bg: 'transparent', fg: '#6B4A1A' },
  Housing:      { bg: 'transparent', fg: '#6B4A1A' },
  'Civil Rights': { bg: 'transparent', fg: '#1A3557' },
  Immigration:  { bg: 'transparent', fg: '#1A3557' },
  Other:        { bg: 'transparent', fg: '#3A4654' },
}

function StatusBadge({ label, kind }) {
  return (
    <span className={`${styles.statusBadge} ${styles['status_' + kind]}`}>
      <span className={styles.statusDot} />
      {label}
    </span>
  )
}

function TopicPill({ topic }) {
  const s = TOPIC_STYLES[topic] || TOPIC_STYLES.Other
  return (
    <span className={styles.topicPill} style={{ background: s.bg, color: s.fg }}>
      {topic}
    </span>
  )
}

function RelevanceBar({ score, isPersonalized }) {
  const pct = Math.max(0, Math.min(100, (score / 10) * 100))
  return (
    <div className={styles.relevanceWrap}>
      <span className={styles.relevanceLabel}>
        {isPersonalized ? 'Your match' : 'Civic impact'}
      </span>
      <div className={styles.relevanceBarWrap}>
        <div className={styles.relevanceBar}>
          <div className={styles.relevanceFill} style={{ width: `${pct}%` }} />
        </div>
        <span className={styles.relevanceScore}>{score}/10</span>
      </div>
    </div>
  )
}

function hasAnonymousProfile() {
  try {
    const raw = sessionStorage.getItem('civicProfile')
    return Boolean(raw && JSON.parse(raw)?.interests?.length)
  } catch {
    return false
  }
}

function relativeTime(iso) {
  if (!iso) return 'just now'
  const then = new Date(iso).getTime()
  const diff = Date.now() - then
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? '' : 's'} ago`
  const days = Math.floor(hrs / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

export default function FeaturedBills() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [bills, setBills] = useState([])
  const [rankedAt, setRankedAt] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const isPersonalized = Boolean(user) || hasAnonymousProfile()

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const resp = await fetch(`${getApiBase()}/api/featured`)
        if (!resp.ok) throw new Error('fetch failed')
        const data = await resp.json()
        if (cancelled) return
        setBills(data.bills || [])
        setRankedAt(data.rankedAt || null)
      } catch {
        if (!cancelled) setError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  function openBill(row) {
    const b = row.bill_data || {}
    if (!b.type || !b.number) return
    navigate(`/bill/${b.congress || 0}/${b.type.toLowerCase()}/${b.number}`, {
      state: { bill: b, skipPersonalization: true },
    })
  }

  // Don't render the section at all if the backend has nothing to show
  if (!loading && !error && bills.length === 0) return null

  return (
    <section className={styles.moving} aria-labelledby="moving-heading">
      <div className={styles.movingHead}>
        <h2 id="moving-heading" className={styles.movingTitle}>
          Moving <em>this week</em>
        </h2>
        <div className={styles.movingMeta}>
          <span className={styles.pulse} />
          {loading
            ? 'Loading from Congress.gov…'
            : error
            ? 'Congress.gov unavailable'
            : `Updated ${relativeTime(rankedAt)} · Congress.gov`}
        </div>
      </div>

      {loading ? (
        <div className={styles.billGrid}>
          {[0, 1, 2].map(i => (
            <div key={i} className={`${styles.billCard} ${styles.skeleton}`} aria-hidden="true">
              <div className={styles.skelLine} style={{ width: '40%' }} />
              <div className={styles.skelLine} style={{ width: '80%', height: '20px' }} />
              <div className={styles.skelLine} style={{ width: '95%' }} />
              <div className={styles.skelLine} style={{ width: '70%' }} />
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.billGrid}>
          {bills.map(row => {
            const bill = row.bill_data || {}
            const score = row.civic_score ?? 7
            return (
              <article
                key={row.slot}
                className={styles.billCard}
                onClick={() => openBill(row)}
                role="button"
                tabIndex={0}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    openBill(row)
                  }
                }}
              >
                <div className={styles.billCardTop}>
                  <StatusBadge label={row.status_label} kind={row.status_kind} />
                  {row.topic_tag && <TopicPill topic={row.topic_tag} />}
                </div>
                <div className={styles.billId}>
                  {bill.type?.toUpperCase()} {bill.number} · {bill.congress}th Congress
                </div>
                <h3 className={styles.billTitle}>{bill.title}</h3>
                <div className={styles.impactLine}>
                  <span className={styles.ifPasses}>Latest action</span>
                  {bill.latestAction}
                  {bill.latestActionDate && (
                    <span className={styles.actionDate}> · {bill.latestActionDate}</span>
                  )}
                </div>
                <div className={styles.billFooter}>
                  <RelevanceBar score={score} isPersonalized={isPersonalized} />
                  <span className={styles.readMore}>Read →</span>
                </div>
                {!isPersonalized && (
                  <button
                    className={styles.profileHint}
                    onClick={e => {
                      e.stopPropagation()
                      navigate('/profile')
                    }}
                  >
                    Build a profile for your personal match →
                  </button>
                )}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
