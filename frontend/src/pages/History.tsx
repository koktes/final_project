import { useEffect, useMemo, useRef, useState } from 'react'
import {
  exportHistoryCsv,
  exportHistoryXlsx,
  fetchHistory,
  fetchHistoryImage,
  retryVerificationRecord,
  type HistoryFilters,
  type VerificationRecord,
} from '../api/client'
import './History.css'

export default function History() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [records, setRecords] = useState<VerificationRecord[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [successCount, setSuccessCount] = useState(0)
  const [failedCount, setFailedCount] = useState(0)
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({})
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [retryDetail, setRetryDetail] = useState<{ id: string; data: any; bank: string } | null>(null)
  const imageUrlRef = useRef<Record<string, string>>({})

  const [filters, setFilters] = useState<HistoryFilters>({
    search: '',
    bank: '',
    status: '',
    method: '',
    startDate: '',
    endDate: '',
    minAmount: '',
    maxAmount: '',
    pageSize: 12,
    sort: 'desc',
  })

  const bankOptions = useMemo(() => ['cbe', 'cbe_birr', 'telebirr', 'dashen', 'abyssinia', 'mpesa'], [])

  async function loadHistory(nextPage = page, nextFilters: HistoryFilters = filters) {
    setLoading(true)
    setError(null)

    try {
      const response = await fetchHistory({ ...nextFilters, page: nextPage })
      setRecords(response.data)
      setPage(response.pagination.page)
      setTotalPages(response.pagination.totalPages)
      setTotal(response.pagination.total)
      setSuccessCount(response.summary.successCount)
      setFailedCount(response.summary.failedCount)
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message)
      } else {
        setError('Failed to load history')
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadHistory(1)
  }, [])

  useEffect(() => {
    if (records.length === 0) return

    const missing = records.filter((record) => record.imagePath && !imageUrls[record.id])
    if (missing.length === 0) return

    let cancelled = false

    Promise.all(
      missing.map(async (record) => {
        const blob = await fetchHistoryImage(record.id)
        const url = URL.createObjectURL(blob)
        return { id: record.id, url }
      })
    )
      .then((entries) => {
        if (cancelled) {
          entries.forEach((entry) => URL.revokeObjectURL(entry.url))
          return
        }

        setImageUrls((prev) => {
          const next = { ...prev }
          entries.forEach((entry) => {
            next[entry.id] = entry.url
          })
          imageUrlRef.current = next
          return next
        })
      })
      .catch(() => {
        if (!cancelled) {
          setError('Some images failed to load')
        }
      })

    return () => {
      cancelled = true
    }
  }, [records, imageUrls])

  useEffect(() => {
    return () => {
      Object.values(imageUrlRef.current).forEach((url) => URL.revokeObjectURL(url))
    }
  }, [])

  function updateFilter<K extends keyof HistoryFilters>(key: K, value: HistoryFilters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }))
  }

  function applyFilters(event: React.FormEvent) {
    event.preventDefault()
    void loadHistory(1, filters)
  }

  function clearFilters() {
    const nextFilters: HistoryFilters = {
      search: '',
      bank: '',
      status: '',
      method: '',
      startDate: '',
      endDate: '',
      minAmount: '',
      maxAmount: '',
      pageSize: 12,
      sort: 'desc',
    }
    setFilters(nextFilters)
    void loadHistory(1, nextFilters)
  }

  async function handleExport(format: 'csv' | 'xlsx') {
    setLoading(true)
    setError(null)
    try {
      const blob = format === 'csv' ? await exportHistoryCsv(filters) : await exportHistoryXlsx(filters)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      const now = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')
      link.href = url
      link.download = `verification-history-${now}.${format}`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message)
      } else {
        setError('Failed to export history')
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleRetry(recordId: string) {
    setRetryingId(recordId)
    setError(null)
    try {
      const res = await retryVerificationRecord(recordId)
      if (!res.success) {
        setToast({ message: res?.data?.error || 'Retry failed', type: 'error' })
        setTimeout(() => setToast(null), 4000)
        return
      }

      // Update the record in-place with returned updatedRecord if provided
      if (res.updatedRecord) {
        setRecords((prev) => prev.map((r) => (r.id === res.updatedRecord!.id ? res.updatedRecord! : r)))
      } else {
        // fallback: reload page
        await loadHistory(page, filters)
      }

      setToast({ message: 'Retry successful', type: 'success' })
      setTimeout(() => setToast(null), 4000)

      if (res.data) {
        // show detailed response for the retried record
        const bankId = res.updatedRecord?.bank || (records.find((r) => r.id === recordId)?.bank || '')
        setRetryDetail({ id: recordId, data: res.data, bank: bankId })
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        setToast({ message: err.message, type: 'error' })
      } else {
        setToast({ message: 'Failed to retry verification', type: 'error' })
      }
      setTimeout(() => setToast(null), 4000)
    } finally {
      setRetryingId(null)
    }
  }

  function formatAmount(value: number | null): string {
    if (value === null) return '-'
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value)
  }

  function formatDate(value: string): string {
    return new Date(value).toLocaleString()
  }

  return (
    <div className="history-page animate-fade-in">
      <div className="history-header">
        <div>
          <h1>Verification History</h1>
          <p>Focused records with server-side filters and visual receipts.</p>
        </div>
        <div className="history-actions">
          <button className="history-action" onClick={() => void handleExport('csv')} disabled={loading}>Export CSV</button>
          <button className="history-action primary" onClick={() => void handleExport('xlsx')} disabled={loading}>Export Excel</button>
        </div>
      </div>

      <div className="history-layout">
        <aside className="history-panel card">
          <form className="history-filters" onSubmit={applyFilters}>
            <div className="filter-section">
              <label>Search</label>
              <input
                value={filters.search || ''}
                onChange={(e) => updateFilter('search', e.target.value)}
                placeholder="Reference, payer, receiver, phone"
              />
            </div>

            <div className="filter-section">
              <label>Bank</label>
              <select value={filters.bank || ''} onChange={(e) => updateFilter('bank', e.target.value)}>
                <option value="">All banks</option>
                {bankOptions.map((bank) => (
                  <option key={bank} value={bank}>{bank}</option>
                ))}
              </select>
            </div>

            <div className="filter-section two-col">
              <div>
                <label>Status</label>
                <select value={filters.status || ''} onChange={(e) => updateFilter('status', e.target.value as HistoryFilters['status'])}>
                  <option value="">Any</option>
                  <option value="SUCCESS">SUCCESS</option>
                  <option value="FAILED">FAILED</option>
                </select>
              </div>
              <div>
                <label>Method</label>
                <select value={filters.method || ''} onChange={(e) => updateFilter('method', e.target.value as HistoryFilters['method'])}>
                  <option value="">Any</option>
                  <option value="MANUAL">MANUAL</option>
                  <option value="IMAGE">IMAGE</option>
                  <option value="API">API</option>
                </select>
              </div>
            </div>

            <div className="filter-section two-col">
              <div>
                <label>From</label>
                <input type="date" value={filters.startDate || ''} onChange={(e) => updateFilter('startDate', e.target.value)} />
              </div>
              <div>
                <label>To</label>
                <input type="date" value={filters.endDate || ''} onChange={(e) => updateFilter('endDate', e.target.value)} />
              </div>
            </div>

            <div className="filter-section two-col">
              <div>
                <label>Min amount</label>
                <input type="number" min="0" step="0.01" value={filters.minAmount || ''} onChange={(e) => updateFilter('minAmount', e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <label>Max amount</label>
                <input type="number" min="0" step="0.01" value={filters.maxAmount || ''} onChange={(e) => updateFilter('maxAmount', e.target.value)} placeholder="0.00" />
              </div>
            </div>

            <div className="filter-section two-col">
              <div>
                <label>Sort</label>
                <select value={filters.sort || 'desc'} onChange={(e) => updateFilter('sort', e.target.value as 'asc' | 'desc')}>
                  <option value="desc">Newest</option>
                  <option value="asc">Oldest</option>
                </select>
              </div>
              <div>
                <label>Per page</label>
                <select value={String(filters.pageSize || 12)} onChange={(e) => updateFilter('pageSize', Number(e.target.value))}>
                  <option value="8">8</option>
                  <option value="12">12</option>
                  <option value="20">20</option>
                </select>
              </div>
            </div>

            <div className="filter-actions">
              <button type="submit" className="filter-btn primary" disabled={loading}>Apply filters</button>
              <button type="button" className="filter-btn" onClick={clearFilters} disabled={loading}>Reset</button>
            </div>
          </form>
        </aside>

        <section className="history-results">
          {retryDetail && (
            <div className="history-retry-detail card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3>Retry Result</h3>
                <button onClick={() => setRetryDetail(null)}>Close</button>
              </div>
              <div style={{ marginTop: 12 }}>
                {/* Render a simple JSON preview and keep the UI lightweight */}
                <pre style={{ maxHeight: 300, overflow: 'auto' }}>{JSON.stringify(retryDetail.data, null, 2)}</pre>
              </div>
            </div>
          )}

          {toast && (
            <div className={`history-toast ${toast.type}`}>{toast.message}</div>
          )}
          <div className="history-summary">
            <div className="summary-card">
              <span>Total</span>
              <strong>{total}</strong>
            </div>
            <div className="summary-card success">
              <span>Success</span>
              <strong>{successCount}</strong>
            </div>
            <div className="summary-card failed">
              <span>Failed</span>
              <strong>{failedCount}</strong>
            </div>
          </div>

          {error && <div className="history-error">{error}</div>}

          {loading ? (
            <div className="history-empty card">Loading records...</div>
          ) : records.length === 0 ? (
            <div className="history-empty card">No records match the current filters.</div>
          ) : (
            <div className="history-list">
              {records.map((item) => (
                <div className="history-card card" key={item.id}>
                  <div className="history-card-image">
                    {item.imagePath && imageUrls[item.id] ? (
                      <img src={imageUrls[item.id]} alt="Receipt" />
                    ) : (
                      <div className="history-card-placeholder">No image</div>
                    )}
                  </div>
                  <div className="history-card-body">
                    <div className="history-card-top">
                      <span className="history-card-bank">{item.bank}</span>
                      <span className={`status-pill ${item.status === 'SUCCESS' ? 'success' : 'failed'}`}>{item.status}</span>
                    </div>
                    <div className="history-card-ref">{item.reference || 'No reference provided'}</div>
                    <div className="history-card-meta">
                      <span>Amount: {formatAmount(item.amount)}</span>
                      <span>Method: {item.method}</span>
                    </div>
                    <div className="history-card-sub">
                      <span>Payer: {item.payerName || '-'}</span>
                      <span>Receiver: {item.receiverName || '-'}</span>
                      <span>Phone: {item.phoneNumber || '-'}</span>
                    </div>
                    {item.error && <div className="history-card-error">{item.error}</div>}
                    <div className="history-card-footer">
                      <span>{formatDate(item.createdAt)}</span>
                      {item.status === 'FAILED' && (
                        <button
                          className="history-retry-btn"
                          onClick={() => void handleRetry(item.id)}
                          disabled={retryingId === item.id}
                          type="button"
                        >
                          {retryingId === item.id ? 'Retrying...' : 'Retry'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="history-pagination">
            <button disabled={loading || page <= 1} onClick={() => void loadHistory(page - 1, filters)}>Previous</button>
            <span>Page {page} of {totalPages}</span>
            <button disabled={loading || page >= totalPages} onClick={() => void loadHistory(page + 1, filters)}>Next</button>
          </div>
        </section>
      </div>
    </div>
  )
}
