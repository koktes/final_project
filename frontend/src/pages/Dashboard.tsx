import { useNavigate } from 'react-router-dom'
import { BANKS } from '../api/client'
import './Dashboard.css'

export default function Dashboard() {
  const navigate = useNavigate()

  return (
    <div className="dashboard animate-fade-in">
      <div className="page-header">
        <h1>Dashboard</h1>
        <p>Multi-bank payment verification at your fingertips</p>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'var(--accent-primary-dim)', color: 'var(--accent-primary)' }}>⬡</div>
          <div className="stat-content">
            <span className="stat-value">6</span>
            <span className="stat-label">Supported Banks</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'var(--success-dim)', color: 'var(--success)' }}>◐</div>
          <div className="stat-content">
            <span className="stat-value">2</span>
            <span className="stat-label">Verify Methods</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'var(--info-dim)', color: 'var(--info)' }}>◈</div>
          <div className="stat-content">
            <span className="stat-value">AI</span>
            <span className="stat-label">OCR Powered</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'var(--warning-dim)', color: 'var(--warning)' }}>▦</div>
          <div className="stat-content">
            <span className="stat-value">Live</span>
            <span className="stat-label">API Status</span>
          </div>
        </div>
      </div>

      <section className="dashboard-section">
        <div className="section-header">
          <h2>Quick Actions</h2>
          <p>Choose how you want to verify</p>
        </div>
        <div className="action-cards">
          <button className="action-card" onClick={() => navigate('/verify')}>
            <div className="action-icon manual-icon">⬡</div>
            <h3>Manual Verification</h3>
            <p>Enter reference numbers and verify against any supported bank</p>
            <span className="action-arrow">→</span>
          </button>
          <button className="action-card" onClick={() => navigate('/verify/image')}>
            <div className="action-icon image-icon">◐</div>
            <h3>Image Verification</h3>
            <p>Upload a receipt screenshot and let AI extract & verify automatically</p>
            <span className="action-arrow">→</span>
          </button>
        </div>
      </section>

      <section className="dashboard-section">
        <div className="section-header">
          <h2>Supported Banks</h2>
          <p>All Ethiopian payment providers</p>
        </div>
        <div className="banks-grid">
          {BANKS.map(bank => (
            <button
              key={bank.id}
              className="bank-chip"
              onClick={() => navigate('/verify')}
              style={{ '--bank-color': bank.color, '--bank-dim': `var(--bank-${bank.id.replace('_', '')}-dim)` } as React.CSSProperties}
            >
              <span className="bank-chip-dot" style={{ background: bank.color }}></span>
              <span className="bank-chip-name">{bank.shortName}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
