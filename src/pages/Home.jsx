import { useState, useEffect, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import FeaturedBills from '../components/FeaturedBills'
import styles from './Home.module.css'

const SEARCH_CHIPS = ['Student Loans', 'Climate', 'Healthcare', 'Immigration', 'Education', 'Housing']

const DEMO_BILLS = [
  {
    tag: 'Education', tagColor: '#1A3557', tagBg: 'transparent',
    chamber: 'House',
    title: 'H.R. 2847: Student Loan Refinancing Act',
    summary: 'Reduces federal student loan interest to 4.5% for borrowers in qualifying income brackets. Estimated fiscal impact: $12.3B over 10 years.',
    relevance: 9,
    chips: ['119th Congress', 'Cost Estimate Attached', 'Ways & Means'],
  },
  {
    tag: 'Healthcare', tagColor: '#1F4D3A', tagBg: 'transparent',
    chamber: 'Senate',
    title: 'CT HB 6941: School Mental Health Services',
    summary: 'Mandates a licensed counselor on-site in every Connecticut public school. Appropriates $48M from the General Fund for FY26.',
    relevance: 8,
    chips: ['CT Gen. Assembly', 'Public Health Cmte', 'Reported'],
  },
  {
    tag: 'Economy', tagColor: '#6B4A1A', tagBg: 'transparent',
    chamber: 'House',
    title: 'H.R. 603: Raise the Wage Act',
    summary: 'Increases federal minimum wage to $17.00/hr by 2028 in phased increments. Applies to employers with 15+ FTE.',
    relevance: 9,
    chips: ['119th Congress', 'Edu. & Workforce', 'In Committee'],
  },
]

const TOPICS = [
  { id: 'education',   label: 'Education',       emoji: '📚', color: '#0A1929', bg: '#FFFFFF' },
  { id: 'environment', label: 'Environment',     emoji: '🌿', color: '#0A1929', bg: '#FFFFFF' },
  { id: 'economy',     label: 'Economy & Jobs',  emoji: '💼', color: '#0A1929', bg: '#FFFFFF' },
  { id: 'healthcare',  label: 'Healthcare',      emoji: '🏥', color: '#0A1929', bg: '#FFFFFF' },
  { id: 'technology',  label: 'Tech & Privacy',  emoji: '💻', color: '#0A1929', bg: '#FFFFFF' },
  { id: 'housing',     label: 'Housing',         emoji: '🏠', color: '#0A1929', bg: '#FFFFFF' },
  { id: 'immigration', label: 'Immigration',     emoji: '🌎', color: '#0A1929', bg: '#FFFFFF' },
  { id: 'civil_rights',label: 'Civil Rights',    emoji: '⚖️', color: '#0A1929', bg: '#FFFFFF' },
  { id: 'community',   label: 'Community',       emoji: '🤝', color: '#0A1929', bg: '#FFFFFF' },
]

export default function Home() {
  const navigate = useNavigate()
  const [billIndex, setBillIndex] = useState(0)
  const [typedTitle, setTypedTitle] = useState('')
  const [showSummary, setShowSummary] = useState(false)
  const [fading, setFading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const intervalRef = useRef(null)

  function handleSearch(e) {
    e.preventDefault()
    const q = searchQuery.trim()
    if (q) {
      navigate(`/search?q=${encodeURIComponent(q)}`)
    }
  }

  const bill = DEMO_BILLS[billIndex]

  // Typing effect for bill title
  useEffect(() => {
    setTypedTitle('')
    setShowSummary(false)
    setFading(false)
    let i = 0
    let summaryTimer
    const title = DEMO_BILLS[billIndex].title
    intervalRef.current = setInterval(() => {
      i++
      setTypedTitle(title.slice(0, i))
      if (i >= title.length) {
        clearInterval(intervalRef.current)
        summaryTimer = setTimeout(() => setShowSummary(true), 300)
      }
    }, 40)
    return () => { clearInterval(intervalRef.current); clearTimeout(summaryTimer) }
  }, [billIndex])

  // Cycle through bills
  useEffect(() => {
    let fadeTimer
    const timer = setTimeout(() => {
      setFading(true)
      fadeTimer = setTimeout(() => {
        setBillIndex(prev => (prev + 1) % DEMO_BILLS.length)
      }, 400)
    }, 9000)
    return () => { clearTimeout(timer); clearTimeout(fadeTimer) }
  }, [billIndex])

  return (
    <main className={styles.home}>

      {/* Hero */}
      <section className={styles.heroWrap}>
        <div className={styles.hero}>
        <div className={styles.heroText}>
          <span className={styles.eyebrow}>Your Laws, Your Future</span>
          <h1 className={styles.headline}>
            What Laws Are<br />
            <span className={styles.accent}>Shaping Your Life</span>?
          </h1>
          <p className={styles.subhead}>
            Real bills, explained for your life. Track legislation in
            Congress and your state legislature in plain language and see
            how it affects you personally. Nonpartisan. Built by a student.
          </p>
          <div className={styles.ctaRow}>
            <button
              className={styles.ctaPrimary}
              onClick={() => navigate('/profile')}
            >
              Get Started →
            </button>
            <button
              className={styles.ctaSecondary}
              onClick={() => navigate('/results')}
            >
              Explore Bills
            </button>
          </div>
          <div className={styles.trustStrip}>
            <span><span className={styles.trustCheck}>✓</span>Congress.gov</span>
            <span className={styles.trustSep}>·</span>
            <span><span className={styles.trustCheck}>✓</span>State Legislatures</span>
            <span className={styles.trustSep}>·</span>
            <span><span className={styles.trustCheck}>✓</span>Nonpartisan</span>
            <span className={styles.trustSep}>·</span>
            <span><span className={styles.trustCheck}>✓</span>Updated Hourly</span>
          </div>
        </div>

        <div className={styles.heroDemo}>
          <div className={styles.profileChips}>
            {bill.chips.map((c, i) => (
              <span key={i} className={styles.chip}>{c}</span>
            ))}
          </div>
          <div className={`${styles.demoCard} ${fading ? styles.demoCardFading : ''}`}>
            <div className={styles.demoCardHeader}>
              <div className={styles.demoTag} style={{ background: bill.tagBg, color: bill.tagColor }}>
                {bill.tag}
              </div>
              <span className={`${styles.demoChamberPill} ${bill.chamber === 'House' ? styles.chamberHouse : styles.chamberSenate}`}>
                {bill.chamber}
              </span>
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

      {/* Moving this week — live bills from Congress.gov, refreshed hourly */}
      <FeaturedBills />

      {/* Search */}
      <section className={styles.searchSection}>
        <h2 className={styles.searchHeading}>Search Bills</h2>
        <p className={styles.searchSub}>Find bills by keyword, topic, bill number, or sponsor.</p>
        <form className={styles.searchForm} onSubmit={handleSearch}>
          <input
            type="text"
            className={styles.searchInput}
            placeholder="e.g. student loans, minimum wage, climate..."
            aria-label="Search bills"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          <button type="submit" className={styles.searchBtn}>Search</button>
        </form>
        <div className={styles.searchChips}>
          {SEARCH_CHIPS.map(chip => (
            <button
              key={chip}
              className={styles.searchChip}
              onClick={() => navigate(`/search?q=${encodeURIComponent(chip)}`)}
            >
              {chip}
            </button>
          ))}
        </div>
      </section>

      {/* Topic cards */}
      <section className={styles.topics}>
        <h2 className={styles.topicsHeading}>Explore by Topic</h2>
        <div className={styles.topicScroll}>
          {TOPICS.map(t => (
            <button
              key={t.id}
              className={styles.topicCard}
              onClick={() => navigate(`/search?q=${encodeURIComponent(t.label)}`)}
              style={{
                '--topic-color': t.color,
                '--topic-bg':    t.bg,
              }}
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
            <div className={styles.timelineDot}>01</div>
            <div className={styles.timelineLabel}>Set Up Your Feed</div>
            <div className={styles.timelineSub}>Your state &amp; interests</div>
          </div>
          <div className={styles.timelineLine} />
          <div className={styles.timelineStep}>
            <div className={styles.timelineDot}>02</div>
            <div className={styles.timelineLabel}>Get Matched Bills</div>
            <div className={styles.timelineSub}>Federal + state bills</div>
          </div>
          <div className={styles.timelineLine} />
          <div className={styles.timelineStep}>
            <div className={styles.timelineDot}>03</div>
            <div className={styles.timelineLabel}>See Your Impact</div>
            <div className={styles.timelineSub}>Plain-language analysis</div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className={styles.ctaSection}>
        <h2>Start tracking bills that affect you.</h2>
        <p>No account needed. Set your state and interests to get started.</p>
        <button
          className={styles.ctaPrimary}
          onClick={() => navigate('/profile')}
        >
          Get Started →
        </button>
      </section>

      {/* Footer */}
      <footer className={styles.footer}>
        <span>&copy; {new Date().getFullYear()} CapitolKey</span>
        <Link to="/privacy">Privacy Policy</Link>
        <Link to="/terms">Terms of Service</Link>
        <Link to="/about">About</Link>
        <Link to="/educators">Educators</Link>
        <Link to="/contact">Contact</Link>
      </footer>

    </main>
  )
}
