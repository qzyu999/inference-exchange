import { useState, useRef, useEffect } from 'react'
import useSWR from 'swr'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '../lib/api'

interface Message {
  role: 'user' | 'assistant'
  content: string
  model?: string
  cost_usd?: number
  tokens?: number
  encrypted?: boolean
}

const PREFERENCES = [
  { value: 'balanced', label: 'Balanced', icon: '⚖️' },
  { value: 'cheapest', label: 'Cheapest', icon: '💰' },
  { value: 'fastest', label: 'Fastest', icon: '⚡' },
  { value: 'most_secure', label: 'Most Secure', icon: '🔒' },
]

export function Chat() {
  const [messages, setMessages] = useState<Message[]>(() => {
    try { const saved = localStorage.getItem('ie_chat_history'); return saved ? JSON.parse(saved) : [] } catch { return [] }
  })
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [model, setModel] = useState('')
  const [preference, setPreference] = useState('balanced')
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('ie_api_key') || '')
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const { data: modelsData } = useSWR('models', api.models)
  const { data: health } = useSWR('health', api.health)

  useEffect(() => { if (!model && modelsData?.data?.length) setModel(modelsData.data[0].id) }, [modelsData, model])
  useEffect(() => { if (!apiKey && health?.default_api_key) { setApiKey(health.default_api_key); localStorage.setItem('ie_api_key', health.default_api_key) } }, [health, apiKey])
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }) }, [messages])
  // Persist chat history
  useEffect(() => { if (messages.length > 0) localStorage.setItem('ie_chat_history', JSON.stringify(messages)) }, [messages])
  // Refocus input after streaming ends
  useEffect(() => { if (!streaming) inputRef.current?.focus() }, [streaming])

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
      const resp = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model: model || undefined, messages: updated.map(m => ({ role: m.role, content: m.content })), stream: true, ocip_preference: preference }),
        signal: controller.signal,
      })
      if (!resp.ok) {
        const err = await resp.text()
        setMessages(prev => { const c = [...prev]; c[c.length - 1] = { role: 'assistant', content: `Error: ${resp.status} - ${err}` }; return c })
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
            if (delta) { accumulated += delta; setMessages(prev => { const c = [...prev]; c[c.length - 1] = { ...c[c.length - 1], content: accumulated, model: parsed.model }; return c }) }
            if (parsed.usage) { setMessages(prev => { const c = [...prev]; c[c.length - 1] = { ...c[c.length - 1], tokens: (parsed.usage.prompt_tokens || 0) + (parsed.usage.completion_tokens || 0), cost_usd: parsed.usage.cost_usd }; return c }) }
          } catch {}
        }
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') setMessages(prev => { const c = [...prev]; c[c.length - 1] = { role: 'assistant', content: `Connection error: ${e.message}` }; return c })
    } finally { setStreaming(false); abortRef.current = null }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-100px)]">
      {/* Controls */}
      <div className="flex items-center gap-2 pb-4 border-b border-gray-200/60 flex-wrap">
        <select value={model} onChange={e => setModel(e.target.value)} className="px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400">
          {modelsData?.data?.map(m => <option key={m.id} value={m.id}>{m.id}</option>)}
          {(!modelsData?.data || modelsData.data.length === 0) && <option value="">No models</option>}
        </select>
        <div className="flex bg-gray-100 rounded-xl p-0.5">
          {PREFERENCES.map(p => (
            <button key={p.value} onClick={() => setPreference(p.value)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${preference === p.value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {p.icon} {p.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <button onClick={() => { setMessages([]); localStorage.removeItem('ie_chat_history') }} className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors">Clear</button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto py-6 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-300 mt-24">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center mx-auto mb-4">
              <span className="text-white text-2xl font-bold">IE</span>
            </div>
            <div className="text-gray-500 font-medium">Send a message to start</div>
            <div className="text-xs text-gray-400 mt-1">Routed to the best available provider on the exchange</div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[75%] px-4 py-3 rounded-2xl ${
              m.role === 'user'
                ? 'bg-gray-900 text-white'
                : 'bg-white border border-gray-200/60 shadow-sm text-gray-800'
            }`}>
              {m.role === 'user' ? (
                <div className="whitespace-pre-wrap text-sm">{m.content || '...'}</div>
              ) : (
                <div className="text-sm prose prose-sm max-w-none prose-p:my-1 prose-pre:bg-gray-50 prose-pre:border prose-pre:border-gray-200 prose-pre:text-gray-800 prose-code:text-amber-600 prose-code:bg-amber-50 prose-code:px-1 prose-code:rounded prose-code:before:content-none prose-code:after:content-none">
                  {m.content ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown> : (
                    <span className="inline-flex gap-1">
                      <span className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </span>
                  )}
                </div>
              )}
              {m.role === 'assistant' && (m.model || m.tokens != null || m.cost_usd != null) && (
                <div className="text-[11px] text-gray-400 mt-2 flex gap-2">
                  {m.model && <span>{m.model}</span>}
                  {m.tokens != null && <span>{m.tokens} tok</span>}
                  {m.cost_usd != null && <span>${m.cost_usd.toFixed(6)}</span>}
                  {m.encrypted && <span className="text-emerald-500">E2E</span>}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="border-t border-gray-200/60 pt-4">
        <div className="flex gap-2">
          <input
            type="text" value={input} onChange={e => setInput(e.target.value)}
            ref={inputRef}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
            placeholder="Type a message..."
            disabled={streaming}
            className="flex-1 px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400 placeholder:text-gray-300"
          />
          {streaming ? (
            <button onClick={() => { abortRef.current?.abort(); setStreaming(false) }} className="px-5 py-3 bg-red-500 text-white rounded-xl text-sm font-medium hover:bg-red-600 transition-colors">Stop</button>
          ) : (
            <button onClick={send} className="px-5 py-3 bg-gray-900 text-white rounded-xl text-sm font-medium hover:bg-gray-800 transition-colors">Send</button>
          )}
        </div>
      </div>
    </div>
  )
}
