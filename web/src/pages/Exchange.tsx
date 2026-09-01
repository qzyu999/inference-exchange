import useSWR from 'swr'
import { api, Provider, DepthLevel } from '../lib/api'
import { useEffect, useRef, useState } from 'react'

function ProviderRow({ p }: { p: Provider }) {
  const statusColor = p.status === 'active' ? 'bg-green-500' : p.status === 'degraded' ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50 text-sm">
      <td className="py-2 px-3 font-mono text-xs">{p.id.slice(0, 8)}</td>
      <td className="py-2 px-3">
        <span className={`inline-block w-2 h-2 rounded-full mr-2 ${statusColor}`} />
        {p.name || p.id.slice(0, 12)}
      </td>
      <td className="py-2 px-3">{p.models.join(', ')}</td>
      <td className="py-2 px-3">{p.trust_level}</td>
      <td className="py-2 px-3 text-right">${p.price_output.toFixed(2)}</td>
      <td className="py-2 px-3 text-right">{p.measured_tps.toFixed(1)}</td>
      <td className="py-2 px-3 text-right">{(p.load * 100).toFixed(0)}%</td>
      <td className="py-2 px-3 text-center">{p.encrypted ? '🔒' : '—'}</td>
    </tr>
  )
}

function DepthRow({ d }: { d: DepthLevel }) {
  return (
    <tr className="border-b border-gray-100 text-sm">
      <td className="py-2 px-3 text-right font-mono">${d.price.toFixed(2)}</td>
      <td className="py-2 px-3 text-right">{d.available_slots}/{d.total_slots}</td>
      <td className="py-2 px-3 text-right">{d.providers}</td>
      <td className="py-2 px-3 text-right">{d.avg_throughput.toFixed(1)} tps</td>
      <td className="py-2 px-3">{d.max_confidence}</td>
    </tr>
  )
}

function EventFeed() {
  const [events, setEvents] = useState<Array<{ type: string; timestamp: number; [k: string]: any }>>([])
  const wsRef = useRef<WebSocket | null>(null)

  // Seed from REST first
  const { data: recent } = useSWR('recentEvents', api.recentEvents)
  useEffect(() => {
    if (recent?.events) setEvents(recent.events.slice(-30))
  }, [recent])

  // Then live stream
  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${window.location.host}/ws/events`)
    wsRef.current = ws
    ws.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data)
        setEvents(prev => [...prev.slice(-49), ev])
      } catch { /* ignore non-JSON */ }
    }
    return () => ws.close()
  }, [])

  return (
    <div className="bg-gray-900 text-green-400 rounded-lg p-4 font-mono text-xs h-64 overflow-y-auto">
      {events.length === 0 && <div className="text-gray-500">Waiting for events…</div>}
      {events.map((ev, i) => (
        <div key={i} className="py-0.5">
          <span className="text-gray-500">{new Date(ev.timestamp * 1000).toLocaleTimeString()}</span>
          {' '}
          <span className={
            ev.type === 'match' ? 'text-green-400' :
            ev.type === 'billing' ? 'text-yellow-400' :
            ev.type === 'provider_connected' ? 'text-blue-400' :
            ev.type === 'provider_disconnected' ? 'text-red-400' :
            'text-gray-400'
          }>{ev.type}</span>
          {ev.model && <span className="text-gray-500"> {ev.model}</span>}
          {ev.provider_name && <span className="text-gray-500"> → {ev.provider_name}</span>}
          {ev.cost_usd != null && <span className="text-yellow-400"> ${ev.cost_usd.toFixed(6)}</span>}
        </div>
      ))}
    </div>
  )
}

export function Exchange() {
  const { data: stats } = useSWR('stats', api.stats, { refreshInterval: 3000 })
  const { data: provData } = useSWR('providers', api.providers, { refreshInterval: 5000 })
  const { data: depthData } = useSWR('depth', api.depth, { refreshInterval: 5000 })
  const { data: traceData } = useSWR('traces', api.traces, { refreshInterval: 5000 })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Exchange</h1>
        {stats && (
          <div className="flex gap-4 text-sm text-gray-600">
            <span><strong className="text-green-600">{stats.providers_online}</strong> providers</span>
            <span><strong>{stats.models_available}</strong> models</span>
            <span><strong>{stats.total_requests.toLocaleString()}</strong> requests</span>
            <span className="text-green-600 font-semibold">${stats.total_volume_usd.toFixed(4)}</span>
          </div>
        )}
      </div>

      {/* Depth / Order Book */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Order Depth</h2>
        {depthData?.asks && depthData.asks.length > 0 ? (
          <table className="w-full">
            <thead>
              <tr className="text-xs text-gray-500 uppercase border-b">
                <th className="py-2 px-3 text-right">Price/Mtok</th>
                <th className="py-2 px-3 text-right">Slots (avail/total)</th>
                <th className="py-2 px-3 text-right">Providers</th>
                <th className="py-2 px-3 text-right">Avg Throughput</th>
                <th className="py-2 px-3 text-left">Max Confidence</th>
              </tr>
            </thead>
            <tbody>
              {depthData.asks.map((d, i) => <DepthRow key={i} d={d} />)}
            </tbody>
          </table>
        ) : (
          <div className="text-gray-400 text-sm">No depth data — connect a provider to see the order book.</div>
        )}
      </div>

      {/* Live Providers */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Live Providers</h2>
        {provData?.providers && provData.providers.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-xs text-gray-500 uppercase border-b">
                  <th className="py-2 px-3 text-left">ID</th>
                  <th className="py-2 px-3 text-left">Name</th>
                  <th className="py-2 px-3 text-left">Models</th>
                  <th className="py-2 px-3 text-left">Trust</th>
                  <th className="py-2 px-3 text-right">$/Mtok Out</th>
                  <th className="py-2 px-3 text-right">TPS</th>
                  <th className="py-2 px-3 text-right">Load</th>
                  <th className="py-2 px-3 text-center">E2E</th>
                </tr>
              </thead>
              <tbody>
                {provData.providers.map(p => <ProviderRow key={p.id} p={p} />)}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-gray-400 text-sm">No providers connected.</div>
        )}
      </div>

      {/* Recent Traces */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Recent Matches</h2>
        {traceData?.traces && traceData.traces.length > 0 ? (
          <div className="space-y-2">
            {traceData.traces.slice(-10).reverse().map(t => (
              <div key={t.request_id} className="flex items-center text-sm gap-3 py-1 border-b border-gray-50">
                <span className="font-mono text-xs text-gray-400">{t.request_id.slice(0, 8)}</span>
                <span className="font-medium">{t.model}</span>
                <span className={t.status === 'completed' ? 'text-green-600' : 'text-red-500'}>{t.status}</span>
                {t.selected_provider && <span className="text-gray-500">→ {t.selected_provider.slice(0, 8)}</span>}
                {t.selected_price != null && <span className="text-gray-500">${t.selected_price.toFixed(2)}/Mtok</span>}
                {t.encrypted && <span>🔒</span>}
                {t.preference && <span className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{t.preference}</span>}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-gray-400 text-sm">No requests yet.</div>
        )}
      </div>

      {/* Live Event Feed */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Live Feed</h2>
        <EventFeed />
      </div>
    </div>
  )
}
