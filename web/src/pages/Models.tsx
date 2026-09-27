import { useState } from 'react'
import { Link } from 'react-router-dom'
import useSWR from 'swr'
import { api } from '../lib/api'

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

// ─── Types ───────────────────────────────────────────────────

interface MarketModel {
  model: string
  family: string
  size: string
  canonical_id: string
  capabilities: {
    context_length: number
    supports_vision: boolean
    supports_tool_calling: boolean
    architecture: string
    model_type: string
  }
  providers: Array<{
    id: string; name: string; price_output: number; price_input: number
    tps: number; trust: string; quantization: string; hardware: string
    original_model: string
  }>
  cheapest_output: number
  fastest_tps: number
  max_trust: string
  provider_count: number
}

type TypeFilter = 'all' | 'text' | 'vision'
type SortMode = 'providers' | 'price' | 'speed'

function formatCtx(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1024) return `${Math.round(n / 1024)}K`
  return `${n}`
}

// ─── Page ────────────────────────────────────────────────────

export function Models() {
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [sortMode, setSortMode] = useState<SortMode>('providers')
  const [selectedModel, setSelectedModel] = useState<string | null>(null)
  const { data: marketData } = useSWR('market', api.market, { refreshInterval: 10000 })
  const { data: searchResults } = useSWR(
    query.length >= 2 ? `search-${query}` : null,
    () => api.searchModels(query),
    { dedupingInterval: 500 }
  )

  const allModels: MarketModel[] = marketData?.models || []

  // Filter by type
  const filteredModels = allModels.filter(m => {
    if (typeFilter === 'vision') return m.capabilities?.supports_vision
    if (typeFilter === 'text') return !m.capabilities?.supports_vision
    return true
  })

  // Sort
  const sortedModels = [...filteredModels].sort((a, b) => {
    if (sortMode === 'price') return a.cheapest_output - b.cheapest_output
    if (sortMode === 'speed') return b.fastest_tps - a.fastest_tps
    return b.provider_count - a.provider_count
  })

  // Selected model detail
  const detail = selectedModel ? allModels.find(m => m.canonical_id === selectedModel || m.model === selectedModel) : null

  return (
    <div className="space-y-6">
      {/* Search + filter bar */}
      <div className="bg-white rounded-2xl border border-gray-200/40 px-5 py-3 flex items-center gap-4 flex-wrap">
        <input
          type="text" value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Search models"
          className="flex-1 min-w-[200px] px-3 py-2 bg-transparent text-sm focus:outline-none placeholder:text-gray-300"
        />

        {/* Type filter pills */}
        <div className="flex gap-1">
          {([
            { value: 'all', label: 'All' },
            { value: 'text', label: 'Text' },
            { value: 'vision', label: 'Vision' },
          ] as { value: TypeFilter; label: string }[]).map(t => (
            <button
              key={t.value}
              onClick={() => setTypeFilter(t.value)}
              className="text-[11px] font-medium px-3 py-1.5 rounded-full transition-colors"
              style={{
                background: typeFilter === t.value ? C.blueBlack : 'transparent',
                color: typeFilter === t.value ? '#fff' : '#888',
                border: `1px solid ${typeFilter === t.value ? C.blueBlack : '#e5e5e5'}`,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Sort */}
        <div className="flex items-center gap-1 text-xs" style={{ color: '#888' }}>
          <span>Sort:</span>
          <select
            value={sortMode}
            onChange={e => setSortMode(e.target.value as SortMode)}
            className="text-xs bg-transparent focus:outline-none cursor-pointer font-medium"
            style={{ color: C.blueBlack }}
          >
            <option value="providers">providers</option>
            <option value="price">price</option>
            <option value="speed">speed</option>
          </select>
        </div>
      </div>

      {/* HuggingFace search results */}
      {searchResults?.models && searchResults.models.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider font-medium mb-3" style={{ color: '#aaa' }}>
            HuggingFace results for "{query}"
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {searchResults.models.slice(0, 6).map(m => (
              <div key={m.repo_id} className="bg-white rounded-2xl border border-gray-200/40 p-4">
                <div className="text-sm font-medium truncate" style={{ color: C.blueBlack }}>{m.repo_id}</div>
                <div className="text-xs mt-1" style={{ color: '#aaa' }}>{m.downloads.toLocaleString()} downloads</div>
                <div className="mt-2">
                  {m.available_on_exchange ? (
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: '#edf7f1', color: C.green }}>
                      Live · {m.provider_count} provider{m.provider_count !== 1 ? 's' : ''}
                    </span>
                  ) : (
                    <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: '#f3f3f3', color: '#999' }}>
                      Not on exchange
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Model card grid */}
      {sortedModels.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sortedModels.map(m => {
            const caps = m.capabilities || {}
            const bestTrust = (['confidential', 'hardened', 'contained', 'open'] as const)
              .find(t => m.providers.some(p => p.trust === t)) || 'open'
            const tc = TRUST_COLORS[bestTrust]
            const cheapest = m.providers.length > 0
              ? m.providers.reduce((a, b) => a.price_input < b.price_input ? a : b)
              : null

            return (
              <div
                key={m.canonical_id || m.model}
                className="bg-white rounded-2xl border border-gray-200/40 p-5 cursor-pointer transition-all hover:shadow-md"
                style={{
                  borderColor: selectedModel === (m.canonical_id || m.model) ? C.gold : undefined,
                  borderWidth: selectedModel === (m.canonical_id || m.model) ? '1.5px' : undefined,
                }}
                onClick={() => setSelectedModel(
                  selectedModel === (m.canonical_id || m.model) ? null : (m.canonical_id || m.model)
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-bold text-base" style={{ color: C.blueBlack }}>{m.model}</h3>
                    <div className="text-xs mt-0.5" style={{ color: '#999' }}>
                      {caps.architecture && <span>{caps.architecture} · </span>}
                      {caps.context_length > 0 && <span>{formatCtx(caps.context_length)} context · </span>}
                      {m.family && <span>{m.family}</span>}
                    </div>
                  </div>
                  <span
                    className="text-[10px] font-medium px-2.5 py-1 rounded-full shrink-0"
                    style={{ background: tc.bg, color: tc.text }}
                  >
                    {tc.label}
                  </span>
                </div>

                {/* Price + speed row */}
                <div className="flex items-center gap-6 mt-4">
                  <div>
                    <span className="text-base font-bold" style={{ color: C.blueBlack }}>
                      ${cheapest ? cheapest.price_input.toFixed(2) : m.cheapest_output.toFixed(2)}
                    </span>
                    <span className="text-xs ml-1" style={{ color: '#aaa' }}>in</span>
                  </div>
                  <div>
                    <span className="text-sm font-medium" style={{ color: C.turquoise }}>
                      {m.fastest_tps > 0 ? `${m.fastest_tps.toFixed(0)} tok/s` : '—'}
                    </span>
                  </div>
                  <div className="flex-1" />
                  <div className="text-xs" style={{ color: '#aaa' }}>
                    {m.provider_count} provider{m.provider_count !== 1 ? 's' : ''}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200/40 p-16 text-center">
          <div className="text-sm" style={{ color: '#ccc' }}>No models available yet</div>
          <div className="text-xs mt-2 font-mono px-4 py-3 rounded-xl inline-block mt-4" style={{ background: '#f5f3f0', color: '#666' }}>
            python -m ocip_agent.agent --model your-model.gguf
          </div>
        </div>
      )}

      {/* Model detail expansion */}
      {detail && (
        <div className="bg-white rounded-2xl border border-gray-200/40 p-6">
          <div className="text-[10px] uppercase tracking-wider font-medium mb-1" style={{ color: C.gold }}>
            Model Detail · {detail.model}
          </div>

          <div className="text-sm font-bold mt-2" style={{ color: C.blueBlack }}>
            {detail.provider_count} provider{detail.provider_count !== 1 ? 's' : ''}
            {' · '}
            {[...new Set(detail.providers.map(p => p.quantization).filter(Boolean))].length} quantization{[...new Set(detail.providers.map(p => p.quantization).filter(Boolean))].length !== 1 ? 's' : ''}
            {' · '}
            {[...new Set(detail.providers.map(p => p.trust))].length} trust level{[...new Set(detail.providers.map(p => p.trust))].length !== 1 ? 's' : ''}
          </div>

          {/* Quantization breakdown */}
          <div className="mt-4 space-y-2">
            {[...new Set(detail.providers.map(p => p.quantization).filter(Boolean))].map(q => {
              const provs = detail.providers.filter(p => p.quantization === q)
              const prices = provs.map(p => p.price_output).filter(p => p > 0)
              const minP = prices.length ? Math.min(...prices) : 0
              const maxP = prices.length ? Math.max(...prices) : 0
              return (
                <div key={q} className="flex items-center gap-4 py-1.5 border-b border-gray-50 last:border-0">
                  <span className="text-sm font-mono w-20" style={{ color: C.blueBlack }}>{q}</span>
                  <span className="text-xs" style={{ color: '#888' }}>
                    {provs.length} provider{provs.length !== 1 ? 's' : ''}
                  </span>
                  <span className="text-sm font-semibold" style={{ color: C.gold }}>
                    {minP === maxP ? `$${minP.toFixed(2)}` : `$${minP.toFixed(2)}–$${maxP.toFixed(2)}`}
                  </span>
                </div>
              )
            })}
          </div>

          {/* Open in Chat CTA */}
          <div className="mt-5 flex justify-end">
            <Link
              to={`/chat?model=${encodeURIComponent(detail.providers[0]?.original_model || detail.model)}`}
              className="px-5 py-2.5 rounded-xl text-sm font-medium transition-colors"
              style={{ background: C.blueBlack, color: '#fff' }}
            >
              Open in Chat
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
