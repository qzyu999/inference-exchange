import { useState, useRef, useEffect } from 'react'
import useSWR from 'swr'
import { useSearchParams, Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { C, TRUST_CLAIM_NOTE, TRUST_COLORS } from '../lib/theme'

interface Message {
  role: 'user' | 'assistant'
  content: string
  model?: string
  cost_usd?: number
  tokens?: number
  input_tokens?: number
  output_tokens?: number
  encrypted?: boolean
  trust_level?: string
  provider_name?: string
  provider_tps?: number
  provider_price?: number
}

const PREFERENCES = [
  { value: 'balanced', label: 'Balanced' },
  { value: 'cheapest', label: 'Cheapest' },
  { value: 'fastest', label: 'Fastest' },
  { value: 'most_secure', label: 'Most Secure' },
]

const TRUST_LEVELS = [
  { value: 'open', label: 'Any' },
  { value: 'contained', label: 'Contained' },
  { value: 'hardened', label: 'Hardened+' },
  // 'confidential' hidden: no provider can pass App Attest admission yet (#22, #25)
]

export function Chat() {
  const [searchParams] = useSearchParams()
  const { user } = useAuth()

  const chatKey = user ? `ie_chat_${user.user_id}` : 'ie_chat_anon'
  const [messages, setMessages] = useState<Message[]>(() => {
    try { const saved = localStorage.getItem(chatKey); return saved ? JSON.parse(saved) : [] } catch { return [] }
  })
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [model, setModel] = useState(() => searchParams.get('model') || '')
  const [preference, setPreference] = useState('balanced')
  const [minTrust, setMinTrust] = useState('hardened')
  const [maxPrice, setMaxPrice] = useState('0.15')
  const [maxInputPrice, setMaxInputPrice] = useState('0.08')
  const [maxCachePrice, setMaxCachePrice] = useState('0.02')
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('ie_api_key') || '')
  const [showSidebar, setShowSidebar] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const { data: modelsData } = useSWR('models', api.models)
  const { data: health } = useSWR('health', api.health)

  useEffect(() => {
    if (user?.api_key && !apiKey) {
      setApiKey(user.api_key)
      localStorage.setItem('ie_api_key', user.api_key)
    } else if (!apiKey && health?.default_api_key) {
      setApiKey(health.default_api_key)
      localStorage.setItem('ie_api_key', health.default_api_key)
    }
  }, [user, health, apiKey])
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }) }, [messages])
  useEffect(() => { if (!model && modelsData?.data?.length) setModel(modelsData.data[0].id) }, [modelsData, model])
  useEffect(() => { if (messages.length > 0) localStorage.setItem(chatKey, JSON.stringify(messages)) }, [messages, chatKey])
  useEffect(() => { if (!streaming) inputRef.current?.focus() }, [streaming])

  // Get the last assistant message for match info
  const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant' && m.content)

  const trustInfo = TRUST_COLORS[minTrust] || TRUST_COLORS.hardened

  async function send() {
    const text = input.trim()
    if (!text || streaming) return
    const userMsg: Message = { role: 'user', content: text }
    const updated = [...messages, userMsg]
    setMessages(updated)
    setInput('')
    setStreaming(true)
    setMessages([...updated, { role: 'assistant', content: '' }])
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const body: any = {
        model: model || 'default',
        messages: updated.map(m => ({ role: m.role, content: m.content })),
        stream: true,
        ocip_preference: preference,
        ocip_min_confidence: minTrust,
      }
      if (maxPrice) body.ocip_max_price = parseFloat(maxPrice)

      const resp = await fetch('/v1/chat/completions', {
        method: 'POST',
        // Signed-in users authenticate with the session cookie; the key is a dev/anonymous fallback
        headers: { 'Content-Type': 'application/json', ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}) },
        credentials: 'include',
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!resp.ok) {
        const err = await resp.text()
        let friendlyError = `Error: ${resp.status}`
        try {
          const parsed = JSON.parse(err)
          if (parsed.detail?.message) friendlyError = parsed.detail.message
          else if (parsed.error?.message) friendlyError = parsed.error.message
          else if (parsed.detail) friendlyError = typeof parsed.detail === 'string' ? parsed.detail : JSON.stringify(parsed.detail)
        } catch {
          if (resp.status === 503) friendlyError = 'No providers available right now. Try again in a moment.'
          else if (resp.status === 429) friendlyError = 'Rate limit reached. Please wait a moment.'
          else if (resp.status === 401) friendlyError = 'Invalid API key. Check your key in settings.'
          else if (resp.status === 402) friendlyError = 'Insufficient balance.'
          else friendlyError = `Server error (${resp.status}).`
        }
        setMessages(prev => { const c = [...prev]; c[c.length - 1] = { role: 'assistant', content: friendlyError }; return c })
        setStreaming(false); return
      }
      const reader = resp.body?.getReader()
      const decoder = new TextDecoder()
      let accumulated = ''
      while (reader) {
        const { done, value } = await reader.read()
        if (done) break
        for (const line of decoder.decode(value, { stream: true }).split('\n')) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6).trim()
          if (payload === '[DONE]') continue
          try {
            const parsed = JSON.parse(payload)
            const delta = parsed.choices?.[0]?.delta?.content
            if (delta) {
              accumulated += delta
              setMessages(prev => {
                const c = [...prev]
                c[c.length - 1] = { ...c[c.length - 1], content: accumulated, model: parsed.model }
                return c
              })
            }
            if (parsed.usage) {
              setMessages(prev => {
                const c = [...prev]
                c[c.length - 1] = {
                  ...c[c.length - 1],
                  tokens: (parsed.usage.prompt_tokens || 0) + (parsed.usage.completion_tokens || 0),
                  input_tokens: parsed.usage.prompt_tokens,
                  output_tokens: parsed.usage.completion_tokens,
                  cost_usd: parsed.usage.cost_usd,
                }
                return c
              })
            }
          } catch {}
        }
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        setMessages(prev => { const c = [...prev]; c[c.length - 1] = { role: 'assistant', content: `Connection error: ${e.message}` }; return c })
      }
    } finally { setStreaming(false); abortRef.current = null }
  }

  return (
    <div className="flex gap-6 h-[calc(100vh-140px)]">
      {/* ── Main chat column ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Model + trust header bar */}
        <div className="bg-white rounded-2xl border border-gray-200/40 px-5 py-3 mb-4 flex items-center gap-3 flex-wrap">
          <select
            value={model}
            onChange={e => setModel(e.target.value)}
            className="px-3 py-1.5 bg-transparent border border-gray-200 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-amber-500/20"
            style={{ color: C.blueBlack }}
          >
            <option value="default">Any model</option>
            {modelsData?.data?.map(m => <option key={m.id} value={m.id}>{m.id}</option>)}
          </select>

          <span
            className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
            style={{ background: trustInfo.bg, color: trustInfo.text }}
          >
            {trustInfo.label}
          </span>

          <span className="text-xs" style={{ color: '#999' }}>
            {PREFERENCES.find(p => p.value === preference)?.label} routing
          </span>

          <div className="flex-1" />

          <button
            onClick={() => { setMessages([]); localStorage.removeItem(chatKey) }}
            className="text-xs px-3 py-1.5 rounded-lg border transition-colors"
            style={{ color: '#888', borderColor: '#ddd' }}
          >
            New chat
          </button>

          <button
            onClick={() => setShowSidebar(!showSidebar)}
            className="lg:hidden text-xs px-2 py-1.5 rounded-lg border"
            style={{ color: '#888', borderColor: '#ddd' }}
          >
            {showSidebar ? 'Hide' : 'Policy'}
          </button>
        </div>

        {/* Privacy downgrade warning */}
        {(minTrust === 'open' || minTrust === 'contained') && (
          <div className="flex items-center gap-2 px-4 py-2.5 mb-3 rounded-xl text-xs" style={{ background: '#fdf6ec', color: C.gold, border: '1px solid rgba(196,154,69,0.15)' }}>
            <span>⚠</span>
            <span>
              {minTrust === 'open'
                ? 'L0 providers can see your prompts. No privacy protection.'
                : 'L1 providers have basic isolation only.'}
            </span>
            <button onClick={() => setMinTrust('hardened')} className="ml-auto font-medium shrink-0" style={{ color: C.gold }}>
              Use L2
            </button>
          </div>
        )}

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-4 pb-4">
          {messages.length === 0 && (
            <div className="text-center mt-24">
              <img src="/logo-icon.svg" alt="IE" className="w-14 h-14 mx-auto mb-4 opacity-30" />
              <div className="text-sm font-medium" style={{ color: '#999' }}>Send a message to start</div>
              <div className="text-xs mt-1" style={{ color: '#bbb' }}>
                {model && model !== 'default' ? `Using ${model}` : 'Routed to the best available provider'}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i}>
              {m.role === 'user' ? (
                <div>
                  <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: '#bbb' }}>You</div>
                  <div
                    className="inline-block px-4 py-3 rounded-2xl text-sm"
                    style={{ background: '#e5e5e3', color: C.blueBlack }}
                  >
                    <div className="whitespace-pre-wrap">{m.content || '...'}</div>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: C.gold }}>
                    Inference Exchange
                  </div>
                  <div
                    className="inline-block px-4 py-3 rounded-2xl text-sm max-w-full"
                    style={{ background: C.blueBlack, color: C.warmWhite }}
                  >
                    {m.content ? (
                      <div className="prose prose-sm prose-invert max-w-none prose-p:my-1 prose-pre:bg-black/30 prose-pre:border-0 prose-code:text-amber-300 prose-code:bg-transparent prose-code:before:content-none prose-code:after:content-none">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                      </div>
                    ) : (
                      <span className="inline-flex gap-1">
                        <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: '#666', animationDelay: '0ms' }} />
                        <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: '#666', animationDelay: '150ms' }} />
                        <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: '#666', animationDelay: '300ms' }} />
                      </span>
                    )}
                  </div>
                  {/* Message metadata */}
                  {(m.input_tokens != null || m.tokens != null || m.cost_usd != null) && (
                    <div className="text-[11px] mt-1.5 flex gap-2" style={{ color: '#bbb' }}>
                      {m.input_tokens != null && m.output_tokens != null && (
                        <span>{(m.input_tokens / 1000).toFixed(1)}k input · {(m.output_tokens / 1000).toFixed(1)}k output</span>
                      )}
                      {m.cost_usd != null && <span>· ${m.cost_usd.toFixed(6)}</span>}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Input */}
        <div className="pt-3">
          <div className="flex gap-2">
            <input
              type="text" value={input} onChange={e => setInput(e.target.value)}
              ref={inputRef}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
              placeholder="Message the exchange..."
              disabled={streaming}
              className="flex-1 px-4 py-3 bg-white border border-gray-200/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 placeholder:text-gray-300"
            />
            {streaming ? (
              <button onClick={() => {
                abortRef.current?.abort()
                setStreaming(false)
                setMessages(prev => {
                  const last = prev[prev.length - 1]
                  if (last?.role === 'assistant' && !last.content) return prev.slice(0, -1)
                  if (last?.role === 'assistant' && last.content) return [...prev.slice(0, -1), { ...last, content: last.content + '\n\n*[stopped]*' }]
                  return prev
                })
              }} className="px-5 py-3 rounded-xl text-sm font-medium" style={{ background: C.red, color: C.warmWhite }}>
                Stop
              </button>
            ) : (
              <button onClick={send} className="px-5 py-3 rounded-xl text-sm font-medium transition-colors" style={{ background: C.blueBlack, color: '#fff' }}>
                Send
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Right sidebar: Request Policy + Match ── */}
      {showSidebar && (
        <aside className="hidden lg:block w-56 shrink-0 space-y-5">
          {/* Request Policy */}
          <div>
            <div className="text-[10px] uppercase tracking-wider font-medium mb-3" style={{ color: C.gold }}>
              Request Policy
            </div>

            <div className="space-y-4">
              <div>
                <div className="text-xs mb-1.5" style={{ color: '#888' }}>Routing goal</div>
                <div className="flex flex-wrap gap-1">
                  {PREFERENCES.map(p => (
                    <button
                      key={p.value}
                      onClick={() => setPreference(p.value)}
                      className="text-[11px] font-medium px-2.5 py-1 rounded-full transition-colors"
                      style={{
                        background: preference === p.value ? '#fdf6ec' : 'transparent',
                        color: preference === p.value ? C.gold : '#aaa',
                        border: `1px solid ${preference === p.value ? 'rgba(196,154,69,0.3)' : '#e5e5e5'}`,
                      }}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs mb-1.5" style={{ color: '#888' }}>Minimum trust</div>
                <div className="flex flex-wrap gap-1">
                  {TRUST_LEVELS.map(t => {
                    const tc = TRUST_COLORS[t.value] || TRUST_COLORS.hardened
                    return (
                      <button
                        key={t.value}
                        onClick={() => setMinTrust(t.value)}
                        className="text-[11px] font-medium px-2.5 py-1 rounded-full transition-colors"
                        style={{
                          background: minTrust === t.value ? tc.bg : 'transparent',
                          color: minTrust === t.value ? tc.text : '#aaa',
                          border: `1px solid ${minTrust === t.value ? 'transparent' : '#e5e5e5'}`,
                        }}
                      >
                        {t.label}
                      </button>
                    )
                  })}
                </div>
                <div className="text-[10px] mt-1.5" style={{ color: '#aaa' }}>{TRUST_CLAIM_NOTE}</div>
              </div>

              <div>
                <div className="text-xs mb-2.5" style={{ color: '#888' }}>Max price / 1M tokens</div>
                <div className="space-y-3">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] uppercase tracking-wider font-medium" style={{ color: C.deepBlue }}>Input</span>
                      <span className="text-sm font-bold" style={{ color: C.blueBlack }}>${maxInputPrice}</span>
                    </div>
                    <input
                      type="range" min="0.01" max="0.50" step="0.01"
                      value={maxInputPrice}
                      onChange={e => setMaxInputPrice(e.target.value)}
                      className="w-full accent-blue-400" style={{ height: '2px' }}
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] uppercase tracking-wider font-medium" style={{ color: C.turquoise }}>Cached</span>
                      <span className="text-sm font-bold" style={{ color: C.blueBlack }}>${maxCachePrice}</span>
                    </div>
                    <input
                      type="range" min="0.00" max="0.20" step="0.005"
                      value={maxCachePrice}
                      onChange={e => setMaxCachePrice(e.target.value)}
                      className="w-full accent-teal-400" style={{ height: '2px' }}
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] uppercase tracking-wider font-medium" style={{ color: C.gold }}>Output</span>
                      <span className="text-sm font-bold" style={{ color: C.blueBlack }}>${maxPrice}</span>
                    </div>
                    <input
                      type="range" min="0.01" max="1.00" step="0.01"
                      value={maxPrice || '0.15'}
                      onChange={e => setMaxPrice(e.target.value)}
                      className="w-full accent-amber-500" style={{ height: '2px' }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Divider */}
          <div style={{ borderTop: '1px solid #e5e5e3' }} />

          {/* Current Match */}
          <div>
            <div className="text-[10px] uppercase tracking-wider font-medium mb-3" style={{ color: C.gold }}>
              {lastAssistant ? 'Current match' : 'Match'}
            </div>

            {lastAssistant?.model ? (
              <div className="space-y-1.5">
                <div className="text-sm font-bold" style={{ color: C.blueBlack }}>
                  {lastAssistant.provider_name || 'Exchange provider'}
                </div>
                <div className="text-xs" style={{ color: '#888' }}>
                  {lastAssistant.cost_usd != null && `$${lastAssistant.cost_usd.toFixed(4)} out`}
                  {lastAssistant.provider_tps ? ` · ${lastAssistant.provider_tps} tok/s` : ''}
                </div>
                <Link
                  to="/trace"
                  className="text-[11px] font-medium px-3 py-1 rounded-full mt-1 transition-colors"
                  style={{ border: '1px solid #ddd', color: '#888', display: 'inline-block' }}
                >
                  Inspect trace
                </Link>
              </div>
            ) : (
              <div className="text-xs" style={{ color: '#bbb' }}>
                No request matched yet
              </div>
            )}
          </div>

          {/* Divider */}
          <div style={{ borderTop: '1px solid #e5e5e3' }} />

          {/* Fallback */}
          <div>
            <div className="text-[10px] uppercase tracking-wider font-medium mb-2" style={{ color: C.red }}>
              Fallback
            </div>
            <div className="text-xs" style={{ color: '#888' }}>
              OpenRouter available
            </div>
          </div>
        </aside>
      )}
    </div>
  )
}
