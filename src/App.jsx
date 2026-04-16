import { useEffect, useState, Suspense, lazy } from 'react'
import { Routes, Route, useLocation, useNavigate, Link } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import { supabase } from './lib/supabase'
import { initPushNotifications, setPushNavigate } from './lib/pushNotifications'
import { flush as flushOfflineQueue } from './lib/offlineQueue'
import { getApiBase } from './lib/api'
import Onboarding from './components/Onboarding.jsx'
import Nav from './components/Nav.jsx'
import OfflineScreen from './components/OfflineScreen.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

// Lazy-loaded pages — reduces initial bundle size
const Home = lazy(() => import('./pages/Home.jsx'))
const Profile = lazy(() => import('./pages/Profile.jsx'))
const Results = lazy(() => import('./pages/Results.jsx'))
const BillDetail = lazy(() => import('./pages/BillDetail.jsx'))
const About = lazy(() => import('./pages/About.jsx'))
const Bookmarks = lazy(() => import('./pages/Bookmarks.jsx'))
const Privacy = lazy(() => import('./pages/Privacy.jsx'))
const Terms = lazy(() => import('./pages/Terms.jsx'))
const Search = lazy(() => import('./pages/Search.jsx'))
const Contact = lazy(() => import('./pages/Contact.jsx'))
const Settings = lazy(() => import('./pages/Settings.jsx'))
const Admin = lazy(() => import('./pages/Admin.jsx'))
const TeacherDashboard = lazy(() => import('./pages/TeacherDashboard.jsx'))
const JoinClassroom = lazy(() => import('./pages/JoinClassroom.jsx'))
const ClassroomDetail = lazy(() => import('./pages/ClassroomDetail.jsx'))
const ClassroomView = lazy(() => import('./pages/ClassroomView.jsx'))
const Educators = lazy(() => import('./pages/Educators.jsx'))

function PageLoader() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: 'calc(100vh - 64px)', background: 'var(--cream)',
    }}>
      <div style={{
        width: 24, height: 24,
        border: '3px solid var(--border)',
        borderTopColor: 'var(--navy)',
        borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
      }} />
    </div>
  )
}

const PAGE_TITLES = {
  '/': 'CapitolKey: Legislation That Affects You',
  '/profile': 'Set Up Your Feed | CapitolKey',
  '/results': 'Your Legislation | CapitolKey',
  '/search': 'Search Bills | CapitolKey',
  '/about': 'How It Works | CapitolKey',
  '/contact': 'Contact | CapitolKey',
  '/support': 'Contact | CapitolKey',
  '/bookmarks': 'Saved Bills | CapitolKey',
  '/privacy': 'Privacy Policy | CapitolKey',
  '/terms': 'Terms of Service | CapitolKey',
  '/settings': 'Settings | CapitolKey',
  '/admin': 'Admin | CapitolKey',
  '/educators': 'For Educators | CapitolKey',
  '/classroom': 'Classrooms | CapitolKey',
  '/classroom/join': 'Join Classroom | CapitolKey',
}

function NotFound() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      minHeight: 'calc(100vh - 64px)', background: 'var(--cream)', textAlign: 'center', padding: '2rem',
    }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', color: 'var(--navy)', marginBottom: '0.5rem' }}>Page not found</h1>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>The page you're looking for doesn't exist.</p>
      <Link to="/" style={{ color: 'var(--amber)', fontWeight: 600, textDecoration: 'underline' }}>Go home</Link>
    </div>
  )
}

