import useSWR from 'swr'
import { api } from '../lib/api'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { C, TRUST_COLORS } from '../lib/theme'

const PROVIDER_NAMES: Record<string, string> = {
  openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google', deepseek: 'DeepSeek',
  deepinfra: 'DeepInfra', groq: 'Groq', fireworks: 'Fireworks AI',
  together: 'Together AI', openrouter: 'OpenRouter', alibaba: 'Alibaba Cloud',
}
function providerName(s: string): string {
  return PROVIDER_NAMES[s] || s.charAt(0).toUpperCase() + s.slice(1)
}

// ─── Types ───────────────────────────────────────────────────

interface MarketProvider {
  id: string; name: string; price_output: number; price_input: number; price_cache: number
  tps: number; trust: string; hardware: string; quantization: string
  load: number; encrypted: boolean; verified: boolean; slots: string
  context_length: number; format: string; original_model: string
}

interface MarketModel {
  model: string; family: string; size: string; canonical_id: string
  provider_count: number; cheapest_output: number; fastest_tps: number; max_trust: string
  capabilities: {
    context_length: number; supports_vision: boolean; supports_tool_calling: boolean
    architecture: string; model_type: string
  }
  providers: MarketProvider[]
  reference_prices: Array<{
    provider: string; model: string
    price_input: number; price_cache: number; price_output: number
    diff_pct: number; cheaper: boolean; comparison_type?: string
  }>
}

// ─── Helpers ─────────────────────────────────────────────────

function formatCtx(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1024) return `${Math.round(n / 1024)}k`
  return `${n}`
}

function cacheDiscount(input: number, cache: number): number {
  if (input <= 0 || cache <= 0) return 0
  return Math.round((1 - cache / input) * 100)
}

/** Compute effective blended cost for a workload shape. */
function effectiveCost(
  priceInput: number, priceCache: number, priceOutput: number,
  inputTokens: number, cacheRate: number, outputTokens: number,
): number {
  const cachePrice = priceCache > 0 ? priceCache : priceInput
  const freshInput = inputTokens * (1 - cacheRate)
  const cachedInput = inputTokens * cacheRate
  return (freshInput / 1e6) * priceInput + (cachedInput / 1e6) * cachePrice + (outputTokens / 1e6) * priceOutput
}

// ─── Market Summary Strip ────────────────────────────────────

function MarketSummaryStrip({ stats, models, traces }: {
  stats?: { providers_online: number; models_available: number; total_requests: number }
  models: MarketModel[]; traces: any[]
}) {
  const completedTraces = traces.filter((t: any) => ['completed', 'matched', 'matched_from_queue'].includes(t.status))
  const avgCacheSavings = models.reduce((sum, m) => {
    const withCache = m.providers.filter(p => p.price_cache > 0 && p.price_input > 0)
    if (withCache.length === 0) return sum
    return sum + withCache.reduce((s, p) => s + cacheDiscount(p.price_input, p.price_cache), 0) / withCache.length
  }, 0) / Math.max(models.filter(m => m.providers.some(p => p.price_cache > 0)).length, 1)

  return (
    <div className="flex items-center gap-4 px-4 py-2 rounded-xl text-xs overflow-x-auto"
      style={{ background: '#fff', border: '1px solid #eaeae8' }}>
      {stats && (
        <>
          <span style={{ color: C.green }}>{stats.providers_online} providers</span>
          <span style={{ color: '#ccc' }}>|</span>
          <span style={{ color: C.deepBlue }}>{stats.models_available} models</span>
          <span style={{ color: '#ccc' }}>|</span>
          <span style={{ color: C.gold }}>{stats.total_requests.toLocaleString()} fills</span>
        </>
      )}
      {completedTraces.length > 0 && (
        <>
          <span style={{ color: '#ccc' }}>|</span>
          <span style={{ color: C.turquoise }}>{completedTraces.length} recent trades</span>
        </>
      )}
      {avgCacheSavings > 0 && (
        <>
          <span style={{ color: '#ccc' }}>|</span>
          <span style={{ color: C.indigo }}>avg cache savings {avgCacheSavings.toFixed(0)}%</span>
        </>
      )}
    </div>
  )
}

// ─── Fills Ticker ────────────────────────────────────────────

