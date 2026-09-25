import { useState } from 'react'
import useSWR from 'swr'
import { api, Provider, ReputationEntry, TPSEntry } from '../lib/api'

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

const TRUST: Record<string, { bg: string; text: string; label: string; full: string; ring: string }> = {
  open:         { bg: '#f3f3f3', text: '#999',     label: 'L0', full: 'Open',         ring: '#e5e5e5' },
  contained:    { bg: '#eef3f7', text: C.deepBlue, label: 'L1', full: 'Contained',    ring: '#c5d8e8' },
  hardened:     { bg: '#fdf6ec', text: C.gold,     label: 'L2', full: 'Hardened',      ring: '#e8d5a8' },
  confidential: { bg: '#edf7f1', text: C.green,    label: 'L3', full: 'Confidential',  ring: '#b5d8c2' },
}

// ─── Helpers ─────────────────────────────────────────────────

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  return `${days}d ${hours}h`
}

function formatCtx(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1024) return `${Math.round(n / 1024)}k`
  return `${n}`
}

function Pill({ children, bg, color }: { children: React.ReactNode; bg: string; color: string }) {
  return (
    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1" style={{ background: bg, color }}>
      {children}
    </span>
  )
}

// ─── Stat Card ───────────────────────────────────────────────

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-5">
      <div className="text-[10px] uppercase tracking-wider" style={{ color: '#aaa' }}>{label}</div>
      <div className="text-2xl font-bold mt-1" style={{ color: color || C.blueBlack }}>{value}</div>
      {sub && <div className="text-[11px] mt-0.5" style={{ color: '#aaa' }}>{sub}</div>}
    </div>
  )
}

// ─── Load Bar ────────────────────────────────────────────────

