import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { Link } from 'react-router-dom'
import { api, post } from '../lib/api'
import { useAuth } from '../lib/auth'
import { loginHref } from '../lib/nav.js'
import { createUserKey } from '../lib/key-creation.js'
import { C, APP_TEXT } from '../lib/theme'

// Public alpha quick start. The key is supplied locally, never embedded in the page.
const SDK_NONSTREAM = "import os\nfrom openai import OpenAI\n\nclient = OpenAI(\n    api_key=os.environ[\"IE_API_KEY\"],\n    base_url=\"https://alpha.inferenceex.com/v1\",\n)\nmodels = client.models.list().data\nif not models:\n    raise RuntimeError(\"No IE models are online\")\nmodel = models[0].id\n\nresult = client.chat.completions.create(\n    model=model,\n    messages=[{\"role\": \"user\", \"content\": \"Say hello.\"}],\n    extra_body={\"ocip_min_confidence\": \"open\"},\n)\nprint(result.choices[0].message.content)\n"
const SDK_STREAM = "import os\nfrom openai import OpenAI\n\nclient = OpenAI(\n    api_key=os.environ[\"IE_API_KEY\"],\n    base_url=\"https://alpha.inferenceex.com/v1\",\n)\nmodels = client.models.list().data\nif not models:\n    raise RuntimeError(\"No IE models are online\")\nmodel = models[0].id\n\nresponse = client.chat.completions.create(\n    model=model,\n    messages=[{\"role\": \"user\", \"content\": \"Count to five.\"}],\n    stream=True,\n    extra_body={\"ocip_min_confidence\": \"open\"},\n)\nfor chunk in response:\n    if chunk.choices and chunk.choices[0].delta.content:\n        print(chunk.choices[0].delta.content, end=\"\", flush=True)\nprint()\n"

