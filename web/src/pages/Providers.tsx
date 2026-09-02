import useSWR from 'swr'
import { api, Provider, ReputationEntry, TPSEntry } from '../lib/api'

function TrustBadge({ level }: { level: string }) {
  const styles: Record<string, string> = {
    open: 'bg-gray-100 text-gray-500',
    contained: 'bg-blue-50 text-blue-600',
    hardened: 'bg-amber-50 text-amber-600',
    confidential: 'bg-emerald-50 text-emerald-600',
  }
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${styles[level] || styles.open}`}>{level}</span>
}

function ProviderCard({ provider, reputation, tps }: { provider: Provider; reputation?: ReputationEntry; tps?: TPSEntry }) {
  const uptime_h = (provider.uptime_seconds / 3600).toFixed(1)
  const loadPct = provider.load * 100

  return (
    <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="font-semibold text-gray-900">{provider.name || provider.id.slice(0, 16)}</div>
          <div className="text-xs text-gray-400 font-mono mt-0.5">{provider.id.slice(0, 12)}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${provider.status === 'active' ? 'bg-emerald-500' : provider.status === 'degraded' ? 'bg-amber-500' : 'bg-red-400'}`} />
          <TrustBadge level={provider.trust_level} />
          {provider.encrypted && <span className="text-xs text-emerald-500 font-medium">E2E</span>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
        <div><div className="text-xs text-gray-400">Model</div><div className="font-medium text-gray-900 truncate">{provider.models.join(', ') || '-'}</div></div>
        <div><div className="text-xs text-gray-400">Hardware</div><div className="font-medium text-gray-900">{provider.hardware || 'Unknown'}</div></div>
        <div><div className="text-xs text-gray-400">Price</div><div className="font-medium text-amber-600">${provider.price_output.toFixed(2)}/Mtok</div></div>
        <div>
          <div className="text-xs text-gray-400">TPS</div>
          <div className="font-medium text-gray-900">
            {provider.measured_tps.toFixed(1)}
            {tps && tps.estimated_tps > 0 && <span className="text-xs text-gray-400 ml-1">(est {tps.estimated_tps.toFixed(0)})</span>}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-400">Load</div>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${loadPct > 80 ? 'bg-red-400' : loadPct > 50 ? 'bg-amber-400' : 'bg-emerald-400'}`} style={{ width: `${Math.max(3, loadPct)}%` }} />
            </div>
            <span className="text-xs text-gray-500">{loadPct.toFixed(0)}%</span>
          </div>
        </div>
        <div><div className="text-xs text-gray-400">Uptime</div><div className="font-medium text-gray-900">{uptime_h}h</div></div>
      </div>

      {reputation && (
        <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between text-sm">
          <div>
            <span className="text-xs text-gray-400">Reputation </span>
            <span className={`font-semibold ${reputation.is_degraded ? 'text-red-500' : 'text-emerald-600'}`}>{reputation.score.toFixed(2)}</span>
          </div>
          <div className="text-xs text-gray-400">
            {reputation.total_successes}/{reputation.total_requests} ({(reputation.success_rate_ema * 100).toFixed(0)}%)
          </div>
        </div>
      )}
    </div>
  )
}

export function Providers() {
  const { data: provData } = useSWR('providers', api.providers, { refreshInterval: 5000 })
  const { data: repData } = useSWR('reputation', api.reputation, { refreshInterval: 10000 })
  const { data: tpsData } = useSWR('tps', api.tps, { refreshInterval: 10000 })

  const providers = provData?.providers || []
  const repMap = new Map((repData?.reputation || []).map(r => [r.provider_id, r]))
  const tpsMap = new Map((tpsData?.tps_stats || []).map(t => [t.provider_id, t]))
  const online = providers.filter(p => p.status === 'active').length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Providers</h1>
          <p className="text-sm text-gray-400 mt-1">Nodes serving inference on the exchange</p>
        </div>
        <span className="text-sm font-medium text-emerald-600">{online} online</span>
      </div>

      {/* Setup CTA */}
      <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-2xl border border-amber-200/60 p-6">
        <div className="font-semibold text-gray-900 mb-1">Become a provider</div>
        <p className="text-sm text-gray-500 mb-4">Earn by serving AI inference on your hardware. Apple Silicon, NVIDIA, or AMD.</p>
        <div className="bg-white rounded-xl border border-gray-200 p-4 font-mono text-xs text-gray-700 space-y-1">
          <div><span className="text-gray-400">$</span> pip install ie-provider</div>
          <div><span className="text-gray-400">$</span> ie-provider start</div>
        </div>
      </div>

      {providers.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {providers.map(p => (
            <ProviderCard key={p.id} provider={p} reputation={repMap.get(p.id)} tps={tpsMap.get(p.id)} />
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200/60 p-16 text-center">
          <div className="text-4xl mb-3">📡</div>
          <div className="text-gray-400">No providers connected yet</div>
          <div className="text-xs text-gray-300 mt-1">Start a provider to see it here</div>
        </div>
      )}
    </div>
  )
}
