export function formatRate(value) {
  if (value == null) return 'Not published'
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return 'Not published'
  return n === 0 ? 'Free' : '$' + n.toLocaleString('en-US', { maximumFractionDigits: 8 })
}
export function savingsLabel(a, b) {
  if (a == null || b == null) return 'Not comparable'
  const x = Number(a), y = Number(b)
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) return 'Not comparable'
  if (x === y) return 'Same price'
  if (y === 0) return 'External offer is free'
  const p = Math.round((y - x) * 100 / y)
  return Math.abs(p) + '% ' + (p >= 0 ? 'lower' : 'higher')
}
export function eligible(ie, other) {
  return Boolean(ie && other && other.quote_kind !== 'catalog' && !other.stale && other.comparable &&
    ie.quantization && other.quantization &&
    ie.quantization.toLowerCase() === other.quantization.toLowerCase() &&
    ie.context_length > 0 && ie.context_length === other.context_length)
}

export function identityLabel(source, trust) {
  if (trust === 'reviewed') return 'Reviewed alias'
  if (trust === 'reported') return source === 'conversion_source'
    ? 'Reported by provider · conversion source' : 'Reported by provider · repository'
  return 'Unmapped model'
}

export function endpointRows(rows) {
  return rows.filter(row => (row.quoteKind ?? row.quote_kind ?? 'endpoint') === 'endpoint')
}

// Resolve live details only through the coordinator's exact catalog offer IDs.
export function catalogFamilies(list, market) {
  const live = new Map()
  for (const model of market) for (const provider of model.providers) {
    live.set('ie/' + provider.id + '/' + provider.original_model, { model, provider })
  }
  const rate = value => value == null ? 0 : Number(value) || 0
  return list.map(model => {
    const matches = model.offers.filter(o => o.ie).map(o => {
      const match = live.get(o.id)
      return {
        model: match?.model,
        provider: {
          id: o.provider_id || o.id, name: o.provider, original_model: o.original_model || model.name,
          tps: 0, encrypted: false, trust: o.trust,
          ...match?.provider,
          price_input: rate(o.input), price_cache: rate(o.cache_read), price_output: rate(o.output),
          context_length: o.context_length || 0, quantization: o.quantization || '',
          publishedRates: { input: o.input, cache: o.cache_read, output: o.output },
          identity_source: o.identity_source, identity_trust: o.identity_trust,
          artifact_verification: o.artifact_verification,
        },
      }
    })
    const prices = model.offers.filter(o => !o.ie).map(o => ({
      source: o.provider,
      quote_kind: o.quote_kind || 'endpoint',
      display_name: 'via ' + o.route + (o.stale ? ' · stale' : ''),
      price_input: rate(o.input), price_output: rate(o.output), price_cache_read: rate(o.cache_read),
      context_length: o.context_length || 0, quantization: o.quantization || null,
      source_url: o.source_url, source_type: o.source_type, observed_at: o.observed_at,
      publishedRates: { input: o.input, cache: o.cache_read, output: o.output },
      open_weight: !['anthropic', 'openai', 'google'].includes(model.id.split('/')[0]),
    }))
    return {
      family_key: model.id, display_name: model.name, prices,
      provider_count: new Set(prices.filter(p => p.quote_kind === 'endpoint').map(p => p.source)).size
        + new Set(matches.map(match => match.provider.id)).size,
      family: model.family, total_parameters: model.total_parameters,
      marketModel: matches.find(match => match.model)?.model || (matches.length ? {
        capabilities: { context_length: matches[0].provider.context_length },
      } : undefined),
      ieProviders: matches.map(match => match.provider),
    }
  })
}
