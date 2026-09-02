import useSWR from 'swr'
import { api, Provider, DepthLevel } from '../lib/api'
import { useEffect, useRef, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'

function StatPill({ value, label, color = 'text-gray-900' }: { value: string | number; label: string; color?: string }) {
  return (
    <div className="bg-white rounded-xl px-5 py-4 border border-gray-200/60 shadow-sm">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-gray-400 mt-0.5">{label}</div>
    </div>
  )
}

function DepthChart({ asks }: { asks: DepthLevel[] }) {
  const data = asks.map(d => ({
    price: `$${d.price.toFixed(2)}`,
    available: d.available_slots,
    total: d.total_slots,
  }))
  return (
    <div className="h-44">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <XAxis dataKey="price" tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}
          />
          <Bar dataKey="total" fill="#f3f4f6" radius={[6, 6, 0, 0]} />
          <Bar dataKey="available" radius={[6, 6, 0, 0]}>
            {data.map((_, i) => (
              <Cell key={i} fill={i === 0 ? '#f59e0b' : '#d97706'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function ProviderRow({ p }: { p: Provider }) {
  const loadPct = p.load * 100
  return (
    <div className="flex items-center gap-3 py-3 px-4 rounded-xl hover:bg-gray-50 transition-colors">
      <span className={`w-2 h-2 rounded-full shrink-0 ${
        p.status === 'active' ? 'bg-emerald-500' : p.status === 'degraded' ? 'bg-amber-500' : 'bg-red-400'
      }`} />
      <span className="font-medium text-gray-900 w-32 truncate text-sm">{p.name || p.id.slice(0, 12)}</span>
      <span className="text-xs text-gray-400 w-20 truncate">{p.models[0] || '—'}</span>
      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
        p.trust_level === 'hardened' ? 'bg-amber-50 text-amber-600' :
        p.trust_level === 'confidential' ? 'bg-emerald-50 text-emerald-600' :
        p.trust_level === 'contained' ? 'bg-blue-50 text-blue-600' :
        'bg-gray-100 text-gray-500'
      }`}>{p.trust_level}</span>
      <span className="text-sm font-semibold text-gray-900 w-16 text-right">${p.price_output.toFixed(2)}</span>
      <span className="text-xs text-gray-400 w-14 text-right">{p.measured_tps.toFixed(1)} t/s</span>
      <div className="flex-1 max-w-[80px]">
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all ${
            loadPct > 80 ? 'bg-red-400' : loadPct > 50 ? 'bg-amber-400' : 'bg-emerald-400'
          }`} style={{ width: `${Math.max(3, loadPct)}%` }} />
        </div>
      </div>
      {p.encrypted && <span className="text-emerald-500 text-xs">E2E</span>}
    </div>
  )
}

function TradeRow({ t }: { t: { request_id: string; status: string; model: string; selected_provider?: string; selected_price?: number; preference?: string; timestamp: number } }) {
  const time = new Date(t.timestamp * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const ok = t.status === 'completed' || t.status === 'matched' || t.status === 'matched_from_queue'
  return (
    <div className="flex items-center gap-3 py-2 text-sm">
      <span className="text-xs text-gray-400 font-mono w-16">{time}</span>
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-red-400'}`} />
      <span className="text-gray-700 w-16 truncate text-xs">{t.model === 'default' ? 'default' : t.model.slice(0, 12)}</span>
      {t.selected_price != null && <span className="font-semibold text-gray-900 text-xs">${t.selected_price.toFixed(2)}</span>}
      {t.selected_provider && <span className="text-gray-400 text-xs truncate flex-1">{t.selected_provider.slice(0, 14)}</span>}
      {t.preference && t.preference !== 'balanced' && (
        <span className="text-[10px] font-medium text-gray-400">{t.preference}</span>
      )}
    </div>
  )
}

function LiveFeed() {
  const [events, setEvents] = useState<Array<{ type: string; timestamp: number; [k: string]: any }>>([])
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
    <div ref={scrollRef} className="h-48 overflow-y-auto text-xs space-y-0.5">
      {events.length === 0 && <div className="text-gray-300 py-8 text-center">Waiting for activity...</div>}
      {events.map((ev, i) => (
        <div key={i} className="flex gap-2 py-0.5 text-gray-500">
          <span className="text-gray-300 shrink-0">{new Date(ev.timestamp * 1000).toLocaleTimeString()}</span>
          <span className={colors[ev.type] || 'text-gray-400'}>{ev.type}</span>
          {ev.provider && <span>{ev.provider}</span>}
          {ev.model && <span>{ev.model}</span>}
          {ev.cost_usd != null && <span className="text-amber-500">${ev.cost_usd.toFixed(6)}</span>}
        </div>
      ))}
    </div>
  )
}

export function Exchange() {
  const { data: stats } = useSWR('stats', api.stats, { refreshInterval: 3000 })
  const { data: provData } = useSWR('providers', api.providers, { refreshInterval: 3000 })
  const { data: depthData } = useSWR('depth', api.depth, { refreshInterval: 5000 })
  const { data: traceData } = useSWR('traces', api.traces, { refreshInterval: 3000 })

  const providers = provData?.providers || []
  const traces = traceData?.traces || []
  const recentTrades = [...traces].reverse().slice(0, 15)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Exchange</h1>
          <p className="text-sm text-gray-400 mt-0.5">Live marketplace activity</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs text-gray-400">Real-time</span>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatPill value={stats.providers_online} label="Providers online" />
          <StatPill value={depthData ? `${depthData.available_capacity}/${depthData.total_capacity}` : '--'} label="Capacity (avail/total)" />
          <StatPill value={stats.total_requests.toLocaleString()} label="Total fills" />
          <StatPill value={`$${stats.total_volume_usd.toFixed(4)}`} label="Volume" color="text-amber-600" />
        </div>
      )}

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Depth + Providers */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">Order Depth</h2>
            {depthData?.asks && depthData.asks.length > 0 ? (
              <DepthChart asks={depthData.asks} />
            ) : (
              <div className="h-44 flex items-center justify-center text-gray-300 text-sm">Connect a provider to see depth</div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-900">Providers</h2>
              <span className="text-xs text-gray-400">{providers.length} online</span>
            </div>
            {providers.length > 0 ? (
              <div className="space-y-0.5">
                {providers.sort((a, b) => a.price_output - b.price_output).map(p => <ProviderRow key={p.id} p={p} />)}
              </div>
            ) : (
              <div className="py-8 text-center text-gray-300 text-sm">No providers connected</div>
            )}
          </div>
        </div>

        {/* Trades + Feed */}
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Recent Fills</h2>
            <div className="max-h-72 overflow-y-auto">
              {recentTrades.length > 0 ? (
                recentTrades.map(t => <TradeRow key={t.request_id} t={t} />)
              ) : (
                <div className="py-8 text-center text-gray-300 text-sm">No trades yet</div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-900">Live Feed</h2>
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            </div>
            <LiveFeed />
          </div>
        </div>
      </div>
    </div>
  )
}
