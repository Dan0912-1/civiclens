import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { saveProfile } from '../lib/userProfile'
import AuthModal from '../components/AuthModal.jsx'
import styles from './Profile.module.css'

const US_STATES = [
  { code: 'AL', name: 'Alabama' },
  { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' },
  { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'DE', name: 'Delaware' },
  { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' },
  { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' },
  { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
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

const EMPLOYMENT_OPTIONS = [
  { value: 'none',      label: 'No job' },
  { value: 'part_time', label: 'Part-time' },
  { value: 'full_time', label: 'Full-time' },
]

const CAREER_OPTIONS = [
  { value: 'healthcare',     label: 'Healthcare / Medicine' },
  { value: 'education',      label: 'Education / Teaching' },
  { value: 'tech',           label: 'Tech / Engineering' },
  { value: 'business',       label: 'Business / Entrepreneurship' },
  { value: 'arts',           label: 'Arts / Media' },
  { value: 'law',            label: 'Law / Government' },
  { value: 'trades',         label: 'Trades / Construction' },
  { value: 'military',       label: 'Military / Service' },
  { value: 'science',        label: 'Science / Research' },
  { value: 'sports',         label: 'Sports / Athletics' },
  { value: 'undecided',      label: 'Undecided' },
]

const SUB_INTERESTS = {
  education:    ['Student loans', 'School safety', 'College access', 'Teacher quality', 'Special ed'],
  environment:  ['Climate change', 'Clean water', 'Wildlife', 'Renewable energy', 'Pollution'],
  economy:      ['Minimum wage', 'Student debt', 'Gig economy', 'Cost of living', 'Small business'],
  healthcare:   ['Mental health', 'Drug costs', 'School health', 'Insurance access', 'Substance abuse'],
  technology:   ['AI & algorithms', 'Data privacy', 'Social media', 'Broadband access', 'Cybersecurity'],
  housing:      ['Rent & affordability', 'Homelessness', 'Tenant rights', 'Public housing', 'Zoning'],
  immigration:  ['DACA & Dreamers', 'Visas', 'Asylum', 'Citizenship', 'Border policy'],
  civil_rights: ['Voting access', 'Police reform', 'Disability rights', 'LGBTQ rights', 'Equal pay'],
  community:    ['National service', 'Food assistance', 'Libraries', 'Rural development', 'Nonprofits'],
}

export default function Profile() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const [step, setStep] = useState(1)
  const returnTo = location.state?.returnTo || null

  const [profile, setProfile] = useState(() => {
    const stored = sessionStorage.getItem('civicProfile')
    const base = {
      state: '',
      grade: '',
      employment: 'none',
      familySituation: [],
      interests: [],
      subInterests: [],
      career: '',
      additionalContext: '',
    }
    if (!stored) return base
    const parsed = JSON.parse(stored)
    // Backwards-compat migration: hasJob:bool → employment, familySituation:string → array
    const employment = parsed.employment
      ?? (parsed.hasJob === true ? 'part_time' : 'none')
    const familySituation = Array.isArray(parsed.familySituation)
      ? parsed.familySituation
      : (parsed.familySituation ? [parsed.familySituation] : [])
    return { ...base, ...parsed, employment, familySituation }
  })
  const [error, setError] = useState('')
  const [showAuth, setShowAuth] = useState(false)

  function toggleInterest(id) {
    setProfile(prev => ({
      ...prev,
      interests: prev.interests.includes(id)
        ? prev.interests.filter(i => i !== id)
        : [...prev.interests, id],
      // Remove sub-interests for deselected categories
      subInterests: prev.interests.includes(id)
        ? prev.subInterests.filter(si => !(SUB_INTERESTS[id] || []).includes(si))
        : prev.subInterests,
    }))
  }

  function toggleSubInterest(sub) {
    setProfile(prev => ({
      ...prev,
      subInterests: prev.subInterests.includes(sub)
        ? prev.subInterests.filter(s => s !== sub)
        : [...prev.subInterests, sub]
    }))
  }

  const ageNum = Number(profile.grade)
  const ageValid = profile.grade !== '' && !isNaN(ageNum) && Number.isInteger(ageNum) && ageNum > 0
  const isUnder13 = ageValid && ageNum < 13

  function canAdvance() {
    if (step === 1) return profile.state && ageValid && ageNum >= 13
    if (step === 2) return true
    if (step === 3) return profile.interests.length > 0
    return true
  }

  async function handleNext() {
    if (!canAdvance()) {
      if (step === 1 && isUnder13) {
        setError('You must be 13 or older to use CapitolKey.')
      } else if (step === 1 && profile.grade && !ageValid) {
        setError('Please enter a valid age.')
      } else {
        setError('Please fill in the required fields.')
      }
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

        {/* Sign-in prompt for anonymous users */}
        {!user && step === 1 && (
          <div className={styles.signInPrompt}>
            <p>Create an account to save your profile and bookmarks across sessions.</p>
            <button className={styles.signInBtn} onClick={() => setShowAuth(true)}>
              Sign in or create account
            </button>
          </div>
        )}

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
                  {US_STATES.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
                </select>
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Your age <span className={styles.req}>*</span></label>
                <input
                  type="number"
                  className={styles.ageInput}
                  placeholder="Enter your age"
                  min={13}
                  max={99}
                  step={1}
                  value={profile.grade}
                  onChange={e => setProfile(p => ({ ...p, grade: e.target.value }))}
                />
                {isUnder13 && (
                  <div className={styles.ageWarning}>
                    <p>
                      CapitolKey is designed for users who are <strong>13 years of age or older</strong>,
                      in compliance with the Children's Online Privacy Protection Act (COPPA).
                    </p>
                    <p>
                      If you are under 13, you are not able to use CapitolKey at this time.
                      See our <a href="/terms">Terms of Service</a> for more information.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 2 — Situation */}
          {step === 2 && (
            <div className={styles.stepContent}>
              <h2 className={styles.stepHeading}>Your situation</h2>
              <p className={styles.stepSub}>Helps us personalize which bills matter to your life.</p>

              <div className={styles.field}>
                <label className={styles.label}>Are you working?</label>
                <div className={styles.toggleRow}>
                  {EMPLOYMENT_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      className={`${styles.toggleBtn} ${profile.employment === opt.value ? styles.toggleActive : ''}`}
                      onClick={() => setProfile(p => ({ ...p, employment: opt.value }))}
                    >{opt.label}</button>
                  ))}
                </div>
              </div>

              <div className={styles.field}>
                <label className={styles.label}>
                  Family situation <span className={styles.optional}>(select all that apply)</span>
                </label>
                <div className={styles.familyGrid}>
                  {FAMILY_OPTIONS.map(opt => {
                    const selected = profile.familySituation.includes(opt.value)
                    return (
                      <button
                        key={opt.value}
                        className={`${styles.familyBtn} ${selected ? styles.familyBtnActive : ''}`}
                        onClick={() => setProfile(p => ({
                          ...p,
                          familySituation: selected
                            ? p.familySituation.filter(v => v !== opt.value)
                            : [...p.familySituation, opt.value]
                        }))}
                      >
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className={styles.field}>
                <label className={styles.label}>What career are you thinking about? <span className={styles.optional}>(optional)</span></label>
                <div className={styles.familyGrid}>
                  {CAREER_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      className={`${styles.familyBtn} ${profile.career === opt.value ? styles.familyBtnActive : ''}`}
                      onClick={() => setProfile(p => ({ ...p, career: p.career === opt.value ? '' : opt.value }))}
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
                  rows={2}
                />
              </div>
            </div>
          )}

          {/* Step 3 — Interests + Sub-interests */}
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

              {/* Sub-interest chips for selected categories */}
              {profile.interests.length > 0 && (
                <div className={styles.subInterestsSection}>
                  <p className={styles.subInterestsLabel}>
                    Get more specific <span className={styles.optional}>(optional)</span>
                  </p>
                  {profile.interests.map(interestId => {
                    const subs = SUB_INTERESTS[interestId]
                    if (!subs) return null
                    const interest = INTERESTS.find(i => i.id === interestId)
                    return (
                      <div key={interestId} className={styles.subInterestGroup}>
                        <span className={styles.subInterestCategory}>{interest?.emoji} {interest?.label}</span>
                        <div className={styles.subInterestChips}>
                          {subs.map(sub => (
                            <button
                              key={sub}
                              className={`${styles.subInterestChip} ${profile.subInterests.includes(sub) ? styles.subInterestChipActive : ''}`}
                              onClick={() => toggleSubInterest(sub)}
                            >
                              {sub}
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {error && <p className={styles.error}>{error}</p>}

          <div className={styles.navRow}>
            {step > 1 && (
              <button className={styles.backBtn} onClick={() => { setStep(s => s - 1); setError('') }}>
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

      <AuthModal isOpen={showAuth} onClose={() => setShowAuth(false)} />
    </main>
  )
}
