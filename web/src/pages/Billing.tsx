import useSWR from 'swr'
import { api } from '../lib/api'

const C = {
  red: '#B7443B', gold: '#C49A45', green: '#3F8055', turquoise: '#4D9A91',
  deepBlue: '#315B72', blueBlack: '#292F35',
}

function formatDate(ts: number) {
  return new Date(ts * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function Billing() {
  const { data: balance, error: balErr } = useSWR('me', api.me, { refreshInterval: 5000 })
  const { data: history } = useSWR('history', api.history, { refreshInterval: 10000 })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: C.blueBlack }}>Billing</h1>
        <p className="text-sm mt-1" style={{ color: '#888' }}>Your balance and usage history</p>
      </div>

      {balance ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Balance', value: `$${balance.balance_usd.toFixed(4)}`, color: C.green },
            { label: 'Total Spent', value: `$${balance.total_spent_usd.toFixed(4)}`, color: C.blueBlack },
            { label: 'Requests', value: balance.requests_made.toLocaleString(), color: C.blueBlack },
            { label: 'Tokens Used', value: balance.tokens_consumed.toLocaleString(), color: C.blueBlack },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-5">
              <div className="text-xs" style={{ color: '#888' }}>{s.label}</div>
              <div className="text-2xl font-bold mt-1" style={{ color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>
      ) : balErr ? (
        <div className="rounded-2xl border p-5 text-sm" style={{ background: '#fdf5f4', borderColor: '#e8c5c0', color: C.red }}>
          Could not load balance. Is the coordinator running?
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1,2,3,4].map(i => (
            <div key={i} className="bg-white rounded-2xl border border-gray-200/60 p-5 animate-pulse">
              <div className="h-3 bg-gray-100 rounded w-16 mb-2" />
              <div className="h-7 bg-gray-100 rounded w-24" />
            </div>
          ))}
        </div>
      )}

      <div className="rounded-2xl border p-5 flex items-center justify-between" style={{ background: '#fdf6ec', borderColor: 'rgba(196,154,69,0.2)' }}>
        <div>
          <div className="font-semibold" style={{ color: C.blueBlack }}>Need more credits?</div>
          <div className="text-sm" style={{ color: '#888' }}>Alpha uses dummy money. Reset your balance anytime.</div>
        </div>
        <button onClick={async () => {
          await fetch('/v1/auth/reset-balance', { method: 'POST', credentials: 'include' })
          window.location.reload()
        }} className="px-4 py-2 rounded-xl text-sm font-medium transition-colors" style={{ background: C.gold, color: 'white' }}>
          Reset to $10
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-5">
        <h2 className="text-sm font-semibold mb-4" style={{ color: C.blueBlack }}>Transaction History</h2>

        {/* Column headers */}
        <div className="flex items-center gap-4 pb-2 mb-2 border-b border-gray-200 text-[10px] uppercase tracking-wider" style={{ color: '#aaa' }}>
          <span className="w-28">Time</span>
          <span className="w-20">ID</span>
          <span className="flex-1">Model</span>
          <span className="w-16 text-right" style={{ color: C.deepBlue }}>Input</span>
          <span className="w-16 text-right" style={{ color: C.turquoise }}>Cache</span>
          <span className="w-16 text-right" style={{ color: C.gold }}>Output</span>
          <span className="w-20 text-right">Cost</span>
        </div>

        {history?.transactions && history.transactions.length > 0 ? (
          <div className="space-y-0">
            {history.transactions.slice().reverse().map((t: any, i: number) => (
              <div key={i} className="flex items-center gap-4 py-2.5 border-b border-gray-50 last:border-0 text-sm">
                <span className="text-xs w-28" style={{ color: '#aaa' }}>{formatDate(t.timestamp)}</span>
                <span className="font-mono text-xs w-20" style={{ color: '#bbb' }}>{t.request_id}</span>
                <span className="flex-1 truncate" style={{ color: C.blueBlack }}>{t.model}</span>
                <span className="text-xs w-16 text-right" style={{ color: C.deepBlue }}>{(t.input_tokens || 0).toLocaleString()}</span>
                <span className="text-xs w-16 text-right" style={{ color: t.cached_tokens > 0 ? C.turquoise : '#ddd' }}>
                  {t.cached_tokens > 0 ? t.cached_tokens.toLocaleString() : '—'}
                </span>
                <span className="text-xs w-16 text-right" style={{ color: C.gold }}>{(t.output_tokens || 0).toLocaleString()}</span>
                <span className="font-semibold w-20 text-right" style={{ color: C.red }}>-${t.cost_usd.toFixed(6)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-center py-8" style={{ color: '#ccc' }}>No transactions yet</div>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-5">
        <div className="text-sm font-semibold mb-3" style={{ color: C.blueBlack }}>How pricing works</div>
        <ul className="space-y-2 text-sm" style={{ color: '#6b6b6b' }}>
          <li className="flex items-start gap-2"><span style={{ color: C.gold }}>—</span>Three-tier pricing: input tokens, cached tokens (discounted), and output tokens.</li>
          <li className="flex items-start gap-2"><span style={{ color: C.gold }}>—</span>Each provider sets their own rates. The exchange matches based on your preference.</li>
          <li className="flex items-start gap-2"><span style={{ color: C.gold }}>—</span>90% goes to the provider, 10% platform fee.</li>
          <li className="flex items-start gap-2"><span style={{ color: C.gold }}>—</span>Cache discount applies when the KV cache has your previous conversation context.</li>
        </ul>
      </div>
    </div>
  )
}