function LoadBar({ active, max }: { active: number; max: number }) {
  const pct = max > 0 ? (active / max) * 100 : 0
  const barColor = pct > 80 ? C.red : pct > 50 ? C.orange : C.green
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: '#f0f0f0' }}>
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(3, pct)}%`, background: barColor }} />
      </div>
      <span className="text-[10px] font-medium tabular-nums" style={{ color: barColor }}>{active}/{max}</span>
    </div>
  )
}

// ─── Reputation Ring ─────────────────────────────────────────

function ReputationRing({ score, size = 44 }: { score: number; size?: number }) {
  const r = (size - 6) / 2
  const circumference = 2 * Math.PI * r
  const offset = circumference * (1 - Math.max(0, Math.min(1, score)))
  const color = score >= 0.9 ? C.green : score >= 0.7 ? C.gold : score >= 0.5 ? C.orange : C.red

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f0f0f0" strokeWidth={3} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={3}
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
          className="transition-all duration-700" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[10px] font-bold tabular-nums" style={{ color }}>{(score * 100).toFixed(0)}</span>
      </div>
    </div>
  )
}

// ─── Provider Card ───────────────────────────────────────────

function ProviderCard({ provider, reputation, tps }: { provider: Provider; reputation?: ReputationEntry; tps?: TPSEntry }) {
  const [expanded, setExpanded] = useState(false)
  const tc = TRUST[provider.trust_level] || TRUST.open
  const caps = provider.model_capabilities
  const uptimeStr = formatUptime(provider.uptime_seconds)

  return (
    <div
      className="bg-white rounded-2xl border shadow-sm hover:shadow-md transition-all cursor-pointer overflow-hidden"
      style={{ borderColor: expanded ? tc.ring : '#e5e7eb40' }}
      onClick={() => setExpanded(!expanded)}
    >
      {/* ── Header Row ── */}
      <div className="p-5">
        <div className="flex items-start gap-4">
          {/* Left: status dot + name + id */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: C.green }} />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ background: C.green }} />
              </span>
              <h3 className="font-bold text-base truncate" style={{ color: C.blueBlack }}>
                {provider.name || provider.id.slice(0, 16)}
              </h3>
              {provider.encrypted && (
                <Pill bg="#eef3f7" color={C.deepBlue}>🔐 E2E</Pill>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[10px] font-mono" style={{ color: '#bbb' }}>{provider.id}</span>
              <span className="text-[10px]" style={{ color: '#ccc' }}>·</span>
              <span className="text-[10px]" style={{ color: '#aaa' }}>{uptimeStr} uptime</span>
            </div>
          </div>

          {/* Right: trust badge + reputation ring */}
          <div className="flex items-center gap-3 shrink-0">
            {reputation && <ReputationRing score={reputation.score} />}
            <span className="text-[10px] font-bold px-2.5 py-1 rounded-lg" style={{ background: tc.bg, color: tc.text }}>
              {tc.full}
            </span>
          </div>
        </div>

        {/* ── Capability + Model Row ── */}
        <div className="flex items-center gap-1.5 mt-3 flex-wrap">
          {provider.models.map(m => (
            <span key={m} className="text-[11px] font-medium px-2.5 py-0.5 rounded-lg truncate max-w-[200px]"
              style={{ background: '#f5f3f0', color: C.blueBlack }}>
              {m}
            </span>
          ))}
          {caps?.context_length ? (
            <Pill bg="#f0f4f8" color="#4a6fa5">⬚ {formatCtx(caps.context_length)}</Pill>
          ) : null}
          {caps?.supports_tool_calling && <Pill bg="#eef7f0" color="#2d7d46">🔧 Tools</Pill>}
          {caps?.supports_vision && <Pill bg="#f3eef7" color="#6b46a5">👁 Vision</Pill>}
          {caps?.model_format && <Pill bg="#f5f3f0" color="#8a7d60">{caps.model_format.toUpperCase()}</Pill>}
        </div>

        {/* ── Stats Grid ── */}
        <div className="grid grid-cols-4 gap-4 mt-4">
          {/* Price */}
          <div>
            <div className="text-[10px] uppercase tracking-wider" style={{ color: '#aaa' }}>Pricing</div>
            <div className="flex items-center gap-2 mt-1 text-[11px]">
              <span><span style={{ color: C.deepBlue }}>in</span> <span className="font-semibold" style={{ color: C.blueBlack }}>${provider.price_input.toFixed(2)}</span></span>
              <span><span style={{ color: C.turquoise }}>cache</span> <span className="font-semibold" style={{ color: C.blueBlack }}>{(provider.price_cache || 0) > 0 ? `$${(provider.price_cache || 0).toFixed(2)}` : '—'}</span></span>
              <span><span style={{ color: C.gold }}>out</span> <span className="font-semibold" style={{ color: C.blueBlack }}>${provider.price_output.toFixed(2)}</span></span>
            </div>
            <div className="text-[9px] mt-0.5" style={{ color: '#bbb' }}>$/Mtok</div>
          </div>

          {/* Speed */}
          <div>
            <div className="text-[10px] uppercase tracking-wider" style={{ color: '#aaa' }}>Speed</div>
            <div className="text-lg font-bold mt-0.5" style={{ color: C.turquoise }}>
              {provider.measured_tps > 0 ? provider.measured_tps.toFixed(1) : '—'}
            </div>
            <div className="text-[10px]" style={{ color: '#bbb' }}>tok/s</div>
          </div>

          {/* Hardware */}
          <div>
            <div className="text-[10px] uppercase tracking-wider" style={{ color: '#aaa' }}>Hardware</div>
            <div className="text-xs font-semibold mt-1.5 truncate" style={{ color: C.blueBlack }}>
              {provider.hardware || 'Unknown'}
            </div>
          </div>

          {/* Load */}
          <div>
            <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: '#aaa' }}>Load</div>
            <LoadBar active={provider.active_requests} max={provider.max_concurrent} />
          </div>
        </div>
      </div>

      {/* ── Expanded Details ── */}
      {expanded && (
        <div className="border-t px-5 py-4 space-y-4" style={{ borderColor: '#f0f0f0', background: '#fafaf8' }}>
          {/* Three-tier pricing */}
          <div>
            <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: '#aaa' }}>Pricing per Mtok</div>
            <div className="flex gap-3">
              {[
                { label: 'Input', value: provider.price_input, color: C.deepBlue },
                { label: 'Cache', value: provider.price_cache || 0, color: C.turquoise },
                { label: 'Output', value: provider.price_output, color: C.gold },
              ].map(p => (
                <div key={p.label} className="flex-1 bg-white rounded-xl border border-gray-100 px-3 py-2.5 text-center">
                  <div className="text-[9px] uppercase tracking-wider" style={{ color: '#aaa' }}>{p.label}</div>
                  <div className="text-base font-bold mt-0.5" style={{ color: p.color }}>
                    {p.value > 0 ? `$${p.value.toFixed(2)}` : '—'}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Architecture + TPS details */}
          <div className="grid grid-cols-2 gap-4">
            {caps?.architecture && (
              <div>
                <div className="text-[10px] uppercase tracking-wider" style={{ color: '#aaa' }}>Architecture</div>
                <div className="text-xs font-medium mt-1" style={{ color: C.blueBlack }}>{caps.architecture}</div>
              </div>
            )}
            {tps && tps.total_requests > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider" style={{ color: '#aaa' }}>TPS (observed)</div>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-xs font-semibold" style={{ color: C.turquoise }}>{tps.observed_tps_ema.toFixed(1)}</span>
                  <span className="text-[10px]" style={{ color: '#aaa' }}>EMA over {tps.total_requests} req</span>
                </div>
              </div>
            )}
          </div>

          {/* Reputation detail */}
          {reputation && (
            <div>
              <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: '#aaa' }}>Reputation</div>
              <div className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <ReputationRing score={reputation.score} size={36} />
                  <div>
                    <div className="text-xs font-semibold" style={{ color: reputation.is_degraded ? C.red : C.green }}>
                      {reputation.is_degraded ? 'Degraded' : 'Healthy'}
                    </div>
                    <div className="text-[10px]" style={{ color: '#aaa' }}>
                      {reputation.total_successes} ok / {reputation.total_failures} fail
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-bold tabular-nums" style={{ color: C.blueBlack }}>
                    {(reputation.success_rate_ema * 100).toFixed(1)}%
                  </div>
                  <div className="text-[10px]" style={{ color: '#aaa' }}>success rate</div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Empty State ─────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="bg-white rounded-2xl border border-gray-200/60 p-16 text-center">
      <div className="text-5xl mb-4">📡</div>
      <div className="text-lg font-semibold" style={{ color: C.blueBlack }}>No providers connected</div>
      <div className="text-sm mt-2 max-w-md mx-auto" style={{ color: '#aaa' }}>
        Start serving inference on the exchange. Earn per-token for every request you process.
      </div>
      <div className="mt-6 inline-block text-left">
        <div className="text-xs font-mono px-5 py-4 rounded-xl space-y-1" style={{ background: '#f5f3f0', color: '#666' }}>
          <div><span style={{ color: '#bbb' }}>$</span> python -m ocip_agent.agent --model your-model.gguf</div>
        </div>
      </div>
    </div>
  )
}

// ─── Become a Provider CTA ───────────────────────────────────

function ProviderCTA() {
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: `linear-gradient(135deg, ${C.blueBlack}, ${C.deepBlue})` }}>
      <div className="p-6">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-lg">⚡</span>
          <span className="font-bold text-white">Become a provider</span>
        </div>
        <p className="text-sm mb-4" style={{ color: '#8aa8be' }}>
          Earn per-token revenue by serving AI inference on your hardware. Apple Silicon, NVIDIA, or AMD.
        </p>
        <div className="bg-black/20 rounded-xl p-4 font-mono text-xs space-y-1.5" style={{ color: '#a8c8dc' }}>
          <div><span style={{ color: '#6a8a9e' }}>$</span> python -m ocip_agent.agent \</div>
          <div className="pl-6">--model ~/.ollama/models/llama-3.1-8b.gguf \</div>
          <div className="pl-6">--name "my-node" --trust hardened</div>
        </div>
      </div>
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────

export function Providers() {
  const { data: provData } = useSWR('providers', api.providers, { refreshInterval: 5000 })
  const { data: repData } = useSWR('reputation', api.reputation, { refreshInterval: 10000 })
  const { data: tpsData } = useSWR('tps', api.tps, { refreshInterval: 10000 })
  const { data: stats } = useSWR('stats', api.stats, { refreshInterval: 10000 })

  const providers = provData?.providers || []
  const repMap = new Map((repData?.reputation || []).map(r => [r.provider_id, r]))
  const tpsMap = new Map((tpsData?.tps_stats || []).map(t => [t.provider_id, t]))

  // Aggregate stats
  const totalSlots = providers.reduce((s, p) => s + p.max_concurrent, 0)
  const usedSlots = providers.reduce((s, p) => s + p.active_requests, 0)
  const encryptedCount = providers.filter(p => p.encrypted).length
  const avgTps = providers.length > 0
    ? providers.reduce((s, p) => s + p.measured_tps, 0) / providers.length
    : 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold" style={{ color: C.blueBlack }}>Providers</h1>
          {providers.length > 0 && (
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: C.green }} />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ background: C.green }} />
            </span>
          )}
        </div>
        <p className="text-sm mt-1" style={{ color: '#aaa' }}>
          {providers.length > 0
            ? `${providers.length} node${providers.length !== 1 ? 's' : ''} serving inference on the exchange`
            : 'Nodes serving inference on the exchange'
          }
        </p>
      </div>

      {/* Fleet stats */}
      {providers.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Online" value={`${providers.length}`} sub="providers" color={C.green} />
          <StatCard label="Capacity" value={`${usedSlots}/${totalSlots}`} sub="slots in use" color={C.turquoise} />
          <StatCard label="Encrypted" value={`${encryptedCount}`} sub={`of ${providers.length}`} color={C.deepBlue} />
          <StatCard label="Avg Speed" value={avgTps > 0 ? `${avgTps.toFixed(1)}` : '—'} sub="tok/s" color={C.turquoise} />
        </div>
      )}

      {/* Provider CTA */}
      <ProviderCTA />

      {/* Provider cards */}
      {providers.length > 0 ? (
        <div className="space-y-3">
          {providers.map(p => (
            <ProviderCard key={p.id} provider={p} reputation={repMap.get(p.id)} tps={tpsMap.get(p.id)} />
          ))}
        </div>
      ) : (
        <EmptyState />
      )}
    </div>
  )
}
