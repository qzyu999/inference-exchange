import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { Link } from 'react-router-dom'
import { api, type CountryRoute } from '../lib/api'
import { arcPath, linePath, project } from '../lib/globe.js'
import rawEarth from '../lib/earth-data.json?raw'
import './network-globe.css'

const earth = JSON.parse(rawEarth) as { land: number[][]; centers: Record<string, number[]> }
const regions = new Intl.DisplayNames(['en'], { type: 'region' })
const countryName = (code: string) => regions.of(code) || code
const graticules: number[][][] = []
for (let lat = -60; lat <= 60; lat += 30) graticules.push(Array.from({ length: 73 }, (_, i) => [i * 5 - 180, lat]))
for (let lon = -180; lon < 180; lon += 30) graticules.push(Array.from({ length: 37 }, (_, i) => [lon, i * 5 - 90]))
const EXAMPLE: CountryRoute[] = [{ provider_country: 'US', caller_country: 'GH', count_band: 'Example route' }]

export function NetworkGlobe() {
  const { data, error } = useSWR('country-activity', api.countryActivity, { refreshInterval: 300000 })
  const [rotation, setRotation] = useState(-25)
  const [example, setExample] = useState(false)
  const routes = example ? EXAMPLE : data?.routes.slice(0, 30) || []
  const land = useMemo(() => earth.land.map(point => project(point, rotation)).filter(point => point.visible), [rotation])
  const paths = useMemo(() => graticules.map(points => linePath(points, rotation)), [rotation])
  return <section className="ie-network-globe" aria-labelledby="network-globe-title">
    <header><div><h2 id="network-globe-title">Across the exchange</h2><p>{example ? 'Illustration · not network activity' : data?.period ? `Completed activity · ${data.period} UTC` : 'Approximate country-to-country activity'}</p></div>
      <button type="button" aria-pressed={example} onClick={() => setExample(value => !value)}>{example ? 'Show network activity' : 'Show example'}</button>
    </header>
    <div className="ie-globe-content">
      <div className="ie-globe-visual">
        <svg viewBox="0 0 400 370" role="img" aria-label={example ? 'Illustration of a connection from the United States to Ghana' : 'Globe of grouped, completed inference activity by approximate country'}>
          <circle cx="200" cy="180" r="150" className="ie-globe-ocean" />
          <g className="ie-globe-grid">{paths.map((path, i) => <path key={i} d={path} />)}</g>
          <g className="ie-globe-land">{land.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="1.25" />)}</g>
          {routes.map(route => {
            const from = earth.centers[route.provider_country], to = earth.centers[route.caller_country]
            if (!from || !to) return null
            return <g key={route.provider_country + route.caller_country} className="ie-globe-route"><title>{countryName(route.provider_country)} to {countryName(route.caller_country)}</title>
              <path d={arcPath(from, to, rotation)} />
              {[from, to].map((point, i) => { const p = project(point, rotation); return p.visible ? <circle key={i} cx={p.x} cy={p.y} r="3.5" /> : null })}
            </g>
          })}
        </svg>
        <div className="ie-globe-controls" role="group" aria-label="Rotate globe"><button type="button" aria-label="Rotate globe west" onClick={() => setRotation(value => value - 30)}>←</button><button type="button" aria-label="Rotate globe east" onClick={() => setRotation(value => value + 30)}>→</button></div>
      </div>
      <div className="ie-globe-description" aria-live="polite">
        {routes.length ? <><p className="ie-globe-label">Provider → API caller</p><ul>{routes.map(route => <li key={route.provider_country + route.caller_country}><span>{countryName(route.provider_country)} → {countryName(route.caller_country)}</span><small>{route.count_band}{example ? '' : ' completed'}</small></li>)}</ul></>
          : <div><h3>{error ? 'Activity unavailable' : !data ? 'Checking activity…' : !data.enabled ? 'Country activity is not enabled yet' : 'Not enough grouped activity yet'}</h3><p>{error ? 'Try again later.' : 'Routes appear after enough completed requests qualify for a daily summary. Individual requests are never plotted.'}</p></div>}
        {!example && data && data.routes.length > 30 && <p className="ie-globe-note">Showing 30 qualifying country routes.</p>}
        <p className="ie-globe-note">Country anchors are approximate, not device locations. VPNs and servers can change the apparent origin. Historical routes are not live streams.</p>
        <Link to="/docs/guides/country-activity">How this works</Link>
      </div>
    </div>
  </section>
}
