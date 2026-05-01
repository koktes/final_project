import { useEffect, useMemo, useRef, useState } from 'react'
import { BANKS, getBankById, type BankType, type ImageDetectionResult, verifyImageAutoVerify } from '../api/client'
import VerificationResult from '../components/VerificationResult'
import './BulkImageImport.css'

type BulkItemStatus = 'queued' | 'verifying' | 'success' | 'failed'

interface BulkImageItem {
  id: string;
  file: File;
  previewUrl: string;
  status: BulkItemStatus;
  result: ImageDetectionResult | null;
  error: string | null;
}

const MAX_FILES = 20

function isVerified(result: ImageDetectionResult | null): boolean {
  if (!result) return false
  if (typeof (result as { verified?: boolean }).verified === 'boolean') {
    return Boolean((result as { verified?: boolean }).verified)
  }
  if (typeof (result as { success?: boolean }).success === 'boolean') {
    return Boolean((result as { success?: boolean }).success)
  }
  return !result.error
}

export default function BulkImageImport() {
  const [items, setItems] = useState<BulkImageItem[]>([])
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const itemUrlsRef = useRef<string[]>([])

  const summary = useMemo(() => {
    const successCount = items.filter((item) => item.status === 'success' || isVerified(item.result)).length
    const failedCount = items.filter((item) => item.status === 'failed' || (item.result && !isVerified(item.result))).length
    return {
      total: items.length,
      successCount,
      failedCount,
      completed: successCount + failedCount,
    }
  }, [items])

  function revokeCurrentUrls() {
    itemUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    itemUrlsRef.current = []
  }

  function makeItems(files: File[]) {
    revokeCurrentUrls()
    const urls: string[] = []
    const nextItems = files.map((file, index) => {
      const previewUrl = URL.createObjectURL(file)
      urls.push(previewUrl)
      return {
        id: `${file.name}-${file.lastModified}-${index}`,
        file,
        previewUrl,
        status: 'queued' as BulkItemStatus,
        result: null,
        error: null,
      }
    })
    itemUrlsRef.current = urls
    setItems(nextItems)
    setError(null)
  }

  function handleFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList).filter((file) => file.type.startsWith('image/'))
    if (files.length === 0) {
      setError('Please choose image files only.')
      return
    }
    if (files.length > MAX_FILES) {
      setError(`Select up to ${MAX_FILES} images at a time.`)
      return
    }
    makeItems(files)
  }

  async function startImport() {
    if (!items.length || processing) return

    setProcessing(true)
    setError(null)

    const snapshot = items
    for (const current of snapshot) {
      setItems((prev) => prev.map((item) => (item.id === current.id ? { ...item, status: 'verifying', error: null } : item)))

      try {
        const result = await verifyImageAutoVerify(current.file)
        const verified = isVerified(result)
        setItems((prev) => prev.map((item) => (
          item.id === current.id
            ? { ...item, status: verified ? 'success' : 'failed', result, error: verified ? null : result?.error || 'Verification failed' }
            : item
        )))
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Verification failed'
        setItems((prev) => prev.map((item) => (
          item.id === current.id
            ? { ...item, status: 'failed', result: null, error: message }
            : item
        )))
      }
    }

    setProcessing(false)
  }

  function clearBatch() {
    revokeCurrentUrls()
    setItems([])
    setError(null)
    setProcessing(false)
    if (inputRef.current) {
      inputRef.current.value = ''
    }
  }

  useEffect(() => {
    return () => {
      revokeCurrentUrls()
    }
  }, [])

  return (
    <div className="bulk-image-import animate-fade-in">
      <div className="page-header">
        <h1>Bulk Image Import</h1>
        <p>Upload multiple receipt images, verify them one by one, and review the results in one pass.</p>
      </div>

      <div className="bulk-toolbar card">
        <div>
          <h3>Batch upload</h3>
          <p>Supports JPG, PNG, WebP, BMP, and TIFF. Max {MAX_FILES} images per batch.</p>
        </div>
        <div className="bulk-toolbar-actions">
          <button className="bulk-btn" type="button" onClick={() => inputRef.current?.click()} disabled={processing}>
            Add Images
          </button>
          <button className="bulk-btn secondary" type="button" onClick={clearBatch} disabled={processing && items.length === 0}>
            Clear
          </button>
          <button className="bulk-btn primary" type="button" onClick={() => void startImport()} disabled={processing || items.length === 0}>
            {processing ? 'Importing...' : 'Start Import'}
          </button>
        </div>
      </div>

      <div
        className={`bulk-dropzone card ${processing ? 'busy' : ''}`}
        onDragOver={(e) => { e.preventDefault() }}
        onDrop={(e) => {
          e.preventDefault()
          if (!processing) handleFiles(e.dataTransfer.files)
        }}
        onClick={() => !processing && inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files && !processing) {
              handleFiles(e.target.files)
            }
          }}
        />
        <div className="bulk-dropzone-inner">
          <div className="bulk-dropzone-icon">▤</div>
          <h3>Drop multiple receipt images here</h3>
          <p>or click to select a batch from your device</p>
        </div>
      </div>

      {error && <div className="history-error">{error}</div>}

      {items.length > 0 && (
        <div className="bulk-summary-grid">
          <div className="summary-card">
            <span>Total files</span>
            <strong>{summary.total}</strong>
          </div>
          <div className="summary-card success">
            <span>Verified</span>
            <strong>{summary.successCount}</strong>
          </div>
          <div className="summary-card failed">
            <span>Failed</span>
            <strong>{summary.failedCount}</strong>
          </div>
          <div className="summary-card">
            <span>Completed</span>
            <strong>{summary.completed}</strong>
          </div>
        </div>
      )}

      {items.length > 0 && (
        <div className="bulk-progress card">
          <div className="bulk-progress-head">
            <span>Progress</span>
            <span>{summary.completed}/{summary.total}</span>
          </div>
          <div className="bulk-progress-track">
            <div
              className="bulk-progress-fill"
              style={{ width: `${summary.total > 0 ? Math.round((summary.completed / summary.total) * 100) : 0}%` }}
            />
          </div>
        </div>
      )}

      {items.length > 0 && (
        <div className="bulk-results">
          {items.map((item) => {
            const bank = item.result?.bank ? getBankById(item.result.bank as BankType) : null

            return (
              <article className="bulk-item card" key={item.id}>
                <div className="bulk-item-preview">
                  <img src={item.previewUrl} alt={item.file.name} />
                </div>

                <div className="bulk-item-body">
                  <div className="bulk-item-head">
                    <div>
                      <h3>{item.file.name}</h3>
                      <p>{(item.file.size / 1024 / 1024).toFixed(2)} MB</p>
                    </div>
                    <span className={`bulk-status ${item.status}`}>{item.status === 'verifying' ? 'Verifying' : item.status === 'success' ? 'Verified' : item.status === 'failed' ? 'Failed' : 'Queued'}</span>
                  </div>

                  {item.result && bank ? (
                    <VerificationResult data={item.result} bank={bank} />
                  ) : item.error ? (
                    <div className="bulk-item-error">{item.error}</div>
                  ) : (
                    <div className="bulk-item-placeholder">Waiting to be processed.</div>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}

      <section className="bulk-support card">
        <h3>Supported banks</h3>
        <div className="bulk-bank-list">
          {BANKS.map((bank) => (
            <span key={bank.id} className="bulk-bank-pill" style={{ color: bank.color }}>
              {bank.shortName}
            </span>
          ))}
        </div>
      </section>
    </div>
  )
}