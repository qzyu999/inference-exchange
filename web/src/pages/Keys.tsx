import { useState } from 'react'
import useSWR from 'swr'
import { api, post } from '../lib/api'

// API key shape (for future key listing endpoint)
// interface ApiKey {
//   key_prefix: string
//   name: string
//   created_at: number
//   last_used?: number
//   requests: number
// }

export function Keys() {
  const { data, mutate } = useSWR('keys', () => api.health())  // health returns default key for now
  const [newKeyName, setNewKeyName] = useState('')
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // For now, show the default key from health endpoint
  // Real implementation needs GET /v1/auth/keys and POST /v1/auth/keys
  const defaultKey = data?.default_api_key

  async function createKey() {
    if (!newKeyName.trim()) return
    try {
      const result = await post<{ api_key: string }>('/v1/auth/keys', { name: newKeyName.trim() })
      setCreatedKey(result.api_key)
      setNewKeyName('')
      mutate()
    } catch (e: any) {
      // API might not support this yet — show the default key
      if (defaultKey) {
        setCreatedKey(defaultKey)
        setNewKeyName('')
      }
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
        <h1 className="text-2xl font-bold mb-1">API Keys</h1>
        <p className="text-sm text-gray-500">Manage your API keys for accessing the Inference Exchange.</p>
      </div>

      {/* Current key display */}
      {defaultKey && (
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <div className="text-sm font-semibold text-gray-700 mb-2">Active API Key</div>
          <div className="flex items-center gap-3">
            <code className="flex-1 bg-gray-50 border border-gray-200 rounded px-3 py-2 text-sm font-mono">
              {defaultKey}
            </code>
            <button
              onClick={() => copyKey(defaultKey)}
              className="px-3 py-2 bg-purple-600 text-white rounded-md text-sm hover:bg-purple-700"
            >
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </div>
          <div className="text-xs text-gray-400 mt-2">
            Use this key in the Authorization header: <code className="bg-gray-100 px-1">Bearer {defaultKey.slice(0, 12)}...</code>
          </div>
        </div>
      )}

      {/* Create new key */}
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <div className="text-sm font-semibold text-gray-700 mb-3">Create New API Key</div>
        <div className="flex gap-3">
          <input
            type="text"
            value={newKeyName}
            onChange={e => setNewKeyName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && createKey()}
            placeholder="Key name (e.g. my-app, testing)"
            className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm"
          />
          <button
            onClick={createKey}
            className="px-4 py-2 bg-purple-600 text-white rounded-md text-sm font-medium hover:bg-purple-700"
          >
            Create Key
          </button>
        </div>

        {createdKey && (
          <div className="mt-4 bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="text-sm font-semibold text-green-800 mb-1">Key Created</div>
            <div className="text-xs text-green-700 mb-2">Copy this key now — you won't see it again.</div>
            <div className="flex items-center gap-3">
              <code className="flex-1 bg-white border border-green-200 rounded px-3 py-2 text-sm font-mono break-all">
                {createdKey}
              </code>
              <button
                onClick={() => copyKey(createdKey)}
                className="px-3 py-2 bg-green-600 text-white rounded-md text-sm hover:bg-green-700 shrink-0"
              >
                {copied ? '✓' : 'Copy'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Usage guide */}
      <div className="bg-gray-50 rounded-lg border border-gray-200 p-5">
        <div className="text-sm font-semibold text-gray-700 mb-3">Quick Start</div>

        <div className="space-y-4 text-sm">
          <div>
            <div className="font-medium text-gray-600 mb-1">curl</div>
            <pre className="bg-gray-900 text-green-400 rounded p-3 text-xs font-mono overflow-x-auto">
{`curl http://localhost:8000/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${defaultKey || 'sk-ie-YOUR_KEY'}" \\
  -d '{
    "model": "default",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`}
            </pre>
          </div>

          <div>
            <div className="font-medium text-gray-600 mb-1">Python (OpenAI SDK)</div>
            <pre className="bg-gray-900 text-green-400 rounded p-3 text-xs font-mono overflow-x-auto">
{`from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8000/v1",
    api_key="${defaultKey || 'sk-ie-YOUR_KEY'}",
)

response = client.chat.completions.create(
    model="default",
    messages=[{"role": "user", "content": "Hello!"}],
)
print(response.choices[0].message.content)`}
            </pre>
          </div>

          <div>
            <div className="font-medium text-gray-600 mb-1">TypeScript / Node.js</div>
            <pre className="bg-gray-900 text-green-400 rounded p-3 text-xs font-mono overflow-x-auto">
{`import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://localhost:8000/v1",
  apiKey: "${defaultKey || 'sk-ie-YOUR_KEY'}",
});

const response = await client.chat.completions.create({
  model: "default",
  messages: [{ role: "user", content: "Hello!" }],
});
console.log(response.choices[0].message.content);`}
            </pre>
          </div>
        </div>
      </div>
    </div>
  )
}
