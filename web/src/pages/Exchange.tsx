import useSWR from 'swr'
import { api, type CatalogPage } from '../lib/api'
import { useState, useMemo, useRef, useEffect } from 'react'
import { UI, APP_TRUST_COLORS as TRUST_COLORS } from '../lib/theme'
import { ModelSearch, type ModelSearchItem } from '../components/ModelSearch'
import { formatPrice, priceKey } from '../lib/price.js'
import { parametersInBillions, paramsLabel } from '../lib/model-size.js'
import { catalogFamilies, formatRate, identityLabel, endpointRows } from '../lib/catalog.js'

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
  publishedRates?: { input: string | null; cache: string | null; output: string | null }
  identity_source?: string; identity_trust?: string; artifact_verification?: string
  reported_quantization?: string | null
}

interface MarketModel {
  model: string; family: string; size: string; canonical_id: string
  provider_count: number; cheapest_output: number; fastest_tps: number; max_trust: string
  total_parameters?: number | null
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
  totalParameters?: number | null
  price: number; quality: number | null; codingIndex: number | null
  cache: boolean; open: boolean; ctx: string; providerCount: number; ieProviderCount: number
  source: 'ie' | 'ref' | 'both'
}

// Unified provider row for the offer table
interface OfferRow {
  name: string; source: string; isIE: boolean
  priceInput: number; priceCache: number; priceOutput: number
  quality: number | null; tps: number | null
  trust?: string; encrypted?: boolean; quantization?: string
  displayName?: string
  sourceUrl?: string; observedAt?: number; sourceType?: string
  publishedRates?: { input: string | null; cache: string | null; output: string | null }
  identitySource?: string; identityTrust?: string; artifactVerification?: string
  quoteKind?: 'catalog' | 'endpoint'
  reportedQuantization?: string | null
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

function fmtPrice(p: number): string {
  if (p <= 0) return '—'
  return formatPrice(p)
}

// ─── Interactive Price Chart ─────────────────────────────────

const CHART_COLORS = [UI.chart1, UI.chart2, UI.chart3, UI.chart4, UI.chart5, UI.chart6, UI.chart7, UI.chart8, UI.chart9]

type PriceTier = 'output' | 'input' | 'cache'
const TIER_META: Record<PriceTier, { label: string; color: string; key: keyof OfferRow }> = {
  output: { label: 'Output', color: UI.accent, key: 'priceOutput' },
  input: { label: 'Input', color: UI.info, key: 'priceInput' },
  cache: { label: 'Cache', color: UI.info, key: 'priceCache' },
}

function PriceChart({ offerRows, modelName }: { offerRows: OfferRow[]; modelName: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [tier, setTier] = useState<PriceTier>('output')
  const [hiddenIdx, setHiddenIdx] = useState<Set<number>>(new Set())
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string; color: string } | null>(null)

  const tierKey = TIER_META[tier].key
  const providers = useMemo(() =>
    endpointRows(offerRows).filter(r => {
      const v = r[tierKey] as number
      return v > 0
    }).map((r, i) => ({
      name: r.name,
      price: r[tierKey] as number,
      color: r.isIE ? UI.accent : CHART_COLORS[i % CHART_COLORS.length],
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

    // Canvas needs resolved colors; CSS variables are resolved by the DOM only.
    const paint = (color: string) => color.startsWith('var(')
      ? getComputedStyle(canvas).getPropertyValue(color.slice(4, -1)).trim()
      : color
    const draw = () => {
      // DPR-aware sizing to prevent text distortion
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      ctx.scale(dpr, dpr)

      const W = rect.width, H = rect.height
      const PAD = { t: 8, r: 40, b: 14, l: 4 }
      const pW = W - PAD.l - PAD.r, pH = H - PAD.t - PAD.b

      const yC = (v: number) => PAD.t + pH * (1 - v / yMax)
      const xC = (i: number) => PAD.l + (i / 29) * pW

      ctx.clearRect(0, 0, W, H)

      // Grid
      ctx.strokeStyle = paint(UI.border)
      ctx.lineWidth = 0.5
      for (const f of [0.25, 0.5, 0.75, 1]) {
        const y = yC(yMax * f)
        ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W - PAD.r, y); ctx.stroke()
      }

      // Y labels
      ctx.fillStyle = paint(UI.muted)
      ctx.font = '9px SF Mono,Menlo,monospace'
      ctx.textAlign = 'left'
      for (const f of [0, 0.25, 0.5, 0.75, 1]) {
        ctx.fillText(formatPrice(yMax * f), W - PAD.r + 4, yC(yMax * f) + 3)
      }

      // Lines
      providers.forEach((p, pi) => {
        if (hiddenIdx.has(pi)) return
        ctx.strokeStyle = paint(p.color)
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
            ctx.fillStyle = paint(p.color)
            ctx.beginPath(); ctx.arc(xC(fi), yC(p.prices[fi]!), 4, 0, Math.PI * 2); ctx.fill()
          }
        }
      })
    }
    draw()
    const shell = canvas.closest('[data-appearance]')
    const observer = new MutationObserver(draw)
    if (shell) observer.observe(shell, { attributes: true, attributeFilter: ['data-appearance'] })
    return () => observer.disconnect()
  }, [providers, yMax, hiddenIdx, tier])

