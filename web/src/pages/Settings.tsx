import { Link } from 'react-router-dom'
import useSWR from 'swr'
import { useAuth } from '../lib/auth'
import { api } from '../lib/api'
import { loginHref } from '../lib/nav.js'
import { formatUsdPrecise, microToUsd } from '../lib/money.js'
import { C, APP_TEXT } from '../lib/theme'

// This page is for every IE user, not Cloudflare Access operators.
// All provider requests use the server-derived owner from the IE session.
export function Settings() {
  const { user, loading, logout } = useAuth()
  const { data: nodes, error: nodeError } = useSWR(
    user ? ['settings/provider-nodes', user.user_id] : null,
    api.ownedProviderNodes,
  )
  const { data: earnings, error: earningsError } = useSWR(
    user ? ['settings/provider-earnings', user.user_id] : null,
    api.ownedProviderEarnings,
  )

  if (loading) return <p role="status" className="text-sm text-gray-500">Loading account…</p>

  if (!user) return (
    <section className="max-w-xl rounded-2xl bg-white p-6 space-y-3">
      <h2 className="text-lg font-semibold" style={{ color: C.blueBlack }}>Sign in to manage Settings</h2>
      <p className="text-sm text-gray-600">Use your GitHub account to view your account and provider information.</p>
      <Link to={loginHref('/settings')} className="underline text-sm" style={{ color: APP_TEXT.gold }}>Sign in with GitHub</Link>
    </section>
  )

  const owned = nodes?.nodes ?? []
  const summary = earnings?.summary

  return (
    <div className="max-w-4xl space-y-5">
      <section className="bg-white rounded-2xl border border-gray-200/60 p-6 space-y-3">
        <h2 className="text-lg font-semibold" style={{ color: C.blueBlack }}>Your IE account</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div><dt className="text-gray-500">Name</dt><dd className="font-medium">{user.name || '—'}</dd></div>
          <div><dt className="text-gray-500">Email</dt><dd className="font-medium break-all">{user.email}</dd></div>
          <div><dt className="text-gray-500">IE account ID</dt><dd className="font-mono break-all">{user.user_id}</dd></div>
          <div><dt className="text-gray-500">Account balance (simulated)</dt><dd className="font-medium">{formatUsdPrecise(user.balance_usd)}</dd></div>
        </dl>
      </section>

      <section className="bg-white rounded-2xl border border-gray-200/60 p-6 space-y-3">
        <h2 className="text-lg font-semibold" style={{ color: C.blueBlack }}>Account and security</h2>
        <p className="text-sm text-gray-600">Use your IE session to manage your simulated credits and API keys.</p>
        <div className="flex flex-wrap gap-4 text-sm">
          <Link to="/keys" className="underline" style={{ color: APP_TEXT.gold }}>Manage API keys</Link>
          <Link to="/billing" className="underline" style={{ color: APP_TEXT.gold }}>Balance and billing</Link>
          <button type="button" className="underline" style={{ color: APP_TEXT.gold }}
            onClick={() => { void logout() }}>Sign out</button>
        </div>
      </section>

      <section id="provider-nodes" className="bg-white rounded-2xl border border-gray-200/60 p-6 space-y-3">
        <h2 className="text-lg font-semibold" style={{ color: C.blueBlack }}>Your provider nodes</h2>
        {nodeError || earningsError ? (
          <p role="alert" className="text-sm text-red-700">Provider information is unavailable. Try again later.</p>
        ) : !nodes || !earnings ? (
          <p role="status" className="text-sm text-gray-500">Loading your provider information…</p>
        ) : owned.length === 0 ? (
          <p className="text-sm text-gray-600">No provider nodes belong to this account. <Link to="/provide" className="underline" style={{ color: APP_TEXT.gold }}>Learn about providing compute</Link>.</p>
        ) : (
          <>
            <p className="text-xs text-gray-500">
              Provider earnings are simulated credits, not payments. Historical earnings exclude starting grants.
            </p>
            <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <div><dt className="text-gray-500">All-time earnings</dt><dd className="font-semibold">{formatUsdPrecise(microToUsd(summary?.earned_micro ?? 0))}</dd></div>
              <div><dt className="text-gray-500">Requests served</dt><dd className="font-semibold">{summary?.requests_served ?? 0}</dd></div>
              <div><dt className="text-gray-500">Ledger reconciliation</dt><dd className="font-semibold">{summary?.reconciled ? 'Matched' : 'Needs review'}</dd></div>
            </dl>
            <ul className="divide-y divide-gray-100">
              {owned.map(node => (
                <li key={node.node_id} className="py-3 text-sm space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong style={{ color: C.blueBlack }}>{node.name}</strong>
                    <span className="text-gray-600 capitalize">{node.status} · {node.active_connections} connections</span>
                  </div>
                  <div className="text-xs text-gray-500">{node.hardware_claim || 'Hardware not reported'} · {node.models.length ? node.models.join(', ') : 'No model currently online'}</div>
                  <div className="font-mono text-[11px] text-gray-400">{node.node_id}</div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  )
}
