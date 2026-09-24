import useSWR from 'swr'
import { api } from '../lib/api'
import { useEffect, useRef, useState } from 'react'

// ─── Brand palette ───────────────────────────────────────────
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

const TRUST_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  open: { bg: '#f3f3f3', text: '#999', label: 'L0' },
  contained: { bg: '#eef3f7', text: C.deepBlue, label: 'L1' },
  hardened: { bg: '#fdf6ec', text: C.gold, label: 'L2' },
  confidential: { bg: '#edf7f1', text: C.green, label: 'L3' },
}

// ─── Types ───────────────────────────────────────────────────
interface MarketModel {
  model: string
  family: string
  size: string
  variant: string
  canonical_id: string
  providers: Array<{
    id: string; name: string; price_output: number; price_input: number; price_cache: number
    tps: number; trust: string; encrypted: boolean; load: number
    hardware: string; slots: string; quantization: string; original_model: string
    context_length: number; verified: boolean
  }>
  cheapest_output: number
  fastest_tps: number
  max_trust: string
  provider_count: number
  reference_prices: Array<{
    provider: string; model: string
    price_input: number; price_cache: number; price_output: number
    diff_pct: number; diff_input_pct: number; diff_cache_pct: number
    cheaper: boolean; comparison_type?: string
  }>
}

type SortCol = 'provider' | 'input' | 'cache' | 'output'
type SortDir = 'asc' | 'desc'

// ─── Helpers ─────────────────────────────────────────────────

function formatVolume(usd: number): string {
  if (usd >= 1) return `$${usd.toFixed(2)}`
  if (usd >= 0.01) return `$${usd.toFixed(4)}`
  if (usd > 0) return `$${usd.toFixed(6)}`
  return '$0'
}

function LiveDot() {
  return (
    <span className="relative flex h-2 w-2">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: C.green }} />
      <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: C.green }} />
    </span>
  )
}

// ─── Model Card ──────────────────────────────────────────────

