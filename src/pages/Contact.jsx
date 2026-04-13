import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getApiBase } from '../lib/api'
import styles from './Contact.module.css'

const API_BASE = getApiBase()

export default function Contact() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [form, setForm] = useState({
    name: '',
    email: user?.email || '',
    type: 'feedback',
    message: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.message.trim()) {
      setError('Please enter a message.')
      return
    }
    setError('')
    setSubmitting(true)
    try {
      const resp = await fetch(`${API_BASE}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (resp.ok) {
        setSubmitted(true)
      } else {
        setError('Something went wrong. Please try again.')
      }
    } catch {
      setError('Unable to send. Please check your connection and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <h1 className={styles.heading}>Contact Us</h1>
        <p className={styles.sub}>
          Have feedback, found a bug, or just want to say hi? We'd love to hear from you.
        </p>

        {submitted ? (
          <div className={styles.successCard}>
            <div className={styles.successIcon}>&#10003;</div>
            <h2>Thank you!</h2>
            <p>Your message has been sent. We'll get back to you if needed.</p>
            <button className={styles.backBtn} onClick={() => navigate('/results')}>
              Back to legislation
            </button>
          </div>
        ) : (
          <form className={styles.form} onSubmit={handleSubmit}>
            <div className={styles.field}>
              <label htmlFor="contact-name" className={styles.label}>Name <span className={styles.optional}>(optional)</span></label>
              <input
                id="contact-name"
                type="text"
                className={styles.input}
                placeholder="Your name"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>

            <div className={styles.field}>
              <label htmlFor="contact-email" className={styles.label}>Email <span className={styles.optional}>(optional)</span></label>
              <input
                id="contact-email"
                type="email"
                className={styles.input}
                placeholder="your@email.com"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label}>What's this about?</label>
              <div className={styles.typeGrid}>
                {[
                  { value: 'feedback', label: 'Feedback' },
                  { value: 'bug', label: 'Bug Report' },
                  { value: 'feature', label: 'Feature Request' },
                  { value: 'other', label: 'Other' },
                ].map(t => (
                  <button
                    key={t.value}
                    type="button"
                    className={`${styles.typeBtn} ${form.type === t.value ? styles.typeBtnActive : ''}`}
                    onClick={() => setForm(f => ({ ...f, type: t.value }))}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Message <span className={styles.req}>*</span></label>
              <textarea
                className={styles.textarea}
                placeholder="Tell us what's on your mind..."
                value={form.message}
                onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                rows={5}
                required
              />
            </div>

            {error && <p className={styles.error}>{error}</p>}

            <button className={styles.submitBtn} type="submit" disabled={submitting}>
              {submitting ? 'Sending...' : 'Send Message'}
            </button>
          </form>
        )}

        <div className={styles.altContact}>
          <p>You can also reach us directly at <a href="mailto:capitolkeyapp@gmail.com">capitolkeyapp@gmail.com</a></p>
        </div>
      </div>
    </main>
  )
}
