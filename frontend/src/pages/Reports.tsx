import { useEffect, useMemo, useState } from 'react'
import { fetchHistoryStats, type HistoryFilters, type HistoryStats } from '../api/client'
import './History.css'
import './Reports.css'

export default function Reports() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<HistoryStats | null>(null)
  const [range, setRange] = useState<'7' | '30' | '90'>('30')

  const dateFilter = useMemo(() => {
    const days = Number(range)
    const start = new Date()
    start.setDate(start.getDate() - days)
    return start.toISOString().slice(0, 10)
  }, [range])

  async function loadStats() {
    setLoading(true)
    setError(null)

    const filters: HistoryFilters = {
      startDate: dateFilter,
      sort: 'desc',
    }

    try {
      const data = await fetchHistoryStats(filters)
      setStats(data)
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message)
      } else {
        setError('Failed to load reports')
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadStats()
  }, [dateFilter])

  function formatAmount(value: number): string {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value)
  }

  return (
    <div className="reports-page animate-fade-in">
      <div className="page-header">
        <h1>Reports & Analytics</h1>
        <p>Real-time insights from your verification history</p>
      </div>

      <div className="reports-toolbar card">
        <div>
          <h3>Time window</h3>
          <p>Filter analytics by recent activity</p>
        </div>
        <select value={range} onChange={(e) => setRange(e.target.value as '7' | '30' | '90')}>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>
      </div>

      {error && <div className="history-error">{error}</div>}

      {!stats || loading ? (
        <div className="history-empty card">Loading report data...</div>
      ) : (
        <>
          <div className="reports-stats-grid">
            <div className="report-stat-card">
              <span>Total Verifications</span>
              <strong>{stats.total}</strong>
            </div>
            <div className="report-stat-card">
              <span>Success Rate</span>
              <strong>{stats.successRate}%</strong>
            </div>
            <div className="report-stat-card">
              <span>Successful Volume</span>
              <strong>{formatAmount(stats.totalSuccessfulAmount)}</strong>
            </div>
            <div className="report-stat-card">
              <span>Avg Success Amount</span>
              <strong>{formatAmount(stats.averageSuccessfulAmount)}</strong>
            </div>
          </div>

          <div className="reports-grid">
            <section className="reports-card card">
              <h3>Bank Breakdown</h3>
              <div className="reports-list">
                {stats.bankBreakdown.length === 0 ? (
                  <p className="reports-empty">No records in this range.</p>
                ) : (
                  stats.bankBreakdown.map((row) => (
                    <div className="reports-list-item" key={row.bank}>
                      <span>{row.bank}</span>
                      <span>{row.count} ({row.percent}%)</span>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="reports-card card">
              <h3>Method Breakdown</h3>
              <div className="reports-list">
                {stats.methodBreakdown.length === 0 ? (
                  <p className="reports-empty">No records in this range.</p>
                ) : (
                  stats.methodBreakdown.map((row) => (
                    <div className="reports-list-item" key={row.method}>
                      <span>{row.method}</span>
                      <span>{row.count} ({row.percent}%)</span>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>

          <section className="reports-card card">
            <h3>Daily Activity Trend</h3>
            <div className="trend-list">
              {stats.dailyTrend.length === 0 ? (
                <p className="reports-empty">No activity in this range.</p>
              ) : (
                stats.dailyTrend.map((point) => (
                  <div className="trend-item" key={point.date}>
                    <span>{point.date}</span>
                    <div className="trend-bar-wrap">
                      <div
                        className="trend-bar"
                        style={{
                          width: `${Math.max((point.count / Math.max(...stats.dailyTrend.map((x) => x.count), 1)) * 100, 5)}%`,
                        }}
                      ></div>
                    </div>
                    <span>{point.count}</span>
                  </div>
                ))
              )}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
