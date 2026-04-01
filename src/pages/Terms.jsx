import styles from './About.module.css'

export default function Terms() {
  return (
    <main className={styles.page}>
      <div className={styles.container}>

        <div className={styles.hero}>
          <h1>Terms of Service</h1>
          <p>Last updated: March 31, 2026</p>
        </div>

        <div className={styles.section}>
          <h2>Acceptance of terms</h2>
          <p>
            By using CapitolKey, you agree to these Terms of Service. If you do
            not agree, please do not use the app. We may update these terms from
            time to time; continued use after changes constitutes acceptance.
          </p>
        </div>

        <div className={styles.section}>
          <h2>What CapitolKey provides</h2>
          <p>
            CapitolKey is a nonpartisan civic education tool that displays
            publicly available federal legislation from Congress.gov and
            generates AI-powered plain-language explanations personalized to
            your profile. The app is designed for informational and educational
            purposes only.
          </p>
        </div>

        <div className={styles.section}>
          <h2>Not legal or political advice</h2>
          <div className={styles.neutralBox}>
            <div className={styles.neutralIcon}>&#9878;</div>
            <p>
              CapitolKey does not provide legal, political, or professional
              advice. AI-generated explanations are approximations and may not
              reflect every nuance of a bill. Always consult official sources or
              qualified professionals for decisions based on legislation.
            </p>
          </div>
        </div>

        <div className={styles.section}>
          <h2>Accounts and data</h2>
          <p>
            You may use CapitolKey without an account. If you create one, you
            are responsible for maintaining the security of your login
            credentials. We may suspend or delete accounts that violate these
            terms or are used for abusive purposes.
          </p>
        </div>

        <div className={styles.section}>
          <h2>Acceptable use</h2>
          <p>
            You agree not to use CapitolKey to:
          </p>
          <ul style={{ color: 'var(--text-secondary)', lineHeight: 1.75, paddingLeft: '1.25rem', marginTop: '0.5rem' }}>
            <li>Abuse, overload, or interfere with the service</li>
            <li>Scrape, crawl, or extract data in bulk</li>
            <li>Misrepresent AI-generated content as official government communication</li>
            <li>Use the service for any unlawful purpose</li>
          </ul>
        </div>

        <div className={styles.section}>
          <h2>Intellectual property</h2>
          <p>
            Legislation data is sourced from Congress.gov and is in the public
            domain. AI-generated explanations are provided for your personal,
            non-commercial use only. The CapitolKey&#x2122; name, app design,
            and source code are protected by copyright law. Unauthorized
            copying, reproduction, or redistribution is prohibited.
          </p>
        </div>

        <div className={styles.section}>
          <h2>Limitation of liability</h2>
          <p>
            CapitolKey is provided "as is" without warranties of any kind. We
            are not liable for any damages arising from your use of the service,
            including but not limited to inaccuracies in AI-generated content or
            service interruptions.
          </p>
        </div>

        <div className={styles.section}>
          <h2>Contact</h2>
          <p>
            For questions about these terms, email us at{' '}
            <a href="mailto:support@capitolkey.app" style={{ color: 'var(--amber)' }}>
              support@capitolkey.app
            </a>.
          </p>
        </div>

      </div>
    </main>
  )
}
