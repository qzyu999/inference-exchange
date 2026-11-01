import { useState, useRef, useEffect, useMemo } from 'react'
import useSWR from 'swr'
import { useSearchParams, Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { authState, loginHref } from '../lib/nav.js'
import { formatUsd } from '../lib/money.js'
import { normalizeOnlineModels, isRunnableChatModel } from '../lib/chat-models.js'
import { ChatModelPicker } from '../components/ChatModelPicker'
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

const TRUST_LEVELS = [
  { value: 'open', label: 'L0 / Open' },
  { value: 'contained', label: 'L1 / Contained' },
  { value: 'hardened', label: 'L2 / Hardened' },
  // 'confidential' hidden: no provider can pass App Attest admission yet (#22, #25)
]

export function Chat() {
  const [searchParams] = useSearchParams()
  const { user, loading: authLoading } = useAuth()

  const chatKey = user ? `ie_chat_${user.user_id}` : null
  const [messages, setMessages] = useState<Message[]>([])
  const [loadedUserId, setLoadedUserId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const requestedModel = searchParams.get('model') || ''
  const [model, setModel] = useState(() => requestedModel)
  const [minTrust, setMinTrust] = useState('hardened')
  const [maxPrice, setMaxPrice] = useState('0.15')
  const [showSidebar, setShowSidebar] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const { data: modelsData, error: modelsError, isLoading: modelsLoading, mutate: refreshModels } =
    useSWR('models', api.models, { refreshInterval: 5000 })
  const { data: providerData, error: providersError, mutate: refreshProviders } =
    useSWR('providers', api.providers, { refreshInterval: 5000 })

  // Runnable model IDs come only from /v1/models, never Exchange reference prices.
  const onlineModels = useMemo(
    () => normalizeOnlineModels(modelsData?.data?.map(m => m.id)),
    [modelsData],
  )
  const modelListed = !modelsError && isRunnableChatModel(model, onlineModels)
  const modelProviders = providerData?.providers?.filter(p => p.models.includes(model)) ?? []
  const modelReady = modelListed && !!providerData && !providersError && modelProviders.length > 0
  const providerCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const provider of providerData?.providers ?? []) {
      for (const id of provider.models) counts[id] = (counts[id] || 0) + 1
    }
    return counts
  }, [providerData])

  // React mounts Chat before the async session check completes. Load only the
  // *current* user's history; never copy anonymous or another account's messages.
  useEffect(() => {
    setLoadedUserId(null)
    if (!chatKey) { setMessages([]); return }
    try {
      const saved = localStorage.getItem(chatKey)
      setMessages(saved ? JSON.parse(saved) : [])
    } catch { setMessages([]) }
    setLoadedUserId(user?.user_id ?? null)
  }, [chatKey, user?.user_id])

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }) }, [messages])
  // Honor explicit ?model= links. If a link is stale, display it as unavailable.
  // Never silently redirect a user from one requested model to another.
  useEffect(() => { if (requestedModel) setModel(requestedModel) }, [requestedModel])
  useEffect(() => {
    if (!model && !requestedModel && onlineModels.length) setModel(onlineModels[0])
  }, [onlineModels, model, requestedModel])
  useEffect(() => {
    if (chatKey && loadedUserId === user?.user_id && messages.length > 0) {
      localStorage.setItem(chatKey, JSON.stringify(messages))
    }
  }, [messages, chatKey, loadedUserId, user?.user_id])
  useEffect(() => { if (!streaming) inputRef.current?.focus() }, [streaming])

  const trustInfo = TRUST_COLORS[minTrust] || TRUST_COLORS.hardened
  const trustOrder: Record<string, number> = { open: 0, contained: 1, hardened: 2, confidential: 3 }
  // Show a trust mismatch before a request is sent; never silently weaken privacy.
  const trustMismatch = minTrust !== 'open' && modelProviders.length > 0 &&
    !modelProviders.some(p => (trustOrder[p.trust_level] ?? -1) >= (trustOrder[minTrust] ?? 99))

  async function send() {
    const text = input.trim()
    if (!user || authLoading || !text || streaming || trustMismatch || !modelReady) return
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
        model,
        messages: updated.map(m => ({ role: m.role, content: m.content })),
        stream: true,
        ocip_preference: 'balanced',
        ocip_min_confidence: minTrust,
      }
      if (maxPrice) body.ocip_max_price = parseFloat(maxPrice)

      const resp = await fetch('/v1/chat/completions', {
        method: 'POST',
        // Browser sessions are HttpOnly-cookie authenticated. API keys are for SDK clients.
        headers: { 'Content-Type': 'application/json' },
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

  // Guests may inspect the exchange, but cannot submit billable inference.
  if (authState(authLoading, user) === 'loading') {
    return <div role="status" className="py-16 text-center text-sm" style={{ color: '#888' }}>Checking sign-in…</div>
  }
  if (authState(authLoading, user) === 'signed-out') {
    return (
      <div className="max-w-xl mx-auto bg-white rounded-2xl border border-gray-200/60 p-8 md:p-12 text-center space-y-5">
        <h2 className="text-2xl font-bold" style={{ color: C.blueBlack }}>Sign in to start chatting</h2>
        <p className="text-sm leading-relaxed" style={{ color: '#777' }}>
          Explore models and prices without an account. To run inference, sign in with GitHub.
          New accounts receive simulated alpha credits; no real payment is taken.
        </p>
        <p className="text-xs leading-relaxed" style={{ color: '#536171' }}>
          Browser chat uses TLS, not end-to-end encryption. The coordinator can read prompts and responses.
          Use nonsensitive test prompts.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link to={loginHref('/chat')} className="px-5 py-3 rounded-xl text-sm font-semibold" style={{ background: C.blueBlack, color: '#fff' }}>
            Continue with GitHub
          </Link>
          <Link to="/models" className="px-5 py-3 rounded-xl text-sm font-medium border" style={{ borderColor: '#ddd', color: C.blueBlack }}>
            Explore models
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 lg:h-[calc(100vh-140px)]">
      {/* ── Main chat column ── */}
      <div className="flex-1 flex flex-col min-w-0 min-h-[65vh] lg:min-h-0">
        {/* Model + trust header bar */}
        <div className="bg-white rounded-2xl border border-gray-200/40 px-5 py-3 mb-4 flex items-center gap-3 flex-wrap">
          <ChatModelPicker
            models={onlineModels}
            value={model}
            onChange={setModel}
            providerCounts={providerCounts}
            loading={modelsLoading || !modelsData}
            disabled={streaming || !!modelsError || !!providersError}
          />

          <span
            className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
            style={{ background: trustInfo.bg, color: trustInfo.text }}
          >
            {trustInfo.label}
          </span>

          <div className="flex-1" />

          <button
            onClick={() => { setMessages([]); if (chatKey) localStorage.removeItem(chatKey) }}
            className="text-xs px-3 py-1.5 rounded-lg border transition-colors"
            style={{ color: '#888', borderColor: '#ddd' }}
          >
            New chat
          </button>

          <button
            onClick={() => setShowSidebar(!showSidebar)}
            aria-expanded={showSidebar}
            aria-controls="chat-advanced-settings"
            className="text-xs px-3 py-1.5 rounded-lg border"
            style={{ color: '#888', borderColor: '#ddd' }}
          >
            {showSidebar ? 'Hide settings' : 'Advanced settings'}
          </button>
        </div>

        {/* Report missing, offline and stale model states before the user sends. */}
        {(modelsError || providersError) ? (
          <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 mb-3 text-xs text-red-800">
            <span className="flex-1">Could not verify available models or providers. Requests are disabled until the connection recovers.</span>
            <button type="button" className="underline font-semibold" onClick={() => {
              void refreshModels()
              void refreshProviders()
            }}>Retry</button>
          </div>
        ) : (!modelsData || !providerData) ? (
          <div role="status" className="rounded-xl bg-gray-50 px-4 py-3 mb-3 text-xs text-gray-600">
            Checking connected models and providers…
          </div>
        ) : onlineModels.length === 0 ? (
          <div role="status" className="rounded-xl bg-gray-50 px-4 py-3 mb-3 text-xs text-gray-700">
            No runnable models are connected right now. Chat will be available when a provider returns.
          </div>
        ) : !modelListed ? (
          <div role="alert" className="rounded-xl bg-amber-50 px-4 py-3 mb-3 text-xs text-amber-900">
            {model ? (
              <>The selected model <strong>{model}</strong> is not currently available.
                {model === 'default' ? ' “default” is a routing alias, not a runnable model.' : ''}
                {' '}Choose one of the connected models above before sending.</>
            ) : 'Choose an available model above before sending.'}
          </div>
        ) : !modelReady ? (
          <div role="status" className="rounded-xl bg-amber-50 px-4 py-3 mb-3 text-xs text-amber-900">
            No provider is currently connected for <strong>{model}</strong>. Choose another online model or try again when this provider returns.
          </div>
        ) : null}

        {/* The public alpha may have only an L0 provider. Make that visible before the user sends. */}
        {trustMismatch && (
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 mb-3 rounded-xl text-xs"
            style={{ background: '#fdf6ec', color: C.blueBlack, border: '1px solid rgba(196,154,69,0.25)' }}>
            <span className="flex-1 min-w-48">
              This model is available, but no provider meets your {trustInfo.label} minimum.
              To test with L0/Open, choose it explicitly below. At L0, both the IE coordinator
              and the provider can read your prompts and responses. Use nonsensitive test messages only.
            </span>
            <button
              onClick={() => setMinTrust('open')}
              className="font-semibold px-3 py-1.5 rounded-lg border shrink-0"
              style={{ borderColor: C.gold, color: C.gold }}
            >
              I understand — use L0/Open
            </button>
          </div>
        )}

        {/* Privacy downgrade warning */}
        {(minTrust === 'open' || minTrust === 'contained') && (
          <div className="flex items-center gap-2 px-4 py-2.5 mb-3 rounded-xl text-xs" style={{ background: '#fdf6ec', color: C.gold, border: '1px solid rgba(196,154,69,0.15)' }}>
            <span>⚠</span>
            <span>
              {minTrust === 'open'
                ? 'L0/Open selected: the coordinator and provider can read prompts and responses. Do not send secrets.'
                : 'L1 providers have basic isolation only.'}
            </span>
            <button onClick={() => setMinTrust('hardened')} className="ml-auto font-medium shrink-0" style={{ color: C.gold }}>
              Use L2
            </button>
          </div>
        )}

        <div className="text-xs leading-relaxed mb-3" style={{ color: '#536171' }}>
          Browser chat uses TLS, not end-to-end encryption. The coordinator can read prompts
          and responses regardless of the provider trust selection.
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-4 pb-4">
          {messages.length === 0 && (
            <div className="text-center mt-24">
              <img src="/logo-icon.svg" alt="IE" className="w-14 h-14 mx-auto mb-4 opacity-30" />
              <div className="text-sm font-medium" style={{ color: '#999' }}>Send a message to start</div>
              <div className="text-xs mt-1" style={{ color: '#bbb' }}>
                {modelReady ? 'Using ' + model : 'Select a connected model above'}
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
                      {m.cost_usd != null && <span>· {formatUsd(m.cost_usd)}</span>}
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
              disabled={streaming || trustMismatch || !modelReady}
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
              <button onClick={send} disabled={trustMismatch || !modelReady || !input.trim()} className="px-5 py-3 rounded-xl text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed" aria-label="Send chat message" style={{ background: C.blueBlack, color: '#fff' }}>
                Send
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Only enforced settings are exposed; routing is automatic for alpha. */}
      {showSidebar && (
        <aside id="chat-advanced-settings" aria-label="Advanced request settings"
          className="order-first lg:order-last w-full lg:w-60 shrink-0 rounded-2xl border border-gray-200/60 bg-white p-4 space-y-4">
          <div>
            <h2 className="text-sm font-semibold" style={{ color: C.blueBlack }}>Advanced request settings</h2>
            <p className="text-xs mt-1" style={{ color: '#777' }}>
              Matching is automatic. With one eligible provider, there is no provider choice to optimize.
            </p>
          </div>
          <div>
            <div className="text-xs mb-2" style={{ color: '#777' }}>Minimum OCIP level</div>
            <div className="flex flex-wrap gap-1.5">
              {TRUST_LEVELS.map(t => {
                const tc = TRUST_COLORS[t.value] || TRUST_COLORS.hardened
                return (
                  <button key={t.value} type="button" onClick={() => setMinTrust(t.value)}
                    aria-pressed={minTrust === t.value}
                    className="text-xs px-2.5 py-1.5 rounded-lg border"
                    style={{ background: minTrust === t.value ? tc.bg : 'white',
                      color: minTrust === t.value ? tc.text : C.blueBlack, borderColor: '#ddd' }}>
                    {t.label}
                  </button>
                )
              })}
            </div>
            <p className="text-[11px] mt-2" style={{ color: '#888' }}>{TRUST_CLAIM_NOTE}</p>
          </div>
          <div>
            <div className="flex justify-between gap-2 text-xs mb-2" style={{ color: C.blueBlack }}>
              <label htmlFor="chat-max-output">Maximum output token price</label>
              <strong>${maxPrice} / 1M</strong>
            </div>
            <input id="chat-max-output" type="range" min="0.01" max="1.00" step="0.01"
              value={maxPrice} onChange={e => setMaxPrice(e.target.value)}
              className="w-full accent-amber-500" />
            <p className="text-[11px] mt-2" style={{ color: '#888' }}>
              This ceiling applies only to the provider output rate. It is not a total-request
              budget and does not cap input or cached-input prices. Simulated requests may
              include a minimum charge.
            </p>
          </div>
        </aside>
      )}
    </div>
  )
}
