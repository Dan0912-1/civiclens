import styles from './About.module.css'

export default function Privacy() {
  return (
    <main className={styles.page}>
      <div className={styles.container}>

        <div className={styles.hero}>
          <h1>Privacy Policy</h1>
          <p>Last updated: March 31, 2026</p>
        </div>

        <div className={styles.section}>
          <h2>What we collect</h2>
          <p>
            GovDecoded collects only the information you provide during
            onboarding: your U.S. state, grade level, employment status, and
            topic interests. If you create an account, we also store your email
            address for authentication and optional notifications.
          </p>
          <p>
            When you interact with bills (viewing details, saving, or expanding
            cards), we record those interactions to improve your recommendations.
            On mobile, we store a device token for push notifications if you
            grant permission.
          </p>
        </div>

        <div className={styles.section}>
          <h2>How we use your data</h2>
          <p>
            Your profile information is used solely to personalize legislation
            explanations to your situation. Interaction data helps us surface
            more relevant bills over time. We never use your data for
            advertising, profiling, or any purpose unrelated to the core
            GovDecoded experience.
          </p>
        </div>

        <div className={styles.section}>
          <h2>What we share</h2>
          <p>
            We do not sell, rent, or share your personal information with any
            third party. Your profile data is sent to Anthropic's Claude AI
            solely for generating personalized bill explanations. No other
            third party receives your data.
          </p>
        </div>

        <div className={styles.section}>
          <h2>Data storage and security</h2>
          <p>
            Account data is stored securely in Supabase (hosted on AWS) with
            row-level security policies ensuring users can only access their own
            data. Without an account, your profile is stored locally in your
            browser's session storage and is never transmitted to our servers.
          </p>
        </div>

        <div className={styles.section}>
          <h2>Your choices</h2>
          <p>
            You can use GovDecoded without creating an account. If you do create
            one, you can disable email and push notifications at any time from
            the Saved Bills page. You may delete your account by contacting us
            at the email below.
          </p>
        </div>

        <div className={styles.section}>
          <h2>Children's privacy</h2>
          <p>
            GovDecoded is designed for high school students (ages 14-18). We
            collect the minimum data necessary for the service to function. We
            do not knowingly collect data from children under 13. If you believe
            a child under 13 has provided us data, please contact us so we can
            remove it.
          </p>
        </div>

        <div className={styles.section}>
          <h2>Contact</h2>
          <p>
            For questions about this privacy policy or to request data deletion,
            email us at{' '}
            <a href="mailto:support@govdecoded.app" style={{ color: 'var(--amber)' }}>
              support@govdecoded.app
            </a>.
          </p>
        </div>

      </div>
    </main>
  )
}
