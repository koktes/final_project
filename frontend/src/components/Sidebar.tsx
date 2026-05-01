import { NavLink } from 'react-router-dom'
import type { AuthUser } from '../api/client'
import './Sidebar.css'

const navItems = [
  { path: '/', label: 'Dashboard', icon: '◈' },
  { path: '/verify', label: 'Manual Verify', icon: '⬡' },
  { path: '/verify/image', label: 'Image Verify', icon: '◐' },
  { path: '/verify/bulk-images', label: 'Bulk Images', icon: '▤' },
  { path: '/history', label: 'History', icon: '◷' },
  { path: '/reports', label: 'Reports', icon: '▦' },
]

interface SidebarProps {
  user: AuthUser
  onLogout: () => void
}

export default function Sidebar({ user, onLogout }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-logo">
          <span className="logo-icon">◆</span>
        </div>
        <div className="sidebar-brand-text">
          <h1>VerifyPay</h1>
          <span>Payment Verification</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        {navItems.map(item => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-user">
          <span className="sidebar-user-label">Signed in as</span>
          <span className="sidebar-user-email">{user.email || user.name || 'User'}</span>
        </div>
        <div className="sidebar-api-status">
          <span className="status-dot"></span>
          <span>API Connected</span>
        </div>
        <button className="sidebar-logout-btn" onClick={onLogout}>Logout</button>
      </div>
    </aside>
  )
}
