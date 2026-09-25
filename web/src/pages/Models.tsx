import { useState } from 'react'
import { Link } from 'react-router-dom'
import useSWR from 'swr'
import { api } from '../lib/api'

// ─── Brand palette (shared with Exchange) ────────────────────
const C = {
  red: '#B7443B',
  orange: '#D77A2F',
  gold: '#C49A45',
  white: '#D8D1BE',
  maroon: '#702F32',
  black: '#292B2A',
  green: '#3F8055',
  turquoise: '#4D9A91',
  deepBlue: '#315B72',
  blueBlack: '#292F35',
  indigo: '#4A465F',
}

const TRUST_COLORS: Record<string, { bg: string; text: string; label: string; full: string }> = {
  open:         { bg: '#f3f3f3', text: '#999',     label: 'L0', full: 'Open' },
  contained:    { bg: '#eef3f7', text: C.deepBlue, label: 'L1', full: 'Contained' },
  hardened:     { bg: '#fdf6ec', text: C.gold,     label: 'L2', full: 'Hardened' },
  confidential: { bg: '#edf7f1', text: C.green,    label: 'L3', full: 'Confidential' },
}

// ─── Helpers ─────────────────────────────────────────────────

function formatCtx(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1024) return `${Math.round(n / 1024)}k`
  return `${n}`
}

function formatTps(n: number): string {
  if (n >= 100) return `${Math.round(n)}`
  if (n >= 10) return n.toFixed(0)
  return n.toFixed(1)
}

interface MarketModel {
  model: string
  family: string
  size: string
  variant: string
  canonical_id: string
  capabilities: {
    context_length: number
    supports_vision: boolean
    supports_tool_calling: boolean
    architecture: string
    model_type: string
  }
  providers: Array<{
    id: string; name: string; price_output: number; price_input: number; price_cache: number
    tps: number; trust: string; encrypted: boolean; load: number
    hardware: string; slots: string; quantization: string; format: string
    context_length: number; verified: boolean; original_model: string
  }>
  cheapest_output: number
  fastest_tps: number
  max_trust: string
  provider_count: number
}

// ─── Capability Pill ─────────────────────────────────────────

function Pill({ children, bg, color }: { children: React.ReactNode; bg: string; color: string }) {
  return (
    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1" style={{ background: bg, color }}>
      {children}
    </span>
  )
}

// ─── Model Card ──────────────────────────────────────────────

