import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import AuthModal from '../components/AuthModal.jsx'
import styles from './Educators.module.css'

const VALUE_PROPS = [
  {
    n: '01',
    title: 'Nonpartisan by design',
    body: 'Every explainer describes what a bill does and who it affects. It never tells students what to think. CapitolKey is built to explain impact, not opinions, so it is safe to assign in any classroom.',
  },
  {
    n: '02',
    title: 'Plain language, real bills',
    body: 'Live legislation from Congress and your state legislature, rewritten at a high-school reading level with a clear "if it passes" and "if it fails" breakdown students can finish in minutes.',
  },
  {
    n: '03',
    title: 'No student accounts',
    body: 'Students join with a class code in about thirty seconds. No email, no app to install, no passwords to reset. It runs in any browser, on a Chromebook or a phone.',
  },
  {
    n: '04',
    title: 'See the engagement',
    body: 'Assign a bill, add instructions and a due date, then watch your dashboard fill in. See who finished, how long they spent, and export the results to CSV for your gradebook.',
  },
]

const STEPS = [
  { n: '01', label: 'Create a class', sub: 'Free, about two minutes. You get a join code to share.' },
  { n: '02', label: 'Assign a bill', sub: 'Pick legislation or let students explore by interest. Add instructions and a due date.' },
  { n: '03', label: 'Track and export', sub: 'See completions on your dashboard and export to your gradebook.' },
]

const USE_CASES = [
  'Bell-ringers and do-nows',
  'Current-events Fridays',
  'Debate and Socratic seminar prep',
  'Research and project units',
  'Sub plans',
  'Civics and government courses',
]

const FAQ = [
  {
    q: 'Is it really free?',
    a: 'Yes. CapitolKey is free for teachers and students.',
  },
  {
    q: 'Do students need accounts?',
    a: 'No. Students join with a class code, no email required. Signing in is optional and only adds saved bills and notifications.',
  },
  {
    q: 'Is it biased?',
    a: 'No. CapitolKey explains what a bill does and who it affects. It does not argue for or against any bill, party, or position.',
  },
  {
    q: 'What grade levels is it for?',
    a: 'It is built for high school civics, government, and U.S. history, and works well for current-events units across social studies.',
  },
  {
    q: 'Where do the bills come from?',
    a: 'Official legislative records from Congress and state legislatures, updated continuously.',
  },
  {
    q: 'How long does setup take?',
    a: 'About five minutes to create a class and assign your first bill.',
  },
]

