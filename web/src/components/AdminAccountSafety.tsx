import { useState } from 'react'
import useSWR from 'swr'
import {
  listAdminAccounts, suspendAdminAccount, restoreAdminAccount,
  type AdminAccount,
} from '../lib/admin-controls.js'

const actionClass = 'rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold disabled:opacity-40 hover:bg-gray-50'

// This panel is mounted only after /v1/auth/me confirms current admin authorization.
// Every action still requires IE admin auth and Cloudflare Access on the server.
export function AdminAccountSafety({ currentUserId }: { currentUserId: string }) {
  const { data, error, isLoading, mutate } = useSWR(
    'admin/accounts', listAdminAccounts, { refreshInterval: 15000 },
  )
  const [filter, setFilter] = useState('')
  const [durationHours, setDurationHours] = useState('1')
  const [busy, setBusy] = useState<string | null>(null)
  const [failure, setFailure] = useState('')
  const [success, setSuccess] = useState('')

  const accounts = (data?.accounts ?? []).filter(account => {
    const term = filter.trim().toLowerCase()
    return !term || account.email.toLowerCase().includes(term) || account.user_id.toLowerCase().includes(term)
  })
  const displayed = accounts.slice(0, 25)

  async function act(account: AdminAccount, restore: boolean) {
    if (busy || !data || error || account.user_id === currentUserId) return

    const reason = window.prompt(
      restore
        ? `Reason to restore account ${account.email} (${account.user_id})?`
        : `Reason to suspend account ${account.email} (${account.user_id})?`,
    )
    if (!reason?.trim()) return

    const seconds = Number(durationHours) * 3600
    const warning = restore
      ? `Restore account ${account.email} (${account.user_id})? The account may sign in and use existing valid API keys again.`
      : `Suspend ${account.email} (${account.user_id}) for ${durationHours} hour(s)? This ends browser sessions and blocks all API keys. IMPORTANT: If this account owns a provider, its provider connection will also be disconnected. Never select the original production provider owner for a consumer drill.`
    if (!window.confirm(warning)) return

    setBusy(account.user_id)
    setSuccess('')
    setFailure('')
    try {
      const response = restore
        ? await restoreAdminAccount(account.user_id, reason.trim())
        : await suspendAdminAccount(account.user_id, reason.trim(), seconds)
      if (!response.ok) throw new Error('Coordinator did not confirm the account action')
      // A POST response alone is not evidence of the new account state.
      const refreshed = await mutate()
      const confirmed = refreshed?.accounts.find(a => a.user_id === account.user_id)
      if (!confirmed || confirmed.suspended === restore) {
        throw new Error('Action was submitted, but account-state readback was not confirmed. Refresh the list before taking another action.')
      }
      setSuccess(`${restore ? 'Restore' : 'Suspension'} confirmed by coordinator for ${account.user_id}.`)
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'Account action failed. Refresh before retrying.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section aria-label="Account safety" className="bg-white rounded-2xl border border-gray-200/60 p-5 space-y-4">
      <div>
        <h2 className="text-lg font-bold text-gray-900">Account safety</h2>
        <p className="text-xs text-amber-800 mt-1">
          Suspend only verified test consumer accounts during alpha drills. Suspending a provider owner also disconnects its providers. Never suspend the original production provider owner.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="space-y-1">
          <span className="block font-medium">Find account by email or ID</span>
          <input type="search" value={filter} onChange={e => setFilter(e.target.value)}
            placeholder="Search accounts" className="border border-gray-300 rounded-lg px-3 py-2" />
        </label>
        <label className="space-y-1">
          <span className="block font-medium">Temporary suspension</span>
          <select value={durationHours} onChange={e => setDurationHours(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2">
            <option value="1">1 hour</option>
            <option value="24">24 hours</option>
          </select>
        </label>
        <button type="button" className={actionClass} disabled={!!busy}
          onClick={() => { void mutate() }}>Refresh account list</button>
      </div>

      {isLoading && !data && <p role="status" className="text-sm text-gray-500">Loading accounts…</p>}
      {error && <p role="alert" className="text-sm text-red-700">Account inventory unavailable: {error.message}. No actions permitted.</p>}
      {failure && <p role="alert" className="text-sm text-red-700">{failure}</p>}
      {success && <p role="status" className="text-sm text-emerald-700">{success}</p>}

      {data && !error && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500">Showing {displayed.length} of {accounts.length} matching accounts. User IDs are IE accounts, not provider connection IDs.</p>
          {displayed.length === 0 && <p className="text-sm text-gray-500">No matching accounts.</p>}
          {displayed.map(account => (
            <div key={account.user_id} className="rounded-lg bg-gray-50 px-3 py-3 flex flex-wrap gap-3 items-center justify-between">
              <div className="text-xs min-w-0">
                <strong className="block break-all">{account.email || account.name || account.user_id}</strong>
                <span className="font-mono text-gray-500 break-all">{account.user_id}</span>
                <span className="block text-gray-600">
                  {account.role} · {account.active_keys} active keys · {account.suspended
                    ? account.suspension_permanent ? 'Banned' : 'Temporarily suspended'
                    : 'Active'}
                </span>
                {account.suspended && account.suspension_reason &&
                  <span className="block text-gray-500">Reason: {account.suspension_reason}</span>}
              </div>
              <button type="button" className={actionClass}
                disabled={!!busy || account.user_id === currentUserId}
                title={account.user_id === currentUserId ? 'Cannot change your own operator account here' : undefined}
                onClick={() => { void act(account, account.suspended) }}>
                {account.user_id === currentUserId ? 'Current operator' :
                  account.suspended ? 'Restore account' : 'Suspend temporarily'}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
