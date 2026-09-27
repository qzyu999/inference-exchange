import useSWR from 'swr'
import { api } from '../lib/api'
import { useState } from 'react'
import { Link } from 'react-router-dom'

// ─── Brand palette ───────────────────────────────────────────
const C = {
  red: '#B7443B',
  gold: '#C49A45',
  green: '#3F8055',
  turquoise: '#4D9A91',
  deepBlue: '#315B72',
  blueBlack: '#292F35',
  white: '#D8D1BE',
}

const TRUST_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  open:         { bg: '#f3f3f3', text: '#999',     label: 'Open' },
  contained:    { bg: '#eef3f7', text: C.deepBlue, label: 'Hardened' },
  hardened:     { bg: '#fdf6ec', text: C.gold,     label: 'Hardened+' },
  confidential: { bg: '#edf7f1', text: C.green,    label: 'Confidential' },
}

// ─── Types ───────────────────────────────────────────────────

interface MarketModel {
  model: string
  provider_count: number
  cheapest_output: number
  fastest_tps: number
  providers: Array<{
    id: string; name: string; price_output: number; price_input: number
    tps: number; trust: string; hardware: string; quantization: string
    load: number; encrypted: boolean; verified: boolean
  }>
}

// ─── Main ────────────────────────────────────────────────────

