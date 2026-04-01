import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import AuthModal from './AuthModal.jsx'
import styles from './Nav.module.css'

export default function Nav() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { user, signOut } = useAuth()
  const [showAuth, setShowAuth] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const initial = user?.email?.[0]?.toUpperCase() || '?'

  // Close menu on route change
  useEffect(() => { setMenuOpen(false) }, [pathname])

  function go(path) { setMenuOpen(false); navigate(path) }

  return (
    <nav className={styles.nav}>
      <div className={styles.inner}>
        <button className={styles.logo} onClick={() => go('/')}>
          <span className={styles.logoMark}>⚖</span>
          <span className={styles.logoText}>CapitolKey</span>
        </button>

        <button
          className={styles.burger}
          onClick={() => setMenuOpen(o => !o)}
          aria-label="Toggle menu"
        >
          <span className={`${styles.burgerLine} ${menuOpen ? styles.open : ''}`} />
          <span className={`${styles.burgerLine} ${menuOpen ? styles.open : ''}`} />
          <span className={`${styles.burgerLine} ${menuOpen ? styles.open : ''}`} />
        </button>

        <div className={`${styles.links} ${menuOpen ? styles.linksOpen : ''}`}>
          <button
            className={`${styles.link} ${pathname === '/about' ? styles.active : ''}`}
            onClick={() => go('/about')}
          >
            How it works
          </button>

          {user ? (
            <>
              <button
                className={`${styles.link} ${pathname === '/bookmarks' ? styles.active : ''}`}
                onClick={() => go('/bookmarks')}
              >
                Saved
              </button>
              <div className={styles.userPill}>{initial}</div>
              <button className={styles.link} onClick={() => { setMenuOpen(false); signOut() }}>
                Sign out
              </button>
            </>
          ) : (
            <>
              <button className={styles.link} onClick={() => { setMenuOpen(false); setShowAuth(true) }}>
                Sign in
              </button>
              <button
                className={styles.cta}
                onClick={() => go('/profile')}
              >
                Get started
              </button>
            </>
          )}
        </div>
      </div>

      <AuthModal isOpen={showAuth} onClose={() => setShowAuth(false)} />
    </nav>
  )
}
