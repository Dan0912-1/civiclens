import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { saveProfile } from '../lib/userProfile'
import styles from './Profile.module.css'

// TODO: Expand to all states after testing phase
const US_STATES = ['CT']

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
  const location = useLocation()
  const { user } = useAuth()
  const [step, setStep] = useState(1)
  const returnTo = location.state?.returnTo || null

  const [profile, setProfile] = useState(() => {
    const stored = sessionStorage.getItem('civicProfile')
    return stored ? JSON.parse(stored) : {
      state: '',
      grade: '',
      hasJob: false,
      familySituation: '',
      interests: [],
      additionalContext: '',
    }
  })
  const [error, setError] = useState('')

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

  async function handleNext() {
    if (!canAdvance()) {
      setError('Please fill in the required fields.')
      return
    }
    setError('')
    if (step < 3) {
      setStep(s => s + 1)
    } else {
      // Save to sessionStorage and navigate
      sessionStorage.setItem('civicProfile', JSON.stringify(profile))
      if (user) await saveProfile(user.id, profile)
      navigate(returnTo || '/results')
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.container}>

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
                  {['9', '10', '11', '12', '18+'].map(g => (
                    <button
                      key={g}
                      className={`${styles.gradeBtn} ${profile.grade === g ? styles.gradeBtnActive : ''}`}
                      onClick={() => setProfile(p => ({ ...p, grade: g }))}
                    >
                      {g === '18+' ? '18+' : `${g}th`}
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
