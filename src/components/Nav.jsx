import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext.jsx'
import styles from './Nav.module.css'

export default function Nav() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { user, signInWithGoogle, signOut, supabaseAvailable } = useAuth()

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

          {supabaseAvailable && user ? (
            <div className={styles.userMenu}>
              <img
                src={user.user_metadata?.avatar_url || ''}
                alt=""
                className={styles.avatar}
                referrerPolicy="no-referrer"
              />
              <span className={styles.userName}>
                {user.user_metadata?.full_name?.split(' ')[0] || 'Account'}
              </span>
              <button className={styles.signOutBtn} onClick={signOut}>
                Sign out
              </button>
            </div>
          ) : supabaseAvailable ? (
            <button className={styles.signInBtn} onClick={signInWithGoogle}>
              Sign in
            </button>
          ) : null}

          <button
            className={styles.cta}
            onClick={() => navigate('/profile')}
          >
            Get started
          </button>
        </div>
      </div>
    </nav>
  )
}
