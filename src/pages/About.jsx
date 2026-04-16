import { useNavigate } from 'react-router-dom'
import styles from './About.module.css'

export default function About() {
  const navigate = useNavigate()

  return (
    <main className={styles.page}>
      <div className={styles.container}>

        <div className={styles.hero}>
          <h1>How CapitolKey works</h1>
          <p>A nonpartisan civic education tool built for students, by a student.</p>
        </div>

        <div className={styles.section}>
          <h2>The problem we solve</h2>
          <p>
            Thousands of bills move through Congress every year. Some will raise
            your future student loan interest rate. Some will change the minimum
            wage you earn at your part-time job. Some will shape the environment
            you inherit. But the only tools that track this legislation were built
            for lawyers, lobbyists, and political professionals, not for you.
          </p>
          <p>
            CapitolKey changes that. We take real legislation, pull the bills most
            relevant to your life, and explain them in plain language. What changes
            if they pass, what stays the same if they fail, and how you can make
            your voice heard.
          </p>
        </div>

        <div className={styles.section}>
          <h2>Our commitment to neutrality</h2>
          <div className={styles.neutralBox}>
            <div className={styles.neutralIcon}>⚖</div>
            <p>
              CapitolKey is <strong>strictly nonpartisan</strong>. We never tell
              you whether a bill is good or bad. We never advocate a position. We
              explain impact as fact: what would concretely change for someone
              with your profile. The civic actions we suggest (contacting your
              representative, attending a hearing, registering to vote) are
              available to everyone regardless of political view.
            </p>
          </div>
        </div>

        <div className={styles.section}>
          <h2>The technology</h2>
          <div className={styles.techGrid}>
            {[
              {
                name: 'LegiScan API',
                desc: 'Covers all 50 states and Congress. Real federal and state bills, real status, updated daily.',
                badge: 'Data source'
              },
              {
                name: 'Claude AI (Anthropic)',
                desc: 'Generates personalized plain-language explanations of each bill based on your profile. Prompted to be strictly nonpartisan.',
                badge: 'Personalization'
              },
              {
                name: 'Privacy-first design',
                desc: 'No account required. Your profile stays in your browser by default. Optional sign-in stores your profile and bookmarks securely in our database, never shared or sold.',
                badge: 'Privacy'
              },
            ].map(t => (
              <div key={t.name} className={styles.techCard}>
                <span className={styles.techBadge}>{t.badge}</span>
                <h3>{t.name}</h3>
                <p>{t.desc}</p>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.section}>
          <h2>Built by a student</h2>
          <p>
            CapitolKey was built by a high school student who serves on his town's
            Board of Education, Commission on Aging, and Community Fund board. The
            goal is simple: give every student the same civic information that
            policy professionals have access to, in a format that actually makes sense.
          </p>
        </div>

        <div className={styles.cta}>
          <h2>Ready to see your legislation?</h2>
          <button className={styles.ctaBtn} onClick={() => navigate('/profile')}>
            Build my profile →
          </button>
        </div>

        <div className={styles.legal}>
          <button onClick={() => navigate('/privacy')}>Privacy Policy</button>
          <span className={styles.legalDot}>·</span>
          <button onClick={() => navigate('/terms')}>Terms of Service</button>
          <span className={styles.legalDot}>·</span>
          <button onClick={() => navigate('/contact')}>Contact</button>
        </div>

      </div>
    </main>
  )
}
