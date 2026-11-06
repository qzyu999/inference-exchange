import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
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
  const { user, loading } = useAuth()
  const { data, error } = useSWR(!loading && !user ? 'country-activity' : null, api.countryActivity, { refreshInterval: 300000 })
  const { data: recent, error: recentError } = useSWR(user ? ['recent-activity', user.user_id, user.is_admin] : null, api.recentActivity, { refreshInterval: 5000 })
  const privateView = !!user
  const available = privateView ? recent : data
  const unavailable = privateView ? recentError : error
  const [rotation, setRotation] = useState(-25)
  const [example, setExample] = useState(false)
  const privateRoutes = (recent?.requests || []).filter(row => row.provider_country && row.caller_country).map(row => ({
    provider_country: row.provider_country!, caller_country: row.caller_country!, count_band: new Date(row.timestamp * 1000).toLocaleString(), request_id: row.request_id,
  }))
  const routes = (example ? EXAMPLE : privateView ? privateRoutes : data?.routes.slice(0, 30) || []).map((row, i) => ({ ...row, key: 'request_id' in row ? String(row.request_id) : `${row.provider_country}${row.caller_country}${i}` }))
  const scopeLabel = recent?.scope === 'exchange' ? 'Exchange' : 'Your account'
  const land = useMemo(() => earth.land.map(point => project(point, rotation)).filter(point => point.visible), [rotation])
  const paths = useMemo(() => graticules.map(points => linePath(points, rotation)), [rotation])
  return <section className="ie-network-globe" aria-labelledby="network-globe-title">
    <header><div><h2 id="network-globe-title">{privateView ? 'Recent completed requests' : 'Across the exchange'}</h2><p>{example ? 'Illustration · not network activity' : privateView ? `${scopeLabel} · latest 30 completions · up to 7 days` : data?.period ? `Completed activity · ${data.period} UTC` : 'Approximate country-to-country activity'}</p></div>
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
        {routes.length ? <><p className="ie-globe-label">Provider → API caller</p><ul>{routes.map(route => <li key={route.key}><span>{route.provider_country === route.caller_country ? `Within ${countryName(route.provider_country)}` : `${countryName(route.provider_country)} → ${countryName(route.caller_country)}`}</span><small>{route.count_band}{example || privateView ? '' : ' completed'}</small></li>)}</ul></>
          : <div><h3>{unavailable ? 'Activity unavailable' : !available ? 'Checking activity…' : !available.enabled ? 'Country activity is not enabled yet' : privateView ? 'No recent requests with country data' : 'Not enough grouped activity yet'}</h3><p>{unavailable ? 'Try again later.' : privateView ? 'Complete a new request through the public API to see its approximate route. Requests without country data are not plotted.' : 'Routes appear after enough completed requests qualify for a daily summary.'}</p></div>}
        {!example && !privateView && data && data.routes.length > 30 && <p className="ie-globe-note">Showing 30 qualifying country routes.</p>}
        {!example && privateView && recent && <p className="ie-globe-note">{privateRoutes.length} of {recent.requests.length} recent completions have country data. This view is private{recent.scope === 'exchange' ? ' to administrators' : ' to your account'}. Requests are ordered newest first.</p>}
        <p className="ie-globe-note">Country anchors are approximate, not device locations. VPNs and servers can change the apparent origin. Historical routes are not live streams.</p>
        <Link to="/docs/guides/country-activity">How this works</Link>
      </div>
    </div>
  </section>
}
