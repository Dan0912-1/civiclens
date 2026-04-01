import { useEffect } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import { supabase } from './lib/supabase'
import { initPushNotifications } from './lib/pushNotifications'
import Home from './pages/Home.jsx'
import Profile from './pages/Profile.jsx'
import Results from './pages/Results.jsx'
import About from './pages/About.jsx'
import BillDetail from './pages/BillDetail.jsx'
import Bookmarks from './pages/Bookmarks.jsx'
import Privacy from './pages/Privacy.jsx'
import Terms from './pages/Terms.jsx'
import Nav from './components/Nav.jsx'
import OfflineScreen from './components/OfflineScreen.jsx'

export default function App() {
  const { user, loading } = useAuth()
  const { pathname } = useLocation()

  // Hide splash screen once auth state is resolved and UI is ready
  useEffect(() => {
    if (loading) return
    import('@capacitor/splash-screen')
      .then(({ SplashScreen }) => SplashScreen.hide({ fadeOutDuration: 300 }))
      .catch(() => {}) // not in native context
  }, [loading])

  // Set status bar style — nav is always navy so text should be light
  useEffect(() => {
    import('@capacitor/status-bar')
      .then(({ StatusBar, Style }) => {
        StatusBar.setStyle({ style: Style.Dark }) // light text on dark nav
        StatusBar.setBackgroundColor({ color: '#0d1b2a' }).catch(() => {}) // Android only
      })
      .catch(() => {}) // not in native context
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

  return (
    <>
      <OfflineScreen />
      <Nav />
      <Routes>
        <Route path="/"          element={<Home />} />
        <Route path="/profile"   element={<Profile />} />
        <Route path="/results"   element={<Results />} />
        <Route path="/bill/:congress/:type/:number" element={<BillDetail />} />
        <Route path="/about"     element={<About />} />
        <Route path="/bookmarks" element={<Bookmarks />} />
        <Route path="/privacy"   element={<Privacy />} />
        <Route path="/terms"     element={<Terms />} />
      </Routes>
    </>
  )
}
