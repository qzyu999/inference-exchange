import useSWR from 'swr'
import { api, Provider, ReputationEntry, TPSEntry } from '../lib/api'

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: 'bg-green-100 text-green-700',
    degraded: 'bg-yellow-100 text-yellow-700',
    offline: 'bg-red-100 text-red-700',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${colors[status] || 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  )
}

function TrustBadge({ level }: { level: string }) {
  const colors: Record<string, string> = {
    L0: 'bg-gray-100 text-gray-600',
    L1: 'bg-blue-100 text-blue-700',
    L2: 'bg-purple-100 text-purple-700',
    L3: 'bg-green-100 text-green-700',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-mono ${colors[level] || 'bg-gray-100 text-gray-600'}`}>
      {level}
    </span>
  )
}

function ProviderCard({ provider, reputation, tps }: {
  provider: Provider
  reputation?: ReputationEntry
  tps?: TPSEntry
}) {
  const uptime_h = (provider.uptime_seconds / 3600).toFixed(1)

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="font-semibold">{provider.name || provider.id.slice(0, 16)}</div>
          <div className="text-xs text-gray-400 font-mono">{provider.id.slice(0, 12)}</div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={provider.status} />
          <TrustBadge level={provider.trust_level} />
          {provider.encrypted && <span title="E2E Encrypted">🔒</span>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-xs text-gray-500">Models</div>
          <div className="font-medium">{provider.models.join(', ') || '—'}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Hardware</div>
          <div className="font-medium">{provider.hardware || 'Unknown'}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Price (out)</div>
          <div className="font-medium text-purple-600">${provider.price_output.toFixed(2)}/Mtok</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">TPS</div>
          <div className="font-medium">
            {provider.measured_tps.toFixed(1)}
            {tps && tps.estimated_tps > 0 && (
              <span className="text-xs text-gray-400 ml-1">(est {tps.estimated_tps.toFixed(0)})</span>
            )}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Load</div>
          <div className="font-medium">{(provider.load * 100).toFixed(0)}% ({provider.active_requests}/{provider.max_concurrent})</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Uptime</div>
          <div className="font-medium">{uptime_h}h</div>
        </div>
      </div>

      {reputation && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <div className="flex items-center justify-between text-sm">
            <div>
              <span className="text-xs text-gray-500">Reputation:</span>{' '}
              <span className={`font-semibold ${reputation.is_degraded ? 'text-red-500' : 'text-green-600'}`}>
                {reputation.score.toFixed(2)}
              </span>
            </div>
            <div className="text-xs text-gray-500">
              {reputation.total_successes}/{reputation.total_requests} successful
              ({(reputation.success_rate_ema * 100).toFixed(0)}% EMA)
            </div>
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
  const degraded = providers.filter(p => p.status === 'degraded').length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold mb-1">Providers</h1>
          <p className="text-sm text-gray-500">Connected nodes serving inference on the exchange.</p>
        </div>
        <div className="flex gap-3 text-sm">
          <span className="text-green-600 font-semibold">{online} online</span>
          {degraded > 0 && <span className="text-yellow-600 font-semibold">{degraded} degraded</span>}
        </div>
      </div>

      {/* Setup CTA */}
      <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
        <div className="font-semibold text-purple-800 mb-1">Become a Provider</div>
        <div className="text-sm text-purple-700 mb-2">
          Earn money by serving AI inference on your hardware.
        </div>
        <code className="block text-xs bg-white border border-purple-200 rounded p-3 text-gray-800">
          pip install ie-provider{'\n'}
          ie-provider download-model llama-3.1-8b{'\n'}
          ie-provider start
        </code>
      </div>

      {/* Provider Cards */}
      {providers.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {providers.map(p => (
            <ProviderCard
              key={p.id}
              provider={p}
              reputation={repMap.get(p.id)}
              tps={tpsMap.get(p.id)}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-12 text-gray-400">
          <div className="text-4xl mb-3">📡</div>
          <div>No providers connected yet.</div>
          <div className="text-xs mt-1">Start a provider to see it here.</div>
        </div>
      )}
    </div>
  )
}
