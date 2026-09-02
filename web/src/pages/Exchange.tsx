import useSWR from 'swr'
import { api, Provider, DepthLevel } from '../lib/api'
import { useEffect, useRef, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'

// --- Dark trading terminal components ---

function StatCard({ label, value, sub, color = 'text-white' }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="bg-gray-800 rounded px-4 py-3 border border-gray-700">
      <div className="text-[10px] text-gray-500 uppercase tracking-widest">{label}</div>
      <div className={`text-xl font-bold font-mono ${color}`}>{value}</div>
      {sub && <div className="text-[10px] text-gray-500">{sub}</div>}
    </div>
  )
}

function DepthChart({ asks }: { asks: DepthLevel[] }) {
  const data = asks.map(d => ({
    price: `$${d.price.toFixed(2)}`,
    available: d.available_slots,
    total: d.total_slots,
    providers: d.providers,
    tps: d.avg_throughput,
  }))

  return (
    <div className="h-48">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <XAxis dataKey="price" tick={{ fill: '#9ca3af', fontSize: 11 }} />
          <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} />
          <Tooltip
            contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: 6, fontSize: 12 }}
            labelStyle={{ color: '#e5e7eb' }}
            itemStyle={{ color: '#34d399' }}
            formatter={(val: any, name: any) =>
              name === 'available' ? [`${val} slots`, 'Available'] : [`${val}`, name]
            }
          />
          <Bar dataKey="total" fill="#374151" radius={[4, 4, 0, 0]} />
          <Bar dataKey="available" radius={[4, 4, 0, 0]}>
            {data.map((_, i) => (
              <Cell key={i} fill={i === 0 ? '#10b981' : '#059669'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function ProviderLadder({ providers }: { providers: Provider[] }) {
  const sorted = [...providers].sort((a, b) => a.price_output - b.price_output)
  return (
    <div className="space-y-1">
      {sorted.map(p => {
        const loadPct = (p.load * 100)
        const statusDot = p.status === 'active' ? 'bg-green-500' : p.status === 'degraded' ? 'bg-yellow-500' : 'bg-red-500'
        return (
          <div key={p.id} className="flex items-center gap-2 text-xs font-mono py-1.5 px-2 rounded bg-gray-800/50 hover:bg-gray-700/50 border border-gray-700/50">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot}`} />
            <span className="text-gray-300 truncate w-24">{p.name || p.id.slice(0, 10)}</span>
            <span className="text-green-400 w-16 text-right">${p.price_output.toFixed(2)}</span>
            <span className="text-gray-500 w-14 text-right">{p.measured_tps.toFixed(1)} t/s</span>
            <div className="flex-1 mx-1">
              <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${loadPct > 80 ? 'bg-red-500' : loadPct > 50 ? 'bg-yellow-500' : 'bg-green-500'}`}
                  style={{ width: `${Math.max(2, loadPct)}%` }}
                />
              </div>
            </div>
            <span className="text-gray-500 w-8 text-right">{loadPct.toFixed(0)}%</span>
            <span className={`w-5 text-center ${p.encrypted ? 'text-green-400' : 'text-gray-600'}`}>
              {p.encrypted ? '🔒' : ''}
            </span>
            <span className="text-[10px] text-gray-600 w-8">{p.trust_level.slice(0, 4)}</span>
          </div>
        )
      })}
    </div>
  )
}

function TradeTicker({ trades }: { trades: Array<{ request_id: string; model: string; status: string; selected_provider?: string; selected_price?: number; encrypted?: boolean; preference?: string; timestamp: number }> }) {
  return (
    <div className="space-y-0.5 font-mono text-xs">
      {trades.length === 0 && <div className="text-gray-600 py-4 text-center">No trades yet</div>}
      {trades.map(t => (
        <div key={t.request_id} className="flex items-center gap-2 py-1 px-2 rounded hover:bg-gray-800/50">
          <span className="text-gray-600 w-16">{new Date(t.timestamp * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
          <span className={`w-2 h-2 rounded-full ${t.status === 'completed' || t.status === 'matched' || t.status === 'matched_from_queue' ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="text-gray-300 w-10 truncate">{t.model === 'default' ? 'DEF' : t.model.slice(0, 8)}</span>
          {t.selected_price != null && (
            <span className="text-green-400 w-14 text-right">${t.selected_price.toFixed(2)}</span>
          )}
          {t.selected_provider && (
            <span className="text-gray-500 truncate flex-1">{t.selected_provider.length > 12 ? t.selected_provider.slice(0, 12) : t.selected_provider}</span>
          )}
          {t.encrypted && <span className="text-green-400">E2E</span>}
          {t.preference && t.preference !== 'balanced' && (
            <span className={`text-[10px] px-1 rounded ${
              t.preference === 'cheapest' ? 'bg-yellow-900/50 text-yellow-400' :
              t.preference === 'fastest' ? 'bg-blue-900/50 text-blue-400' :
              t.preference === 'most_secure' ? 'bg-purple-900/50 text-purple-400' :
              'bg-gray-800 text-gray-400'
            }`}>{t.preference.slice(0, 5).toUpperCase()}</span>
          )}
        </div>
      ))}
    </div>
  )
}

function LiveFeed() {
  const [events, setEvents] = useState<Array<{ type: string; timestamp: number; [k: string]: any }>>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  const { data: recent } = useSWR('recentEvents', api.recentEvents)
  useEffect(() => {
    if (recent?.events) setEvents(recent.events.slice(-50))
  }, [recent])

  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${window.location.host}/ws/events`)
    ws.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data)
        setEvents(prev => [...prev.slice(-99), ev])
      } catch { /* */ }
    }
    return () => ws.close()
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [events])

  const typeColors: Record<string, string> = {
    match: 'text-green-400',
    billing: 'text-yellow-400',
    provider_connect: 'text-blue-400',
    provider_disconnect: 'text-red-400',
    attestation: 'text-purple-400',
  }

  return (
    <div ref={scrollRef} className="h-52 overflow-y-auto font-mono text-[11px] space-y-0.5 pr-1">
      {events.length === 0 && <div className="text-gray-600 py-8 text-center">Waiting for events...</div>}
      {events.map((ev, i) => (
        <div key={i} className="flex gap-2 py-0.5">
          <span className="text-gray-600 shrink-0">{new Date(ev.timestamp * 1000).toLocaleTimeString()}</span>
          <span className={`shrink-0 ${typeColors[ev.type] || 'text-gray-500'}`}>{ev.type}</span>
          {ev.provider && <span className="text-gray-500">{ev.provider}</span>}
          {ev.model && <span className="text-gray-500">{ev.model}</span>}
          {ev.cost_usd != null && <span className="text-yellow-400">${ev.cost_usd.toFixed(6)}</span>}
          {ev.status && <span className={ev.status === 'passed' ? 'text-green-400' : 'text-red-400'}>{ev.status}</span>}
        </div>
      ))}
    </div>
  )
}

// --- Main Exchange page ---

export function Exchange() {
  const { data: stats } = useSWR('stats', api.stats, { refreshInterval: 3000 })
  const { data: provData } = useSWR('providers', api.providers, { refreshInterval: 3000 })
  const { data: depthData } = useSWR('depth', api.depth, { refreshInterval: 5000 })
  const { data: traceData } = useSWR('traces', api.traces, { refreshInterval: 3000 })
  const { data: pricing } = useSWR('pricing', api.pricing, { refreshInterval: 10000 })

  const providers = provData?.providers || []
  const traces = traceData?.traces || []
  const recentTrades = [...traces].reverse().slice(0, 20)
  const bestPrice = pricing?.pricing?.[0]

  return (
    <div className="bg-gray-900 -mx-6 -mt-6 px-6 pt-5 pb-8 min-h-[calc(100vh-56px)] text-gray-200">
      {/* Header bar */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-white">Inference Exchange</h1>
          <span className="text-[10px] bg-green-900/50 text-green-400 px-2 py-0.5 rounded-full border border-green-800">LIVE</span>
        </div>
        {stats && (
          <div className="flex gap-4 text-xs font-mono text-gray-400">
            <span><strong className="text-green-400">{stats.providers_online}</strong> nodes</span>
            <span><strong className="text-white">{stats.models_available}</strong> models</span>
            <span><strong className="text-white">{stats.total_requests.toLocaleString()}</strong> fills</span>
            <span className="text-green-400"><strong>${stats.total_volume_usd.toFixed(4)}</strong> vol</span>
          </div>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        <StatCard
          label="Best Ask"
          value={bestPrice ? `$${bestPrice.output.toFixed(2)}` : '--'}
          sub={bestPrice ? `${bestPrice.providers_available} provider${bestPrice.providers_available !== 1 ? 's' : ''}` : undefined}
          color="text-green-400"
        />
        <StatCard
          label="Providers"
          value={stats?.providers_online ?? '--'}
          sub={`${providers.filter(p => p.encrypted).length} encrypted`}
        />
        <StatCard
          label="Capacity"
          value={depthData ? `${depthData.available_capacity}/${depthData.total_capacity}` : '--'}
          sub="slots avail/total"
        />
        <StatCard
          label="Total Fills"
          value={stats?.total_requests.toLocaleString() ?? '--'}
        />
        <StatCard
          label="Volume"
          value={stats ? `$${stats.total_volume_usd.toFixed(4)}` : '--'}
          sub={stats ? `${stats.total_tokens.toLocaleString()} tokens` : undefined}
          color="text-green-400"
        />
      </div>

      {/* Main grid: Depth + Providers left, Trades + Feed right */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Depth chart + Provider ladder (2 cols) */}
        <div className="lg:col-span-2 space-y-4">
          {/* Depth chart */}
          <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Order Depth</h2>
              <span className="text-[10px] text-gray-600">capacity by price level</span>
            </div>
            {depthData?.asks && depthData.asks.length > 0 ? (
              <DepthChart asks={depthData.asks} />
            ) : (
              <div className="h-48 flex items-center justify-center text-gray-600 text-sm">No depth data</div>
            )}
          </div>

          {/* Provider ladder */}
          <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Provider Ladder</h2>
              <span className="text-[10px] text-gray-600">{providers.length} node{providers.length !== 1 ? 's' : ''} sorted by price</span>
            </div>
            {providers.length > 0 ? (
              <ProviderLadder providers={providers} />
            ) : (
              <div className="py-8 text-center text-gray-600 text-sm">No providers connected</div>
            )}
          </div>
        </div>

        {/* Right: Trade ticker + Live feed (1 col) */}
        <div className="space-y-4">
          {/* Recent trades */}
          <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Recent Fills</h2>
              <span className="text-[10px] text-gray-600">last {recentTrades.length}</span>
            </div>
            <div className="max-h-64 overflow-y-auto">
              <TradeTicker trades={recentTrades} />
            </div>
          </div>

          {/* Live event feed */}
          <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Live Feed</h2>
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            </div>
            <LiveFeed />
          </div>
        </div>
      </div>
    </div>
  )
}