function FillsTicker({ traces }: { traces: any[] }) {
  const fills = [...traces]
    .filter((t: any) => ['completed', 'matched', 'matched_from_queue'].includes(t.status))
    .reverse()
    .slice(0, 5)

  if (fills.length === 0) return null

  return (
    <div className="flex items-center gap-3 px-4 py-2 rounded-xl overflow-x-auto"
      style={{ background: '#fafaf8', border: '1px solid #eaeae8' }}>
      <span className="text-[9px] uppercase tracking-wider font-medium shrink-0" style={{ color: C.gold }}>
        Recent
      </span>
      {fills.map((t: any) => {
        const time = new Date(t.timestamp * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
        const tc = TRUST_COLORS[t.selected_trust] || TRUST_COLORS.open
        return (
          <div key={t.request_id} className="flex items-center gap-1.5 shrink-0 text-xs">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: C.green }} />
            <span className="font-mono" style={{ color: '#bbb' }}>{time}</span>
            <span className="truncate max-w-[100px]" style={{ color: C.blueBlack }}>
              {t.model === 'default' ? 'Any' : t.model}
            </span>
            {t.selected_price != null && (
              <span className="font-mono" style={{ color: C.gold }}>${t.selected_price.toFixed(2)}</span>
            )}
            <span className="text-[8px] px-1 py-0.5 rounded-full" style={{ background: tc.bg, color: tc.text }}>
              {tc.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ─── Spread Indicator ────────────────────────────────────────

function SpreadIndicator({ providers }: { providers: MarketProvider[] }) {
  if (providers.length < 2) return null
  const prices = providers.map(p => p.price_output).filter(p => p > 0)
  if (prices.length < 2) return null
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const spreadPct = min > 0 ? Math.round((max / min - 1) * 100) : 0
  const barPct = Math.min(spreadPct, 500) / 5 // cap visual at 500%

  return (
    <div className="flex items-center gap-3 mt-2">
      <span className="text-[10px] uppercase tracking-wider" style={{ color: '#aaa' }}>Spread</span>
      <span className="text-xs font-mono" style={{ color: C.green }}>${min.toFixed(2)}</span>
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: '#f0f0f0', maxWidth: 120 }}>
        <div className="h-full rounded-full" style={{
          width: `${Math.max(5, barPct)}%`,
          background: spreadPct > 200 ? C.red : spreadPct > 50 ? C.orange : C.green,
        }} />
      </div>
      <span className="text-xs font-mono" style={{ color: C.red }}>${max.toFixed(2)}</span>
      <span className="text-[10px] font-semibold" style={{
        color: spreadPct > 200 ? C.red : spreadPct > 50 ? C.orange : C.green,
      }}>
        {spreadPct}%
      </span>
    </div>
  )
}

// ─── Cost Estimator ──────────────────────────────────────────

function CostEstimator({ providers }: { providers: MarketProvider[] }) {
  const [inputTok, setInputTok] = useState(1000)
  const [cacheRate, setCacheRate] = useState(0.4)
  const [outputTok, setOutputTok] = useState(500)

  if (providers.length === 0) return null

  const ranked = [...providers]
    .map(p => ({
      ...p,
      effective: effectiveCost(p.price_input, p.price_cache, p.price_output, inputTok, cacheRate, outputTok),
    }))
    .sort((a, b) => a.effective - b.effective)

  const cheapest = ranked[0]
  const expensive = ranked[ranked.length - 1]

  return (
    <div className="bg-white rounded-2xl border border-gray-200/40 p-4 space-y-3">
      <div className="text-[10px] uppercase tracking-wider font-medium" style={{ color: C.turquoise }}>
        Cost Estimator
      </div>
      <div className="space-y-2">
        <div>
          <div className="flex justify-between text-[10px] mb-0.5">
            <span style={{ color: '#888' }}>Input tokens</span>
            <span className="font-mono" style={{ color: C.blueBlack }}>{inputTok.toLocaleString()}</span>
          </div>
          <input type="range" min="100" max="10000" step="100" value={inputTok}
            onChange={e => setInputTok(Number(e.target.value))}
            className="w-full accent-sky-600" style={{ height: 4 }} />
        </div>
        <div>
          <div className="flex justify-between text-[10px] mb-0.5">
            <span style={{ color: '#888' }}>Cache hit rate</span>
            <span className="font-mono" style={{ color: C.indigo }}>{(cacheRate * 100).toFixed(0)}%</span>
          </div>
          <input type="range" min="0" max="0.95" step="0.05" value={cacheRate}
            onChange={e => setCacheRate(Number(e.target.value))}
            className="w-full accent-violet-500" style={{ height: 4 }} />
        </div>
        <div>
          <div className="flex justify-between text-[10px] mb-0.5">
            <span style={{ color: '#888' }}>Output tokens</span>
            <span className="font-mono" style={{ color: C.blueBlack }}>{outputTok.toLocaleString()}</span>
          </div>
          <input type="range" min="50" max="4000" step="50" value={outputTok}
            onChange={e => setOutputTok(Number(e.target.value))}
            className="w-full accent-amber-500" style={{ height: 4 }} />
        </div>
      </div>

      {/* Result */}
      <div className="rounded-xl p-3 space-y-1.5" style={{ background: '#f8f8f7' }}>
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] uppercase tracking-wider" style={{ color: '#aaa' }}>Best effective cost</span>
          <span className="text-lg font-bold font-mono" style={{ color: C.green }}>
            ${cheapest.effective < 0.0001 ? cheapest.effective.toExponential(1) : cheapest.effective.toFixed(4)}
          </span>
        </div>
        <div className="text-xs" style={{ color: '#888' }}>
          {cheapest.name} <span className="font-mono" style={{ color: C.gold }}>
            (in=${cheapest.price_input.toFixed(2)} cache=${cheapest.price_cache > 0 ? cheapest.price_cache.toFixed(2) : '--'} out=${cheapest.price_output.toFixed(2)})
          </span>
        </div>
        {ranked.length > 1 && expensive.effective > cheapest.effective * 1.1 && (
          <div className="text-[10px]" style={{ color: '#bbb' }}>
            vs {expensive.name}: ${expensive.effective < 0.0001 ? expensive.effective.toExponential(1) : expensive.effective.toFixed(4)}
            {cheapest.effective > 0 && (
              <span style={{ color: C.red }}> ({Math.round((expensive.effective / cheapest.effective - 1) * 100)}% more)</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Expanded Provider Detail ────────────────────────────────

function ProviderDetail({ p, reputation, caps }: { p: MarketProvider; reputation?: any; caps?: MarketModel['capabilities'] }) {
  const tc = TRUST_COLORS[p.trust] || TRUST_COLORS.open
  return (
    <div className="px-5 py-4 border-t" style={{ background: '#f8f8f7', borderColor: '#eaeae8' }}>
      {/* Capability badges row */}
      {caps && (
        <div className="flex items-center gap-1.5 mb-3 flex-wrap">
          {caps.context_length > 0 && (
            <span className="text-[9px] font-medium px-1.5 py-0.5 rounded" style={{ background: '#f0f4f8', color: '#4a6fa5' }}>
              {formatCtx(caps.context_length)} ctx
            </span>
          )}
          {caps.supports_tool_calling && (
            <span className="text-[9px] font-medium px-1.5 py-0.5 rounded" style={{ background: '#eef7f0', color: '#2d7d46' }}>tools</span>
          )}
          {caps.supports_vision && (
            <span className="text-[9px] font-medium px-1.5 py-0.5 rounded" style={{ background: '#f3eef7', color: '#6b46a5' }}>vision</span>
          )}
          {caps.architecture && (
            <span className="text-[9px] font-medium px-1.5 py-0.5 rounded" style={{ background: '#f5f3f0', color: '#8a7d60' }}>{caps.architecture}</span>
          )}
          {caps.model_type && (
            <span className="text-[9px] font-medium px-1.5 py-0.5 rounded" style={{ background: '#f5f3f0', color: '#8a7d60' }}>{caps.model_type}</span>
          )}
          {p.context_length > 0 && p.context_length !== caps.context_length && (
            <span className="text-[9px] font-medium px-1.5 py-0.5 rounded" style={{ background: '#fdf6ec', color: C.gold }}>
              provider: {formatCtx(p.context_length)} ctx
            </span>
          )}
        </div>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
        {/* Three-tier pricing */}
        <div>
          <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: '#aaa' }}>Pricing / Mtok</div>
          <div className="space-y-1">
            <div className="flex justify-between">
              <span style={{ color: C.deepBlue }}>Input</span>
              <span className="font-semibold" style={{ color: C.blueBlack }}>${p.price_input.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: C.turquoise }}>Cache</span>
              <span className="font-semibold" style={{ color: p.price_cache > 0 ? C.blueBlack : '#ccc' }}>
                {p.price_cache > 0 ? `$${p.price_cache.toFixed(2)}` : '—'}
              </span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: C.gold }}>Output</span>
              <span className="font-semibold" style={{ color: C.blueBlack }}>${p.price_output.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Runtime / Security */}
        <div>
          <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: '#aaa' }}>Runtime</div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: tc.text }} />
              <span>{tc.label}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: p.encrypted ? C.deepBlue : '#ddd' }} />
              <span>{p.encrypted ? 'E2E encrypted' : 'No E2E'}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: p.verified ? C.green : '#ddd' }} />
              <span>{p.verified ? 'Hash verified' : 'Unverified'}</span>
            </div>
          </div>
        </div>

        {/* Model / Hardware */}
        <div>
          <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: '#aaa' }}>Hardware & Model</div>
          <div className="space-y-1">
            <div>{p.hardware || 'Unknown'}</div>
            {p.quantization && <div className="font-mono" style={{ color: C.gold }}>{p.quantization}</div>}
            {p.format && <div>{p.format.toUpperCase()}</div>}
            {p.context_length > 0 && <div>{formatCtx(p.context_length)} context</div>}
          </div>
        </div>

        {/* Performance / Load */}
        <div>
          <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: '#aaa' }}>Performance</div>
          <div className="space-y-1">
            <div>
              <span style={{ color: C.turquoise }}>{p.tps > 0 ? `${p.tps.toFixed(1)} tok/s` : '—'}</span>
              <span style={{ color: '#bbb' }}> observed</span>
            </div>
            <div>
              Load: <span style={{ color: p.load > 0.8 ? C.red : p.load > 0.5 ? C.orange : C.green }}>
                {(p.load * 100).toFixed(0)}%
              </span>
            </div>
            <div>Slots: {p.slots || '—'}</div>
            {reputation && (
              <div>
                Rep: <span style={{ color: reputation.score > 0.8 ? C.green : reputation.score > 0.5 ? C.gold : C.red }}>
                  {(reputation.score * 100).toFixed(0)}%
                </span>
                <span style={{ color: '#bbb' }}> ({reputation.total_requests} req)</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Reference Pricing Section ───────────────────────────────

type RefSortCol = 'provider' | 'input' | 'cache' | 'output'
type RefSortDir = 'asc' | 'desc'

function ReferencePricing({ refs, exchangePrice, exchangeModel, exchangeInput, exchangeCache }: {
  refs: MarketModel['reference_prices']; exchangePrice: number
  exchangeModel: string; exchangeInput: number; exchangeCache: number
}) {
  const [sortCol, setSortCol] = useState<RefSortCol>('output')
  const [sortDir, setSortDir] = useState<RefSortDir>('asc')

  if (!refs || refs.length === 0) return null

  const toggleSort = (col: RefSortCol) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }
  const arrow = (col: RefSortCol) => sortCol === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''

  // Build unified offerings list: exchange + all references
  type Offering = {
    provider: string; model: string
    input: number; cache: number; output: number
    isExchange: boolean; isOpen: boolean
  }

  const offerings: Offering[] = [
    {
      provider: 'Inference Exchange', model: exchangeModel,
      input: exchangeInput, cache: exchangeCache, output: exchangePrice,
      isExchange: true, isOpen: true,
    },
    ...refs.map(r => ({
      provider: providerName(r.provider), model: r.model,
      input: r.price_input, cache: r.price_cache, output: r.price_output,
      isExchange: false, isOpen: r.comparison_type === 'same_model' || !r.comparison_type,
    })),
  ]

  offerings.sort((a, b) => {
    const valA = sortCol === 'provider' ? a.provider : sortCol === 'input' ? a.input : sortCol === 'cache' ? a.cache : a.output
    const valB = sortCol === 'provider' ? b.provider : sortCol === 'input' ? b.input : sortCol === 'cache' ? b.cache : b.output
    if (typeof valA === 'string' && typeof valB === 'string') return sortDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA)
    return sortDir === 'asc' ? (valA as number) - (valB as number) : (valB as number) - (valA as number)
  })

  // Find cheapest in each column for highlighting
  const allIn = offerings.map(o => o.input).filter(v => v > 0)
  const allCache = offerings.map(o => o.cache).filter(v => v > 0)
  const allOut = offerings.map(o => o.output).filter(v => v > 0)
  const minIn = allIn.length ? Math.min(...allIn) : 0
  const minCache = allCache.length ? Math.min(...allCache) : 0
  const minOut = allOut.length ? Math.min(...allOut) : 0

  return (
    <div>
      {/* Sort controls */}
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] uppercase tracking-wider" style={{ color: '#aaa' }}>
          Market comparison
        </div>
        <div className="flex items-center gap-1">
          {(['output', 'input', 'cache', 'provider'] as RefSortCol[]).map(col => (
            <button key={col} onClick={() => toggleSort(col)}
              className="text-[9px] uppercase tracking-wider px-2 py-0.5 rounded-full transition-colors"
              style={{ background: sortCol === col ? C.blueBlack : 'transparent', color: sortCol === col ? '#fff' : '#aaa' }}>
              {col}{arrow(col)}
            </button>
          ))}
        </div>
      </div>

      {/* Offerings table */}
      <div className="space-y-1.5 max-h-[360px] overflow-y-auto">
        {offerings.map((o, i) => {
          const isMin = (val: number, min: number) => val > 0 && val === min
          return (
            <div key={i} className="rounded-xl px-3 py-2.5"
              style={{
                background: o.isExchange ? '#ebebea' : '#fff',
                border: o.isExchange ? `1.5px solid ${C.gold}44` : '1px solid #eee',
              }}>
              {/* Provider + model + type badge */}
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-xs font-semibold" style={{ color: o.isExchange ? C.gold : C.blueBlack }}>
                  {o.provider}
                </span>
                <span className="text-[11px] flex-1 min-w-0 truncate" style={{ color: o.isExchange ? '#8a7d60' : '#888' }}>
                  {o.model}
                </span>
                <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
                  style={{
                    background: o.isOpen ? '#edf7f1' : '#f3f0f5',
                    color: o.isOpen ? C.green : C.indigo,
                  }}>
                  {o.isOpen ? 'open' : 'proprietary'}
                </span>
              </div>

              {/* Price pills */}
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 px-2 py-1 rounded-lg" style={{ background: o.isExchange ? '#e3e3e1' : '#f5f5f3' }}>
                  <span className="text-[9px] uppercase" style={{ color: C.deepBlue }}>in</span>
                  <span className="text-xs font-mono font-medium" style={{ color: isMin(o.input, minIn) ? C.green : C.blueBlack }}>
                    {o.input > 0 ? `$${o.input.toFixed(2)}` : '—'}
                  </span>
                </div>
                <div className="flex items-center gap-1 px-2 py-1 rounded-lg" style={{ background: o.isExchange ? '#e3e3e1' : '#f5f5f3' }}>
                  <span className="text-[9px] uppercase" style={{ color: C.turquoise }}>cache</span>
                  <span className="text-xs font-mono font-medium" style={{ color: isMin(o.cache, minCache) ? C.green : o.cache > 0 ? C.blueBlack : '#ccc' }}>
                    {o.cache > 0 ? `$${o.cache < 0.1 ? o.cache.toFixed(3) : o.cache.toFixed(2)}` : '—'}
                  </span>
                </div>
                <div className="flex items-center gap-1 px-2 py-1 rounded-lg" style={{ background: o.isExchange ? '#e3e3e1' : '#f5f5f3' }}>
                  <span className="text-[9px] uppercase" style={{ color: C.gold }}>out</span>
                  <span className="text-xs font-mono font-medium" style={{ color: isMin(o.output, minOut) ? C.green : C.blueBlack }}>
                    {o.output > 0 ? `$${o.output.toFixed(2)}` : '—'}
                  </span>
                </div>
                <span className="text-[9px] ml-auto" style={{ color: '#bbb' }}>$/Mtok</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Main ────────────────────────────────────────────────────

export function Exchange() {
  const { data: marketData } = useSWR('market', api.market, { refreshInterval: 5000 })
  const { data: provData } = useSWR('providers', api.providers, { refreshInterval: 5000 })
  const { data: stats } = useSWR('stats', api.stats, { refreshInterval: 5000 })
  const { data: repData } = useSWR('reputation', api.reputation, { refreshInterval: 10000 })
  const { data: traceData } = useSWR('traces', api.traces, { refreshInterval: 5000 })

  const models = (marketData?.models || []) as MarketModel[]
  const allProviders = provData?.providers || []
  const repMap = new Map((repData?.reputation || []).map((r: any) => [r.provider_id, r]))
  const traces = traceData?.traces || []
  const recentTrades = [...traces].reverse().slice(0, 8)

  // Filter state
  const [selectedModel, setSelectedModel] = useState('')
  const [selectedQuant, setSelectedQuant] = useState('')
  const [minTrust, setMinTrust] = useState('hardened')
  const [priceCeiling, setPriceCeiling] = useState('0.15')
  const [selectedProviderId, setSelectedProviderId] = useState('')
  const [expandedProviderId, setExpandedProviderId] = useState<string | null>(null)
  const [showMarketContext, setShowMarketContext] = useState(false)

  // Resolve selected model
  const activeModel = selectedModel || (models.length > 0 ? models[0].model : '')
  const modelData = models.find(m => m.model === activeModel)

  // Quantizations and capabilities
  const quantizations = modelData ? [...new Set(modelData.providers.map(p => p.quantization).filter(Boolean))] : []
  const caps = modelData?.capabilities

  // Filter
  const trustOrder = ['open', 'contained', 'hardened', 'confidential']
  const minTrustIdx = trustOrder.indexOf(minTrust)
  const ceiling = parseFloat(priceCeiling) || 999

  const eligibleProviders = (modelData?.providers || [])
    .filter(p => {
      const trustIdx = trustOrder.indexOf(p.trust)
      if (trustIdx < minTrustIdx) return false
      if (p.price_output > ceiling) return false
      if (selectedQuant && p.quantization !== selectedQuant) return false
      return true
    })
    .sort((a, b) => a.price_output - b.price_output)

  // All providers for model (before filters) for context
  const allModelProviders = modelData?.providers || []
  const priceRange = allModelProviders.length > 0
    ? { min: Math.min(...allModelProviders.map(p => p.price_output)), max: Math.max(...allModelProviders.map(p => p.price_output)) }
    : null
  const tpsRange = allModelProviders.filter(p => p.tps > 0).length > 0
    ? { min: Math.min(...allModelProviders.filter(p => p.tps > 0).map(p => p.tps)), max: Math.max(...allModelProviders.map(p => p.tps)) }
    : null
  const verifiedCount = allModelProviders.filter(p => p.verified).length
  const encryptedCount = allModelProviders.filter(p => p.encrypted).length

  // Route selection
  const bestRoute = eligibleProviders.length > 0 ? eligibleProviders[0] : null
  const activeProvider = selectedProviderId
    ? eligibleProviders.find(p => p.id === selectedProviderId) || bestRoute
    : bestRoute

  // Fleet stats
  const totalSlots = allProviders.reduce((s: number, p: any) => s + p.max_concurrent, 0)
  const usedSlots = allProviders.reduce((s: number, p: any) => s + p.active_requests, 0)

  function explainRoute() {
    if (!activeProvider) return null
    const tc = TRUST_COLORS[activeProvider.trust] || TRUST_COLORS.open
    const parts: string[] = [`Meets ${tc.label}`]
    if (eligibleProviders.length > 1) {
      const rank = eligibleProviders.findIndex(p => p.id === activeProvider.id) + 1
      if (rank === 1) parts.push(activeProvider.tps >= (eligibleProviders[1]?.tps || 0) ? 'fastest eligible' : 'cheapest eligible')
      else parts.push(`${rank === 2 ? '2nd' : rank === 3 ? '3rd' : `${rank}th`} cheapest`)
    } else {
      parts.push('only eligible provider')
    }
    parts.push(`within $${priceCeiling} cap`)
    if (activeProvider.encrypted) parts.push('E2E encrypted')
    return parts.join(' · ')
  }

  // Empty state
  if (marketData && models.length === 0) {
    return (
      <div className="max-w-2xl mx-auto text-center py-16">
        <img src="/logo-icon.svg" alt="IE" className="w-16 h-16 mx-auto mb-6 opacity-20" />
        <h2 className="text-xl font-bold mb-3" style={{ color: C.blueBlack }}>The exchange is quiet</h2>
        <p className="text-sm mb-8" style={{ color: '#888' }}>No providers connected.</p>
        <div className="bg-white rounded-2xl border border-gray-200/40 p-6 text-left max-w-sm mx-auto">
          <div className="rounded-xl p-4 font-mono text-xs space-y-1" style={{ background: C.blueBlack, color: C.warmWhite }}>
            <div><span style={{ color: '#666' }}>$</span> pip install ie-provider</div>
            <div><span style={{ color: '#666' }}>$</span> ie-provider start</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-6">
      {/* ── Left: Filter panel ── */}
      <div className="w-64 shrink-0 space-y-5">
        <div className="bg-white rounded-2xl border border-gray-200/40 p-5 space-y-5">
          <div className="text-[10px] uppercase tracking-wider font-medium" style={{ color: C.gold }}>Filter Market</div>

          {/* Model */}
          <div>
            <div className="text-xs mb-1.5" style={{ color: '#888' }}>Model</div>
            <div className="flex flex-wrap gap-1.5">
              {models.map(m => (
                <button key={m.model}
                  onClick={() => { setSelectedModel(m.model); setSelectedQuant(''); setSelectedProviderId(''); setExpandedProviderId(null) }}
                  className="text-[11px] font-medium px-3 py-1.5 rounded-lg transition-colors truncate max-w-full"
                  style={{ background: activeModel === m.model ? C.blueBlack : 'transparent', color: activeModel === m.model ? '#fff' : '#888', border: `1px solid ${activeModel === m.model ? C.blueBlack : '#e5e5e5'}` }}
                >{m.model}</button>
              ))}
            </div>
          </div>

          {/* Quantization */}
          {quantizations.length > 0 && (
            <div>
              <div className="text-xs mb-1.5" style={{ color: '#888' }}>Quantization</div>
              <div className="flex flex-wrap gap-1">
                {quantizations.map(q => (
                  <button key={q}
                    onClick={() => { setSelectedQuant(selectedQuant === q ? '' : q); setSelectedProviderId('') }}
                    className="text-[11px] font-medium px-2.5 py-1 rounded-lg transition-colors font-mono"
                    style={{ background: selectedQuant === q ? C.blueBlack : 'transparent', color: selectedQuant === q ? '#fff' : '#888', border: `1px solid ${selectedQuant === q ? C.blueBlack : '#e5e5e5'}` }}
                  >{q}</button>
                ))}
              </div>
            </div>
          )}

          {/* Trust */}
          <div>
            <div className="text-xs mb-1.5" style={{ color: '#888' }}>Minimum trust</div>
            <div className="flex flex-wrap gap-1">
              {(['open', 'contained', 'hardened', 'confidential'] as const).map(level => {
                const tc = TRUST_COLORS[level]
                return (
                  <button key={level}
                    onClick={() => { setMinTrust(level); setSelectedProviderId('') }}
                    className="text-[11px] font-medium px-2.5 py-1 rounded-full transition-colors"
                    style={{ background: minTrust === level ? tc.bg : 'transparent', color: minTrust === level ? tc.text : '#aaa', border: `1px solid ${minTrust === level ? 'transparent' : '#e5e5e5'}` }}
                  >{tc.label}</button>
                )
              })}
            </div>
          </div>

          {/* Price ceiling */}
          <div>
            <div className="text-xs mb-1.5" style={{ color: '#888' }}>Price ceiling</div>
            <div className="text-lg font-bold" style={{ color: C.blueBlack }}>${priceCeiling} / M output</div>
            <input type="range" min="0.01" max="1.00" step="0.01" value={priceCeiling}
              onChange={e => { setPriceCeiling(e.target.value); setSelectedProviderId('') }}
              className="w-full mt-1.5 accent-amber-500" />
          </div>

          {/* Route */}
          <div>
            <div className="text-xs mb-1.5" style={{ color: '#888' }}>Route</div>
            <span className="text-[11px] font-medium px-3 py-1 rounded-full"
              style={{ background: activeProvider ? '#edf7f1' : '#f3f3f3', color: activeProvider ? C.green : '#999' }}>
              {activeProvider ? 'Lowest eligible' : 'No match'}
            </span>
          </div>
        </div>

        {/* Cost estimator */}
        <CostEstimator providers={allModelProviders} />

        {/* Fleet summary */}
        <div className="px-1 space-y-2">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold" style={{ color: C.blueBlack }}>{eligibleProviders.length}</span>
            <span className="text-xs" style={{ color: '#888' }}>eligible providers</span>
          </div>
          {stats && (
            <div className="text-xs space-y-1" style={{ color: '#999' }}>
              <div>{stats.providers_online} online · {totalSlots > 0 ? `${usedSlots}/${totalSlots} slots` : '—'}</div>
              <div>{stats.total_requests.toLocaleString()} total fills</div>
            </div>
          )}
          <div className="text-[10px] uppercase tracking-wider font-medium mt-2" style={{ color: C.gold }}>Live market</div>
          <div className="text-xs" style={{ color: '#aaa' }}>Price updates every few seconds.</div>
        </div>
      </div>

      {/* ── Right: Market depth + context ── */}
      <div className="flex-1 min-w-0 space-y-5">
        {/* Market summary + fills ticker */}
        <div className="space-y-2">
          <MarketSummaryStrip stats={stats} models={models} traces={traces} />
          <FillsTicker traces={traces} />
        </div>

        {/* Market depth header with model summary */}
        <div>
          <div className="text-[10px] uppercase tracking-wider font-medium mb-1" style={{ color: C.gold }}>Market Depth</div>
          <h2 className="text-xl font-bold" style={{ color: C.blueBlack }}>{activeModel || 'Select a model'}</h2>
          <div className="flex items-center gap-3 mt-1.5 flex-wrap text-xs" style={{ color: '#888' }}>
            <span>{allModelProviders.length} provider{allModelProviders.length !== 1 ? 's' : ''} total</span>
            <span>{eligibleProviders.length} eligible</span>
            {priceRange && <span>${priceRange.min.toFixed(2)}–${priceRange.max.toFixed(2)}/M out</span>}
            {tpsRange && <span>{tpsRange.min.toFixed(0)}–{tpsRange.max.toFixed(0)} tok/s</span>}
            {verifiedCount > 0 && <span style={{ color: C.green }}>{verifiedCount} verified</span>}
            {encryptedCount > 0 && <span style={{ color: C.deepBlue }}>{encryptedCount} E2E</span>}
          </div>
          {/* Spread indicator */}
          <SpreadIndicator providers={allModelProviders} />
          {/* Capability badges */}
          {caps && (
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              {caps.context_length > 0 && (
                <span className="text-[9px] font-medium px-1.5 py-0.5 rounded" style={{ background: '#f0f4f8', color: '#4a6fa5' }}>
                  {formatCtx(caps.context_length)} ctx
                </span>
              )}
              {caps.supports_tool_calling && (
                <span className="text-[9px] font-medium px-1.5 py-0.5 rounded" style={{ background: '#eef7f0', color: '#2d7d46' }}>tools</span>
              )}
              {caps.supports_vision && (
                <span className="text-[9px] font-medium px-1.5 py-0.5 rounded" style={{ background: '#f3eef7', color: '#6b46a5' }}>vision</span>
              )}
              {caps.architecture && (
                <span className="text-[9px] font-medium px-1.5 py-0.5 rounded" style={{ background: '#f5f3f0', color: '#8a7d60' }}>{caps.architecture}</span>
              )}
            </div>
          )}
        </div>

        {/* Provider table */}
        <div className="bg-white rounded-2xl border border-gray-200/40 overflow-hidden">
          <div className="grid grid-cols-12 gap-2 px-5 py-3 text-[10px] uppercase tracking-wider border-b border-gray-100" style={{ color: '#aaa' }}>
            <div className="col-span-2">Provider</div>
            <div className="col-span-1">Hardware</div>
            <div className="col-span-1 text-right">In</div>
            <div className="col-span-1 text-right">Cache</div>
            <div className="col-span-1 text-right">Out</div>
            <div className="col-span-1 text-right">Speed</div>
            <div className="col-span-1 text-center">Load</div>
            <div className="col-span-1">Trust</div>
            <div className="col-span-2 text-right">Action</div>
          </div>

          {eligibleProviders.length > 0 ? eligibleProviders.map(p => {
            const isSelected = activeProvider?.id === p.id
            const isExpanded = expandedProviderId === p.id
            const tc = TRUST_COLORS[p.trust] || TRUST_COLORS.open
            const rep = repMap.get(p.id)
            return (
              <div key={p.id}>
                <div
                  className="grid grid-cols-12 gap-2 px-5 py-3 items-center border-b border-gray-50 transition-colors cursor-pointer"
                  style={{ background: isSelected ? '#fdf6ec' : 'transparent', borderLeft: isSelected ? `3px solid ${C.gold}` : '3px solid transparent' }}
                  onClick={() => setExpandedProviderId(isExpanded ? null : p.id)}
                >
                  <div className="col-span-2 min-w-0">
                    <div className="text-sm font-medium truncate" style={{ color: C.blueBlack }}>{p.name}</div>
                    <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                      {p.verified && <span className="text-[8px] px-1 rounded" style={{ background: '#edf7f1', color: C.green }}>✓</span>}
                      {p.encrypted && <span className="text-[8px] px-1 rounded" style={{ background: '#eef3f7', color: C.deepBlue }}>E2E</span>}
                      {p.price_cache > 0 && p.price_input > 0 && (
                        <span className="text-[8px] px-1 rounded" style={{ background: '#f3eef7', color: C.indigo }}>
                          -{cacheDiscount(p.price_input, p.price_cache)}% cache
                        </span>
                      )}
                      {p.quantization && <span className="text-[8px] font-mono" style={{ color: '#999' }}>{p.quantization}</span>}
                      {p.context_length > 0 && <span className="text-[8px]" style={{ color: '#aaa' }}>{formatCtx(p.context_length)}</span>}
                      {p.format && <span className="text-[8px]" style={{ color: '#aaa' }}>{p.format.toUpperCase()}</span>}
                    </div>
                  </div>
                  <div className="col-span-1 text-xs truncate" style={{ color: '#888' }}>{p.hardware || '—'}</div>
                  <div className="col-span-1 text-right text-xs" style={{ color: C.deepBlue }}>${p.price_input.toFixed(2)}</div>
                  <div className="col-span-1 text-right text-xs" style={{ color: p.price_cache > 0 ? C.turquoise : '#ddd' }}>
                    {p.price_cache > 0 ? `$${p.price_cache.toFixed(2)}` : '—'}
                  </div>
                  <div className="col-span-1 text-right text-sm font-semibold" style={{ color: C.gold }}>${p.price_output.toFixed(2)}</div>
                  <div className="col-span-1 text-right text-sm" style={{ color: C.turquoise }}>
                    {p.tps > 0 ? `${p.tps.toFixed(0)}` : '—'}
                  </div>
                  <div className="col-span-1 text-center">
                    <div className="w-full h-1.5 rounded-full overflow-hidden mx-auto" style={{ background: '#f0f0f0', maxWidth: '40px' }}>
                      <div className="h-full rounded-full" style={{
                        width: `${Math.max(5, p.load * 100)}%`,
                        background: p.load > 0.8 ? C.red : p.load > 0.5 ? C.orange : C.green,
                      }} />
                    </div>
                  </div>
                  <div className="col-span-1">
                    <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full" style={{ background: tc.bg, color: tc.text }}>{tc.label}</span>
                  </div>
                  <div className="col-span-2 text-right flex items-center justify-end gap-1.5">
                    {isSelected ? (
                      <span className="text-[11px] font-semibold" style={{ color: C.gold }}>Selected</span>
                    ) : (
                      <button className="text-[11px] font-medium px-2.5 py-1 rounded-lg border" style={{ color: '#888', borderColor: '#ddd' }}
                        onClick={e => { e.stopPropagation(); setSelectedProviderId(p.id) }}>Select</button>
                    )}
                    <svg className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="#aaa" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
                {isExpanded && <ProviderDetail p={p} reputation={rep} caps={caps} />}
              </div>
            )
          }) : (
            <div className="px-5 py-12 text-center text-sm" style={{ color: '#ccc' }}>
              No providers match your filters. Try relaxing trust or raising the price ceiling.
            </div>
          )}
        </div>

        {/* Why this route? */}
        {activeProvider && (
          <div className="bg-white rounded-2xl border border-gray-200/40 p-5">
            <div className="text-[10px] uppercase tracking-wider font-medium mb-2" style={{ color: C.gold }}>Why this route?</div>
            <div className="text-sm" style={{ color: C.blueBlack }}>
              <span className="font-semibold">{activeProvider.name}</span> {explainRoute()}
            </div>
            <div className="text-xs mt-1" style={{ color: '#aaa' }}>
              {eligibleProviders.length > 1 ? `${eligibleProviders.length - 1} alternative${eligibleProviders.length > 2 ? 's' : ''} available` : 'No alternatives'} · evidence available after the request.
            </div>
            <div className="mt-3 flex gap-2">
              <Link to={`/chat?model=${encodeURIComponent(activeModel)}`}
                className="text-[11px] font-medium px-4 py-1.5 rounded-lg" style={{ background: C.blueBlack, color: '#fff' }}>
                Use this route
              </Link>
              <Link to="/trace"
                className="text-[11px] font-medium px-4 py-1.5 rounded-lg border" style={{ color: '#888', borderColor: '#ddd' }}>
                View recent traces
              </Link>
            </div>
          </div>
        )}

        {/* Market context (collapsible) */}
        {modelData && (modelData.reference_prices?.length > 0 || recentTrades.length > 0) && (
          <div className="bg-white rounded-2xl border border-gray-200/40 overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-5 py-3.5 text-left"
              onClick={() => setShowMarketContext(!showMarketContext)}
            >
              <div className="text-[10px] uppercase tracking-wider font-medium" style={{ color: C.gold }}>
                Market Context
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs" style={{ color: '#aaa' }}>
                  {modelData.reference_prices?.length || 0} external prices · {recentTrades.length} recent trades
                </span>
                <svg className={`w-3.5 h-3.5 transition-transform ${showMarketContext ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="#aaa" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>

            {showMarketContext && (
              <div className="px-5 pb-5 space-y-5 border-t border-gray-100 pt-4">
                {/* Reference pricing */}
                <ReferencePricing
                  refs={modelData.reference_prices}
                  exchangePrice={modelData.cheapest_output}
                  exchangeModel={modelData.model}
                  exchangeInput={bestRoute?.price_input || 0}
                  exchangeCache={bestRoute?.price_cache || 0}
                />

                {/* Recent trades */}
                {recentTrades.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: '#aaa' }}>Recent trades</div>
                    <div className="space-y-0">
                      {recentTrades.map((t: any) => {
                        const ok = ['completed', 'matched', 'matched_from_queue'].includes(t.status)
                        const time = new Date(t.timestamp * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                        return (
                          <div key={t.request_id} className="flex items-center gap-3 py-1.5 border-b border-gray-50 last:border-0 text-xs">
                            <span className="font-mono w-14" style={{ color: '#bbb' }}>{time}</span>
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: ok ? C.green : C.red }} />
                            <span className="flex-1 truncate" style={{ color: C.blueBlack }}>{t.model === 'default' ? 'Any' : t.model}</span>
                            {t.selected_price != null && <span style={{ color: C.gold }}>${t.selected_price.toFixed(2)}</span>}
                            {t.selected_trust && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full"
                                style={{ background: TRUST_COLORS[t.selected_trust]?.bg || '#f3f3f3', color: TRUST_COLORS[t.selected_trust]?.text || '#999' }}>
                                {TRUST_COLORS[t.selected_trust]?.label || t.selected_trust}
                              </span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="text-xs" style={{ color: '#aaa' }}>The market is a tool, not the interface.</div>
      </div>
    </div>
  )
}
