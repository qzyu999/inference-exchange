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
  const pricingMap = new Map((pricing?.pricing || []).map(p => [p.model, p]))

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Models</h1>
        <p className="text-sm text-gray-400 mt-1">Browse available models or search HuggingFace</p>
      </div>

      <input
        type="text" value={query} onChange={e => setQuery(e.target.value)}
        placeholder="Search models (llama, qwen, mistral...)"
        className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400 placeholder:text-gray-300"
      />

      {searchResults?.models && searchResults.models.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-500 mb-3">HuggingFace results for "{query}"</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {searchResults.models.map(m => (
              <div key={m.repo_id} className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-5">
                <div className="font-semibold text-sm text-gray-900 truncate">{m.repo_id}</div>
                <div className="text-xs text-gray-400 mt-1">{m.downloads.toLocaleString()} downloads</div>
                <div className="mt-3">
                  {m.available_on_exchange ? (
                    <span className="text-xs font-medium bg-emerald-50 text-emerald-600 px-2.5 py-1 rounded-full">
                      Available ({m.provider_count} provider{m.provider_count !== 1 ? 's' : ''})
                    </span>
                  ) : (
                    <span className="text-xs font-medium bg-gray-100 text-gray-400 px-2.5 py-1 rounded-full">Not available yet</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="text-sm font-semibold text-gray-500 mb-3">On the exchange ({exchangeModels.length})</h2>
        {exchangeModels.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {exchangeModels.map(m => {
              const p = pricingMap.get(m.id)
              return (
                <div key={m.id} className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-5">
                  <div className="font-semibold text-gray-900 truncate">{m.id}</div>
                  {p ? (
                    <>
                      <div className="text-3xl font-bold text-gray-900 mt-3">
                        ${p.output.toFixed(2)}
                        <span className="text-sm font-normal text-gray-400">/Mtok</span>
                      </div>
                      <div className="text-xs text-gray-400 mt-1">${p.input.toFixed(2)}/Mtok input</div>
                      <div className="text-xs text-gray-400 mt-1">{p.providers_available} provider{p.providers_available !== 1 ? 's' : ''}</div>
                    </>
                  ) : (
                    <div className="text-sm text-gray-300 mt-3">Pricing unavailable</div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-200/60 p-12 text-center text-gray-300 text-sm">No models available. Connect a provider to list models.</div>
        )}
      </div>
    </div>
  )
}
