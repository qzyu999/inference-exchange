import { useState } from 'react'
import useSWR from 'swr'
import {
  clearOperatorQueue, loadOperatorControls, quarantineProvider,
  releaseProvider, updateOperatorControls,
} from '../lib/admin-controls.js'

interface ProviderRow {
  provider_id: string
  name: string
  quarantined: boolean
  quarantine_reason?: string
  active_requests?: number
}

const actionStyle = 'rounded-lg border border-ui-border px-3 py-2 text-xs font-semibold disabled:opacity-40 hover:bg-ui-hover'

export function OperatorControlsPanel({
  providers, refreshProviders, providerListUnavailable = false,
}: {
  providers: ProviderRow[]
  refreshProviders: () => Promise<unknown>
  providerListUnavailable?: boolean
}) {
  const { data, error, isLoading, mutate } = useSWR('admin/controls', loadOperatorControls, {
    refreshInterval: 5000,
  })
  const [busy, setBusy] = useState<string | null>(null)
  const [failure, setFailure] = useState('')
  const [success, setSuccess] = useState('')
  const [limitInput, setLimitInput] = useState('2')

  async function execute(label: string, operation: () => Promise<unknown>) {
    if (busy || !data) return
    setBusy(label)
    setFailure('')
    setSuccess('')
    try {
      await operation()
      await Promise.all([mutate(), refreshProviders()])
      setSuccess(`${label} confirmed by coordinator.`)
    } catch (e) {
      setFailure(`${label} failed: ${e instanceof Error ? e.message : 'Unknown error'}`)
    } finally {
      setBusy(null)
    }
  }

  const disabled = !!busy || !data || !!error

  return (
    <section className="bg-ui-surface rounded-2xl border border-ui-border p-5 space-y-4" aria-label="Operator safety controls">
      <div>
        <h2 className="text-lg font-bold text-ui-text">Operator safety controls</h2>
        <p className="text-xs text-ui-warning mt-1">
          Runtime changes reset to configured environment values after coordinator restart.
          Keep IE_SIGNUP_DISABLED=1 until the alpha release gates pass.
        </p>
      </div>

      {isLoading && !data && <p role="status" className="text-sm text-ui-muted">Loading operator controls…</p>}
      {error && <p role="alert" className="text-sm text-ui-danger">
        Could not load admin controls: {error.message}. Check IE admin authorization and Cloudflare Access.
      </p>}
      {failure && <p role="alert" className="text-sm text-ui-danger">{failure}</p>}
      {success && <p role="status" className="text-sm text-ui-success">{success}</p>}

      {data && !error && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div className="bg-ui-surface-muted rounded-xl p-3">
              <div className="text-xs text-ui-muted">Inference</div>
              <strong className={data.inference_paused ? 'text-ui-danger' : 'text-ui-success'}>
                {data.inference_paused ? 'Paused' : 'Accepting requests'}
              </strong>
            </div>
            <div className="bg-ui-surface-muted rounded-xl p-3">
              <div className="text-xs text-ui-muted">Registration</div>
              <strong className={data.signup_disabled ? 'text-ui-warning' : 'text-ui-success'}>
                {data.signup_disabled ? 'Disabled' : 'Enabled'}
              </strong>
            </div>
            <div className="bg-ui-surface-muted rounded-xl p-3">
              <div className="text-xs text-ui-muted">Active requests</div>
              <strong>{data.active_requests_total}</strong>
            </div>
            <div className="bg-ui-surface-muted rounded-xl p-3">
              <div className="text-xs text-ui-muted">Queue / limit</div>
              <strong>{data.queue_length} / {data.queue_max_depth}</strong>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 items-center">
            <button className={actionStyle} disabled={disabled} onClick={() => {
              const next = !data.inference_paused
              if (!next && !window.confirm('Resume accepting new inference requests?')) return
              execute(next ? 'Pause inference' : 'Resume inference',
                () => updateOperatorControls({ inference_paused: next }))
            }}>
              {data.inference_paused ? 'Resume inference' : 'Pause new inference'}
            </button>
            <button className={actionStyle} disabled={disabled} onClick={() => {
              const next = !data.signup_disabled
              if (!next && !window.confirm('ENABLE PUBLIC GITHUB SIGNUP? Only proceed after all P0 alpha gates pass.')) return
              execute(next ? 'Disable signup' : 'Enable signup',
                () => updateOperatorControls({ signup_disabled: next }))
            }}>
              {data.signup_disabled ? 'Enable signup' : 'Disable signup'}
            </button>
            <button className={actionStyle} disabled={disabled || data.queue_length === 0} onClick={() => {
              if (!window.confirm(`Fail and clear ${data.queue_length} queued requests? In-flight requests continue.`)) return
              execute('Clear queue', () => clearOperatorQueue())
            }}>Clear waiting queue</button>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <label htmlFor="alpha-concurrency" className="font-medium">Per-account concurrent requests</label>
            <input
              id="alpha-concurrency" type="number" min={1} max={10} step={1}
              value={limitInput} onChange={e => setLimitInput(e.target.value)}
              className="w-20 border border-ui-border rounded-md px-2 py-1.5"
            />
            <button className={actionStyle} disabled={disabled || !/^\d+$/.test(limitInput)
              || Number(limitInput) < 1 || Number(limitInput) > 10} onClick={() => {
                const limit = Number(limitInput)
                if (!window.confirm(`Set the per-account concurrency limit to ${limit}? Currently ${data.max_concurrent_per_account}.`)) return
                execute('Update concurrency limit', () => updateOperatorControls({ max_concurrent_per_account: limit }))
              }}>Apply limit</button>
            <span className="text-ui-muted">Current: {data.max_concurrent_per_account}; UI restricts 1–10 (no unlimited setting).</span>
          </div>

          <div className="border-t border-ui-border pt-4">
            <h3 className="font-semibold text-sm mb-2">Connected provider safety</h3>
            {providerListUnavailable
              ? <p role="status" className="text-sm text-ui-warning">Provider inventory unavailable. Retry admin state before interpreting provider availability.</p>
              : providers.length === 0 ? <p className="text-sm text-ui-muted">No providers connected.</p> : (
              <div className="space-y-2">
                {providers.map(p => (
                  <div key={p.provider_id} className="flex flex-wrap gap-3 items-center justify-between bg-ui-surface-muted rounded-xl px-3 py-2">
                    <div className="text-xs">
                      <strong>{p.name}</strong>
                      <span className="text-ui-muted ml-2 font-mono">{p.provider_id}</span>
                      <span className="ml-2">{p.quarantined ? 'Quarantined' : 'Routable'}</span>
                      {p.quarantine_reason && <span className="block text-ui-muted mt-1">Reason: {p.quarantine_reason}</span>}
                    </div>
                    <button className={actionStyle} disabled={disabled} onClick={() => {
                      if (p.quarantined) {
                        if (!window.confirm(`Release provider ${p.name} (${p.provider_id}) back into routing?`)) return
                        execute('Release provider', () => releaseProvider(p.provider_id))
                        return
                      }
                      const reason = window.prompt(`Why quarantine ${p.name} (${p.provider_id})?`)
                      if (!reason?.trim()) return
                      if (!window.confirm(`Remove ${p.provider_id} from new-request routing?`)) return
                      execute('Quarantine provider', () => quarantineProvider(p.provider_id, reason.trim()))
                    }}>{p.quarantined ? 'Release provider' : 'Quarantine provider'}</button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <p className="text-xs text-ui-muted">
            Controls require an authenticated IE admin session. Protect these URLs with Cloudflare Access
            before removing the broad alpha-host Access gate (#123). All credits are simulated.
          </p>
        </>
      )}
    </section>
  )
}
