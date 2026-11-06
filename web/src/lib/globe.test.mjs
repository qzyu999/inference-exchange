import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { project, arcPath, linePath } from './globe.js'
const read = file => readFileSync(new URL(file, import.meta.url), 'utf8')
const earth = JSON.parse(read('./earth-data.json'))
assert.ok(earth.land.length > 1000)
assert.ok(earth.centers.US && earth.centers.GH)
assert.equal(project([-25, 15]).visible, true)
assert.equal(project([155, -15]).visible, false)
for (const rotation of [-385, -25, 90, 335]) {
  for (const [from, to] of [[earth.centers.US, earth.centers.GH], [[0, 0], [180, 0]], [[179, 30], [-179, -20]]]) {
    const path = arcPath(from, to, rotation)
    assert.doesNotMatch(path, /NaN|Infinity|undefined/)
  }
}
assert.equal(arcPath([0, 0], [0, 0]), '')
assert.equal(linePath([[155, -15]], -25), '')
const view = read('../components/NetworkGlobe.tsx')
assert.match(view, /Illustration · not network activity/)
assert.match(view, /example \? EXAMPLE : located/)
assert.match(view, /up to 30 distinct routes/)
assert.match(view, /Historical routes are not live streams/)
assert.match(view, /Country activity is not enabled yet/)
assert.match(read('../components/network-globe.css'), /prefers-reduced-motion:reduce/)
assert.doesNotMatch(view, /traces|geolocation|getCurrentPosition|latitude|longitude|localStorage/)
assert.match(read('../pages/Overview.tsx'), /<NetworkGlobe \/>/)
console.log('Globe: projection, antipodal routes, hidden hemisphere, real/example separation and reduced motion passed')