export function Exchange() {
  const { data: marketData } = useSWR('market', api.market, { refreshInterval: 5000 })
  const { data: provData } = useSWR('providers', api.providers, { refreshInterval: 5000 })

  const models = (marketData?.models || []) as MarketModel[]
  const allProviders = provData?.providers || []

  // Filter state
  const [selectedModel, setSelectedModel] = useState('')
  const [selectedQuant, setSelectedQuant] = useState('')
  const [minTrust, setMinTrust] = useState('hardened')
  const [priceCeiling, setPriceCeiling] = useState('0.15')
  const [selectedProviderId, setSelectedProviderId] = useState('')

  // Resolve selected model (auto-select first if nothing chosen)
  const activeModel = selectedModel || (models.length > 0 ? models[0].model : '')
  const modelData = models.find(m => m.model === activeModel)

  // Get available quantizations for the selected model
  const quantizations = modelData
    ? [...new Set(modelData.providers.map(p => p.quantization).filter(Boolean))]
    : []

  // Filter providers by trust + price ceiling + quantization
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

  // Auto-select best route (cheapest eligible)
  const bestRoute = eligibleProviders.length > 0 ? eligibleProviders[0] : null
  const activeProvider = selectedProviderId
    ? eligibleProviders.find(p => p.id === selectedProviderId) || bestRoute
    : bestRoute

  // "Why this route?" explanation
  function explainRoute() {
    if (!activeProvider) return null
    const tc = TRUST_COLORS[activeProvider.trust] || TRUST_COLORS.open
    const reasons: string[] = []
    reasons.push(`Meets ${tc.label}`)
    if (eligibleProviders.length > 1) {
      const rank = eligibleProviders.findIndex(p => p.id === activeProvider.id) + 1
      if (rank === 1) {
        if (activeProvider.tps >= (eligibleProviders[1]?.tps || 0)) {
          reasons.push('fastest eligible provider')
        } else {
          reasons.push('cheapest eligible provider')
        }
      } else {
        reasons.push(`${rank === 2 ? '2nd' : rank === 3 ? '3rd' : `${rank}th`} cheapest`)
      }
    } else {
      reasons.push('only eligible provider')
    }
    reasons.push(`within your $${priceCeiling} cap`)
    return reasons.join(' · ')
  }

  // Empty state
  if (marketData && models.length === 0) {
    return (
      <div className="max-w-2xl mx-auto text-center py-16">
        <img src="/logo-icon.svg" alt="IE" className="w-16 h-16 mx-auto mb-6 opacity-20" />
        <h2 className="text-xl font-bold mb-3" style={{ color: C.blueBlack }}>The exchange is quiet</h2>
        <p className="text-sm mb-8" style={{ color: '#888' }}>
          No providers are connected. When providers come online, you'll see live pricing and routing here.
        </p>
        <div className="bg-white rounded-2xl border border-gray-200/40 p-6 text-left max-w-sm mx-auto">
          <div className="rounded-xl p-4 font-mono text-xs space-y-1" style={{ background: C.blueBlack, color: C.white }}>
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
      <div className="w-64 shrink-0 space-y-6">
        <div className="bg-white rounded-2xl border border-gray-200/40 p-5 space-y-5">
          <div className="text-[10px] uppercase tracking-wider font-medium" style={{ color: C.gold }}>
            Filter Market
          </div>

          {/* Model selector */}
          <div>
            <div className="text-xs mb-1.5" style={{ color: '#888' }}>Model</div>
            <div className="flex flex-wrap gap-1.5">
              {models.map(m => (
                <button
                  key={m.model}
                  onClick={() => { setSelectedModel(m.model); setSelectedQuant(''); setSelectedProviderId('') }}
                  className="text-[11px] font-medium px-3 py-1.5 rounded-lg transition-colors truncate max-w-full"
                  style={{
                    background: activeModel === m.model ? C.blueBlack : 'transparent',
                    color: activeModel === m.model ? '#fff' : '#888',
                    border: `1px solid ${activeModel === m.model ? C.blueBlack : '#e5e5e5'}`,
                  }}
                >
                  {m.model}
                </button>
              ))}
            </div>
          </div>

          {/* Quantization pills */}
          {quantizations.length > 0 && (
            <div>
              <div className="text-xs mb-1.5" style={{ color: '#888' }}>Quantization</div>
              <div className="flex flex-wrap gap-1">
                {quantizations.map(q => (
                  <button
                    key={q}
                    onClick={() => { setSelectedQuant(selectedQuant === q ? '' : q); setSelectedProviderId('') }}
                    className="text-[11px] font-medium px-2.5 py-1 rounded-lg transition-colors font-mono"
                    style={{
                      background: selectedQuant === q ? C.blueBlack : 'transparent',
                      color: selectedQuant === q ? '#fff' : '#888',
                      border: `1px solid ${selectedQuant === q ? C.blueBlack : '#e5e5e5'}`,
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Minimum trust */}
          <div>
            <div className="text-xs mb-1.5" style={{ color: '#888' }}>Minimum trust</div>
            <div className="flex flex-wrap gap-1">
              {(['open', 'contained', 'hardened', 'confidential'] as const).map(level => {
                const tc = TRUST_COLORS[level]
                return (
                  <button
                    key={level}
                    onClick={() => { setMinTrust(level); setSelectedProviderId('') }}
                    className="text-[11px] font-medium px-2.5 py-1 rounded-full transition-colors"
                    style={{
                      background: minTrust === level ? tc.bg : 'transparent',
                      color: minTrust === level ? tc.text : '#aaa',
                      border: `1px solid ${minTrust === level ? 'transparent' : '#e5e5e5'}`,
                    }}
                  >
                    {tc.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Price ceiling */}
          <div>
            <div className="text-xs mb-1.5" style={{ color: '#888' }}>Price ceiling</div>
            <div className="text-lg font-bold" style={{ color: C.blueBlack }}>
              ${priceCeiling} / M output
            </div>
            <input
              type="range" min="0.01" max="1.00" step="0.01"
              value={priceCeiling}
              onChange={e => { setPriceCeiling(e.target.value); setSelectedProviderId('') }}
              className="w-full mt-1.5 accent-amber-500"
            />
          </div>

          {/* Route indicator */}
          <div>
            <div className="text-xs mb-1.5" style={{ color: '#888' }}>Route</div>
            <span
              className="text-[11px] font-medium px-3 py-1 rounded-full"
              style={{ background: '#edf7f1', color: C.green }}
            >
              {activeProvider ? 'Lowest eligible' : 'No match'}
            </span>
          </div>
        </div>

        {/* Provider count + live market note */}
        <div className="px-1">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold" style={{ color: C.blueBlack }}>
              {eligibleProviders.length}
            </span>
            <span className="text-xs" style={{ color: '#888' }}>eligible providers</span>
          </div>
          <div className="mt-3">
            <div className="text-[10px] uppercase tracking-wider font-medium" style={{ color: C.gold }}>
              Live market
            </div>
            <div className="text-xs mt-0.5" style={{ color: '#aaa' }}>
              Availability changes as providers enter and leave.
            </div>
          </div>
        </div>
      </div>

      {/* ── Right: Market depth table + explanation ── */}
      <div className="flex-1 min-w-0 space-y-5">
        {/* Market depth header */}
        <div>
          <div className="text-[10px] uppercase tracking-wider font-medium mb-1" style={{ color: C.gold }}>
            Market Depth
          </div>
          <h2 className="text-xl font-bold" style={{ color: C.blueBlack }}>
            {activeModel || 'Select a model'}
          </h2>
          <div className="text-xs mt-0.5" style={{ color: '#888' }}>
            {eligibleProviders.length} eligible offer{eligibleProviders.length !== 1 ? 's' : ''} · sorted by effective route cost
          </div>
        </div>

        {/* Provider table */}
        <div className="bg-white rounded-2xl border border-gray-200/40 overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-12 gap-2 px-5 py-3 text-[10px] uppercase tracking-wider border-b border-gray-100" style={{ color: '#aaa' }}>
            <div className="col-span-3">Provider</div>
            <div className="col-span-2">Hardware</div>
            <div className="col-span-1 text-right">Output</div>
            <div className="col-span-2 text-right">Speed</div>
            <div className="col-span-2">Trust</div>
            <div className="col-span-2 text-right">Action</div>
          </div>

          {/* Provider rows */}
          {eligibleProviders.length > 0 ? eligibleProviders.map(p => {
            const isSelected = activeProvider?.id === p.id
            const tc = TRUST_COLORS[p.trust] || TRUST_COLORS.open
            return (
              <div
                key={p.id}
                className="grid grid-cols-12 gap-2 px-5 py-3.5 items-center border-b border-gray-50 last:border-0 transition-colors cursor-pointer"
                style={{
                  background: isSelected ? '#fdf6ec' : 'transparent',
                  borderLeft: isSelected ? `3px solid ${C.gold}` : '3px solid transparent',
                }}
                onClick={() => setSelectedProviderId(p.id)}
              >
                <div className="col-span-3 flex items-center gap-2 min-w-0">
                  <span className="text-sm truncate" style={{ color: C.blueBlack }}>
                    {activeModel}
                  </span>
                  <span className="text-xs truncate" style={{ color: '#888' }}>
                    {p.name}
                  </span>
                </div>
                <div className="col-span-2 text-xs" style={{ color: '#888' }}>
                  {p.hardware || '—'}
                </div>
                <div className="col-span-1 text-right text-sm font-semibold" style={{ color: C.gold }}>
                  ${p.price_output.toFixed(2)}
                </div>
                <div className="col-span-2 text-right text-sm" style={{ color: C.turquoise }}>
                  {p.tps > 0 ? `${p.tps.toFixed(0)} tok/s` : '—'}
                </div>
                <div className="col-span-2">
                  <span
                    className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                    style={{ background: tc.bg, color: tc.text }}
                  >
                    {tc.label}
                  </span>
                </div>
                <div className="col-span-2 text-right">
                  {isSelected ? (
                    <span className="text-[11px] font-semibold" style={{ color: C.gold }}>
                      Selected
                    </span>
                  ) : (
                    <button
                      className="text-[11px] font-medium px-3 py-1 rounded-lg border transition-colors"
                      style={{ color: '#888', borderColor: '#ddd' }}
                      onClick={e => { e.stopPropagation(); setSelectedProviderId(p.id) }}
                    >
                      View
                    </button>
                  )}
                </div>
              </div>
            )
          }) : (
            <div className="px-5 py-12 text-center text-sm" style={{ color: '#ccc' }}>
              No providers match your filters. Try relaxing the trust requirement or raising the price ceiling.
            </div>
          )}
        </div>

        {/* "Why this route?" explanation */}
        {activeProvider && (
          <div className="bg-white rounded-2xl border border-gray-200/40 p-5">
            <div className="text-[10px] uppercase tracking-wider font-medium mb-2" style={{ color: C.gold }}>
              Why this route?
            </div>
            <div className="text-sm" style={{ color: C.blueBlack }}>
              <span className="font-semibold">{activeProvider.name}</span>{' '}
              {explainRoute()}
            </div>
            <div className="text-xs mt-1" style={{ color: '#aaa' }}>
              No fallback required · evidence available after the request.
            </div>
            <div className="mt-3">
              <Link
                to={`/chat?model=${encodeURIComponent(activeModel)}`}
                className="inline-block text-[11px] font-medium px-4 py-1.5 rounded-lg transition-colors"
                style={{ background: C.blueBlack, color: '#fff' }}
              >
                Use this route
              </Link>
            </div>
          </div>
        )}

        {/* Footer note */}
        <div className="text-xs" style={{ color: '#aaa' }}>
          The market is a tool, not the interface.
        </div>
      </div>
    </div>
  )
}
