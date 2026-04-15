import styles from './Privacy.module.css'

export default function Privacy() {
  return (
    <main className={styles.page}>
      <div className={styles.container}>

        <div className={styles.hero}>
          <h1>Privacy Policy</h1>
          <p>Last updated: April 5, 2026</p>
        </div>

        <div className={styles.section}>
          <h2>What we collect</h2>
          <p>
            CapitolKey collects only the information you provide during
            onboarding: your U.S. state, age range, employment status, family
            situation, and topic interests. If you create an account, we also
            store your email address for authentication and optional
            notifications.
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
            CapitolKey experience.
          </p>
        </div>

        <div className={styles.section}>
          <h2>What we share</h2>
          <p>
            We do not sell, rent, or share your personal information with any
            third party for marketing or advertising purposes. Your profile data
            is sent to our AI providers (Groq and Anthropic) solely for generating
            personalized bill explanations. Your data is anonymized before
            processing. No name, email, or account ID is included. No other
            third party receives your data.
          </p>
        </div>

        <div className={styles.section}>
          <h2>Third-party services</h2>
          <p>
            CapitolKey uses the following third-party services to operate:
          </p>
          <ul style={{ color: 'var(--text-secondary)', lineHeight: 1.75, paddingLeft: '1.25rem', marginTop: '0.5rem' }}>
            <li><strong>Supabase</strong>: authentication, database, and user data storage (hosted on AWS)</li>
            <li><strong>Groq (Qwen3-32B)</strong>: primary AI provider for personalized bill explanations (anonymized profile data only)</li>
            <li><strong>Anthropic Claude AI</strong>: backup AI provider for bill explanations</li>
            <li><strong>LegiScan</strong>: provides federal and state legislation data</li>
            <li><strong>Google OAuth / Apple Sign-In</strong>: optional account authentication</li>
            <li><strong>Firebase Cloud Messaging</strong>: push notifications on mobile (if enabled)</li>
            <li><strong>Resend</strong>: email notifications (if enabled)</li>
          </ul>
          <p>
            These services may process limited data as necessary to provide their
            functionality. Each operates under its own privacy policy.
          </p>
        </div>

        <div className={styles.section}>
          <h2>School and Classroom Use</h2>
          <p>
            CapitolKey can be used in classroom settings by teachers and students
            aged 13 and older. When CapitolKey is used in a school context, the
            school or district may have additional obligations under the Family
            Educational Rights and Privacy Act (FERPA). Schools are responsible
            for ensuring their use of CapitolKey complies with applicable FERPA
            requirements.
          </p>
          <p>
            Teachers who create classrooms on CapitolKey can view aggregate
            completion statistics (such as how many students completed an
            assignment) but cannot access individual student profiles or
            personalized bill explanations.
          </p>
          <p>
            Classroom data, including assignments and completion records, is
            deleted when a classroom is archived by the teacher and permanently
            removed from our systems within 30 days of archival.
          </p>
          <p>
            Schools may request data deletion for all students in their
            classrooms by contacting us at{' '}
            <a href="mailto:capitolkeyapp@gmail.com" style={{ color: 'var(--amber)' }}>
              capitolkeyapp@gmail.com
            </a>.
          </p>

          <h3 style={{ marginTop: '1.5rem', marginBottom: '0.75rem', fontSize: '1.1rem', color: 'var(--navy)' }}>Parental Notice</h3>
          <div className={styles.neutralBox}>
            <div className={styles.neutralIcon}>&#9432;</div>
            <p>
              If you are under 18 and using CapitolKey through a school, your
              parent or guardian should be aware that your anonymized profile
              data (state, age range, interests) is processed by AI to generate
              bill explanations. No personally identifying information is shared
              with AI providers.
            </p>
          </div>
        </div>

        <div className={styles.section}>
          <h2>Data storage and security</h2>
          <p>
            Account data is stored securely in Supabase (hosted on AWS) with
            strict security policies ensuring users can only access their own
            data. Without an account, your profile is stored locally in your
            browser's session storage and is never transmitted to our servers.
          </p>
          <p>
            We use industry-standard security measures including HTTPS encryption,
            secure authentication tokens, and rate limiting to protect your data.
            However, no method of electronic transmission or storage is 100%
            secure, and we cannot guarantee absolute security.
          </p>
        </div>

        <div className={styles.section}>
          <h2>Data retention</h2>
          <p>
            We retain your account data for as long as your account is active. If
            you request account deletion, we will remove your personal data within
            30 days. Anonymized, aggregated data (such as total interaction counts)
            may be retained for service improvement purposes.
          </p>
          <p>
            If you use CapitolKey without an account, your profile data exists only
            in your browser's session storage and is automatically cleared when you
            close the browser tab.
          </p>
        </div>

        <div className={styles.section}>
          <h2>Your rights and choices</h2>
          <p>
            You can use CapitolKey without creating an account. If you do create
            one, you have the right to:
          </p>
          <ul style={{ color: 'var(--text-secondary)', lineHeight: 1.75, paddingLeft: '1.25rem', marginTop: '0.5rem' }}>
            <li><strong>Access</strong>: request a copy of your stored data</li>
            <li><strong>Correction</strong>: update your profile information at any time</li>
            <li><strong>Deletion</strong>: request complete removal of your account and data</li>
            <li><strong>Opt out</strong>: disable email and push notifications at any time</li>
          </ul>
          <p>
            To exercise any of these rights, contact us at the email below.
          </p>
        </div>

        <div className={styles.section}>
          <h2>Children's privacy (COPPA compliance)</h2>
          <div className={styles.neutralBox}>
            <div className={styles.neutralIcon}>&#9432;</div>
            <p>
              CapitolKey is intended for users aged 13 and older. We do not
              knowingly collect, use, or disclose personal information from
              children under the age of 13, in compliance with the Children's
              Online Privacy Protection Act (COPPA). If you are under 13, please
              do not use CapitolKey or provide any personal information.
            </p>
          </div>
          <p>
            If we learn that we have inadvertently collected personal information
            from a child under 13, we will take steps to delete that information
            as promptly as possible. If you believe a child under 13 has provided
            us with personal information, please contact us immediately at the
            email below.
          </p>
        </div>

        <div className={styles.section}>
          <h2>California residents (CCPA)</h2>
          <p>
            If you are a California resident, you have additional rights under the
            California Consumer Privacy Act (CCPA), including the right to know
            what personal information we collect, the right to delete your data,
            and the right to opt out of the sale of your data. We do not sell
            personal information. To exercise your CCPA rights, contact us at the
            email below.
          </p>
        </div>

        <div className={styles.section}>
          <h2>Changes to this policy</h2>
          <p>
            We may update this Privacy Policy from time to time. If we make
            material changes, we will notify users through the app or by email (if
            you have an account). Continued use of CapitolKey after changes
            constitutes acceptance of the updated policy. We encourage you to
            review this page periodically.
          </p>
        </div>

        <div className={styles.section}>
          <h2>Contact</h2>
          <p>
            For questions about this privacy policy, to request data deletion, or
            to exercise any of your privacy rights, email us at{' '}
            <a href="mailto:capitolkeyapp@gmail.com" style={{ color: 'var(--amber)' }}>
              capitolkeyapp@gmail.com
            </a>.
          </p>
        </div>

      </div>
    </main>
  )
}
