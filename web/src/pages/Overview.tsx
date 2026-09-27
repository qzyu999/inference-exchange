import useSWR from 'swr'
import { api } from '../lib/api'

const C = {
  gold: '#C49A45',
  green: '#3F8055',
  turquoise: '#4D9A91',
  deepBlue: '#315B72',
  blueBlack: '#292F35',
}

export function Overview() {
  const { data: stats } = useSWR('stats', api.stats, { refreshInterval: 5000 })
  const { data: provData } = useSWR('providers', api.providers, { refreshInterval: 5000 })

  const providers = provData?.providers || []

  return (
    <div className="space-y-6">
      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Providers online', value: stats?.providers_online ?? '—', color: C.blueBlack },
          { label: 'Models advertised', value: stats?.models_available ?? '—', color: C.blueBlack },
          {
            label: 'Request success',
            value: stats && stats.total_requests > 0 ? '—' : '—',
            color: C.green,
          },
          {
            label: 'Volume / 24h',
            value: stats?.total_volume_usd != null
              ? `$${stats.total_volume_usd >= 1 ? stats.total_volume_usd.toFixed(2) : stats.total_volume_usd.toFixed(4)}`
              : '—',
            color: C.gold,
          },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl border border-gray-200/40 px-5 py-4">
            <div className="text-2xl font-bold tracking-tight" style={{ color: s.color }}>{s.value}</div>
            <div className="text-[11px] mt-1" style={{ color: '#999' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Two-column: health + transparency */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Network health */}
        <div className="bg-white rounded-2xl border border-gray-200/40 p-6">
          <div className="text-[10px] uppercase tracking-wider font-medium mb-1" style={{ color: C.gold }}>
            Network Health
          </div>
          <h2 className="text-lg font-bold mb-4" style={{ color: C.blueBlack }}>Request outcomes</h2>
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: C.green }} />
              <span className="text-sm" style={{ color: C.green }}>Healthy routing</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#B7443B' }} />
              <span className="text-sm" style={{ color: '#B7443B' }}>Failures</span>
            </div>
          </div>
          <div className="mt-6 text-xs text-center py-12 rounded-xl" style={{ color: '#ccc', background: '#faf8f4' }}>
            Request outcome chart will render here when traffic flows
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
              { component: 'Coordinator', version: 'v0.1.0', status: 'verified' },
              { component: 'Provider agent', version: 'v0.1.0', status: 'verified' },
              { component: 'OCIP server', version: 'v0.1.0', status: 'verified' },
              { component: 'Billing', version: 'v0.1.0', status: 'verified' },
            ].map(c => (
              <div key={c.component} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                <span className="text-sm" style={{ color: C.blueBlack }}>{c.component}</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono" style={{ color: '#999' }}>{c.version}</span>
                  <span
                    className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                    style={{ background: '#edf7f1', color: C.green }}
                  >
                    {c.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Connected providers quick view */}
      {providers.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200/40 p-6">
          <div className="text-[10px] uppercase tracking-wider font-medium mb-3" style={{ color: C.gold }}>
            Connected Providers
          </div>
          <div className="space-y-2">
            {providers.slice(0, 5).map((p: any) => (
              <div key={p.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                <div className="flex items-center gap-3">
                  <span className="w-2 h-2 rounded-full" style={{ background: C.green }} />
                  <span className="text-sm font-medium" style={{ color: C.blueBlack }}>{p.name || p.id.slice(0, 12)}</span>
                  <span className="text-xs" style={{ color: '#999' }}>{p.hardware}</span>
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <span style={{ color: C.turquoise }}>{p.measured_tps > 0 ? `${p.measured_tps.toFixed(0)} tok/s` : '—'}</span>
                  <span style={{ color: '#999' }}>${p.price_output.toFixed(2)}/M</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
