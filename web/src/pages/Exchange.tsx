import useSWR from 'swr'
import { api } from '../lib/api'
import { useState, useMemo, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { C, TRUST_COLORS } from '../lib/theme'

// ─── Constants ───────────────────────────────────────────────

const PROVIDER_NAMES: Record<string, string> = {
  openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google', deepseek: 'DeepSeek',
  deepinfra: 'DeepInfra', groq: 'Groq', fireworks: 'Fireworks AI',
  together: 'Together AI', openrouter: 'OpenRouter', alibaba: 'Alibaba Cloud',
  'inference-exchange': 'Inference Exchange', nousresearch: 'NousResearch', mistral: 'Mistral',
  'z.ai': 'Z.ai', microsoft: 'Microsoft',
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

// Unified model for the command palette
interface UnifiedModel {
  key: string; name: string; vendor: string; family: string; params: string
  price: number; quality: number | null; codingIndex: number | null
  cache: boolean; open: boolean; ctx: string; providerCount: number
  source: 'ie' | 'ref' | 'both'
}

// Unified provider row for the offer table
interface OfferRow {
  name: string; source: string; isIE: boolean
  priceInput: number; priceCache: number; priceOutput: number
  quality: number | null; tps: number | null
  trust?: string; encrypted?: boolean; quantization?: string
  displayName?: string
}

// ─── Helpers ─────────────────────────────────────────────────

function formatCtx(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1024) return `${Math.round(n / 1024)}k`
  return `${n}`
}

function cacheDiscount(input: number, cache: number): number {
  if (input <= 0 || cache <= 0) return 0
  return Math.round((1 - cache / input) * 100)
}

function parseSize(s: string): number | null {
  if (!s || s === '—') return null
  const m = s.match(/([\d.]+)\s*B/i)
  return m ? parseFloat(m[1]) : null
}

function fmtPrice(p: number): string {
  if (p <= 0) return '—'
  if (p < 0.1) return `$${p.toFixed(3)}`
  if (p < 1) return `$${p.toFixed(2)}`
  return `$${p.toFixed(2)}`
}

// ─── Interactive Price Chart ─────────────────────────────────

const CHART_COLORS = [C.gold, C.turquoise, C.deepBlue, C.orange, C.red, '#888', C.indigo, C.green, C.maroon]

type PriceTier = 'output' | 'input' | 'cache'
const TIER_META: Record<PriceTier, { label: string; color: string; key: keyof OfferRow }> = {
  output: { label: 'Output', color: C.gold, key: 'priceOutput' },
  input: { label: 'Input', color: C.deepBlue, key: 'priceInput' },
  cache: { label: 'Cache', color: C.turquoise, key: 'priceCache' },
}

function PriceChart({ offerRows, modelName }: { offerRows: OfferRow[]; modelName: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [tier, setTier] = useState<PriceTier>('output')
  const [hiddenIdx, setHiddenIdx] = useState<Set<number>>(new Set())
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string; color: string } | null>(null)

  const tierKey = TIER_META[tier].key
  const providers = useMemo(() =>
    offerRows.filter(r => {
      const v = r[tierKey] as number
      return v > 0
    }).map((r, i) => ({
      name: r.name,
      price: r[tierKey] as number,
      color: r.isIE ? C.gold : CHART_COLORS[i % CHART_COLORS.length],
      isIE: r.isIE,
      // Flat line for 30 days (current price). IE starts at day 15.
      prices: r.isIE
        ? [...Array(15).fill(null), ...Array(15).fill(r[tierKey] as number)]
        : Array(30).fill(r[tierKey] as number),
    })),
  [offerRows, tierKey])

  const yMax = useMemo(() => {
    const vals = providers.map(p => p.price)
    return vals.length ? Math.max(...vals) * 1.15 : 1
  }, [providers])

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || providers.length === 0) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const W = canvas.width, H = canvas.height
    const PAD = { t: 10, r: 44, b: 18, l: 4 }
    const pW = W - PAD.l - PAD.r, pH = H - PAD.t - PAD.b

    const yC = (v: number) => PAD.t + pH * (1 - v / yMax)
    const xC = (i: number) => PAD.l + (i / 29) * pW

    ctx.clearRect(0, 0, W, H)

    // Grid
    ctx.strokeStyle = '#e0e0e0'
    ctx.lineWidth = 0.5
    for (const f of [0.25, 0.5, 0.75, 1]) {
      const y = yC(yMax * f)
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W - PAD.r, y); ctx.stroke()
    }

    // Y labels
    ctx.fillStyle = '#999'
    ctx.font = '16px SF Mono,Menlo,monospace'
    ctx.textAlign = 'left'
    for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      ctx.fillText('$' + (yMax * f).toFixed(2), W - PAD.r + 4, yC(yMax * f) + 4)
    }

    // Lines
    providers.forEach((p, pi) => {
      if (hiddenIdx.has(pi)) return
      ctx.strokeStyle = p.color
      ctx.lineWidth = p.isIE ? 3 : 1.5
      ctx.setLineDash(p.isIE ? [] : [6, 4])
      ctx.beginPath()
      let started = false
      p.prices.forEach((v: number | null, i: number) => {
        if (v === null) return
        const x = xC(i), y = yC(v)
        if (!started) { ctx.moveTo(x, y); started = true } else ctx.lineTo(x, y)
      })
      ctx.stroke()
      ctx.setLineDash([])

      // Entry dot for IE
      if (p.prices[0] === null) {
        const fi = p.prices.findIndex((v: number | null) => v !== null)
        if (fi >= 0) {
          ctx.fillStyle = p.color
          ctx.beginPath(); ctx.arc(xC(fi), yC(p.prices[fi]!), 4, 0, Math.PI * 2); ctx.fill()
        }
      }
    })
  }, [providers, yMax, hiddenIdx, tier])

  // Hover
  const handleMove = (e: React.MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const W = canvas.width, H = canvas.height
    const PAD = { t: 10, r: 44, b: 18, l: 4 }
    const pW = W - PAD.l - PAD.r, pH = H - PAD.t - PAD.b
    const mx = (e.clientX - rect.left) * (W / rect.width)
    const my = (e.clientY - rect.top) * (H / rect.height)
    const day = Math.round((mx - PAD.l) / pW * 29)
    if (day < 0 || day > 29) { setTooltip(null); return }

    const yC = (v: number) => PAD.t + pH * (1 - v / yMax)
    let best: { p: typeof providers[0]; v: number } | null = null
    let bestDist = Infinity
    providers.forEach((p, pi) => {
      if (hiddenIdx.has(pi) || p.prices[day] === null) return
      const py = yC(p.prices[day]!)
      const d = Math.abs(my - py)
      if (d < bestDist) { bestDist = d; best = { p, v: p.prices[day]! } }
    })

    if (best && bestDist < 30 * (H / rect.height)) {
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      const da = 29 - day
      setTooltip({
        x: px + 10, y: py - 24,
        text: `${best.p.name}  $${best.v.toFixed(2)}/Mtok ${TIER_META[tier].label.toLowerCase()}${da > 0 ? ` · ${da}d ago` : ' · today'}`,
        color: best.p.color,
      })
    } else {
      setTooltip(null)
    }
  }

  const toggleProvider = (idx: number) => {
    setHiddenIdx(prev => {
      const next = new Set(prev)
      next.has(idx) ? next.delete(idx) : next.add(idx)
      return next
    })
  }

  return (
    <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #eaeae8', padding: 14, paddingBottom: 8, overflow: 'hidden' }}>
      <h4 style={{ fontSize: 8, textTransform: 'uppercase', letterSpacing: '.06em', color: '#888', marginBottom: 8, fontWeight: 600 }}>
        {modelName} — provider prices (30d)
      </h4>

      {/* Tier tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {(['output', 'input', 'cache'] as PriceTier[]).map(t => (
          <span key={t} onClick={() => setTier(t)} style={{
            fontSize: 9, fontWeight: 600, padding: '3px 8px', borderRadius: 5, cursor: 'pointer',
            background: tier === t ? TIER_META[t].color : '#f5f5f3',
            color: tier === t ? '#fff' : '#888',
            border: `1px solid ${tier === t ? TIER_META[t].color : '#e5e5e5'}`,
          }}>
            {TIER_META[t].label}
          </span>
        ))}
      </div>

      {providers.length > 0 ? (
        <div ref={containerRef} style={{ position: 'relative' }}>
          <canvas ref={canvasRef} width={540} height={280}
            style={{ width: '100%', height: 140, borderRadius: 8, background: '#fafaf8', cursor: 'crosshair' }}
            onMouseMove={handleMove}
            onMouseLeave={() => setTooltip(null)}
          />
          {tooltip && (
            <div style={{
              position: 'absolute', left: tooltip.x, top: tooltip.y,
              background: '#292F35', color: '#fff', fontSize: 10, padding: '4px 8px',
              borderRadius: 5, whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 10,
              borderLeft: `3px solid ${tooltip.color}`,
            }}>
              {tooltip.text}
            </div>
          )}

          {/* Legend */}
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
            {providers.map((p, i) => (
              <span key={i} onClick={() => toggleProvider(i)} style={{
                fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                cursor: 'pointer', userSelect: 'none',
                border: `1px solid ${p.color}`, color: p.color, background: p.color + '11',
                opacity: hiddenIdx.has(i) ? 0.3 : 1, transition: 'opacity .15s',
              }}>
                {p.name}
              </span>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: '#aaa', marginTop: 2 }}>
            <span>30d ago</span><span>Today</span>
          </div>
          <div style={{ fontSize: 8, color: '#aaa', marginTop: 4 }}>
            Hover for details. Click legend to toggle. Historical data fills in as the coordinator collects snapshots.
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 11, color: '#ccc', padding: '12px 0', textAlign: 'center' }}>
          No {TIER_META[tier].label.toLowerCase()} pricing data for this tier
        </div>
      )}
    </div>
  )
}

