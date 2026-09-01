import useSWR from 'swr'
import { api } from '../lib/api'

export function Landing() {
  const { data: stats } = useSWR('stats', api.stats, { refreshInterval: 5000 })
  const { data: pricing } = useSWR('pricing', api.pricing, { refreshInterval: 5000 })

  return (
    <div className="space-y-8">
      <div className="text-center py-12">
        <h1 className="text-4xl font-bold mb-4">
          Decentralized Private AI Inference
        </h1>
        <p className="text-lg text-gray-600 max-w-2xl mx-auto">
          An open marketplace where providers compete to serve your inference.
          OpenAI-compatible API. E2E encrypted. Configurable privacy.
        </p>
        <div className="flex gap-4 justify-center mt-6">
          <a href="/chat" className="px-6 py-2.5 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700">
            Start Using
          </a>
          <a href="/providers" className="px-6 py-2.5 bg-gray-100 text-gray-800 rounded-lg font-medium hover:bg-gray-200">
            Start Earning
          </a>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[
            { label: 'Providers Online', value: stats.providers_online, color: 'text-purple-600' },
            { label: 'Models Available', value: stats.models_available, color: 'text-blue-600' },
            { label: 'Total Requests', value: stats.total_requests.toLocaleString(), color: 'text-gray-900' },
            { label: 'Volume', value: `$${stats.total_volume_usd.toFixed(4)}`, color: 'text-green-600' },
            { label: 'Total Tokens', value: stats.total_tokens.toLocaleString(), color: 'text-gray-900' },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-lg border border-gray-200 p-4 text-center">
              <div className="text-xs text-gray-500 uppercase tracking-wide">{s.label}</div>
              <div className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {pricing?.pricing && pricing.pricing.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3">Market Pricing</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {pricing.pricing.map(p => (
              <div key={p.model} className="bg-white rounded-lg border border-gray-200 p-4">
                <div className="font-semibold">{p.model}</div>
                <div className="text-2xl font-bold text-purple-600 mt-1">${p.output.toFixed(2)}<span className="text-sm text-gray-500">/Mtok</span></div>
                <div className="text-xs text-gray-500 mt-1">
                  {p.providers_available} provider{p.providers_available !== 1 ? 's' : ''} · cheapest: {p.cheapest_provider}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
