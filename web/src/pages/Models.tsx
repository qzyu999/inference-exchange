import { useState } from 'react'
import { Link } from 'react-router-dom'
import useSWR from 'swr'
import { api } from '../lib/api'

// ─── Brand palette ───────────────────────────────────────────
const C = {
  red: '#B7443B',
  gold: '#C49A45',
  green: '#3F8055',
  turquoise: '#4D9A91',
  deepBlue: '#315B72',
  blueBlack: '#292F35',
  orange: '#D77A2F',
  indigo: '#4A465F',
  white: '#D8D1BE',
}

const TRUST_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  open:         { bg: '#f3f3f3', text: '#999',     label: 'Open' },
  contained:    { bg: '#eef3f7', text: C.deepBlue, label: 'Contained' },
  hardened:     { bg: '#fdf6ec', text: C.gold,     label: 'Hardened+' },
  confidential: { bg: '#edf7f1', text: C.green,    label: 'Confidential' },
}

// ─── Types ───────────────────────────────────────────────────

interface MarketProvider {
  id: string; name: string; price_output: number; price_input: number; price_cache: number
  tps: number; trust: string; hardware: string; quantization: string
  load: number; encrypted: boolean; verified: boolean; slots: string
  context_length: number; format: string; original_model: string
}

interface MarketModel {
  model: string; family: string; size: string; variant: string; canonical_id: string
  capabilities: {
    context_length: number; supports_vision: boolean; supports_tool_calling: boolean
    architecture: string; model_type: string
  }
  providers: MarketProvider[]
  cheapest_output: number; fastest_tps: number; max_trust: string; provider_count: number
  reference_prices: Array<{
    provider: string; model: string
    price_input: number; price_cache: number; price_output: number
    diff_pct: number; cheaper: boolean; comparison_type?: string
  }>
}

type TypeFilter = 'all' | 'text' | 'vision'
type SortMode = 'providers' | 'price' | 'speed'

function formatCtx(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1024) return `${Math.round(n / 1024)}K`
  return `${n}`
}

function Pill({ children, bg, color }: { children: React.ReactNode; bg: string; color: string }) {
  return (
    <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded inline-flex items-center gap-0.5" style={{ background: bg, color }}>
      {children}
    </span>
  )
}

// ─── Model Card ──────────────────────────────────────────────

