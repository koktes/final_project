import { Routes, Route } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import Dashboard from './pages/Dashboard'
import ManualVerify from './pages/ManualVerify'
import ImageVerify from './pages/ImageVerify'
import History from './pages/History'
import Reports from './pages/Reports'
import './App.css'

function App() {
  return (
    <div className="app-layout">
      <Sidebar />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/verify" element={<ManualVerify />} />
          <Route path="/verify/image" element={<ImageVerify />} />
          <Route path="/history" element={<History />} />
          <Route path="/reports" element={<Reports />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
