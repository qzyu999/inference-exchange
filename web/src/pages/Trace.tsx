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
}

const TRUST_LABELS: Record<string, string> = {
  open: 'Open',
  contained: 'Contained',
  hardened: 'Hardened',
  confidential: 'Confidential',
}

// Step status dot colors
const DOT_COLORS = {
  green: C.green,
  gold: C.gold,
  blue: C.deepBlue,
  red: C.red,
  gray: '#ccc',
}

interface TraceStep {
  number: string
  label: string
  value: string
  detail: string
  dot: string
}

export function Trace() {
  const [searchParams] = useSearchParams()
  const requestId = searchParams.get('id')
  const { data: traceData } = useSWR('traces', api.traces, { refreshInterval: 5000 })

  const traces = traceData?.traces || []

  // Find the specific trace, or show the most recent
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
        <Link to="/chat" className="inline-block mt-4 text-sm font-medium" style={{ color: C.gold }}>
          Go to Chat
        </Link>
      </div>
    )
  }

  const isCompleted = ['completed', 'matched', 'matched_from_queue'].includes(trace.status)
  const provider = trace.selected_provider || 'unknown'
  const trust = trace.selected_trust || 'unknown'
  const price = trace.selected_price
  const encrypted = trace.encrypted

  // Build the 6 steps from trace data
  const steps: TraceStep[] = [
    {
      number: '01',
      label: 'MATCH',
      value: provider,
      detail: `${TRUST_LABELS[trust] || trust}${price != null ? ` · $${price.toFixed(2)}/M` : ''}${trace.scoring ? ` · ${trace.scoring.length} scored` : ''}`,
      dot: isCompleted ? 'green' : 'red',
    },
    {
      number: '02',
      label: 'ENCRYPTION',
      value: encrypted ? 'Coordinator blind' : 'Plaintext',
      detail: encrypted ? 'Prompt encrypted to provider key' : 'No E2E encryption for this request',
      dot: encrypted ? 'green' : 'gold',
    },
    {
      number: '03',
      label: 'RUNTIME',
      value: trust === 'hardened' || trust === 'confidential' ? 'Hardened' : trust === 'contained' ? 'Contained' : 'Open',
      detail: trust === 'hardened' || trust === 'confidential'
        ? 'Binary hash matches published manifest'
        : trust === 'contained' ? 'Basic process isolation' : 'No runtime hardening',
      dot: trust === 'hardened' || trust === 'confidential' ? 'gold' : trust === 'contained' ? 'blue' : 'gray',
    },
    {
      number: '04',
      label: 'INFERENCE',
      value: trace.scoring?.[0]?.tps ? `${trace.scoring[0].tps.toFixed(0)} tok/s` : '—',
      detail: 'Observed throughput for this request',
      dot: 'blue',
    },
    {
      number: '05',
      label: 'BILLING',
      value: trace.cost_usd != null ? `$${trace.cost_usd.toFixed(6)}` : '—',
      detail: '90% provider · 10% exchange',
      dot: 'gold',
    },
    {
      number: '06',
      label: 'FALLBACK',
      value: isCompleted ? 'Not used' : 'Triggered',
      detail: isCompleted ? 'Exchange served the request' : 'Request could not be served by exchange providers',
      dot: isCompleted ? 'green' : 'red',
    },
  ]

  return (
    <div className="max-w-3xl space-y-6">
      {/* Request header card */}
      <div className="bg-white rounded-2xl border border-gray-200/40 px-6 py-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold font-mono" style={{ color: C.blueBlack }}>
            {trace.request_id}
          </h2>
          <div className="text-xs mt-0.5" style={{ color: '#999' }}>
            {trace.model || 'default'}
            {trace.scoring && ` · ${trace.providers_evaluated || trace.scoring.length} evaluated`}
          </div>
        </div>
        <span
          className="text-[11px] font-medium px-3 py-1 rounded-full"
          style={{
            background: isCompleted ? '#edf7f1' : '#fdf5f4',
            color: isCompleted ? C.green : C.red,
          }}
        >
          {isCompleted ? 'Completed' : trace.status}
        </span>
      </div>

      {/* Step timeline */}
      <div className="bg-white rounded-2xl border border-gray-200/40 overflow-hidden">
        {steps.map((step, i) => (
          <div
            key={step.number}
            className="flex items-center gap-5 px-6 py-4"
            style={{ borderTop: i > 0 ? '1px solid #f0ede6' : 'none' }}
          >
            {/* Step number */}
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
              style={{ border: '1.5px solid #ddd', color: '#999' }}
            >
              {step.number}
            </div>

            {/* Label */}
            <div className="w-24 shrink-0">
              <div className="text-[10px] uppercase tracking-wider font-medium" style={{ color: '#999' }}>
                {step.label}
              </div>
            </div>

            {/* Value */}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold" style={{ color: C.blueBlack }}>
                {step.value}
              </div>
              <div className="text-xs" style={{ color: '#999' }}>
                {step.detail}
              </div>
            </div>

            {/* Status dot */}
            <div
              className="w-3 h-3 rounded-full shrink-0"
              style={{ background: DOT_COLORS[step.dot as keyof typeof DOT_COLORS] || DOT_COLORS.gray }}
            />
          </div>
        ))}
      </div>

      {/* Evidence footer */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium" style={{ color: C.blueBlack }}>
            Security evidence is inspectable, not a badge.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/providers"
            className="text-[11px] font-medium px-4 py-2 rounded-lg border transition-colors"
            style={{ color: C.blueBlack, borderColor: '#ddd' }}
          >
            View provider
          </Link>
          <button
            className="text-[11px] font-medium px-4 py-2 rounded-lg border transition-colors"
            style={{ color: C.red, borderColor: '#ddd' }}
          >
            Report issue
          </button>
        </div>
      </div>

      {/* Recent traces list */}
      {traces.length > 1 && (
        <div className="bg-white rounded-2xl border border-gray-200/40 p-5">
          <div className="text-[10px] uppercase tracking-wider font-medium mb-3" style={{ color: C.gold }}>
            Recent Traces
          </div>
          <div className="space-y-1">
            {[...traces].reverse().slice(0, 8).map((t: any) => {
              const isCurrent = t.request_id === trace.request_id
              const ok = ['completed', 'matched', 'matched_from_queue'].includes(t.status)
              return (
                <Link
                  key={t.request_id}
                  to={`/trace?id=${t.request_id}`}
                  className="flex items-center gap-3 py-2 px-3 rounded-lg transition-colors"
                  style={{
                    background: isCurrent ? '#fdf6ec' : 'transparent',
                  }}
                >
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: ok ? C.green : C.red }} />
                  <span className="text-xs font-mono flex-1 truncate" style={{ color: isCurrent ? C.gold : '#888' }}>
                    {t.request_id}
                  </span>
                  <span className="text-xs" style={{ color: '#bbb' }}>
                    {t.model === 'default' ? 'any' : t.model}
                  </span>
                  {t.selected_price != null && (
                    <span className="text-xs font-semibold" style={{ color: C.gold }}>
                      ${t.selected_price.toFixed(2)}
                    </span>
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
