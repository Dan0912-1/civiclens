import { useState, useRef, useEffect } from 'react'
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
  const menuRef = useRef(null)

  const initial = user?.email?.[0]?.toUpperCase() || '?'

  // Close menu when clicking outside
  useEffect(() => {
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false)
      }
    }
    if (menuOpen) {
      document.addEventListener('mousedown', handleClick)
      return () => document.removeEventListener('mousedown', handleClick)
    }
  }, [menuOpen])

  // Close menu on route change
  useEffect(() => {
    setMenuOpen(false)
  }, [pathname])

  function handleNav(path) {
    setMenuOpen(false)
    navigate(path)
  }

  function handleSignOut() {
    setMenuOpen(false)
    signOut()
  }

  return (
    <nav className={styles.nav}>
      <div className={styles.inner}>
        {/* Left: hamburger menu */}
        <div className={styles.menuWrapper} ref={menuRef}>
          <button
            className={styles.hamburger}
            onClick={() => setMenuOpen(o => !o)}
            aria-label="Menu"
            aria-expanded={menuOpen}
          >
            <span className={`${styles.bar} ${menuOpen ? styles.barOpen1 : ''}`} />
            <span className={`${styles.bar} ${menuOpen ? styles.barOpen2 : ''}`} />
            <span className={`${styles.bar} ${menuOpen ? styles.barOpen3 : ''}`} />
          </button>

          {menuOpen && (
            <div className={styles.dropdown}>
              <button
                className={`${styles.dropItem} ${pathname === '/about' ? styles.dropItemActive : ''}`}
                onClick={() => handleNav('/about')}
              >
                <span className={styles.dropIcon}>ℹ️</span>
                About GovDecoded
              </button>

              {user && (
                <button
                  className={`${styles.dropItem} ${pathname === '/bookmarks' ? styles.dropItemActive : ''}`}
                  onClick={() => handleNav('/bookmarks')}
                >
                  <span className={styles.dropIcon}>📑</span>
                  Saved Bills
                </button>
              )}

              {user && (
                <button
                  className={`${styles.dropItem} ${pathname === '/profile' ? styles.dropItemActive : ''}`}
                  onClick={() => handleNav('/profile')}
                >
                  <span className={styles.dropIcon}>👤</span>
                  Your Account
                </button>
              )}

              {user && (
                <>
                  <div className={styles.dropDivider} />
                  <button className={styles.dropItem} onClick={handleSignOut}>
                    <span className={styles.dropIcon}>🚪</span>
                    Sign Out
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Center: logo */}
        <button className={styles.logo} onClick={() => navigate('/')}>
          <span className={styles.logoMark}>⚖</span>
          <span className={styles.logoText}>GovDecoded</span>
        </button>

        {/* Right: profile pill or sign in */}
        <div className={styles.rightSlot}>
          {user ? (
            <div className={styles.userPill}>{initial}</div>
          ) : (
            <button className={styles.signIn} onClick={() => setShowAuth(true)}>
              Sign in
            </button>
          )}
        </div>
      </div>

      <AuthModal isOpen={showAuth} onClose={() => setShowAuth(false)} />
    </nav>
  )
}
