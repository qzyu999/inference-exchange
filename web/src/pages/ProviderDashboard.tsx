import { Link } from 'react-router-dom'
import { C } from '../lib/theme'

export function ProviderDashboard() {
  // Stub: this page needs backend endpoints for provider-specific data
  // See GitHub issue for requirements

  return (
    <div className="space-y-6">
      {/* Stat cards (stub data) */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex-1 grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: 'estimated earnings', value: '$—', color: C.gold },
            { label: 'market median', value: '$—', color: C.blueBlack },
            { label: 'utilization', value: '—%', color: C.blueBlack },
            { label: 'requests served', value: '—', color: C.blueBlack },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-2xl border border-gray-200/40 px-5 py-4">
              <div className="text-[10px] uppercase tracking-wider font-medium mb-0.5" style={{ color: C.gold }}>Today</div>
              <div className="text-2xl font-bold tracking-tight" style={{ color: s.color }}>{s.value}</div>
              <div className="text-[11px] mt-0.5" style={{ color: '#999' }}>{s.label}</div>
            </div>
          ))}
        </div>
        <button
          className="px-5 py-3 rounded-xl text-sm font-medium shrink-0 transition-colors"
          style={{ background: C.blueBlack, color: '#fff' }}
        >
          Add machine
        </button>
      </div>

      {/* Two-column: Your Offer + Trust & Visibility */}
      <div className="flex gap-5 flex-col lg:flex-row">
        {/* Your Offer */}
        <div className="flex-1 bg-white rounded-2xl border border-gray-200/40 p-6">
          <div className="text-[10px] uppercase tracking-wider font-medium mb-1" style={{ color: C.gold }}>
            Your Offer
          </div>

          <h2 className="text-lg font-bold mt-2" style={{ color: C.blueBlack }}>
            Mac Studio · M2 Max
          </h2>
          <span className="inline-block text-[11px] font-medium px-2.5 py-1 rounded-full mt-2" style={{ background: '#edf7f1', color: C.green }}>
            Online
          </span>

          <div className="text-xs mt-4" style={{ color: '#999' }}>
            96 GB unified memory · Qwen 3.5 35B A3B
          </div>

          {/* Pricing */}
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-sm font-mono" style={{ color: '#999' }}>Q4_K_M</span>
            <span className="text-sm font-semibold" style={{ color: C.gold }}>$0.09 / M output</span>
          </div>

          {/* Market position */}
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs" style={{ color: '#888' }}>Current market range</div>
              <div className="text-base font-bold mt-0.5" style={{ color: C.blueBlack }}>$0.07 — $0.15</div>
            </div>
            <div>
              <div className="text-xs" style={{ color: '#888' }}>Your position</div>
              <div className="text-base font-bold mt-0.5" style={{ color: C.blueBlack }}>$0.09 · 2nd cheapest</div>
            </div>
          </div>

          {/* Estimated earnings */}
          <div className="mt-5 pt-4" style={{ borderTop: '1px solid #e5e5e3' }}>
            <div className="text-xs" style={{ color: '#888' }}>Estimated earnings</div>
            <div className="text-2xl font-bold mt-0.5" style={{ color: C.blueBlack }}>$2.10 today</div>
            <div className="text-xs" style={{ color: '#999' }}>Based on recent utilization and market depth.</div>
          </div>

          <div className="flex gap-2 mt-5">
            <button className="px-4 py-2 rounded-xl text-sm font-medium border" style={{ color: C.blueBlack, borderColor: '#ddd' }}>
              Edit offer
            </button>
            <button className="px-4 py-2 rounded-xl text-sm font-medium border" style={{ color: '#888', borderColor: '#ddd' }}>
              Pause
            </button>
          </div>
        </div>

        {/* Trust & Visibility */}
        <div className="w-full lg:w-64 shrink-0 bg-white rounded-2xl border border-gray-200/40 p-6">
          <div className="text-[10px] uppercase tracking-wider font-medium mb-1" style={{ color: C.gold }}>
            Trust & Visibility
          </div>

          <div className="space-y-4 mt-4">
            {[
              { label: 'Binary', value: 'Published hash', status: 'Verified' },
              { label: 'Runtime', value: 'Hardened agent', status: 'Verified' },
              { label: 'Success', value: '99.2% / 500 requests', status: 'Observed' },
              { label: 'Attestation', value: '3 minutes ago', status: 'Fresh' },
            ].map(item => (
              <div key={item.label} className="flex items-center justify-between">
                <div>
                  <div className="text-xs" style={{ color: '#888' }}>{item.label}</div>
                  <div className="text-sm font-medium mt-0.5" style={{ color: C.blueBlack }}>{item.value}</div>
                </div>
                <span
                  className="text-[10px] font-medium px-2.5 py-1 rounded-full shrink-0"
                  style={{ background: '#edf7f1', color: C.green }}
                >
                  {item.status}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-6 pt-4" style={{ borderTop: '1px solid #e5e5e3' }}>
            <div className="text-[10px] uppercase tracking-wider font-medium mb-2" style={{ color: C.gold }}>
              Public Provider Profile
            </div>
            <div className="text-xs" style={{ color: '#888' }}>
              Users see price, hardware, trust and observed performance.
            </div>
          </div>
        </div>
      </div>

      {/* Stub notice */}
      <div className="rounded-2xl border px-5 py-4 flex items-center gap-3" style={{ background: '#fdf6ec', borderColor: 'rgba(196,154,69,0.15)' }}>
        <span className="text-sm" style={{ color: C.gold }}>⚠</span>
        <div>
          <div className="text-sm font-medium" style={{ color: C.blueBlack }}>This page shows placeholder data</div>
          <div className="text-xs" style={{ color: '#888' }}>
            Provider-specific earnings, utilization, and market position require backend endpoints that don't exist yet.
            See the linked GitHub issue for requirements.
          </div>
        </div>
        <Link to="/providers" className="text-xs font-medium shrink-0 ml-auto" style={{ color: C.gold }}>
          View public providers
        </Link>
      </div>
    </div>
  )
}
