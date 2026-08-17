import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getApiBase } from '../lib/api'
import styles from './TopicPage.module.css'

// The /topics hub. Lists every topic landing page so crawlers (and students)
// have a single discoverable entry point; also linked from the sitemap. The
// canonical taxonomy lives in api/topics.js — this page just renders whatever
// /api/topics returns, so adding a topic there surfaces it here automatically.
export default function TopicsIndex() {
  const [topics, setTopics] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    document.title = 'Browse Bills by Topic | CapitolKey'
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch(`${getApiBase()}/api/topics`)
      .then((res) => res.ok ? res.json() : Promise.reject())
      .then((json) => { if (!cancelled) setTopics(json.topics || []) })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [])

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <header className={styles.hero}>
          <h1>Bills by topic</h1>
          <p className={styles.intro}>
            Pick a topic to see the legislation moving in Congress right now,
            explained in plain language. Every page is nonpartisan and free to read.
          </p>
        </header>

        {topics === null && !failed && (
          <div className={styles.center}><div className={styles.spinner} /></div>
        )}

        {failed && (
          <div className={styles.empty}>
            <p>We couldn't load the topic list. Please try again.</p>
            <Link to="/search" className={styles.link}>Browse all bills</Link>
          </div>
        )}

        {topics && topics.length > 0 && (
          <div className={styles.topicGrid}>
            {topics.map((t) => (
              <Link key={t.slug} to={`/topics/${t.slug}`} className={styles.topicCard}>
                <h2>{t.title}</h2>
                <p>{t.metaDescription}</p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
