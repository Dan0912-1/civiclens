import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import styles from './Onboarding.module.css'

const SLIDES = [
  {
    eyebrow: 'Mission',
    title: 'The Definitive Record of American Legislation.',
    body: 'CapitolKey tracks active bills across Congress and state legislatures, sourced directly from primary government records.',
  },
  {
    eyebrow: 'Method',
    title: 'Data-Driven Analysis. Verified Sources.',
    body: 'Every bill is filtered by jurisdiction, status, sponsor, and committee, then contextualized for your state and grade level.',
  },
  {
    eyebrow: 'Standard',
    title: 'Nonpartisan. Independently Operated.',
    body: 'CapitolKey reports legislative impact without editorial spin. No endorsements. No agenda.',
  },
]

export default function Onboarding({ onComplete }) {
  const [slide, setSlide] = useState(0)
  const navigate = useNavigate()
  const containerRef = useRef(null)
  const isLast = slide === SLIDES.length - 1

  // Focus trap + Escape key
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.focus()
    function handleKeyDown(e) {
      if (e.key === 'Escape') { skip(); return }
      if (e.key !== 'Tab') return
      const focusable = Array.from(el.querySelectorAll('button'))
      if (!focusable.length) return
      const first = focusable[0], last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    el.addEventListener('keydown', handleKeyDown)
    return () => el.removeEventListener('keydown', handleKeyDown)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function next() {
    if (isLast) {
      onComplete()
      navigate('/')
    } else {
      setSlide(s => s + 1)
    }
  }

  function skip() {
    onComplete()
    navigate('/')
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Welcome to CapitolKey">
      <div className={styles.container} ref={containerRef} tabIndex={-1}>
        <button className={styles.skip} onClick={skip}>Skip</button>

        <div className={styles.brandMark}>CAPITOLKEY</div>
        <div className={styles.rule} />

        <div className={styles.slideArea}>
          <div className={styles.eyebrow}>{SLIDES[slide].eyebrow}</div>
          <h2 className={styles.title}>{SLIDES[slide].title}</h2>
          <p className={styles.body}>{SLIDES[slide].body}</p>
        </div>

        <div className={styles.progressRow}>
          <span className={styles.progressLabel}>
            {String(slide + 1).padStart(2, '0')} / {String(SLIDES.length).padStart(2, '0')}
          </span>
          <div className={styles.progressBar}>
            {SLIDES.map((_, i) => (
              <div
                key={i}
                className={`${styles.progressSegment} ${i <= slide ? styles.progressSegmentActive : ''}`}
              />
            ))}
          </div>
        </div>

        <button className={styles.nextBtn} onClick={next}>
          {isLast ? 'Enter Platform →' : 'Continue →'}
        </button>

        <div className={styles.footer}>
          Nonpartisan · Independently Operated · Source: Congress.gov
        </div>
      </div>
    </div>
  )
}
