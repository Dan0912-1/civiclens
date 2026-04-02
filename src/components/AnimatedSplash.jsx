import { useState, useEffect } from 'react'
import styles from './AnimatedSplash.module.css'

// Phases: idle → keyMove → unlock → open → scrolls → fadeOut → done
const TIMELINE = {
  keyMove: 300,
  unlock: 900,
  open: 1300,
  scrolls: 1800,
  fadeOut: 2900,
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
        if (p === 'unlock') onUnlock?.()
        if (p === 'done') onComplete?.()
      }, ms)
    )
    return () => timers.forEach(clearTimeout)
  }, [onComplete, onUnlock])

  const past = (p) => {
    const order = ['idle', 'keyMove', 'unlock', 'open', 'scrolls', 'fadeOut', 'done']
    return order.indexOf(phase) >= order.indexOf(p)
  }

  if (phase === 'done') return null

  return (
    <div className={`${styles.overlay} ${phase === 'fadeOut' ? styles.fadeOut : ''}`}>
      <svg
        className={styles.scene}
        viewBox="0 0 200 260"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* ── Dome base / columns (stationary) ── */}
        <g>
          {/* Entablature */}
          <rect x="50" y="155" width="100" height="8" rx="1" fill="#f8f4ed" />
          {/* Columns */}
          <rect x="58" y="163" width="8" height="40" rx="1" fill="#f8f4ed" opacity="0.9" />
          <rect x="76" y="163" width="8" height="40" rx="1" fill="#f8f4ed" opacity="0.9" />
          <rect x="96" y="163" width="8" height="40" rx="1" fill="#f8f4ed" opacity="0.9" />
          <rect x="116" y="163" width="8" height="40" rx="1" fill="#f8f4ed" opacity="0.9" />
          <rect x="134" y="163" width="8" height="40" rx="1" fill="#f8f4ed" opacity="0.9" />
          {/* Base */}
          <rect x="45" y="203" width="110" height="6" rx="1" fill="#f8f4ed" />
        </g>

        {/* ── Dome left half ── */}
        <g className={`${styles.domeLeft} ${past('open') ? styles.domeOpenLeft : ''}`}>
          <clipPath id="domeClipLeft">
            <rect x="0" y="0" width="100" height="260" />
          </clipPath>
          <g clipPath="url(#domeClipLeft)">
            {/* Dome arc */}
            <path
              d="M50 155 Q50 90 100 70 L100 155 Z"
              fill="#f8f4ed"
            />
            {/* Cupola */}
            <rect x="90" y="60" width="10" height="14" rx="2" fill="#f8f4ed" />
            {/* Lantern */}
            <circle cx="95" cy="56" r="6" fill="#f8f4ed" />
            {/* Finial */}
            <circle cx="95" cy="47" r="3" fill="#f8f4ed" />
          </g>
        </g>

        {/* ── Dome right half ── */}
        <g className={`${styles.domeRight} ${past('open') ? styles.domeOpenRight : ''}`}>
          <clipPath id="domeClipRight">
            <rect x="100" y="0" width="100" height="260" />
          </clipPath>
          <g clipPath="url(#domeClipRight)">
            {/* Dome arc */}
            <path
              d="M150 155 Q150 90 100 70 L100 155 Z"
              fill="#f8f4ed"
            />
            {/* Cupola */}
            <rect x="100" y="60" width="10" height="14" rx="2" fill="#f8f4ed" />
            {/* Lantern */}
            <circle cx="105" cy="56" r="6" fill="#f8f4ed" />
            {/* Finial */}
            <circle cx="105" cy="47" r="3" fill="#f8f4ed" />
          </g>
        </g>

        {/* ── Keyhole (on dome body) ── */}
        <g>
          <circle cx="100" cy="120" r="6" fill="#0d1b2a" />
          <path d="M96 123 L100 140 L104 123 Z" fill="#0d1b2a" />
          {/* Glow effect on unlock */}
          {past('unlock') && (
            <g className={styles.keyholeGlow}>
              <circle cx="100" cy="120" r="10" fill="#e8a020" opacity="0.3" />
              <circle cx="100" cy="120" r="16" fill="#e8a020" opacity="0.1" />
            </g>
          )}
        </g>

        {/* ── Scrolls (emerge from dome opening) ── */}
        <g>
          {/* Left scroll */}
          <g className={`${styles.scroll} ${past('scrolls') ? `${styles.scrollRise} ${styles.scrollRise1}` : ''}`}>
            <rect x="72" y="80" width="18" height="50" rx="3" fill="#f8f4ed" opacity="0.85" />
            <circle cx="81" cy="78" r="4" fill="#f8f4ed" opacity="0.85" />
            <circle cx="81" cy="132" r="4" fill="#f8f4ed" opacity="0.85" />
            {/* Text lines */}
            <line x1="76" y1="90" x2="86" y2="90" stroke="#0d1b2a" strokeWidth="1" opacity="0.2" />
            <line x1="76" y1="96" x2="86" y2="96" stroke="#0d1b2a" strokeWidth="1" opacity="0.2" />
            <line x1="76" y1="102" x2="86" y2="102" stroke="#0d1b2a" strokeWidth="1" opacity="0.2" />
            <line x1="76" y1="108" x2="84" y2="108" stroke="#0d1b2a" strokeWidth="1" opacity="0.15" />
          </g>

          {/* Center scroll (taller) */}
          <g className={`${styles.scroll} ${past('scrolls') ? `${styles.scrollRise} ${styles.scrollRise2}` : ''}`}>
            <rect x="93" y="72" width="14" height="58" rx="3" fill="#f8f4ed" opacity="0.9" />
            <circle cx="100" cy="70" r="3.5" fill="#f8f4ed" opacity="0.9" />
            <circle cx="100" cy="132" r="3.5" fill="#f8f4ed" opacity="0.9" />
            {/* Text lines */}
            <line x1="96" y1="82" x2="104" y2="82" stroke="#0d1b2a" strokeWidth="1" opacity="0.2" />
            <line x1="96" y1="88" x2="104" y2="88" stroke="#0d1b2a" strokeWidth="1" opacity="0.2" />
            <line x1="96" y1="94" x2="104" y2="94" stroke="#0d1b2a" strokeWidth="1" opacity="0.2" />
            <line x1="96" y1="100" x2="104" y2="100" stroke="#0d1b2a" strokeWidth="1" opacity="0.2" />
            <line x1="96" y1="106" x2="102" y2="106" stroke="#0d1b2a" strokeWidth="1" opacity="0.15" />
          </g>

          {/* Right scroll */}
          <g className={`${styles.scroll} ${past('scrolls') ? `${styles.scrollRise} ${styles.scrollRise3}` : ''}`}>
            <rect x="110" y="80" width="18" height="50" rx="3" fill="#f8f4ed" opacity="0.85" />
            <circle cx="119" cy="78" r="4" fill="#f8f4ed" opacity="0.85" />
            <circle cx="119" cy="132" r="4" fill="#f8f4ed" opacity="0.85" />
            {/* Text lines */}
            <line x1="114" y1="90" x2="124" y2="90" stroke="#0d1b2a" strokeWidth="1" opacity="0.2" />
            <line x1="114" y1="96" x2="124" y2="96" stroke="#0d1b2a" strokeWidth="1" opacity="0.2" />
            <line x1="114" y1="102" x2="124" y2="102" stroke="#0d1b2a" strokeWidth="1" opacity="0.2" />
            <line x1="114" y1="108" x2="122" y2="108" stroke="#0d1b2a" strokeWidth="1" opacity="0.15" />
          </g>
        </g>

        {/* ── Key (animated, on top) ── */}
        <g
          className={`${styles.key} ${
            past('unlock') ? styles.keyTurn :
            past('keyMove') ? styles.keyDescend : ''
          }`}
          style={{ transformOrigin: '100px 68px' }}
        >
          {/* Bow (ring) */}
          <circle cx="118" cy="38" r="12" fill="#e8a020" />
          <circle cx="118" cy="38" r="5" fill="#0d1b2a" />
          {/* Shaft */}
          <rect x="106" y="38" width="5" height="34" rx="1.5" fill="#e8a020" transform="rotate(-25 108 38)" />
          {/* Teeth */}
          <rect x="94" y="62" width="8" height="4" rx="1" fill="#e8a020" transform="rotate(-25 98 64)" />
          <rect x="90" y="56" width="6" height="4" rx="1" fill="#e8a020" transform="rotate(-25 93 58)" />
        </g>
      </svg>

      {/* Brand text */}
      <div className={`${styles.brandText} ${past('scrolls') ? styles.textReveal : ''}`}>
        CapitolKey
      </div>
    </div>
  )
}
