import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext.jsx'
import styles from './Profile.module.css'

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC'
]

const INTERESTS = [
  { id: 'education',   label: 'Education',     emoji: '📚' },
  { id: 'environment', label: 'Environment',   emoji: '🌿' },
  { id: 'economy',     label: 'Economy & Jobs', emoji: '💼' },
  { id: 'healthcare',  label: 'Healthcare',    emoji: '🏥' },
  { id: 'technology',  label: 'Technology',    emoji: '💻' },
  { id: 'housing',     label: 'Housing',       emoji: '🏠' },
  { id: 'immigration', label: 'Immigration',   emoji: '🌎' },
  { id: 'civil_rights',label: 'Civil Rights',  emoji: '⚖️' },
  { id: 'community',   label: 'Community',     emoji: '🤝' },
]

const FAMILY_OPTIONS = [
  { value: 'standard',    label: 'Living with parents/guardians' },
  { value: 'independent', label: 'Living independently' },
  { value: 'low_income',  label: 'Low-income household' },
  { value: 'immigrant',   label: 'Immigrant family' },
  { value: 'foster',      label: 'Foster care / group home' },
]

export default function Profile() {
  const navigate = useNavigate()
  const { user, saveProfile, loadProfile, signInWithGoogle, supabaseAvailable } = useAuth()
  const [step, setStep] = useState(1)
  const [profile, setProfile] = useState({
    state: '',
    grade: '',
    hasJob: false,
    familySituation: '',
    interests: [],
    additionalContext: '',
  })
  const [error, setError] = useState('')

  // Load saved profile if user is signed in
  useEffect(() => {
    loadProfile().then(saved => {
      if (saved) setProfile(saved)
    })
  }, [user])

  function toggleInterest(id) {
    setProfile(prev => ({
      ...prev,
      interests: prev.interests.includes(id)
        ? prev.interests.filter(i => i !== id)
        : [...prev.interests, id]
    }))
  }

  function canAdvance() {
    if (step === 1) return profile.state && profile.grade
    if (step === 2) return true
    if (step === 3) return profile.interests.length > 0
    return true
  }

  function handleNext() {
    if (!canAdvance()) {
      setError('Please fill in the required fields.')
      return
    }
    setError('')
    if (step < 3) {
      setStep(s => s + 1)
    } else {
      // Save profile (to Supabase if signed in, always to sessionStorage)
      saveProfile(profile)
      navigate('/results')
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.container}>

        {/* Sign in prompt */}
        {supabaseAvailable && !user && (
          <div className={styles.signInPrompt}>
            <p>Sign in to save your profile across sessions</p>
            <button className={styles.googleBtn} onClick={signInWithGoogle}>
              <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
              Continue with Google
            </button>
          </div>
        )}

        {/* Progress */}
        <div className={styles.progress}>
          {[1, 2, 3].map(n => (
            <div key={n} className={styles.progressStep}>
              <div className={`${styles.dot} ${step >= n ? styles.dotActive : ''} ${step > n ? styles.dotDone : ''}`}>
                {step > n ? '✓' : n}
              </div>
              <span className={styles.progressLabel}>
                {n === 1 ? 'Basics' : n === 2 ? 'Your situation' : 'Your interests'}
              </span>
            </div>
          ))}
        </div>

        <div className={styles.card}>

          {/* Step 1 — Basics */}
          {step === 1 && (
            <div className={styles.stepContent}>
              <h2 className={styles.stepHeading}>Tell us the basics</h2>
              <p className={styles.stepSub}>We use this to find legislation relevant to you.</p>

              <div className={styles.field}>
                <label className={styles.label}>Your state <span className={styles.req}>*</span></label>
                <select
                  className={styles.select}
                  value={profile.state}
                  onChange={e => setProfile(p => ({ ...p, state: e.target.value }))}
                >
                  <option value="">Select your state</option>
                  {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Your grade <span className={styles.req}>*</span></label>
                <div className={styles.gradeGrid}>
                  {['9', '10', '11', '12'].map(g => (
                    <button
                      key={g}
                      className={`${styles.gradeBtn} ${profile.grade === g ? styles.gradeBtnActive : ''}`}
                      onClick={() => setProfile(p => ({ ...p, grade: g }))}
                    >
                      {g === '9' ? '9th' : g === '10' ? '10th' : g === '11' ? '11th' : '12th'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 2 — Situation */}
          {step === 2 && (
            <div className={styles.stepContent}>
              <h2 className={styles.stepHeading}>Your situation</h2>
              <p className={styles.stepSub}>Helps us personalize which bills matter to your life.</p>

              <div className={styles.field}>
                <label className={styles.label}>Do you have a part-time job?</label>
                <div className={styles.toggleRow}>
                  <button
                    className={`${styles.toggleBtn} ${!profile.hasJob ? styles.toggleActive : ''}`}
                    onClick={() => setProfile(p => ({ ...p, hasJob: false }))}
                  >No</button>
                  <button
                    className={`${styles.toggleBtn} ${profile.hasJob ? styles.toggleActive : ''}`}
                    onClick={() => setProfile(p => ({ ...p, hasJob: true }))}
                  >Yes</button>
                </div>
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Family situation <span className={styles.optional}>(optional)</span></label>
                <div className={styles.familyGrid}>
                  {FAMILY_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      className={`${styles.familyBtn} ${profile.familySituation === opt.value ? styles.familyBtnActive : ''}`}
                      onClick={() => setProfile(p => ({
                        ...p,
                        familySituation: p.familySituation === opt.value ? '' : opt.value
                      }))}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Anything else relevant? <span className={styles.optional}>(optional)</span></label>
                <textarea
                  className={styles.textarea}
                  placeholder="e.g. I'm on a school sports team, I'm applying to college, I volunteer regularly..."
                  value={profile.additionalContext}
                  onChange={e => setProfile(p => ({ ...p, additionalContext: e.target.value }))}
                  rows={3}
                />
              </div>
            </div>
          )}

          {/* Step 3 — Interests */}
          {step === 3 && (
            <div className={styles.stepContent}>
              <h2 className={styles.stepHeading}>What issues matter to you?</h2>
              <p className={styles.stepSub}>Pick at least one. We'll prioritize bills in these areas.</p>
              <div className={styles.interestGrid}>
                {INTERESTS.map(i => (
                  <button
                    key={i.id}
                    className={`${styles.interestBtn} ${profile.interests.includes(i.id) ? styles.interestActive : ''}`}
                    onClick={() => toggleInterest(i.id)}
                  >
                    <span className={styles.interestEmoji}>{i.emoji}</span>
                    <span>{i.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && <p className={styles.error}>{error}</p>}

          <div className={styles.navRow}>
            {step > 1 && (
              <button className={styles.backBtn} onClick={() => setStep(s => s - 1)}>
                ← Back
              </button>
            )}
            <button
              className={`${styles.nextBtn} ${!canAdvance() ? styles.nextBtnDisabled : ''}`}
              onClick={handleNext}
            >
              {step === 3 ? 'Show me my legislation →' : 'Next →'}
            </button>
          </div>

        </div>
      </div>
    </main>
  )
}