export function Keys() {
  const { user } = useAuth()
  // Scope cached key metadata to the authenticated user; never reuse it
  // across sequential GitHub logins in the same browser.
  const { data, mutate } = useSWR(user ? ['myKeys', user.user_id] : null, api.myKeys)
  const [newKeyName, setNewKeyName] = useState('')
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [quickstartMode, setQuickstartMode] = useState<'single' | 'stream'>('single')
  const [quickstartCopyStatus, setQuickstartCopyStatus] = useState('')
  const quickstartCode = quickstartMode === 'single' ? SDK_NONSTREAM : SDK_STREAM

  async function copyQuickstart() {
    try {
      await navigator.clipboard.writeText(quickstartCode)
      setQuickstartCopyStatus('Code copied. Save it as hello_ie.py.')
    } catch {
      setQuickstartCopyStatus('Copy unavailable. Select the code below and copy it manually.')
    }
  }

  const [createError, setCreateError] = useState('')
  const [creating, setCreating] = useState(false)
  // A raw secret is only shown immediately after a successful server response.
  // Never restore a different account's locally cached key as an active key.
  useEffect(() => { setCreatedKey(null); setCreateError('') }, [user?.user_id])
  const userKeys = data?.keys || []

  async function createKey() {
    if (!newKeyName.trim() || creating) return
    setCreating(true)
    setCreatedKey(null)
    setCreateError('')
    try {
      const apiKey = await createUserKey(
        name => post<{ api_key: string }>('/v1/auth/keys', { name }),
        newKeyName.trim(),
      )
      setCreatedKey(apiKey)
      setNewKeyName('')
      void mutate()
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Key creation failed. Please try again.')
    } finally {
      setCreating(false)
    }
  }

  async function revokeKey(keyId: string, name: string) {
    if (!window.confirm(`Revoke "${name}"? Apps using it will stop working.`)) return
    await api.revokeKey(keyId)
    mutate()
  }

  function copyKey(key: string) {
    navigator.clipboard.writeText(key)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!user) {
    return (
      <div className="max-w-md mx-auto text-center py-16">
        <div className="text-sm mb-3" style={{ color: APP_TEXT.soft }}>Sign in to manage API keys</div>
        <Link to={loginHref('/keys')} className="text-sm font-medium" style={{ color: APP_TEXT.gold }}>Sign in or create an account</Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Two-column: Create + Your keys */}
      <div className="flex gap-5 flex-col lg:flex-row">
        {/* Create new key */}
        <div className="flex-1 bg-white rounded-2xl border border-gray-200/40 p-5">
          <div className="text-[10px] uppercase tracking-wider font-medium mb-3" style={{ color: APP_TEXT.gold }}>
            Create New Key
          </div>

          <div className="space-y-3">
            <div>
              <div className="text-xs mb-1.5" style={{ color: APP_TEXT.soft }}>Name</div>
              <input
                type="text" value={newKeyName}
                onChange={e => setNewKeyName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createKey()}
                placeholder="e.g. production-agent"
                className="w-full px-4 py-2.5 bg-transparent border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 placeholder:text-gray-300"
              />
            </div>

            <div>
              <div className="text-xs mb-1.5" style={{ color: APP_TEXT.soft }}>Scope</div>
              <span
                className="text-[11px] font-medium px-3 py-1 rounded-full"
                style={{ background: '#fdf6ec', color: APP_TEXT.gold, border: '1px solid rgba(196,154,69,0.2)' }}
              >
                Chat + Exchange
              </span>
            </div>

            <button
              onClick={createKey}
              disabled={creating}
              className="px-5 py-2.5 rounded-xl text-sm font-medium transition-colors mt-2"
              style={{ background: C.blueBlack, color: '#fff' }}
            >
              {creating ? 'Creating…' : 'Create key'}
            </button>
            {createError && <p role="alert" className="text-xs text-red-700 mt-2">Could not create key: {createError}</p>}
          </div>

          {createdKey && (
            <div className="mt-4 rounded-xl p-4" style={{ background: '#edf7f1', border: '1px solid rgba(63,128,85,0.15)' }}>
              <div className="text-sm font-semibold" style={{ color: APP_TEXT.green }}>Key created</div>
              <div className="text-xs mb-2" style={{ color: APP_TEXT.soft }}>Copy now — you won't see it again.</div>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs font-mono break-all p-2 rounded-lg bg-white border border-gray-100">
                  {createdKey}
                </code>
                <button
                  onClick={() => copyKey(createdKey)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium shrink-0"
                  style={{ background: C.green, color: '#fff' }}
                >
                  {copied ? 'Done' : 'Copy'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Your keys list */}
        <div className="w-full lg:w-72 shrink-0 bg-white rounded-2xl border border-gray-200/40 p-5">
          <div className="text-[10px] uppercase tracking-wider font-medium mb-3" style={{ color: APP_TEXT.gold }}>
            Your Keys
          </div>

          {userKeys.length > 0 ? (
            <div className="space-y-3">
              {userKeys.map(k => (
                <div key={k.key_id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <div>
                    <div className="text-sm font-medium" style={{ color: C.blueBlack }}>{k.name}</div>
                    <div className="text-xs" style={{ color: APP_TEXT.soft }}>
                      {k.requests_made.toLocaleString()} req
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-xs" style={{ color: APP_TEXT.soft }}>
                      {k.last_used_at
                        ? new Date(k.last_used_at * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                        : 'never'
                      }
                    </div>
                    <button
                      onClick={() => revokeKey(k.key_id, k.name)}
                      className="text-xs font-medium"
                      style={{ color: C.red }}
                      aria-label={`Revoke key ${k.name}`}
                    >
                      Revoke
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs py-6 text-center" style={{ color: APP_TEXT.soft }}>No keys yet</div>
          )}
        </div>
      </div>

      {/* Public SDK example works without cloning the repository or reading docs. */}
      <section className="bg-white rounded-2xl border border-gray-200/40 p-5 space-y-3">
        <h2 className="text-sm font-semibold" style={{ color: C.blueBlack }}>Run your first API request</h2>
        <p className="text-xs" style={{ color: APP_TEXT.muted }}>
          No repository checkout is needed. Credits are simulated, not real money.
          At L0/Open, the coordinator and provider can read prompts and responses.
          Use only nonsensitive test prompts.
        </p>
        <div className="space-y-1 text-xs" style={{ color: C.blueBlack }}>
          <div>1. Install the SDK: <code className="font-mono">pip install openai</code></div>
          <div>2. In your own terminal: <code className="font-mono">export IE_API_KEY="sk-ie-..."</code></div>
          <div>3. Save the example as <code>hello_ie.py</code>. Run <code>python hello_ie.py</code>.</div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            <button type="button" aria-pressed={quickstartMode === 'single'}
              onClick={() => { setQuickstartMode('single'); setQuickstartCopyStatus('') }}
              className="rounded-lg border px-3 py-1.5 text-xs">Non-streaming</button>
            <button type="button" aria-pressed={quickstartMode === 'stream'}
              onClick={() => { setQuickstartMode('stream'); setQuickstartCopyStatus('') }}
              className="rounded-lg border px-3 py-1.5 text-xs">Streaming</button>
          </div>
          <button type="button" onClick={() => void copyQuickstart()}
            className="rounded-lg px-3 py-1.5 text-xs text-white"
            style={{ background: C.blueBlack }}>Copy Python code</button>
        </div>
        {quickstartCopyStatus && <p role="status" className="text-xs text-gray-600">{quickstartCopyStatus}</p>}
        <pre className="rounded-xl p-4 font-mono text-xs overflow-x-auto whitespace-pre"
          style={{ background: C.blueBlack, color: '#d4d4cd' }}>
          <code>{quickstartCode}</code>
        </pre>
        <p className="text-xs" style={{ color: APP_TEXT.soft }}>
          The example selects the first model advertised by the exchange.
          If no models are online, it stops with a clear error. Your API key is only shown once.
        </p>
      </section>
    </div>
  )
}