export default function Educators() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [showAuth, setShowAuth] = useState(false)
  const [authIntent, setAuthIntent] = useState(false)

  // Cold-teacher path: creating a class requires sign-in. If logged out, open
  // the auth modal and remember the intent; once the user signs in (email or
  // OAuth-in-page), route them straight into the create-class flow so the
  // landing CTA never dead-ends.
  useEffect(() => {
    if (user && authIntent) {
      setAuthIntent(false)
      setShowAuth(false)
      navigate('/classroom?create=1')
    }
  }, [user, authIntent, navigate])

  function handleCreate() {
    if (user) { navigate('/classroom?create=1'); return }
    setAuthIntent(true)
    setShowAuth(true)
  }

  return (
    <main className={styles.page}>

      {/* Hero */}
      <section className={styles.heroWrap}>
        <div className={styles.hero}>
          <span className={styles.eyebrow}>For Educators</span>
          <h1 className={styles.headline}>
            Real legislation,<br />
            <span className={styles.accent}>ready for your classroom.</span>
          </h1>
          <p className={styles.subhead}>
            CapitolKey turns the bills moving through Congress and your state
            legislature into plain-language, strictly nonpartisan explainers your
            students can actually read. Create a class in five minutes, share one
            code, and see who completed what. Free for teachers and students.
          </p>
          <div className={styles.ctaRow}>
            <button className={styles.ctaPrimary} onClick={handleCreate}>
              Create a free class
            </button>
            <a
              className={styles.ctaSecondary}
              href="/capitolkey-onepager.html"
              target="_blank"
              rel="noopener noreferrer"
            >
              Get the one-pager
            </a>
          </div>
          <div className={styles.trustStrip}>
            <span><span className={styles.trustCheck}>✓</span>Free for teachers</span>
            <span className={styles.trustSep}>·</span>
            <span><span className={styles.trustCheck}>✓</span>Strictly nonpartisan</span>
            <span className={styles.trustSep}>·</span>
            <span><span className={styles.trustCheck}>✓</span>No student accounts</span>
            <span className={styles.trustSep}>·</span>
            <span><span className={styles.trustCheck}>✓</span>Updated daily</span>
          </div>
        </div>
      </section>

      {/* Why teachers use it */}
      <section className={styles.section}>
        <h2 className={styles.sectionHeading}>Why teachers use CapitolKey</h2>
        <div className={styles.valueGrid}>
          {VALUE_PROPS.map(v => (
            <div key={v.n} className={styles.valueCard}>
              <span className={styles.valueNum}>{v.n}</span>
              <h3 className={styles.valueTitle}>{v.title}</h3>
              <p className={styles.valueBody}>{v.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* What students see — sample card */}
      <section className={styles.sampleWrap}>
        <div className={styles.sampleInner}>
          <div className={styles.sampleText}>
            <span className={styles.eyebrow}>What your students see</span>
            <h2 className={styles.sampleHeading}>Every bill, broken down the same clear way.</h2>
            <p className={styles.sampleSub}>
              No jargon and no spin. Students get the plain-language summary, what
              changes if it passes, what stays the same if it fails, and concrete
              civic actions they can take.
            </p>
          </div>
          <div className={styles.demoCard}>
            <div className={styles.demoHeader}>
              <span className={styles.demoTag}>Education</span>
              <span className={styles.demoChamber}>House</span>
            </div>
            <div className={styles.demoTitle}>H.R. 2847: Student Loan Refinancing Act</div>
            <p className={styles.demoSummary}>
              Lets borrowers in qualifying income brackets refinance federal
              student loans to a 4.5% interest rate.
            </p>
            <div className={styles.demoSplit}>
              <div className={styles.demoPass}>
                <span className={styles.demoSplitLabel}>If it passes</span>
                <span>Lower monthly payments for eligible borrowers starting next year.</span>
              </div>
              <div className={styles.demoFail}>
                <span className={styles.demoSplitLabel}>If it fails</span>
                <span>Current interest rates stay in place; no change to repayment.</span>
              </div>
            </div>
            <div className={styles.demoRelevance}>
              <span className={styles.relevanceDot} />
              Relevance to your students: 9/10
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className={styles.section}>
        <h2 className={styles.sectionHeading}>Set up in five minutes</h2>
        <div className={styles.steps}>
          {STEPS.map((s, i) => (
            <div key={s.n} className={styles.stepWrap}>
              <div className={styles.step}>
                <div className={styles.stepNum}>{s.n}</div>
                <div className={styles.stepLabel}>{s.label}</div>
                <div className={styles.stepSub}>{s.sub}</div>
              </div>
              {i < STEPS.length - 1 && <div className={styles.stepLine} />}
            </div>
          ))}
        </div>
      </section>

      {/* Use cases */}
      <section className={styles.useWrap}>
        <h2 className={styles.sectionHeading}>Drop it into what you already teach</h2>
        <div className={styles.useChips}>
          {USE_CASES.map(u => (
            <span key={u} className={styles.useChip}>{u}</span>
          ))}
        </div>
      </section>

      {/* Built by a student */}
      <section className={styles.founder}>
        <div className={styles.founderInner}>
          <span className={styles.eyebrow}>Why it exists</span>
          <p className={styles.founderQuote}>
            CapitolKey was built by a high school student who serves on his town's
            Board of Education, on a simple belief: every student deserves the same
            clear civic information that policy professionals have. It is
            nonpartisan, and it is free.
          </p>
        </div>
      </section>

      {/* FAQ */}
      <section className={styles.section}>
        <h2 className={styles.sectionHeading}>Questions teachers ask</h2>
        <div className={styles.faqGrid}>
          {FAQ.map(f => (
            <div key={f.q} className={styles.faqItem}>
              <h3 className={styles.faqQ}>{f.q}</h3>
              <p className={styles.faqA}>{f.a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className={styles.ctaSection}>
        <h2>Set up your class before the first bell.</h2>
        <p>Free for teachers and students. No student accounts. Five minutes to your first assignment.</p>
        <button className={styles.ctaPrimary} onClick={handleCreate}>
          Create a free class
        </button>
        <div className={styles.ctaFootLinks}>
          <Link to="/contact">Have questions? Contact us</Link>
          <a href="/capitolkey-onepager.html" target="_blank" rel="noopener noreferrer">
            Print the one-pager
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className={styles.footer}>
        <span>&copy; {new Date().getFullYear()} CapitolKey</span>
        <Link to="/">Home</Link>
        <Link to="/about">About</Link>
        <Link to="/privacy">Privacy Policy</Link>
        <Link to="/terms">Terms of Service</Link>
        <Link to="/contact">Contact</Link>
      </footer>

      <AuthModal
        isOpen={showAuth}
        onClose={() => { setShowAuth(false); setAuthIntent(false) }}
      />
    </main>
  )
}