  // Hover
  const handleMove = (e: React.MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const W = rect.width, H = rect.height
    const PAD = { t: 8, r: 40, b: 14, l: 4 }
    const pW = W - PAD.l - PAD.r, pH = H - PAD.t - PAD.b
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const day = Math.round((mx - PAD.l) / pW * 29)
    if (day < 0 || day > 29) { setTooltip(null); return }

    const yC = (v: number) => PAD.t + pH * (1 - v / yMax)
    let bestIdx = -1
    let bestDist = Infinity
    providers.forEach((p, pi) => {
      if (hiddenIdx.has(pi) || p.prices[day] === null) return
      const d = Math.abs(my - yC(p.prices[day] as number))
      if (d < bestDist) { bestDist = d; bestIdx = pi }
    })

    if (bestIdx >= 0 && bestDist < 25) {
      const bp = providers[bestIdx]
      const bv = bp.prices[day] as number
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      const da = 29 - day
      setTooltip({
        x: px + 10, y: py - 24,
        text: `${bp.name}  ${formatPrice(bv)}/Mtok ${TIER_META[tier].label.toLowerCase()}${da > 0 ? ` · ${da}d ago` : ' · today'}`,
        color: bp.color,
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
    <div style={{ background: UI.surface, borderRadius: 12, border: "1px solid var(--ui-border)", padding: 14, paddingBottom: 8, overflow: 'hidden' }}>
      <h4 style={{ fontSize: 8, textTransform: 'uppercase', letterSpacing: '.06em', color: UI.muted, marginBottom: 8, fontWeight: 600 }}>
        {modelName} — provider prices (30d)
      </h4>

      {/* Tier tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {(['input', 'cache', 'output'] as PriceTier[]).map(t => (
          <span key={t} onClick={() => setTier(t)} style={{
            fontSize: 9, fontWeight: 600, padding: '3px 8px', borderRadius: 5, cursor: 'pointer',
            background: tier === t ? UI.selected : UI.surfaceMuted,
            color: tier === t ? UI.selectedText : UI.muted,
            border: `1px solid ${tier === t ? TIER_META[t].color : UI.border}`,
          }}>
            {TIER_META[t].label}
          </span>
        ))}
      </div>

      {providers.length > 0 ? (
        <div ref={containerRef} style={{ position: 'relative' }}>
          <canvas ref={canvasRef}
            style={{ width: '100%', height: 160, borderRadius: 8, background: UI.surfaceMuted, cursor: 'crosshair', display: 'block' }}
            onMouseMove={handleMove}
            onMouseLeave={() => setTooltip(null)}
          />
          {tooltip && (
            <div style={{
              position: 'absolute', left: tooltip.x, top: tooltip.y,
              background: UI.codeSurface, color: UI.onAction, fontSize: 10, padding: '4px 8px',
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
                border: `1px solid ${p.color}`, color: p.color, background: `color-mix(in srgb, ${p.color} 7%, transparent)`,
                opacity: hiddenIdx.has(i) ? 0.3 : 1, transition: 'opacity .15s',
              }}>
                {p.name}
              </span>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: UI.muted, marginTop: 2 }}>
            <span>30d ago</span><span>Today</span>
          </div>
          <div style={{ fontSize: 8, color: UI.muted, marginTop: 4 }}>
            Hover for details. Click legend to toggle. Historical data fills in as the coordinator collects snapshots.
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 11, color: UI.muted, padding: '12px 0', textAlign: 'center' }}>
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
  const { data: catalog } = useSWR('catalog', fetchCatalog, { refreshInterval: 10000 })

  const models = (marketData?.models || []) as MarketModel[]
  const traces = traceData?.traces || []

  const useCatalog = Boolean(catalog)
  const refFamilies: Array<{ family_key: string; display_name: string; prices: any[]; provider_count: number; marketModel?: MarketModel; ieProviders?: MarketProvider[]; family?: string | null; total_parameters?: number | null }> = useMemo(() =>
    useCatalog ? catalogFamilies(catalog!.models, models)
      : (refData?.models || []).filter((f: any) => f.prices?.length > 0),
  [useCatalog, catalog, refData, models])

  // ─── Build unified model list ────────────────────────────
  const unifiedModels = useMemo(() => {
    if (useCatalog) return refFamilies.map(f => {
      const local = f.marketModel
      const ie = f.ieProviders || []
      const first = f.prices[0]
      const outputs = [...ie.map(p => p.price_output), ...f.prices.filter(p => p.quote_kind !== 'catalog').map(p => p.price_output)]
      const context = local?.capabilities.context_length || first?.context_length || 0
      return {
        key: f.family_key, name: f.display_name, vendor: local?.family || first?.source || '',
        family: f.family || local?.family || 'Other',
        totalParameters: f.total_parameters,
        params: local?.size || paramsLabel(f.display_name, f.family_key) || '—',
        price: outputs.length ? Math.min(...outputs) : 0, quality: null, codingIndex: null,
        cache: ie.some(p => p.price_cache > 0) || f.prices.some(p => p.price_cache_read > 0),
        open: ie.length > 0 || Boolean(first?.open_weight),
        ctx: context > 0 ? formatCtx(context) : '—', providerCount: f.provider_count,
        ieProviderCount: new Set(ie.map(p => p.id)).size,
        source: ie.length ? (f.prices.length ? 'both' : 'ie') : 'ref',
      } as UnifiedModel
    })
    const result: UnifiedModel[] = []
    const seen = new Set<string>()

    // IE models first
    for (const m of models) {
      const caps = m.capabilities
      seen.add(m.canonical_id)
      result.push({
        key: m.canonical_id || m.model, name: m.model, vendor: m.family || '',
        family: m.family || 'Other', params: m.size || paramsLabel(m.model, m.canonical_id) || '—',
        totalParameters: m.total_parameters,
        price: m.cheapest_output, quality: null, codingIndex: null,
        cache: m.providers.some(p => p.price_cache > 0),
        open: true, // IE providers run open-weight models
        ctx: caps?.context_length > 0 ? formatCtx(caps.context_length) : '—',
        providerCount: m.provider_count, ieProviderCount: new Set(m.providers.map(p => p.id)).size, source: 'ie',
      })
    }

    // Reference families not covered by IE
    for (const f of refFamilies) {
      if (seen.has(f.family_key)) {
        // Merge: mark existing as 'both'
        const existing = result.find(r => r.key === f.family_key)
        if (existing) {
          existing.source = f.prices.some((p: any) => p.source !== 'inference-exchange') ? 'both' : 'ie'
          existing.providerCount = f.provider_count
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
        family: f.family || 'Other', totalParameters: f.total_parameters,
        // Reference and catalog feeds carry no size field. Read it from the name (#277).
        params: first?.params || paramsLabel(f.display_name, f.family_key) || '—',
        price: cheapest === Infinity ? 0 : cheapest,
        quality: withQuality?.intelligence_index || null,
        codingIndex: withQuality?.coding_index || null,
        cache: hasCache, open: isOpen,
        ctx: first?.context_length ? formatCtx(first.context_length) : '—',
        providerCount: f.provider_count, ieProviderCount: 0, source: 'ref',
      })
    }

    return result
  }, [models, refFamilies, useCatalog])

  // ─── State ───────────────────────────────────────────────
  const [selectedKey, setSelectedKey] = useState('')
  const [filterIE, setFilterIE] = useState(false)
  const [filterOpen, setFilterOpen] = useState<boolean | null>(null) // null=all, true=open, false=prop
  const [filterCache, setFilterCache] = useState(false)
  const [filterBenchmarked, setFilterBenchmarked] = useState(false)
  const [filterSize, setFilterSize] = useState<string | null>(null)
  const [filterPriceCap, setFilterPriceCap] = useState<number | null>(null)
  const [filterFamily, setFilterFamily] = useState<string | null>(null)
  const filtersActive = filterIE || filterOpen !== null || filterCache || filterBenchmarked ||
    filterSize !== null || filterPriceCap !== null || filterFamily !== null

  function clearFilters() {
    setFilterIE(false)
    setFilterOpen(null)
    setFilterCache(false)
    setFilterBenchmarked(false)
    setFilterSize(null)
    setFilterPriceCap(null)
    setFilterFamily(null)
  }
  const [sortCol, setSortCol] = useState<'output' | 'input' | 'cache' | 'quality' | 'tps'>('output')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  // Resolve active model
  const activeKey = selectedKey || (unifiedModels.length > 0 ? unifiedModels[0].key : '')
  const activeUnified = unifiedModels.find(m => m.key === activeKey)
  const activeRefFamily = refFamilies.find(f => f.family_key === activeKey)
  const activeIEModel = useCatalog
    ? (activeRefFamily?.marketModel ? { ...activeRefFamily.marketModel, providers: activeRefFamily.ieProviders || [] } : undefined)
    : models.find(m => (m.canonical_id || m.model) === activeKey)

  // ─── Filtered model list for palette ─────────────────────
  const families = useMemo(() => [...new Set(unifiedModels.map(m => m.family))].sort(), [unifiedModels])

  const filteredModels = useMemo(() => {
    return unifiedModels.filter(m => {
      if (filterIE && m.ieProviderCount === 0) return false
      if (filterOpen === true && !m.open) return false
      if (filterOpen === false && m.open) return false
      if (filterCache && !m.cache) return false
      if (filterBenchmarked && !m.quality) return false
      if (filterSize) {
        const s = parametersInBillions(m.totalParameters, m.params)
        if (filterSize === '<7B' && (s === null || s >= 7)) return false
        if (filterSize === '7-30B' && (s === null || s < 7 || s >= 30)) return false
        if (filterSize === '30-100B' && (s === null || s < 30 || s >= 100)) return false
        if (filterSize === '100B+' && (s === null || s < 100)) return false
      }
      if (filterPriceCap && m.price > filterPriceCap) return false
      if (filterFamily && m.family !== filterFamily) return false
      return true
    })
  }, [unifiedModels, filterIE, filterOpen, filterCache, filterBenchmarked, filterSize, filterPriceCap, filterFamily])

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

  // Preserve Exchange's wider discovery inventory and rich filters.
  // Both pages use exactly the same popup, search logic and keyboard handling.
  const searchItems = useMemo<ModelSearchItem[]>(() =>
    groupedModels.flatMap(group => group.models.map(m => ({
      key: m.key, name: m.name, group: group.family,
      keywords: m.vendor + ' ' + m.family + ' ' + m.params,
      subtitle: [
        m.vendor || 'Unknown family',
        m.params !== '—' ? m.params : '',
        m.ctx !== '—' ? m.ctx + ' context' : '',
        m.providerCount + ' providers',
        m.ieProviderCount > 0 ? m.ieProviderCount + ' IE ' + (m.ieProviderCount === 1 ? 'provider' : 'providers') + ' online' : '',
      ].filter(Boolean).join(' · '),
      priceLabel: m.price > 0 ? formatPrice(m.price) : undefined,
      badges: [
        { label: m.source === 'ref' ? 'Reference only' : m.source === 'both' ? 'IE + reference' : 'On IE',
          color: m.source === 'ref' ? UI.purple : UI.success, background: m.source === 'ref' ? UI.purpleSurface : UI.successSurface },
        ...(m.cache ? [{ label: 'Cache', color: UI.info, background: UI.infoSurface }] : []),
        ...(m.quality != null ? [{ label: '★ ' + m.quality, color: UI.info, background: UI.infoSurface }] : []),
      ],
    }))), [groupedModels])

  // ─── Build offer rows for selected model ─────────────────
  const offerRows = useMemo((): OfferRow[] => {
    const rows: OfferRow[] = []
    // IE providers
    if (activeIEModel) {
      for (const p of activeIEModel.providers) {
        rows.push({
          name: p.name, source: 'ie', isIE: true, displayName: 'via Inference Exchange',
          priceInput: p.price_input, priceCache: p.price_cache, priceOutput: p.price_output,
          quality: activeUnified?.codingIndex || null, tps: p.tps > 0 ? p.tps : null,
          trust: p.trust, encrypted: p.encrypted, quantization: p.quantization,
          reportedQuantization: p.reported_quantization,
          publishedRates: p.publishedRates,
          quoteKind: 'endpoint',
          identitySource: p.identity_source, identityTrust: p.identity_trust,
          artifactVerification: p.artifact_verification,
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
          tps: null, displayName: p.display_name, quantization: p.quantization,
          reportedQuantization: p.reported_quantization,
          sourceUrl: p.source_url, observedAt: p.observed_at, sourceType: p.source_type,
          publishedRates: p.publishedRates,
          quoteKind: p.quote_kind || 'endpoint',
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
  const outputPrices = endpointRows(offerRows).map(r => r.priceOutput).filter(p => p > 0)
  const bestPrice = outputPrices.length ? Math.min(...outputPrices) : 0
  const worstPrice = outputPrices.length ? Math.max(...outputPrices) : 0
  const spreadPct = bestPrice > 0 && worstPrice > bestPrice ? Math.round((worstPrice / bestPrice - 1) * 100) : 0
  const caps = activeIEModel?.capabilities

  // ─── DOM (Depth of Market) data ──────────────────────────
  const domData = useMemo(() => {
    type Level = { price: number; providers: { name: string; isIE: boolean }[] }
    function buildLevels(key: 'priceInput' | 'priceCache' | 'priceOutput'): Level[] {
      const levels: Record<string, Level> = {}
      for (const r of endpointRows(offerRows)) {
        const v = r[key]
        if (!v || v <= 0) continue
        // Full 6-decimal key. A 3-decimal key merged $0.0015 and $0.0018 into one level.
        const k = priceKey(v)
        if (!levels[k]) levels[k] = { price: v, providers: [] }
        levels[k].providers.push({ name: r.isIE ? 'Inference Exchange' : r.name, isIE: r.isIE })
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
        <h2 style={{ fontSize: 18, fontWeight: 700, color: UI.text, marginBottom: 8 }}>The exchange is quiet</h2>
        <p style={{ fontSize: 13, color: UI.muted, marginBottom: 24 }}>No providers connected and no reference data loaded.</p>
        <div style={{ background: UI.action, color: UI.onAction, borderRadius: 10, padding: 16, fontFamily: 'SF Mono,Menlo,Consolas,monospace', fontSize: 12, textAlign: 'left' }}>
          <div><span style={{ color: UI.body }}>$</span> pip install ie-provider</div>
          <div><span style={{ color: UI.body }}>$</span> ie-provider start</div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      {/* ── 1. Live status strip ── */}
      <div className="spot" style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px',
        background: UI.surface, borderRadius: 10, border: "1px solid var(--ui-border)",
        marginBottom: 16, fontSize: 11, color: UI.muted, flexWrap: 'wrap',
      }}>
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: UI.success, animation: 'pulse 2s infinite' }} />
        <span style={{ color: UI.success }}>Live</span>
        <span style={{ color: UI.muted }}>|</span>
        {stats && <>
          <span>{stats.providers_online} providers online</span>
          <span style={{ color: UI.muted }}>|</span>
          <span>{stats.models_available} models</span>
          <span style={{ color: UI.muted }}>|</span>
          <span style={{ color: UI.accent }}>{stats.total_requests.toLocaleString()} fills / 24h</span>
        </>}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 9, color: UI.muted }}>Updated live</span>
      </div>

      {/* ── 2. Model Selector — Shared Search (same component as Chat) ── */}
      <ModelSearch
        items={searchItems}
        value={activeKey}
        selectedName={activeUnified?.name}
        onChange={setSelectedKey}
        label="Search exchange models"
        placeholder="Search models (qwen, llama 70b, deepseek, claude)"
        selectedLabel="Select a model to compare"
        emptyMessage="No discoverable models"
        className="w-full mb-4"
        filters={
          <>
            {/* Filter bar */}
            <div style={{ padding: '6px 12px', borderBottom: "1px solid var(--ui-border)", display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 8, textTransform: 'uppercase', letterSpacing: '.06em', color: UI.muted, marginRight: 2 }}>Filter</span>
              <label className="flex max-w-full items-center gap-1 text-[10px] text-ui-muted">
                Provider:
                <select aria-label="Filter models by provider" value={filterIE ? 'ie' : ''}
                  onChange={e => setFilterIE(e.target.value === 'ie')}
                  className="min-w-0 rounded border border-ui-border bg-ui-surface-muted px-2 py-1 text-[11px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-ui-warning"
                  style={{ color: filterIE ? UI.accent : UI.text }}>
                  <option value="">All providers</option>
                  <option value="ie">Inference Exchange (online)</option>
                </select>
              </label>
              <Sep />
              <Chip label="Open-weight" active={filterOpen === true} color={UI.success} bg={UI.successSurface}
                onClick={() => setFilterOpen(filterOpen === true ? null : true)} />
              <Chip label="Proprietary" active={filterOpen === false} color={UI.purple} bg={UI.purpleSurface}
                onClick={() => setFilterOpen(filterOpen === false ? null : false)} />
              <Sep />
              <Chip label="Cache discount" active={filterCache} color={UI.info} bg={UI.infoSurface}
                onClick={() => setFilterCache(!filterCache)} />
              <Chip label="Benchmarked" active={filterBenchmarked} color={UI.info} bg={UI.infoSurface}
                onClick={() => setFilterBenchmarked(!filterBenchmarked)} />
              <Sep />
              <span style={{ fontSize: 8, color: UI.muted }}>Size:</span>
              {['<7B', '7-30B', '30-100B', '100B+'].map(r => (
                <Chip key={r} label={r} active={filterSize === r} color={UI.accent} bg={UI.warningSurface}
                  onClick={() => setFilterSize(filterSize === r ? null : r)} />
              ))}
              <Sep />
              <span style={{ fontSize: 8, color: UI.muted }}>Max $:</span>
              {[1, 5, 15].map(cap => (
                <Chip key={cap} label={`$${cap}`} active={filterPriceCap === cap} color={UI.danger} bg={UI.dangerSurface}
                  onClick={() => setFilterPriceCap(filterPriceCap === cap ? null : cap)} />
              ))}
              <Sep />
              <select value={filterFamily || ''} onChange={e => setFilterFamily(e.target.value || null)}
                style={{ fontSize: 9, border: "1px solid var(--ui-border)", borderRadius: 5, padding: '2px 4px', color: UI.muted, background: UI.surfaceMuted, cursor: 'pointer', outline: 'none' }}>
                <option value="">All families</option>
                {families.map(f => <option key={f}>{f}</option>)}
              </select>
              <button type="button" onClick={clearFilters} disabled={!filtersActive}
                className="rounded border border-ui-border bg-ui-surface px-2 py-1 text-[10px] font-semibold disabled:opacity-40"
                style={{ color: UI.text }}>
                Clear filters
              </button>
            </div>

          </>
        }
      />

      {/* ── 3. Header ── */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 4, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>{activeUnified?.name || 'Select a model'}</h1>
        {bestPrice > 0 && (
          <span style={{ fontSize: 11, color: UI.muted }}>
            Best <b style={{ fontFamily: 'SF Mono,Menlo,Consolas,monospace', color: UI.success }}>{fmtPrice(bestPrice)}</b> /Mtok out
          </span>
        )}
        {spreadPct > 0 && (
          <span style={{ fontSize: 11, color: UI.muted }}>
            Spread <b style={{ fontFamily: 'SF Mono,Menlo,Consolas,monospace', color: UI.warning }}>
              {fmtPrice(bestPrice)} — {fmtPrice(worstPrice)}</b> ({spreadPct}%)
          </span>
        )}
        <span style={{ fontSize: 11, color: UI.muted }}><b>{offerRows.length}</b> providers</span>
      </div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {activeUnified?.open && <CapBadge bg={UI.successSurface} color={UI.success}>open-weight</CapBadge>}
        {!activeUnified?.open && activeUnified && <CapBadge bg={UI.purpleSurface} color={UI.purple}>proprietary</CapBadge>}
        {caps && caps.context_length > 0 && <CapBadge bg={UI.successSurface} color={UI.success}>{formatCtx(caps.context_length)} ctx</CapBadge>}
        {caps?.supports_tool_calling && <CapBadge bg={UI.successSurface} color={UI.success}>tools</CapBadge>}
        {caps?.supports_vision && <CapBadge bg={UI.purpleSurface} color={UI.purple}>vision</CapBadge>}
        {activeUnified?.codingIndex != null && (
          <CapBadge bg={UI.infoSurface} color={UI.info}>Code: {activeUnified.codingIndex}</CapBadge>
        )}
        {activeUnified?.quality != null && (
          <CapBadge bg={UI.infoSurface} color={UI.info}>Intelligence: {activeUnified.quality}</CapBadge>
        )}
      </div>

      {/* ── 4. Main Grid ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 16 }}>
        {/* ── Sortable offer table (full width) ── */}
        <div style={{ background: UI.surface, borderRadius: 12, border: "1px solid var(--ui-border)", overflow: 'auto' }}>
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
                const isBest = r.quoteKind !== 'catalog' && r.priceOutput > 0 && r.priceOutput === bestPrice
                const cachePct = r.priceInput > 0 && r.priceCache > 0 ? cacheDiscount(r.priceInput, r.priceCache) : 0
                const tc = r.trust ? (TRUST_COLORS[r.trust] || TRUST_COLORS.open) : null
                return (
                  <tr key={i} style={{ background: r.isIE ? UI.warningSurface : 'transparent' }}
                    onMouseEnter={e => { if (!r.isIE) (e.currentTarget as HTMLElement).style.background = UI.hover }}
                    onMouseLeave={e => { if (!r.isIE) (e.currentTarget as HTMLElement).style.background = '' }}>
                    <td style={{ padding: '9px 10px', borderBottom: "1px solid var(--ui-border)", textAlign: 'left', borderLeft: r.isIE ? `3px solid ${UI.focus}` : '3px solid transparent' }}>
                      <div style={{ fontWeight: 600, fontSize: 12, color: r.isIE ? UI.accent : UI.text }}>{r.name}</div>
                      <div style={{ fontSize: 9, color: UI.muted, marginTop: 1, display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'center' }}>
                        {tc && <span style={{ fontSize: 7, fontWeight: 600, padding: '1px 4px', borderRadius: 3, background: tc.bg, color: tc.text }}>{tc.label}</span>}
                        {r.encrypted && <span style={{ fontSize: 7, fontWeight: 600, padding: '1px 4px', borderRadius: 3, background: UI.infoSurface, color: UI.info }}>E2E</span>}
                        {cachePct > 0 && <span style={{ fontSize: 7, fontWeight: 600, padding: '1px 4px', borderRadius: 3, background: UI.purpleSurface, color: UI.purple }}>-{cachePct}% cache</span>}
                        {r.quantization ? <span>{r.quantization}</span>
                          : r.reportedQuantization ? <span>Reported quantization: {r.reportedQuantization}</span> : null}
                        {r.quoteKind === 'catalog' && <span>Catalog quote</span>}
                        {r.isIE && <span>{identityLabel(r.identitySource, r.identityTrust)}</span>}
                        {r.isIE && <span>{r.artifactVerification === 'verified' ? 'Artifact hash verified' : 'Artifact unverified'}</span>}
                        {r.displayName && <span>{r.displayName}</span>}
                        {r.sourceUrl && <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer"
                          title={`${r.sourceType || 'api'} · observed ${new Date((r.observedAt || 0) * 1000).toLocaleString()}`}
                          style={{ color: UI.muted }}>Source</a>}
                      </div>
                    </td>
                    <Td mono color={UI.info}>{r.publishedRates ? formatRate(r.publishedRates.input) : fmtPrice(r.priceInput)}</Td>
                    <Td mono color={r.priceCache > 0 ? UI.info : UI.muted}>{r.publishedRates ? formatRate(r.publishedRates.cache) : r.priceCache > 0 ? fmtPrice(r.priceCache) : '—'}</Td>
                    <Td mono color={UI.accent} bold={isBest} highlight={isBest}>{r.publishedRates ? formatRate(r.publishedRates.output) : fmtPrice(r.priceOutput)}</Td>
                    <Td mono color={r.quality ? UI.info : UI.muted}>{r.quality ? r.quality.toFixed(1) : '—'}</Td>
                    <Td mono color={r.tps ? UI.info : UI.muted}>{r.tps ? Math.round(r.tps).toString() : '—'}</Td>
                  </tr>
                )
              }) : (
                <tr><td colSpan={6} style={{ padding: '40px 10px', textAlign: 'center', color: UI.muted, fontSize: 13 }}>
                  {activeUnified ? 'No provider data available for this model.' : 'Select a model above.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ── Below table: [DOM + Chart stacked] left | [Fills] right ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 14 }}>
          {/* Left: DOM stacked on chart */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* 3-column DOM */}
            <div style={{ background: UI.surface, borderRadius: 12, border: "1px solid var(--ui-border)", padding: 14, overflow: 'hidden' }}>
              <h4 style={{ fontSize: 8, textTransform: 'uppercase', letterSpacing: '.06em', color: UI.muted, marginBottom: 10, fontWeight: 600 }}>
                Depth of market — three-tier pricing
              </h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, minWidth: 0 }}>
                <DOMColumn label="Input" unit="$/Mtok" color={UI.info} levels={domData.input} />
                <DOMColumn label="Cache read" unit="$/Mtok" color={UI.info} levels={domData.cache} emptyMsg="Only IE publishes cache pricing" offerRows={offerRows} />
                <DOMColumn label="Output" unit="$/Mtok" color={UI.accent} levels={domData.output} />
              </div>
              <div style={{ fontSize: 8, color: UI.muted, marginTop: 8 }}>
                Cheapest at bottom (best ask). Bars = relative supply at each price level.
              </div>
              {offerRows.length > 0 && (
                <div style={{ fontSize: 8, color: UI.muted, marginTop: 6, paddingTop: 6, borderTop: "1px solid var(--ui-border)" }}>
                  <b style={{ color: UI.body }}>Abbreviations: </b>
                  {[...new Set(offerRows.map(r => r.name))]
                    .map(n => `${providerAbbr(n)} = ${n}`)
                    .join(' · ')}
                </div>
              )}
            </div>

            {/* Interactive price chart */}
            <PriceChart offerRows={offerRows} modelName={activeUnified?.name || 'Model'} />
          </div>

          {/* Right: Recent fills with in/cache/out details */}
          <div style={{ background: UI.surface, borderRadius: 12, border: "1px solid var(--ui-border)", padding: 14, overflow: 'hidden' }}>
            <h4 style={{ fontSize: 8, textTransform: 'uppercase', letterSpacing: '.06em', color: UI.muted, marginBottom: 10, fontWeight: 600 }}>
              Recent fills
            </h4>
            {recentFills.length > 0 ? recentFills.map((t: any) => {
              const ok = ['completed', 'matched', 'matched_from_queue'].includes(t.status)
              const time = new Date(t.timestamp * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
              return (
                <div key={t.request_id} style={{
                  padding: '6px 0', borderBottom: "1px solid var(--ui-border)", fontSize: 10,
                }}>
                  {/* Row 1: status, time, model, price */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <div style={{ width: 4, height: 4, borderRadius: '50%', background: ok ? UI.success : UI.danger, flexShrink: 0 }} />
                    <div style={{ fontFamily: 'SF Mono,Menlo,Consolas,monospace', color: UI.muted, width: 52, flexShrink: 0 }}>{time}</div>
                    <div style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>
                      <span style={{ color: UI.accent }}>Inference Exchange</span>
                      {t.selected_provider && (
                        <span style={{ color: UI.muted, fontWeight: 400 }}> · {t.selected_provider}</span>
                      )}
                    </div>
                  </div>
                  {/* Row 2: in / cache / out rates ($/Mtok) */}
                  <div style={{ display: 'flex', gap: 8, marginTop: 3, marginLeft: 9, fontSize: 9, fontFamily: 'SF Mono,Menlo,Consolas,monospace' }}>
                    <span><span style={{ color: UI.info }}>in </span>
                      <span style={{ color: UI.body }}>{t.selected_price_input > 0 ? `${formatPrice(t.selected_price_input)}` : '—'}</span></span>
                    <span><span style={{ color: UI.info }}>cache </span>
                      <span style={{ color: UI.body }}>{t.selected_price_cache > 0 ? `${formatPrice(t.selected_price_cache)}` : '—'}</span></span>
                    <span><span style={{ color: UI.accent }}>out </span>
                      <span style={{ color: UI.accent, fontWeight: 600 }}>{t.selected_price != null ? `${formatPrice(t.selected_price)}` : '—'}</span></span>
                    <span style={{ color: UI.muted, marginLeft: 'auto' }}>/Mtok</span>
                  </div>
                  {/* Row 3: trust + tokens */}
                  <div style={{ display: 'flex', gap: 4, marginTop: 2, marginLeft: 9, fontSize: 9, color: UI.muted }}>
                    {t.selected_trust && (
                      <span style={{
                        fontSize: 8, fontWeight: 600, padding: '1px 4px', borderRadius: 3,
                        background: (TRUST_COLORS[t.selected_trust] || TRUST_COLORS.open).bg,
                        color: (TRUST_COLORS[t.selected_trust] || TRUST_COLORS.open).text,
                      }}>
                        {(TRUST_COLORS[t.selected_trust] || TRUST_COLORS.open).label}
                      </span>
                    )}
                    {t.encrypted && <span style={{ fontSize: 8, fontWeight: 600, padding: '1px 4px', borderRadius: 3, background: UI.infoSurface, color: UI.info }}>E2E</span>}
                    {t.input_tokens > 0 && <span>{t.input_tokens} in</span>}
                    {t.output_tokens > 0 && <span>{t.output_tokens} out</span>}
                  </div>
                </div>
              )
            }) : (
              <div style={{ fontSize: 11, color: UI.muted, padding: '12px 0', textAlign: 'center' }}>No recent fills</div>
            )}
          </div>
        </div>
      </div>

      {/* ── 5. Footer ── */}
      <div style={{ fontSize: 9, color: UI.muted, marginTop: 8 }}>
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
        background: active ? bg : UI.surfaceMuted, color: active ? color : UI.muted,
        border: `1px solid ${active ? color + '44' : 'transparent'}`,
      }}>
      {label}
    </span>
  )
}

