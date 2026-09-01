import { useState } from 'react'
import useSWR from 'swr'
import { api } from '../lib/api'

function JsonView({ data }: { data: unknown }) {
  return (
    <pre className="bg-gray-900 text-green-400 rounded-lg p-4 text-xs font-mono overflow-x-auto max-h-96 overflow-y-auto">
      {JSON.stringify(data, null, 2)}
    </pre>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50"
      >
        {title}
        <span className="text-gray-400">{open ? '▼' : '▶'}</span>
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
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

  if (stateErr) {
    return (
      <div className="text-red-500 text-sm p-4">
        Failed to load admin state: {stateErr.message}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Admin</h1>

      {/* Quick Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: 'Providers', value: stats.providers_online },
            { label: 'Models', value: stats.models_available },
            { label: 'Requests', value: stats.total_requests },
            { label: 'Volume', value: `$${stats.total_volume_usd.toFixed(4)}` },
            { label: 'Tokens', value: stats.total_tokens.toLocaleString() },
          ].map(s => (
            <div key={s.label} className="bg-white border border-gray-200 rounded-lg p-3 text-center">
              <div className="text-xs text-gray-500">{s.label}</div>
              <div className="text-lg font-bold">{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* System Components */}
      {state && (
        <Section title="System Components">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Object.entries(state.components || {}).map(([name, info]: [string, any]) => (
              <div key={name} className="border border-gray-100 rounded p-3">
                <div className="text-xs text-gray-500">{name}</div>
                <div className={`text-sm font-semibold ${info.status === 'active' ? 'text-green-600' : 'text-red-500'}`}>
                  {info.status || 'unknown'}
                </div>
                {info.count != null && <div className="text-xs text-gray-400">{info.count} items</div>}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Accounts & Balances */}
      {state?.accounts && (
        <Section title={`Accounts (${state.accounts.length})`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 uppercase border-b">
                  <th className="py-2 px-3 text-left">Consumer ID</th>
                  <th className="py-2 px-3 text-right">Balance</th>
                  <th className="py-2 px-3 text-right">Spent</th>
                  <th className="py-2 px-3 text-right">Requests</th>
                  <th className="py-2 px-3 text-right">Tokens</th>
                </tr>
              </thead>
              <tbody>
                {state.accounts.map((a: any) => (
                  <tr key={a.consumer_id} className="border-b border-gray-50">
                    <td className="py-2 px-3 font-mono text-xs">{a.consumer_id.slice(0, 16)}</td>
                    <td className="py-2 px-3 text-right text-green-600">${a.balance_usd.toFixed(4)}</td>
                    <td className="py-2 px-3 text-right">${a.total_spent_usd.toFixed(4)}</td>
                    <td className="py-2 px-3 text-right">{a.requests_made}</td>
                    <td className="py-2 px-3 text-right">{a.tokens_consumed.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* TPS Performance */}
      {tpsData?.tps_stats && tpsData.tps_stats.length > 0 && (
        <Section title={`TPS Performance (${tpsData.tps_stats.length})`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 uppercase border-b">
                  <th className="py-2 px-3 text-left">Provider</th>
                  <th className="py-2 px-3 text-left">Model</th>
                  <th className="py-2 px-3 text-left">Hardware</th>
                  <th className="py-2 px-3 text-right">Est TPS</th>
                  <th className="py-2 px-3 text-right">Observed (EMA)</th>
                  <th className="py-2 px-3 text-right">Effective</th>
                  <th className="py-2 px-3 text-right">Requests</th>
                  <th className="py-2 px-3 text-center">Anomalous</th>
                </tr>
              </thead>
              <tbody>
                {tpsData.tps_stats.map((t: any, i: number) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="py-2 px-3 font-mono text-xs">{t.provider_id.slice(0, 12)}</td>
                    <td className="py-2 px-3">{t.model}</td>
                    <td className="py-2 px-3 text-xs">{t.hardware}</td>
                    <td className="py-2 px-3 text-right">{t.estimated_tps.toFixed(1)}</td>
                    <td className="py-2 px-3 text-right">{t.observed_tps_ema.toFixed(1)}</td>
                    <td className="py-2 px-3 text-right font-semibold">{t.effective_tps.toFixed(1)}</td>
                    <td className="py-2 px-3 text-right">{t.total_requests}</td>
                    <td className="py-2 px-3 text-center">{t.is_anomalous ? '⚠️' : '✓'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* Reputation */}
      {repData?.reputation && repData.reputation.length > 0 && (
        <Section title={`Reputation (${repData.reputation.length})`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 uppercase border-b">
                  <th className="py-2 px-3 text-left">Provider</th>
                  <th className="py-2 px-3 text-right">Score</th>
                  <th className="py-2 px-3 text-right">Success EMA</th>
                  <th className="py-2 px-3 text-right">Total</th>
                  <th className="py-2 px-3 text-right">Successes</th>
                  <th className="py-2 px-3 text-right">Failures</th>
                  <th className="py-2 px-3 text-center">Degraded</th>
                </tr>
              </thead>
              <tbody>
                {repData.reputation.map((r: any) => (
                  <tr key={r.provider_id} className="border-b border-gray-50">
                    <td className="py-2 px-3 font-mono text-xs">{r.provider_id.slice(0, 12)}</td>
                    <td className="py-2 px-3 text-right font-semibold">{r.score.toFixed(2)}</td>
                    <td className="py-2 px-3 text-right">{(r.success_rate_ema * 100).toFixed(0)}%</td>
                    <td className="py-2 px-3 text-right">{r.total_requests}</td>
                    <td className="py-2 px-3 text-right text-green-600">{r.total_successes}</td>
                    <td className="py-2 px-3 text-right text-red-500">{r.total_failures}</td>
                    <td className="py-2 px-3 text-center">{r.is_degraded ? '🔴' : '🟢'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* Recent Decision Traces */}
      {traces?.traces && traces.traces.length > 0 && (
        <Section title={`Decision Traces (${traces.traces.length})`}>
          <div className="space-y-3">
            {traces.traces.slice(-5).reverse().map((t: any) => (
              <div key={t.request_id} className="border border-gray-100 rounded p-3">
                <div className="flex items-center gap-3 text-sm mb-2">
                  <span className="font-mono text-xs text-gray-400">{t.request_id.slice(0, 12)}</span>
                  <span className="font-medium">{t.model}</span>
                  <span className={t.status === 'completed' ? 'text-green-600' : 'text-red-500'}>{t.status}</span>
                  {t.preference && <span className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{t.preference}</span>}
                </div>
                {t.scoring && t.scoring.length > 0 && (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-400 border-b">
                        <th className="py-1 text-left">Provider</th>
                        <th className="py-1 text-right">Price</th>
                        <th className="py-1 text-left">Trust</th>
                        <th className="py-1 text-right">Load</th>
                        <th className="py-1 text-right">TPS</th>
                        <th className="py-1 text-right">Score</th>
                        <th className="py-1 text-center">✓</th>
                      </tr>
                    </thead>
                    <tbody>
                      {t.scoring.map((s: any, i: number) => (
                        <tr key={i} className={s.selected ? 'bg-green-50 font-medium' : ''}>
                          <td className="py-1">{s.name.slice(0, 12)}</td>
                          <td className="py-1 text-right">${s.price.toFixed(2)}</td>
                          <td className="py-1">{s.trust}</td>
                          <td className="py-1 text-right">{(s.load * 100).toFixed(0)}%</td>
                          <td className="py-1 text-right">{s.tps.toFixed(1)}</td>
                          <td className="py-1 text-right font-mono">{s.score.toFixed(3)}</td>
                          <td className="py-1 text-center">{s.selected ? '✓' : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Telemetry */}
      {telemetry && (
        <Section title="Telemetry">
          <JsonView data={telemetry} />
        </Section>
      )}

      {/* Raw State */}
      {state && (
        <Section title="Raw System State">
          <JsonView data={state} />
        </Section>
      )}
    </div>
  )
}
