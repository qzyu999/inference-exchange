import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { Link } from 'react-router-dom'
import { api, post } from '../lib/api'
import { useAuth } from '../lib/auth'
import { loginHref } from '../lib/nav.js'
import { createUserKey } from '../lib/key-creation.js'
import { UI } from '../lib/theme'

// Keep the routing explanations identical across languages and response modes.
const OCIP_NOTES = [
  'ocip_min_confidence sets a minimum. Routing never falls back below it.',
  'open (L0): No execution isolation required. The coordinator and provider can read your data.',
  'contained (L1): Requires a sandbox or container. The host admin can still read its data.',
  'hardened (L2): Requires stronger OS or VM isolation. This is the API default if omitted.',
  'confidential (L3): Requires hardware-backed CPU memory protection. GPU memory is separate.',
  'This example allows Open for the private alpha. Use only nonsensitive prompts.',
]

const PYTHON_SETUP = `import os
from openai import OpenAI

client = OpenAI(
    api_key=os.environ["IE_API_KEY"],
    base_url="https://alpha.inferenceex.com/v1",
)
models = client.models.list().data
if not models:
    raise RuntimeError("No IE models are online")
model = models[0].id

${OCIP_NOTES.map(note => '# ' + note).join('\n')}
`

const SDK_NONSTREAM = `${PYTHON_SETUP}
result = client.chat.completions.create(
    model=model,
    messages=[{"role": "user", "content": "Say hello."}],
    extra_body={"ocip_min_confidence": "open"},
)
print(result.choices[0].message.content)
`

const SDK_STREAM = `${PYTHON_SETUP}
response = client.chat.completions.create(
    model=model,
    messages=[{"role": "user", "content": "Count to five."}],
    stream=True,
    extra_body={"ocip_min_confidence": "open"},
)
for chunk in response:
    if chunk.choices and chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)
print()
`

const NODE_SETUP = `import OpenAI from "openai";

const apiKey = process.env.IE_API_KEY;
if (!apiKey) throw new Error("Set IE_API_KEY in your terminal first");

const client = new OpenAI({
  apiKey,
  baseURL: "https://alpha.inferenceex.com/v1",
});
const { data: models } = await client.models.list();
const model = models[0]?.id;
if (!model) throw new Error("No IE models are online");

${OCIP_NOTES.map(note => '// ' + note).join('\n')}
const routing = { ocip_min_confidence: "open" };
`

const NODE_NONSTREAM = `${NODE_SETUP}
const result = await client.chat.completions.create({
  model,
  messages: [{ role: "user", content: "Say hello." }],
  ...routing,
});
console.log(result.choices[0].message.content);
`

const NODE_STREAM = `${NODE_SETUP}
const stream = await client.chat.completions.create({
  model,
  messages: [{ role: "user", content: "Count to five." }],
  stream: true,
  ...routing,
});
for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
}
process.stdout.write("\\n");
`

