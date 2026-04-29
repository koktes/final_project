import { NavLink } from 'react-router-dom'
import './Sidebar.css'

const navItems = [
  { path: '/', label: 'Dashboard', icon: '◈' },
  { path: '/verify', label: 'Manual Verify', icon: '⬡' },
  { path: '/verify/image', label: 'Image Verify', icon: '◐' },
  { path: '/history', label: 'History', icon: '◷', badge: 'Soon' },
  { path: '/reports', label: 'Reports', icon: '▦', badge: 'Soon' },
]

export default function Sidebar() {
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
            {item.badge && <span className="nav-badge">{item.badge}</span>}
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-api-status">
          <span className="status-dot"></span>
          <span>API Connected</span>
        </div>
      </div>
    </aside>
  )
}
