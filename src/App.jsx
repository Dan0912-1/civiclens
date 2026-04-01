import { useEffect, useCallback } from 'react'
import { Routes, Route } from 'react-router-dom'
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
import Settings from './pages/Settings.jsx'
import Nav from './components/Nav.jsx'
import PushPrompt from './components/PushPrompt.jsx'

export default function App() {
  const { user } = useAuth()

  // Initialize push notifications for logged-in native app users
  useEffect(() => {
    if (!user || !supabase) return
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.access_token) {
        initPushNotifications(user.id, session.access_token)
      }
    })
  }, [user])

  // Callback when user accepts the soft push prompt
  const handlePushAccept = useCallback(() => {
    if (!user || !supabase) return
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.access_token) {
        initPushNotifications(user.id, session.access_token)
      }
    })
  }, [user])

  return (
    <>
      <Nav />
      <Routes>
        <Route path="/"          element={<Home />} />
        <Route path="/profile"   element={<Profile />} />
        <Route path="/results"   element={<Results />} />
        <Route path="/bill/:congress/:type/:number" element={<BillDetail />} />
        <Route path="/about"     element={<About />} />
        <Route path="/bookmarks" element={<Bookmarks />} />
        <Route path="/privacy"   element={<Privacy />} />
        <Route path="/settings"  element={<Settings />} />
      </Routes>
      {user && <PushPrompt onAccept={handlePushAccept} />}
    </>
  )
}
