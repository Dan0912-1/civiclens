import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getApiBase } from '../lib/api'
import styles from './TopicPage.module.css'

// Set/replace a <meta name="..."> and return its previous content so the effect
// can restore it on unmount (App.jsx only manages document.title, not meta).
function setMeta(name, content) {
  let el = document.head.querySelector(`meta[name="${name}"]`)
  let created = false
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute('name', name)
    document.head.appendChild(el)
    created = true
  }
  const prev = el.getAttribute('content')
  el.setAttribute('content', content)
  return () => {
    if (created) el.remove()
    else el.setAttribute('content', prev ?? '')
  }
}

function setCanonical(href) {
  let el = document.head.querySelector('link[rel="canonical"]')
  let created = false
  if (!el) {
    el = document.createElement('link')
    el.setAttribute('rel', 'canonical')
    document.head.appendChild(el)
    created = true
  }
  const prev = el.getAttribute('href')
  el.setAttribute('href', href)
  return () => {
    if (created) el.remove()
    else if (prev) el.setAttribute('href', prev)
    else el.removeAttribute('href')
  }
}

export default function TopicPage() {
  const { slug } = useParams()
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('loading') // loading | ready | notfound | error

  // Cold-load the topic payload so the page renders content on first paint
  // (crawlable). Re-runs when the slug changes.
  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setData(null)
    fetch(`${getApiBase()}/api/topics/${encodeURIComponent(slug)}`)
      .then(async (res) => {
        if (cancelled) return
        if (res.status === 404) { setStatus('notfound'); return }
        if (!res.ok) { setStatus('error'); return }
        const json = await res.json()
        if (cancelled) return
        setData(json)
        setStatus('ready')
      })
      .catch(() => { if (!cancelled) setStatus('error') })
    return () => { cancelled = true }
  }, [slug])

  // Per-topic crawlable meta: real <title>, description, and canonical. Googlebot
  // executes JS so it reads these; non-JS bots get the equivalent server-rendered
  // page via the /render/topic/:slug Vercel rewrite.
  useEffect(() => {
    if (status !== 'ready' || !data?.topic) return
    const t = data.topic
    const prevTitle = document.title
    document.title = `${t.title} | CapitolKey`
    const restoreDesc = setMeta('description', t.metaDescription)
    const restoreCanonical = setCanonical(t.canonical)
    return () => {
      document.title = prevTitle
      restoreDesc()
      restoreCanonical()
    }
  }, [status, data])

  if (status === 'loading') {
    return (
      <main className={styles.page}>
        <div className={styles.center}><div className={styles.spinner} /></div>
      </main>
    )
  }

  if (status === 'notfound') {
    return (
      <main className={styles.page}>
        <div className={styles.center}>
          <h1>Topic not found</h1>
          <p>We don't have a page for that topic yet.</p>
          <Link to="/topics" className={styles.link}>Browse all topics</Link>
        </div>
      </main>
    )
  }

  if (status === 'error' || !data) {
    return (
      <main className={styles.page}>
        <div className={styles.center}>
          <h1>Something went wrong</h1>
          <p>We couldn't load this topic. Please try again.</p>
          <Link to="/topics" className={styles.link}>Browse all topics</Link>
        </div>
      </main>
    )
  }

  const { topic, bills } = data

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <nav className={styles.breadcrumb} aria-label="Breadcrumb">
          <Link to="/">Home</Link>
          <span className={styles.breadcrumbSep}>/</span>
          <Link to="/topics">Topics</Link>
          <span className={styles.breadcrumbSep}>/</span>
          <span className={styles.breadcrumbCurrent}>{topic.navLabel}</span>
        </nav>

        <header className={styles.hero}>
          <h1>{topic.title}</h1>
          <p className={styles.intro}>{topic.intro}</p>
        </header>

        {bills.length > 0 ? (
          <>
            <p className={styles.countLabel}>
              {bills.length} current {bills.length === 1 ? 'bill' : 'bills'}
            </p>
            <div className={styles.billList}>
              {bills.map((bill) => (
                <Link key={bill.id} to={bill.path} className={styles.billCard}>
                  <div className={styles.billMeta}>
                    <span className={styles.billLabel}>{bill.billLabel}</span>
                    {bill.congressLabel && (
                      <>
                        <span className={styles.metaDot}>·</span>
                        <span>{bill.congressLabel}</span>
                      </>
                    )}
                    {bill.statusLabel && (
                      <>
                        <span className={styles.metaDot}>·</span>
                        <span className={styles.statusBadge}>{bill.statusLabel}</span>
                      </>
                    )}
                    {bill.latestActionDate && (
                      <>
                        <span className={styles.metaDot}>·</span>
                        <span>{bill.latestActionDate}</span>
                      </>
                    )}
                  </div>
                  <h2 className={styles.billTitle}>{bill.title}</h2>
                  {bill.summary && <p className={styles.billSummary}>{bill.summary}</p>}
                </Link>
              ))}
            </div>
          </>
        ) : (
          <div className={styles.empty}>
            <p>No current bills are tagged for this topic yet. New legislation is added every day.</p>
            <Link to="/search" className={styles.link}>Browse all bills</Link>
          </div>
        )}

        <p className={styles.footerNote}>
          CapitolKey explains real legislation in plain language, without taking a side.{' '}
          <Link to="/topics" className={styles.link}>See all topics</Link>
        </p>
      </div>
    </main>
  )
}
