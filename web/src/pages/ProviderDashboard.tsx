import { Link } from 'react-router-dom'
import useSWR from 'swr'
import { useAuth } from '../lib/auth'
import { api } from '../lib/api'
import { loginHref } from '../lib/nav.js'
import { formatUsdPrecise, microToUsd } from '../lib/money.js'
import { UI } from '../lib/theme'

/**
 * Read-only owner dashboard. All data comes from authenticated, owner-scoped
 * coordinator APIs (PRIV-009, BILL-011). Never render synthetic earnings,
 * attestation, utilization, ranking, or credential material.
 */
export function ProviderDashboard() {
  const { user, loading } = useAuth()
  // Account-specific cache keys prevent one browser user's prior provider data
  // from being rendered for another account after sign-out or account switch.
  const { data: nodes, error: nodeError } = useSWR(
    user ? ['dashboard/provider-nodes', user.user_id] : null,
    api.ownedProviderNodes,
  )
  const { data: earnings, error: earningsError } = useSWR(
    user ? ['dashboard/provider-earnings', user.user_id] : null,
    api.ownedProviderEarnings,
  )

  if (loading) return <p role="status" className="text-sm text-ui-muted">Loading your account…</p>
  if (!user) {
    return (
      <section className="max-w-xl rounded-2xl border bg-ui-surface p-6 space-y-3">
        <h2 className="font-semibold text-lg" style={{ color: UI.text }}>Your provider dashboard</h2>
        <p className="text-sm text-ui-body">
          Sign in with your IE GitHub account to see only the provider nodes and simulated earnings that belong to you.
        </p>
        <Link to={loginHref('/dashboard')} className="inline-block underline text-sm" style={{ color: UI.accent }}>
          Sign in with GitHub
        </Link>
      </section>
    )
  }

  const list = nodes?.nodes ?? []
  const summary = earnings?.summary
  const byNode = new Map((earnings?.by_node ?? []).map(entry => [entry.node_id, entry]))

  return (
    <div className="max-w-5xl space-y-5">
      <section className="bg-ui-surface rounded-2xl border border-ui-border p-6 space-y-3">
        <div className="flex flex-wrap justify-between items-center gap-3">
          <h2 className="font-semibold text-lg" style={{ color: UI.text }}>Your provider activity</h2>
          <Link to="/provide" className="text-sm underline" style={{ color: UI.accent }}>
            Provider setup and requirements
          </Link>
        </div>
        <p className="text-xs text-ui-muted">
          Every amount below is in simulated credits. There are no real payouts or withdrawals.
        </p>
        {nodeError || earningsError ? (
          <p role="alert" className="text-sm text-ui-danger">
            Provider information is unavailable. Your previous values are not shown. Try again later.
          </p>
        ) : !nodes || !earnings ? (
          <p role="status" className="text-sm text-ui-muted">Loading live node and earnings data…</p>
        ) : (
          <>
            <dl className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { label: 'Total earned (simulated)', value: formatUsdPrecise(microToUsd(summary?.earned_micro ?? 0)) },
                { label: 'Earned today (UTC)', value: formatUsdPrecise(microToUsd(summary?.today_earned_micro ?? 0)) },
                { label: 'Requests served', value: String(summary?.requests_served ?? 0) },
                { label: 'Ledger check', value: summary?.reconciled ? 'Matched' : 'Needs review' },
              ].map(item => (
                <div key={item.label} className="rounded-xl border border-ui-border p-4">
                  <dt className="text-xs text-ui-muted">{item.label}</dt>
                  <dd className="mt-1 text-lg font-semibold break-words" style={{ color: UI.text }}>{item.value}</dd>
                </div>
              ))}
            </dl>
            {!summary?.reconciled && (
              <p role="alert" className="text-sm text-ui-danger">
                Recorded account earnings do not reconcile with the transaction ledger.
              </p>
            )}
            {list.length === 0 ? (
              <div className="rounded-xl bg-ui-surface-muted p-4 text-sm text-ui-body">
                No provider nodes belong to this account. <Link className="underline" to="/provide">See provider requirements</Link>.
              </div>
            ) : (
              <ul className="space-y-3">
                {list.map(node => {
                  const credited = byNode.get(node.node_id)
                  return (
                    <li key={node.node_id} className="rounded-xl border border-ui-border p-4 space-y-3">
                      <div className="flex flex-wrap gap-2 items-start justify-between">
                        <div>
                          <h3 className="font-semibold" style={{ color: UI.text }}>{node.name}</h3>
                          <p className="text-xs text-ui-muted font-mono break-all">{node.node_id}</p>
                        </div>
                        <span className="text-xs text-ui-body capitalize">
                          {node.status} · {node.active_connections} active connections
                        </span>
                      </div>
                      <dl className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
                        <div><dt className="text-xs text-ui-muted">Models observed online</dt>
                          <dd>{node.models.length ? node.models.join(', ') : 'No model currently online'}</dd></div>
                        <div><dt className="text-xs text-ui-muted">Hardware declaration</dt>
                          <dd>{node.hardware_claim || 'Not reported'}</dd></div>
                        <div><dt className="text-xs text-ui-muted">Trust</dt>
                          <dd>Claimed: {node.claimed_trust_level || 'Not reported'} · Verified: {node.verified_trust_level || 'Not verified'}</dd></div>
                        <div><dt className="text-xs text-ui-muted">Output ask</dt>
                          <dd>{typeof node.price_output_per_mtok === 'number' ? '$' + node.price_output_per_mtok.toString() + ' / 1M tokens' : 'Not currently advertised'}</dd></div>
                        <div><dt className="text-xs text-ui-muted">Earned (simulated)</dt>
                          <dd>{credited ? formatUsdPrecise(microToUsd(credited.earned_micro)) : 'Unavailable'}</dd></div>
                        <div><dt className="text-xs text-ui-muted">Requests served</dt>
                          <dd>{credited ? credited.requests_served : 'Unavailable'}</dd></div>
                      </dl>
                      {credited && !credited.reconciled && (
                        <p role="alert" className="text-xs text-ui-danger">This node has a ledger mismatch.</p>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        )}
      </section>
    </div>
  )
}
