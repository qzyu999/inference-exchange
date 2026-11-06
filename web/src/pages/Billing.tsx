import useSWR from 'swr'
import { useAuth } from '../lib/auth'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { formatUsd, formatUsdPrecise, microToUsd, sumMicro } from '../lib/money.js'
import { requestedModelLabel, servedModelLabel } from '../lib/model-attribution.js'
import { UI } from '../lib/theme'

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return `${n}`
}

export function Billing() {
  const { user } = useAuth()
  const { data: usage, error: usageError } = useSWR(user ? ['usage', user.user_id] : null, api.usage, { refreshInterval: 10000 })
  const { data: balance, error: balErr } = useSWR(user ? ['me', user.user_id] : null, api.me, { refreshInterval: 5000 })
  const { data: history } = useSWR(user ? ['history', user.user_id] : null, api.history, { refreshInterval: 10000 })
  const { data: pricing } = useSWR('pricing', api.pricing, { refreshInterval: 15000 })
  const { data: billingConfig } = useSWR('billingConfig', api.billingConfig)
  const minCharge = billingConfig?.minimum_charge_usd ?? 0.0001

  // Spend by model, summed in integer micro-USD (BILL-009)
  const transactions = history?.transactions || []
  const spendByModel: Record<string, number> = {}
  for (const row of usage?.models || []) {
    const model = row.served_model || 'Unknown served model'
    spendByModel[model] = (spendByModel[model] || 0) + microToUsd(row.cost_micro)
  }
  const listedSpent = microToUsd(sumMicro(transactions))
  const minimumCount = transactions.filter(t => t.minimum_applied).length
  const totalSpent = microToUsd(usage?.cost_micro || 0)
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
            { label: 'Balance (simulated credits)', value: formatUsd(balance.balance_usd), exact: formatUsdPrecise(balance.balance_usd), color: UI.success },
            { label: 'Your spend · all time', value: formatUsd(balance.total_spent_usd), exact: formatUsdPrecise(balance.total_spent_usd), color: UI.text },
            { label: 'Requests', value: balance.requests_made.toLocaleString(), color: UI.text },
            { label: 'Tokens', value: formatTokens(balance.tokens_consumed), color: UI.text },
          ].map(s => (
            <div key={s.label} className="bg-ui-surface rounded-2xl border border-ui-border px-5 py-4">
              <div className="text-2xl font-bold tracking-tight" style={{ color: s.color }} title={s.exact}>{s.value}</div>
              <div className="text-[11px] mt-0.5" style={{ color: UI.muted }}>{s.label}</div>
              {s.exact && s.exact !== s.value && (
                <div className="text-[10px] font-mono mt-0.5" style={{ color: UI.muted }}>exact {s.exact}</div>
              )}
            </div>
          ))}
        </div>
      ) : balErr ? (
        <div className="rounded-2xl border p-5 text-sm" style={{ background: UI.dangerSurface, borderColor: UI.border, color: UI.danger }}>
          Could not load balance. Is the coordinator running?
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => (
            <div key={i} className="bg-ui-surface rounded-2xl border border-ui-border p-5 animate-pulse">
              <div className="h-7 bg-ui-track rounded w-20 mb-1" />
              <div className="h-3 bg-ui-track rounded w-14" />
            </div>
          ))}
        </div>
      )}

      {/* Two-column: Usage + Pricing */}
      <div className="flex gap-5 flex-col lg:flex-row">
        {/* Usage: Spend by model */}
        <div className="flex-1 bg-ui-surface rounded-2xl border border-ui-border p-6">
          <div className="text-[10px] uppercase tracking-wider font-medium mb-1" style={{ color: UI.accent }}>
            Usage
          </div>
          <h2 className="text-lg font-bold mb-5" style={{ color: UI.text }}>Your spend by model · all time</h2>

          {topModels.length > 0 ? (
            <div className="space-y-4">
              {topModels.map(([model, spend]) => {
                const pct = totalSpent > 0 ? (spend / totalSpent) * 100 : 0
                return (
                  <div key={model} className="flex items-center gap-3">
                    <span className="text-sm w-36 truncate" style={{ color: UI.text }}>{model}</span>
                    <span className="text-sm font-semibold w-20" style={{ color: UI.accent }}>
                      {formatUsd(spend)}
                    </span>
                    <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: UI.track }}>
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${Math.max(3, pct)}%`, background: UI.accent }}
                      />
                    </div>
                    <span className="text-xs w-10 text-right" style={{ color: UI.muted }}>
                      {pct.toFixed(0)}%
                    </span>
                  </div>
                )
              })}
              {otherSpend > 0 && (
                <div className="flex items-center gap-3">
                  <span className="text-sm w-36" style={{ color: UI.muted }}>Other</span>
                  <span className="text-sm font-semibold w-20" style={{ color: UI.muted }}>
                    {formatUsd(otherSpend)}
                  </span>
                  <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: UI.track }}>
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(3, totalSpent > 0 ? (otherSpend / totalSpent) * 100 : 0)}%`,
                        background: UI.track,
                      }}
                    />
                  </div>
                  <span className="text-xs w-10 text-right" style={{ color: UI.muted }}>
                    {totalSpent > 0 ? ((otherSpend / totalSpent) * 100).toFixed(0) : 0}%
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="text-sm py-8 text-center" style={{ color: UI.muted }}>
              {usageError ? 'Usage unavailable. Try again later.' : !usage ? 'Loading usage…' : 'No usage yet. Use the API to see your spend.'}
            </div>
          )}
        </div>

        {/* Pricing sidebar */}
        <div className="w-full lg:w-64 shrink-0 bg-ui-surface rounded-2xl border border-ui-border p-6">
          <div className="text-[10px] uppercase tracking-wider font-medium mb-1" style={{ color: UI.accent }}>
            Pricing
          </div>
          <h2 className="text-lg font-bold mb-5" style={{ color: UI.text }}>Three token prices</h2>

          <div className="space-y-4">
            <div>
              <div className="text-xs" style={{ color: UI.muted }}>Input</div>
              <div className="text-xl font-bold mt-0.5" style={{ color: UI.text }}>
                ${cheapestPricing ? (cheapestPricing as any).input?.toFixed(2) || '0.08' : '0.08'} / M
              </div>
            </div>
            <div>
              <div className="text-xs" style={{ color: UI.muted }}>Cached</div>
              <div className="text-xl font-bold mt-0.5" style={{ color: UI.accent }}>
                $0.02 / M
              </div>
            </div>
            <div>
              <div className="text-xs" style={{ color: UI.muted }}>Output</div>
              <div className="text-xl font-bold mt-0.5" style={{ color: UI.text }}>
                ${cheapestPricing ? (cheapestPricing as any).output?.toFixed(2) || '0.15' : '0.15'} / M
              </div>
            </div>

            <div className="pt-3" style={{ borderTop: "1px solid var(--ui-border)" }}>
              <div className="text-xs" style={{ color: UI.muted }}>Provider share</div>
              <div className="text-xl font-bold mt-0.5" style={{ color: UI.success }}>
                {100 - (billingConfig?.platform_fee_percent ?? 10)}%
              </div>
            </div>
            <div className="pt-3" style={{ borderTop: "1px solid var(--ui-border)" }}>
              <div className="text-xs" style={{ color: UI.muted }}>Minimum per request</div>
              <div className="text-xl font-bold mt-0.5" style={{ color: UI.text }}>{formatUsd(minCharge)}</div>
              <div className="text-[11px] mt-1 leading-snug" style={{ color: UI.body }}>
                If the token cost of a request is less than this, you pay the minimum.
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Transaction history table */}
      <div className="bg-ui-surface rounded-2xl border border-ui-border p-6">
        <div className="text-[10px] uppercase tracking-wider font-medium mb-1" style={{ color: UI.accent }}>
          Transaction History
        </div>
        <h2 className="text-lg font-bold mb-4" style={{ color: UI.text }}>Every request, every charge</h2>

        <div className="grid grid-cols-12 gap-2 pb-2 mb-2 border-b border-ui-border text-[9px] uppercase tracking-wider" style={{ color: UI.muted }}>
          <div className="col-span-2">Time</div>
          <div className="col-span-1">ID</div>
          <div className="col-span-2">Model</div>
          <div className="col-span-1 text-right" style={{ color: UI.info }}>Input</div>
          <div className="col-span-1 text-right" style={{ color: UI.info }}>Cache</div>
          <div className="col-span-1 text-right" style={{ color: UI.accent }}>Output</div>
          <div className="col-span-2 text-right">Cost</div>
          <div className="col-span-2 text-right">Trace</div>
        </div>

        {transactions.length > 0 ? (
          <div className="max-h-[400px] overflow-y-auto">
            {transactions.map((t: any, i: number) => {
              const time = new Date(t.timestamp * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
              return (
                <div key={i} className="grid grid-cols-12 gap-2 py-2.5 items-center border-b border-ui-border last:border-0 text-xs">
                  <div className="col-span-2" style={{ color: UI.muted }}>{time}</div>
                  <div className="col-span-1 font-mono truncate" style={{ color: UI.muted }}>{t.request_id?.slice(0, 8) || '—'}</div>
                  <div className="col-span-2 min-w-0" style={{ color: UI.text }} title={`Requested: ${requestedModelLabel(t)}`}>
                     <div className="truncate">{servedModelLabel(t)}</div>
                     <div className="text-[9px] truncate" style={{ color: UI.muted }}>Requested: {requestedModelLabel(t)}</div>
                   </div>
                  <div className="col-span-1 text-right" style={{ color: UI.info }}>{(t.input_tokens || 0).toLocaleString()}</div>
                  <div className="col-span-1 text-right" style={{ color: (t.cached_tokens || 0) > 0 ? UI.info : UI.muted }}>
                    {(t.cached_tokens || 0) > 0 ? (t.cached_tokens || 0).toLocaleString() : '—'}
                  </div>
                  <div className="col-span-1 text-right" style={{ color: UI.accent }}>{(t.output_tokens || 0).toLocaleString()}</div>
                  <div className="col-span-2 text-right font-semibold" style={{ color: UI.danger }} title={t.minimum_applied ? 'Minimum charge applied' : undefined}>
                    -{formatUsdPrecise(t.cost_usd)}{t.minimum_applied && <span className="ml-1 text-[9px] font-normal" style={{ color: UI.muted }}>min</span>}
                  </div>
                  <div className="col-span-2 text-right">
                    {t.request_id && <Link to={`/trace?id=${encodeURIComponent(t.full_request_id || t.request_id)}`} className="text-[10px] font-medium" style={{ color: UI.accent }}>View trace</Link>}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="text-sm text-center py-8" style={{ color: UI.muted }}>No transactions yet</div>
        )}

        {transactions.length > 0 && (
          <div className="mt-3 pt-3 border-t border-ui-border text-xs space-y-0.5" style={{ color: UI.body }}>
            <div>
              {transactions.length} listed {transactions.length === 1 ? 'charge' : 'charges'}: <span className="font-mono">{formatUsdPrecise(listedSpent)}</span>
              {balance && <> · all-time spent: <span className="font-mono">{formatUsdPrecise(balance.total_spent_usd)}</span></>}
              {balance && history && transactions.length < balance.requests_made && ' (the list shows the most recent 50)'}
            </div>
            {minimumCount > 0 && (
              <div>{minimumCount} of these {minimumCount === 1 ? 'was' : 'were'} billed at the {formatUsd(minCharge)} minimum ("min").</div>
            )}
          </div>
        )}
      </div>

      {/* Alpha reset CTA */}
      <div className="rounded-2xl border px-5 py-4 flex items-center justify-between" style={{ background: UI.warningSurface, borderColor: UI.border }}>
        <div>
          <div className="text-sm font-semibold" style={{ color: UI.text }}>Alpha credits</div>
          <div className="text-xs" style={{ color: UI.muted }}>
            Simulated credits, not real money. No payments are taken. Amounts are in USD, stored as whole micro-dollars ($0.000001). {billingConfig?.allow_balance_reset ? 'Local development allows test resets.' : 'Balance resets are disabled on the public alpha.'}
          </div>
        </div>
        {billingConfig?.allow_balance_reset === true && (
          <button
            onClick={async () => {
              const response = await fetch('/v1/auth/reset-balance', { method: 'POST', credentials: 'include' })
              if (response.ok) window.location.reload()
            }}
            className="px-4 py-2 rounded-xl text-sm font-medium transition-colors shrink-0"
            style={{ background: UI.action, color: UI.onAction }}
          >
            Reset to $10
          </button>
        )}
      </div>
    </div>
  )
}
