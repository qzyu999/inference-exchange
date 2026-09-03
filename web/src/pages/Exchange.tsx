import useSWR from 'swr'
import { api } from '../lib/api'
import { useEffect, useRef, useState } from 'react'

// --- API type ---
interface MarketModel {
  model: string
  family: string
  size: string
  variant: string
  canonical_id: string
  providers: Array<{
    id: string; name: string; price_output: number; price_input: number
    tps: number; trust: string; encrypted: boolean; load: number
    hardware: string; slots: string; quantization: string; original_model: string
    context_length: number; verified: boolean
  }>
  cheapest_output: number
  fastest_tps: number
  max_trust: string
  provider_count: number
  reference_prices: Array<{ provider: string; model: string; price_output: number; diff_pct: number; cheaper: boolean }>
}

function formatVolume(usd: number): string {
  if (usd >= 1) return `$${usd.toFixed(2)}`
  if (usd >= 0.01) return `$${usd.toFixed(4)}`
  if (usd > 0) return `$${usd.toFixed(6)}`
  return '$0'
}

function LiveDot() {
  return <span className="relative flex h-2 w-2">
    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
  </span>
}

function ModelMarketCard({ m }: { m: MarketModel }) {
  const cheaperCount = m.reference_prices.filter(r => r.cheaper).length
  return (
    <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold text-gray-900">{m.model}</div>
            <div className="text-xs text-gray-400 mt-0.5">
              {m.family && <span>{m.family}</span>}
              {m.size && <span> {m.size}</span>}
              {m.variant && <span> {m.variant}</span>}
              {' '}{m.provider_count} provider{m.provider_count !== 1 ? 's' : ''}
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-gray-900">${m.cheapest_output.toFixed(2)}</div>
            <div className="text-[10px] text-gray-400">per Mtok output</div>
          </div>
        </div>
      </div>

      {/* Reference pricing comparison -- honest, shows all */}
      {m.reference_prices.length > 0 && (
        <div className="px-5 py-3 bg-gray-50/50 border-b border-gray-100">
          <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-2">Market comparison</div>
          <div className="space-y-1.5">
            {m.reference_prices.slice(0, 5).map((ref, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="text-gray-600">{ref.provider} <span className="text-gray-400">{ref.model}</span></span>
                <div className="flex items-center gap-2">
                  <span className="text-gray-500">${ref.price_output.toFixed(2)}</span>
                  <span className={`font-medium ${ref.cheaper ? 'text-emerald-600' : 'text-red-500'}`}>
                    {ref.cheaper ? `-${ref.diff_pct}%` : `+${Math.abs(ref.diff_pct)}%`}
                  </span>
                </div>
              </div>
            ))}
          </div>
          {cheaperCount > 0 && (
            <div className="text-[10px] text-gray-400 mt-2">
              Cheaper than {cheaperCount} of {m.reference_prices.length} reference providers
            </div>
          )}
        </div>
      )}

      {/* Provider rows */}
      <div className="px-5 py-3">
        <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-2">Providers on exchange</div>
        {m.providers.map(p => (
          <div key={p.id} className="flex items-center gap-2 py-2.5 border-b border-gray-50 last:border-0 text-sm">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${p.load < 0.8 ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            <div className="truncate w-20">
              <span className="text-gray-700">{p.name}</span>
              {p.verified && <span className="ml-1 text-[9px] text-blue-500" title="Model hash verified against HuggingFace">✓</span>}
            </div>
            <span className="font-semibold text-gray-900 w-14 text-right">${p.price_output.toFixed(2)}</span>
            <span className="text-xs text-gray-400 w-12 text-right">{p.tps.toFixed(0)} t/s</span>
            {p.quantization && (
              <span className="text-[10px] font-mono text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200/50">{p.quantization}</span>
            )}
            {p.context_length > 0 && (
              <span className="text-[10px] text-gray-400">{(p.context_length / 1024).toFixed(0)}k ctx</span>
            )}
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
              p.trust === 'hardened' ? 'bg-amber-50 text-amber-600' :
              p.trust === 'confidential' ? 'bg-emerald-50 text-emerald-600' :
              p.trust === 'contained' ? 'bg-blue-50 text-blue-600' :
              'bg-gray-50 text-gray-400'
            }`}>{p.trust}</span>
            {p.encrypted && <span className="text-[10px] text-emerald-500">E2E</span>}
            <span className="text-xs text-gray-400 ml-auto">{p.slots}</span>
          </div>
        ))}
      </div>

      {/* CTA */}
      <div className="px-5 py-3 border-t border-gray-100">
        <a href={`/chat?model=${encodeURIComponent(m.model)}`}
          className="block text-center py-2.5 bg-gray-900 text-white rounded-xl text-xs font-medium hover:bg-gray-800 transition-colors">
          Chat with this model
        </a>
      </div>
    </div>
  )
}

function TradeRow({ t }: { t: any }) {
  const time = new Date(t.timestamp * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const ok = ['completed', 'matched', 'matched_from_queue'].includes(t.status)
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0">
      <span className="text-[11px] text-gray-400 font-mono w-14">{time}</span>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${ok ? 'bg-emerald-500' : 'bg-red-400'}`} />
      <span className="text-sm text-gray-700 truncate flex-1">{t.model === 'default' ? 'Any model' : t.model}</span>
      {t.selected_price != null && <span className="text-sm font-semibold text-gray-900">${t.selected_price.toFixed(2)}</span>}
      {t.preference && t.preference !== 'balanced' && (
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
          t.preference === 'cheapest' ? 'bg-amber-50 text-amber-600' :
          t.preference === 'fastest' ? 'bg-blue-50 text-blue-600' :
          t.preference === 'most_secure' ? 'bg-purple-50 text-purple-600' :
          'bg-gray-50 text-gray-500'
        }`}>{t.preference}</span>
      )}
    </div>
  )
}

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

  const colors: Record<string, string> = {
    match: 'text-emerald-500', billing: 'text-amber-500', provider_connect: 'text-blue-500',
    provider_disconnect: 'text-red-400', attestation: 'text-purple-500',
  }

  return (
    <div ref={scrollRef} className="h-44 overflow-y-auto text-[11px] space-y-0.5 font-mono">
      {events.length === 0 && <div className="text-gray-300 py-8 text-center text-xs font-sans">Waiting for activity...</div>}
      {events.map((ev, i) => (
        <div key={i} className="flex gap-2 py-0.5 text-gray-500">
          <span className="text-gray-300 shrink-0">{new Date(ev.timestamp * 1000).toLocaleTimeString()}</span>
          <span className={colors[ev.type] || 'text-gray-400'}>{ev.type}</span>
          {ev.provider && <span className="truncate">{ev.provider}</span>}
          {ev.cost_usd != null && <span className="text-amber-500">{formatVolume(ev.cost_usd)}</span>}
        </div>
      ))}
    </div>
  )
}

// --- Empty state for no providers ---
function EmptyExchange() {
  return (
    <div className="max-w-2xl mx-auto text-center py-16">
      <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-amber-100 to-orange-100 flex items-center justify-center mx-auto mb-6">
        <span className="text-3xl">⚡</span>
      </div>
      <h2 className="text-2xl font-bold text-gray-900 mb-3">The exchange is quiet</h2>
      <p className="text-gray-500 mb-8 max-w-md mx-auto leading-relaxed">
        No providers are connected yet. When providers come online, you'll see live pricing,
        capacity depth, and trade activity here.
      </p>
      <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-6 text-left max-w-md mx-auto">
        <div className="text-sm font-semibold text-gray-900 mb-3">Become the first provider</div>
        <div className="bg-gray-50 rounded-xl p-4 font-mono text-xs text-gray-600 space-y-1">
          <div><span className="text-gray-400">$</span> pip install ie-provider</div>
          <div><span className="text-gray-400">$</span> ie-provider start</div>
        </div>
        <p className="text-xs text-gray-400 mt-3">Earn credits by serving inference on your hardware.</p>
      </div>
    </div>
  )
}

// --- Main ---
export function Exchange() {
  const { data: stats } = useSWR('stats', api.stats, { refreshInterval: 3000 })
  const { data: provData } = useSWR('providers', api.providers, { refreshInterval: 3000 })
  const { data: depthData } = useSWR('depth', api.depth, { refreshInterval: 5000 })
  const { data: traceData } = useSWR('traces', api.traces, { refreshInterval: 3000 })
  const { data: marketData } = useSWR('market', api.market, { refreshInterval: 5000 })

  const providers = provData?.providers || []
  const traces = traceData?.traces || []
  const recentTrades = [...traces].reverse().slice(0, 15)
  const models = (marketData?.models || []) as MarketModel[]

  if (provData && providers.length === 0 && models.length === 0) {
    return (
      <div>
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Exchange</h1>
            <p className="text-sm text-gray-400 mt-0.5">Live marketplace activity</p>
          </div>
          <div className="flex items-center gap-2"><LiveDot /><span className="text-xs text-gray-400">Real-time</span></div>
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
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Exchange</h1>
          <p className="text-sm text-gray-400 mt-0.5">Live marketplace activity</p>
        </div>
        <div className="flex items-center gap-2"><LiveDot /><span className="text-xs text-gray-400">Real-time</span></div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Providers', value: stats.providers_online, highlight: false },
            { label: 'Capacity', value: depthData ? `${depthData.available_capacity}/${depthData.total_capacity}` : '--', highlight: false },
            { label: 'Fills', value: stats.total_requests.toLocaleString(), highlight: false },
            { label: 'Volume', value: formatVolume(stats.total_volume_usd), highlight: true },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-2xl border border-gray-200/60 shadow-sm px-5 py-4">
              <div className={`text-2xl font-bold tracking-tight ${s.highlight ? 'text-amber-600' : 'text-gray-900'}`}>{s.value}</div>
              <div className="text-[10px] text-gray-400 uppercase tracking-wider mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Models market view */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">Market by Model</h2>
            <span className="text-xs text-gray-400">{models.length} model{models.length !== 1 ? 's' : ''} available</span>
          </div>
          {models.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {models.map(m => <ModelMarketCard key={m.model} m={m} />)}
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-200/60 p-12 text-center text-gray-300 text-sm">
              No models available yet
            </div>
          )}
        </div>

        {/* Sidebar: Trades + Feed */}
        <div className="space-y-5">
          <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-900">Recent Fills</h2>
              <span className="text-[10px] text-gray-400">{recentTrades.length} recent</span>
            </div>
            <div className="max-h-72 overflow-y-auto">
              {recentTrades.length > 0 ? (
                recentTrades.map(t => <TradeRow key={t.request_id} t={t} />)
              ) : (
                <div className="text-center py-8 text-sm text-gray-300">No trades yet</div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-900">Live Feed</h2>
              <LiveDot />
            </div>
            <LiveFeed />
          </div>
        </div>
      </div>
    </div>
  )
}
