import useSWR from 'swr'
import { api, Provider } from '../lib/api'
import { useEffect, useRef, useState } from 'react'

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

function ProviderCard({ p }: { p: Provider }) {
  const loadPct = p.load * 100
  return (
    <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-5 hover:shadow-md transition-all">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${p.status === 'active' ? 'bg-emerald-500' : 'bg-gray-300'}`} />
          <span className="font-semibold text-gray-900">{p.name}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
            p.trust_level === 'hardened' ? 'bg-amber-50 text-amber-600 border border-amber-200/50' :
            p.trust_level === 'confidential' ? 'bg-emerald-50 text-emerald-600 border border-emerald-200/50' :
            p.trust_level === 'contained' ? 'bg-blue-50 text-blue-600 border border-blue-200/50' :
            'bg-gray-50 text-gray-500 border border-gray-200/50'
          }`}>{p.trust_level}</span>
          {p.encrypted && <span className="text-[10px] font-medium text-emerald-500 bg-emerald-50 px-1.5 py-0.5 rounded-full border border-emerald-200/50">E2E</span>}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <div className="text-[10px] text-gray-400 uppercase tracking-wider">Price</div>
          <div className="text-lg font-bold text-gray-900 mt-0.5">${p.price_output.toFixed(2)}</div>
          <div className="text-[10px] text-gray-400">per Mtok out</div>
        </div>
        <div>
          <div className="text-[10px] text-gray-400 uppercase tracking-wider">Speed</div>
          <div className="text-lg font-bold text-gray-900 mt-0.5">{p.measured_tps.toFixed(0)}</div>
          <div className="text-[10px] text-gray-400">tokens/sec</div>
        </div>
        <div>
          <div className="text-[10px] text-gray-400 uppercase tracking-wider">Load</div>
          <div className="flex items-center gap-2 mt-1.5">
            <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all ${loadPct > 80 ? 'bg-red-400' : loadPct > 50 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                style={{ width: `${Math.max(4, loadPct)}%` }} />
            </div>
            <span className="text-xs text-gray-500 font-mono">{loadPct.toFixed(0)}%</span>
          </div>
          <div className="text-[10px] text-gray-400 mt-0.5">{p.active_requests}/{p.max_concurrent} slots</div>
        </div>
      </div>
      <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400">
        <span>{p.models.join(', ')}</span>
        <span>{p.hardware}</span>
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

  const providers = provData?.providers || []
  const traces = traceData?.traces || []
  const recentTrades = [...traces].reverse().slice(0, 15)

  if (providers.length === 0 && !stats?.total_requests) {
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
        {/* Providers */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">Active Providers</h2>
            <span className="text-xs text-gray-400">{providers.length} online</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {providers.sort((a, b) => a.price_output - b.price_output).map(p => <ProviderCard key={p.id} p={p} />)}
          </div>
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
