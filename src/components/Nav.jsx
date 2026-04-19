import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import AuthModal from './AuthModal.jsx'
import logoSrc from '../assets/logo.png'
import styles from './Nav.module.css'

export default function Nav() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { user, signOut } = useAuth()
  const [showAuth, setShowAuth] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  // Auto-close auth modal when user signs in (e.g. after Google OAuth redirect)
  useEffect(() => {
    if (user) setShowAuth(false)
  }, [user])

  const initial = user?.email?.[0]?.toUpperCase() || '?'

  useEffect(() => { setMenuOpen(false) }, [pathname])

  useEffect(() => {
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false)
      }
    }
    function handleEscape(e) {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    if (menuOpen) {
      document.addEventListener('mousedown', handleClick)
      document.addEventListener('keydown', handleEscape)
    }
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [menuOpen])

  function handleNav(path) {
    setMenuOpen(false)
    navigate(path)
  }

  return (
    <nav className={styles.nav}>
      <a href="#main-content" className={styles.skipLink}>Skip to main content</a>
      <div className={styles.inner}>

        {/* All items in one row with equal gap */}
        <div className={styles.row}>

          {/* Hamburger */}
          <div className={styles.menuWrap} ref={menuRef}>
            <button
              className={styles.hamburger}
              onClick={() => setMenuOpen(o => !o)}
              aria-label="Menu"
            >
              <span className={`${styles.bar} ${menuOpen ? styles.barTop : ''}`} />
              <span className={`${styles.bar} ${menuOpen ? styles.barMid : ''}`} />
              <span className={`${styles.bar} ${menuOpen ? styles.barBot : ''}`} />
            </button>

            {menuOpen && (
              <div className={styles.dropdown}>
                <button className={styles.dropItem} onClick={() => handleNav('/')}>Home</button>
                <button className={styles.dropItem} onClick={() => handleNav('/search')}>Search Bills</button>
                {user && (
                  <button className={styles.dropItem} onClick={() => handleNav('/bookmarks')}>Saved Bills</button>
                )}
                <button className={styles.dropItem} onClick={() => handleNav('/profile')}>My Profile</button>
                {user && (
                  <button className={styles.dropItem} onClick={() => handleNav('/settings')}>Settings</button>
                )}
                <div className={styles.dropDivider} />
                <button className={styles.dropItem} onClick={() => handleNav('/about')}>About</button>
                <button className={styles.dropItem} onClick={() => handleNav('/classroom')}>Classrooms</button>
                <div className={styles.dropDivider} />
                <button className={styles.dropItem} onClick={() => handleNav('/contact')}>Contact Us</button>
                <div className={styles.dropDivider} />
                <button className={styles.dropItem} onClick={() => handleNav('/privacy')}>Privacy Policy</button>
                <button className={styles.dropItem} onClick={() => handleNav('/terms')}>Terms of Service</button>
                <div className={styles.dropDivider} />
                {user ? (
                  <button
                    className={`${styles.dropItem} ${styles.dropItemDanger}`}
                    onClick={() => { setMenuOpen(false); signOut() }}
                  >
                    Sign out
                  </button>
                ) : (
                  <button className={styles.dropItem} onClick={() => { setMenuOpen(false); setShowAuth(true) }}>
                    Sign in
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Logo */}
          <button className={styles.logo} onClick={() => navigate('/')}>
            <img src={logoSrc} alt="CapitolKey home" className={styles.logoIcon} />
            <span className={styles.logoText}>CapitolKey</span>
          </button>

          {/* Auth — pushed to far right */}
          <div className={styles.auth}>
            {user ? (
              <>
                <button
                  className={`${styles.link} ${pathname === '/bookmarks' ? styles.active : ''}`}
                  onClick={() => navigate('/bookmarks')}
                >
                  Saved
                </button>
                <div className={styles.userPill}>{initial}</div>
              </>
            ) : (
              <>
                <button className={styles.signIn} onClick={() => setShowAuth(true)}>Sign in</button>
                <button className={styles.cta} onClick={() => navigate('/profile')}>Get started</button>
              </>
            )}
          </div>

        </div>
      </div>

      <AuthModal isOpen={showAuth} onClose={() => setShowAuth(false)} />
    </nav>
  )
}
