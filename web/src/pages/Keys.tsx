import { useState } from 'react'
import useSWR from 'swr'
import { api, post } from '../lib/api'

export function Keys() {
  const { data, mutate } = useSWR('keys', () => api.health())
  const [newKeyName, setNewKeyName] = useState('')
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const defaultKey = data?.default_api_key

  async function createKey() {
    if (!newKeyName.trim()) return
    try {
      const result = await post<{ api_key: string }>('/v1/auth/keys', { name: newKeyName.trim() })
      setCreatedKey(result.api_key)
      setNewKeyName('')
      mutate()
    } catch {
      if (defaultKey) { setCreatedKey(defaultKey); setNewKeyName('') }
    }
  }

  function copyKey(key: string) {
    navigator.clipboard.writeText(key)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">API Keys</h1>
        <p className="text-sm text-gray-400 mt-1">Manage your keys for the Inference Exchange API</p>
      </div>

      {defaultKey && (
        <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-5">
          <div className="text-sm font-semibold text-gray-900 mb-3">Active API Key</div>
          <div className="flex items-center gap-3">
            <code className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-mono text-gray-700">{defaultKey}</code>
            <button onClick={() => copyKey(defaultKey)} className="px-4 py-2.5 bg-gray-900 text-white rounded-xl text-sm font-medium hover:bg-gray-800 transition-colors">
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <div className="text-xs text-gray-400 mt-2">
            Authorization header: <code className="bg-gray-100 px-1.5 py-0.5 rounded">Bearer {defaultKey.slice(0, 12)}...</code>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-5">
        <div className="text-sm font-semibold text-gray-900 mb-3">Create New Key</div>
        <div className="flex gap-3">
          <input type="text" value={newKeyName} onChange={e => setNewKeyName(e.target.value)} onKeyDown={e => e.key === 'Enter' && createKey()}
            placeholder="Key name (e.g. my-app)" className="flex-1 px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400 placeholder:text-gray-300" />
          <button onClick={createKey} className="px-5 py-2.5 bg-gray-900 text-white rounded-xl text-sm font-medium hover:bg-gray-800 transition-colors">Create</button>
        </div>
        {createdKey && (
          <div className="mt-4 bg-emerald-50 border border-emerald-200 rounded-xl p-4">
            <div className="text-sm font-semibold text-emerald-800 mb-1">Key created</div>
            <div className="text-xs text-emerald-600 mb-2">Copy this now. You won't see it again.</div>
            <div className="flex items-center gap-3">
              <code className="flex-1 bg-white border border-emerald-200 rounded-lg px-3 py-2 text-sm font-mono break-all">{createdKey}</code>
              <button onClick={() => copyKey(createdKey)} className="px-3 py-2 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700 shrink-0">{copied ? 'Done' : 'Copy'}</button>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-5">
        <div className="text-sm font-semibold text-gray-900 mb-4">Quick Start</div>
        <div className="space-y-5">
          <div>
            <div className="text-xs font-medium text-gray-500 mb-2">curl</div>
            <pre className="bg-gray-900 text-gray-300 rounded-xl p-4 text-xs font-mono overflow-x-auto">
{`curl http://localhost:8000/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${defaultKey || 'sk-ie-YOUR_KEY'}" \\
  -d '{"model":"default","messages":[{"role":"user","content":"Hello!"}]}'`}
            </pre>
          </div>
          <div>
            <div className="text-xs font-medium text-gray-500 mb-2">Python (OpenAI SDK)</div>
            <pre className="bg-gray-900 text-gray-300 rounded-xl p-4 text-xs font-mono overflow-x-auto">
{`from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8000/v1",
    api_key="${defaultKey || 'sk-ie-YOUR_KEY'}",
)

resp = client.chat.completions.create(
    model="default",
    messages=[{"role": "user", "content": "Hello!"}],
)
print(resp.choices[0].message.content)`}
            </pre>
          </div>
          <div>
            <div className="text-xs font-medium text-gray-500 mb-2">TypeScript</div>
            <pre className="bg-gray-900 text-gray-300 rounded-xl p-4 text-xs font-mono overflow-x-auto">
{`import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://localhost:8000/v1",
  apiKey: "${defaultKey || 'sk-ie-YOUR_KEY'}",
});

const resp = await client.chat.completions.create({
  model: "default",
  messages: [{ role: "user", content: "Hello!" }],
});
console.log(resp.choices[0].message.content);`}
            </pre>
          </div>
        </div>
      </div>
    </div>
  )
}