function ModelCard({ m }: { m: MarketModel }) {
  const [expanded, setExpanded] = useState(false)
  const caps = m.capabilities || {}
  const verifiedCount = m.providers.filter(p => p.verified).length
  const encryptedCount = m.providers.filter(p => p.encrypted).length
  const formats = [...new Set(m.providers.map(p => p.format).filter(Boolean))]
  const quants = [...new Set(m.providers.map(p => p.quantization).filter(Boolean))]
  const trustLevels = [...new Set(m.providers.map(p => p.trust))]
  const bestTrust = (['confidential', 'hardened', 'contained', 'open'] as const).find(t => trustLevels.includes(t)) || 'open'
  const tc = TRUST_COLORS[bestTrust]

  return (
    <div
      className="bg-white rounded-2xl border border-gray-200/60 shadow-sm hover:shadow-md transition-all cursor-pointer overflow-hidden"
      onClick={() => setExpanded(!expanded)}
    >
      {/* ── Header ── */}
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {/* Model name + family tag */}
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-base truncate" style={{ color: C.blueBlack }}>{m.model}</h3>
              {m.family && (
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0"
                  style={{ background: '#f0f4f8', color: C.deepBlue }}>
                  {m.family}
                </span>
              )}
            </div>

            {/* Capability badges row */}
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              {caps.context_length > 0 && (
                <Pill bg="#f0f4f8" color="#4a6fa5">⬚ {formatCtx(caps.context_length)}</Pill>
              )}
              {caps.supports_tool_calling && (
                <Pill bg="#eef7f0" color="#2d7d46">🔧 Tools</Pill>
              )}
              {caps.supports_vision && (
                <Pill bg="#f3eef7" color="#6b46a5">👁 Vision</Pill>
              )}
              {formats.map(f => (
                <Pill key={f} bg="#f5f3f0" color="#8a7d60">{f.toUpperCase()}</Pill>
              ))}
              {quants.map(q => (
                <Pill key={q} bg="#fafafa" color="#999">{q}</Pill>
              ))}
            </div>
          </div>

          {/* Price + trust badge */}
          <div className="text-right shrink-0">
            <div className="text-2xl font-bold" style={{ color: C.blueBlack }}>
              ${m.cheapest_output.toFixed(2)}
            </div>
            <div className="text-[10px]" style={{ color: '#aaa' }}>$/Mtok out</div>
            <span className="mt-1 inline-block text-[9px] font-bold px-2 py-0.5 rounded-full"
              style={{ background: tc.bg, color: tc.text }}>
              {tc.full}
            </span>
          </div>
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-4 mt-3 text-[11px]" style={{ color: '#888' }}>
          <span>
            <span className="font-semibold" style={{ color: C.blueBlack }}>{m.provider_count}</span> provider{m.provider_count !== 1 ? 's' : ''}
          </span>
          {m.fastest_tps > 0 && (
            <span>
              up to <span className="font-semibold" style={{ color: C.turquoise }}>{formatTps(m.fastest_tps)}</span> tok/s
            </span>
          )}
          {encryptedCount > 0 && (
            <span>
              <span className="font-semibold" style={{ color: C.deepBlue }}>{encryptedCount}</span> encrypted
            </span>
          )}
          {verifiedCount > 0 && (
            <span>
              <span className="font-semibold" style={{ color: C.green }}>{verifiedCount}</span> verified
            </span>
          )}
        </div>

        {/* Three-tier pricing */}
        {m.providers.length > 0 && (() => {
          const best = m.providers.reduce((a, b) => a.price_output < b.price_output ? a : b)
          return (
            <div className="flex items-center gap-4 mt-2 text-[11px]" style={{ color: '#aaa' }}>
              <span><span style={{ color: C.deepBlue }}>in</span> ${best.price_input.toFixed(2)}</span>
              <span><span style={{ color: C.turquoise }}>cache</span> {best.price_cache > 0 ? `$${best.price_cache.toFixed(2)}` : '—'}</span>
              <span><span style={{ color: C.gold }}>out</span> ${best.price_output.toFixed(2)}</span>
              <span>/ Mtok</span>
            </div>
          )
        })()}
      </div>

      {/* ── Expanded: Provider Table ── */}
      {expanded && (
        <div className="border-t border-gray-100 px-5 py-4" style={{ background: '#fafaf8' }}>
          <div className="text-[10px] uppercase tracking-wider mb-3" style={{ color: '#aaa' }}>
            Providers serving this model
          </div>
          <div className="space-y-2">
            {m.providers.map(p => {
              const ptc = TRUST_COLORS[p.trust] || TRUST_COLORS.open
              return (
                <div key={p.id} className="bg-white rounded-xl px-4 py-3 border border-gray-100 flex items-center gap-3">
                  {/* Provider name + encryption */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold" style={{ color: C.blueBlack }}>{p.name}</span>
                      {p.encrypted && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: '#eef3f7', color: C.deepBlue }}>🔐 E2E</span>
                      )}
                      {p.verified && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: '#edf7f1', color: C.green }}>✓ verified</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-[10px]" style={{ color: '#aaa' }}>
                      <span>{p.hardware}</span>
                      <span>{p.slots} slots</span>
                      {p.quantization && <span>{p.quantization}</span>}
                      {p.format && <span>{p.format.toUpperCase()}</span>}
                    </div>
                  </div>

                  {/* Speed */}
                  <div className="text-right">
                    {p.tps > 0 ? (
                      <div className="text-xs font-semibold" style={{ color: C.turquoise }}>{formatTps(p.tps)} t/s</div>
                    ) : (
                      <div className="text-[10px]" style={{ color: '#ccc' }}>—</div>
                    )}
                  </div>

                  {/* Price */}
                  <div className="text-right w-16">
                    <div className="text-xs font-bold" style={{ color: C.blueBlack }}>${p.price_output.toFixed(2)}</div>
                    <div className="text-[9px]" style={{ color: '#aaa' }}>$/Mtok</div>
                  </div>

                  {/* Trust */}
                  <span className="text-[9px] font-bold px-2 py-0.5 rounded-full shrink-0"
                    style={{ background: ptc.bg, color: ptc.text }}>
                    {ptc.label}
                  </span>
                </div>
              )
            })}
          </div>

          {/* Chat CTA */}
          <Link
            to={`/chat?model=${encodeURIComponent(m.providers[0]?.original_model || m.model)}`}
            className="mt-4 block text-center py-2.5 rounded-xl text-xs font-semibold transition-all hover:shadow-md"
            style={{ background: C.blueBlack, color: '#fff' }}
            onClick={e => e.stopPropagation()}
          >
            Chat with {m.model} →
          </Link>
        </div>
      )}
    </div>
  )
}

