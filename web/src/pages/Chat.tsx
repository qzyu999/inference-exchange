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
  { value: 'balanced', label: '⚖️ Balanced' },
  { value: 'cheapest', label: '💰 Cheapest' },
  { value: 'fastest', label: '⚡ Fastest' },
  { value: 'most_secure', label: '🔒 Most Secure' },
]

export function Chat() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [model, setModel] = useState('')
  const [preference, setPreference] = useState('balanced')
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('ie_api_key') || '')
  const scrollRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const { data: modelsData } = useSWR('models', api.models)
  const { data: health } = useSWR('health', api.health)

  // Auto-select first model
  useEffect(() => {
    if (!model && modelsData?.data?.length) {
      setModel(modelsData.data[0].id)
    }
  }, [modelsData, model])

  // Auto-set API key from health endpoint (dev convenience)
  useEffect(() => {
    if (!apiKey && health?.default_api_key) {
      setApiKey(health.default_api_key)
      localStorage.setItem('ie_api_key', health.default_api_key)
    }
  }, [health, apiKey])

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages])

  async function send() {
    const text = input.trim()
    if (!text || streaming) return

    const userMsg: Message = { role: 'user', content: text }
    const updated = [...messages, userMsg]
    setMessages(updated)
    setInput('')
    setStreaming(true)

    const assistantMsg: Message = { role: 'assistant', content: '' }
    setMessages([...updated, assistantMsg])

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const resp = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model || undefined,
          messages: updated.map(m => ({ role: m.role, content: m.content })),
          stream: true,
          ocip_preference: preference,
        }),
        signal: controller.signal,
      })

      if (!resp.ok) {
        const err = await resp.text()
        setMessages(prev => {
          const copy = [...prev]
          copy[copy.length - 1] = { role: 'assistant', content: `Error: ${resp.status} — ${err}` }
          return copy
        })
        setStreaming(false)
        return
      }

      const reader = resp.body?.getReader()
      const decoder = new TextDecoder()
      let accumulated = ''

      while (reader) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6).trim()
          if (payload === '[DONE]') continue

          try {
            const parsed = JSON.parse(payload)
            const delta = parsed.choices?.[0]?.delta?.content
            if (delta) {
              accumulated += delta
              setMessages(prev => {
                const copy = [...prev]
                copy[copy.length - 1] = {
                  ...copy[copy.length - 1],
                  content: accumulated,
                  model: parsed.model,
                }
                return copy
              })
            }

            // Extract usage from final chunk
            if (parsed.usage) {
              setMessages(prev => {
                const copy = [...prev]
                copy[copy.length - 1] = {
                  ...copy[copy.length - 1],
                  tokens: (parsed.usage.prompt_tokens || 0) + (parsed.usage.completion_tokens || 0),
                  cost_usd: parsed.usage.cost_usd,
                }
                return copy
              })
            }
          } catch { /* skip malformed SSE lines */ }
        }
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        setMessages(prev => {
          const copy = [...prev]
          copy[copy.length - 1] = { role: 'assistant', content: `Connection error: ${e.message}` }
          return copy
        })
      }
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
  }

  function cancel() {
    abortRef.current?.abort()
    setStreaming(false)
  }

  return (
    <div className="flex flex-col h-[calc(100vh-80px)]">
      {/* Controls bar */}
      <div className="flex items-center gap-3 pb-3 border-b border-gray-200">
        <select
          value={model}
          onChange={e => setModel(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded-md text-sm bg-white"
        >
          {modelsData?.data?.map(m => (
            <option key={m.id} value={m.id}>{m.id}</option>
          ))}
          {(!modelsData?.data || modelsData.data.length === 0) && (
            <option value="">No models available</option>
          )}
        </select>

        <select
          value={preference}
          onChange={e => setPreference(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded-md text-sm bg-white"
        >
          {PREFERENCES.map(p => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>

        <input
          type="text"
          value={apiKey}
          onChange={e => {
            setApiKey(e.target.value)
            localStorage.setItem('ie_api_key', e.target.value)
          }}
          placeholder="API key (sk-ie-...)"
          className="px-3 py-1.5 border border-gray-300 rounded-md text-sm flex-1 font-mono text-xs"
        />

        <button
          onClick={() => setMessages([])}
          className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700"
        >
          Clear
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto py-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-400 mt-20">
            <div className="text-4xl mb-3">⚡</div>
            <div>Send a message to start an inference request.</div>
            <div className="text-xs mt-1">Routed through the Inference Exchange to the best available provider.</div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[70%] px-4 py-2.5 rounded-lg ${
              m.role === 'user'
                ? 'bg-purple-600 text-white'
                : 'bg-white border border-gray-200 text-gray-800'
            }`}>
              {m.role === 'user' ? (
                <div className="whitespace-pre-wrap text-sm">{m.content || '…'}</div>
              ) : (
                <div className="text-sm prose prose-sm max-w-none prose-p:my-1 prose-pre:bg-gray-900 prose-pre:text-green-400 prose-code:text-purple-600 prose-code:bg-gray-100 prose-code:px-1 prose-code:rounded prose-code:before:content-none prose-code:after:content-none">
                  {m.content ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                  ) : '…'}
                </div>
              )}
              {m.role === 'assistant' && (m.model || m.tokens != null || m.cost_usd != null) && (
                <div className="text-xs text-gray-400 mt-1.5 flex gap-2">
                  {m.model && <span>{m.model}</span>}
                  {m.tokens != null && <span>{m.tokens} tok</span>}
                  {m.cost_usd != null && <span>${m.cost_usd.toFixed(6)}</span>}
                  {m.encrypted && <span>🔒</span>}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 pt-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
            placeholder="Type a message…"
            disabled={streaming}
            className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          />
          {streaming ? (
            <button onClick={cancel} className="px-4 py-2.5 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600">
              Stop
            </button>
          ) : (
            <button onClick={send} className="px-4 py-2.5 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700">
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
