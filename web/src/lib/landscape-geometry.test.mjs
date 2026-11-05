import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { landscapeGeometry } from './landscape-geometry.js'

// Optical offset scales with the actual source image, including cover crops.
for (const width of [320, 960, 1440]) {
  const box = landscapeGeometry(width, width * 9 / 16, 16 / 9)
  assert.ok(Math.abs(box.axisOffset + width * 6 / 960) < 1e-9)
  assert.equal(box.left, 0)
}
const covered = landscapeGeometry(2100, 1000, 3840 / 1644)
assert.ok(covered.width > 2100)
assert.ok(covered.left < 0)
assert.ok(Math.abs(covered.height - 1000) < 1e-9)
assert.ok(Math.abs(covered.axisOffset + covered.width * 6 / 960) < 1e-9)
for (const input of [[0, 500, 16/9], [500, -1, 16/9], [NaN, 500, 16/9]]) {
  assert.equal(landscapeGeometry(...input).axisOffset, 0)
}
const bridge = readFileSync(new URL('../components/LandscapeBridge.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../components/landscape-bridge.css', import.meta.url), 'utf8')
const landing = readFileSync(new URL('../pages/Landing.tsx', import.meta.url), 'utf8')
assert.match(bridge, /aria-hidden="true"/)
assert.match(bridge, /Use AI/)
assert.match(bridge, /Provide compute/)
assert.match(styles, /pointer-events:none/)
assert.match(styles, /prefers-reduced-motion:reduce/)
assert.match(styles, /animation-play-state:paused/)
assert.match(landing, /aria-pressed=\{bridgePaused\}/)
console.log('Landscape: source-space alignment, cover geometry and decorative motion controls passed')