// ─── Empty State ─────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="bg-white rounded-2xl border border-gray-200/60 p-16 text-center">
      <div className="text-4xl mb-4">🔌</div>
      <div className="text-lg font-semibold" style={{ color: C.blueBlack }}>No models available</div>
      <div className="text-sm mt-2" style={{ color: '#aaa' }}>Connect a provider to start serving models on the exchange</div>
      <div className="mt-6 text-xs font-mono px-4 py-3 rounded-xl inline-block" style={{ background: '#f5f3f0', color: '#666' }}>
        python -m ocip_agent.agent --model your-model.gguf
      </div>
    </div>
  )
}

// ─── Search Result Card ──────────────────────────────────────

function SearchCard({ m }: { m: { repo_id: string; downloads: number; available_on_exchange: boolean; provider_count: number } }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-5 hover:shadow-md transition-shadow">
      <div className="font-semibold text-sm truncate" style={{ color: C.blueBlack }}>{m.repo_id}</div>
      <div className="text-xs mt-1" style={{ color: '#aaa' }}>{m.downloads.toLocaleString()} downloads</div>
      <div className="mt-3">
        {m.available_on_exchange ? (
          <div className="flex items-center justify-between">
            <Pill bg="#edf7f1" color={C.green}>
              Live · {m.provider_count} provider{m.provider_count !== 1 ? 's' : ''}
            </Pill>
            <Link to={`/chat?model=${encodeURIComponent(m.repo_id)}`}
              className="text-xs font-semibold hover:underline" style={{ color: C.gold }}>
              Chat →
            </Link>
          </div>
        ) : (
          <Pill bg="#f3f3f3" color="#999">Not available yet</Pill>
        )}
      </div>
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────

export function Models() {
  const [query, setQuery] = useState('')
  const { data: marketData } = useSWR('market', api.market, { refreshInterval: 10000 })
  const { data: searchResults } = useSWR(
    query.length >= 2 ? `search-${query}` : null,
    () => api.searchModels(query),
    { dedupingInterval: 500 }
  )

  const models: MarketModel[] = marketData?.models || []
  const totalProviders = marketData?.total_providers || 0

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold" style={{ color: C.blueBlack }}>Models</h1>
        <p className="text-sm mt-1" style={{ color: '#aaa' }}>
          {models.length > 0
            ? `${models.length} model${models.length !== 1 ? 's' : ''} across ${totalProviders} provider${totalProviders !== 1 ? 's' : ''}`
            : 'Browse available models or search HuggingFace'
          }
        </p>
      </div>

      {/* Search */}
      <div className="relative">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300">⌕</span>
        <input
          type="text" value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Search HuggingFace (llama, qwen, mistral, deepseek...)"
          className="w-full pl-10 pr-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:border-transparent placeholder:text-gray-300 transition-shadow"
          style={{ '--tw-ring-color': `${C.gold}40` } as React.CSSProperties}
        />
      </div>

      {/* HF Search Results */}
      {searchResults?.models && searchResults.models.length > 0 && (
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: '#aaa' }}>
            HuggingFace results for "{query}"
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {searchResults.models.map(m => <SearchCard key={m.repo_id} m={m} />)}
          </div>
        </div>
      )}

      {/* Exchange Models */}
      <div>
        {models.length > 0 ? (
          <div className="space-y-3">
            {models.map(m => <ModelCard key={m.canonical_id} m={m} />)}
          </div>
        ) : (
          <EmptyState />
        )}
      </div>
    </div>
  )
}
