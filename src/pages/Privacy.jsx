import { useNavigate } from 'react-router-dom'
import styles from './Privacy.module.css'

export default function Privacy() {
  const navigate = useNavigate()

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <button className={styles.backBtn} onClick={() => navigate(-1)}>
          ← Back
        </button>

        <h1>Privacy Policy</h1>
        <p className={styles.updated}>Last updated: March 30, 2026</p>

        <section className={styles.section}>
          <h2>What GovDecoded Does</h2>
          <p>
            GovDecoded is a nonpartisan civic education tool that explains how
            real federal legislation could affect your daily life. We pull bill
            data from the official Congress.gov API and use AI to generate
            personalized, plain-language explanations based on your profile.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Information We Collect</h2>
          <h3>Profile information you provide</h3>
          <p>
            When you build your profile, you tell us your state, grade level,
            job status, and topic interests. This information is used solely to
            personalize bill explanations. No account is required — your profile
            is stored locally in your browser by default.
          </p>
          <h3>Account information (optional)</h3>
          <p>
            If you choose to create an account, we store your email address and
            profile in our database (hosted on Supabase) so you can access your
            bookmarks and profile across devices. We use Google OAuth or
            email/password authentication provided by Supabase.
          </p>
          <h3>Usage data</h3>
          <p>
            If you are signed in, we track which bill topics you interact with
            (e.g., viewing a bill detail page) to improve the relevance of
            future bill recommendations. We do not track individual page views,
            browsing history, or any activity outside the app.
          </p>
          <h3>Push notification tokens</h3>
          <p>
            If you opt in to push notifications on a mobile device, we store
            your device token to send you alerts when bookmarked bills have
            status updates. You can revoke this at any time in your device
            settings.
          </p>
        </section>

        <section className={styles.section}>
          <h2>How We Use Your Information</h2>
          <ul>
            <li>Personalizing bill explanations to your specific profile</li>
            <li>Improving bill recommendations based on your interests</li>
            <li>Sending email or push notifications about bookmarked bill updates (if you opt in)</li>
            <li>Maintaining your account and saved bookmarks</li>
          </ul>
          <p>We do not use your information for advertising, marketing, or any purpose unrelated to the app.</p>
        </section>

        <section className={styles.section}>
          <h2>Information We Share</h2>
          <p>
            We do not sell, rent, or share your personal information with third
            parties. Your profile data is sent to Anthropic (Claude AI) solely
            to generate personalized bill explanations — no personally
            identifiable information (name, email, exact age) is included in
            these requests, only your state, grade, job status, and interests.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Data Storage and Security</h2>
          <p>
            Account data is stored on Supabase (cloud-hosted PostgreSQL).
            Anonymous profiles are stored only in your browser's session storage
            and are not transmitted to our servers. We use HTTPS for all data
            transmission and bearer token authentication for API access.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Your Rights</h2>
          <ul>
            <li>
              <strong>Access and portability:</strong> You can view all data
              associated with your account at any time.
            </li>
            <li>
              <strong>Deletion:</strong> You can delete your account and all
              associated data from the Settings section of the app. This
              permanently removes your profile, bookmarks, interaction history,
              and push tokens.
            </li>
            <li>
              <strong>Opt out:</strong> You can use GovDecoded without an
              account. You can disable email and push notifications at any time.
            </li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2>Children's Privacy</h2>
          <p>
            GovDecoded is designed for high school students (ages 14–18). We
            collect only the minimum information needed to personalize civic
            education content. We do not knowingly collect sensitive personal
            information from children under 13. If you believe a child under 13
            has provided us with personal information, please contact us so we
            can delete it.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Third-Party Services</h2>
          <ul>
            <li><strong>Congress.gov API</strong> — Official U.S. government bill data</li>
            <li><strong>Anthropic (Claude AI)</strong> — Bill personalization (no PII sent)</li>
            <li><strong>Supabase</strong> — Authentication and database</li>
            <li><strong>Firebase Cloud Messaging</strong> — Push notifications</li>
            <li><strong>Resend</strong> — Email notifications</li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2>Changes to This Policy</h2>
          <p>
            We may update this privacy policy from time to time. We will notify
            users of material changes by updating the "Last updated" date at the
            top of this page.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Contact</h2>
          <p>
            If you have questions about this privacy policy or your data, please
            contact us at <a href="mailto:privacy@govdecoded.app">privacy@govdecoded.app</a>.
          </p>
        </section>
      </div>
    </main>
  )
}
