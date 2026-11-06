import { useAuth } from '../lib/auth'
import { useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import useSWR from 'swr'
import { api } from '../lib/api'
import { requestOutcome } from '../lib/request-outcomes.js'
import { formatUsdPrecise, microToUsd } from '../lib/money.js'
import { requestedModelLabel, servedModelLabel } from '../lib/model-attribution.js'
import { UI, APP_TRUST_COLORS as TRUST_COLORS } from '../lib/theme'

const OUTCOME_SURFACES = {
  success: UI.successSurface,
  warning: UI.warningSurface,
  danger: UI.dangerSurface,
  muted: UI.surfaceMuted,
}

const DOT_COLORS: Record<string, string> = {
  green: UI.success, gold: UI.accent, blue: UI.info, red: UI.danger, gray: UI.muted,
}

// ─── Step component ──────────────────────────────────────────

function TraceStep({ number, label, value, detail, dot, expanded, children, onToggle }: {
  number: string; label: string; value: string; detail: string; dot: string
  expanded?: boolean; children?: React.ReactNode; onToggle?: () => void
}) {
  return (
    <div>
      <div
        className={`flex items-center gap-5 px-6 py-4 ${onToggle ? 'cursor-pointer hover:bg-ui-hover' : ''}`}
        style={{ borderTop: number !== '01' ? "1px solid var(--ui-border)" : 'none' }}
        onClick={onToggle}
      >
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
          style={{ border: "1.5px solid var(--ui-border)", color: UI.muted }}>{number}</div>
        <div className="w-24 shrink-0">
          <div className="text-[10px] uppercase tracking-wider font-medium" style={{ color: UI.muted }}>{label}</div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold" style={{ color: UI.text }}>{value}</div>
          <div className="text-xs" style={{ color: UI.muted }}>{detail}</div>
        </div>
        <div className="w-3 h-3 rounded-full shrink-0" style={{ background: DOT_COLORS[dot] || DOT_COLORS.gray }} />
        {onToggle && (
          <svg className={`w-3 h-3 transition-transform shrink-0 ${expanded ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke={UI.muted} strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </div>
      {expanded && children && (
        <div className="px-6 pb-4 ml-14" style={{ borderTop: "1px solid var(--ui-border)" }}>
          <div className="pt-3 text-xs" style={{ color: UI.muted }}>
            {children}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main ────────────────────────────────────────────────────

export function Trace() {
  const { user } = useAuth()
  const [searchParams] = useSearchParams()
  const requestId = searchParams.get('id')
  const { data: traceData } = useSWR(user ? ['traces', user.user_id, user.is_admin] : null, api.traces, { refreshInterval: 5000 })
  const { data: historyData } = useSWR(user ? ['history', user.user_id] : null, api.history, { refreshInterval: 10000 })
  const { data: exactTrace, error: traceError } = useSWR(user && requestId ? ['trace', user.user_id, user.is_admin, requestId] : null, () => api.trace(requestId!), { refreshInterval: 5000 })
  const [expandedStep, setExpandedStep] = useState<string | null>(null)

  const traces = traceData?.traces || []
  const trace = requestId
    ? exactTrace?.trace
    : traces[0] || null

  if (!trace) {
    return (
      <div className="max-w-2xl mx-auto text-center py-16">
        <div className="text-sm" style={{ color: UI.muted }}>
          {!user ? 'Sign in to inspect your requests.' : requestId ? traceError ? 'Trace unavailable or outside retained history.' : 'Loading trace…' : 'No recent requests to inspect yet.'}
        </div>
        <div className="text-xs mt-2" style={{ color: UI.muted }}>
          Send a chat request, then come back here to inspect the evidence.
        </div>
        <Link to="/chat" className="inline-block mt-4 text-sm font-medium" style={{ color: UI.accent }}>Go to Chat</Link>
      </div>
    )
  }

  const isCompleted = trace.status === 'completed'
  const outcome = requestOutcome(trace.status)
  const requestedTrust = trace.min_confidence
    ? TRUST_COLORS[trace.min_confidence]?.label || trace.min_confidence
    : 'Not recorded'
  const priceCeiling = trace.max_price === null ? 'No ceiling'
    : trace.max_price == null ? 'Not recorded' : `$${trace.max_price}/M tokens`
  const provider = trace.selected_provider || 'unknown'
  const trust = trace.selected_trust || 'unknown'
  const price = trace.selected_price
  const encrypted = trace.encrypted
  const scoring = trace.scoring || []
  const preference = trace.preference || 'balanced'

  // Cross-reference billing history for per-tier token data
  const billingTx = (historyData?.transactions || []).find(t => (t.full_request_id || t.request_id) === trace.request_id)

  // FIX: Get TPS from the SELECTED provider's scoring entry, not scoring[0]
  const selectedScoring = scoring.find((s: any) => s.selected || s.name === provider)
  const selectedTps = selectedScoring?.tps || 0
  const selectedLoad = selectedScoring?.load || 0
  const selectedScore = selectedScoring?.score || 0

  // Candidates that were NOT selected
  const alternatives = scoring.filter((s: any) => !s.selected && s.name !== provider)

  const trustLabel = TRUST_COLORS[trust]?.label || trust
  const tc = TRUST_COLORS[trust] || TRUST_COLORS.open

  const toggle = (step: string) => setExpandedStep(expandedStep === step ? null : step)

  return (
    <div className="max-w-3xl space-y-6">
      {/* Request header */}
      <div className="bg-ui-surface rounded-2xl border border-ui-border px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold font-mono" style={{ color: UI.text }}>{trace.request_id.slice(0, 8)}</h2>
            <div className="text-xs mt-0.5" style={{ color: UI.muted }}>
              {requestedModelLabel(billingTx || trace)}
              {' · '}{trace.providers_evaluated || scoring.length} provider{(trace.providers_evaluated || scoring.length) !== 1 ? 's' : ''} evaluated
              {trace.preference && ` · ${trace.preference} routing`}
            </div>
          </div>
          <span className="text-[11px] font-medium px-3 py-1 rounded-full"
            style={{ background: OUTCOME_SURFACES[outcome.tone], color: UI[outcome.tone] }}>
            {outcome.label}
          </span>
        </div>
      </div>

      <section className="rounded-2xl border border-ui-border bg-ui-surface p-5 space-y-3" aria-label="Request outcome details">
        {trace.reason && <p className="text-sm text-ui-body">{trace.reason}</p>}
        <dl className="flex flex-wrap gap-x-6 gap-y-3 text-xs">
          <div>
            <dt className="text-ui-muted">Status code</dt>
            <dd className="font-mono text-ui-text">{trace.status}</dd>
          </div>
          <div>
            <dt className="text-ui-muted">Requested trust</dt>
            <dd className="text-ui-text">{requestedTrust}</dd>
          </div>
          <div>
            <dt className="text-ui-muted">Output price ceiling</dt>
            <dd className="text-ui-text">{priceCeiling}</dd>
          </div>
          <div>
            <dt className="text-ui-muted">Time</dt>
            <dd className="text-ui-text">{new Date(trace.timestamp * 1000).toLocaleString()}</dd>
          </div>
        </dl>
        {!trace.selected_provider && <p className="text-sm text-ui-muted">No provider selection was recorded for this request.</p>}
      </section>

      {/* Execution evidence requires a recorded provider selection. */}
      {trace.selected_provider && <div className="bg-ui-surface rounded-2xl border border-ui-border overflow-hidden">
        {/* 01 MATCH */}
        <TraceStep
          number="01" label="MATCH" value={provider}
          detail={`Chosen for ${trustLabel}${price != null ? ` · $${price.toFixed(2)}/M` : ''}${selectedTps > 0 ? ` · ${selectedTps.toFixed(0)} tok/s` : ''}`}
          dot="green"
          expanded={expandedStep === '01'} onToggle={() => toggle('01')}
        >
          <div className="space-y-3">
            {/* Selected provider scoring */}
            {selectedScoring && (
              <div>
                <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: UI.accent }}>Selected</div>
                <div className="flex items-center gap-4 flex-wrap">
                  <span><span className="font-semibold" style={{ color: UI.text }}>{selectedScoring.name}</span></span>
                  <span>score: <span className="font-semibold" style={{ color: UI.accent }}>{selectedScore.toFixed(3)}</span></span>
                  <span>price: <span style={{ color: UI.accent }}>${selectedScoring.price?.toFixed(2)}/M</span></span>
                  <span>trust: <span className="font-medium px-1.5 py-0.5 rounded-full text-[9px]" style={{ background: tc.bg, color: tc.text }}>{trustLabel}</span></span>
                  <span>speed: <span style={{ color: UI.info }}>{selectedTps.toFixed(0)} tok/s</span></span>
                  <span>load: <span style={{ color: selectedLoad > 0.8 ? UI.danger : UI.success }}>{(selectedLoad * 100).toFixed(0)}%</span></span>
                </div>
              </div>
            )}

            {/* Alternative candidates */}
            {alternatives.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: UI.muted }}>
                  {alternatives.length} alternative{alternatives.length !== 1 ? 's' : ''} evaluated
                </div>
                <div className="space-y-1">
                  {alternatives.map((s: any, i: number) => {
                    const stc = TRUST_COLORS[s.trust] || TRUST_COLORS.open
                    return (
                      <div key={i} className="flex items-center gap-3 py-1 border-b border-ui-border last:border-0">
                        <span className="w-24 truncate" style={{ color: UI.text }}>{s.name}</span>
                        <span>score: <span className="font-medium">{s.score?.toFixed(3)}</span></span>
                        <span style={{ color: UI.accent }}>${s.price?.toFixed(2)}</span>
                        <span style={{ color: UI.info }}>{s.tps?.toFixed(0)} t/s</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: stc.bg, color: stc.text }}>
                          {TRUST_COLORS[s.trust]?.label || s.trust}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="text-[10px]" style={{ color: UI.muted }}>
              Routing preference: {preference}. Provider scored highest among eligible candidates.
            </div>
          </div>
        </TraceStep>

        {/* 02 ENCRYPTION */}
        <TraceStep
          number="02" label="ENCRYPTION" value={encrypted ? 'Coordinator blind' : 'Plaintext'}
          detail={encrypted
            ? 'Prompt encrypted to provider key via X25519'
            : 'No E2E encryption — coordinator can observe prompt content'}
          dot={encrypted ? 'green' : 'gold'}
          expanded={expandedStep === '02'} onToggle={() => toggle('02')}
        >
          <div className="space-y-1.5">
            <div>Protocol: {encrypted ? 'X25519 + XSalsa20-Poly1305' : 'Plaintext HTTP'}</div>
            <div>Forward secrecy: {encrypted ? 'Yes — ephemeral keypair per request' : 'N/A'}</div>
            <div>Coordinator visibility: {encrypted ? 'Cannot read prompt or response content' : 'Can observe all content'}</div>
            {encrypted && <div>Response encryption: IE SDK consumers get encrypted responses; SSE consumers receive plaintext responses relayed through coordinator</div>}
          </div>
        </TraceStep>

        {/* 03 RUNTIME */}
        <TraceStep
          number="03" label="RUNTIME"
          value={trust === 'hardened' || trust === 'confidential' ? 'Hardened' : trust === 'contained' ? 'Contained' : 'Open'}
          detail={trust === 'hardened' || trust === 'confidential'
            ? 'Binary hash matches published manifest'
            : trust === 'contained' ? 'Basic process isolation' : 'No runtime hardening'}
          dot={trust === 'hardened' || trust === 'confidential' ? 'gold' : trust === 'contained' ? 'blue' : 'gray'}
          expanded={expandedStep === '03'} onToggle={() => toggle('03')}
        >
          <div className="space-y-1.5">
            <div>Trust level: <span className="font-medium px-1.5 py-0.5 rounded-full text-[9px]" style={{ background: tc.bg, color: tc.text }}>{trustLabel}</span></div>
            {(trust === 'hardened' || trust === 'confidential') && (
              <>
                <div>PT_DENY_ATTACH: prevents debugger attachment</div>
                <div>Hardened Runtime: code signing enforced</div>
                <div>Binary hash: verified against published manifest at registration</div>
                <div>Attack bar: kernel exploit required (~$500k+ for macOS)</div>
              </>
            )}
            {trust === 'contained' && (
              <>
                <div>Process isolation: basic containerization</div>
                <div>Attack bar: admin-level tooling (Process Hacker, debugger)</div>
              </>
            )}
            {trust === 'open' && (
              <div>No runtime protection. Provider operator can observe inference data.</div>
            )}
          </div>
        </TraceStep>

        {/* 04 INFERENCE */}
        <TraceStep
          number="04" label="INFERENCE"
          value={isCompleted ? selectedTps > 0 ? `${selectedTps.toFixed(0)} tok/s` : 'Completed' : 'Completion unconfirmed'}
          detail={`Observed throughput for this request · ${servedModelLabel(billingTx || trace)}`}
          dot="blue"
          expanded={expandedStep === '04'} onToggle={() => toggle('04')}
        >
          <div className="space-y-1.5">
            <div>Requested: {requestedModelLabel(billingTx || trace)} · Served: {servedModelLabel(billingTx || trace)}</div>
            <div>Provider TPS (observed): {selectedTps > 0 ? `${selectedTps.toFixed(1)} tok/s` : 'not yet measured'}</div>
            {selectedScoring?.load != null && <div>Provider load at match time: {(selectedScoring.load * 100).toFixed(0)}%</div>}
            <div className="text-[10px] mt-1" style={{ color: UI.muted }}>
              TPS is the selected provider's observed rate, not an estimate or average across candidates.
            </div>
          </div>
        </TraceStep>

        {/* 05 BILLING */}
        <TraceStep
          number="05" label="BILLING"
          value={billingTx ? formatUsdPrecise(billingTx.cost_usd) : trace.cost_usd != null ? formatUsdPrecise(trace.cost_usd) : 'Charge not recorded'}
          detail="90% provider · 10% exchange"
          dot="gold"
          expanded={expandedStep === '05'} onToggle={() => toggle('05')}
        >
          <div className="space-y-1.5">
            {billingTx ? (
              <>
                <div className="grid grid-cols-3 gap-3 mb-2">
                  <div className="bg-ui-surface rounded-lg border border-ui-border p-2 text-center">
                    <div className="text-[9px] uppercase" style={{ color: UI.info }}>Input</div>
                    <div className="text-sm font-bold" style={{ color: UI.text }}>{((billingTx as any).input_tokens || 0).toLocaleString()}</div>
                    <div className="text-[10px]" style={{ color: UI.muted }}>tokens</div>
                  </div>
                  <div className="bg-ui-surface rounded-lg border border-ui-border p-2 text-center">
                    <div className="text-[9px] uppercase" style={{ color: UI.info }}>Cached</div>
                    <div className="text-sm font-bold" style={{ color: (billingTx as any).cached_tokens > 0 ? UI.text : UI.muted }}>
                      {(billingTx as any).cached_tokens > 0 ? ((billingTx as any).cached_tokens).toLocaleString() : '—'}
                    </div>
                    <div className="text-[10px]" style={{ color: UI.muted }}>tokens</div>
                  </div>
                  <div className="bg-ui-surface rounded-lg border border-ui-border p-2 text-center">
                    <div className="text-[9px] uppercase" style={{ color: UI.accent }}>Output</div>
                    <div className="text-sm font-bold" style={{ color: UI.text }}>{((billingTx as any).output_tokens || 0).toLocaleString()}</div>
                    <div className="text-[10px]" style={{ color: UI.muted }}>tokens</div>
                  </div>
                </div>
                <div>Total cost: <span className="font-semibold" style={{ color: UI.danger }}>{formatUsdPrecise(billingTx.cost_usd)}</span>
                  {billingTx.minimum_applied && <span style={{ color: UI.muted }}> (per-request minimum applied; token cost was lower)</span>}
                </div>
                {/* Stored integer split (BILL-001/002), not a recomputed float */}
                <div>Provider revenue: {billingTx.provider_earning_micro != null ? formatUsdPrecise(microToUsd(billingTx.provider_earning_micro)) : formatUsdPrecise(billingTx.cost_usd * 0.9)} (90%)</div>
                <div>Platform fee: {billingTx.platform_fee_micro != null ? formatUsdPrecise(microToUsd(billingTx.platform_fee_micro)) : formatUsdPrecise(billingTx.cost_usd * 0.1)} (10%)</div>
              </>
            ) : (
              <>
                {price != null && <div>Output rate: ${price.toFixed(2)} / M tokens</div>}
                {trace.cost_usd != null && <div>Total cost: {formatUsdPrecise(trace.cost_usd)}</div>}
                <div>Provider revenue: {trace.cost_usd != null ? `≈${formatUsdPrecise(trace.cost_usd * 0.9)}` : '—'} (90%)</div>
                <div>Platform fee: {trace.cost_usd != null ? `≈${formatUsdPrecise(trace.cost_usd * 0.1)}` : '—'} (10%)</div>
                <div className="text-[10px] mt-1" style={{ color: UI.muted }}>
                  Per-tier token breakdown not available for this request. Check Billing page for full transaction detail.
                </div>
              </>
            )}
            <div className="text-[10px] mt-1" style={{ color: UI.muted }}>
              Billing is per-token: input tokens + cached tokens (discounted) + output tokens.
            </div>
          </div>
        </TraceStep>

        <TraceStep number="06" label="FALLBACK" value="Not recorded"
          detail="Fallback evidence is unavailable in this trace." dot="gray" />
      </div>}

      {/* Evidence footer */}
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium" style={{ color: UI.text }}>
          Security evidence is inspectable, not a badge.
        </div>
        <div className="flex items-center gap-2">
          <Link to="/providers" className="text-[11px] font-medium px-4 py-2 rounded-lg border"
            style={{ color: UI.text, borderColor: UI.border }}>View provider</Link>
          <button className="text-[11px] font-medium px-4 py-2 rounded-lg border"
            style={{ color: UI.danger, borderColor: UI.border }}>Report issue</button>
        </div>
      </div>

      {/* Recent traces */}
      {traces.length > 1 && (
        <div className="bg-ui-surface rounded-2xl border border-ui-border p-5">
          <div className="text-[10px] uppercase tracking-wider font-medium mb-3" style={{ color: UI.accent }}>
            Recent Traces
          </div>
          <div className="space-y-1">
            {traces.slice(0, 10).map(t => {
              const isCurrent = t.request_id === trace.request_id
              const rowOutcome = requestOutcome(t.status)
              const time = new Date(t.timestamp * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
              return (
                <Link key={t.request_id} to={`/trace?id=${t.request_id}`}
                  className="flex items-center gap-3 py-2 px-3 rounded-lg transition-colors"
                  style={{ background: isCurrent ? UI.warningSurface : 'transparent' }}>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: UI[rowOutcome.tone] }} />
                  <span className="text-xs font-mono flex-1 truncate" style={{ color: isCurrent ? UI.accent : UI.muted }}>
                    {t.request_id}
                  </span>
                  <span className="text-[10px]" style={{ color: UI.muted }}>{time}</span>
                  <span className="text-xs" style={{ color: UI.muted }}>{t.model === 'default' ? 'any' : t.model}</span>
                  <span className="text-[10px]" style={{ color: UI[rowOutcome.tone] }}>{rowOutcome.label}</span>
                  {t.selected_trust && (
                    <span className="text-[8px] px-1.5 py-0.5 rounded-full"
                      style={{ background: (TRUST_COLORS[t.selected_trust] || TRUST_COLORS.open).bg, color: (TRUST_COLORS[t.selected_trust] || TRUST_COLORS.open).text }}>
                      {TRUST_COLORS[t.selected_trust]?.label || t.selected_trust}
                    </span>
                  )}
                  {t.selected_price != null && (
                    <span className="text-xs font-semibold" style={{ color: UI.accent }}>${t.selected_price.toFixed(2)}</span>
                  )}
                </Link>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