function ModelCard({ m, isSelected, onSelect }: { m: MarketModel; isSelected: boolean; onSelect: () => void }) {
  const caps = m.capabilities || {} as MarketModel['capabilities']
  const verifiedCount = m.providers.filter(p => p.verified).length
  const encryptedCount = m.providers.filter(p => p.encrypted).length
  const formats = [...new Set(m.providers.map(p => p.format).filter(Boolean))]
  const quants = [...new Set(m.providers.map(p => p.quantization).filter(Boolean))]
  const trustLevels = [...new Set(m.providers.map(p => p.trust))]
  const bestTrust = (['confidential', 'hardened', 'contained', 'open'] as const).find(t => trustLevels.includes(t)) || 'open'
  const tc = TRUST_COLORS[bestTrust]

  // Cheapest provider for three-tier pricing
  const cheapest = m.providers.length > 0
    ? m.providers.reduce((a, b) => a.price_output < b.price_output ? a : b)
    : null

  // Speed range
  const speeds = m.providers.map(p => p.tps).filter(t => t > 0)
  const speedMin = speeds.length ? Math.min(...speeds) : 0
  const speedMax = speeds.length ? Math.max(...speeds) : 0

  return (
    <div
      className="bg-white rounded-2xl border overflow-hidden cursor-pointer transition-all hover:shadow-md"
      style={{
        borderColor: isSelected ? C.gold : 'rgba(0,0,0,0.06)',
        borderWidth: isSelected ? '1.5px' : '1px',
      }}
      onClick={onSelect}
    >
      <div className="p-5">
        {/* Row 1: Name + family + trust badge */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-base truncate" style={{ color: C.blueBlack }}>{m.model}</h3>
              {m.family && (
                <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full shrink-0"
                  style={{ background: '#f0f4f8', color: C.deepBlue }}>{m.family}</span>
              )}
              {m.size && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full shrink-0" style={{ background: '#f5f3f0', color: '#8a7d60' }}>
                  {m.size}
                </span>
              )}
            </div>

            {/* Row 2: Capability badges */}
            <div className="flex items-center gap-1 mt-2 flex-wrap">
              {caps.context_length > 0 && <Pill bg="#f0f4f8" color="#4a6fa5">{formatCtx(caps.context_length)} ctx</Pill>}
              {caps.supports_tool_calling && <Pill bg="#eef7f0" color="#2d7d46">tools</Pill>}
              {caps.supports_vision && <Pill bg="#f3eef7" color="#6b46a5">vision</Pill>}
              {caps.architecture && <Pill bg="#f5f3f0" color="#8a7d60">{caps.architecture}</Pill>}
              {formats.map(f => <Pill key={f} bg="#f5f3f0" color="#8a7d60">{f.toUpperCase()}</Pill>)}
              {quants.map(q => <Pill key={q} bg="#fafafa" color="#999">{q}</Pill>)}
            </div>
          </div>

          {/* Trust badge */}
          <span className="text-[10px] font-semibold px-2.5 py-1 rounded-lg shrink-0" style={{ background: tc.bg, color: tc.text }}>
            {tc.label}
          </span>
        </div>

        {/* Row 3: Three-tier pricing */}
        {cheapest && (
          <div className="flex items-center gap-4 mt-3">
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] uppercase font-medium" style={{ color: C.deepBlue }}>in</span>
              <span className="text-sm font-bold" style={{ color: C.blueBlack }}>${cheapest.price_input.toFixed(2)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] uppercase font-medium" style={{ color: C.turquoise }}>cache</span>
              <span className="text-sm font-bold" style={{ color: cheapest.price_cache > 0 ? C.blueBlack : '#ddd' }}>
                {cheapest.price_cache > 0 ? `$${cheapest.price_cache.toFixed(2)}` : '—'}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] uppercase font-medium" style={{ color: C.gold }}>out</span>
              <span className="text-sm font-bold" style={{ color: C.blueBlack }}>${cheapest.price_output.toFixed(2)}</span>
            </div>
            <span className="text-[9px]" style={{ color: '#bbb' }}>$/Mtok</span>
          </div>
        )}

        {/* Row 4: Stats row */}
        <div className="flex items-center gap-3 mt-3 flex-wrap">
          <span className="text-xs" style={{ color: '#888' }}>
            <span className="font-semibold" style={{ color: C.blueBlack }}>{m.provider_count}</span> provider{m.provider_count !== 1 ? 's' : ''}
          </span>
          {speedMax > 0 && (
            <span className="text-xs" style={{ color: C.turquoise }}>
              {speedMin === speedMax ? `${speedMax.toFixed(0)}` : `${speedMin.toFixed(0)}–${speedMax.toFixed(0)}`} tok/s
            </span>
          )}
          {encryptedCount > 0 && (
            <span className="text-xs" style={{ color: C.deepBlue }}>{encryptedCount} E2E</span>
          )}
          {verifiedCount > 0 && (
            <span className="text-xs" style={{ color: C.green }}>{verifiedCount} verified</span>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Model Detail Panel ──────────────────────────────────────

function ModelDetail({ m }: { m: MarketModel }) {
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null)
  const caps = m.capabilities || {} as MarketModel['capabilities']
  const quants = [...new Set(m.providers.map(p => p.quantization).filter(Boolean))]
  const trustLevels = [...new Set(m.providers.map(p => p.trust))]

  // Reference pricing
  const sameModelRefs = (m.reference_prices || []).filter(r => r.comparison_type === 'same_model' || !r.comparison_type)

  return (
    <div className="bg-white rounded-2xl border border-gray-200/40 overflow-hidden">
      {/* Header */}
      <div className="p-5 border-b" style={{ borderColor: '#f0ede6' }}>
        <div className="text-[10px] uppercase tracking-wider font-medium mb-1" style={{ color: C.gold }}>
          Model Detail
        </div>
        <h2 className="text-lg font-bold" style={{ color: C.blueBlack }}>{m.model}</h2>
        <div className="flex items-center gap-4 mt-2 text-xs" style={{ color: '#888' }}>
          <span>{m.provider_count} provider{m.provider_count !== 1 ? 's' : ''}</span>
          <span>{quants.length} quantization{quants.length !== 1 ? 's' : ''}</span>
          <span>{trustLevels.length} trust level{trustLevels.length !== 1 ? 's' : ''}</span>
          {caps.context_length > 0 && <span>{formatCtx(caps.context_length)} context</span>}
        </div>

        {/* Capability row */}
        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
          {caps.supports_tool_calling && <Pill bg="#eef7f0" color="#2d7d46">tool calling</Pill>}
          {caps.supports_vision && <Pill bg="#f3eef7" color="#6b46a5">vision</Pill>}
          {caps.architecture && <Pill bg="#f5f3f0" color="#8a7d60">{caps.architecture}</Pill>}
          {caps.model_type && <Pill bg="#f5f3f0" color="#8a7d60">{caps.model_type}</Pill>}
        </div>
      </div>

      {/* Quantization breakdown */}
      {quants.length > 0 && (
        <div className="px-5 py-4 border-b" style={{ borderColor: '#f0ede6', background: '#fafaf8' }}>
          <div className="text-[10px] uppercase tracking-wider font-medium mb-3" style={{ color: '#aaa' }}>
            Quantization variants
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {quants.map(q => {
              const provs = m.providers.filter(p => p.quantization === q)
              const prices = provs.map(p => p.price_output).filter(p => p > 0)
              const minP = prices.length ? Math.min(...prices) : 0
              const maxP = prices.length ? Math.max(...prices) : 0
              const bestSpeed = Math.max(...provs.map(p => p.tps).filter(t => t > 0), 0)
              return (
                <div key={q} className="bg-white rounded-xl border border-gray-100 p-3">
                  <div className="font-mono text-sm font-bold" style={{ color: C.blueBlack }}>{q}</div>
                  <div className="text-xs mt-1" style={{ color: '#888' }}>
                    {provs.length} provider{provs.length !== 1 ? 's' : ''}
                  </div>
                  <div className="text-sm font-semibold mt-1.5" style={{ color: C.gold }}>
                    {minP === maxP ? `$${minP.toFixed(2)}` : `$${minP.toFixed(2)}–$${maxP.toFixed(2)}`}
                  </div>
                  {bestSpeed > 0 && (
                    <div className="text-xs mt-0.5" style={{ color: C.turquoise }}>
                      up to {bestSpeed.toFixed(0)} tok/s
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Provider table */}
      <div className="px-5 py-4">
        <div className="text-[10px] uppercase tracking-wider font-medium mb-3" style={{ color: '#aaa' }}>
          Providers serving this model
        </div>

        {/* Table header */}
        <div className="grid grid-cols-12 gap-2 text-[9px] uppercase tracking-wider pb-2 border-b border-gray-100" style={{ color: '#bbb' }}>
          <div className="col-span-2">Provider</div>
          <div className="col-span-1">Quant</div>
          <div className="col-span-1 text-right">In</div>
          <div className="col-span-1 text-right">Cache</div>
          <div className="col-span-1 text-right">Out</div>
          <div className="col-span-1 text-right">Speed</div>
          <div className="col-span-1 text-center">Load</div>
          <div className="col-span-1">Trust</div>
          <div className="col-span-2 text-right">Actions</div>
        </div>

        {m.providers.map(p => {
          const ptc = TRUST_COLORS[p.trust] || TRUST_COLORS.open
          const isExpanded = expandedProvider === p.id
          return (
            <div key={p.id}>
              <div
                className="grid grid-cols-12 gap-2 py-3 items-center border-b border-gray-50 cursor-pointer transition-colors hover:bg-gray-50/50"
                onClick={() => setExpandedProvider(isExpanded ? null : p.id)}
              >
                <div className="col-span-2 min-w-0">
                  <div className="text-xs font-semibold truncate" style={{ color: C.blueBlack }}>{p.name}</div>
                  <div className="flex items-center gap-1 mt-0.5">
                    {p.encrypted && <span className="text-[7px] px-1 rounded" style={{ background: '#eef3f7', color: C.deepBlue }}>E2E</span>}
                    {p.verified && <span className="text-[7px] px-1 rounded" style={{ background: '#edf7f1', color: C.green }}>✓</span>}
                  </div>
                </div>
                <div className="col-span-1 text-[10px] font-mono" style={{ color: C.gold }}>{p.quantization || '—'}</div>
                <div className="col-span-1 text-right text-xs" style={{ color: C.deepBlue }}>${p.price_input.toFixed(2)}</div>
                <div className="col-span-1 text-right text-xs" style={{ color: p.price_cache > 0 ? C.turquoise : '#ddd' }}>
                  {p.price_cache > 0 ? `$${p.price_cache.toFixed(2)}` : '—'}
                </div>
                <div className="col-span-1 text-right text-xs font-semibold" style={{ color: C.gold }}>${p.price_output.toFixed(2)}</div>
                <div className="col-span-1 text-right text-xs" style={{ color: C.turquoise }}>
                  {p.tps > 0 ? `${p.tps.toFixed(0)}` : '—'}
                </div>
                <div className="col-span-1 text-center">
                  <div className="w-full h-1.5 rounded-full overflow-hidden mx-auto" style={{ background: '#f0f0f0', maxWidth: '32px' }}>
                    <div className="h-full rounded-full" style={{
                      width: `${Math.max(5, p.load * 100)}%`,
                      background: p.load > 0.8 ? C.red : p.load > 0.5 ? C.orange : C.green,
                    }} />
                  </div>
                </div>
                <div className="col-span-1">
                  <span className="text-[8px] font-medium px-1.5 py-0.5 rounded-full" style={{ background: ptc.bg, color: ptc.text }}>
                    {ptc.label}
                  </span>
                </div>
                <div className="col-span-2 flex items-center justify-end gap-1.5">
                  <Link
                    to={`/exchange?model=${encodeURIComponent(m.model)}`}
                    className="text-[10px] font-medium px-2 py-1 rounded-lg border"
                    style={{ color: '#888', borderColor: '#ddd' }}
                    onClick={e => e.stopPropagation()}
                  >
                    Market
                  </Link>
                  <Link
                    to={`/chat?model=${encodeURIComponent(p.original_model || m.model)}`}
                    className="text-[10px] font-medium px-2 py-1 rounded-lg"
                    style={{ background: C.blueBlack, color: '#fff' }}
                    onClick={e => e.stopPropagation()}
                  >
                    Chat
                  </Link>
                </div>
              </div>

              {/* Expanded provider detail */}
              {isExpanded && (
                <div className="py-3 px-3 border-b border-gray-50" style={{ background: '#fafaf8' }}>
                  <div className="grid grid-cols-3 gap-4 text-xs">
                    <div>
                      <div className="text-[9px] uppercase tracking-wider mb-1.5" style={{ color: '#aaa' }}>Hardware</div>
                      <div style={{ color: C.blueBlack }}>{p.hardware || 'Unknown'}</div>
                      {p.context_length > 0 && <div className="mt-0.5" style={{ color: '#888' }}>{formatCtx(p.context_length)} ctx</div>}
                      {p.format && <div className="mt-0.5" style={{ color: '#888' }}>{p.format.toUpperCase()}</div>}
                      <div className="mt-0.5" style={{ color: '#888' }}>Slots: {p.slots || '—'}</div>
                    </div>
                    <div>
                      <div className="text-[9px] uppercase tracking-wider mb-1.5" style={{ color: '#aaa' }}>Security</div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: ptc.text }} />
                        <span>{ptc.label}</span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: p.encrypted ? C.deepBlue : '#ddd' }} />
                        <span>{p.encrypted ? 'E2E encrypted' : 'No E2E'}</span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: p.verified ? C.green : '#ddd' }} />
                        <span>{p.verified ? 'Hash verified' : 'Unverified'}</span>
                      </div>
                    </div>
                    <div>
                      <div className="text-[9px] uppercase tracking-wider mb-1.5" style={{ color: '#aaa' }}>Performance</div>
                      <div>
                        <span style={{ color: C.turquoise }}>{p.tps > 0 ? `${p.tps.toFixed(1)} tok/s` : '—'}</span>
                      </div>
                      <div className="mt-0.5">
                        Load: <span style={{ color: p.load > 0.8 ? C.red : p.load > 0.5 ? C.orange : C.green }}>
                          {(p.load * 100).toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Reference pricing comparison */}
      {sameModelRefs.length > 0 && (
        <div className="px-5 py-4 border-t" style={{ borderColor: '#f0ede6', background: '#fafaf8' }}>
          <div className="text-[10px] uppercase tracking-wider font-medium mb-3" style={{ color: '#aaa' }}>
            Same model — external market
          </div>
          <div className="space-y-1.5">
            {sameModelRefs.map((r, i) => (
              <div key={i} className="flex items-center gap-3 text-xs py-1.5 border-b border-gray-50 last:border-0">
                <span className="w-20 truncate font-medium" style={{ color: C.blueBlack }}>
                  {({ openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google', deepseek: 'DeepSeek', together: 'Together AI', openrouter: 'OpenRouter', groq: 'Groq', fireworks: 'Fireworks' } as Record<string, string>)[r.provider] || r.provider}
                </span>
                <span className="flex-1 truncate" style={{ color: '#888' }}>{r.model}</span>
                <span style={{ color: C.deepBlue }}>${r.price_input.toFixed(2)}</span>
                <span style={{ color: C.turquoise }}>{r.price_cache > 0 ? `$${r.price_cache.toFixed(2)}` : '—'}</span>
                <span className="font-semibold" style={{ color: C.gold }}>${r.price_output.toFixed(2)}</span>
                {r.cheaper && (
                  <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full" style={{ background: '#edf7f1', color: C.green }}>
                    {r.diff_pct}% more
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CTA */}
      <div className="px-5 py-4 border-t flex items-center justify-between" style={{ borderColor: '#f0ede6' }}>
        <div className="text-xs" style={{ color: '#888' }}>
          Route through the exchange for the best available offer.
        </div>
        <div className="flex gap-2">
          <Link
            to={`/exchange?model=${encodeURIComponent(m.model)}`}
            className="text-[11px] font-medium px-4 py-2 rounded-lg border"
            style={{ color: C.blueBlack, borderColor: '#ddd' }}
          >
            View in Exchange
          </Link>
          <Link
            to={`/chat?model=${encodeURIComponent(m.providers[0]?.original_model || m.model)}`}
            className="text-[11px] font-medium px-4 py-2 rounded-lg"
            style={{ background: C.blueBlack, color: '#fff' }}
          >
            Open in Chat
          </Link>
        </div>
      </div>
    </div>
  )
}

// ─── HF Search Card ──────────────────────────────────────────

function SearchCard({ m }: { m: { repo_id: string; downloads: number; available_on_exchange: boolean; provider_count: number } }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200/40 p-4 hover:shadow-sm transition-shadow">
      <div className="text-sm font-medium truncate" style={{ color: C.blueBlack }}>{m.repo_id}</div>
      <div className="text-xs mt-0.5" style={{ color: '#aaa' }}>{m.downloads.toLocaleString()} downloads</div>
      <div className="mt-2 flex items-center justify-between">
        {m.available_on_exchange ? (
          <span className="text-[9px] font-medium px-2 py-0.5 rounded-full" style={{ background: '#edf7f1', color: C.green }}>
            Live · {m.provider_count} provider{m.provider_count !== 1 ? 's' : ''}
          </span>
        ) : (
          <span className="text-[9px] px-2 py-0.5 rounded-full" style={{ background: '#f3f3f3', color: '#999' }}>
            Not on exchange
          </span>
        )}
        {m.available_on_exchange && (
          <Link to={`/chat?model=${encodeURIComponent(m.repo_id)}`}
            className="text-[10px] font-medium" style={{ color: C.gold }}>Chat →</Link>
        )}
      </div>
    </div>
  )
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
  const totalProviders = marketData?.total_providers || 0

  // Filter
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

  const detail = selectedModel ? allModels.find(m => m.canonical_id === selectedModel || m.model === selectedModel) : null

  // Fleet summary
  const totalVerified = allModels.reduce((s, m) => s + m.providers.filter(p => p.verified).length, 0)
  const totalEncrypted = allModels.reduce((s, m) => s + m.providers.filter(p => p.encrypted).length, 0)

  return (
    <div className="space-y-6">
      {/* Search + filter bar */}
      <div className="bg-white rounded-2xl border border-gray-200/40 px-5 py-3 flex items-center gap-4 flex-wrap">
        <div className="flex-1 min-w-[200px] relative">
          <span className="absolute left-0 top-1/2 -translate-y-1/2 text-gray-300 text-sm">⌕</span>
          <input
            type="text" value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search models"
            className="w-full pl-6 py-1.5 bg-transparent text-sm focus:outline-none placeholder:text-gray-300"
          />
        </div>

        <div className="flex gap-1">
          {([
            { value: 'all', label: 'All' },
            { value: 'text', label: 'Text' },
            { value: 'vision', label: 'Vision' },
          ] as { value: TypeFilter; label: string }[]).map(t => (
            <button key={t.value} onClick={() => setTypeFilter(t.value)}
              className="text-[11px] font-medium px-3 py-1.5 rounded-full transition-colors"
              style={{ background: typeFilter === t.value ? C.blueBlack : 'transparent', color: typeFilter === t.value ? '#fff' : '#888', border: `1px solid ${typeFilter === t.value ? C.blueBlack : '#e5e5e5'}` }}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 text-xs" style={{ color: '#888' }}>
          Sort:
          <select value={sortMode} onChange={e => setSortMode(e.target.value as SortMode)}
            className="text-xs bg-transparent focus:outline-none cursor-pointer font-medium" style={{ color: C.blueBlack }}>
            <option value="providers">providers</option>
            <option value="price">price</option>
            <option value="speed">speed</option>
          </select>
        </div>
      </div>

      {/* Fleet summary */}
      {allModels.length > 0 && (
        <div className="flex items-center gap-4 text-xs flex-wrap" style={{ color: '#888' }}>
          <span><span className="font-semibold" style={{ color: C.blueBlack }}>{allModels.length}</span> model{allModels.length !== 1 ? 's' : ''}</span>
          <span><span className="font-semibold" style={{ color: C.blueBlack }}>{totalProviders}</span> provider{totalProviders !== 1 ? 's' : ''}</span>
          {totalEncrypted > 0 && <span><span className="font-semibold" style={{ color: C.deepBlue }}>{totalEncrypted}</span> E2E</span>}
          {totalVerified > 0 && <span><span className="font-semibold" style={{ color: C.green }}>{totalVerified}</span> verified</span>}
        </div>
      )}

      {/* HF search results */}
      {searchResults?.models && searchResults.models.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider font-medium mb-2" style={{ color: '#aaa' }}>
            HuggingFace · "{query}"
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            {searchResults.models.slice(0, 8).map(m => <SearchCard key={m.repo_id} m={m} />)}
          </div>
        </div>
      )}

      {/* Model cards */}
      {sortedModels.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {sortedModels.map(m => (
            <ModelCard
              key={m.canonical_id || m.model}
              m={m}
              isSelected={selectedModel === (m.canonical_id || m.model)}
              onSelect={() => setSelectedModel(
                selectedModel === (m.canonical_id || m.model) ? null : (m.canonical_id || m.model)
              )}
            />
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200/40 p-16 text-center">
          <div className="text-sm" style={{ color: '#ccc' }}>No models available yet</div>
          <div className="text-xs font-mono mt-4 px-4 py-3 rounded-xl inline-block" style={{ background: '#f5f3f0', color: '#666' }}>
            python -m ocip_agent.agent --model your-model.gguf
          </div>
        </div>
      )}

      {/* Selected model detail */}
      {detail && <ModelDetail m={detail} />}
    </div>
  )
}
