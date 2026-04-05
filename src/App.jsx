import { useEffect, useState, Suspense, lazy } from 'react'
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import { supabase } from './lib/supabase'
import { initPushNotifications } from './lib/pushNotifications'
import { getApiBase } from './lib/api'
import Onboarding from './components/Onboarding.jsx'
import Nav from './components/Nav.jsx'
import OfflineScreen from './components/OfflineScreen.jsx'

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

export default function App() {
  const { user, loading } = useAuth()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [showOnboarding, setShowOnboarding] = useState(
    () => !localStorage.getItem('ck_onboarded_v2')
  )

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
          StatusBar.setStyle({ style: Style.Dark })
          StatusBar.setBackgroundColor({ color: '#0d1b2a' }).catch(() => {})
        })
      })
      .catch(() => {})
  }, [pathname])

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
        const installed = '1.0.0' // keep in sync with package.json
        if (compareVersions(installed, minVersion) < 0) {
          // User is running an outdated version — block usage
          document.getElementById('force-update')?.remove()
          const el = document.createElement('div')
          el.id = 'force-update'
          el.innerHTML = `
            <div style="position:fixed;inset:0;z-index:99999;background:var(--navy);color:white;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:2rem;">
              <h2 style="font-family:var(--font-display);font-size:1.5rem;margin-bottom:1rem;">Update Required</h2>
              <p style="color:rgba(255,255,255,0.7);margin-bottom:1.5rem;max-width:300px;">A new version of CapitolKey is available. Please update to continue.</p>
              <a href="https://apps.apple.com/app/capitolkey/id0000000000" style="background:var(--amber);color:var(--navy);padding:0.75rem 2rem;border-radius:12px;font-weight:700;text-decoration:none;">Update Now</a>
            </div>`
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
          // Match /bill/:congress/:type/:number
          if (path.startsWith('/bill/')) {
            navigate(path)
          }
        })
        cleanup = () => listener.then?.(l => l.remove()) || listener.remove?.()
      })
      .catch(() => {})
    return () => cleanup?.()
  }, [navigate])

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
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/"          element={<Home />} />
          <Route path="/profile"   element={<Profile />} />
          <Route path="/results"   element={<Results />} />
          <Route path="/search"    element={<Search />} />
          <Route path="/bill/:congress/:type/:number" element={<BillDetail />} />
          <Route path="/about"     element={<About />} />
          <Route path="/bookmarks" element={<Bookmarks />} />
          <Route path="/privacy"   element={<Privacy />} />
          <Route path="/terms"     element={<Terms />} />
        </Routes>
      </Suspense>
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
