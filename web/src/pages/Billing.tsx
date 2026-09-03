import useSWR from 'swr'
import { api } from '../lib/api'

function formatDate(ts: number) {
  return new Date(ts * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function Billing() {
  const { data: balance, error: balErr } = useSWR('me', api.me, { refreshInterval: 5000 })
  const { data: history } = useSWR('history', api.history, { refreshInterval: 10000 })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Billing</h1>
        <p className="text-sm text-gray-400 mt-1">Your balance and usage history</p>
      </div>

      {balance ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Balance', value: `$${balance.balance_usd.toFixed(4)}`, color: 'text-emerald-600' },
            { label: 'Total Spent', value: `$${balance.total_spent_usd.toFixed(4)}`, color: 'text-gray-900' },
            { label: 'Requests', value: balance.requests_made.toLocaleString(), color: 'text-gray-900' },
            { label: 'Tokens Used', value: balance.tokens_consumed.toLocaleString(), color: 'text-gray-900' },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-5">
              <div className="text-xs text-gray-400">{s.label}</div>
              <div className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</div>
            </div>
          ))}
        </div>
      ) : balErr ? (
        <div className="bg-red-50 rounded-2xl border border-red-200 p-5 text-red-600 text-sm">Could not load balance. Is the coordinator running?</div>
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

      <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-2xl border border-amber-200/60 p-5 flex items-center justify-between">
        <div>
          <div className="font-semibold text-gray-900">Add credits</div>
          <div className="text-sm text-gray-500">Stripe integration coming soon. Credits are pre-loaded for the beta.</div>
        </div>
        <button disabled className="px-4 py-2 bg-amber-200 text-amber-700 rounded-xl text-sm font-medium cursor-not-allowed opacity-60">Coming soon</button>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">Transaction History</h2>
        {history?.transactions && history.transactions.length > 0 ? (
          <div className="space-y-0">
            {history.transactions.slice().reverse().map((t, i) => (
              <div key={i} className="flex items-center gap-4 py-3 border-b border-gray-100 last:border-0 text-sm">
                <span className="text-xs text-gray-400 w-28">{formatDate(t.timestamp)}</span>
                <span className="font-mono text-xs text-gray-400 w-20">{t.request_id.slice(0, 10)}</span>
                <span className="text-gray-700 flex-1 truncate">{t.model}</span>
                <span className="text-gray-500 text-xs">{t.tokens.toLocaleString()} tok</span>
                <span className="font-semibold text-red-500 w-20 text-right">-${t.cost_usd.toFixed(6)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-gray-300 text-sm text-center py-8">No transactions yet</div>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-5">
        <div className="text-sm font-semibold text-gray-900 mb-3">How pricing works</div>
        <ul className="space-y-2 text-sm text-gray-500">
          <li className="flex items-start gap-2"><span className="text-amber-500 mt-0.5">-</span>Pay per token (input + output), priced per million tokens.</li>
          <li className="flex items-start gap-2"><span className="text-amber-500 mt-0.5">-</span>Each provider sets their own price. The exchange matches based on your preference.</li>
          <li className="flex items-start gap-2"><span className="text-amber-500 mt-0.5">-</span>90% goes to the provider, 10% platform fee.</li>
          <li className="flex items-start gap-2"><span className="text-amber-500 mt-0.5">-</span>Minimum charge: $0.000001 per request.</li>
        </ul>
      </div>
    </div>
  )
}
