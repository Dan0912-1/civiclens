import { useState, useEffect } from 'react'
import { getApiBase } from '../lib/api'
import styles from './Impact.module.css'

const TOPIC_COLORS = {
  Education: '#3b82f6',
  Healthcare: '#ef4444',
  Economy: '#f59e0b',
  Environment: '#22c55e',
  Technology: '#8b5cf6',
  Housing: '#ec4899',
  'Civil Rights': '#06b6d4',
  Other: '#6b7280',
}

export default function Impact() {
  const [metrics, setMetrics] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`${getApiBase()}/api/impact`)
      .then(r => r.json())
      .then(setMetrics)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <main className={styles.page}>
        <div className={styles.loader}>
          <div className={styles.spinner} />
        </div>
      </main>
    )
  }

  if (!metrics) {
    return (
      <main className={styles.page}>
        <p className={styles.error}>Unable to load impact data.</p>
      </main>
    )
  }

  const topics = Object.entries(metrics.topicBreakdown || {})
    .sort((a, b) => b[1] - a[1])
  const maxTopic = topics[0]?.[1] || 1

  return (
    <main className={styles.page}>
      <section className={styles.header}>
        <h1 className={styles.title}>Impact Dashboard</h1>
        <p className={styles.subtitle}>
          Real-time metrics showing how CapitolKey is helping students engage with legislation.
        </p>
      </section>

      <section className={styles.grid}>
        <div className={styles.card}>
          <span className={styles.cardValue}>{metrics.totalUsers.toLocaleString()}</span>
          <span className={styles.cardLabel}>Students Reached</span>
          <span className={styles.cardDesc}>Unique students who received personalized legislation</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardValue}>{metrics.totalPersonalizations.toLocaleString()}</span>
          <span className={styles.cardLabel}>Bills Personalized</span>
          <span className={styles.cardDesc}>AI-powered explanations delivered</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardValue}>{metrics.uniqueBillsPersonalized.toLocaleString()}</span>
          <span className={styles.cardLabel}>Unique Bills Covered</span>
          <span className={styles.cardDesc}>Distinct pieces of legislation explained</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardValue}>{metrics.totalInteractions.toLocaleString()}</span>
          <span className={styles.cardLabel}>Student Interactions</span>
          <span className={styles.cardDesc}>Views, expansions, and bookmarks</span>
        </div>
      </section>

      {topics.length > 0 && (
        <section className={styles.topicSection}>
          <h2 className={styles.sectionTitle}>Topics Students Care About</h2>
          <div className={styles.topicList}>
            {topics.map(([topic, count]) => (
              <div key={topic} className={styles.topicRow}>
                <span className={styles.topicName}>{topic}</span>
                <div className={styles.topicBarWrap}>
                  <div
                    className={styles.topicBar}
                    style={{
                      width: `${(count / maxTopic) * 100}%`,
                      background: TOPIC_COLORS[topic] || '#6b7280',
                    }}
                  />
                </div>
                <span className={styles.topicCount}>{count}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className={styles.about}>
        <h2 className={styles.sectionTitle}>About CapitolKey</h2>
        <p className={styles.aboutText}>
          CapitolKey is a nonpartisan civic education platform that personalizes real U.S. legislation
          for high school students. Using AI, it translates complex bills into plain English tailored
          to each student's state, grade, interests, and life situation — making civic engagement
          accessible and relevant.
        </p>
        <div className={styles.highlights}>
          <div className={styles.highlight}>
            <span className={styles.highlightIcon}>&#9878;</span>
            <span>Nonpartisan — zero political bias</span>
          </div>
          <div className={styles.highlight}>
            <span className={styles.highlightIcon}>&#127891;</span>
            <span>Built for students grades 9-12+</span>
          </div>
          <div className={styles.highlight}>
            <span className={styles.highlightIcon}>&#9889;</span>
            <span>Real bills from Congress, updated daily</span>
          </div>
        </div>
      </section>
    </main>
  )
}
