import { useState } from 'react'
import useSWR from 'swr'
import { Link } from 'react-router-dom'
import { api, Provider, ReputationEntry, TPSEntry } from '../lib/api'

// ─── Brand palette ───────────────────────────────────────────
const C = {
  red: '#B7443B',
  gold: '#C49A45',
  green: '#3F8055',
  turquoise: '#4D9A91',
  deepBlue: '#315B72',
  blueBlack: '#292F35',
  orange: '#D77A2F',
}

const TRUST_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  open:         { bg: '#f3f3f3', text: '#999',     label: 'Open' },
  contained:    { bg: '#eef3f7', text: C.deepBlue, label: 'Contained' },
  hardened:     { bg: '#fdf6ec', text: C.gold,     label: 'Hardened+' },
  confidential: { bg: '#edf7f1', text: C.green,    label: 'Confidential' },
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`
}

function formatCtx(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1024) return `${Math.round(n / 1024)}k`
  return `${n}`
}

// ─── Expanded Provider Evidence ──────────────────────────────

function ProviderEvidence({ p, reputation, tps }: { p: Provider; reputation?: ReputationEntry; tps?: TPSEntry }) {
  const tc = TRUST_COLORS[p.trust_level] || TRUST_COLORS.open
  const caps = p.model_capabilities

  return (
    <div className="px-5 py-4 border-t" style={{ background: '#fafaf8', borderColor: '#f0ede6' }}>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 text-xs">
        {/* Pricing */}
        <div>
          <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: '#aaa' }}>Pricing / Mtok</div>
          <div className="space-y-1.5">
            <div className="flex justify-between">
              <span style={{ color: C.deepBlue }}>Input</span>
              <span className="font-semibold" style={{ color: C.blueBlack }}>${p.price_input.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: C.turquoise }}>Cache</span>
              <span className="font-semibold" style={{ color: (p.price_cache || 0) > 0 ? C.blueBlack : '#ccc' }}>
                {(p.price_cache || 0) > 0 ? `$${(p.price_cache || 0).toFixed(2)}` : '—'}
              </span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: C.gold }}>Output</span>
              <span className="font-semibold" style={{ color: C.blueBlack }}>${p.price_output.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Security / Trust */}
        <div>
          <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: '#aaa' }}>Security</div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: tc.text }} />
              <span>{tc.label} runtime</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: p.encrypted ? C.deepBlue : '#ddd' }} />
              <span>{p.encrypted ? 'E2E encrypted' : 'No E2E'}</span>
            </div>
            <div className="text-[10px] mt-1" style={{ color: '#aaa' }}>
              Uptime: {formatUptime(p.uptime_seconds)}
            </div>
          </div>
        </div>

        {/* Hardware + Capabilities */}
        <div>
          <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: '#aaa' }}>Hardware & Model</div>
          <div className="space-y-1">
            <div style={{ color: C.blueBlack }}>{p.hardware || 'Unknown'}</div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {p.models.map(m => (
                <span key={m} className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ background: '#f5f3f0', color: C.blueBlack }}>
                  {m}
                </span>
              ))}
            </div>
            {caps && (
              <div className="flex items-center gap-1 mt-1 flex-wrap">
                {caps.context_length > 0 && (
                  <span className="text-[8px] font-medium px-1 py-0.5 rounded" style={{ background: '#f0f4f8', color: '#4a6fa5' }}>
                    {formatCtx(caps.context_length)} ctx
                  </span>
                )}
                {caps.supports_tool_calling && (
                  <span className="text-[8px] font-medium px-1 py-0.5 rounded" style={{ background: '#eef7f0', color: '#2d7d46' }}>tools</span>
                )}
                {caps.supports_vision && (
                  <span className="text-[8px] font-medium px-1 py-0.5 rounded" style={{ background: '#f3eef7', color: '#6b46a5' }}>vision</span>
                )}
                {caps.model_format && (
                  <span className="text-[8px] font-medium px-1 py-0.5 rounded" style={{ background: '#f5f3f0', color: '#8a7d60' }}>
                    {caps.model_format.toUpperCase()}
                  </span>
                )}
                {caps.architecture && (
                  <span className="text-[8px] font-medium px-1 py-0.5 rounded" style={{ background: '#f5f3f0', color: '#8a7d60' }}>
                    {caps.architecture}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Performance + Reputation */}
        <div>
          <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: '#aaa' }}>Performance</div>
          <div className="space-y-1.5">
            <div>
              <span style={{ color: C.turquoise }}>
                {p.measured_tps > 0 ? `${p.measured_tps.toFixed(1)} tok/s` : '—'}
              </span>
              <span style={{ color: '#bbb' }}> observed</span>
            </div>
            {tps && tps.total_requests > 0 && (
              <div>
                <span style={{ color: C.turquoise }}>{tps.observed_tps_ema.toFixed(1)}</span>
                <span style={{ color: '#bbb' }}> EMA over {tps.total_requests} req</span>
              </div>
            )}
            <div>
              Load:{' '}
              <span style={{ color: p.load > 0.8 ? C.red : p.load > 0.5 ? C.orange : C.green }}>
                {(p.load * 100).toFixed(0)}%
              </span>
              <span style={{ color: '#bbb' }}> ({p.active_requests}/{p.max_concurrent} slots)</span>
            </div>
            {reputation && (
              <div className="mt-1.5 pt-1.5" style={{ borderTop: '1px solid #e8e5de' }}>
                <div className="flex items-center justify-between">
                  <span>Reputation</span>
                  <span className="font-semibold" style={{
                    color: reputation.score > 0.8 ? C.green : reputation.score > 0.5 ? C.gold : C.red
                  }}>
                    {(reputation.score * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="flex items-center justify-between mt-0.5">
                  <span style={{ color: '#bbb' }}>Success rate</span>
                  <span>{(reputation.success_rate_ema * 100).toFixed(1)}%</span>
                </div>
                <div className="flex items-center justify-between mt-0.5">
                  <span style={{ color: '#bbb' }}>Requests</span>
                  <span>{reputation.total_successes} ok / {reputation.total_failures} fail</span>
                </div>
                {reputation.is_degraded && (
                  <div className="mt-1 text-[10px] font-medium px-2 py-0.5 rounded-full inline-block"
                    style={{ background: '#fdf5f4', color: C.red }}>
                    Degraded
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────

export function Providers() {
  const { data: provData } = useSWR('providers', api.providers, { refreshInterval: 5000 })
  const { data: stats } = useSWR('stats', api.stats, { refreshInterval: 10000 })
  const { data: repData } = useSWR('reputation', api.reputation, { refreshInterval: 10000 })
  const { data: tpsData } = useSWR('tps', api.tps, { refreshInterval: 10000 })

  const [expandedId, setExpandedId] = useState<string | null>(null)

  const providers = provData?.providers || []
  const repMap = new Map((repData?.reputation || []).map(r => [r.provider_id, r]))
  const tpsMap = new Map((tpsData?.tps_stats || []).map(t => [t.provider_id, t]))

  const hardenedCount = providers.filter(p => p.trust_level === 'hardened' || p.trust_level === 'confidential').length
  const encryptedCount = providers.filter(p => p.encrypted).length
  const modelCount = stats?.models_available || [...new Set(providers.flatMap(p => p.models))].length
  const totalSlots = providers.reduce((s, p) => s + p.max_concurrent, 0)
  const usedSlots = providers.reduce((s, p) => s + p.active_requests, 0)
  const avgTps = providers.length > 0 ? providers.reduce((s, p) => s + p.measured_tps, 0) / providers.length : 0
  const cheapestOut = providers.length > 0 ? Math.min(...providers.map(p => p.price_output).filter(p => p > 0)) : 0

  return (
    <div className="space-y-6">
      {/* Stat cards + CTA */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex-1 grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: 'providers online', value: providers.length, color: C.green },
            { label: 'Hardened+', value: hardenedCount, color: C.gold },
            { label: 'models live', value: modelCount, color: C.blueBlack },
            { label: 'lowest output', value: cheapestOut > 0 ? `$${cheapestOut.toFixed(2)}` : '—', color: C.gold },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-2xl border border-gray-200/40 px-5 py-4">
              <div className="text-2xl font-bold tracking-tight" style={{ color: s.color }}>{s.value}</div>
              <div className="text-[11px] mt-0.5" style={{ color: '#999' }}>{s.label}</div>
            </div>
          ))}
        </div>
        <Link to="/providers" className="px-5 py-3 rounded-xl text-sm font-medium shrink-0" style={{ background: C.blueBlack, color: '#fff' }}>
          Run a provider
        </Link>
      </div>

      {/* Fleet summary */}
      {providers.length > 0 && (
        <div className="flex items-center gap-4 text-xs flex-wrap" style={{ color: '#888' }}>
          <span>Capacity: <span className="font-semibold" style={{ color: C.blueBlack }}>{usedSlots}/{totalSlots}</span> slots</span>
          {encryptedCount > 0 && <span><span className="font-semibold" style={{ color: C.deepBlue }}>{encryptedCount}</span> E2E</span>}
          {avgTps > 0 && <span>Avg: <span className="font-semibold" style={{ color: C.turquoise }}>{avgTps.toFixed(1)}</span> tok/s</span>}
        </div>
      )}

      {/* Provider table */}
      <div className="bg-white rounded-2xl border border-gray-200/40 overflow-hidden">
        <div className="text-[10px] uppercase tracking-wider font-medium px-5 pt-4 pb-2" style={{ color: C.gold }}>
          Available Providers
        </div>

        {/* Table header */}
        <div className="grid grid-cols-12 gap-2 px-5 py-2 text-[9px] uppercase tracking-wider border-b border-gray-100" style={{ color: '#bbb' }}>
          <div className="col-span-2">Provider</div>
          <div className="col-span-2">Model</div>
          <div className="col-span-1 text-right">In</div>
          <div className="col-span-1 text-right">Cache</div>
          <div className="col-span-1 text-right">Out</div>
          <div className="col-span-1 text-right">Speed</div>
          <div className="col-span-1 text-center">Load</div>
          <div className="col-span-1">Trust</div>
          <div className="col-span-2 text-right">Actions</div>
        </div>

        {providers.length > 0 ? providers.map((p: Provider) => {
          const tc = TRUST_COLORS[p.trust_level] || TRUST_COLORS.open
          const modelName = p.models?.[0] || '—'
          const isExpanded = expandedId === p.id
          const rep = repMap.get(p.id)
          const tps = tpsMap.get(p.id)

          return (
            <div key={p.id}>
              <div
                className="grid grid-cols-12 gap-2 px-5 py-3.5 items-center border-b border-gray-50 cursor-pointer transition-colors hover:bg-gray-50/50"
                onClick={() => setExpandedId(isExpanded ? null : p.id)}
              >
                {/* Name + hardware + badges */}
                <div className="col-span-2 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: C.green }} />
                    <span className="text-sm font-semibold truncate" style={{ color: C.blueBlack }}>
                      {p.name || p.id.slice(0, 12)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 mt-0.5 ml-3.5">
                    <span className="text-[10px] truncate" style={{ color: '#999' }}>{p.hardware || 'Unknown'}</span>
                    {p.encrypted && <span className="text-[7px] px-1 rounded" style={{ background: '#eef3f7', color: C.deepBlue }}>E2E</span>}
                  </div>
                </div>

                {/* Model */}
                <div className="col-span-2 min-w-0">
                  <span className="text-sm truncate block" style={{ color: C.blueBlack }}>{modelName}</span>
                </div>

                {/* Three-tier pricing */}
                <div className="col-span-1 text-right text-xs" style={{ color: C.deepBlue }}>${p.price_input.toFixed(2)}</div>
                <div className="col-span-1 text-right text-xs" style={{ color: (p.price_cache || 0) > 0 ? C.turquoise : '#ddd' }}>
                  {(p.price_cache || 0) > 0 ? `$${(p.price_cache || 0).toFixed(2)}` : '—'}
                </div>
                <div className="col-span-1 text-right text-sm font-semibold" style={{ color: C.gold }}>${p.price_output.toFixed(2)}</div>

                {/* Speed */}
                <div className="col-span-1 text-right text-sm" style={{ color: C.turquoise }}>
                  {p.measured_tps > 0 ? `${p.measured_tps.toFixed(0)}` : '—'}
                </div>

                {/* Load */}
                <div className="col-span-1 text-center">
                  <div className="w-full h-1.5 rounded-full overflow-hidden mx-auto" style={{ background: '#f0f0f0', maxWidth: '36px' }}>
                    <div className="h-full rounded-full" style={{
                      width: `${Math.max(5, p.load * 100)}%`,
                      background: p.load > 0.8 ? C.red : p.load > 0.5 ? C.orange : C.green,
                    }} />
                  </div>
                </div>

                {/* Trust */}
                <div className="col-span-1">
                  <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full" style={{ background: tc.bg, color: tc.text }}>
                    {tc.label}
                  </span>
                </div>

                {/* Actions */}
                <div className="col-span-2 flex items-center justify-end gap-1.5">
                  <button
                    className="text-[10px] font-medium px-2.5 py-1 rounded-lg border"
                    style={{ color: '#888', borderColor: '#ddd' }}
                    onClick={e => { e.stopPropagation(); setExpandedId(isExpanded ? null : p.id) }}
                  >
                    {isExpanded ? 'Hide' : 'View evidence'}
                  </button>
                  <Link
                    to={`/chat?model=${encodeURIComponent(modelName)}`}
                    className="text-[10px] font-medium px-2.5 py-1 rounded-lg"
                    style={{ background: C.blueBlack, color: '#fff' }}
                    onClick={e => e.stopPropagation()}
                  >
                    Use
                  </Link>
                  <svg className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="#aaa" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>

              {/* Expanded evidence */}
              {isExpanded && <ProviderEvidence p={p} reputation={rep} tps={tps} />}
            </div>
          )
        }) : (
          <div className="px-5 py-16 text-center text-sm" style={{ color: '#ccc' }}>
            No providers connected.
            <div className="mt-4 text-xs font-mono px-4 py-3 rounded-xl inline-block" style={{ background: '#f5f3f0', color: '#666' }}>
              python -m ocip_agent.agent --model your-model.gguf
            </div>
          </div>
        )}
      </div>

      {/* Trust explanation footer */}
      <div className="bg-white rounded-2xl border border-gray-200/40 px-5 py-4">
        <div className="text-sm font-semibold" style={{ color: C.blueBlack }}>
          Provider trust is evidence-based
        </div>
        <div className="text-xs mt-1" style={{ color: '#888' }}>
          See binary hash, trust level, recent success rate and observed throughput before routing.
        </div>
      </div>
    </div>
  )
}
