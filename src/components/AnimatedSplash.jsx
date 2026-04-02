import { useState, useEffect } from 'react'
import logoSrc from '../assets/logo.png'
import styles from './AnimatedSplash.module.css'

// Phases: idle → reveal → glow → text → fadeOut → done
const TIMELINE = {
  reveal: 200,
  glow: 1000,
  text: 1600,
  fadeOut: 2800,
  done: 3400,
}

export default function AnimatedSplash({ onComplete, onUnlock }) {
  const [phase, setPhase] = useState('idle')

  useEffect(() => {
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    if (reducedMotion) {
      setTimeout(() => setPhase('fadeOut'), 300)
      setTimeout(() => onComplete?.(), 800)
      return
    }

    const timers = Object.entries(TIMELINE).map(([p, ms]) =>
      setTimeout(() => {
        setPhase(p)
        if (p === 'glow') onUnlock?.()
        if (p === 'done') onComplete?.()
      }, ms)
    )
    return () => timers.forEach(clearTimeout)
  }, [onComplete, onUnlock])

  const past = (p) => {
    const order = ['idle', 'reveal', 'glow', 'text', 'fadeOut', 'done']
    return order.indexOf(phase) >= order.indexOf(p)
  }

  if (phase === 'done') return null

  return (
    <div className={`${styles.overlay} ${phase === 'fadeOut' ? styles.fadeOut : ''}`}>
      <div className={styles.logoWrap}>
        {/* Golden glow behind logo */}
        <div className={`${styles.glow} ${past('glow') ? styles.glowActive : ''}`} />

        {/* Actual app icon */}
        <img
          src={logoSrc}
          alt=""
          className={`${styles.logo} ${
            past('reveal') ? styles.logoReveal : ''
          } ${
            past('glow') ? styles.logoUnlock : ''
          }`}
        />
      </div>

      {/* Brand text */}
      <div className={`${styles.brandText} ${past('text') ? styles.textReveal : ''}`}>
        CapitolKey
      </div>
      <div className={`${styles.tagline} ${past('text') ? styles.taglineReveal : ''}`}>
        Legislation that affects you
      </div>
    </div>
  )
}
