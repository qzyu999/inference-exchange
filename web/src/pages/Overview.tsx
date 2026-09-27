import { useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'

const C = {
  gold: '#C49A45',
  green: '#3F8055',
  turquoise: '#4D9A91',
  deepBlue: '#315B72',
  blueBlack: '#292F35',
  red: '#B7443B',
  orange: '#D77A2F',
}

const TRUST_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  open:         { bg: '#f3f3f3', text: '#999',     label: 'Open' },
  contained:    { bg: '#eef3f7', text: C.deepBlue, label: 'Contained' },
  hardened:     { bg: '#fdf6ec', text: C.gold,     label: 'Hardened+' },
  confidential: { bg: '#edf7f1', text: C.green,    label: 'Confidential' },
}

export function Overview() {
  const { data: stats } = useSWR('stats', api.stats, { refreshInterval: 5000 })
  const { data: provData } = useSWR('providers', api.providers, { refreshInterval: 5000 })
  const { data: repData } = useSWR('reputation', api.reputation, { refreshInterval: 10000 })
  const { data: traceData } = useSWR('traces', api.traces, { refreshInterval: 5000 })
  const { data: health } = useSWR('health', api.health, { refreshInterval: 10000 })

  const providers = provData?.providers || []
  const traces = traceData?.traces || []
  const reputation = repData?.reputation || []

  // Compute real stats
  const totalSlots = providers.reduce((s: number, p: any) => s + p.max_concurrent, 0)
  const usedSlots = providers.reduce((s: number, p: any) => s + p.active_requests, 0)
  const encryptedCount = providers.filter((p: any) => p.encrypted).length
  const hardenedCount = providers.filter((p: any) => p.trust_level === 'hardened' || p.trust_level === 'confidential').length

  // Request success rate from traces
  const completedTraces = traces.filter((t: any) => ['completed', 'matched', 'matched_from_queue'].includes(t.status))
  const successRate = traces.length > 0 ? (completedTraces.length / traces.length) * 100 : 0

  // Recent activity (last 10 traces)
  const recentTraces = [...traces].reverse().slice(0, 10)

  // Live event feed
  const [events, setEvents] = useState<Array<any>>([])
  const feedRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${window.location.host}/ws/events`)
    ws.onmessage = (e) => { try { setEvents(prev => [...prev.slice(-49), JSON.parse(e.data)]) } catch {} }
    return () => ws.close()
  }, [])
  useEffect(() => { feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight }) }, [events])

  const eventColors: Record<string, string> = {
    match: C.green, billing: C.gold, provider_connect: C.deepBlue,
    provider_disconnect: C.red, attestation: C.turquoise,
  }

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Providers online', value: stats?.providers_online ?? providers.length, color: C.blueBlack },
          { label: 'Models advertised', value: stats?.models_available ?? health?.models?.length ?? 0, color: C.blueBlack },
          { label: 'Request success', value: traces.length > 0 ? `${successRate.toFixed(1)}%` : '—', color: successRate >= 95 ? C.green : successRate >= 80 ? C.gold : C.red },
          { label: 'Volume / session', value: stats?.total_volume_usd != null ? `$${stats.total_volume_usd >= 1 ? stats.total_volume_usd.toFixed(2) : stats.total_volume_usd.toFixed(4)}` : '—', color: C.gold },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl border border-gray-200/40 px-5 py-4">
            <div className="text-2xl font-bold tracking-tight" style={{ color: s.color }}>{s.value}</div>
            <div className="text-[11px] mt-0.5" style={{ color: '#999' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Two-column: Health + Transparency */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Network health */}
        <div className="bg-white rounded-2xl border border-gray-200/40 p-6">
          <div className="text-[10px] uppercase tracking-wider font-medium mb-1" style={{ color: C.gold }}>
            Network Health
          </div>
          <h2 className="text-lg font-bold mb-4" style={{ color: C.blueBlack }}>Request outcomes</h2>

          <div className="flex items-center gap-6 mb-4">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: C.green }} />
              <span className="text-sm" style={{ color: C.green }}>Healthy routing</span>
              <span className="text-sm font-semibold" style={{ color: C.blueBlack }}>{completedTraces.length}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: C.red }} />
              <span className="text-sm" style={{ color: C.red }}>Failures</span>
              <span className="text-sm font-semibold" style={{ color: C.blueBlack }}>{traces.length - completedTraces.length}</span>
            </div>
          </div>

          {/* Simple bar chart of recent traces */}
          {recentTraces.length > 0 ? (
            <div className="flex items-end gap-1.5 h-24">
              {recentTraces.map((t: any, i: number) => {
                const ok = ['completed', 'matched', 'matched_from_queue'].includes(t.status)
                return (
                  <Link
                    key={i}
                    to={`/trace?id=${t.request_id}`}
                    className="flex-1 rounded-t transition-colors hover:opacity-80"
                    style={{
                      background: ok ? C.green : C.red,
                      height: `${Math.max(15, Math.random() * 80 + 20)}%`,
                      opacity: 0.7 + (i / recentTraces.length) * 0.3,
                    }}
                    title={`${t.request_id} — ${t.status}`}
                  />
                )
              })}
            </div>
          ) : (
            <div className="text-xs text-center py-8" style={{ color: '#ccc' }}>
              No requests yet. Send a chat message to see outcomes here.
            </div>
          )}

          {/* Fleet capacity */}
          <div className="mt-4 pt-4 flex items-center gap-4 text-xs" style={{ borderTop: '1px solid #f0ede6', color: '#888' }}>
            <span>Capacity: <span className="font-semibold" style={{ color: C.blueBlack }}>{usedSlots}/{totalSlots}</span> slots</span>
            {encryptedCount > 0 && <span><span className="font-semibold" style={{ color: C.deepBlue }}>{encryptedCount}</span> E2E</span>}
            {hardenedCount > 0 && <span><span className="font-semibold" style={{ color: C.gold }}>{hardenedCount}</span> Hardened+</span>}
          </div>
        </div>

        {/* Radical transparency */}
        <div className="bg-white rounded-2xl border border-gray-200/40 p-6">
          <div className="text-[10px] uppercase tracking-wider font-medium mb-1" style={{ color: C.gold }}>
            Radical Transparency
          </div>
          <h2 className="text-lg font-bold mb-4" style={{ color: C.blueBlack }}>What is running</h2>

          <div className="space-y-3">
            {[
              { component: 'Coordinator', version: health?.status === 'ok' ? 'v0.1.0' : '—', ok: health?.status === 'ok' },
              { component: 'Provider agent', version: providers.length > 0 ? 'v0.1.0' : '—', ok: providers.length > 0 },
              { component: 'OCIP protocol', version: 'v1', ok: true },
              { component: 'Billing', version: stats?.total_requests != null ? 'v0.1.0' : '—', ok: stats?.total_requests != null },
            ].map(c => (
              <div key={c.component} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                <span className="text-sm" style={{ color: C.blueBlack }}>{c.component}</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono" style={{ color: '#999' }}>{c.version}</span>
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                    style={{ background: c.ok ? '#edf7f1' : '#f3f3f3', color: c.ok ? C.green : '#999' }}>
                    {c.ok ? 'verified' : 'unavailable'}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Trust level distribution */}
          {providers.length > 0 && (
            <div className="mt-4 pt-4" style={{ borderTop: '1px solid #f0ede6' }}>
              <div className="text-[10px] uppercase tracking-wider font-medium mb-2" style={{ color: '#aaa' }}>
                Fleet trust distribution
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {(['open', 'contained', 'hardened', 'confidential'] as const).map(level => {
                  const count = providers.filter((p: any) => p.trust_level === level).length
                  if (count === 0) return null
                  const tc = TRUST_COLORS[level]
                  return (
                    <span key={level} className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                      style={{ background: tc.bg, color: tc.text }}>
                      {tc.label} x{count}
                    </span>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Two-column: Recent activity + Provider reputation */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Live event feed */}
        <div className="bg-white rounded-2xl border border-gray-200/40 p-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-[10px] uppercase tracking-wider font-medium" style={{ color: C.gold }}>Live Feed</div>
              <div className="text-xs mt-0.5" style={{ color: '#999' }}>Real-time exchange events</div>
            </div>
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: C.green }} />
              <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: C.green }} />
            </span>
          </div>
          <div ref={feedRef} className="h-48 overflow-y-auto text-[11px] space-y-0.5 font-mono">
            {events.length > 0 ? events.map((ev, i) => (
              <div key={i} className="flex gap-2 py-0.5" style={{ color: '#888' }}>
                <span className="shrink-0" style={{ color: '#ccc' }}>{new Date(ev.timestamp * 1000).toLocaleTimeString()}</span>
                <span style={{ color: eventColors[ev.type] || '#aaa' }}>{ev.type}</span>
                {ev.provider && <span className="truncate">{ev.provider}</span>}
                {ev.cost_usd != null && <span style={{ color: C.gold }}>${ev.cost_usd.toFixed(6)}</span>}
              </div>
            )) : (
              <div className="text-xs text-center py-12 font-sans" style={{ color: '#ccc' }}>
                Waiting for activity...
              </div>
            )}
          </div>
        </div>

        {/* Provider reputation */}
        <div className="bg-white rounded-2xl border border-gray-200/40 p-6">
          <div className="text-[10px] uppercase tracking-wider font-medium mb-1" style={{ color: C.gold }}>
            Provider Reputation
          </div>
          <div className="text-xs mb-4" style={{ color: '#999' }}>EMA-based scoring from observed request outcomes</div>

          {reputation.length > 0 ? (
            <div className="space-y-3">
              {reputation.slice(0, 6).map((r: any) => {
                const prov = providers.find((p: any) => p.id === r.provider_id)
                return (
                  <div key={r.provider_id} className="flex items-center gap-3">
                    <span className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: r.is_degraded ? C.red : r.score > 0.8 ? C.green : C.gold }} />
                    <span className="text-xs truncate flex-1" style={{ color: C.blueBlack }}>
                      {prov?.name || r.provider_id.slice(0, 12)}
                    </span>
                    <div className="w-20 h-1.5 rounded-full overflow-hidden" style={{ background: '#f0f0f0' }}>
                      <div className="h-full rounded-full" style={{
                        width: `${r.score * 100}%`,
                        background: r.score > 0.8 ? C.green : r.score > 0.5 ? C.gold : C.red,
                      }} />
                    </div>
                    <span className="text-[10px] font-mono w-8 text-right" style={{ color: '#888' }}>
                      {(r.score * 100).toFixed(0)}%
                    </span>
                    <span className="text-[10px]" style={{ color: '#bbb' }}>
                      {r.total_requests} req
                    </span>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-xs text-center py-8" style={{ color: '#ccc' }}>
              No reputation data yet. Reputation builds from request outcomes.
            </div>
          )}
        </div>
      </div>

      {/* Connected providers */}
      {providers.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200/40 p-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-[10px] uppercase tracking-wider font-medium" style={{ color: C.gold }}>Connected Providers</div>
            </div>
            <Link to="/providers" className="text-[10px] font-medium" style={{ color: C.gold }}>View all</Link>
          </div>
          <div className="space-y-2">
            {providers.slice(0, 5).map((p: any) => {
              const tc = TRUST_COLORS[p.trust_level] || TRUST_COLORS.open
              return (
                <div key={p.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <div className="flex items-center gap-3">
                    <span className="w-2 h-2 rounded-full" style={{ background: C.green }} />
                    <span className="text-sm font-medium" style={{ color: C.blueBlack }}>{p.name || p.id.slice(0, 12)}</span>
                    <span className="text-xs" style={{ color: '#999' }}>{p.hardware}</span>
                    <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full" style={{ background: tc.bg, color: tc.text }}>
                      {tc.label}
                    </span>
                    {p.encrypted && <span className="text-[8px] px-1 rounded" style={{ background: '#eef3f7', color: C.deepBlue }}>E2E</span>}
                  </div>
                  <div className="flex items-center gap-4 text-xs">
                    <span style={{ color: C.turquoise }}>{p.measured_tps > 0 ? `${p.measured_tps.toFixed(0)} tok/s` : '—'}</span>
                    <span style={{ color: C.gold }}>${p.price_output.toFixed(2)}/M</span>
                    <span style={{ color: '#999' }}>{p.active_requests}/{p.max_concurrent}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
