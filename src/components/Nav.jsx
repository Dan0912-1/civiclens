import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import AuthModal from './AuthModal.jsx'
import styles from './Nav.module.css'

export default function Nav() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { user, signOut } = useAuth()
  const [showAuth, setShowAuth] = useState(false)

  const initial = user?.email?.[0]?.toUpperCase() || '?'

  return (
    <nav className={styles.nav}>
      <div className={styles.inner}>
        <button className={styles.logo} onClick={() => navigate('/')}>
          <span className={styles.logoMark}>⚖</span>
          <span className={styles.logoText}>GovDecoded</span>
        </button>

        <div className={styles.links}>
          <button
            className={`${styles.link} ${pathname === '/about' ? styles.active : ''}`}
            onClick={() => navigate('/about')}
          >
            How it works
          </button>

          {user ? (
            <>
              <button
                className={`${styles.link} ${pathname === '/bookmarks' ? styles.active : ''}`}
                onClick={() => navigate('/bookmarks')}
              >
                Saved
              </button>
              <div className={styles.userPill}>{initial}</div>
              <button className={styles.link} onClick={signOut}>
                Sign out
              </button>
            </>
          ) : (
            <>
              <button className={styles.link} onClick={() => setShowAuth(true)}>
                Sign in
              </button>
              <button
                className={styles.cta}
                onClick={() => navigate('/profile')}
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
