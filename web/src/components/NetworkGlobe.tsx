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
  const { data, error } = useSWR('network-activity', api.networkActivity, { refreshInterval: 5000 })
  const [rotation, setRotation] = useState(-25)
  const [example, setExample] = useState(false)
  const located = (data?.routes || []).map(row => ({
    provider_country: row.provider_country, caller_country: row.caller_country,
    count_band: 'Latest request · ' + new Date(row.timestamp_minute * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
  }))
  const routes = (example ? EXAMPLE : located).map(row => ({ ...row, key: `${row.provider_country}${row.caller_country}` }))
  const land = useMemo(() => earth.land.map(point => project(point, rotation)).filter(point => point.visible), [rotation])
  const paths = useMemo(() => graticules.map(points => linePath(points, rotation)), [rotation])
  return <section className="ie-network-globe" aria-labelledby="network-globe-title">
    <header><div><h2 id="network-globe-title">Across the exchange</h2><p>{example ? 'Illustration · not network activity' : 'Shared network · up to 30 distinct routes · last 7 days'}</p></div>
      <button type="button" aria-pressed={example} onClick={() => setExample(value => !value)}>{example ? 'Show network activity' : 'Show example'}</button>
    </header>
    <div className="ie-globe-content">
      <div className="ie-globe-visual">
        <svg viewBox="0 0 400 370" role="img" aria-label={example ? 'Illustration of a connection from the United States to Ghana' : 'Globe of completed inference activity by approximate country'}>
          <circle cx="200" cy="180" r="150" className="ie-globe-ocean" />
          <g className="ie-globe-grid">{paths.map((path, i) => <path key={i} d={path} />)}</g>
          <g className="ie-globe-land">{land.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="1.25" />)}</g>
          {routes.map(route => {
            const from = earth.centers[route.provider_country], to = earth.centers[route.caller_country]
            if (!from || !to) return null
            return <g key={route.key} className="ie-globe-route"><title>{countryName(route.provider_country)} to {countryName(route.caller_country)}</title>
              {route.provider_country === route.caller_country ? (() => {
                const p = project(from, rotation)
                return p.visible ? <circle cx={p.x} cy={p.y} r="10" className="ie-globe-domestic" /> : null
              })() : <path d={arcPath(from, to, rotation)} />}
              {[from, to].map((point, i) => { const p = project(point, rotation); return p.visible ? <circle key={i} cx={p.x} cy={p.y} r="3.5" /> : null })}
            </g>
          })}
        </svg>
        <div className="ie-globe-controls" role="group" aria-label="Rotate globe"><button type="button" aria-label="Rotate globe west" onClick={() => setRotation(value => value - 30)}>←</button><button type="button" aria-label="Rotate globe east" onClick={() => setRotation(value => value + 30)}>→</button></div>
      </div>
      <div className="ie-globe-description" aria-live="polite">
        {routes.length ? <><p className="ie-globe-label">Provider → API caller</p><ul>{routes.map(route => <li key={route.key}><span>{route.provider_country === route.caller_country ? `Within ${countryName(route.provider_country)}` : `${countryName(route.provider_country)} → ${countryName(route.caller_country)}`}</span><small>{route.count_band}</small></li>)}</ul></>
          : <div><h3>{error ? 'Activity unavailable' : !data ? 'Checking activity…' : !data.geography_enabled ? 'Country activity is not enabled yet' : 'No recent requests with country data'}</h3><p>{error ? 'Try again later.' : 'Completed requests with trusted country data appear here for everyone. Requests without country data are not plotted.'}</p></div>}
        {!example && data && <p className="ie-globe-note">{located.length} distinct routes. Each route shows its latest completed request. Repeated requests refresh the route without taking another slot. Times are rounded to the minute.</p>}
        <p className="ie-globe-note">Country anchors are approximate, not device locations. VPNs and servers can change the apparent origin. Historical routes are not live streams.</p>
        <Link to="/docs/guides/country-activity">How this works</Link>
      </div>
    </div>
  </section>
}
