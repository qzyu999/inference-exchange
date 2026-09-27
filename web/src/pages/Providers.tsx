import useSWR from 'swr'
import { Link } from 'react-router-dom'
import { api, Provider } from '../lib/api'

// ─── Brand palette ───────────────────────────────────────────
const C = {
  gold: '#C49A45',
  green: '#3F8055',
  turquoise: '#4D9A91',
  deepBlue: '#315B72',
  blueBlack: '#292F35',
}

const TRUST_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  open:         { bg: '#f3f3f3', text: '#999',     label: 'Open' },
  contained:    { bg: '#eef3f7', text: C.deepBlue, label: 'Contained' },
  hardened:     { bg: '#fdf6ec', text: C.gold,     label: 'Hardened+' },
  confidential: { bg: '#edf7f1', text: C.green,    label: 'Confidential' },
}

// ─── Page ────────────────────────────────────────────────────

export function Providers() {
  const { data: provData } = useSWR('providers', api.providers, { refreshInterval: 5000 })
  const { data: stats } = useSWR('stats', api.stats, { refreshInterval: 10000 })

  const providers = provData?.providers || []
  const hardenedCount = providers.filter(p =>
    p.trust_level === 'hardened' || p.trust_level === 'confidential'
  ).length
  const modelCount = stats?.models_available || [...new Set(providers.flatMap(p => p.models))].length
  const cheapestOut = providers.length > 0
    ? Math.min(...providers.map(p => p.price_output).filter(p => p > 0))
    : 0

  return (
    <div className="space-y-6">
      {/* Stat cards + CTA */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex-1 grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: 'providers online', value: providers.length },
            { label: 'Hardened+', value: hardenedCount },
            { label: 'models live', value: modelCount },
            { label: 'lowest Qwen out', value: cheapestOut > 0 ? `$${cheapestOut.toFixed(2)}` : '—' },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-2xl border border-gray-200/40 px-5 py-4">
              <div className="text-2xl font-bold tracking-tight" style={{ color: C.blueBlack }}>
                {s.value}
              </div>
              <div className="text-[11px] mt-0.5" style={{ color: '#999' }}>{s.label}</div>
            </div>
          ))}
        </div>
        <Link
          to="/providers" // Future: link to provider setup docs
          className="px-5 py-3 rounded-xl text-sm font-medium shrink-0 transition-colors"
          style={{ background: C.blueBlack, color: '#fff' }}
        >
          Run a provider
        </Link>
      </div>

      {/* Provider table */}
      <div className="bg-white rounded-2xl border border-gray-200/40 overflow-hidden">
        <div className="text-[10px] uppercase tracking-wider font-medium px-5 pt-4 pb-2" style={{ color: C.gold }}>
          Available Providers
        </div>

        {providers.length > 0 ? (
          <div>
            {providers.map((p: Provider) => {
              const tc = TRUST_COLORS[p.trust_level] || TRUST_COLORS.open
              const modelName = p.models?.[0] || '—'
              return (
                <div
                  key={p.id}
                  className="flex items-center gap-4 px-5 py-4 border-t border-gray-50 hover:bg-gray-50/50 transition-colors"
                >
                  {/* Name + hardware */}
                  <div className="w-40 min-w-0">
                    <div className="text-sm font-semibold truncate" style={{ color: C.blueBlack }}>
                      {p.name || p.id.slice(0, 12)}
                    </div>
                    <div className="text-xs truncate" style={{ color: '#999' }}>
                      {p.hardware || 'Unknown'}
                    </div>
                  </div>

                  {/* Model */}
                  <div className="flex-1 min-w-0">
                    <span className="text-sm truncate" style={{ color: C.blueBlack }}>{modelName}</span>
                  </div>

                  {/* Price */}
                  <div className="w-16 text-right">
                    <span className="text-sm font-semibold" style={{ color: C.gold }}>
                      ${p.price_output.toFixed(2)}
                    </span>
                  </div>

                  {/* Speed */}
                  <div className="w-20 text-right">
                    <span className="text-sm" style={{ color: C.turquoise }}>
                      {p.measured_tps > 0 ? `${p.measured_tps.toFixed(0)} tok/s` : '—'}
                    </span>
                  </div>

                  {/* Trust */}
                  <div className="w-24">
                    <span
                      className="text-[10px] font-medium px-2.5 py-1 rounded-full"
                      style={{ background: tc.bg, color: tc.text }}
                    >
                      {tc.label}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      className="text-[11px] font-medium px-3 py-1.5 rounded-lg border transition-colors"
                      style={{ color: '#888', borderColor: '#ddd' }}
                    >
                      View evidence
                    </button>
                    <Link
                      to={`/chat?model=${encodeURIComponent(modelName)}`}
                      className="text-[11px] font-medium px-3 py-1.5 rounded-lg border transition-colors"
                      style={{ color: C.blueBlack, borderColor: '#ddd' }}
                    >
                      Use
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="px-5 py-16 text-center text-sm" style={{ color: '#ccc' }}>
            No providers connected. Start serving inference on the exchange.
            <div className="mt-4 text-xs font-mono px-4 py-3 rounded-xl inline-block" style={{ background: '#f5f3f0', color: '#666' }}>
              python -m ocip_agent.agent --model your-model.gguf
            </div>
          </div>
        )}
      </div>

      {/* Trust explanation footer */}
      <div className="bg-white rounded-2xl border border-gray-200/40 px-5 py-4">
        <div className="text-sm font-semibold" style={{ color: C.blueBlack }}>
          Provider trust is evidence-based
        </div>
        <div className="text-xs mt-1" style={{ color: '#888' }}>
          See binary hash, trust level, recent success rate and observed throughput before routing.
        </div>
      </div>
    </div>
  )
}
