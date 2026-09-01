import useSWR from 'swr'
import { api } from '../lib/api'

function formatDate(ts: number) {
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export function Billing() {
  const { data: balance, error: balErr } = useSWR('balance', api.balance, { refreshInterval: 5000 })
  const { data: history } = useSWR('history', api.history, { refreshInterval: 10000 })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-1">Billing</h1>
        <p className="text-sm text-gray-500">Your account balance and usage history.</p>
      </div>

      {/* Balance cards */}
      {balance ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg border border-gray-200 p-5">
            <div className="text-xs text-gray-500 uppercase tracking-wide">Balance</div>
            <div className="text-3xl font-bold text-green-600 mt-1">${balance.balance_usd.toFixed(4)}</div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-5">
            <div className="text-xs text-gray-500 uppercase tracking-wide">Total Spent</div>
            <div className="text-3xl font-bold mt-1">${balance.total_spent_usd.toFixed(4)}</div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-5">
            <div className="text-xs text-gray-500 uppercase tracking-wide">Requests</div>
            <div className="text-3xl font-bold mt-1">{balance.requests_made.toLocaleString()}</div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-5">
            <div className="text-xs text-gray-500 uppercase tracking-wide">Tokens Used</div>
            <div className="text-3xl font-bold mt-1">{balance.tokens_consumed.toLocaleString()}</div>
          </div>
        </div>
      ) : balErr ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
          Could not load balance. Is the coordinator running?
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => (
            <div key={i} className="bg-white rounded-lg border border-gray-200 p-5 animate-pulse">
              <div className="h-3 bg-gray-200 rounded w-20 mb-2" />
              <div className="h-8 bg-gray-200 rounded w-28" />
            </div>
          ))}
        </div>
      )}

      {/* Deposit CTA */}
      <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 flex items-center justify-between">
        <div>
          <div className="font-semibold text-purple-800">Add Credits</div>
          <div className="text-sm text-purple-700">Stripe integration coming soon. Credits are pre-loaded for the POC.</div>
        </div>
        <button disabled className="px-4 py-2 bg-purple-300 text-white rounded-lg text-sm font-medium cursor-not-allowed">
          Deposit (coming soon)
        </button>
      </div>

      {/* Transaction history */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Transaction History</h2>
        {history?.transactions && history.transactions.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 uppercase border-b">
                  <th className="py-2 px-3 text-left">Time</th>
                  <th className="py-2 px-3 text-left">Request</th>
                  <th className="py-2 px-3 text-left">Model</th>
                  <th className="py-2 px-3 text-right">Tokens</th>
                  <th className="py-2 px-3 text-right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {history.transactions.slice().reverse().map((t, i) => (
                  <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2 px-3 text-xs text-gray-500">{formatDate(t.timestamp)}</td>
                    <td className="py-2 px-3 font-mono text-xs">{t.request_id.slice(0, 10)}</td>
                    <td className="py-2 px-3">{t.model}</td>
                    <td className="py-2 px-3 text-right">{t.tokens.toLocaleString()}</td>
                    <td className="py-2 px-3 text-right text-red-500">-${t.cost_usd.toFixed(6)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-gray-400 text-sm">No transactions yet. Send a chat request to see billing here.</div>
        )}
      </div>

      {/* Cost breakdown info */}
      <div className="bg-gray-50 rounded-lg border border-gray-200 p-4 text-sm text-gray-600">
        <div className="font-semibold text-gray-700 mb-2">How Pricing Works</div>
        <ul className="space-y-1 list-disc list-inside">
          <li>You pay per token (input + output), priced per million tokens (Mtok).</li>
          <li>Each provider sets their own price. The matching engine routes based on your preference.</li>
          <li>90% of your payment goes to the provider, 10% platform fee.</li>
          <li>Minimum charge: $0.000001 per request (sub-cent billing).</li>
        </ul>
      </div>
    </div>
  )
}
