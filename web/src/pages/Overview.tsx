import { useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import { useAuth } from '../lib/auth'
import { NetworkGlobe } from '../components/NetworkGlobe'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { requestOutcome } from '../lib/request-outcomes.js'
import { formatUsd } from '../lib/money.js'
import { UI, APP_TRUST_COLORS as TRUST_COLORS } from '../lib/theme'

export function Overview() {
  const { user } = useAuth()
  const { data: stats } = useSWR('stats', api.stats, { refreshInterval: 5000 })
  const { data: provData } = useSWR('providers', api.providers, { refreshInterval: 5000 })
  const { data: repData } = useSWR('reputation', api.reputation, { refreshInterval: 10000 })
  const { data: traceData, error: traceError } = useSWR(user ? ['traces', user.user_id, user.is_admin] : null, api.traces, { refreshInterval: 5000 })
  const { data: health } = useSWR('health', api.health, { refreshInterval: 10000 })

  const providers = provData?.providers || []
  const traces = traceData?.traces || []
  const reputation = repData?.reputation || []

  // Compute real stats
  const totalSlots = providers.reduce((s: number, p: any) => s + p.max_concurrent, 0)
  const usedSlots = providers.reduce((s: number, p: any) => s + p.active_requests, 0)
  const encryptedCount = providers.filter((p: any) => p.encrypted).length
  const hardenedCount = providers.filter((p: any) => p.trust_level === 'hardened' || p.trust_level === 'confidential').length

  // A match is not necessarily a completed response; do not infer a success rate.
  const routedTraces = traces.filter((t: any) => ['completed', 'matched', 'matched_from_queue'].includes(t.status))

  // Recent activity (latest 30 traces)
  // The API returns newest first. Preserve that order when taking the window.
  const recentTraces = traces
  const outcomes = traces.map(t => requestOutcome(t.status))
  const outcomeCounts = [
    { label: 'Completed', group: 'completed', color: UI.success },
    { label: 'Routed · completion unconfirmed', group: 'routed', color: UI.warning },
    { label: 'Rejected', group: 'rejected', color: UI.danger },
    { label: 'Other', group: 'other', color: UI.muted },
  ].map(item => ({ ...item, count: outcomes.filter(outcome => outcome.group === item.group).length }))

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
    match: UI.success, billing: UI.accent, provider_connect: UI.info,
    provider_disconnect: UI.danger, attestation: UI.info,
  }

  return (
    <div className="space-y-6">
      <NetworkGlobe />
      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Providers online', value: stats?.providers_online ?? providers.length, color: UI.text },
          { label: 'Models advertised', value: stats?.models_available ?? health?.models?.length ?? 0, color: UI.text },
          { label: 'Recent routed traces', value: traces.length > 0 ? String(routedTraces.length) : '—', color: UI.text },
          { label: 'Exchange spend · all time (simulated)', value: stats ? formatUsd(stats.total_volume_usd) : '—', color: UI.accent },
        ].map(s => (
          <div key={s.label} className="bg-ui-surface rounded-2xl border border-ui-border px-5 py-4">
            <div className="text-2xl font-bold tracking-tight" style={{ color: s.color }}>{s.value}</div>
            <div className="text-[11px] mt-0.5" style={{ color: UI.muted }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Two-column: Health + Transparency */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Network health */}
        <div className="bg-ui-surface rounded-2xl border border-ui-border p-6">
          <div className="text-[10px] uppercase tracking-wider font-medium mb-1" style={{ color: UI.accent }}>
            Network Health
          </div>
          <h2 className="text-lg font-bold mb-4" style={{ color: UI.text }}>Request outcomes</h2>

          <p className="text-xs text-ui-muted mb-3">
            {user?.is_admin ? 'Exchange' : 'Your account'} · latest {traces.length} recorded requests, newest first.
            Retained for up to 7 days, with a 10,000-request exchange-wide limit. Counts cover this list.
          </p>
          <div className="flex flex-wrap gap-x-5 gap-y-2 mb-4">
            {outcomeCounts.filter(item => item.count > 0).map(item => (
              <div key={item.group} className="flex items-center gap-2 text-sm">
                <span style={{ color: item.color }}>{item.label}</span>
                <span className="font-semibold text-ui-text">{item.count}</span>
              </div>
            ))}
          </div>

          {recentTraces.length > 0 ? (
            <ol className="space-y-2" aria-label="Recent requests, newest first">
              {recentTraces.map(t => {
                const outcome = requestOutcome(t.status)
                return (
                  <li key={t.request_id}>
                    <Link to={`/trace?id=${encodeURIComponent(t.request_id)}`}
                      className="block rounded-lg border border-ui-border px-3 py-3 text-xs hover:bg-ui-hover">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <span className="min-w-0 break-words font-medium text-ui-text">{t.model || 'Unspecified model'}</span>
                        <span style={{ color: UI[outcome.tone] }}>{outcome.label}</span>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-ui-muted">
                        <span className="font-mono">{t.request_id.slice(0, 8)}</span>
                        <time dateTime={new Date(t.timestamp * 1000).toISOString()}>
                          {new Date(t.timestamp * 1000).toLocaleString()}
                        </time>
                      </div>
                      {t.reason && <p className="mt-2 text-ui-body line-clamp-2" title={t.reason}>{t.reason}</p>}
                    </Link>
                  </li>
                )
              })}
            </ol>
          ) : (
            <div className="text-xs text-center py-8 text-ui-muted">{traceError ? 'Request history unavailable. Try again later.' : !user ? 'Sign in to see your request history.' : !traceData ? 'Loading request history…' : 'No recorded requests in this window.'}</div>
          )}

          {/* Fleet capacity */}
          <div className="mt-4 pt-4 flex items-center gap-4 text-xs" style={{ borderTop: "1px solid var(--ui-border)", color: UI.muted }}>
            <span>Capacity: <span className="font-semibold" style={{ color: UI.text }}>{usedSlots}/{totalSlots}</span> slots</span>
            {encryptedCount > 0 && <span><span className="font-semibold" style={{ color: UI.info }}>{encryptedCount}</span> provider keys</span>}
            {hardenedCount > 0 && <span><span className="font-semibold" style={{ color: UI.accent }}>{hardenedCount}</span> Hardened+</span>}
          </div>
        </div>

        {/* Only observed network status, not guessed software versions. */}
        <div className="bg-ui-surface rounded-2xl border border-ui-border p-6">
          <div className="text-[10px] uppercase tracking-wider font-medium mb-1" style={{ color: UI.accent }}>
            Network status
          </div>
          <h2 className="text-lg font-bold mb-4" style={{ color: UI.text }}>What is connected</h2>

          <div className="space-y-3">
            {[
              { component: 'Coordinator', status: health?.status === 'ok' ? 'Online' : 'Unknown', ok: health?.status === 'ok' },
              { component: 'Provider connections', status: providers.length > 0 ? `${providers.length} online` : 'None reported', ok: providers.length > 0 },
              { component: 'Billing metrics', status: stats?.total_requests != null ? 'Available' : 'Unknown', ok: stats?.total_requests != null },
            ].map(c => (
              <div key={c.component} className="flex items-center justify-between py-2 border-b border-ui-border last:border-0">
                <span className="text-sm" style={{ color: UI.text }}>{c.component}</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono" style={{ color: UI.muted }}>{c.status}</span>
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                    style={{ background: c.ok ? UI.successSurface : UI.surfaceMuted, color: c.ok ? UI.success : UI.muted }}>
                    {c.ok ? 'observed' : 'unknown'}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Trust level distribution */}
          {providers.length > 0 && (
            <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--ui-border)" }}>
              <div className="text-[10px] uppercase tracking-wider font-medium mb-2" style={{ color: UI.muted }}>
                Provider-reported trust levels
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
        <div className="bg-ui-surface rounded-2xl border border-ui-border p-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-[10px] uppercase tracking-wider font-medium" style={{ color: UI.accent }}>Live Feed</div>
              <div className="text-xs mt-0.5" style={{ color: UI.muted }}>Real-time exchange events</div>
            </div>
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: UI.success }} />
              <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: UI.success }} />
            </span>
          </div>
          <div ref={feedRef} className="h-48 overflow-y-auto text-[11px] space-y-0.5 font-mono">
            {events.length > 0 ? events.map((ev, i) => (
              <div key={i} className="flex gap-2 py-0.5" style={{ color: UI.muted }}>
                <span className="shrink-0" style={{ color: UI.muted }}>{new Date(ev.timestamp * 1000).toLocaleTimeString()}</span>
                <span style={{ color: eventColors[ev.type] || UI.muted }}>{ev.type}</span>
                {ev.provider && <span className="truncate">{ev.provider}</span>}
                {ev.cost_usd != null && <span style={{ color: UI.accent }}>{formatUsd(ev.cost_usd)}</span>}
              </div>
            )) : (
              <div className="text-xs text-center py-12 font-sans" style={{ color: UI.muted }}>
                Waiting for activity...
              </div>
            )}
          </div>
        </div>

        {/* Provider reputation */}
        <div className="bg-ui-surface rounded-2xl border border-ui-border p-6">
          <div className="text-[10px] uppercase tracking-wider font-medium mb-1" style={{ color: UI.accent }}>
            Provider Reputation
          </div>
          <div className="text-xs mb-4" style={{ color: UI.muted }}>EMA-based scoring from observed request outcomes</div>

          {reputation.length > 0 ? (
            <div className="space-y-3">
              {reputation.slice(0, 6).map((r: any) => {
                const prov = providers.find((p: any) => p.id === r.provider_id)
                return (
                  <div key={r.provider_id} className="flex items-center gap-3">
                    <span className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: r.is_degraded ? UI.danger : r.score > 0.8 ? UI.success : UI.accent }} />
                    <span className="text-xs truncate flex-1" style={{ color: UI.text }}>
                      {prov?.name || r.provider_id.slice(0, 12)}
                    </span>
                    <div className="w-20 h-1.5 rounded-full overflow-hidden" style={{ background: UI.track }}>
                      <div className="h-full rounded-full" style={{
                        width: `${r.score * 100}%`,
                        background: r.score > 0.8 ? UI.success : r.score > 0.5 ? UI.accent : UI.danger,
                      }} />
                    </div>
                    <span className="text-[10px] font-mono w-8 text-right" style={{ color: UI.muted }}>
                      {(r.score * 100).toFixed(0)}%
                    </span>
                    <span className="text-[10px]" style={{ color: UI.muted }}>
                      {r.total_requests} req
                    </span>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-xs text-center py-8" style={{ color: UI.muted }}>
              No reputation data yet. Reputation builds from request outcomes.
            </div>
          )}
        </div>
      </div>

      {/* Connected providers */}
      {providers.length > 0 && (
        <div className="bg-ui-surface rounded-2xl border border-ui-border p-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-[10px] uppercase tracking-wider font-medium" style={{ color: UI.accent }}>Connected Providers</div>
            </div>
            <Link to="/providers" className="text-[10px] font-medium" style={{ color: UI.accent }}>View all</Link>
          </div>
          <div className="space-y-2">
            {providers.slice(0, 5).map((p: any) => {
              const tc = TRUST_COLORS[p.trust_level] || TRUST_COLORS.open
              return (
                <div key={p.id} className="flex items-center justify-between py-2 border-b border-ui-border last:border-0">
                  <div className="flex items-center gap-3">
                    <span className="w-2 h-2 rounded-full" style={{ background: UI.success }} />
                    <span className="text-sm font-medium" style={{ color: UI.text }}>{p.name || p.id.slice(0, 12)}</span>
                    <span className="text-xs" style={{ color: UI.muted }}>{p.hardware}</span>
                    <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full" style={{ background: tc.bg, color: tc.text }}>
                      {tc.label}
                    </span>
                    {p.encrypted && <span className="text-[8px] px-1 rounded" style={{ background: UI.infoSurface, color: UI.info }}>Key</span>}
                  </div>
                  <div className="flex items-center gap-4 text-xs">
                    <span style={{ color: UI.info }}>{p.measured_tps > 0 ? `${p.measured_tps.toFixed(0)} tok/s` : '—'}</span>
                    <span style={{ color: UI.accent }}>${p.price_output.toFixed(2)}/M</span>
                    <span style={{ color: UI.muted }}>{p.active_requests}/{p.max_concurrent}</span>
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
