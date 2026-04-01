import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import styles from './Onboarding.module.css'

const SLIDES = [
  {
    icon: '\uD83C\uDFDB\uFE0F',
    title: 'Real bills. Real impact.',
    body: 'CapitolKey pulls live legislation moving through Congress and shows you exactly how it could affect your life.',
  },
  {
    icon: '\uD83C\uDFAF',
    title: 'Personalized to you',
    body: 'Tell us your state, grade, and interests — we\'ll find the bills that matter most and explain them in plain English.',
  },
  {
    icon: '\u2696\uFE0F',
    title: 'Always nonpartisan',
    body: 'We explain impact, never opinions. You decide what you think — we just make sure you have the facts.',
  },
]

export default function Onboarding({ onComplete }) {
  const [slide, setSlide] = useState(0)
  const navigate = useNavigate()
  const isLast = slide === SLIDES.length - 1

  function next() {
    if (isLast) {
      onComplete()
      navigate('/profile')
    } else {
      setSlide(s => s + 1)
    }
  }

  function skip() {
    onComplete()
    navigate('/profile')
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.container}>
        <button className={styles.skip} onClick={skip}>Skip</button>

        <div className={styles.slideArea}>
          <div className={styles.icon}>{SLIDES[slide].icon}</div>
          <h2 className={styles.title}>{SLIDES[slide].title}</h2>
          <p className={styles.body}>{SLIDES[slide].body}</p>
        </div>

        {/* Dots */}
        <div className={styles.dots}>
          {SLIDES.map((_, i) => (
            <div
              key={i}
              className={`${styles.dot} ${i === slide ? styles.dotActive : ''}`}
            />
          ))}
        </div>

        <button className={styles.nextBtn} onClick={next}>
          {isLast ? 'Get started' : 'Next'}
        </button>
      </div>
    </div>
  )
}
