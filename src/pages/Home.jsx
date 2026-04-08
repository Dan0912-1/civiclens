import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import FeaturedBills from '../components/FeaturedBills'
import styles from './Home.module.css'

const SEARCH_CHIPS = ['Student Loans', 'Climate', 'Healthcare', 'Immigration', 'Education', 'Housing']

const DEMO_BILLS = [
  {
    tag: 'Education', tagColor: '#1A3557', tagBg: 'transparent',
    chamber: 'House',
    title: 'H.R. 2847 — Student Loan Refinancing Act',
    summary: 'Reduces federal student loan interest to 4.5% for borrowers in qualifying income brackets. Estimated fiscal impact: $12.3B over 10 years.',
    relevance: 9,
    chips: ['119th Congress', 'Fiscal Note Attached', 'Ways & Means'],
  },
  {
    tag: 'Healthcare', tagColor: '#1F4D3A', tagBg: 'transparent',
    chamber: 'Senate',
    title: 'CT HB 6941 — School Mental Health Services',
    summary: 'Mandates a licensed counselor on-site in every Connecticut public school. Appropriates $48M from the General Fund for FY26.',
    relevance: 8,
    chips: ['CT Gen. Assembly', 'Public Health Cmte', 'Reported'],
  },
  {
    tag: 'Economy', tagColor: '#6B4A1A', tagBg: 'transparent',
    chamber: 'House',
    title: 'H.R. 603 — Raise the Wage Act',
    summary: 'Increases federal minimum wage to $17.00/hr by 2028 in phased increments. Applies to employers with 15+ FTE.',
    relevance: 9,
    chips: ['119th Congress', 'Edu. & Workforce', 'In Committee'],
  },
]

const TOPICS = [
  { id: 'education',   label: 'Education',     emoji: '', color: '#0A1929', bg: '#FFFFFF' },
  { id: 'environment', label: 'Environment',   emoji: '', color: '#0A1929', bg: '#FFFFFF' },
  { id: 'economy',     label: 'Economy & Labor', emoji: '', color: '#0A1929', bg: '#FFFFFF' },
  { id: 'healthcare',  label: 'Public Health', emoji: '', color: '#0A1929', bg: '#FFFFFF' },
  { id: 'technology',  label: 'Tech & Privacy', emoji: '', color: '#0A1929', bg: '#FFFFFF' },
  { id: 'housing',     label: 'Housing Policy', emoji: '', color: '#0A1929', bg: '#FFFFFF' },
  { id: 'immigration', label: 'Immigration',   emoji: '', color: '#0A1929', bg: '#FFFFFF' },
  { id: 'civil_rights',label: 'Civil Rights',  emoji: '', color: '#0A1929', bg: '#FFFFFF' },
  { id: 'community',   label: 'Community Dev.', emoji: '', color: '#0A1929', bg: '#FFFFFF' },
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
    if (searchQuery.trim()) {
      navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`)
    } else {
      navigate('/search')
    }
  }

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
          <span className={styles.eyebrow}>The Legislative Record</span>
          <h1 className={styles.headline}>
            The Definitive Record of<br />
            <span className={styles.accent}>American Legislation</span>.
          </h1>
          <p className={styles.subhead}>
            Authoritative analysis of active bills across Congress and state
            legislatures. Sourced directly from primary government records.
            Nonpartisan. Independently operated.
          </p>
          <div className={styles.ctaRow}>
            <button
              className={styles.ctaPrimary}
              onClick={() => navigate('/profile')}
            >
              Enter Platform →
            </button>
            <button
              className={styles.ctaSecondary}
              onClick={() => navigate('/results')}
            >
              Browse Legislative Index
            </button>
          </div>
          <div className={styles.trustStrip}>
            <span><span className={styles.trustCheck}>✓</span>Verified Sources</span>
            <span className={styles.trustSep}>·</span>
            <span><span className={styles.trustCheck}>✓</span>Nonpartisan</span>
            <span className={styles.trustSep}>·</span>
            <span><span className={styles.trustCheck}>✓</span>Updated Hourly</span>
            <span className={styles.trustSep}>·</span>
            <span><span className={styles.trustCheck}>✓</span>Congress.gov</span>
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
        <h2 className={styles.searchHeading}>Legislative Search</h2>
        <p className={styles.searchSub}>Query federal and state legislation by keyword, bill number, sponsor, or committee.</p>
        <form className={styles.searchForm} onSubmit={handleSearch}>
          <input
            type="text"
            className={styles.searchInput}
            placeholder="e.g. student loans, minimum wage, climate..."
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
        <h2 className={styles.topicsHeading}>Policy Subject Matter</h2>
        <div className={styles.topicScroll}>
          {TOPICS.map(t => (
            <button
              key={t.id}
              className={styles.topicCard}
              onClick={() => navigate('/profile')}
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
            <div className={styles.timelineLabel}>Configure Profile</div>
            <div className={styles.timelineSub}>Jurisdiction &amp; interests</div>
          </div>
          <div className={styles.timelineLine} />
          <div className={styles.timelineStep}>
            <div className={styles.timelineDot}>02</div>
            <div className={styles.timelineLabel}>Match Legislation</div>
            <div className={styles.timelineSub}>Federal + state corpus</div>
          </div>
          <div className={styles.timelineLine} />
          <div className={styles.timelineStep}>
            <div className={styles.timelineDot}>03</div>
            <div className={styles.timelineLabel}>Review Impact</div>
            <div className={styles.timelineSub}>Analysis &amp; sources</div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className={styles.ctaSection}>
        <h2>Access the Legislative Record.</h2>
        <p>No registration required. Anonymous browsing supported.</p>
        <button
          className={styles.ctaPrimary}
          onClick={() => navigate('/profile')}
        >
          Configure Profile →
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