function Sep() {
  return <span style={{ width: 1, height: 14, background: UI.track, margin: '0 2px' }} />
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
      fontSize: 8, textTransform: 'uppercase', letterSpacing: '.06em', color: UI.muted,
      padding: '8px 10px', textAlign: (align as any) || 'right', borderBottom: "1px solid var(--ui-border)",
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
      padding: '9px 10px', borderBottom: "1px solid var(--ui-border)", textAlign: 'right', fontSize: 12,
      whiteSpace: 'nowrap',
      fontFamily: mono ? 'SF Mono,Menlo,Consolas,monospace' : undefined,
      color: color || UI.text, fontWeight: bold ? 700 : 400,
      background: highlight ? UI.successSurface : undefined,
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
        <div style={{ fontSize: 10, color: UI.muted, padding: '12px 0', textAlign: 'center' }}>{emptyMsg}</div>
        {ieCache && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 0' }}>
            <span style={{ fontFamily: 'SF Mono,Menlo,Consolas,monospace', fontSize: 9, minWidth: 36, textAlign: 'right', color: UI.success, fontWeight: 600 }}>
              {formatPrice(ieCache.priceCache)}
            </span>
            <div style={{ flex: 1, height: 14, background: UI.surfaceMuted, borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: '100%', background: UI.success, borderRadius: 3 }} />
            </div>
            <span title="Inference Exchange" style={{ fontSize: 8, color: UI.accent, fontWeight: 600 }}>1 IE</span>
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
        const priceColor = isBest ? UI.success : (i === 0 ? UI.danger : UI.muted)
        const hasIE = level.providers.some(p => p.isIE)
        const names = level.providers.map(p => providerAbbr(p.name)).join(', ')
        const fullNames = level.providers.map(p => p.name).join(', ')
        return (
          <div key={level.price} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 0' }}>
            <span style={{
              // minWidth keeps the original column for 2-decimal prices and grows for up to 6 decimals.
              fontFamily: 'SF Mono,Menlo,Consolas,monospace', fontSize: 9, minWidth: 36,
              textAlign: 'right', flexShrink: 0, color: priceColor, fontWeight: isBest ? 700 : 400,
            }}>
              {formatPrice(level.price)}
            </span>
            <div style={{ flex: 1, height: 14, background: UI.surfaceMuted, borderRadius: 3, overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: `${barW}%`, borderRadius: 3,
                background: isBest ? UI.success : (hasIE ? UI.accent : color),
              }} />
            </div>
            <span title={fullNames} style={{
              fontSize: 8, color: hasIE ? UI.accent : UI.muted, width: 80, flexShrink: 0,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {level.providers.length} {names}
            </span>
          </div>
        )
      })}
      {levels.length === 0 && (
        <div style={{ fontSize: 10, color: UI.muted, padding: '12px 0', textAlign: 'center' }}>No data</div>
      )}
    </div>
  )
}

// ─── Published catalog (#269) ─

// The catalog API pages at 100 models. The page needs the full list for its search.
async function fetchCatalog(): Promise<CatalogPage> {
  const first = await api.catalogPage(0)
  const all = [...first.models]
  for (let offset = 100; offset < first.total && offset < 20000; offset += 100) {
    all.push(...(await api.catalogPage(offset)).models)
  }
  return { ...first, models: all }
}

// ─── Utility ─────────────────────────────────────────────────

const PROVIDER_ABBR: Record<string, string> = {
  'Inference Exchange': 'IE', OpenRouter: 'OR', DeepInfra: 'DI', 'Fireworks AI': 'FW',
  'Together AI': 'TG', Groq: 'GQ', OpenAI: 'OAI', Anthropic: 'ANT', Google: 'GG',
  DeepSeek: 'DS', NousResearch: 'NR', Mistral: 'MI', 'Alibaba Cloud': 'AL', Microsoft: 'MS',
}

function providerAbbr(name: string): string {
  return PROVIDER_ABBR[name] || name.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase()
}
