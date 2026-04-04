import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { getApiBase } from '../lib/api'
import { trackInteraction } from '../lib/interactions'
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
  Other:         'gray',
}

export default function BillDetail() {
  const { congress, type, number } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const trackedRef = useRef(false)

  // Data passed from Results page via router state
  const passedBill = location.state?.bill || null
  const passedAnalysis = location.state?.analysis || null

  const [bill, setBill] = useState(passedBill)
  const [analysis, setAnalysis] = useState(passedAnalysis)
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [personalizationError, setPersonalizationError] = useState(false)

  // Track view_detail interaction once we have analysis (for topic_tag)
  useEffect(() => {
    if (trackedRef.current || !analysis) return
    trackedRef.current = true
    const billId = `${type.toUpperCase()}${number}-${congress}`
    const doTrack = async () => {
      let token = null
      if (user && supabase) {
        const { data: { session } } = await supabase.auth.getSession()
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

  useEffect(() => {
    fetchBillDetail()
  }, [congress, type, number])

  async function fetchBillDetail() {
    setLoading(true)
    try {
      const legiscanId = passedBill?.legiscan_bill_id || new URLSearchParams(window.location.search).get('legiscan_id') || ''
      const url = legiscanId
        ? `${API_BASE}/api/bill/${congress}/${type}/${number}?legiscan_id=${legiscanId}`
        : `${API_BASE}/api/bill/${congress}/${type}/${number}`
      const resp = await fetch(url)
      if (resp.ok) {
        const data = await resp.json()
        setDetail(data.bill || data)
        // If we didn't have bill info passed from Results, build it from API
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
      setError('Network error loading bill details.')
    } finally {
      setLoading(false)
    }
  }

  async function fetchPersonalization() {
    const stored = sessionStorage.getItem('civicProfile')
    if (!stored || !bill) return

    setPersonalizationError(false)
    const profile = JSON.parse(stored)
    try {
      const resp = await fetch(`${API_BASE}/api/personalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bill, profile })
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

  // Re-fetch personalization once bill data loads from API
  useEffect(() => {
    if (bill && !analysis) fetchPersonalization()
  }, [bill])

  const tagColor = TAG_COLORS[analysis?.topic_tag] || 'gray'
  const displayTitle = bill?.title || detail?.title || `${type.toUpperCase()} ${number}`
  const billUrl = passedBill?.url || detail?.url || (
    passedBill?.isStateBill
      ? `https://legiscan.com/${passedBill.state}/bill/${type.toUpperCase()}${number}/2026`
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
          <button className={styles.backBtn} onClick={() => navigate(-1)}>
            ← Go back
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <button className={styles.backBtn} onClick={() => navigate(-1)}>
          ← Back to results
        </button>

        <div className={styles.header}>
          <div className={styles.headerMeta}>
            {analysis && (
              <span className={`${styles.tag} ${styles[`tag_${tagColor}`]}`}>
                {analysis.topic_tag}
              </span>
            )}
            <span className={styles.billId}>
              {type.toUpperCase()} {number} · {congress}th Congress
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
                    background: analysis.relevance >= 7 ? '#16a34a' : analysis.relevance >= 4 ? '#e8a020' : '#9ca3af'
                  }}
                />
              </div>
              <span className={styles.relevanceLabel} style={{
                color: analysis.relevance >= 7 ? '#16a34a' : analysis.relevance >= 4 ? '#e8a020' : '#9ca3af'
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
                      <p className={styles.actionHow}>{a.how}</p>
                      <span className={styles.actionTime}>~{a.time}</span>
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
              onClick={() => fetchPersonalization()}
            >
              Try again
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
