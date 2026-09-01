import { useState } from 'react'
import useSWR from 'swr'
import { api } from '../lib/api'

export function Models() {
  const [query, setQuery] = useState('')
  const { data: modelsData } = useSWR('models', api.models, { refreshInterval: 10000 })
  const { data: pricing } = useSWR('pricing', api.pricing, { refreshInterval: 10000 })
  const { data: searchResults } = useSWR(
    query.length >= 2 ? `search-${query}` : null,
    () => api.searchModels(query),
    { dedupingInterval: 500 }
  )

  const exchangeModels = modelsData?.data || []
  const pricingMap = new Map(
    (pricing?.pricing || []).map(p => [p.model, p])
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-1">Models</h1>
        <p className="text-sm text-gray-500">Browse models available on the exchange or search HuggingFace.</p>
      </div>

      {/* Search */}
      <div>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search models (e.g. llama, qwen, mistral)…"
          className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
        />
      </div>

      {/* HuggingFace search results */}
      {searchResults?.models && searchResults.models.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            HuggingFace Results for "{query}"
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {searchResults.models.map(m => (
              <div key={m.repo_id} className="bg-white rounded-lg border border-gray-200 p-4">
                <div className="font-semibold text-sm truncate">{m.repo_id}</div>
                <div className="text-xs text-gray-500 mt-1">
                  {m.downloads.toLocaleString()} downloads
                </div>
                <div className="mt-2">
                  {m.available_on_exchange ? (
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                      ✓ Available ({m.provider_count} provider{m.provider_count !== 1 ? 's' : ''})
                    </span>
                  ) : (
                    <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
                      Not yet available
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Exchange Models */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Available on Exchange ({exchangeModels.length})
        </h2>
        {exchangeModels.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {exchangeModels.map(m => {
              const p = pricingMap.get(m.id)
              return (
                <div key={m.id} className="bg-white rounded-lg border border-gray-200 p-4">
                  <div className="font-semibold truncate">{m.id}</div>
                  {p ? (
                    <>
                      <div className="text-2xl font-bold text-purple-600 mt-2">
                        ${p.output.toFixed(2)}
                        <span className="text-sm text-gray-500 font-normal">/Mtok out</span>
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        ${p.input.toFixed(2)}/Mtok in
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {p.providers_available} provider{p.providers_available !== 1 ? 's' : ''}
                        {' · '}cheapest: {p.cheapest_provider.slice(0, 12)}
                      </div>
                    </>
                  ) : (
                    <div className="text-sm text-gray-400 mt-2">Pricing unavailable</div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="text-gray-400 text-sm">No models available — connect a provider to list models.</div>
        )}
      </div>
    </div>
  )
}
