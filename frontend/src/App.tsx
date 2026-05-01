import { useEffect, useState } from 'react'
import { Routes, Route } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import Dashboard from './pages/Dashboard'
import ManualVerify from './pages/ManualVerify'
import ImageVerify from './pages/ImageVerify'
import BulkImageImport from './pages/BulkImageImport'
import History from './pages/History'
import Reports from './pages/Reports'
import AuthPage from './pages/AuthPage'
import { clearSession, getStoredToken, getStoredUser, type AuthUser } from './api/client'
import './App.css'

function App() {
  const [token, setToken] = useState<string | null>(() => getStoredToken())
  const [user, setUser] = useState<AuthUser | null>(() => getStoredUser())

  useEffect(() => {
    const onExpired = () => {
      setToken(null)
      setUser(null)
    }
    window.addEventListener('auth:expired', onExpired)
    return () => window.removeEventListener('auth:expired', onExpired)
  }, [])

  function handleAuthenticated() {
    setToken(getStoredToken())
    setUser(getStoredUser())
  }

  function handleLogout() {
    clearSession()
    setToken(null)
    setUser(null)
  }

  if (!token || !user) {
    return <AuthPage onAuthenticated={handleAuthenticated} />
  }

  return (
    <div className="app-layout">
      <Sidebar user={user} onLogout={handleLogout} />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/verify" element={<ManualVerify />} />
          <Route path="/verify/image" element={<ImageVerify />} />
          <Route path="/verify/bulk-images" element={<BulkImageImport />} />
          <Route path="/history" element={<History />} />
          <Route path="/reports" element={<Reports />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
