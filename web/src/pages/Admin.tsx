import { useState } from 'react'
import useSWR from 'swr'
import { api } from '../lib/api'

function JsonView({ data }: { data: unknown }) {
  return (
    <pre className="bg-gray-900 text-gray-300 rounded-xl p-4 text-xs font-mono overflow-x-auto max-h-80 overflow-y-auto">
      {JSON.stringify(data, null, 2)}
    </pre>
  )
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-5 py-4 text-sm font-semibold text-gray-900 hover:bg-gray-50 transition-colors">
        <span>{title}{count != null ? ` (${count})` : ''}</span>
        <span className="text-gray-300 text-xs">{open ? '▼' : '▶'}</span>
      </button>
      {open && <div className="px-5 pb-5 border-t border-gray-100">{children}</div>}
    </div>
  )
}

export function Admin() {
  const { data: state, error: stateErr } = useSWR('adminState', api.adminState, { refreshInterval: 5000 })
  const { data: stats } = useSWR('stats', api.stats, { refreshInterval: 3000 })
  const { data: tpsData } = useSWR('tps', api.tps, { refreshInterval: 5000 })
  const { data: repData } = useSWR('reputation', api.reputation, { refreshInterval: 5000 })
  const { data: telemetry } = useSWR('telemetry', api.telemetry, { refreshInterval: 5000 })
  const { data: traces } = useSWR('traces', api.traces, { refreshInterval: 3000 })

  if (stateErr) return <div className="bg-red-50 rounded-2xl border border-red-200 p-5 text-red-600 text-sm">Failed to load: {stateErr.message}</div>

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Admin</h1>
        <p className="text-sm text-gray-400 mt-1">System state and operations</p>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: 'Providers', value: stats.providers_online },
            { label: 'Models', value: stats.models_available },
            { label: 'Requests', value: stats.total_requests },
            { label: 'Volume', value: `$${stats.total_volume_usd.toFixed(4)}` },
            { label: 'Tokens', value: stats.total_tokens.toLocaleString() },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl border border-gray-200/60 shadow-sm p-3 text-center">
              <div className="text-xs text-gray-400">{s.label}</div>
              <div className="text-lg font-bold text-gray-900">{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {state?.accounts && (
        <Section title="Accounts" count={state.accounts.length}>
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-gray-400 border-b border-gray-100">
                <th className="py-2 text-left font-medium">ID</th><th className="py-2 text-right font-medium">Balance</th><th className="py-2 text-right font-medium">Spent</th><th className="py-2 text-right font-medium">Requests</th><th className="py-2 text-right font-medium">Tokens</th>
              </tr></thead>
              <tbody>{state.accounts.map((a: any) => (
                <tr key={a.account_id} className="border-b border-gray-50">
                  <td className="py-2 font-mono text-xs text-gray-500">{a.consumer_id?.slice(0, 16) || a.account_id?.slice(0, 16)}</td>
                  <td className="py-2 text-right text-emerald-600">${a.balance_usd.toFixed(4)}</td>
                  <td className="py-2 text-right">${a.total_spent_usd.toFixed(4)}</td>
                  <td className="py-2 text-right">{a.requests_made}</td>
                  <td className="py-2 text-right">{a.tokens_consumed?.toLocaleString()}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Section>
      )}

      {tpsData?.tps_stats && tpsData.tps_stats.length > 0 && (
        <Section title="TPS Performance" count={tpsData.tps_stats.length}>
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-gray-400 border-b border-gray-100">
                <th className="py-2 text-left font-medium">Provider</th><th className="py-2 text-left font-medium">Model</th><th className="py-2 text-right font-medium">Est</th><th className="py-2 text-right font-medium">Observed</th><th className="py-2 text-right font-medium">Effective</th><th className="py-2 text-center font-medium">Anomaly</th>
              </tr></thead>
              <tbody>{tpsData.tps_stats.map((t: any, i: number) => (
                <tr key={i} className="border-b border-gray-50">
                  <td className="py-2 font-mono text-xs text-gray-500">{t.provider_id.slice(0, 12)}</td>
                  <td className="py-2 text-xs">{t.model}</td>
                  <td className="py-2 text-right">{t.estimated_tps.toFixed(1)}</td>
                  <td className="py-2 text-right">{t.observed_tps_ema.toFixed(1)}</td>
                  <td className="py-2 text-right font-semibold">{t.effective_tps.toFixed(1)}</td>
                  <td className="py-2 text-center">{t.is_anomalous ? '⚠️' : '✓'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Section>
      )}

      {repData?.reputation && repData.reputation.length > 0 && (
        <Section title="Reputation" count={repData.reputation.length}>
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-gray-400 border-b border-gray-100">
                <th className="py-2 text-left font-medium">Provider</th><th className="py-2 text-right font-medium">Score</th><th className="py-2 text-right font-medium">EMA</th><th className="py-2 text-right font-medium">OK</th><th className="py-2 text-right font-medium">Fail</th><th className="py-2 text-center font-medium">Status</th>
              </tr></thead>
              <tbody>{repData.reputation.map((r: any) => (
                <tr key={r.provider_id} className="border-b border-gray-50">
                  <td className="py-2 font-mono text-xs text-gray-500">{r.provider_id.slice(0, 12)}</td>
                  <td className="py-2 text-right font-semibold">{r.score.toFixed(2)}</td>
                  <td className="py-2 text-right">{(r.success_rate_ema * 100).toFixed(0)}%</td>
                  <td className="py-2 text-right text-emerald-600">{r.total_successes}</td>
                  <td className="py-2 text-right text-red-500">{r.total_failures}</td>
                  <td className="py-2 text-center">{r.is_degraded ? '🔴' : '🟢'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Section>
      )}

      {traces?.traces && traces.traces.length > 0 && (
        <Section title="Decision Traces" count={traces.traces.length}>
          <div className="space-y-3 mt-3">
            {traces.traces.slice(-5).reverse().map((t: any) => (
              <div key={t.request_id} className="bg-gray-50 rounded-xl p-4">
                <div className="flex items-center gap-3 text-sm mb-2">
                  <span className="font-mono text-xs text-gray-400">{t.request_id.slice(0, 12)}</span>
                  <span className="font-medium text-gray-900">{t.model}</span>
                  <span className={t.status === 'completed' ? 'text-emerald-600' : 'text-red-500'}>{t.status}</span>
                  {t.preference && <span className="text-xs text-gray-400">{t.preference}</span>}
                </div>
                {t.scoring && t.scoring.length > 0 && (
                  <table className="w-full text-xs">
                    <thead><tr className="text-gray-400">
                      <th className="py-1 text-left">Provider</th><th className="py-1 text-right">Price</th><th className="py-1 text-left">Trust</th><th className="py-1 text-right">Load</th><th className="py-1 text-right">Score</th><th className="py-1 text-center">Win</th>
                    </tr></thead>
                    <tbody>{t.scoring.map((s: any, i: number) => (
                      <tr key={i} className={s.selected ? 'text-gray-900 font-medium' : 'text-gray-500'}>
                        <td className="py-1">{s.name.slice(0, 12)}</td>
                        <td className="py-1 text-right">${s.price.toFixed(2)}</td>
                        <td className="py-1">{s.trust}</td>
                        <td className="py-1 text-right">{(s.load * 100).toFixed(0)}%</td>
                        <td className="py-1 text-right font-mono">{s.score.toFixed(3)}</td>
                        <td className="py-1 text-center">{s.selected ? '✓' : ''}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {telemetry && <Section title="Telemetry"><div className="mt-3"><JsonView data={telemetry} /></div></Section>}
      {state && <Section title="Raw State"><div className="mt-3"><JsonView data={state} /></div></Section>}
    </div>
  )
}
