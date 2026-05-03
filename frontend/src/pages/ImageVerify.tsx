import { useState, useCallback, useRef } from 'react'
import type { ImageDetectionResult, BankType } from '../api/client'
import { verifyImage, verifyImageAutoVerify, getBankById, BANKS } from '../api/client'
import VerificationResult from '../components/VerificationResult'
import './ImageVerify.css'

type Stage = 'upload' | 'scanning' | 'detected' | 'params' | 'verifying' | 'result'

export default function ImageVerify() {
  const debugVision = new URLSearchParams(window.location.search).get('debugVision') === 'true'
  const [stage, setStage] = useState<Stage>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [detection, setDetection] = useState<ImageDetectionResult | null>(null)
  const [extraParams, setExtraParams] = useState<Record<string, string>>({})
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [aiOnly, setAiOnly] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback(async (f: File) => {
    setFile(f)
    setPreview(URL.createObjectURL(f))
    setStage('scanning')
    setError(null)
    setDetection(null)
    setResult(null)
    setExtraParams({})
    setAiOnly(false)

    try {
      const det = await verifyImage(f, undefined, false, debugVision)
      setDetection(det)

      if (det.error && !det.bank) {
        setError(det.error)
        setStage('upload')
        return
      }

      if (det.missingParams && det.missingParams.length > 0) {
        setStage('params')
      } else {
        setStage('detected')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to analyze image')
      setStage('upload')
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f && f.type.startsWith('image/')) handleFile(f)
  }, [handleFile])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) handleFile(f)
  }

  async function handleVerify() {
    if (!file) return
    setStage('verifying')
    try {
      const allParams = { ...extraParams }
      const res = await verifyImageAutoVerify(file, allParams, aiOnly)
      setResult(res)
      setStage('result')
    } catch (err: any) {
      setError(err.message || 'Verification failed')
      setStage('detected')
    }
  }

  function reset() {
    setFile(null)
    setPreview(null)
    setDetection(null)
    setResult(null)
    setError(null)
    setExtraParams({})
    setStage('upload')
    if (inputRef.current) inputRef.current.value = ''
  }

  const detectedBank = detection?.bank ? getBankById(detection.bank as BankType) : null

  return (
    <div className="image-verify animate-fade-in">
      <div className="page-header">
        <h1>Image Verification</h1>
        <p>Upload a receipt screenshot — AI will detect the bank and extract the reference</p>
      </div>

      <div className="iv-layout">
        {/* Left: Upload area */}
        <div className="iv-left">
          <div
            className={`iv-dropzone ${dragOver ? 'drag-over' : ''} ${stage !== 'upload' ? 'has-image' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => stage === 'upload' && inputRef.current?.click()}
          >
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              onChange={handleInputChange}
              style={{ display: 'none' }}
            />

            {!preview ? (
              <div className="dz-empty">
                <div className="dz-icon">◐</div>
                <h3>Drop receipt image here</h3>
                <p>or click to browse • JPG, PNG, WebP</p>
              </div>
            ) : (
              <div className="dz-preview">
                <img src={preview} alt="Receipt" />
                {stage === 'scanning' && (
                  <div className="scan-overlay">
                    <div className="scan-line"></div>
                    <span className="scan-text">Analyzing receipt...</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {preview && stage !== 'upload' && (
            <button className="iv-change-btn" onClick={reset}>
              ↺ Upload different image
            </button>
          )}
        </div>

        {/* Right: Detection & Verification */}
        <div className="iv-right">
          {error && stage === 'upload' && (
            <div className="iv-error animate-fade-in">
              <div className="iv-error-icon">!</div>
              <h3>Could Not Identify Receipt</h3>
              <p>{error}</p>
              <p className="iv-error-hint">Try a clearer image, better crop, or use manual verification</p>
            </div>
          )}

          {(stage === 'detected' || stage === 'params') && detection && detectedBank && (
            <div className="iv-detection animate-fade-in">
              <div className="det-header" style={{ '--bcolor': detectedBank.color } as React.CSSProperties}>
                <div className="det-icon" style={{ background: `var(--bank-${detectedBank.id.replace('_','')}-dim)` }}>
                  <span style={{ color: detectedBank.color }}>✓</span>
                </div>
                <div>
                  <h3>Receipt Identified</h3>
                  <span className="det-bank-name" style={{ color: detectedBank.color }}>{detectedBank.name}</span>
                </div>
              </div>

              <div className="det-details">
                {typeof detection.reference === 'string' && detection.reference && (
                  <div className="det-row">
                    <span className="det-label">{typeof detection.referenceLabel === 'string' ? detection.referenceLabel : 'Reference'}</span>
                    <span className="det-value mono">{detection.reference}</span>
                  </div>
                )}
                {detection.visionReference && (
                  <div className="det-row">
                    <span className="det-label">Vision {detection.visionReferenceLabel || 'Reference'}</span>
                    <span className="det-value mono">{detection.visionReference}</span>
                  </div>
                )}
                {detection.visionOrderId && detection.visionOrderId !== detection.visionReference && (
                  <div className="det-row">
                    <span className="det-label">Vision Order ID</span>
                    <span className="det-value mono">{detection.visionOrderId}</span>
                  </div>
                )}
                {detection.visionReceiptNumber && detection.visionReceiptNumber !== detection.visionReference && (
                  <div className="det-row">
                    <span className="det-label">Vision Receipt Number</span>
                    <span className="det-value mono">{detection.visionReceiptNumber}</span>
                  </div>
                )}
                {detection.visionConfidence && (
                  <div className="det-row">
                    <span className="det-label">Vision Confidence</span>
                    <span className={`det-confidence ${detection.visionConfidence}`}>
                      {detection.visionConfidence === 'high' ? '● High' : detection.visionConfidence === 'medium' ? '◐ Medium' : '○ Low'}
                    </span>
                  </div>
                )}
                {detection.orderId && detection.orderId !== detection.reference && (
                  <div className="det-row">
                    <span className="det-label">Order ID</span>
                    <span className="det-value mono">{detection.orderId}</span>
                  </div>
                )}
                {detection.receiptNumber && detection.receiptNumber !== detection.reference && (
                  <div className="det-row">
                    <span className="det-label">Receipt Number</span>
                    <span className="det-value mono">{detection.receiptNumber}</span>
                  </div>
                )}
                {detection.extractedPhoneNumber && (
                  <div className="det-row">
                    <span className="det-label">Sender Phone</span>
                    <span className="det-value mono">{detection.extractedPhoneNumber}</span>
                  </div>
                )}
                <div className="det-row">
                  <span className="det-label">Confidence</span>
                  <span className={`det-confidence ${detection.confidence}`}>
                    {detection.confidence === 'high' ? '● High' : detection.confidence === 'medium' ? '◐ Medium' : '○ Low'}
                  </span>
                </div>
                <div className="det-row">
                  <span className="det-label">Source</span>
                  <span className="det-value">{detection.source === 'local-ocr' ? 'Local OCR' : 'AI Vision'}</span>
                </div>
              </div>

              {stage === 'params' && detection.missingParams && (
                <div className="det-params">
                  <h4>Additional Information Needed</h4>
                  {detection.missingParams.map(param => {
                    const paramLabel = detection.requiredParams?.[param] || param
                    return (
                      <div key={param} className="det-param-field">
                        <label>{param === 'reference' ? 'Reference Number' : param === 'accountNumber' ? 'Account Number' : param === 'phoneNumber' ? 'Phone Number' : param}</label>
                        <input
                          type="text"
                          placeholder={typeof paramLabel === 'string' ? paramLabel : ''}
                          value={extraParams[param] || ''}
                          onChange={e => setExtraParams(prev => ({ ...prev, [param]: e.target.value }))}
                          className="form-input"
                        />
                        {typeof paramLabel === 'string' && <span className="form-help">{paramLabel}</span>}
                      </div>
                    )
                  })}
                </div>
              )}

              <label className="ai-only-row">
                <input
                  type="checkbox"
                  checked={aiOnly}
                  onChange={e => setAiOnly(e.target.checked)}
                />
                <span className="ai-only-label">AI-only mode</span>
                <span className="form-help">Skip bank API and replay checks, and score the OCR payload directly.</span>
              </label>

              <button
                className="submit-btn det-verify-btn"
                onClick={handleVerify}
                disabled={stage === 'params' && detection.missingParams?.some(p => !extraParams[p])}
              >
                Verify This Transaction
              </button>
            </div>
          )}

          {stage === 'verifying' && (
            <div className="iv-verifying animate-fade-in">
              <div className="verifying-spinner"></div>
              <h3>Verifying transaction...</h3>
              <p>Contacting {detectedBank?.name || 'bank'} servers</p>
            </div>
          )}

          {stage === 'result' && result && detectedBank && (
            <div className="animate-fade-in">
              <VerificationResult data={result} bank={detectedBank} />
              <div className="result-actions" style={{ marginTop: 16 }}>
                <button className="action-btn secondary" onClick={reset}>
                  Verify Another Receipt
                </button>
              </div>
            </div>
          )}

          {stage === 'upload' && !error && (
            <div className="iv-instructions">
              <h3>How it works</h3>
              <div className="iv-steps">
                <div className="iv-step">
                  <span className="step-num">1</span>
                  <div>
                    <h4>Upload</h4>
                    <p>Drop or select a receipt screenshot</p>
                  </div>
                </div>
                <div className="iv-step">
                  <span className="step-num">2</span>
                  <div>
                    <h4>AI Detection</h4>
                    <p>OCR identifies the bank & extracts the reference</p>
                  </div>
                </div>
                <div className="iv-step">
                  <span className="step-num">3</span>
                  <div>
                    <h4>Verify</h4>
                    <p>One click to verify against the bank's servers</p>
                  </div>
                </div>
              </div>

              <div className="iv-supported">
                <span className="iv-supported-label">Supported:</span>
                {BANKS.map(b => (
                  <span key={b.id} className="iv-supported-bank" style={{ color: b.color }}>{b.shortName}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
