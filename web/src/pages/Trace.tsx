import { useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import useSWR from 'swr'
import { api } from '../lib/api'

const C = {
  gold: '#C49A45',
  green: '#3F8055',
  turquoise: '#4D9A91',
  deepBlue: '#315B72',
  blueBlack: '#292F35',
  red: '#B7443B',
  orange: '#D77A2F',
  indigo: '#4A465F',
}

const TRUST_LABELS: Record<string, string> = {
  open: 'Open', contained: 'Contained', hardened: 'Hardened', confidential: 'Confidential',
}

const TRUST_COLORS: Record<string, { bg: string; text: string }> = {
  open:         { bg: '#f3f3f3', text: '#999' },
  contained:    { bg: '#eef3f7', text: C.deepBlue },
  hardened:     { bg: '#fdf6ec', text: C.gold },
  confidential: { bg: '#edf7f1', text: C.green },
}

const DOT_COLORS: Record<string, string> = {
  green: C.green, gold: C.gold, blue: C.deepBlue, red: C.red, gray: '#ccc',
}

// ─── Step component ──────────────────────────────────────────

function TraceStep({ number, label, value, detail, dot, expanded, children, onToggle }: {
  number: string; label: string; value: string; detail: string; dot: string
  expanded?: boolean; children?: React.ReactNode; onToggle?: () => void
}) {
  return (
    <div>
      <div
        className={`flex items-center gap-5 px-6 py-4 ${onToggle ? 'cursor-pointer hover:bg-gray-50/50' : ''}`}
        style={{ borderTop: number !== '01' ? '1px solid #f0ede6' : 'none' }}
        onClick={onToggle}
      >
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
          style={{ border: '1.5px solid #ddd', color: '#999' }}>{number}</div>
        <div className="w-24 shrink-0">
          <div className="text-[10px] uppercase tracking-wider font-medium" style={{ color: '#999' }}>{label}</div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold" style={{ color: C.blueBlack }}>{value}</div>
          <div className="text-xs" style={{ color: '#999' }}>{detail}</div>
        </div>
        <div className="w-3 h-3 rounded-full shrink-0" style={{ background: DOT_COLORS[dot] || DOT_COLORS.gray }} />
        {onToggle && (
          <svg className={`w-3 h-3 transition-transform shrink-0 ${expanded ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="#bbb" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </div>
      {expanded && children && (
        <div className="px-6 pb-4 ml-14" style={{ borderTop: '1px solid #f0ede6' }}>
          <div className="pt-3 text-xs" style={{ color: '#888' }}>
            {children}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main ────────────────────────────────────────────────────

export function Trace() {
  const [searchParams] = useSearchParams()
  const requestId = searchParams.get('id')
  const { data: traceData } = useSWR('traces', api.traces, { refreshInterval: 5000 })
  const { data: historyData } = useSWR('history', api.history, { refreshInterval: 10000 })
  const [expandedStep, setExpandedStep] = useState<string | null>(null)

  const traces = traceData?.traces || []
  const trace = requestId
    ? traces.find((t: any) => t.request_id === requestId)
    : traces.length > 0 ? traces[traces.length - 1] : null

  if (!trace) {
    return (
      <div className="max-w-2xl mx-auto text-center py-16">
        <div className="text-sm" style={{ color: '#999' }}>
          {requestId ? `Trace ${requestId} not found` : 'No completed requests to inspect yet.'}
        </div>
        <div className="text-xs mt-2" style={{ color: '#bbb' }}>
          Send a chat request, then come back here to inspect the evidence.
        </div>
        <Link to="/chat" className="inline-block mt-4 text-sm font-medium" style={{ color: C.gold }}>Go to Chat</Link>
      </div>
    )
  }

  const isCompleted = ['completed', 'matched', 'matched_from_queue'].includes(trace.status)
  const provider = trace.selected_provider || 'unknown'
  const trust = trace.selected_trust || 'unknown'
  const price = trace.selected_price
  const encrypted = trace.encrypted
  const scoring = trace.scoring || []
  const preference = trace.preference || 'balanced'

  // Cross-reference billing history for per-tier token data
  const billingTx = (historyData?.transactions || []).find((t: any) => t.request_id === trace.request_id)

  // FIX: Get TPS from the SELECTED provider's scoring entry, not scoring[0]
  const selectedScoring = scoring.find((s: any) => s.selected || s.name === provider)
  const selectedTps = selectedScoring?.tps || 0
  const selectedLoad = selectedScoring?.load || 0
  const selectedScore = selectedScoring?.score || 0

  // Candidates that were NOT selected
  const alternatives = scoring.filter((s: any) => !s.selected && s.name !== provider)

  const trustLabel = TRUST_LABELS[trust] || trust
  const tc = TRUST_COLORS[trust] || TRUST_COLORS.open

  const toggle = (step: string) => setExpandedStep(expandedStep === step ? null : step)

  return (
    <div className="max-w-3xl space-y-6">
      {/* Request header */}
      <div className="bg-white rounded-2xl border border-gray-200/40 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold font-mono" style={{ color: C.blueBlack }}>{trace.request_id}</h2>
            <div className="text-xs mt-0.5" style={{ color: '#999' }}>
              {trace.model || 'default'}
              {' · '}{trace.providers_evaluated || scoring.length} provider{(trace.providers_evaluated || scoring.length) !== 1 ? 's' : ''} evaluated
              {preference && ` · ${preference} routing`}
            </div>
          </div>
          <span className="text-[11px] font-medium px-3 py-1 rounded-full"
            style={{ background: isCompleted ? '#edf7f1' : '#fdf5f4', color: isCompleted ? C.green : C.red }}>
            {isCompleted ? 'Completed' : trace.status}
          </span>
        </div>
      </div>

      {/* Step timeline */}
      <div className="bg-white rounded-2xl border border-gray-200/40 overflow-hidden">
        {/* 01 MATCH */}
        <TraceStep
          number="01" label="MATCH" value={provider}
          detail={`Chosen for ${trustLabel}${price != null ? ` · $${price.toFixed(2)}/M` : ''}${selectedTps > 0 ? ` · ${selectedTps.toFixed(0)} tok/s` : ''}`}
          dot={isCompleted ? 'green' : 'red'}
          expanded={expandedStep === '01'} onToggle={() => toggle('01')}
        >
          <div className="space-y-3">
            {/* Selected provider scoring */}
            {selectedScoring && (
              <div>
                <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: C.gold }}>Selected</div>
                <div className="flex items-center gap-4 flex-wrap">
                  <span><span className="font-semibold" style={{ color: C.blueBlack }}>{selectedScoring.name}</span></span>
                  <span>score: <span className="font-semibold" style={{ color: C.gold }}>{selectedScore.toFixed(3)}</span></span>
                  <span>price: <span style={{ color: C.gold }}>${selectedScoring.price?.toFixed(2)}/M</span></span>
                  <span>trust: <span className="font-medium px-1.5 py-0.5 rounded-full text-[9px]" style={{ background: tc.bg, color: tc.text }}>{trustLabel}</span></span>
                  <span>speed: <span style={{ color: C.turquoise }}>{selectedTps.toFixed(0)} tok/s</span></span>
                  <span>load: <span style={{ color: selectedLoad > 0.8 ? C.red : C.green }}>{(selectedLoad * 100).toFixed(0)}%</span></span>
                </div>
              </div>
            )}

            {/* Alternative candidates */}
            {alternatives.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: '#aaa' }}>
                  {alternatives.length} alternative{alternatives.length !== 1 ? 's' : ''} evaluated
                </div>
                <div className="space-y-1">
                  {alternatives.map((s: any, i: number) => {
                    const stc = TRUST_COLORS[s.trust] || TRUST_COLORS.open
                    return (
                      <div key={i} className="flex items-center gap-3 py-1 border-b border-gray-50 last:border-0">
                        <span className="w-24 truncate" style={{ color: C.blueBlack }}>{s.name}</span>
                        <span>score: <span className="font-medium">{s.score?.toFixed(3)}</span></span>
                        <span style={{ color: C.gold }}>${s.price?.toFixed(2)}</span>
                        <span style={{ color: C.turquoise }}>{s.tps?.toFixed(0)} t/s</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: stc.bg, color: stc.text }}>
                          {TRUST_LABELS[s.trust] || s.trust}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="text-[10px]" style={{ color: '#bbb' }}>
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
          value={selectedTps > 0 ? `${selectedTps.toFixed(0)} tok/s` : '—'}
          detail={`Observed throughput for this request${trace.model ? ` · ${trace.model}` : ''}`}
          dot="blue"
          expanded={expandedStep === '04'} onToggle={() => toggle('04')}
        >
          <div className="space-y-1.5">
            <div>Model: {trace.model || 'default'}</div>
            <div>Provider TPS (observed): {selectedTps > 0 ? `${selectedTps.toFixed(1)} tok/s` : 'not yet measured'}</div>
            {selectedScoring?.load != null && <div>Provider load at match time: {(selectedScoring.load * 100).toFixed(0)}%</div>}
            <div className="text-[10px] mt-1" style={{ color: '#bbb' }}>
              TPS is the selected provider's observed rate, not an estimate or average across candidates.
            </div>
          </div>
        </TraceStep>

        {/* 05 BILLING */}
        <TraceStep
          number="05" label="BILLING"
          value={billingTx ? `$${(billingTx as any).cost_usd.toFixed(6)}` : trace.cost_usd != null ? `$${trace.cost_usd.toFixed(6)}` : price != null ? `$${price.toFixed(2)}/M` : '—'}
          detail="90% provider · 10% exchange"
          dot="gold"
          expanded={expandedStep === '05'} onToggle={() => toggle('05')}
        >
          <div className="space-y-1.5">
            {billingTx ? (
              <>
                <div className="grid grid-cols-3 gap-3 mb-2">
                  <div className="bg-white rounded-lg border border-gray-100 p-2 text-center">
                    <div className="text-[9px] uppercase" style={{ color: C.deepBlue }}>Input</div>
                    <div className="text-sm font-bold" style={{ color: C.blueBlack }}>{((billingTx as any).input_tokens || 0).toLocaleString()}</div>
                    <div className="text-[10px]" style={{ color: '#bbb' }}>tokens</div>
                  </div>
                  <div className="bg-white rounded-lg border border-gray-100 p-2 text-center">
                    <div className="text-[9px] uppercase" style={{ color: C.turquoise }}>Cached</div>
                    <div className="text-sm font-bold" style={{ color: (billingTx as any).cached_tokens > 0 ? C.blueBlack : '#ddd' }}>
                      {(billingTx as any).cached_tokens > 0 ? ((billingTx as any).cached_tokens).toLocaleString() : '—'}
                    </div>
                    <div className="text-[10px]" style={{ color: '#bbb' }}>tokens</div>
                  </div>
                  <div className="bg-white rounded-lg border border-gray-100 p-2 text-center">
                    <div className="text-[9px] uppercase" style={{ color: C.gold }}>Output</div>
                    <div className="text-sm font-bold" style={{ color: C.blueBlack }}>{((billingTx as any).output_tokens || 0).toLocaleString()}</div>
                    <div className="text-[10px]" style={{ color: '#bbb' }}>tokens</div>
                  </div>
                </div>
                <div>Total cost: <span className="font-semibold" style={{ color: C.red }}>${(billingTx as any).cost_usd.toFixed(6)}</span></div>
                <div>Provider revenue: ${((billingTx as any).cost_usd * 0.9).toFixed(6)} (90%)</div>
                <div>Platform fee: ${((billingTx as any).cost_usd * 0.1).toFixed(6)} (10%)</div>
              </>
            ) : (
              <>
                {price != null && <div>Output rate: ${price.toFixed(2)} / M tokens</div>}
                {trace.cost_usd != null && <div>Total cost: ${trace.cost_usd.toFixed(6)}</div>}
                <div>Provider revenue: {trace.cost_usd != null ? `$${(trace.cost_usd * 0.9).toFixed(6)}` : '—'} (90%)</div>
                <div>Platform fee: {trace.cost_usd != null ? `$${(trace.cost_usd * 0.1).toFixed(6)}` : '—'} (10%)</div>
                <div className="text-[10px] mt-1" style={{ color: '#bbb' }}>
                  Per-tier token breakdown not available for this request. Check Billing page for full transaction detail.
                </div>
              </>
            )}
            <div className="text-[10px] mt-1" style={{ color: '#bbb' }}>
              Billing is per-token: input tokens + cached tokens (discounted) + output tokens.
            </div>
          </div>
        </TraceStep>

        {/* 06 FALLBACK */}
        <TraceStep
          number="06" label="FALLBACK"
          value={isCompleted ? 'Not used' : trace.status === 'no_provider' ? 'No providers available' : trace.status}
          detail={isCompleted
            ? 'Exchange served the request directly'
            : trace.status === 'no_provider'
              ? 'No eligible providers were connected at request time'
              : `Request ended with status: ${trace.status}`}
          dot={isCompleted ? 'green' : 'red'}
          expanded={expandedStep === '06'} onToggle={() => toggle('06')}
        >
          <div className="space-y-1.5">
            {isCompleted ? (
              <>
                <div>Fallback was not triggered — the exchange matched and served the request.</div>
                <div>If fallback were configured (e.g. OpenRouter), it would activate only when no eligible exchange provider exists.</div>
              </>
            ) : (
              <>
                <div>Request status: {trace.status}</div>
                <div>This could indicate: no providers online, all providers exceeded price ceiling, trust minimum not met, or provider failed during inference.</div>
                {trace.status !== 'no_provider' && (
                  <div>Note: a non-completed status does not necessarily mean fallback was used. Verify with coordinator logs.</div>
                )}
              </>
            )}
          </div>
        </TraceStep>
      </div>

      {/* Evidence footer */}
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium" style={{ color: C.blueBlack }}>
          Security evidence is inspectable, not a badge.
        </div>
        <div className="flex items-center gap-2">
          <Link to="/providers" className="text-[11px] font-medium px-4 py-2 rounded-lg border"
            style={{ color: C.blueBlack, borderColor: '#ddd' }}>View provider</Link>
          <button className="text-[11px] font-medium px-4 py-2 rounded-lg border"
            style={{ color: C.red, borderColor: '#ddd' }}>Report issue</button>
        </div>
      </div>

      {/* Recent traces */}
      {traces.length > 1 && (
        <div className="bg-white rounded-2xl border border-gray-200/40 p-5">
          <div className="text-[10px] uppercase tracking-wider font-medium mb-3" style={{ color: C.gold }}>
            Recent Traces
          </div>
          <div className="space-y-1">
            {[...traces].reverse().slice(0, 10).map((t: any) => {
              const isCurrent = t.request_id === trace.request_id
              const ok = ['completed', 'matched', 'matched_from_queue'].includes(t.status)
              const time = new Date(t.timestamp * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
              return (
                <Link key={t.request_id} to={`/trace?id=${t.request_id}`}
                  className="flex items-center gap-3 py-2 px-3 rounded-lg transition-colors"
                  style={{ background: isCurrent ? '#fdf6ec' : 'transparent' }}>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: ok ? C.green : C.red }} />
                  <span className="text-xs font-mono flex-1 truncate" style={{ color: isCurrent ? C.gold : '#888' }}>
                    {t.request_id}
                  </span>
                  <span className="text-[10px]" style={{ color: '#bbb' }}>{time}</span>
                  <span className="text-xs" style={{ color: '#bbb' }}>{t.model === 'default' ? 'any' : t.model}</span>
                  {t.selected_trust && (
                    <span className="text-[8px] px-1.5 py-0.5 rounded-full"
                      style={{ background: (TRUST_COLORS[t.selected_trust] || TRUST_COLORS.open).bg, color: (TRUST_COLORS[t.selected_trust] || TRUST_COLORS.open).text }}>
                      {TRUST_LABELS[t.selected_trust] || t.selected_trust}
                    </span>
                  )}
                  {t.selected_price != null && (
                    <span className="text-xs font-semibold" style={{ color: C.gold }}>${t.selected_price.toFixed(2)}</span>
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
