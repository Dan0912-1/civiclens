import { Routes, Route } from 'react-router-dom'
import Home from './pages/Home.jsx'
import Profile from './pages/Profile.jsx'
import Results from './pages/Results.jsx'
import About from './pages/About.jsx'
import Bookmarks from './pages/Bookmarks.jsx'
import Nav from './components/Nav.jsx'

export default function App() {
  return (
    <>
      <Nav />
      <Routes>
        <Route path="/"          element={<Home />} />
        <Route path="/profile"   element={<Profile />} />
        <Route path="/results"   element={<Results />} />
        <Route path="/about"     element={<About />} />
        <Route path="/bookmarks" element={<Bookmarks />} />
      </Routes>
    </>
  )
}
