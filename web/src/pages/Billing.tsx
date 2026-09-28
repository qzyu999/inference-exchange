import useSWR from 'swr'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { C } from '../lib/theme'

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return `${n}`
}

export function Billing() {
  const { data: balance, error: balErr } = useSWR('me', api.me, { refreshInterval: 5000 })
  const { data: history } = useSWR('history', api.history, { refreshInterval: 10000 })
  const { data: pricing } = useSWR('pricing', api.pricing, { refreshInterval: 15000 })

  // Compute spend by model from transaction history
  const transactions = history?.transactions || []
  const spendByModel: Record<string, number> = {}
  for (const t of transactions) {
    const model = (t as any).model || 'unknown'
    spendByModel[model] = (spendByModel[model] || 0) + ((t as any).cost_usd || 0)
  }
  const totalSpent = balance?.total_spent_usd || Object.values(spendByModel).reduce((a, b) => a + b, 0)
  const sortedModels = Object.entries(spendByModel).sort((a, b) => b[1] - a[1])
  const topModels = sortedModels.slice(0, 4)
  const otherSpend = sortedModels.slice(4).reduce((sum, [, v]) => sum + v, 0)

  // Get cheapest pricing for the sidebar
  const cheapestPricing = pricing?.pricing?.[0]

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      {balance ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Balance', value: `$${balance.balance_usd.toFixed(2)}`, color: C.green },
            { label: 'Spent', value: `$${balance.total_spent_usd.toFixed(2)}`, color: C.blueBlack },
            { label: 'Requests', value: balance.requests_made.toLocaleString(), color: C.blueBlack },
            { label: 'Tokens', value: formatTokens(balance.tokens_consumed), color: C.blueBlack },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-2xl border border-gray-200/40 px-5 py-4">
              <div className="text-2xl font-bold tracking-tight" style={{ color: s.color }}>{s.value}</div>
              <div className="text-[11px] mt-0.5" style={{ color: '#999' }}>{s.label}</div>
            </div>
          ))}
        </div>
      ) : balErr ? (
        <div className="rounded-2xl border p-5 text-sm" style={{ background: '#fdf5f4', borderColor: '#e8c5c0', color: C.red }}>
          Could not load balance. Is the coordinator running?
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => (
            <div key={i} className="bg-white rounded-2xl border border-gray-200/40 p-5 animate-pulse">
              <div className="h-7 bg-gray-100 rounded w-20 mb-1" />
              <div className="h-3 bg-gray-100 rounded w-14" />
            </div>
          ))}
        </div>
      )}

      {/* Two-column: Usage + Pricing */}
      <div className="flex gap-5 flex-col lg:flex-row">
        {/* Usage: Spend by model */}
        <div className="flex-1 bg-white rounded-2xl border border-gray-200/40 p-6">
          <div className="text-[10px] uppercase tracking-wider font-medium mb-1" style={{ color: C.gold }}>
            Usage
          </div>
          <h2 className="text-lg font-bold mb-5" style={{ color: C.blueBlack }}>Spend by model</h2>

          {topModels.length > 0 ? (
            <div className="space-y-4">
              {topModels.map(([model, spend]) => {
                const pct = totalSpent > 0 ? (spend / totalSpent) * 100 : 0
                return (
                  <div key={model} className="flex items-center gap-3">
                    <span className="text-sm w-36 truncate" style={{ color: C.blueBlack }}>{model}</span>
                    <span className="text-sm font-semibold w-14" style={{ color: C.gold }}>
                      ${spend.toFixed(2)}
                    </span>
                    <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: '#eaeae8' }}>
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${Math.max(3, pct)}%`, background: C.gold }}
                      />
                    </div>
                    <span className="text-xs w-10 text-right" style={{ color: '#999' }}>
                      {pct.toFixed(0)}%
                    </span>
                  </div>
                )
              })}
              {otherSpend > 0 && (
                <div className="flex items-center gap-3">
                  <span className="text-sm w-36" style={{ color: '#999' }}>Other</span>
                  <span className="text-sm font-semibold w-14" style={{ color: '#999' }}>
                    ${otherSpend.toFixed(2)}
                  </span>
                  <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: '#eaeae8' }}>
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(3, totalSpent > 0 ? (otherSpend / totalSpent) * 100 : 0)}%`,
                        background: '#ccc',
                      }}
                    />
                  </div>
                  <span className="text-xs w-10 text-right" style={{ color: '#999' }}>
                    {totalSpent > 0 ? ((otherSpend / totalSpent) * 100).toFixed(0) : 0}%
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="text-sm py-8 text-center" style={{ color: '#ccc' }}>
              No usage yet. Send a chat request to see spend breakdown.
            </div>
          )}
        </div>

        {/* Pricing sidebar */}
        <div className="w-full lg:w-64 shrink-0 bg-white rounded-2xl border border-gray-200/40 p-6">
          <div className="text-[10px] uppercase tracking-wider font-medium mb-1" style={{ color: C.gold }}>
            Pricing
          </div>
          <h2 className="text-lg font-bold mb-5" style={{ color: C.blueBlack }}>Three token prices</h2>

          <div className="space-y-4">
            <div>
              <div className="text-xs" style={{ color: '#888' }}>Input</div>
              <div className="text-xl font-bold mt-0.5" style={{ color: C.blueBlack }}>
                ${cheapestPricing ? (cheapestPricing as any).input?.toFixed(2) || '0.08' : '0.08'} / M
              </div>
            </div>
            <div>
              <div className="text-xs" style={{ color: '#888' }}>Cached</div>
              <div className="text-xl font-bold mt-0.5" style={{ color: C.gold }}>
                $0.02 / M
              </div>
            </div>
            <div>
              <div className="text-xs" style={{ color: '#888' }}>Output</div>
              <div className="text-xl font-bold mt-0.5" style={{ color: C.blueBlack }}>
                ${cheapestPricing ? (cheapestPricing as any).output?.toFixed(2) || '0.15' : '0.15'} / M
              </div>
            </div>

            <div className="pt-3" style={{ borderTop: '1px solid #e5e5e3' }}>
              <div className="text-xs" style={{ color: '#888' }}>Provider share</div>
              <div className="text-xl font-bold mt-0.5" style={{ color: C.green }}>90%</div>
            </div>
          </div>
        </div>
      </div>

      {/* Transaction history table */}
      <div className="bg-white rounded-2xl border border-gray-200/40 p-6">
        <div className="text-[10px] uppercase tracking-wider font-medium mb-1" style={{ color: C.gold }}>
          Transaction History
        </div>
        <h2 className="text-lg font-bold mb-4" style={{ color: C.blueBlack }}>Every request, every charge</h2>

        <div className="grid grid-cols-12 gap-2 pb-2 mb-2 border-b border-gray-100 text-[9px] uppercase tracking-wider" style={{ color: '#bbb' }}>
          <div className="col-span-2">Time</div>
          <div className="col-span-1">ID</div>
          <div className="col-span-2">Model</div>
          <div className="col-span-1 text-right" style={{ color: C.deepBlue }}>Input</div>
          <div className="col-span-1 text-right" style={{ color: C.turquoise }}>Cache</div>
          <div className="col-span-1 text-right" style={{ color: C.gold }}>Output</div>
          <div className="col-span-2 text-right">Cost</div>
          <div className="col-span-2 text-right">Trace</div>
        </div>

        {transactions.length > 0 ? (
          <div className="max-h-[400px] overflow-y-auto">
            {[...transactions].reverse().map((t: any, i: number) => {
              const time = new Date(t.timestamp * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
              return (
                <div key={i} className="grid grid-cols-12 gap-2 py-2.5 items-center border-b border-gray-50 last:border-0 text-xs">
                  <div className="col-span-2" style={{ color: '#999' }}>{time}</div>
                  <div className="col-span-1 font-mono truncate" style={{ color: '#bbb' }}>{t.request_id?.slice(0, 8) || '—'}</div>
                  <div className="col-span-2 truncate" style={{ color: C.blueBlack }}>{t.model || '—'}</div>
                  <div className="col-span-1 text-right" style={{ color: C.deepBlue }}>{(t.input_tokens || 0).toLocaleString()}</div>
                  <div className="col-span-1 text-right" style={{ color: (t.cached_tokens || 0) > 0 ? C.turquoise : '#ddd' }}>
                    {(t.cached_tokens || 0) > 0 ? (t.cached_tokens || 0).toLocaleString() : '—'}
                  </div>
                  <div className="col-span-1 text-right" style={{ color: C.gold }}>{(t.output_tokens || 0).toLocaleString()}</div>
                  <div className="col-span-2 text-right font-semibold" style={{ color: C.red }}>-${(t.cost_usd || 0).toFixed(6)}</div>
                  <div className="col-span-2 text-right">
                    {t.request_id && <Link to={`/trace?id=${t.request_id}`} className="text-[10px] font-medium" style={{ color: C.gold }}>View trace</Link>}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="text-sm text-center py-8" style={{ color: '#ccc' }}>No transactions yet</div>
        )}
      </div>

      {/* Alpha reset CTA */}
      <div className="rounded-2xl border px-5 py-4 flex items-center justify-between" style={{ background: '#fdf6ec', borderColor: 'rgba(196,154,69,0.15)' }}>
        <div>
          <div className="text-sm font-semibold" style={{ color: C.blueBlack }}>Alpha credits</div>
          <div className="text-xs" style={{ color: '#888' }}>Reset your balance anytime during the alpha.</div>
        </div>
        <button
          onClick={async () => {
            await fetch('/v1/auth/reset-balance', { method: 'POST', credentials: 'include' })
            window.location.reload()
          }}
          className="px-4 py-2 rounded-xl text-sm font-medium transition-colors shrink-0"
          style={{ background: C.gold, color: 'white' }}
        >
          Reset to $10
        </button>
      </div>
    </div>
  )
}