function ModelMarketCard({ m }: { m: MarketModel }) {
  const [expanded, setExpanded] = useState(false)
  const [sortCol, setSortCol] = useState<SortCol>('output')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  // Compute ranges
  const prices = m.providers.map(p => p.price_output).filter(p => p > 0)
  const priceMin = prices.length ? Math.min(...prices) : 0
  const priceMax = prices.length ? Math.max(...prices) : 0
  const tpsValues = m.providers.map(p => p.tps).filter(t => t > 0)
  const tpsMin = tpsValues.length ? Math.min(...tpsValues) : 0
  const tpsMax = tpsValues.length ? Math.max(...tpsValues) : 0

  // Trust levels available
  const trustLevels = [...new Set(m.providers.map(p => p.trust))]
  const verifiedCount = m.providers.filter(p => p.verified).length

  // Reference pricing: separate same-model from alternative
  const sameModelRefs = m.reference_prices.filter(r => r.comparison_type === 'same_model' || !r.comparison_type)
  const altRefs = m.reference_prices.filter(r => r.comparison_type === 'alternative')

  // Only show "cheaper" badge if we're cheaper than the cheapest same-model alternative
  const cheapestSameModel = sameModelRefs.length > 0
    ? Math.min(...sameModelRefs.map(r => r.price_output))
    : null
  const isCheaperThanSameModel = cheapestSameModel !== null && priceMin < cheapestSameModel
  const bestSaving = isCheaperThanSameModel
    ? sameModelRefs.filter(r => r.cheaper).sort((a, b) => b.diff_pct - a.diff_pct)[0]
    : null

  return (
    <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-semibold" style={{ color: C.blueBlack }}>{m.model}</div>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {m.family && <span className="text-xs" style={{ color: '#888' }}>{m.family}</span>}
              {m.size && <span className="text-xs" style={{ color: '#888' }}>{m.size}</span>}
              <span className="text-xs" style={{ color: '#aaa' }}>{m.provider_count} provider{m.provider_count !== 1 ? 's' : ''}</span>
              {verifiedCount > 0 && (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full" style={{ background: '#eef3f7', color: C.deepBlue }}>
                  {verifiedCount}/{m.provider_count} verified
                </span>
              )}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-2xl font-bold" style={{ color: C.blueBlack }}>${priceMin.toFixed(2)}</div>
            {priceMax > priceMin && (
              <div className="text-[10px]" style={{ color: '#aaa' }}>→ ${priceMax.toFixed(2)}</div>
            )}
            <div className="text-[10px]" style={{ color: '#aaa' }}>$/Mtok out</div>
          </div>
        </div>

        {/* Three-tier pricing summary */}
        {m.providers.length > 0 && (() => {
          const cheapest = m.providers.reduce((a, b) => a.price_output < b.price_output ? a : b)
          return (
            <div className="flex items-center gap-3 mt-2 text-[11px]" style={{ color: '#888' }}>
              <span><span style={{ color: C.deepBlue }}>in</span> ${cheapest.price_input.toFixed(2)}</span>
              <span><span style={{ color: C.turquoise }}>cache</span> {cheapest.price_cache > 0 ? `$${cheapest.price_cache.toFixed(2)}` : '—'}</span>
              <span><span style={{ color: C.gold }}>out</span> ${cheapest.price_output.toFixed(2)}</span>
              <span style={{ color: '#bbb' }}>/ Mtok</span>
            </div>
          )
        })()}

        {/* Quick stats row */}
        <div className="flex items-center gap-3 mt-3 flex-wrap">
          {/* Speed range */}
          {tpsMax > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px]" style={{ color: '#aaa' }}>Speed</span>
              <span className="text-xs font-medium" style={{ color: C.turquoise }}>
                {tpsMin.toFixed(0)}{tpsMax > tpsMin ? `–${tpsMax.toFixed(0)}` : ''} tok/s
              </span>
            </div>
          )}

          {/* Trust badges */}
          <div className="flex items-center gap-1">
            {(['open', 'contained', 'hardened', 'confidential'] as const).map(level => {
              const available = trustLevels.includes(level)
              const tc = TRUST_COLORS[level]
              return (
                <span
                  key={level}
                  className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                  style={{
                    background: available ? tc.bg : 'transparent',
                    color: available ? tc.text : '#ddd',
                    border: available ? 'none' : '1px solid #eee',
                  }}
                >
                  {tc.label}
                </span>
              )
            })}
          </div>

          {/* Best saving badge */}
          {bestSaving && (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: '#edf7f1', color: C.green }}>
              {bestSaving.diff_pct}% cheaper than {bestSaving.provider}
            </span>
          )}
        </div>
      </div>

      {/* Reference pricing */}
      {m.reference_prices.length > 0 && (() => {
        const toggleSort = (col: SortCol) => {
          if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
          else { setSortCol(col); setSortDir('asc') }
        }
        const arrow = (col: SortCol) => sortCol === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''

        // Build unified list: exchange offering + all references
        const cheapest = m.providers.length > 0 ? m.providers.reduce((a, b) => a.price_output < b.price_output ? a : b) : null

        type Offering = {
          provider: string; model: string
          input: number; cache: number; output: number
          isExchange: boolean; isOpen: boolean
        }

        const offerings: Offering[] = []
        if (cheapest) {
          offerings.push({
            provider: 'Exchange', model: m.model,
            input: cheapest.price_input, cache: cheapest.price_cache, output: cheapest.price_output,
            isExchange: true, isOpen: true,
          })
        }
        for (const ref of m.reference_prices) {
          offerings.push({
            provider: ref.provider, model: ref.model,
            input: ref.price_input, cache: ref.price_cache, output: ref.price_output,
            isExchange: false, isOpen: ref.comparison_type === 'same_model',
          })
        }

        offerings.sort((a, b) => {
          const valA = sortCol === 'provider' ? a.provider : sortCol === 'input' ? a.input : sortCol === 'cache' ? a.cache : a.output
          const valB = sortCol === 'provider' ? b.provider : sortCol === 'input' ? b.input : sortCol === 'cache' ? b.cache : b.output
          if (typeof valA === 'string' && typeof valB === 'string') return sortDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA)
          return sortDir === 'asc' ? (valA as number) - (valB as number) : (valB as number) - (valA as number)
        })

        // Find cheapest in each column for highlighting
        const allInputs = offerings.map(o => o.input).filter(v => v > 0)
        const allCaches = offerings.map(o => o.cache).filter(v => v > 0)
        const allOutputs = offerings.map(o => o.output).filter(v => v > 0)
        const minInput = allInputs.length ? Math.min(...allInputs) : 0
        const minCache = allCaches.length ? Math.min(...allCaches) : 0
        const minOutput = allOutputs.length ? Math.min(...allOutputs) : 0

        return (
          <div className="px-5 py-4 border-t border-gray-100" style={{ background: '#fafaf8' }}>
            {/* Section header with sort controls */}
            <div className="flex items-center justify-between mb-3">
              <div className="text-[10px] uppercase tracking-wider" style={{ color: '#aaa' }}>Market comparison</div>
              <div className="flex items-center gap-1">
                {(['output', 'input', 'cache'] as SortCol[]).map(col => (
                  <button
                    key={col}
                    onClick={() => toggleSort(col)}
                    className="text-[9px] uppercase tracking-wider px-2 py-0.5 rounded-full transition-colors"
                    style={{
                      background: sortCol === col ? C.blueBlack : 'transparent',
                      color: sortCol === col ? '#fff' : '#aaa',
                    }}
                  >
                    {col}{arrow(col)}
                  </button>
                ))}
              </div>
            </div>

            {/* Offering cards */}
            <div className="space-y-1.5 max-h-[320px] overflow-y-auto">
              {offerings.map((o, i) => {
                const isMin = (val: number, min: number) => val > 0 && val === min
                return (
                  <div
                    key={i}
                    className="rounded-xl px-3 py-2.5 transition-colors"
                    style={{
                      background: o.isExchange ? '#edeae2' : '#fff',
                      border: o.isExchange ? `1.5px solid ${C.gold}44` : '1px solid #eee',
                    }}
                  >
                    {/* Top line: provider + model + type */}
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-xs font-semibold" style={{ color: o.isExchange ? C.gold : C.blueBlack }}>
                        {o.provider}
                      </span>
                      <span className="text-[11px] flex-1 min-w-0" style={{ color: o.isExchange ? '#8a7d60' : '#888' }}>
                        {o.model}
                      </span>
                      <span
                        className="text-[8px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
                        style={{
                          background: o.isOpen ? '#edf7f1' : '#f3f0f5',
                          color: o.isOpen ? C.green : C.indigo,
                        }}
                      >
                        {o.isOpen ? 'open' : 'proprietary'}
                      </span>
                    </div>

                    {/* Price pills */}
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1 px-2 py-1 rounded-lg" style={{ background: o.isExchange ? '#e0dbd0' : '#f5f5f3' }}>
                        <span className="text-[9px] uppercase" style={{ color: C.deepBlue }}>in</span>
                        <span className="text-xs font-mono font-medium" style={{ color: isMin(o.input, minInput) ? C.green : C.blueBlack }}>
                          {o.input > 0 ? `$${o.input.toFixed(2)}` : '—'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 px-2 py-1 rounded-lg" style={{ background: o.isExchange ? '#e0dbd0' : '#f5f5f3' }}>
                        <span className="text-[9px] uppercase" style={{ color: C.turquoise }}>cache</span>
                        <span className="text-xs font-mono font-medium" style={{ color: isMin(o.cache, minCache) ? C.green : o.cache > 0 ? C.blueBlack : '#ccc' }}>
                          {o.cache > 0 ? `$${o.cache < 0.1 ? o.cache.toFixed(3) : o.cache.toFixed(2)}` : '—'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 px-2 py-1 rounded-lg" style={{ background: o.isExchange ? '#e0dbd0' : '#f5f5f3' }}>
                        <span className="text-[9px] uppercase" style={{ color: C.gold }}>out</span>
                        <span className="text-xs font-mono font-medium" style={{ color: isMin(o.output, minOutput) ? C.green : C.blueBlack }}>
                          {o.output > 0 ? `$${o.output.toFixed(2)}` : '—'}
                        </span>
                      </div>
                      <span className="text-[9px] ml-auto" style={{ color: '#bbb' }}>$/Mtok</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}

      {/* Provider rows (collapsible) */}
      <div className="px-5 py-3 border-t border-gray-100">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center justify-between w-full text-left"
        >
          <span className="text-[10px] uppercase tracking-wider" style={{ color: '#aaa' }}>
            {m.provider_count} provider{m.provider_count !== 1 ? 's' : ''} on exchange
          </span>
          <svg className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="#aaa" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {expanded && (
          <div className="mt-2 space-y-0">
            {m.providers.map(p => {
              const tc = TRUST_COLORS[p.trust] || TRUST_COLORS.open
              return (
                <div key={p.id} className="flex items-center gap-2 py-2 border-b border-gray-50 last:border-0 text-sm">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: p.load < 0.8 ? C.green : C.orange }} />
                  <div className="truncate w-20">
                    <span style={{ color: C.blueBlack }}>{p.name}</span>
                    {p.verified && <span className="ml-1 text-[9px]" style={{ color: C.deepBlue }} title="Hash verified">✓</span>}
                  </div>
                  <span className="font-semibold w-14 text-right" style={{ color: C.blueBlack }}>${p.price_output.toFixed(2)}</span>
                  <span className="text-[10px] w-10 text-right" style={{ color: '#aaa' }}>in ${p.price_input.toFixed(2)}</span>
                  {p.price_cache > 0 && (
                    <span className="text-[10px]" style={{ color: C.turquoise }}>⚡${p.price_cache.toFixed(2)}</span>
                  )}
                  <span className="text-xs w-12 text-right" style={{ color: '#888' }}>{p.tps.toFixed(0)} t/s</span>
                  {p.quantization && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: '#fdf6ec', color: C.gold, border: '1px solid rgba(196,154,69,0.2)' }}>
                      {p.quantization}
                    </span>
                  )}
                  {p.context_length > 0 && (
                    <span className="text-[10px]" style={{ color: '#aaa' }}>{(p.context_length / 1024).toFixed(0)}k</span>
                  )}
                  <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full" style={{ background: tc.bg, color: tc.text }}>
                    {tc.label}
                  </span>
                  {p.encrypted && <span className="text-[10px]" style={{ color: C.turquoise }}>E2E</span>}
                  <span className="text-xs ml-auto" style={{ color: '#bbb' }}>{p.slots}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* CTA */}
      <div className="px-5 py-3 border-t border-gray-100">
        <a
          href={`/chat?model=${encodeURIComponent(m.providers[0]?.original_model || m.model)}`}
          className="block text-center py-2.5 rounded-xl text-xs font-medium transition-colors"
          style={{ background: C.blueBlack, color: C.white }}
        >
          Chat with {m.model}
        </a>
      </div>
    </div>
  )
}

// ─── Trade Row ───────────────────────────────────────────────

function TradeRow({ t }: { t: any }) {
  const time = new Date(t.timestamp * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const ok = ['completed', 'matched', 'matched_from_queue'].includes(t.status)
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0">
      <span className="text-[11px] font-mono w-14" style={{ color: '#bbb' }}>{time}</span>
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: ok ? C.green : C.red }} />
      <span className="text-sm truncate flex-1" style={{ color: C.blueBlack }}>{t.model === 'default' ? 'Any model' : t.model}</span>
      {t.selected_price != null && <span className="text-sm font-semibold" style={{ color: C.blueBlack }}>${t.selected_price.toFixed(2)}</span>}
      {t.selected_trust && (
        <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full"
          style={{ background: TRUST_COLORS[t.selected_trust]?.bg || '#f3f3f3', color: TRUST_COLORS[t.selected_trust]?.text || '#999' }}>
          {TRUST_COLORS[t.selected_trust]?.label || t.selected_trust}
        </span>
      )}
    </div>
  )
}

// ─── Live Feed ───────────────────────────────────────────────

function LiveFeed() {
  const [events, setEvents] = useState<Array<any>>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const { data: recent } = useSWR('recentEvents', api.recentEvents)
  useEffect(() => { if (recent?.events) setEvents(recent.events.slice(-40)) }, [recent])
  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${window.location.host}/ws/events`)
    ws.onmessage = (e) => { try { setEvents(prev => [...prev.slice(-79), JSON.parse(e.data)]) } catch {} }
    return () => ws.close()
  }, [])
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }) }, [events])

  const typeColors: Record<string, string> = {
    match: C.green, billing: C.gold, provider_connect: C.deepBlue,
    provider_disconnect: C.red, attestation: C.indigo,
  }

  return (
    <div ref={scrollRef} className="h-44 overflow-y-auto text-[11px] space-y-0.5 font-mono">
      {events.length === 0 && <div className="py-8 text-center text-xs font-sans" style={{ color: '#ccc' }}>Waiting for activity...</div>}
      {events.map((ev, i) => (
        <div key={i} className="flex gap-2 py-0.5" style={{ color: '#888' }}>
          <span className="shrink-0" style={{ color: '#ccc' }}>{new Date(ev.timestamp * 1000).toLocaleTimeString()}</span>
          <span style={{ color: typeColors[ev.type] || '#aaa' }}>{ev.type}</span>
          {ev.provider && <span className="truncate">{ev.provider}</span>}
          {ev.cost_usd != null && <span style={{ color: C.gold }}>{formatVolume(ev.cost_usd)}</span>}
        </div>
      ))}
    </div>
  )
}

// ─── Empty State ─────────────────────────────────────────────

function EmptyExchange() {
  return (
    <div className="max-w-2xl mx-auto text-center py-16">
      <img src="/logo.svg" alt="IE" className="w-20 h-20 mx-auto mb-6 opacity-30" />
      <h2 className="text-2xl font-bold mb-3" style={{ color: C.blueBlack }}>The exchange is quiet</h2>
      <p className="mb-8 max-w-md mx-auto leading-relaxed" style={{ color: '#888' }}>
        No providers are connected yet. When providers come online, you'll see live pricing,
        capacity depth, and trade activity here.
      </p>
      <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-6 text-left max-w-md mx-auto">
        <div className="text-sm font-semibold mb-3" style={{ color: C.blueBlack }}>Become the first provider</div>
        <div className="rounded-xl p-4 font-mono text-xs space-y-1" style={{ background: C.blueBlack, color: C.white }}>
          <div><span style={{ color: '#666' }}>$</span> pip install ie-provider</div>
          <div><span style={{ color: '#666' }}>$</span> ie-provider start</div>
        </div>
        <p className="text-xs mt-3" style={{ color: '#aaa' }}>Earn credits by serving inference on your hardware.</p>
      </div>
    </div>
  )
}

// ─── Main ────────────────────────────────────────────────────

export function Exchange() {
  const { data: stats } = useSWR('stats', api.stats, { refreshInterval: 3000 })
  const { data: provData } = useSWR('providers', api.providers, { refreshInterval: 3000 })
  const { data: traceData } = useSWR('traces', api.traces, { refreshInterval: 3000 })
  const { data: marketData } = useSWR('market', api.market, { refreshInterval: 5000 })
  const { data: reputationData } = useSWR('reputation', api.reputation, { refreshInterval: 10000 })

  const providers = provData?.providers || []
  const traces = traceData?.traces || []
  const recentTrades = [...traces].reverse().slice(0, 15)
  const models = (marketData?.models || []) as MarketModel[]

  // Compute fleet-level stats
  const totalSlots = providers.reduce((sum, p) => sum + p.max_concurrent, 0)
  const usedSlots = providers.reduce((sum, p) => sum + p.active_requests, 0)
  const utilization = totalSlots > 0 ? (usedSlots / totalSlots) * 100 : 0
  const encryptedCount = providers.filter(p => p.encrypted).length

  if (provData && providers.length === 0 && models.length === 0) {
    return (
      <div>
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: C.blueBlack }}>Exchange</h1>
            <p className="text-sm mt-0.5" style={{ color: '#888' }}>Live inference marketplace</p>
          </div>
          <div className="flex items-center gap-2"><LiveDot /><span className="text-xs" style={{ color: '#aaa' }}>Real-time</span></div>
        </div>
        <EmptyExchange />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: C.blueBlack }}>Exchange</h1>
          <p className="text-sm mt-0.5" style={{ color: '#888' }}>Live inference marketplace</p>
        </div>
        <div className="flex items-center gap-2"><LiveDot /><span className="text-xs" style={{ color: '#aaa' }}>Real-time</span></div>
      </div>

      {/* Stats overview */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: 'Providers', value: stats.providers_online, color: C.deepBlue },
            { label: 'Models', value: models.length || stats.models_available, color: C.indigo },
            { label: 'Utilization', value: `${utilization.toFixed(0)}%`, sub: `${usedSlots}/${totalSlots} slots`, color: C.turquoise },
            { label: 'Fills', value: stats.total_requests.toLocaleString(), color: C.blueBlack },
            { label: 'Volume', value: formatVolume(stats.total_volume_usd), color: C.gold },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-2xl border border-gray-200/60 shadow-sm px-4 py-3">
              <div className="text-xl font-bold tracking-tight" style={{ color: s.color }}>{s.value}</div>
              {'sub' in s && s.sub && <div className="text-[10px]" style={{ color: '#bbb' }}>{s.sub}</div>}
              <div className="text-[10px] uppercase tracking-wider mt-0.5" style={{ color: '#aaa' }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Fleet trust + encryption summary */}
      {providers.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs" style={{ color: '#888' }}>
            <span>Fleet trust:</span>
            {(['open', 'contained', 'hardened', 'confidential'] as const).map(level => {
              const count = providers.filter(p => p.trust_level === level).length
              const tc = TRUST_COLORS[level]
              return count > 0 ? (
                <span key={level} className="font-medium px-1.5 py-0.5 rounded text-[10px]" style={{ background: tc.bg, color: tc.text }}>
                  {tc.label} ×{count}
                </span>
              ) : null
            })}
          </div>
          {encryptedCount > 0 && (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: '#edf7f6', color: C.turquoise }}>
              {encryptedCount}/{providers.length} E2E encrypted
            </span>
          )}
        </div>
      )}

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Models market view */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold" style={{ color: C.blueBlack }}>Market by Model</h2>
            <span className="text-xs" style={{ color: '#aaa' }}>{models.length} model{models.length !== 1 ? 's' : ''}</span>
          </div>
          {models.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {models.map(m => <ModelMarketCard key={m.canonical_id || m.model} m={m} />)}
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-200/60 p-12 text-center text-sm" style={{ color: '#ccc' }}>
              No models available yet
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-5">
          {/* Recent fills */}
          <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold" style={{ color: C.blueBlack }}>Recent Fills</h2>
              <span className="text-[10px]" style={{ color: '#aaa' }}>{recentTrades.length} recent</span>
            </div>
            <div className="max-h-72 overflow-y-auto">
              {recentTrades.length > 0 ? (
                recentTrades.map(t => <TradeRow key={t.request_id} t={t} />)
              ) : (
                <div className="text-center py-8 text-sm" style={{ color: '#ccc' }}>No trades yet</div>
              )}
            </div>
          </div>

          {/* Provider reputation */}
          {reputationData?.reputation && reputationData.reputation.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-5">
              <h2 className="text-sm font-semibold mb-3" style={{ color: C.blueBlack }}>Provider Reputation</h2>
              <div className="space-y-2">
                {reputationData.reputation.slice(0, 5).map((r: any) => (
                  <div key={r.provider_id} className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: r.is_degraded ? C.red : C.green }} />
                    <span className="text-xs truncate flex-1" style={{ color: C.blueBlack }}>{r.provider_id.slice(0, 12)}</span>
                    <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ background: '#eee' }}>
                      <div className="h-full rounded-full" style={{ width: `${r.score * 100}%`, background: r.score > 0.7 ? C.green : r.score > 0.4 ? C.gold : C.red }} />
                    </div>
                    <span className="text-[10px] font-mono w-8 text-right" style={{ color: '#888' }}>{(r.score * 100).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Live feed */}
          <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold" style={{ color: C.blueBlack }}>Live Feed</h2>
              <LiveDot />
            </div>
            <LiveFeed />
          </div>
        </div>
      </div>
    </div>
  )
}
