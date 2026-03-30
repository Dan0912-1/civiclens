import { useNavigate, useLocation } from 'react-router-dom'
import styles from './Nav.module.css'

export default function Nav() {
  const navigate = useNavigate()
  const { pathname } = useLocation()

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
