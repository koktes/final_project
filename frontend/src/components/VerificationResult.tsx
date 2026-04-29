import type { BankInfo } from '../api/client'
import './VerificationResult.css'

interface FraudAnalysis {
  risk_score: number
  status: string
  is_anomaly: boolean
  confidence: number
  contributing_features?: Array<{
    feature: string
    value: number
    deviation: number
  }>
}

interface Props {
  data: any
  bank: BankInfo
}

function getRiskColor(score: number): string {
  if (score < 25) return 'var(--success)'
  if (score < 60) return 'var(--warning)'
  return 'var(--error)'
}

function getRiskLabel(status: string): string {
  switch (status) {
    case 'Verified': return '✓ Verified — Low Risk'
    case 'Low_Risk': return '◐ Low Risk'
    case 'Suspicious': return '⚠ Suspicious'
    case 'Invalid': return '✕ High Risk'
    default: return status
  }
}

export default function VerificationResult({ data, bank }: Props) {
  const isSuccess = data?.success !== false && !data?.error
  const receiptData = data?.data || data?.details || data
  const fraud: FraudAnalysis | null = data?.fraudAnalysis || null

  return (
    <div className={`vr-card ${isSuccess ? 'vr-success' : 'vr-failure'}`} style={{ '--bcolor': bank.color } as React.CSSProperties}>
      <div className="vr-status-bar">
        <div className={`vr-status-icon ${isSuccess ? 'success' : 'failure'}`}>
          {isSuccess ? '✓' : '✕'}
        </div>
        <div className="vr-status-text">
          <h3>{isSuccess ? 'Verification Successful' : 'Verification Failed'}</h3>
          <span className="vr-bank-tag" style={{ background: `var(--bank-${bank.id.replace('_', '')}-dim)`, color: bank.color }}>
            {bank.shortName}
          </span>
        </div>
      </div>

      {data?.error && (
        <div className="vr-error-msg">{typeof data.error === 'string' ? data.error : JSON.stringify(data.error)}</div>
      )}

      {receiptData && typeof receiptData === 'object' && (
        <div className="vr-details">
          {Object.entries(receiptData).map(([key, value]) => {
            if (value === null || value === undefined || value === '' || key === 'success' || key === 'error') return null
            if (typeof value === 'object') return null

            const label = key
              .replace(/([A-Z])/g, ' $1')
              .replace(/_/g, ' ')
              .replace(/^\w/, c => c.toUpperCase())
              .trim()

            return (
              <div key={key} className="vr-detail-row">
                <span className="vr-detail-label">{label}</span>
                <span className="vr-detail-value">
                  {String(value)}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* AI Fraud Analysis Section (Path B) */}
      {fraud && (
        <div className="vr-fraud-section">
          <div className="vr-fraud-header">
            <span className="vr-fraud-title">🛡️ AI Fraud Analysis</span>
            <span className="vr-fraud-badge" style={{ color: getRiskColor(fraud.risk_score), borderColor: getRiskColor(fraud.risk_score) }}>
              {getRiskLabel(fraud.status)}
            </span>
          </div>

          <div className="vr-fraud-score-bar">
            <div className="vr-fraud-score-track">
              <div
                className="vr-fraud-score-fill"
                style={{
                  width: `${Math.min(fraud.risk_score, 100)}%`,
                  background: getRiskColor(fraud.risk_score),
                }}
              />
            </div>
            <span className="vr-fraud-score-value" style={{ color: getRiskColor(fraud.risk_score) }}>
              {fraud.risk_score.toFixed(1)}
            </span>
          </div>

          <div className="vr-fraud-meta">
            <span>Confidence: {(fraud.confidence * 100).toFixed(0)}%</span>
            <span>Anomaly: {fraud.is_anomaly ? 'Yes' : 'No'}</span>
          </div>

          {fraud.contributing_features && fraud.contributing_features.length > 0 && (
            <div className="vr-fraud-features">
              <span className="vr-fraud-features-label">Contributing factors:</span>
              {fraud.contributing_features.slice(0, 3).map((f, i) => (
                <span key={i} className="vr-fraud-feature-chip">
                  {f.feature.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
