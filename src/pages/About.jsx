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
                name: 'Our own scraping pipeline',
                desc: 'We pull bill text directly from every state legislature and Congress, normalize it, and store it in our Supabase database. Covers all 50 states, updated daily.',
                badge: 'Data source'
              },
              {
                name: 'Qwen (via Groq) + Claude fallback',
                desc: 'AI generates personalized plain-language explanations of each bill based on your profile. Prompted to be strictly nonpartisan.',
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
          <h2>Frequently asked</h2>
          <div className={styles.faqList}>

            <details className={styles.faq}>
              <summary>Is CapitolKey free to use?</summary>
              <p>
                Yes. CapitolKey is free for students, teachers, and anyone who
                wants to understand what's happening in Congress and their
                state legislature. There's no paywall, no subscription, and
                no ads.
              </p>
            </details>

            <details className={styles.faq}>
              <summary>Do I need to create an account?</summary>
              <p>
                No. You can set up a profile and browse personalized legislation
                anonymously, with everything stored only in your browser.
                Signing in with Google or email is optional and lets you sync
                your profile, bookmarks, and notification preferences across
                devices.
              </p>
            </details>

            <details className={styles.faq}>
              <summary>How do you decide which bills to show me?</summary>
              <p>
                Our scrapers pull real bills from Congress and your state
                legislature every day, then we rank them using the policy
                areas you selected in your profile together with your past
                interactions (views, bookmarks, opens). The feed adapts over
                time so you see more of what's relevant to you and less of
                what isn't.
              </p>
            </details>

            <details className={styles.faq}>
              <summary>How do I know the summaries are nonpartisan?</summary>
              <p>
                The AI model that writes summaries is prompted to describe
                impact as fact, never to recommend a position. Every bill page
                shows both what would change if the bill passes and what stays
                the same if it fails, so both outcomes are visible side by side.
                The original bill text is always linked so you can read the
                source yourself.
              </p>
            </details>

            <details className={styles.faq}>
              <summary>Can the AI get a bill wrong?</summary>
              <p>
                Sometimes, yes. Language models occasionally misread complex
                legislative text, especially amendments that reference other
                statutes. We review flagged summaries and adjust our prompts
                when we find systematic errors. If you spot a summary that
                looks off, please send feedback through the Contact page.
              </p>
            </details>

            <details className={styles.faq}>
              <summary>Why do you ask for my state and grade level?</summary>
              <p>
                Your state determines which state legislature we track for you.
                Grade level helps the AI choose examples and vocabulary that
                fit your age. Neither field is shared outside the app.
              </p>
            </details>

            <details className={styles.faq}>
              <summary>Do you sell or share my data?</summary>
              <p>
                No. We don't sell, rent, or share your personal information
                with advertisers, data brokers, or third parties. Your profile
                is used only to personalize the bills you see. Full details
                are in our Privacy Policy.
              </p>
            </details>

            <details className={styles.faq}>
              <summary>Do you cover local or city-level legislation?</summary>
              <p>
                Not yet. CapitolKey currently covers the U.S. Congress and all
                50 state legislatures. Town councils, county boards, and school
                boards are on our roadmap.
              </p>
            </details>

            <details className={styles.faq}>
              <summary>How often is bill data updated?</summary>
              <p>
                Our pipeline refreshes federal and state bill data every day,
                pulling directly from each legislature's official site. Status
                changes (introduced, in committee, passed, signed into law)
                typically appear the same day they happen.
              </p>
            </details>

            <details className={styles.faq}>
              <summary>Can teachers use CapitolKey in class?</summary>
              <p>
                Yes. CapitolKey includes a classroom mode where teachers can
                create a class, share a join code, pin specific bills, and
                track student engagement. The Educators page has standards
                alignment and lesson ideas.
              </p>
            </details>

            <details className={styles.faq}>
              <summary>What happens when I click "Contact your representative"?</summary>
              <p>
                We link you to your official federal or state representative's
                contact form. We never send messages on your behalf, and we
                don't see or store what you write to them.
              </p>
            </details>

            <details className={styles.faq}>
              <summary>Why can't I select New Hampshire?</summary>
              <p>
                The New Hampshire state legislature's website uses bot-protection
                that blocks automated access to bill text. Most other states
                publish bills as static PDFs or through an API, but NH serves
                bills through an ASP.NET form flow layered with an anti-scraping
                script, so our normal pipeline can't pull them reliably. We're
                exploring a browser-based workaround and will re-enable NH once
                we can serve accurate, up-to-date bill text.
              </p>
            </details>

            <details className={styles.faq}>
              <summary>How can I report an error or share feedback?</summary>
              <p>
                The fastest way is the Contact page. Tell us the bill ID and
                what looked wrong, and we'll review it. We treat feedback on
                summary accuracy as high priority, because the whole value of
                CapitolKey depends on being trustworthy.
              </p>
            </details>

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
