import { useState, useEffect, useCallback } from 'react'
import { getApiBase } from '../lib/api'
import styles from './Admin.module.css'

const API = getApiBase()

function timeAgo(dateStr) {
  const s = Math.round((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function fmtUptime(seconds) {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function Bar({ label, value, max, variant }) {
  const pct = max > 0 ? Math.max(1, (value / max) * 100) : 0
  const fillClass = variant === 'amber' ? styles.barFillAmber
    : variant === 'green' ? styles.barFillGreen : ''
  return (
    <div className={styles.barRow}>
      <span className={styles.barLabel}>{label}</span>
      <div className={styles.barTrack}>
        <div className={`${styles.barFill} ${fillClass}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={styles.barCount}>{value}</span>
    </div>
  )
}

export default function Admin() {
  const [token, setToken] = useState(() => sessionStorage.getItem('ck_admin_token') || '')
  const [authed, setAuthed] = useState(!!sessionStorage.getItem('ck_admin_token'))
  const [inputToken, setInputToken] = useState('')
  const [stats, setStats] = useState(null)
  const [feedback, setFeedback] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const fetchData = useCallback(async (adminToken) => {
    setLoading(true)
    setError('')
    try {
      const headers = { 'x-admin-token': adminToken }
      const [statsRes, fbRes] = await Promise.all([
        fetch(`${API}/api/admin/stats`, { headers }),
        fetch(`${API}/api/admin/feedback?limit=20`, { headers }),
      ])
      if (statsRes.status === 403) {
        setAuthed(false)
        sessionStorage.removeItem('ck_admin_token')
        setError('Invalid admin token')
        setLoading(false)
        return
      }
      const statsData = await statsRes.json()
      const fbData = await fbRes.json()
      setStats(statsData)
      setFeedback(fbData.data || [])
    } catch (e) {
      setError(e.message || 'Failed to fetch admin data')
    }
    setLoading(false)
  }, [])

  function handleAuth(e) {
    e.preventDefault()
    if (!inputToken.trim()) return
    sessionStorage.setItem('ck_admin_token', inputToken.trim())
    setToken(inputToken.trim())
    setAuthed(true)
    fetchData(inputToken.trim())
  }

  useEffect(() => {
    if (authed && token) fetchData(token)
  }, [authed, token, fetchData])

  // Auto-refresh every 30s
  useEffect(() => {
    if (!authed || !token) return
    const id = setInterval(() => fetchData(token), 30000)
    return () => clearInterval(id)
  }, [authed, token, fetchData])

  if (!authed) {
    return (
      <main className={styles.page}>
        <div className={styles.container}>
          <div className={styles.authGate}>
            <h2>Admin Dashboard</h2>
            <p>Enter your admin token to access the dashboard.</p>
            <form className={styles.tokenInput} onSubmit={handleAuth}>
              <input
                type="password"
                value={inputToken}
                onChange={e => setInputToken(e.target.value)}
                placeholder="Admin token"
                autoFocus
              />
              <button type="submit">Access</button>
            </form>
            {error && <p className={styles.error}>{error}</p>}
          </div>
        </div>
      </main>
    )
  }

  if (loading && !stats) {
    return (
      <main className={styles.page}>
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <span>Loading dashboard...</span>
        </div>
      </main>
    )
  }

  if (error && !stats) {
    return (
      <main className={styles.page}>
        <div className={styles.container}>
          <p className={styles.error}>{error}</p>
        </div>
      </main>
    )
  }

  if (!stats) return null

  const u = stats.users || {}
  const c = stats.cache || {}
  const api = stats.api || {}
  const inter = stats.interactions || {}
  const srv = stats.server || {}
  const bills = stats.bills || {}
  const fb = stats.feedback || {}
  const ls = api.legiScan || {}

  const anthropicPct = api.anthropicHourlyCap > 0
    ? Math.round((api.anthropicCallsThisHour / api.anthropicHourlyCap) * 100) : 0
  const anthropicColor = anthropicPct > 80 ? 'var(--status-failed)' :
    anthropicPct > 50 ? 'var(--status-pending)' : 'var(--status-active)'

  const maxState = (u.byState || []).length > 0 ? u.byState[0][1] : 1
  const maxInterest = (u.byInterest || []).length > 0 ? u.byInterest[0][1] : 1
  const maxTopic = (inter.byTopic || []).length > 0 ? inter.byTopic[0][1] : 1
  const maxCategory = (bills.byCategory || []).length > 0 ? bills.byCategory[0][1] : 1

  return (
    <main className={styles.page}>
      <div className={styles.container}>

        {/* Header */}
        <div className={styles.header}>
          <h1>Admin Dashboard</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div className={styles.serverBadge}>
              <span className={styles.dot} />
              Uptime {fmtUptime(srv.uptime || 0)}
            </div>
            <div className={styles.serverBadge}>
              {srv.memoryMB || 0} MB heap
            </div>
            <button className={styles.refreshBtn} onClick={() => fetchData(token)}>
              Refresh
            </button>
          </div>
        </div>

        {/* KPI row */}
        <div className={styles.kpiRow}>
          <div className={styles.kpi}>
            <div className={styles.kpiLabel}>Accounts</div>
            <div className={styles.kpiValue}>{(u.totalAccounts || 0).toLocaleString()}</div>
            <div className={styles.kpiSub}>
              {u.totalProfiles || 0} profiles / +{u.signups?.last7d || 0} this week
            </div>
          </div>
          <div className={`${styles.kpi} ${styles.kpiAccent}`}>
            <div className={styles.kpiLabel}>Interactions</div>
            <div className={styles.kpiValue}>{(inter.total || 0).toLocaleString()}</div>
            <div className={styles.kpiSub}>
              {inter.last24h || 0} today / {inter.last7d || 0} this week
            </div>
          </div>
          <div className={styles.kpi}>
            <div className={styles.kpiLabel}>Bookmarks</div>
            <div className={styles.kpiValue}>{(u.bookmarks || 0).toLocaleString()}</div>
          </div>
          <div className={`${styles.kpi} ${styles.kpiGreen}`}>
            <div className={styles.kpiLabel}>Curated Bills</div>
            <div className={styles.kpiValue}>{(bills.curated || 0).toLocaleString()}</div>
            <div className={styles.kpiSub}>{bills.topics || 0} topic tags</div>
          </div>
          <div className={styles.kpi}>
            <div className={styles.kpiLabel}>Feedback</div>
            <div className={styles.kpiValue}>{(fb.total || 0).toLocaleString()}</div>
            <div className={styles.kpiSub}>
              {Object.entries(fb.byType || {}).map(([t, n]) => `${t}: ${n}`).join(', ') || 'none'}
            </div>
          </div>
        </div>

        {/* API Quota + Cache Performance */}
        <div className={styles.grid}>
          <div className={styles.panel}>
            <div className={styles.panelTitle}>API Quotas <span className={styles.kpiSub}>(since last deploy)</span></div>

            {/* Anthropic gauge */}
            <div className={styles.gaugeRow}>
              <span className={styles.gaugeLabel}>Claude</span>
              <div className={styles.gaugeMeter}>
                <div className={styles.gaugeFill}
                  style={{ width: `${anthropicPct}%`, background: anthropicColor }} />
              </div>
              <span className={styles.gaugeLabel}>
                {api.anthropicCallsThisHour}/{api.anthropicHourlyCap}
              </span>
            </div>

            {/* LegiScan metrics */}
            <div className={styles.statRow}>
              <span className={styles.statKey}>LegiScan search</span>
              <span className={styles.statVal}>{ls.search || 0}</span>
            </div>
            <div className={styles.statRow}>
              <span className={styles.statKey}>LegiScan getBill</span>
              <span className={styles.statVal}>{ls.getBill || 0}</span>
            </div>
            <div className={styles.statRow}>
              <span className={styles.statKey}>LegiScan getBillText</span>
              <span className={styles.statVal}>{ls.getBillText || 0}</span>
            </div>
            <div className={styles.statRow}>
              <span className={styles.statKey}>LegiScan getMasterList</span>
              <span className={styles.statVal}>{ls.getMasterList || 0}</span>
            </div>
          </div>

          <div className={styles.panel}>
            <div className={styles.panelTitle}>Cache Performance <span className={styles.kpiSub}>(since last deploy)</span></div>
            <div className={styles.statRow}>
              <span className={styles.statKey}>In-memory entries</span>
              <span className={styles.statVal}>{(c.inMemory || 0).toLocaleString()}</span>
            </div>
            <div className={styles.statRow}>
              <span className={styles.statKey}>L1 cache hits</span>
              <span className={styles.statVal}>{(ls.cacheHitL1 || 0).toLocaleString()}</span>
            </div>
            <div className={styles.statRow}>
              <span className={styles.statKey}>L2 cache hits</span>
              <span className={styles.statVal}>{(ls.cacheHitL2 || 0).toLocaleString()}</span>
            </div>
            <div className={styles.statRow}>
              <span className={styles.statKey}>Cache misses</span>
              <span className={styles.statVal}>{(ls.cacheMiss || 0).toLocaleString()}</span>
            </div>
            <div className={styles.statRow}>
              <span className={styles.statKey}>Personalizations cached</span>
              <span className={styles.statVal}>{(c.personalizations || 0).toLocaleString()}</span>
            </div>
            <div className={styles.statRow}>
              <span className={styles.statKey}>Bill texts cached</span>
              <span className={styles.statVal}>{(c.billTexts || 0).toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* User Demographics + Interests */}
        <div className={styles.grid}>
          <div className={styles.panel}>
            <div className={styles.panelTitle}>Users by State</div>
            {(u.byState || []).length > 0 ? (
              <div className={styles.barList}>
                {u.byState.map(([state, count]) => (
                  <Bar key={state} label={state} value={count} max={maxState} />
                ))}
              </div>
            ) : <p className={styles.emptyState}>No state data yet</p>}
          </div>

          <div className={styles.panel}>
            <div className={styles.panelTitle}>Top Interests</div>
            {(u.byInterest || []).length > 0 ? (
              <div className={styles.barList}>
                {u.byInterest.map(([interest, count]) => (
                  <Bar key={interest} label={interest} value={count} max={maxInterest} variant="amber" />
                ))}
              </div>
            ) : <p className={styles.emptyState}>No interest data yet</p>}
          </div>
        </div>

        {/* Interactions + Bill Categories */}
        <div className={styles.grid}>
          <div className={styles.panel}>
            <div className={styles.panelTitle}>Interactions by Topic</div>
            {(inter.byTopic || []).length > 0 ? (
              <div className={styles.barList}>
                {inter.byTopic.map(([topic, count]) => (
                  <Bar key={topic} label={topic} value={count} max={maxTopic} variant="green" />
                ))}
              </div>
            ) : <p className={styles.emptyState}>No interaction data yet</p>}
          </div>

          <div className={styles.panel}>
            <div className={styles.panelTitle}>Curated Bills by Category</div>
            {(bills.byCategory || []).length > 0 ? (
              <div className={styles.barList}>
                {bills.byCategory.map(([cat, count]) => (
                  <Bar key={cat} label={cat} value={count} max={maxCategory} variant="amber" />
                ))}
              </div>
            ) : <p className={styles.emptyState}>No curated bills yet</p>}
          </div>
        </div>

        {/* User breakdown + Notifications */}
        <div className={styles.grid}>
          <div className={styles.panel}>
            <div className={styles.panelTitle}>Users by Grade</div>
            {(u.byGrade || []).length > 0 ? (
              <div className={styles.barList}>
                {u.byGrade.map(([grade, count]) => (
                  <Bar key={grade} label={grade} value={count}
                    max={u.byGrade[0][1]} />
                ))}
              </div>
            ) : <p className={styles.emptyState}>No grade data yet</p>}
          </div>

          <div className={styles.panel}>
            <div className={styles.panelTitle}>Notification Adoption</div>
            <div className={styles.statRow}>
              <span className={styles.statKey}>Push enabled</span>
              <span className={styles.statVal}>{u.pushEnabled || 0} / {u.totalProfiles || 0}</span>
            </div>
            <div className={styles.statRow}>
              <span className={styles.statKey}>Email enabled</span>
              <span className={styles.statVal}>{u.emailEnabled || 0} / {u.totalProfiles || 0}</span>
            </div>
            <div className={styles.statRow}>
              <span className={styles.statKey}>Push tokens registered</span>
              <span className={styles.statVal}>{u.pushTokens || 0}</span>
            </div>
            <div className={styles.statRow}>
              <span className={styles.statKey}>iOS tokens</span>
              <span className={styles.statVal}>{u.platforms?.ios || 0}</span>
            </div>
            <div className={styles.statRow}>
              <span className={styles.statKey}>Android tokens</span>
              <span className={styles.statVal}>{u.platforms?.android || 0}</span>
            </div>

            <div className={styles.panelTitle} style={{ marginTop: '20px' }}>Interaction Types</div>
            {Object.entries(inter.byAction || {}).map(([action, count]) => (
              <div className={styles.statRow} key={action}>
                <span className={styles.statKey}>{action}</span>
                <span className={styles.statVal}>{count.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Feedback */}
        <div className={styles.panel}>
          <div className={styles.panelTitle}>Recent Feedback</div>
          {feedback && feedback.length > 0 ? (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Message</th>
                  <th>From</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {feedback.map((f, i) => (
                  <tr key={f.id || i}>
                    <td><span className={styles.typeBadge}>{f.type || 'general'}</span></td>
                    <td>{(f.message || '').slice(0, 120)}{(f.message || '').length > 120 ? '...' : ''}</td>
                    <td>{f.name || f.email || 'Anonymous'}</td>
                    <td><span className={styles.timeAgo}>{f.created_at ? timeAgo(f.created_at) : '—'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className={styles.emptyState}>No feedback submitted yet</p>}
        </div>

      </div>
    </main>
  )
}