// ─── Main ────────────────────────────────────────────────────

export function Exchange() {
  const { data: marketData } = useSWR('market', api.market, { refreshInterval: 5000 })
  const { data: stats } = useSWR('stats', api.stats, { refreshInterval: 5000 })
  const { data: traceData } = useSWR('traces', api.traces, { refreshInterval: 5000 })
  const { data: refData } = useSWR('refPrices', () => api.referencePrices(), { refreshInterval: 30000 })
  const { data: repData } = useSWR('reputation', api.reputation, { refreshInterval: 10000 })

  const models = (marketData?.models || []) as MarketModel[]
  const traces = traceData?.traces || []
  const repMap = new Map((repData?.reputation || []).map((r: any) => [r.provider_id, r]))

  const refFamilies: Array<{ family_key: string; display_name: string; prices: any[]; provider_count: number }> =
    (refData?.models || []).filter((f: any) => f.prices?.length > 0)

  // ─── Build unified model list ────────────────────────────
  const unifiedModels = useMemo(() => {
    const result: UnifiedModel[] = []
    const seen = new Set<string>()

    // IE models first
    for (const m of models) {
      const caps = m.capabilities
      seen.add(m.canonical_id)
      result.push({
        key: m.canonical_id || m.model, name: m.model, vendor: m.family || '',
        family: m.family || 'Other', params: m.size || '—',
        price: m.cheapest_output, quality: null, codingIndex: null,
        cache: m.providers.some(p => p.price_cache > 0),
        open: true, // IE providers run open-weight models
        ctx: caps?.context_length > 0 ? formatCtx(caps.context_length) : '—',
        providerCount: m.provider_count, source: 'ie',
      })
    }

    // Reference families not covered by IE
    for (const f of refFamilies) {
      if (seen.has(f.family_key)) {
        // Merge: mark existing as 'both'
        const existing = result.find(r => r.key === f.family_key)
        if (existing) {
          existing.source = 'both'
          existing.providerCount = Math.max(existing.providerCount, f.prices.length)
          // Pull benchmark data from reference
          const withQuality = f.prices.find((p: any) => p.intelligence_index > 0)
          if (withQuality) {
            existing.quality = withQuality.intelligence_index
            existing.codingIndex = withQuality.coding_index || null
          }
          const withCache = f.prices.find((p: any) => p.price_cache_read > 0)
          if (withCache && !existing.cache) existing.cache = true
        }
        continue
      }
      seen.add(f.family_key)
      const cheapest = Math.min(...f.prices.map((p: any) => p.price_output).filter((v: number) => v > 0))
      const withQuality = f.prices.find((p: any) => p.intelligence_index > 0)
      const hasCache = f.prices.some((p: any) => p.price_cache_read > 0)
      const first = f.prices[0]
      const isOpen = first?.open_weight ?? !['anthropic', 'openai', 'google'].includes(first?.source)
      result.push({
        key: f.family_key, name: f.display_name, vendor: first?.source || '',
        family: guessFamily(f.display_name),
        params: first?.params || '—', price: cheapest === Infinity ? 0 : cheapest,
        quality: withQuality?.intelligence_index || null,
        codingIndex: withQuality?.coding_index || null,
        cache: hasCache, open: isOpen,
        ctx: first?.context_length ? formatCtx(first.context_length) : '—',
        providerCount: f.prices.length, source: 'ref',
      })
    }

    return result
  }, [models, refFamilies])

  // ─── State ───────────────────────────────────────────────
  const [selectedKey, setSelectedKey] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [filterOpen, setFilterOpen] = useState<boolean | null>(null) // null=all, true=open, false=prop
  const [filterCache, setFilterCache] = useState(false)
  const [filterBenchmarked, setFilterBenchmarked] = useState(false)
  const [filterSize, setFilterSize] = useState<string | null>(null)
  const [filterPriceCap, setFilterPriceCap] = useState<number | null>(null)
  const [filterFamily, setFilterFamily] = useState<string | null>(null)
  const [sortCol, setSortCol] = useState<'output' | 'input' | 'cache' | 'quality' | 'tps'>('output')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setDropdownOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Resolve active model
  const activeKey = selectedKey || (unifiedModels.length > 0 ? unifiedModels[0].key : '')
  const activeUnified = unifiedModels.find(m => m.key === activeKey)
  const activeIEModel = models.find(m => (m.canonical_id || m.model) === activeKey)
  // Find matching reference family:
  // 1. Exact key match
  // 2. Check if any ref family key is a substring of the active key or vice versa
  // 3. Fuzzy match on display name
  const activeRefFamily = (() => {
    if (!activeKey) return null
    // Exact match
    const exact = refFamilies.find(f => f.family_key === activeKey)
    if (exact) return exact
    // Key substring match (e.g. "llama-3.1-70b" matches "llama-3.1-70b-instruct")
    const keyLower = activeKey.toLowerCase()
    const keyMatch = refFamilies.find(f => {
      const fk = f.family_key.toLowerCase()
      return fk.includes(keyLower) || keyLower.includes(fk)
    })
    if (keyMatch) return keyMatch
    // Name fuzzy match
    if (activeUnified) {
      const uName = activeUnified.name.toLowerCase().replace(/[^a-z0-9]/g, '')
      const nameMatch = refFamilies.find(f => {
        const fName = f.display_name.toLowerCase().replace(/[^a-z0-9]/g, '')
        return uName.includes(fName) || fName.includes(uName)
      })
      if (nameMatch) return nameMatch
    }
    return null
  })()

  // ─── Filtered model list for palette ─────────────────────
  const families = useMemo(() => [...new Set(unifiedModels.map(m => m.family))].sort(), [unifiedModels])

  const filteredModels = useMemo(() => {
    const tokens = search.toLowerCase().trim().split(/\s+/).filter(Boolean)
    return unifiedModels.filter(m => {
      if (tokens.length) {
        const hay = `${m.name} ${m.vendor} ${m.family} ${m.params}`.toLowerCase()
        if (!tokens.every(t => hay.includes(t))) return false
      }
      if (filterOpen === true && !m.open) return false
      if (filterOpen === false && m.open) return false
      if (filterCache && !m.cache) return false
      if (filterBenchmarked && !m.quality) return false
      if (filterSize) {
        const s = parseSize(m.params)
        if (filterSize === '<7B' && (s === null || s >= 7)) return false
        if (filterSize === '7-30B' && (s === null || s < 7 || s >= 30)) return false
        if (filterSize === '30-100B' && (s === null || s < 30 || s >= 100)) return false
        if (filterSize === '100B+' && (s === null || s < 100)) return false
      }
      if (filterPriceCap && m.price > filterPriceCap) return false
      if (filterFamily && m.family !== filterFamily) return false
      return true
    })
  }, [unifiedModels, search, filterOpen, filterCache, filterBenchmarked, filterSize, filterPriceCap, filterFamily])

  const groupedModels = useMemo(() => {
    const groups: Record<string, UnifiedModel[]> = {}
    for (const m of filteredModels) {
      if (!groups[m.family]) groups[m.family] = []
      groups[m.family].push(m)
    }
    // Sort families by cheapest price within
    return Object.entries(groups)
      .sort(([, a], [, b]) => Math.min(...a.map(x => x.price || 999)) - Math.min(...b.map(x => x.price || 999)))
      .map(([fam, ms]) => ({ family: fam, models: ms.sort((a, b) => (a.price || 999) - (b.price || 999)) }))
  }, [filteredModels])

  // ─── Build offer rows for selected model ─────────────────
  const offerRows = useMemo((): OfferRow[] => {
    const rows: OfferRow[] = []
    // IE providers
    if (activeIEModel) {
      for (const p of activeIEModel.providers) {
        rows.push({
          name: 'Inference Exchange', source: 'ie', isIE: true,
          priceInput: p.price_input, priceCache: p.price_cache, priceOutput: p.price_output,
          quality: activeUnified?.codingIndex || null, tps: p.tps > 0 ? p.tps : null,
          trust: p.trust, encrypted: p.encrypted, quantization: p.quantization,
        })
      }
    }
    // Reference prices
    if (activeRefFamily) {
      for (const p of activeRefFamily.prices) {
        // Skip IE entries from reference (already in IE list)
        if (p.source === 'inference-exchange') continue
        rows.push({
          name: providerName(p.source), source: p.source, isIE: false,
          priceInput: p.price_input || 0, priceCache: p.price_cache_read || 0,
          priceOutput: p.price_output || 0,
          quality: p.intelligence_index || p.coding_index || null,
          tps: null, displayName: p.display_name,
        })
      }
    }
    return rows
  }, [activeIEModel, activeRefFamily, activeUnified])

  // Sorted offer rows
  const sortedOffers = useMemo(() => {
    const sorted = [...offerRows]
    sorted.sort((a, b) => {
      let va: number, vb: number
      switch (sortCol) {
        case 'input': va = a.priceInput || 999; vb = b.priceInput || 999; break
        case 'cache': va = a.priceCache || 999; vb = b.priceCache || 999; break
        case 'quality': va = a.quality || 0; vb = b.quality || 0; break
        case 'tps': va = a.tps || 0; vb = b.tps || 0; break
        default: va = a.priceOutput || 999; vb = b.priceOutput || 999
      }
      return sortDir === 'asc' ? va - vb : vb - va
    })
    return sorted
  }, [offerRows, sortCol, sortDir])

  // ─── Header stats ────────────────────────────────────────
  const outputPrices = offerRows.map(r => r.priceOutput).filter(p => p > 0)
  const bestPrice = outputPrices.length ? Math.min(...outputPrices) : 0
  const worstPrice = outputPrices.length ? Math.max(...outputPrices) : 0
  const spreadPct = bestPrice > 0 && worstPrice > bestPrice ? Math.round((worstPrice / bestPrice - 1) * 100) : 0
  const caps = activeIEModel?.capabilities

  // ─── DOM (Depth of Market) data ──────────────────────────
  const domData = useMemo(() => {
    type Level = { price: number; providers: { name: string; isIE: boolean }[] }
    function buildLevels(key: 'priceInput' | 'priceCache' | 'priceOutput'): Level[] {
      const levels: Record<string, Level> = {}
      for (const r of offerRows) {
        const v = r[key]
        if (!v || v <= 0) continue
        const k = v.toFixed(3)
        if (!levels[k]) levels[k] = { price: v, providers: [] }
        levels[k].providers.push({ name: r.isIE ? 'IE' : r.name, isIE: r.isIE })
      }
      return Object.values(levels).sort((a, b) => b.price - a.price) // expensive at top
    }
    return {
      input: buildLevels('priceInput'),
      cache: buildLevels('priceCache'),
      output: buildLevels('priceOutput'),
    }
  }, [offerRows])

  // ─── Recent fills ────────────────────────────────────────
  const recentFills = useMemo(() =>
    [...traces]
      .filter((t: any) => ['completed', 'matched', 'matched_from_queue'].includes(t.status))
      .reverse()
      .slice(0, 5),
  [traces])

  // Sort toggle
  function toggleSort(col: typeof sortCol) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }
  const arrow = (col: typeof sortCol) => sortCol === col ? (sortDir === 'asc' ? ' ▵' : ' ▿') : ''

  // Empty state
  if (marketData && models.length === 0 && refFamilies.length === 0) {
    return (
      <div style={{ maxWidth: 500, margin: '60px auto', textAlign: 'center' }}>
        <img src="/logo-icon.svg" alt="IE" style={{ width: 48, height: 48, margin: '0 auto 20px', opacity: 0.2 }} />
        <h2 style={{ fontSize: 18, fontWeight: 700, color: C.blueBlack, marginBottom: 8 }}>The exchange is quiet</h2>
        <p style={{ fontSize: 13, color: '#888', marginBottom: 24 }}>No providers connected and no reference data loaded.</p>
        <div style={{ background: C.blueBlack, color: C.warmWhite, borderRadius: 10, padding: 16, fontFamily: 'SF Mono,Menlo,Consolas,monospace', fontSize: 12, textAlign: 'left' }}>
          <div><span style={{ color: '#666' }}>$</span> pip install ie-provider</div>
          <div><span style={{ color: '#666' }}>$</span> ie-provider start</div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      {/* ── 1. Live status strip ── */}
      <div className="spot" style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px',
        background: '#fff', borderRadius: 10, border: '1px solid #eaeae8',
        marginBottom: 16, fontSize: 11, color: '#888', flexWrap: 'wrap',
      }}>
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.green, animation: 'pulse 2s infinite' }} />
        <span style={{ color: C.green }}>Live</span>
        <span style={{ color: '#ddd' }}>|</span>
        {stats && <>
          <span>{stats.providers_online} providers online</span>
          <span style={{ color: '#ddd' }}>|</span>
          <span>{stats.models_available} models</span>
          <span style={{ color: '#ddd' }}>|</span>
          <span style={{ color: C.gold }}>{stats.total_requests.toLocaleString()} fills / 24h</span>
        </>}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 9, color: '#bbb' }}>Updated live</span>
      </div>

      {/* ── 2. Model Selector — Command Palette ── */}
      <div ref={dropdownRef} style={{ position: 'relative', marginBottom: 16 }}>
        <div onClick={() => { setDropdownOpen(true); setTimeout(() => inputRef.current?.focus(), 0) }}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
            background: '#fff', borderRadius: 10, border: '1px solid #eaeae8', cursor: 'pointer',
          }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#aaa" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <span style={{ fontSize: 13, fontWeight: 600, color: C.blueBlack }}>
            {activeUnified?.name || 'Select a model'}
          </span>
          <span style={{ fontSize: 10, color: '#aaa', marginLeft: 'auto' }}>
            {unifiedModels.length} models
          </span>
          <span style={{ fontSize: 9, color: '#bbb', background: '#f0f0f0', padding: '1px 5px', borderRadius: 4 }}>⌘K</span>
        </div>

        {dropdownOpen && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 100,
            background: '#fff', borderRadius: 12, border: '1px solid #ddd',
            boxShadow: '0 12px 40px rgba(0,0,0,0.12)', maxHeight: 480, overflow: 'hidden',
            display: 'flex', flexDirection: 'column',
          }}>
            {/* Search input */}
            <div style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>
              <input ref={inputRef} type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search models... (llama 70b, qwen, deepseek, claude)"
                style={{ width: '100%', border: 'none', outline: 'none', fontSize: 13, color: C.blueBlack, background: 'transparent' }}
              />
            </div>

            {/* Filter bar */}
            <div style={{ padding: '6px 12px', borderBottom: '1px solid #f0f0f0', display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 8, textTransform: 'uppercase', letterSpacing: '.06em', color: '#aaa', marginRight: 2 }}>Filter</span>
              <Chip label="Open-weight" active={filterOpen === true} color={C.green} bg="#edf7f1"
                onClick={() => setFilterOpen(filterOpen === true ? null : true)} />
              <Chip label="Proprietary" active={filterOpen === false} color={C.indigo} bg="#f3eef7"
                onClick={() => setFilterOpen(filterOpen === false ? null : false)} />
              <Sep />
              <Chip label="Cache discount" active={filterCache} color={C.turquoise} bg="#e8f5f3"
                onClick={() => setFilterCache(!filterCache)} />
              <Chip label="Benchmarked" active={filterBenchmarked} color={C.deepBlue} bg="#eef3f7"
                onClick={() => setFilterBenchmarked(!filterBenchmarked)} />
              <Sep />
              <span style={{ fontSize: 8, color: '#aaa' }}>Size:</span>
              {['<7B', '7-30B', '30-100B', '100B+'].map(r => (
                <Chip key={r} label={r} active={filterSize === r} color={C.gold} bg="#fdf6ec"
                  onClick={() => setFilterSize(filterSize === r ? null : r)} />
              ))}
              <Sep />
              <span style={{ fontSize: 8, color: '#aaa' }}>Max $:</span>
              {[1, 5, 15].map(cap => (
                <Chip key={cap} label={`$${cap}`} active={filterPriceCap === cap} color={C.red} bg="#fef2f2"
                  onClick={() => setFilterPriceCap(filterPriceCap === cap ? null : cap)} />
              ))}
              <Sep />
              <select value={filterFamily || ''} onChange={e => setFilterFamily(e.target.value || null)}
                style={{ fontSize: 9, border: '1px solid #e5e5e5', borderRadius: 5, padding: '2px 4px', color: '#888', background: '#f5f5f3', cursor: 'pointer', outline: 'none' }}>
                <option value="">All families</option>
                {families.map(f => <option key={f}>{f}</option>)}
              </select>
            </div>

            {/* Model list */}
            <div style={{ overflowY: 'auto', maxHeight: 360, padding: '4px 0' }}>
              <div style={{ padding: '4px 14px', fontSize: 9, color: '#aaa' }}>
                {filteredModels.length} model{filteredModels.length !== 1 ? 's' : ''} match
              </div>
              {groupedModels.map(g => (
                <div key={g.family}>
                  <div style={{ padding: '4px 14px 2px', fontSize: 8, textTransform: 'uppercase', letterSpacing: '.08em', color: '#aaa', fontWeight: 600, marginTop: 2 }}>
                    {g.family} ({g.models.length})
                  </div>
                  {g.models.map(m => (
                    <div key={m.key}
                      onClick={() => { setSelectedKey(m.key); setDropdownOpen(false); setSearch('') }}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', cursor: 'pointer', borderRadius: 6, margin: '0 4px', transition: 'background .1s' }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#fafaf8')}
                      onMouseLeave={e => (e.currentTarget.style.background = '')}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: C.blueBlack, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {m.name}
                        </div>
                        <div style={{ fontSize: 9, color: '#999' }}>
                          {m.vendor}{m.params !== '—' ? ` · ${m.params}` : ''} · {m.ctx} · {m.providerCount}p
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 3, flexShrink: 0, alignItems: 'center' }}>
                        {m.open
                          ? <Badge bg="#edf7f1" color={C.green}>open</Badge>
                          : <Badge bg="#f3eef7" color={C.indigo}>prop</Badge>}
                        {m.cache && <Badge bg="#e8f5f3" color={C.turquoise}>-cache$</Badge>}
                        {m.quality != null && <Badge bg="#f0f4f8" color={C.deepBlue}>★ {m.quality}</Badge>}
                      </div>
                      <div style={{ fontFamily: 'SF Mono,Menlo,Consolas,monospace', fontSize: 11, fontWeight: 700, color: C.gold, width: 50, textAlign: 'right', flexShrink: 0 }}>
                        {m.price > 0 ? (m.price < 1 ? `$${m.price.toFixed(2)}` : `$${m.price.toFixed(0)}`) : '—'}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
              {filteredModels.length === 0 && (
                <div style={{ padding: 20, textAlign: 'center', color: '#bbb', fontSize: 12 }}>No models match your filters</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── 3. Header ── */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 4, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>{activeUnified?.name || 'Select a model'}</h1>
        {bestPrice > 0 && (
          <span style={{ fontSize: 11, color: '#888' }}>
            Best <b style={{ fontFamily: 'SF Mono,Menlo,Consolas,monospace', color: C.green }}>{fmtPrice(bestPrice)}</b> /Mtok out
          </span>
        )}
        {spreadPct > 0 && (
          <span style={{ fontSize: 11, color: '#888' }}>
            Spread <b style={{ fontFamily: 'SF Mono,Menlo,Consolas,monospace', color: C.orange }}>
              {fmtPrice(bestPrice)} — {fmtPrice(worstPrice)}</b> ({spreadPct}%)
          </span>
        )}
        <span style={{ fontSize: 11, color: '#888' }}><b>{offerRows.length}</b> providers</span>
      </div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {activeUnified?.open && <CapBadge bg="#eef7f0" color={C.green}>open-weight</CapBadge>}
        {!activeUnified?.open && activeUnified && <CapBadge bg="#f3eef7" color={C.indigo}>proprietary</CapBadge>}
        {caps?.context_length > 0 && <CapBadge bg="#eef7f0" color={C.green}>{formatCtx(caps.context_length)} ctx</CapBadge>}
        {caps?.supports_tool_calling && <CapBadge bg="#eef7f0" color={C.green}>tools</CapBadge>}
        {caps?.supports_vision && <CapBadge bg="#f3eef7" color={C.indigo}>vision</CapBadge>}
        {activeUnified?.codingIndex != null && (
          <CapBadge bg="#f0f4f8" color={C.deepBlue}>Code: {activeUnified.codingIndex}</CapBadge>
        )}
        {activeUnified?.quality != null && (
          <CapBadge bg="#f0f4f8" color={C.deepBlue}>Intelligence: {activeUnified.quality}</CapBadge>
        )}
      </div>

      {/* ── 4. Main Grid ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 16 }}>
        {/* ── Sortable offer table (full width) ── */}
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #eaeae8', overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <Th align="left" style={{ width: 170 }}>Provider</Th>
                <Th onClick={() => toggleSort('input')}>Input{arrow('input')}</Th>
                <Th onClick={() => toggleSort('cache')}>Cache{arrow('cache')}</Th>
                <Th onClick={() => toggleSort('output')}>Output{arrow('output')}</Th>
                <Th onClick={() => toggleSort('quality')}>Quality{arrow('quality')}</Th>
                <Th onClick={() => toggleSort('tps')}>TPS{arrow('tps')}</Th>
              </tr>
            </thead>
            <tbody>
              {sortedOffers.length > 0 ? sortedOffers.map((r, i) => {
                const isBest = r.priceOutput > 0 && r.priceOutput === bestPrice
                const cachePct = r.priceInput > 0 && r.priceCache > 0 ? cacheDiscount(r.priceInput, r.priceCache) : 0
                const tc = r.trust ? (TRUST_COLORS[r.trust] || TRUST_COLORS.open) : null
                return (
                  <tr key={i} style={{ background: r.isIE ? '#fdf6ec' : 'transparent' }}
                    onMouseEnter={e => { if (!r.isIE) (e.currentTarget as HTMLElement).style.background = '#fafaf8' }}
                    onMouseLeave={e => { if (!r.isIE) (e.currentTarget as HTMLElement).style.background = '' }}>
                    <td style={{ padding: '9px 10px', borderBottom: '1px solid #fafaf8', textAlign: 'left', borderLeft: r.isIE ? `3px solid ${C.gold}` : '3px solid transparent' }}>
                      <div style={{ fontWeight: 600, fontSize: 12, color: r.isIE ? C.gold : C.blueBlack }}>{r.name}</div>
                      <div style={{ fontSize: 9, color: '#999', marginTop: 1, display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'center' }}>
                        {tc && <span style={{ fontSize: 7, fontWeight: 600, padding: '1px 4px', borderRadius: 3, background: tc.bg, color: tc.text }}>{tc.label}</span>}
                        {r.encrypted && <span style={{ fontSize: 7, fontWeight: 600, padding: '1px 4px', borderRadius: 3, background: '#eef3f7', color: C.deepBlue }}>E2E</span>}
                        {cachePct > 0 && <span style={{ fontSize: 7, fontWeight: 600, padding: '1px 4px', borderRadius: 3, background: '#f3eef7', color: C.indigo }}>-{cachePct}% cache</span>}
                        {r.quantization && <span>{r.quantization}</span>}
                        {r.displayName && !r.isIE && <span>{r.displayName}</span>}
                      </div>
                    </td>
                    <Td mono color={C.deepBlue}>{fmtPrice(r.priceInput)}</Td>
                    <Td mono color={r.priceCache > 0 ? C.turquoise : '#ccc'}>{r.priceCache > 0 ? fmtPrice(r.priceCache) : '—'}</Td>
                    <Td mono color={C.gold} bold={isBest} highlight={isBest}>{fmtPrice(r.priceOutput)}</Td>
                    <Td mono color={r.quality ? C.deepBlue : '#ccc'}>{r.quality ? r.quality.toFixed(1) : '—'}</Td>
                    <Td mono color={r.tps ? C.turquoise : '#ccc'}>{r.tps ? Math.round(r.tps).toString() : '—'}</Td>
                  </tr>
                )
              }) : (
                <tr><td colSpan={6} style={{ padding: '40px 10px', textAlign: 'center', color: '#ccc', fontSize: 13 }}>
                  {activeUnified ? 'No provider data available for this model.' : 'Select a model above.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ── Below table: DOM + Recent fills in a row ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 14 }}>
          {/* Card 1: 3-column DOM */}
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #eaeae8', padding: 14, overflow: 'hidden' }}>
            <h4 style={{ fontSize: 8, textTransform: 'uppercase', letterSpacing: '.06em', color: '#888', marginBottom: 10, fontWeight: 600 }}>
              Depth of market — three-tier pricing
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, minWidth: 0 }}>
              <DOMColumn label="Input" unit="$/Mtok" color={C.deepBlue} levels={domData.input} />
              <DOMColumn label="Cache read" unit="$/Mtok" color={C.turquoise} levels={domData.cache} emptyMsg="Only IE publishes cache pricing" offerRows={offerRows} />
              <DOMColumn label="Output" unit="$/Mtok" color={C.gold} levels={domData.output} />
            </div>
            <div style={{ fontSize: 8, color: '#aaa', marginTop: 8 }}>
              Cheapest at bottom (best ask). Bars = relative supply at each price level.
            </div>
          </div>

          {/* Card 2: Interactive price chart with tier tabs */}
          <PriceChart offerRows={offerRows} modelName={activeUnified?.name || 'Model'} />

          {/* Card 3: Recent fills */}
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #eaeae8', padding: 14, overflow: 'hidden' }}>
            <h4 style={{ fontSize: 8, textTransform: 'uppercase', letterSpacing: '.06em', color: '#888', marginBottom: 10, fontWeight: 600 }}>
              Recent fills
            </h4>
            {recentFills.length > 0 ? recentFills.map((t: any) => {
              const ok = ['completed', 'matched', 'matched_from_queue'].includes(t.status)
              const time = new Date(t.timestamp * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
              return (
                <div key={t.request_id} style={{
                  display: 'flex', alignItems: 'center', gap: 5, padding: '4px 0',
                  borderBottom: '1px solid #f5f5f3', fontSize: 10,
                }}>
                  <div style={{ width: 4, height: 4, borderRadius: '50%', background: ok ? C.green : C.red, flexShrink: 0 }} />
                  <div style={{ fontFamily: 'SF Mono,Menlo,Consolas,monospace', color: '#bbb', width: 38, flexShrink: 0 }}>{time}</div>
                  <div style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#555' }}>
                    {t.selected_provider || t.model}
                  </div>
                  {t.selected_price != null && (
                    <div style={{ fontFamily: 'SF Mono,Menlo,Consolas,monospace', color: C.gold, fontWeight: 600, width: 40, textAlign: 'right', flexShrink: 0 }}>
                      ${t.selected_price.toFixed(2)}
                    </div>
                  )}
                </div>
              )
            }) : (
              <div style={{ fontSize: 11, color: '#ccc', padding: '12px 0', textAlign: 'center' }}>No recent fills</div>
            )}
          </div>
        </div>
      </div>

      {/* ── 5. Footer ── */}
      <div style={{ fontSize: 9, color: '#bbb', marginTop: 8 }}>
        Prices $/Mtok. Data: OpenRouter API + IE static reference prices + IE provider network.
        Quality = Artificial Analysis intelligence/coding index. TPS = observed tokens/sec for IE providers.
      </div>

      {/* Pulse animation */}
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}`}</style>
    </div>
  )
}

// ─── Small Components ────────────────────────────────────────

function Chip({ label, active, color, bg, onClick }: {
  label: string; active: boolean; color: string; bg: string; onClick: () => void
}) {
  return (
    <span onClick={e => { e.stopPropagation(); onClick() }}
      style={{
        fontSize: 9, fontWeight: 600, padding: '2px 7px', borderRadius: 5, cursor: 'pointer',
        userSelect: 'none', transition: 'all .12s',
        background: active ? bg : '#f5f5f3', color: active ? color : '#888',
        border: `1px solid ${active ? color + '44' : 'transparent'}`,
      }}>
      {label}
    </span>
  )
}

function Sep() {
  return <span style={{ width: 1, height: 14, background: '#e5e5e5', margin: '0 2px' }} />
}

function Badge({ bg, color, children }: { bg: string; color: string; children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 7, fontWeight: 600, padding: '1px 4px', borderRadius: 3, background: bg, color, display: 'inline-block', verticalAlign: 'middle' }}>
      {children}
    </span>
  )
}

function CapBadge({ bg, color, children }: { bg: string; color: string; children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 8, fontWeight: 600, padding: '2px 6px', borderRadius: 4, background: bg, color }}>
      {children}
    </span>
  )
}

function Th({ children, align, style, onClick }: {
  children: React.ReactNode; align?: string; style?: React.CSSProperties; onClick?: () => void
}) {
  return (
    <th onClick={onClick} style={{
      fontSize: 8, textTransform: 'uppercase', letterSpacing: '.06em', color: '#aaa',
      padding: '8px 10px', textAlign: (align as any) || 'right', borderBottom: '1px solid #f0f0f0',
      fontWeight: 600, cursor: onClick ? 'pointer' : 'default', userSelect: 'none', whiteSpace: 'nowrap',
      ...style,
    }}>
      {children}
    </th>
  )
}

function Td({ children, mono, color, bold, highlight }: {
  children: React.ReactNode; mono?: boolean; color?: string; bold?: boolean; highlight?: boolean
}) {
  return (
    <td style={{
      padding: '9px 10px', borderBottom: '1px solid #fafaf8', textAlign: 'right', fontSize: 12,
      whiteSpace: 'nowrap',
      fontFamily: mono ? 'SF Mono,Menlo,Consolas,monospace' : undefined,
      color: color || C.blueBlack, fontWeight: bold ? 700 : 400,
      background: highlight ? '#edf7f1' : undefined,
    }}>
      {children}
    </td>
  )
}

// ─── DOM Column ──────────────────────────────────────────────

function DOMColumn({ label, unit, color, levels, emptyMsg, offerRows }: {
  label: string; unit: string; color: string
  levels: Array<{ price: number; providers: { name: string; isIE: boolean }[] }>
  emptyMsg?: string; offerRows?: OfferRow[]
}) {
  const maxProviders = Math.max(1, ...levels.map(l => l.providers.length))

  // If no levels and we have an empty message (cache column)
  if (levels.length === 0 && emptyMsg) {
    // Check if any IE provider has cache pricing
    const ieCache = offerRows?.find(r => r.isIE && r.priceCache > 0)
    return (
      <div>
        <div style={{
          fontSize: 9, textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700,
          padding: '4px 0 6px', textAlign: 'center', borderBottom: `2px solid ${color}`, color,
        }}>
          {label} {unit}
        </div>
        <div style={{ fontSize: 10, color: '#ccc', padding: '12px 0', textAlign: 'center' }}>{emptyMsg}</div>
        {ieCache && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 0' }}>
            <span style={{ fontFamily: 'SF Mono,Menlo,Consolas,monospace', fontSize: 9, width: 36, textAlign: 'right', color: C.green, fontWeight: 600 }}>
              ${ieCache.priceCache.toFixed(2)}
            </span>
            <div style={{ flex: 1, height: 14, background: '#fafaf8', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: '100%', background: C.green, borderRadius: 3 }} />
            </div>
            <span style={{ fontSize: 8, color: C.gold, fontWeight: 600 }}>IE</span>
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <div style={{
        fontSize: 9, textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700,
        padding: '4px 0 6px', textAlign: 'center', borderBottom: `2px solid ${color}`, color,
      }}>
        {label} {unit}
      </div>
      {levels.map((level, i) => {
        const isBest = i === levels.length - 1 // cheapest at bottom
        const barW = Math.max(20, (level.providers.length / maxProviders) * 100)
        const priceColor = isBest ? C.green : (i === 0 ? C.red : '#888')
        const hasIE = level.providers.some(p => p.isIE)
        const names = level.providers.map(p => p.name).join(', ')
        return (
          <div key={level.price} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 0' }}>
            <span style={{
              fontFamily: 'SF Mono,Menlo,Consolas,monospace', fontSize: 9, width: 36,
              textAlign: 'right', flexShrink: 0, color: priceColor, fontWeight: isBest ? 700 : 400,
            }}>
              ${level.price.toFixed(2)}
            </span>
            <div style={{ flex: 1, height: 14, background: '#fafaf8', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: `${barW}%`, borderRadius: 3,
                background: isBest ? C.green : (hasIE ? C.gold : color),
              }} />
            </div>
            <span style={{
              fontSize: 8, color: hasIE ? C.gold : '#888', width: 80, flexShrink: 0,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {level.providers.length} {names}
            </span>
          </div>
        )
      })}
      {levels.length === 0 && (
        <div style={{ fontSize: 10, color: '#ccc', padding: '12px 0', textAlign: 'center' }}>No data</div>
      )}
    </div>
  )
}

// ─── Utility ─────────────────────────────────────────────────

function guessFamily(name: string): string {
  const lower = name.toLowerCase()
  if (lower.includes('llama')) return 'Llama'
  if (lower.includes('qwen')) return 'Qwen'
  if (lower.includes('deepseek')) return 'DeepSeek'
  if (lower.includes('claude')) return 'Claude'
  if (lower.includes('gpt')) return 'GPT'
  if (lower.includes('gemini')) return 'Gemini'
  if (lower.includes('gemma')) return 'Gemma'
  if (lower.includes('mistral')) return 'Mistral'
  if (lower.includes('phi')) return 'Phi'
  if (lower.includes('hermes')) return 'Llama'
  if (lower.includes('glm')) return 'GLM'
  return 'Other'
}
