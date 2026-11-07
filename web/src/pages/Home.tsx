import { Link } from 'react-router-dom'
import useSWR from 'swr'
import { useAuth } from '../lib/auth'
import { api } from '../lib/api'
import { loginHref } from '../lib/nav.js'
import { formatUsdPrecise, microToUsd } from '../lib/money.js'
import { servedModelLabel } from '../lib/model-attribution.js'
import { recentBilledRequests, providerHomeSummary } from '../lib/home.js'

const card = 'rounded-2xl border border-ui-border bg-ui-surface p-5 md:p-6'
const action = 'inline-flex items-center justify-center rounded-xl bg-ui-action px-4 py-2.5 text-sm font-medium text-ui-on-action focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4'
const shortcut = 'text-sm text-ui-body underline underline-offset-4 hover:text-ui-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4'

export function Home() {
  const { user, loading } = useAuth()
  // Never share a personal cache entry across signed-in identities.
  const { data: account, error: accountError } = useSWR(user ? ['home/account', user.user_id] : null, api.me, { refreshInterval: 15000 })
  const { data: keys, error: keysError } = useSWR(user ? ['home/keys', user.user_id] : null, api.myKeys)
  const { data: history, error: historyError } = useSWR(user ? ['home/history', user.user_id] : null, api.history, { refreshInterval: 15000 })
  const { data: nodes, error: nodesError } = useSWR(user ? ['home/providers', user.user_id] : null, api.ownedProviderNodes, { refreshInterval: 15000 })
  const { data: earnings, error: earningsError } = useSWR(user ? ['home/earnings', user.user_id] : null, api.ownedProviderEarnings, { refreshInterval: 15000 })

  if (loading) return <p role="status" className="text-sm text-ui-muted">Loading your account…</p>
  if (!user) return <section className={`${card} max-w-xl space-y-4`}>
    <h2 className="text-lg font-semibold text-ui-text">Your Inference Exchange home</h2>
    <p className="text-sm text-ui-body">Sign in to see your usage, credits, and provider activity.</p>
    <Link className={action} to={loginHref('/home')}>Sign in</Link>
    <p><Link className={shortcut} to="/start">Getting Started</Link></p>
  </section>

  const providers = providerHomeSummary(nodes?.nodes ?? [])
  const recent = recentBilledRequests(history?.transactions ?? [])
  const hasKeys = !!keys?.keys.length
  return <div className="max-w-6xl space-y-6">
    <section aria-label="Your account">
      <p className="mb-3 text-xs text-ui-muted">Your account only · All amounts are simulated alpha credits. No real payments or payouts.</p>
      {accountError ? <Unavailable label="Account totals" /> : !account ? <Loading label="account totals" /> :
        <dl className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          {[
            ['Available credits', formatUsdPrecise(account.balance_usd)],
            ['Your spend · all time', formatUsdPrecise(account.total_spent_usd)],
            ['Billed requests · all time', account.requests_made.toLocaleString()],
            ['Tokens · all time', account.tokens_consumed.toLocaleString()],
          ].map(([label, value]) => <div key={label} className={card}><dt className="text-xs text-ui-muted">{label}</dt><dd className="mt-2 text-xl font-semibold text-ui-text break-words tabular-nums">{value}</dd></div>)}
        </dl>}
      {!accountError && account && account.balance_usd <= 0 && <p role="status" className="mt-3 text-sm text-ui-body">You have no credits available. <Link className={shortcut} to="/billing">Review your balance</Link>.</p>}
    </section>

    <div className="grid gap-5 lg:grid-cols-2">
      <section className={`${card} space-y-4`}>
        <div><h2 className="text-lg font-semibold text-ui-text">Use AI</h2><p className="mt-1 text-sm text-ui-body">Choose a model and call it from your app.</p></div>
        {keysError ? <Unavailable label="API key status" /> : !keys ? <Loading label="API key status" /> :
          <p className="text-sm text-ui-body">{hasKeys ? `${keys.keys.length} API ${keys.keys.length === 1 ? 'key' : 'keys'} ready to use.` : 'Start by creating an API key. Then send your first request with the setup guide.'}</p>}
        <div className="flex flex-wrap gap-3 items-center"><Link className={action} to={hasKeys ? '/models' : '/keys'}>{hasKeys ? 'Find a model' : 'Create an API key'}</Link><Link className={shortcut} to="/start/api">Send your first request →</Link></div>
        <div className="flex flex-wrap gap-x-5 gap-y-3 border-t border-ui-border pt-4"><Link className={shortcut} to="/keys">API keys</Link><Link className={shortcut} to="/models">Models</Link><Link className={shortcut} to="/billing">Usage & billing</Link><Link className={shortcut} to="/chat">Try in Chat</Link></div>
      </section>
      <section className={`${card} space-y-4`}>
        <div><h2 className="text-lg font-semibold text-ui-text">Provide compute</h2><p className="mt-1 text-sm text-ui-body">Connect your hardware and serve requests.</p></div>
        {nodesError ? <Unavailable label="Provider status" /> : !nodes ? <Loading label="provider status" /> : providers.total === 0 ? <>
          <p className="text-sm text-ui-body">The current preview supports Apple Silicon Macs. Check the requirements before connecting a machine.</p>
          <Link className={action} to="/provide">Connect your first machine</Link>
        </> : <>
          <p className="text-sm text-ui-body">{providers.available} of {providers.total} providers connected. {providers.offline > 0 && <Link className={shortcut} to="/dashboard">{providers.offline} offline — review status</Link>}</p>
          {earningsError ? <Unavailable label="Provider earnings" /> : !earnings ? <Loading label="provider earnings" /> : <>
            <p className="text-sm text-ui-body">{formatUsdPrecise(microToUsd(earnings.summary.earned_micro))} earned · {earnings.summary.requests_served.toLocaleString()} requests served · all time</p>
            {!earnings.summary.reconciled && <p role="alert" className="text-sm text-ui-danger">Earnings need a ledger review. <Link className={shortcut} to="/dashboard">View details</Link>.</p>}
          </>}
          <Link className={action} to="/dashboard">View provider dashboard</Link>
        </>}
        <div className="flex flex-wrap gap-x-5 gap-y-3 border-t border-ui-border pt-4"><Link className={shortcut} to="/provide">Setup & requirements</Link><Link className={shortcut} to="/dashboard">Your providers</Link></div>
      </section>
    </div>

    <section className={`${card} space-y-4`}>
      <div className="flex flex-wrap justify-between gap-3 items-center"><div><h2 className="text-lg font-semibold text-ui-text">Recent billed requests</h2><p className="mt-1 text-xs text-ui-muted">Your latest 5 ledger entries, newest first. Failed and unbilled attempts are not included.</p></div><Link className={shortcut} to="/billing">View billing →</Link></div>
      {historyError ? <Unavailable label="Recent requests" /> : !history ? <Loading label="recent requests" /> : recent.length === 0 ?
        <p className="text-sm text-ui-body">No billed requests yet. <Link className={shortcut} to="/start/api">Send your first request</Link> to see it here.</p> :
        <ul className="divide-y divide-ui-border">{recent.map(row => <li key={row.full_request_id || row.request_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div className="min-w-0"><p className="text-sm font-medium text-ui-text break-words">{servedModelLabel(row)}</p><time className="text-xs text-ui-muted" dateTime={new Date(row.timestamp * 1000).toISOString()}>{new Date(row.timestamp * 1000).toLocaleString()}</time></div>
          <span className="text-sm text-ui-body tabular-nums">{row.tokens.toLocaleString()} tokens · {formatUsdPrecise(microToUsd(row.cost_micro ?? Math.round(row.cost_usd * 1_000_000)))}</span>
        </li>)}</ul>}
    </section>
    <div className="flex flex-wrap items-center justify-between gap-4 text-sm text-ui-body"><p>Looking for activity across Inference Exchange?</p><div className="flex gap-5"><Link className={shortcut} to="/overview">Network overview →</Link><Link className={shortcut} to="/start">Getting Started</Link></div></div>
  </div>
}

function Loading({ label }: { label: string }) { return <p role="status" className="text-sm text-ui-muted">Loading {label}…</p> }
function Unavailable({ label }: { label: string }) { return <p role="alert" className="text-sm text-ui-danger">{label} unavailable. Try again shortly.</p> }