export default function App() {
  const { user, loading } = useAuth()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [showOnboarding, setShowOnboarding] = useState(
    () => !localStorage.getItem('ck_onboarded_v2')
  )

  // Inject navigate into push notification handler so it uses SPA routing
  useEffect(() => { setPushNavigate(navigate) }, [navigate])

  // Scroll to top on route change
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])

  // Dynamic page title per route
  useEffect(() => {
    const base = pathname.split('/').slice(0, 2).join('/')
    document.title = PAGE_TITLES[pathname] || PAGE_TITLES[base] || 'CapitolKey'
  }, [pathname])

  // Hide splash screen with a brief branded moment + smooth haptic wave
  useEffect(() => {
    if (loading) return
    let cancelled = false

    async function splashSequence() {
      let Haptics, ImpactStyle
      try {
        ;({ Haptics, ImpactStyle } = await import('@capacitor/haptics'))
      } catch { /* not native */ }

      const delay = ms => new Promise(r => setTimeout(r, ms))
      const tap = async (style) => {
        if (Haptics && !cancelled) await Haptics.impact({ style })
      }

      // Quick haptic wave: build → peak → release
      await tap(ImpactStyle.Light);  await delay(30)
      await tap(ImpactStyle.Medium); await delay(25)
      await tap(ImpactStyle.Heavy);  await delay(25)
      await tap(ImpactStyle.Heavy);  await delay(25)
      await tap(ImpactStyle.Medium); await delay(30)
      await tap(ImpactStyle.Light)

      if (!cancelled) {
        try {
          const { SplashScreen } = await import('@capacitor/splash-screen')
          await SplashScreen.hide({ fadeOutDuration: 300 })
        } catch {}
      }
    }

    const timer = setTimeout(splashSequence, 200)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [loading])

  // Set status bar style — nav is always navy so text should be light (native only)
  useEffect(() => {
    import('@capacitor/core')
      .then(({ Capacitor }) => {
        if (!Capacitor.isNativePlatform()) return
        return import('@capacitor/status-bar').then(({ StatusBar, Style }) => {
          StatusBar.setStyle({ style: Style.Light })
          StatusBar.setBackgroundColor({ color: '#0A1929' }).catch(() => {})
        })
      })
      .catch(() => {})
  }, []) // style never varies — run once

  // Haptic feedback when pulling past the top of screen (iOS overscroll)
  // Uses touch events because WKWebView never fires scroll events during rubber-band
  useEffect(() => {
    let startY = 0
    let fired = false

    function onTouchStart(e) {
      startY = e.touches[0].clientY
      fired = false
    }

    function onTouchMove(e) {
      if (fired) return
      const atTop = window.scrollY <= 0
      const pullingDown = e.touches[0].clientY - startY > 40
      if (atTop && pullingDown) {
        fired = true
        import('@capacitor/haptics')
          .then(({ Haptics, ImpactStyle }) =>
            Haptics.impact({ style: ImpactStyle.Light })
          )
          .catch(() => {})
      }
    }

    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
    }
  }, [])

  // Initialize push notifications for logged-in native app users
  useEffect(() => {
    if (!user || !supabase) return
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.access_token) {
        initPushNotifications(user.id, session.access_token)
      }
    })
  }, [user])

  // Force-update check — compare installed version against server minimum
  useEffect(() => {
    async function checkVersion() {
      try {
        const { Capacitor } = await import('@capacitor/core')
        if (!Capacitor.isNativePlatform()) return
        const resp = await fetch(`${getApiBase()}/api/version`)
        if (!resp.ok) return
        const { minVersion } = await resp.json()
        // Injected by Vite at build time from package.json — see vite.config.js
        const installed = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'
        if (compareVersions(installed, minVersion) < 0) {
          // User is running an outdated version — block usage
          document.getElementById('force-update')?.remove()
          const el = document.createElement('div')
          el.id = 'force-update'
          const overlay = document.createElement('div')
          Object.assign(overlay.style, { position: 'fixed', inset: '0', zIndex: '99999', background: 'var(--navy)', color: 'white', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '2rem' })
          const h2 = document.createElement('h2')
          Object.assign(h2.style, { fontFamily: 'var(--font-display)', fontSize: '1.5rem', marginBottom: '1rem' })
          h2.textContent = 'Update Required'
          const p = document.createElement('p')
          Object.assign(p.style, { color: 'rgba(255,255,255,0.7)', marginBottom: '1.5rem', maxWidth: '300px' })
          p.textContent = 'A new version of CapitolKey is available. Please update to continue.'
          const a = document.createElement('a')
          a.href = 'https://apps.apple.com/app/capitolkey/id6743539498'
          Object.assign(a.style, { background: 'var(--amber)', color: 'var(--navy)', padding: '0.75rem 2rem', borderRadius: '12px', fontWeight: '700', textDecoration: 'none' })
          a.textContent = 'Update Now'
          overlay.append(h2, p, a)
          el.appendChild(overlay)
          document.body.appendChild(el)
        }
      } catch {
        // version check is best-effort
      }
    }
    checkVersion()
  }, [])

  // Deep link handling — Capacitor App plugin listens for universal/app links
  useEffect(() => {
    let cleanup
    import('@capacitor/app')
      .then(({ App }) => {
        const listener = App.addListener('appUrlOpen', (event) => {
          const url = new URL(event.url)
          const path = url.pathname
          // Validate /bill/:congress/:type/:number — congress is numeric, type is alpha, number is numeric
          if (path.startsWith('/bill/')) {
            const parts = path.split('/')
            const congress = parts[2], type = parts[3], number = parts[4]
            if (/^\d+$/.test(congress) && /^[a-z]+$/i.test(type) && /^\d+$/.test(number)) {
              navigate(`/bill/${congress}/${type}/${number}`)
            }
          }
        })
        cleanup = () => listener.then?.(l => l.remove()) || listener.remove?.()
      })
      .catch(() => {})
    return () => cleanup?.()
  }, [navigate])

  // App foreground/background state — flush offline queue on resume and
  // dispatch a custom event so pages with in-flight API calls can recover
  // from zombie loading states (e.g. LLM personalization that finished while
  // the app was backgrounded and the frontend never got the response).
  useEffect(() => {
    let cleanup
    import('@capacitor/app')
      .then(({ App }) => {
        const listener = App.addListener('appStateChange', ({ isActive }) => {
          if (isActive) {
            // Flush any requests queued while offline/backgrounded
            flushOfflineQueue()
            // Notify pages so they can re-check pending operations
            window.dispatchEvent(new CustomEvent('ck:app-resumed'))
          }
        })
        cleanup = () => listener.then?.(l => l.remove()) || listener.remove?.()
      })
      .catch(() => {})
    return () => cleanup?.()
  }, [])

  function completeOnboarding() {
    localStorage.setItem('ck_onboarded_v2', '1')
    setShowOnboarding(false)
  }

  return (
    <>
      {showOnboarding && pathname === '/' && (
        <Onboarding onComplete={completeOnboarding} />
      )}
      <OfflineScreen />
      <Nav />
      <main id="main-content">
      <ErrorBoundary>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/"          element={<Home />} />
          <Route path="/profile"   element={<Profile />} />
          <Route path="/results"   element={<Results />} />
          <Route path="/search"    element={<Search />} />
          <Route path="/bill/:congress/:type/:number" element={<BillDetail />} />
          <Route path="/about"     element={<About />} />
          <Route path="/contact"   element={<Contact />} />
          <Route path="/support"   element={<Contact />} />
          <Route path="/bookmarks" element={<Bookmarks />} />
          <Route path="/privacy"   element={<Privacy />} />
          <Route path="/terms"     element={<Terms />} />
          <Route path="/settings"  element={<Settings />} />
          <Route path="/admin"          element={<Admin />} />
          <Route path="/educators"  element={<Educators />} />
          <Route path="/classroom"       element={<TeacherDashboard />} />
          <Route path="/classroom/join"  element={<JoinClassroom />} />
          <Route path="/classroom/:id"       element={<ClassroomDetail />} />
          <Route path="/classroom/view/:code" element={<ClassroomView />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
      </ErrorBoundary>
      </main>
    </>
  )
}

// Semver comparison: returns -1, 0, or 1
function compareVersions(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) < (pb[i] || 0)) return -1
    if ((pa[i] || 0) > (pb[i] || 0)) return 1
  }
  return 0
}