export function Keys() {
  const { user } = useAuth()
  // Scope cached key metadata to the authenticated user; never reuse it
  // across sequential GitHub logins in the same browser.
  const { data, mutate } = useSWR(user ? ['myKeys', user.user_id] : null, api.myKeys)
  const [newKeyName, setNewKeyName] = useState('')
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [language, setLanguage] = useState<'python' | 'node'>('python')
  const [quickstartMode, setQuickstartMode] = useState<'single' | 'stream'>('single')
  const [quickstartCopyStatus, setQuickstartCopyStatus] = useState('')
  const python = language === 'python'
  const filename = python ? 'hello_ie.py' : 'hello_ie.mjs'
  const examples = python ? { single: SDK_NONSTREAM, stream: SDK_STREAM } : { single: NODE_NONSTREAM, stream: NODE_STREAM }
  const quickstartCode = examples[quickstartMode]

  async function copyQuickstart() {
    try {
      await navigator.clipboard.writeText(quickstartCode)
      setQuickstartCopyStatus(`Code copied. Save it as ${filename}.`)
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
        <div className="text-sm mb-3" style={{ color: UI.muted }}>Sign in to manage API keys</div>
        <Link to={loginHref('/keys')} className="text-sm font-medium" style={{ color: UI.accent }}>Sign in or create an account</Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Two-column: Create + Your keys */}
      <div className="flex gap-5 flex-col lg:flex-row">
        {/* Create new key */}
        <div className="flex-1 bg-ui-surface rounded-2xl border border-ui-border p-5">
          <div className="text-[10px] uppercase tracking-wider font-medium mb-3" style={{ color: UI.accent }}>
            Create New Key
          </div>

          <div className="space-y-3">
            <div>
              <div className="text-xs mb-1.5" style={{ color: UI.muted }}>Name</div>
              <input
                type="text" value={newKeyName}
                onChange={e => setNewKeyName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createKey()}
                placeholder="e.g. production-agent"
                className="w-full px-4 py-2.5 bg-transparent border border-ui-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ui-warning placeholder:text-ui-muted"
              />
            </div>

            <div>
              <div className="text-xs mb-1.5" style={{ color: UI.muted }}>Scope</div>
              <span
                className="text-[11px] font-medium px-3 py-1 rounded-full"
                style={{ background: UI.warningSurface, color: UI.accent, border: "1px solid var(--ui-border)" }}
              >
                Chat + Exchange
              </span>
            </div>

            <button
              onClick={createKey}
              disabled={creating}
              className="px-5 py-2.5 rounded-xl text-sm font-medium transition-colors mt-2"
              style={{ background: UI.action, color: UI.onAction }}
            >
              {creating ? 'Creating…' : 'Create key'}
            </button>
            {createError && <p role="alert" className="text-xs text-ui-danger mt-2">Could not create key: {createError}</p>}
          </div>

          {createdKey && (
            <div className="mt-4 rounded-xl p-4" style={{ background: UI.successSurface, border: "1px solid var(--ui-border)" }}>
              <div className="text-sm font-semibold" style={{ color: UI.success }}>Key created</div>
              <div className="text-xs mb-2" style={{ color: UI.muted }}>Copy now — you won't see it again.</div>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs font-mono break-all p-2 rounded-lg bg-ui-surface border border-ui-border">
                  {createdKey}
                </code>
                <button
                  onClick={() => copyKey(createdKey)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium shrink-0"
                  style={{ background: UI.successAction, color: UI.onAction }}
                >
                  {copied ? 'Done' : 'Copy'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Your keys list */}
        <div className="w-full lg:w-72 shrink-0 bg-ui-surface rounded-2xl border border-ui-border p-5">
          <div className="text-[10px] uppercase tracking-wider font-medium mb-3" style={{ color: UI.accent }}>
            Your Keys
          </div>

          {userKeys.length > 0 ? (
            <div className="space-y-3">
              {userKeys.map(k => (
                <div key={k.key_id} className="flex items-center justify-between py-2 border-b border-ui-border last:border-0">
                  <div>
                    <div className="text-sm font-medium" style={{ color: UI.text }}>{k.name}</div>
                    <div className="text-xs" style={{ color: UI.muted }}>
                      {k.requests_made.toLocaleString()} req
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-xs" style={{ color: UI.muted }}>
                      {k.last_used_at
                        ? new Date(k.last_used_at * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                        : 'never'
                      }
                    </div>
                    <button
                      onClick={() => revokeKey(k.key_id, k.name)}
                      className="text-xs font-medium"
                      style={{ color: UI.danger }}
                      aria-label={`Revoke key ${k.name}`}
                    >
                      Revoke
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs py-6 text-center" style={{ color: UI.muted }}>No keys yet</div>
          )}
        </div>
      </div>

      {/* Public SDK example works without cloning the repository or reading docs. */}
      <section className="bg-ui-surface rounded-2xl border border-ui-border p-5 space-y-3">
        <h2 className="text-sm font-semibold" style={{ color: UI.text }}>Run your first API request</h2>
        <p className="text-xs" style={{ color: UI.body }}>
          No repository checkout is needed. Credits are simulated, not real money.
          At L0/Open, the coordinator and provider can read prompts and responses.
          Use only nonsensitive test prompts.
        </p>
        <div role="group" aria-label="Example language" className="flex flex-wrap gap-2">
          <button type="button" aria-pressed={python}
            onClick={() => { setLanguage('python'); setQuickstartCopyStatus('') }}
            className="rounded-lg border border-ui-border px-3 py-1.5 text-xs aria-pressed:bg-ui-action aria-pressed:text-ui-on-action">Python</button>
          <button type="button" aria-pressed={!python}
            onClick={() => { setLanguage('node'); setQuickstartCopyStatus('') }}
            className="rounded-lg border border-ui-border px-3 py-1.5 text-xs aria-pressed:bg-ui-action aria-pressed:text-ui-on-action">JavaScript / TypeScript (Node.js)</button>
        </div>
        {!python && <p className="text-xs text-ui-body">
          Use Node.js 22 or newer. For React, call IE from your server and keep IE_API_KEY there.
        </p>}
        <div className="space-y-1 text-xs" style={{ color: UI.text }}>
          <div>1. Install the SDK: <code className="font-mono">{python ? 'pip install openai' : 'npm install openai'}</code></div>
          <div>2. In your own terminal: <code className="font-mono">export IE_API_KEY="sk-ie-..."</code></div>
          <div>3. Save the example as <code>{filename}</code>. Run <code>{python ? 'python hello_ie.py' : 'node hello_ie.mjs'}</code>.</div>
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
            className="rounded-lg px-3 py-1.5 text-xs text-ui-on-action"
            style={{ background: UI.action }}>{python ? 'Copy Python code' : 'Copy Node.js code'}</button>
        </div>
        {quickstartCopyStatus && <p role="status" className="text-xs text-ui-body">{quickstartCopyStatus}</p>}
        <pre className="rounded-xl p-4 font-mono text-xs overflow-x-auto whitespace-pre"
          style={{ background: UI.action, color: UI.codeText }}>
          <code>{quickstartCode}</code>
        </pre>
        <p className="text-xs" style={{ color: UI.muted }}>
          The example selects the first model advertised by the exchange.
          If no models are online, it stops with a clear error. Your API key is only shown once.
        </p>
      </section>
    </div>
  )
}
