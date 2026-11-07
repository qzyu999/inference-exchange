import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { landscapeGeometry, bridgeMotionPath } from './landscape-geometry.js'

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
assert.match(bridge, /<BridgeNavigation visible=\{visible\}/)
const bridgeNav = readFileSync(new URL('../components/BridgeNavigation.tsx', import.meta.url), 'utf8')
assert.match(bridgeNav, /getLandingGroups\(user\)/)
assert.match(bridgeNav, /createPortal/)
assert.match(bridgeNav, /aria-expanded=/)
assert.match(bridgeNav, /aria-controls=/)
assert.match(bridgeNav, /event\.key !== 'Escape'/)
assert.match(styles, /pointer-events:none/)
assert.match(styles, /prefers-reduced-motion:reduce/)
assert.match(styles, /width:7px;height:7px;border-radius:50%/)
assert.doesNotMatch(bridge, /<circle/)
assert.match(landing, /showBridge=\{!rawVideoOnly\}/)
assert.doesNotMatch(landing, /Pause connection|Play connection|bridgePaused/)
assert.equal(bridgeMotionPath(1000, 1000), 'M220 740 C390 850 590 610 780 700')
assert.equal(bridgeMotionPath(2000, 500), 'M440 370 C780 425 1180 305 1560 350')
assert.match(bridge, /offsetPath: `path/)
assert.match(bridge, /!reducedMotion/)
console.log('Landscape: source-space alignment, cover geometry and round marker paths and all-chapter visibility passed')
