import { useNavigate } from 'react-router-dom'
import styles from './Home.module.css'

const STATS = [
  { number: '50', label: 'States covered' },
  { number: '10K+', label: 'Bills tracked' },
  { number: '0', label: 'Political bias' },
]

export default function Home() {
  const navigate = useNavigate()

  return (
    <main className={styles.home}>

      {/* Hero */}
      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <div className={styles.badge}>Real legislation. Plain language.</div>
          <h1 className={styles.headline}>
            Laws are being made.<br />
            <span className={styles.accent}>See how they affect you.</span>
          </h1>
          <p className={styles.subhead}>
            CapitolKey pulls real bills moving through Congress right now and
            translates them into plain English — personalized to your state,
            grade, and what you care about.
          </p>
          <div className={styles.heroActions}>
            <button
              className={styles.ctaPrimary}
              onClick={() => navigate('/profile')}
            >
              See my legislation →
            </button>
            <button
              className={styles.ctaSecondary}
              onClick={() => navigate('/about')}
            >
              How it works
            </button>
          </div>
        </div>

        <div className={styles.heroVisual}>
          <div className={styles.cardMock}>
            <div className={styles.mockTag}>Education</div>
            <div className={styles.mockTitle}>Student Loan Refinancing Act</div>
            <div className={styles.mockBody}>
              If this passes, your future federal student loans could have lower interest rates — saving borrowers thousands over a 10-year repayment period.
            </div>
            <div className={styles.mockRelevance}>
              <span className={styles.mockDot} />
              Highly relevant to you
            </div>
          </div>
        </div>
      </section>

      {/* Stats bar */}
      <section className={styles.statsBar}>
        {STATS.map(s => (
          <div key={s.label} className={styles.stat}>
            <span className={styles.statNum}>{s.number}</span>
            <span className={styles.statLabel}>{s.label}</span>
          </div>
        ))}
      </section>

      {/* How it works */}
      <section className={styles.how}>
        <h2 className={styles.sectionTitle}>Three steps to your civic picture</h2>
        <div className={styles.steps}>
          {[
            { n: '01', title: 'Tell us about yourself', body: 'Your state, grade, job status, and what issues matter to you. No account required.' },
            { n: '02', title: 'We find the bills', body: 'CapitolKey pulls real legislation moving through Congress right now — filtered to what\'s relevant.' },
            { n: '03', title: 'See your impact', body: 'Every bill explained in plain English: what changes for you if it passes, what stays the same if it fails.' },
          ].map(step => (
            <div key={step.n} className={styles.step}>
              <div className={styles.stepNum}>{step.n}</div>
              <h3 className={styles.stepTitle}>{step.title}</h3>
              <p className={styles.stepBody}>{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className={styles.ctaSection}>
        <h2>Ready to see what's moving?</h2>
        <p>Takes 60 seconds. No account, no email, no spam.</p>
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
        <button onClick={() => navigate('/impact')}>Impact</button>
        <button onClick={() => navigate('/about')}>About</button>
        <a href="mailto:dejacius@gmail.com">Contact</a>
      </footer>

    </main>
  )
}
