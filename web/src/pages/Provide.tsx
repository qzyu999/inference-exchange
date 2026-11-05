import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import useSWR from 'swr'
import { useAuth } from '../lib/auth'
import { api } from '../lib/api'
import { loginHref } from '../lib/nav.js'
import {
  enrollSelfServiceProvider,
  listSelfServiceCredentials,
  revokeSelfServiceCredential,
  type ProviderEnrollmentReceipt,
} from '../lib/provider-enrollment.js'
import { UI } from '../lib/theme'
import { ProviderMacSetup } from '../components/ProviderMacSetup'

/** One-time secret lives only in this mounted component, not SWR/browser storage. */
function EnrollmentWizard({ userId }: { userId: string }) {
  const { data: credentials, error: credentialsError, mutate: refreshCredentials, isLoading: loadingCredentials } = useSWR(
    ['provide/credentials', userId],
    listSelfServiceCredentials,
    { revalidateOnFocus: false },
  )
  const { data: nodes, error: nodesError, mutate: refreshNodes } = useSWR(
    ['provide/nodes', userId],
    api.ownedProviderNodes,
    { revalidateOnFocus: false },
  )
  const [name, setName] = useState('my-mac-mini')
  const [understandTrust, setUnderstandTrust] = useState(false)
  const [issued, setIssued] = useState<ProviderEnrollmentReceipt | null>(null)
  const [savedSecret, setSavedSecret] = useState(false)
  const [showSecret, setShowSecret] = useState(false)
  const [copyState, setCopyState] = useState('')
  const [pending, setPending] = useState(false)
  const [revokeConfirm, setRevokeConfirm] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const active = credentials?.credentials.filter(item => item.revoked_at == null) ?? []
  const hasActive = active.length > 0

  async function onEnroll(event: FormEvent) {
    event.preventDefault()
    if (pending || issued || hasActive || !understandTrust || loadingCredentials || credentialsError) return
    setPending(true)
    setError('')
    setNotice('')
    try {
      const receipt = await enrollSelfServiceProvider(name.trim())
      // Never pass this one-time receipt to SWR, a log or a URL.
      setIssued(receipt)
      setSavedSecret(false)
      setShowSecret(false)
      setCopyState('')
      void refreshCredentials()
      void refreshNodes()
    } catch (cause) {
      const failure = cause as Error & { status?: number }
      if (failure.status === 503) {
        setError('Enrollment is not enabled on this coordinator yet. You can still review requirements and your existing nodes.')
      } else if (failure.status === 409) {
        setError('This account already has an active self-service credential. Revoke it first if you need to enroll another node.')
        void refreshCredentials()
      } else if (failure.status === 429) {
        setError('Enrollment rate or daily issuance limit reached. Try later. Repeated revocation does not reset the daily limit.')
      } else if (failure.status === 403) {
        setError('This account is not eligible to enroll. A linked, unsuspended GitHub identity is required.')
      } else if (failure.status === 401) {
        setError('Your session is no longer valid. Sign in again.')
      } else if (failure.status === 400) {
        setError('The name or hardware profile was rejected. Check the node name and try again.')
      } else {
        setError('Enrollment failed. ' + (failure.message || 'Please retry.'))
      }
    } finally {
      setPending(false)
    }
  }

  async function onCopy() {
    if (!issued) return
    try {
      await navigator.clipboard.writeText(issued.credential.token)
      setCopyState('Copied. Clear your clipboard after saving the secret in a secure location.')
    } catch {
      setCopyState('Clipboard copy is unavailable. You can reveal and select the credential manually.')
    }
  }

  async function onRevoke(tokenId: string) {
    if (revoking || issued || revokeConfirm !== tokenId) return
    setRevoking(tokenId)
    setError('')
    setNotice('')
    try {
      const result = await revokeSelfServiceCredential(tokenId)
      setRevokeConfirm(null)
      setNotice(`Credential revoked. ${result.disconnected.length} connected provider session(s) were disconnected. This credential cannot reconnect.`)
      await Promise.all([refreshCredentials(), refreshNodes()])
    } catch (cause) {
      const failure = cause as Error & { status?: number }
      if (failure.status === 404) {
        setError('Credential not found or already revoked. Refresh the list.')
        void refreshCredentials()
      } else if (failure.status === 401 || failure.status === 403) {
        setError('Credential revocation was denied. Check your account session.')
      } else {
        setError('Revocation failed. ' + (failure.message || 'Please retry.'))
      }
    } finally {
      setRevoking(null)
    }
  }

  const onlineById = new Map((nodes?.nodes ?? []).map(node => [node.node_id, node]))

  return (
    <div className="space-y-5">
      <section className="bg-ui-surface rounded-2xl border border-ui-border p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-lg font-semibold" style={{ color: UI.text }}>1. Your provider credentials</h3>
          <Link to="/dashboard" className="text-sm underline" style={{ color: UI.accent }}>Private node and earnings dashboard</Link>
        </div>
        <p className="text-sm text-ui-body">
          Only self-service credentials created by this IE account appear below. Operator-issued
          credentials are intentionally not manageable here.
        </p>
        {credentialsError || nodesError ? (
          <p role="alert" className="text-sm text-ui-danger">Provider information is unavailable. Enrollment is paused until this view loads.</p>
        ) : !credentials || !nodes ? (
          <p role="status" className="text-sm text-ui-muted">Loading your provider credentials…</p>
        ) : credentials.credentials.length === 0 ? (
          <p className="text-sm text-ui-muted">No self-service credentials have been issued to this account.</p>
        ) : (
          <ul className="space-y-3">
            {credentials.credentials.map(item => {
              const node = onlineById.get(item.node_id)
              const revoked = item.revoked_at != null
              return (
                <li key={item.token_id} className="rounded-xl border border-ui-border p-4 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <strong style={{ color: UI.text }}>{item.name}</strong>
                    <span className="text-ui-body">
                      {revoked ? 'Revoked' : (node?.status ?? 'Offline')} · {node?.active_connections ?? 0} connection(s)
                    </span>
                  </div>
                  <p className="font-mono text-xs text-ui-muted break-all">Node: {item.node_id}</p>
                  <p className="font-mono text-xs text-ui-muted break-all">Credential ID: {item.token_id}</p>
                  <p className="text-xs text-ui-muted">
                    {revoked ? 'This credential cannot connect again.' : 'Secret was shown only at issuance.'}
                  </p>
                  {!revoked && !issued && (
                    revokeConfirm === item.token_id ? (
                      <div className="space-y-2">
                        <p className="text-xs text-ui-danger">
                          Revoke this credential? Connected provider sessions will be disconnected.
                          This does not delete past earnings or automatically rotate the credential.
                        </p>
                        <div className="flex gap-3 flex-wrap">
                          <button type="button" disabled={revoking !== null} onClick={() => void onRevoke(item.token_id)}
                            className="rounded-lg bg-ui-danger-action text-ui-on-action px-3 py-2 text-xs font-medium">
                            {revoking === item.token_id ? 'Revoking…' : 'Confirm revocation'}
                          </button>
                          <button type="button" disabled={revoking !== null} onClick={() => setRevokeConfirm(null)}
                            className="text-xs underline text-ui-body">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <button type="button" onClick={() => setRevokeConfirm(item.token_id)}
                        className="text-xs underline text-ui-danger">Revoke self-service credential</button>
                    )
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {issued ? (
        <section className="bg-ui-surface rounded-2xl border-2 border-ui-warning p-6 space-y-4" aria-label="One-time provider credential">
          <h3 className="text-lg font-semibold" style={{ color: UI.text }}>2. Save your new provider credential</h3>
          <p role="alert" className="text-sm text-ui-warning font-medium">
            This secret is shown only once. Reloading, closing, or leaving this page loses it.
            IE stores a hash, not a recoverable copy.
          </p>
          <p className="text-xs font-mono break-all text-ui-muted">Node: {issued.node.node_id}</p>
          <label className="block space-y-2">
            <span className="text-xs text-ui-muted">One-time credential</span>
            <input type={showSecret ? 'text' : 'password'} readOnly autoComplete="off" spellCheck={false}
              aria-label="One-time provider credential" value={issued.credential.token}
              className="w-full rounded-lg border border-ui-border p-3 font-mono text-xs" />
          </label>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={() => void onCopy()} className="px-4 py-2 rounded-lg text-sm bg-ui-action text-ui-on-action">Copy credential</button>
            <button type="button" onClick={() => setShowSecret(value => !value)} className="px-4 py-2 rounded-lg border text-sm">
              {showSecret ? 'Hide secret' : 'Reveal secret'}
            </button>
          </div>
          {copyState && <p role="status" className="text-xs text-ui-body">{copyState}</p>}
          <p className="text-xs text-ui-body">
            Save in a secure, private location. Never put the secret in a URL, shell command argument,
            shared screenshot, issue, log, or public repository. The agent must send it in the
            WebSocket Authorization header, not a query string.
          </p>
          <label className="flex gap-2 items-start text-sm text-ui-body">
            <input type="checkbox" checked={savedSecret} onChange={event => setSavedSecret(event.target.checked)}
              className="mt-1" />
            I saved the secret securely and understand it cannot be displayed again.
          </label>
          <button type="button" disabled={!savedSecret} onClick={() => { setIssued(null); setSavedSecret(false); setCopyState(''); setShowSecret(false) }}
            className="px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
            style={{ background: UI.action, color: UI.onAction }}>
            Done — hide credential
          </button>
        </section>
      ) : (
        <section className="bg-ui-surface rounded-2xl border border-ui-border p-6 space-y-4">
          <h3 className="text-lg font-semibold" style={{ color: UI.text }}>2. Enroll an L0 Mac</h3>
          <p className="text-sm text-ui-body">
            Create one active self-service node per account. Existing operator-managed nodes do not
            use this limit. The alpha may keep enrollment disabled until the independent Mac smoke test passes.
          </p>
          {hasActive && (
            <p className="text-sm text-ui-warning">
              An active self-service credential already exists. Use it on your enrolled Mac.
              To replace a lost credential, revoke it above; a new enrollment creates a new node,
              not a rotation of your prior node or its financial history.
            </p>
          )}
          <form className="space-y-4" onSubmit={event => void onEnroll(event)}>
            <label className="block space-y-1 text-sm">
              <span className="font-medium" style={{ color: UI.text }}>Mac display name</span>
              <input value={name} maxLength={64} required pattern="[A-Za-z0-9][A-Za-z0-9 _.-]*"
                onChange={event => setName(event.target.value)}
                className="block w-full max-w-md border rounded-lg px-3 py-2"
                placeholder="my-mac-mini" />
              <span className="block text-xs text-ui-muted">Letters, numbers, spaces, periods, underscores and hyphens. The first character must be a letter or number.</span>
            </label>
            <div className="rounded-lg bg-ui-surface-muted p-3 text-xs text-ui-body">
              <strong>Declared profile:</strong> Apple Silicon + macOS + GGUF/Metal · L0/Open.
              Hardware claims are self-reported, not verified or attested. DGX Spark, CUDA,
              Linux, L1 and L2 are not offered here.
            </div>
            <label className="flex gap-2 text-sm items-start">
              <input type="checkbox" checked={understandTrust} onChange={event => setUnderstandTrust(event.target.checked)}
                className="mt-1" />
              My machine uses this profile. I understand the provider operator can access plaintext,
              and this does not offer confidential inference or attestation.
            </label>
            <button type="submit"
              disabled={!understandTrust || pending || hasActive || loadingCredentials || !!credentialsError || !credentials || !nodes}
              className="px-4 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50"
              style={{ background: UI.action, color: UI.onAction }}>
              {pending ? 'Enrolling…' : hasActive ? 'Active credential limit reached' : 'Enroll provider (subject to alpha gate)'}
            </button>
          </form>
          <p className="text-xs text-ui-muted">
            If the coordinator returns HTTP 503, enrollment is not yet enabled. No credential is issued.
            A failed attempt may also be rate-limited. Simulated credits are not payouts.
          </p>
        </section>
      )}

      {error && <p role="alert" className="rounded-lg bg-ui-danger-surface p-3 text-sm text-ui-danger">{error}</p>}
      {notice && <p role="status" className="rounded-lg bg-ui-success-surface p-3 text-sm text-ui-success">{notice}</p>}
    </div>
  )
}

export function Provide() {
  const { user, loading } = useAuth()

  return (
    <div className="max-w-4xl space-y-6">
      <section className="bg-ui-surface rounded-2xl border border-ui-border p-6 md:p-8 space-y-4">
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: UI.accent }}>
          Provider preview · Apple Silicon · L0/Open
        </p>
        <h2 className="text-2xl font-bold" style={{ color: UI.text }}>Provide compute from your Mac</h2>
        <p className="text-sm leading-relaxed text-ui-body">
          An outbound, authenticated WebSocket connects your local inference provider to IE.
          The provider operator can inspect plaintext at L0. No confidentiality or hardware
          attestation is claimed. Initial support is macOS Apple Silicon with a GGUF model and
          a Metal-enabled llama.cpp inference server.
        </p>
        <div className="rounded-xl bg-ui-warning-surface p-4 text-sm text-ui-warning">
          <strong>Private-alpha availability:</strong> Provider enrollment is disabled by default while
          independent Mac setup is qualified. This is a temporary testing restriction, not how
          enrollment will work in general release: providers should be able to enroll on demand.
          This page cannot verify the live global gate; an HTTP 503 means enrollment is unavailable.
          Consumer testers do not need to enroll a provider. Real payouts are not available.
        </div>
        {loading ? <p role="status" className="text-sm text-ui-muted">Checking your account…</p> :
          !user ? (
            <Link to={loginHref('/provide')} className="inline-block px-4 py-2.5 rounded-xl text-sm font-semibold"
              style={{ background: UI.action, color: UI.onAction }}>Sign in with GitHub</Link>
          ) : (
            <p className="text-xs text-ui-muted">Signed in as {user.name || user.email}. Credential
              management is restricted to this IE account.</p>
          )}
      </section>

      {!loading && user && <EnrollmentWizard key={user.user_id} userId={user.user_id} />}

      <ProviderMacSetup />

      <section className="bg-ui-surface rounded-2xl border border-ui-border p-6 space-y-3">
        <h3 className="font-semibold" style={{ color: UI.text }}>Security and earnings</h3>
        <p className="text-sm text-ui-body">
          Provider hardware and trust claims are not independently verified at L0.
          Consumer requests may contain plaintext. Earnings are simulated credits,
          with no withdrawal or payout capability.
        </p>
        <div className="flex gap-3 flex-wrap">
          <Link to="/dashboard" className="text-sm underline" style={{ color: UI.accent }}>Live owner dashboard</Link>
          <Link to="/settings" className="text-sm underline" style={{ color: UI.accent }}>Settings</Link>
          <Link to="/billing" className="text-sm underline" style={{ color: UI.accent }}>Account billing</Link>
        </div>
      </section>
      <p className="text-xs text-ui-muted">
        <a href="https://github.com/qzyu999/inference-exchange/blob/main/docs/guides/provider-l0-apple-silicon-preview.md"
          target="_blank" rel="noopener noreferrer" className="underline">
          Experimental Apple Silicon OCIP setup (not yet qualified)
        </a>
        {' '}describes current agent flags and a candidate outbound connection. It has not
        passed independent self-service hardware acceptance testing. The older{' '}
        <a href="https://github.com/qzyu999/inference-exchange/blob/main/docs/guides/getting-started.md"
          target="_blank" rel="noopener noreferrer" className="underline">developer-only setup guide</a>
        {' '}uses local and operator-managed flows; do not use it as a public-alpha installation procedure.
      </p>
    </div>
  )
}
