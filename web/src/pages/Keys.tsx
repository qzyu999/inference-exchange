import { useState } from 'react'
import useSWR from 'swr'
import { Link } from 'react-router-dom'
import { api, post } from '../lib/api'
import { useAuth } from '../lib/auth'
import { C } from '../lib/theme'

export function Keys() {
  const { user } = useAuth()
  const { data, mutate } = useSWR('myKeys', api.myKeys)
  const { data: health } = useSWR('health', api.health)
  const [newKeyName, setNewKeyName] = useState('')
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const defaultKey = user?.api_key || health?.default_api_key
  const userKeys = data?.keys || []

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

  if (!user) {
    return (
      <div className="max-w-md mx-auto text-center py-16">
        <div className="text-sm mb-3" style={{ color: '#888' }}>Sign in to manage API keys</div>
        <Link to="/login" className="text-sm font-medium" style={{ color: C.gold }}>Sign in or create an account</Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Active key */}
      {defaultKey && (
        <div className="bg-white rounded-2xl border border-gray-200/40 p-5">
          <div className="text-[10px] uppercase tracking-wider font-medium mb-3" style={{ color: C.gold }}>
            Active Key
          </div>
          <div className="flex items-center gap-3">
            <code className="flex-1 text-lg font-mono tracking-wider" style={{ color: C.blueBlack }}>
              {defaultKey.slice(0, 8)}{'·'.repeat(16)}
            </code>
            <span className="text-[10px] font-medium px-2.5 py-1 rounded-full" style={{ background: '#edf7f1', color: C.green }}>
              Production
            </span>
            <button
              onClick={() => copyKey(defaultKey)}
              className="px-4 py-2 rounded-xl text-sm font-medium border transition-colors"
              style={{ color: C.blueBlack, borderColor: '#ddd' }}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <div className="text-xs mt-2" style={{ color: '#999' }}>
            Bearer token for OpenAI-compatible endpoints
          </div>
        </div>
      )}

      {/* Two-column: Create + Your keys */}
      <div className="flex gap-5 flex-col lg:flex-row">
        {/* Create new key */}
        <div className="flex-1 bg-white rounded-2xl border border-gray-200/40 p-5">
          <div className="text-[10px] uppercase tracking-wider font-medium mb-3" style={{ color: C.gold }}>
            Create New Key
          </div>

          <div className="space-y-3">
            <div>
              <div className="text-xs mb-1.5" style={{ color: '#888' }}>Name</div>
              <input
                type="text" value={newKeyName}
                onChange={e => setNewKeyName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createKey()}
                placeholder="e.g. production-agent"
                className="w-full px-4 py-2.5 bg-transparent border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 placeholder:text-gray-300"
              />
            </div>

            <div>
              <div className="text-xs mb-1.5" style={{ color: '#888' }}>Scope</div>
              <span
                className="text-[11px] font-medium px-3 py-1 rounded-full"
                style={{ background: '#fdf6ec', color: C.gold, border: '1px solid rgba(196,154,69,0.2)' }}
              >
                Chat + Exchange
              </span>
            </div>

            <button
              onClick={createKey}
              className="px-5 py-2.5 rounded-xl text-sm font-medium transition-colors mt-2"
              style={{ background: C.blueBlack, color: '#fff' }}
            >
              Create key
            </button>
          </div>

          {createdKey && (
            <div className="mt-4 rounded-xl p-4" style={{ background: '#edf7f1', border: '1px solid rgba(63,128,85,0.15)' }}>
              <div className="text-sm font-semibold" style={{ color: C.green }}>Key created</div>
              <div className="text-xs mb-2" style={{ color: '#888' }}>Copy now — you won't see it again.</div>
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
          <div className="text-[10px] uppercase tracking-wider font-medium mb-3" style={{ color: C.gold }}>
            Your Keys
          </div>

          {userKeys.length > 0 ? (
            <div className="space-y-3">
              {userKeys.map(k => (
                <div key={k.key_id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <div>
                    <div className="text-sm font-medium" style={{ color: C.blueBlack }}>{k.name}</div>
                    <div className="text-xs" style={{ color: '#999' }}>
                      {k.requests_made.toLocaleString()} req
                    </div>
                  </div>
                  <div className="text-xs" style={{ color: '#bbb' }}>
                    {k.last_used_at
                      ? new Date(k.last_used_at * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                      : 'never'
                    }
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs py-6 text-center" style={{ color: '#ccc' }}>No keys yet</div>
          )}
        </div>
      </div>

      {/* Quick start */}
      <div className="bg-white rounded-2xl border border-gray-200/40 p-5">
        <div className="text-[10px] uppercase tracking-wider font-medium mb-3" style={{ color: C.gold }}>
          Quick start
        </div>
        <div className="rounded-xl p-4 font-mono text-xs overflow-x-auto" style={{ background: C.blueBlack, color: '#a8a8a0' }}>
          <div>curl /v1/chat/completions \</div>
          <div className="pl-4">-H "Authorization: Bearer $IE_KEY" \</div>
          <div className="pl-4">-d '{`{"model":"default","messages":[{"role":"user","content":"Hello"}]}`}'</div>
        </div>
      </div>
    </div>
  )
}
