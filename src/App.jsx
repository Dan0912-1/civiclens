import { Routes, Route } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext.jsx'
import Home from './pages/Home.jsx'
import Profile from './pages/Profile.jsx'
import Results from './pages/Results.jsx'
import BillDetail from './pages/BillDetail.jsx'
import About from './pages/About.jsx'
import Nav from './components/Nav.jsx'

export default function App() {
  return (
    <AuthProvider>
      <Nav />
      <Routes>
        <Route path="/"        element={<Home />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/results" element={<Results />} />
        <Route path="/bill/:congress/:type/:number" element={<BillDetail />} />
        <Route path="/about"   element={<About />} />
      </Routes>
    </AuthProvider>
  )
}
