import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import styles from './Home.module.css'

const DEMO_BILLS = [
  {
    tag: 'Education', tagColor: '#2563eb',
    title: 'Student Loan Refinancing Act',
    summary: 'If this passes, your future federal student loans could drop to 4.5% interest — saving you thousands over a 10-year repayment.',
    relevance: 9,
    chips: ['U.S. Congress', 'Age 17–18', 'Education'],
  },
  {
    tag: 'Healthcare', tagColor: '#16a34a',
    title: 'CT HB 6941 — School Mental Health Services',
    summary: 'Would require every Connecticut public school to have a licensed counselor on-site — meaning your school gets direct access to mental health support.',
    relevance: 8,
    chips: ['Connecticut', 'Age 15–16', 'Healthcare'],
  },
  {
    tag: 'Economy', tagColor: '#9333ea',
    title: 'Raise the Wage Act',
    summary: 'Would increase federal minimum wage to $17/hr by 2028 — directly affecting your paycheck if you work part-time in Maryland.',
    relevance: 9,
    chips: ['Maryland', 'Age 15–16', 'Economy'],
  },
]

const TOPICS = [
  { id: 'education', label: 'Education', emoji: '📚' },
  { id: 'environment', label: 'Environment', emoji: '🌿' },
  { id: 'economy', label: 'Economy', emoji: '💼' },
  { id: 'healthcare', label: 'Healthcare', emoji: '🏥' },
  { id: 'technology', label: 'Technology', emoji: '💻' },
  { id: 'housing', label: 'Housing', emoji: '🏠' },
  { id: 'immigration', label: 'Immigration', emoji: '🌎' },
  { id: 'civil_rights', label: 'Civil Rights', emoji: '⚖️' },
  { id: 'community', label: 'Community', emoji: '🤝' },
]

export default function Home() {
  const navigate = useNavigate()
  const [billIndex, setBillIndex] = useState(0)
  const [typedTitle, setTypedTitle] = useState('')
  const [showSummary, setShowSummary] = useState(false)
  const [fading, setFading] = useState(false)
  const intervalRef = useRef(null)

  const bill = DEMO_BILLS[billIndex]

  // Typing effect for bill title
  useEffect(() => {
    setTypedTitle('')
    setShowSummary(false)
    setFading(false)
    let i = 0
    const title = DEMO_BILLS[billIndex].title
    intervalRef.current = setInterval(() => {
      i++
      setTypedTitle(title.slice(0, i))
      if (i >= title.length) {
        clearInterval(intervalRef.current)
        setTimeout(() => setShowSummary(true), 300)
      }
    }, 40)
    return () => clearInterval(intervalRef.current)
  }, [billIndex])

  // Cycle through bills
  useEffect(() => {
    const timer = setTimeout(() => {
      setFading(true)
      setTimeout(() => {
        setBillIndex(prev => (prev + 1) % DEMO_BILLS.length)
      }, 400)
    }, 6000)
    return () => clearTimeout(timer)
  }, [billIndex])

  return (
    <main className={styles.home}>

      {/* Hero */}
      <section className={styles.heroWrap}>
        <div className={styles.hero}>
        <div className={styles.heroText}>
          <h1 className={styles.headline}>
            See how laws affect<br />
            <span className={styles.accent}>your life.</span>
          </h1>
          <p className={styles.subhead}>
            Real bills from Congress and your state legislature — translated
            into plain English, personalized to you.
          </p>
          <button
            className={styles.ctaPrimary}
            onClick={() => navigate('/profile')}
          >
            Try it with your profile →
          </button>
        </div>

        <div className={styles.heroDemo}>
          <div className={styles.profileChips}>
            {bill.chips.map((c, i) => (
              <span key={i} className={styles.chip}>{c}</span>
            ))}
          </div>
          <div className={`${styles.demoCard} ${fading ? styles.demoCardFading : ''}`}>
            <div className={styles.demoTag} style={{ background: `${bill.tagColor}20`, color: bill.tagColor }}>
              {bill.tag}
            </div>
            <div className={styles.demoTitle}>
              {typedTitle}<span className={styles.cursor}>|</span>
            </div>
            {showSummary && (
              <div className={styles.demoSummary}>
                {bill.summary}
              </div>
            )}
            {showSummary && (
              <div className={styles.demoRelevance}>
                <span className={styles.relevanceDot} />
                Relevance: {bill.relevance}/10
              </div>
            )}
          </div>
          <div className={styles.demoDots}>
            {DEMO_BILLS.map((_, i) => (
              <span key={i} className={`${styles.dot} ${i === billIndex ? styles.dotActive : ''}`} />
            ))}
          </div>
        </div>
        </div>
      </section>

      {/* Topic cards */}
      <section className={styles.topics}>
        <h2 className={styles.topicsHeading}>What do you care about?</h2>
        <div className={styles.topicScroll}>
          {TOPICS.map(t => (
            <button
              key={t.id}
              className={styles.topicCard}
              onClick={() => navigate('/profile')}
            >
              <span className={styles.topicEmoji}>{t.emoji}</span>
              <span className={styles.topicLabel}>{t.label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* How it works — condensed timeline */}
      <section className={styles.timeline}>
        <div className={styles.timelineSteps}>
          <div className={styles.timelineStep}>
            <div className={styles.timelineDot}>1</div>
            <div className={styles.timelineLabel}>60-second profile</div>
            <div className={styles.timelineSub}>State, age, interests</div>
          </div>
          <div className={styles.timelineLine} />
          <div className={styles.timelineStep}>
            <div className={styles.timelineDot}>2</div>
            <div className={styles.timelineLabel}>AI matches bills</div>
            <div className={styles.timelineSub}>Federal + your state</div>
          </div>
          <div className={styles.timelineLine} />
          <div className={styles.timelineStep}>
            <div className={styles.timelineDot}>3</div>
            <div className={styles.timelineLabel}>See your impact</div>
            <div className={styles.timelineSub}>Plain English, personalized</div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className={styles.ctaSection}>
        <h2>Your legislation is waiting.</h2>
        <p>60 seconds. No account needed.</p>
        <button
          className={styles.ctaPrimary}
          onClick={() => navigate('/profile')}
        >
          Build my profile →
        </button>
      </section>

      {/* Footer */}
      <footer className={styles.footer}>
        <span>&copy; {new Date().getFullYear()} CapitolKey</span>
        <button onClick={() => navigate('/privacy')}>Privacy Policy</button>
        <button onClick={() => navigate('/terms')}>Terms of Service</button>
        <button onClick={() => navigate('/about')}>About</button>
        <button onClick={() => navigate('/contact')}>Contact</button>
      </footer>

    </main>
  )
}
