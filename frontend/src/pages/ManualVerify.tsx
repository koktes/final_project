import { useState } from 'react'
import type { BankInfo } from '../api/client'
import { BANKS, verifyManual } from '../api/client'
import VerificationResult from '../components/VerificationResult'
import './ManualVerify.css'

export default function ManualVerify() {
  const [selectedBank, setSelectedBank] = useState<BankInfo | null>(null)
  const [formValues, setFormValues] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  function selectBank(bank: BankInfo) {
    setSelectedBank(bank)
    setFormValues({})
    setResult(null)
    setError(null)
  }

  function handleChange(field: string, value: string) {
    setFormValues(prev => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedBank) return

    setLoading(true)
    setResult(null)
    setError(null)

    try {
      const data = await verifyManual(selectedBank, formValues)
      setResult(data)
    } catch (err: any) {
      setError(err.message || 'Network error. Is the API server running?')
    } finally {
      setLoading(false)
    }
  }

  function reset() {
    setSelectedBank(null)
    setFormValues({})
    setResult(null)
    setError(null)
  }

  return (
    <div className="manual-verify animate-fade-in">
      <div className="page-header">
        <h1>Manual Verification</h1>
        <p>Select a bank and enter the transaction details</p>
      </div>

      {!selectedBank ? (
        <div className="bank-selector">
          <div className="bank-grid">
            {BANKS.map(bank => (
              <button
                key={bank.id}
                className="bank-select-card"
                onClick={() => selectBank(bank)}
                style={{ '--bcolor': bank.color, '--bdim': `var(--bank-${bank.id.replace('_', '')}-dim)`, '--bbg': `var(--bank-${bank.id.replace('_', '')}-bg)` } as React.CSSProperties}
              >
                <div className="bsc-icon">
                  <span className="bsc-dot"></span>
                </div>
                <h3>{bank.shortName}</h3>
                <p>{bank.name}</p>
                <div className="bsc-fields">
                  {bank.fields.map(f => (
                    <span key={f.name} className="bsc-field-tag">{f.label}</span>
                  ))}
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="verify-flow animate-fade-in">
          <div className="flow-header">
            <button className="back-btn" onClick={reset}>← Back</button>
            <div className="flow-bank-info" style={{ '--bcolor': selectedBank.color } as React.CSSProperties}>
              <span className="flow-bank-dot" style={{ background: selectedBank.color }}></span>
              <span className="flow-bank-name">{selectedBank.name}</span>
            </div>
          </div>

          {!result ? (
            <form className="verify-form card" onSubmit={handleSubmit}>
              <div className="form-fields">
                {selectedBank.fields.map(field => (
                  <div key={field.name} className="form-group">
                    <label htmlFor={field.name}>
                      {field.label}
                      {field.required && <span className="required">*</span>}
                    </label>
                    <input
                      id={field.name}
                      type={field.type}
                      placeholder={field.placeholder}
                      value={formValues[field.name] || ''}
                      onChange={e => handleChange(field.name, e.target.value)}
                      required={field.required}
                      autoComplete="off"
                      className="form-input"
                    />
                    {field.helpText && <span className="form-help">{field.helpText}</span>}
                  </div>
                ))}
              </div>

              {error && (
                <div className="form-error animate-fade-in">
                  <span>⚠</span> {error}
                </div>
              )}

              <button
                type="submit"
                className="submit-btn"
                disabled={loading}
                style={{ '--bcolor': selectedBank.color } as React.CSSProperties}
              >
                {loading ? (
                  <span className="btn-loading">
                    <span className="spinner"></span>
                    Verifying...
                  </span>
                ) : (
                  <>Verify Transaction</>
                )}
              </button>
            </form>
          ) : (
            <div className="animate-fade-in">
              <VerificationResult
                data={result}
                bank={selectedBank}
              />
              <div className="result-actions">
                <button className="action-btn secondary" onClick={() => { setResult(null); setFormValues({}); }}>
                  Verify Another ({selectedBank.shortName})
                </button>
                <button className="action-btn secondary" onClick={reset}>
                  Change Bank
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
