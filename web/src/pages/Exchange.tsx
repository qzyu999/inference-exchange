import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { Link } from 'react-router-dom'
import { get } from '../lib/api'
import { eligible, formatRate, savingsLabel } from '../lib/catalog.js'
import { ModelSearch } from '../components/ModelSearch'
import { UI } from '../lib/theme'

type Rate = 'input' | 'cache_read' | 'output'
type Offer = { id: string; provider: string; route: string; ie?: boolean; stale?: boolean; comparable?: boolean;
  input: string | null; cache_read: string | null; output: string | null; observed_at: number;
  quantization?: string; context_length?: number; source_url: string; trust?: string }
type Model = { id: string; name: string; ie_count: number; offers: Offer[] }
type Catalog = { models: Model[]; total: number; generation: number; generated_at: number; sync_error: string | null }
type History = { offers: { id: string; name: string; points: ({ at: number } & Record<Rate, string | null>)[] }[] }
const rates: [Rate, string][] = [['input', 'Input'], ['cache_read', 'Cache read'], ['output', 'Output']]
const control = 'max-w-full rounded-lg border border-ui-border bg-ui-surface px-3 py-2 text-sm'

export function Exchange() {
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [ieOnly, setIeOnly] = useState(false)
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState('')
  const [ieId, setIeId] = useState('')
  const [competitorId, setCompetitorId] = useState('')
  const [sort, setSort] = useState<Rate>('output')
  const [tier, setTier] = useState<Rate>('output')
  useEffect(() => { const id = setTimeout(() => { setSearch(query); setOffset(0) }, 250); return () => clearTimeout(id) }, [query])
  const url = `/v1/exchange/catalog?q=${encodeURIComponent(search)}&ie_only=${ieOnly}&offset=${offset}&limit=100`
  const { data, error, isLoading } = useSWR<Catalog>(url, get, { refreshInterval: 10000 })
  const model = data?.models.find(m => m.id === selected) ?? data?.models[0]
  const { data: history } = useSWR<History>(model ? `/v1/exchange/catalog/history?model=${encodeURIComponent(model.id)}` : null, get, { refreshInterval: 600000 })
  const ies = model?.offers.filter(o => o.ie) ?? []
  const external = model?.offers.filter(o => !o.ie) ?? []
  const ie = ies.find(o => o.id === ieId) ?? ies[0]
  const competitor = external.find(o => o.id === competitorId) ?? external[0]
  const comparable = eligible(ie, competitor)
  const offers = [...(model?.offers ?? [])].sort((a,b) => (a[sort] == null ? Infinity : Number(a[sort])) - (b[sort] == null ? Infinity : Number(b[sort])))
  function clearFilters() { setQuery(''); setSearch(''); setIeOnly(false); setOffset(0) }
  const points = history?.offers.find(o => o.id === competitor?.id)?.points ?? []
  const values = points.map(p => p[tier] == null ? null : Number(p[tier]))
  const max = Math.max(0.000001, ...values.filter((v): v is number => v !== null))
  const first = points[0]?.at ?? 0
  const last = points[points.length - 1]?.at ?? first
  const x = (at: number) => 20 + ((at - first) / Math.max(1, last-first)) * 740
  const y = (v: number) => 160 - v/max*130
  return <div className="mx-auto w-full min-w-0 max-w-6xl space-y-6 p-4 sm:p-6" style={{ color: UI.text }}>
    <header><h1 className="text-2xl font-semibold">Exchange</h1><p style={{ color: UI.muted }}>Compare advertised inference prices. All rates are USD per million tokens.</p></header>
    <section className="flex flex-wrap gap-3" aria-label="Catalog filters">
      <input className={`${control} min-w-56 flex-1`} aria-label="Search all models" placeholder="Search models" value={query} onChange={e => setQuery(e.target.value)} />
      <div className="flex flex-wrap gap-2" role="group" aria-label="Model availability">
        <button className={control} aria-pressed={!ieOnly} style={{ background: !ieOnly ? UI.infoSurface : UI.surface }} onClick={() => { setIeOnly(false); setOffset(0) }}>All models</button>
        <button className={control} aria-pressed={ieOnly} style={{ background: ieOnly ? UI.infoSurface : UI.surface }} onClick={() => { setIeOnly(true); setOffset(0) }}>Available on Inference Exchange</button>
      </div>
      <button className={control} onClick={clearFilters}>Clear filters</button>
    </section>
    {error && <p role="alert">Could not load the catalog. Retrying automatically.</p>}
    {isLoading && <p role="status">Loading models…</p>}
    {data && <>
      {!data.generation && <p role="status">External price data has not synchronized yet. Live IE offers remain available.</p>}
      {data.sync_error && <p role="status">Price synchronization is delayed. Last recorded observations remain visible.</p>}
      <div className="flex flex-wrap items-center gap-3">
        <ModelSearch className="min-w-64 flex-1" items={data.models.map(m => ({ key: m.id, name: m.name,
          subtitle: m.ie_count ? `${m.ie_count} IE providers online` : 'External offers', keywords: m.id }))}
          value={model?.id ?? ''} selectedName={model?.name} label="Choose a model from these results"
          placeholder="Filter this page" emptyMessage="No models match these filters"
          onChange={key => { setSelected(key); setIeId(''); setCompetitorId('') }} />
        <button className={control} disabled={!offset} onClick={() => setOffset(Math.max(0,offset-100))}>Previous</button>
        <button className={control} disabled={offset+100 >= data.total} onClick={() => setOffset(offset+100)}>Next</button>
        <span>{data.total} matching models</span>
      </div>
    </>}
    {model && <>
      <header><h2 className="text-xl font-semibold">{model.name}</h2><p style={{ color: UI.muted }}>{model.id} · {model.ie_count ? `${model.ie_count} IE providers online` : 'No IE provider online for this model'}</p></header>
      <section className="rounded-xl border border-ui-border p-4 space-y-4">
        <div className="flex flex-wrap gap-4">
          {ies.length > 0 && <label className="flex min-w-0 max-w-full flex-col gap-1">IE offer <select className={control} value={ie?.id} onChange={e => setIeId(e.target.value)}>{ies.map(o => <option key={o.id} value={o.id}>{o.provider}</option>)}</select></label>}
          {external.length > 0 && <label className="flex min-w-0 max-w-full flex-col gap-1">Compare with <select className={control} value={competitor?.id} onChange={e => setCompetitorId(e.target.value)}>{external.map(o => <option key={o.id} value={o.id}>{o.provider} via {o.route} · {o.quantization || 'Precision undisclosed'}</option>)}</select></label>}
        </div>
        {ie && competitor ? <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">{rates.map(([key,label]) => <div key={key} className="rounded-lg p-3" style={{ background: UI.surfaceMuted }}>
            <div>{label}</div><strong className="text-lg">{comparable ? savingsLabel(ie[key],competitor[key]) : 'Not comparable'}</strong>
            <p className="text-sm">IE {formatRate(ie[key])} · External {formatRate(competitor[key])}</p>
          </div>)}</div>
          {!comparable && <p className="text-sm" style={{ color: UI.muted }}>Savings require a fresh endpoint quote with matching disclosed quantization and context. Rates remain visible for comparison.</p>}
        </> : <p>No same-model IE/external comparison is available.</p>}
      </section>
      <div className="overflow-x-auto rounded-xl border border-ui-border">
        <table className="w-full text-left text-sm"><caption className="p-3 text-left">Advertised offers · select a price column to sort</caption><thead><tr>
          <th className="p-3">Provider / route</th>{rates.map(([key,label]) => <th key={key} className="p-3" aria-sort={sort === key ? 'ascending' : 'none'}><button onClick={() => setSort(key)}>{label}{sort === key ? ' ↑' : ''}</button></th>)}<th className="p-3">Configuration</th><th className="p-3">Observed</th>
        </tr></thead><tbody>{offers.map(o => <tr key={o.id} className="border-t border-ui-border" style={{ background: o.ie ? UI.successSurface : UI.surface }}>
          <td className="p-3"><strong>{o.provider}</strong><div>{o.route}</div>{o.ie ? <Link to="/keys">Use IE API</Link> : <a href={o.source_url} target="_blank" rel="noreferrer">Source ↗</a>}</td>
          {rates.map(([key]) => <td key={key} className="p-3 whitespace-nowrap">{formatRate(o[key])}</td>)}
          <td className="p-3">{o.quantization || 'Precision undisclosed'}<div>{o.context_length ? `${o.context_length.toLocaleString()} context` : 'Context undisclosed'}</div>{o.trust && <div>Claimed OCIP: {o.trust}</div>}</td>
          <td className="p-3">{o.ie ? 'Live IE offer' : new Date(o.observed_at*1000).toLocaleString()}{o.stale && <strong className="block">Stale</strong>}</td>
        </tr>)}</tbody></table>
      </div>
      <section className="rounded-xl border border-ui-border p-4">
        <div className="flex flex-wrap justify-between gap-3"><h3 className="font-semibold">Observed advertised prices</h3><label>Token type <select className={control} value={tier} onChange={e => setTier(e.target.value as Rate)}>{rates.map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
        <p className="text-sm" style={{ color: UI.muted }}>{competitor ? `${competitor.provider} via ${competitor.route}` : 'Select an external offer'} · Last observation per UTC day. Dots show actual observations; gaps are not filled.</p>
        {points.length ? <><svg viewBox="0 0 780 190" role="img" aria-label={`${tier} observed prices`} className="w-full max-h-64">
          <text x="20" y="18" fill={UI.muted} fontSize="12">{formatRate(String(max))} /Mtok</text>
          <line x1="20" y1="160" x2="760" y2="160" stroke={UI.border} />
          {points.map((p,i) => values[i] !== null && <circle key={p.at} cx={x(p.at)} cy={y(values[i]!)} r="4" fill={UI.accent}><title>{new Date(p.at*1000).toISOString()} {formatRate(p[tier])}</title></circle>)}
          <text x="20" y="185" fill={UI.muted} fontSize="12">{new Date(first*1000).toLocaleDateString()}</text><text x="760" y="185" textAnchor="end" fill={UI.muted} fontSize="12">{new Date(last*1000).toLocaleDateString()}</text>
        </svg><details><summary>View recorded values</summary><ul>{points.map(p => <li key={p.at}>{new Date(p.at*1000).toLocaleString()} — {formatRate(p[tier])}</li>)}</ul></details></> : <p className="py-8">No recorded history for this offer yet.</p>}
      </section>
      <p className="text-sm" style={{ color: UI.muted }}>External listings are price references. They do not establish IE availability or OCIP verification. <Link to="/keys">Python and JavaScript examples, including optional OpenRouter fallback</Link>. The existing free-model fallback can select a different model.</p>
    </>}
  </div>
}
