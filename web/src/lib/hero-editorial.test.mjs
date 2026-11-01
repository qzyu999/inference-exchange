import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const landing = readFileSync(new URL('../pages/Landing.tsx', import.meta.url), 'utf8')
const rail = readFileSync(new URL('../components/ScrollChapterRail.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

// The scenic backdrop must never be dimmed by a blanket text overlay.
assert.match(landing, /data-hero-shade="off"/)
assert.doesNotMatch(landing, /SHOW_(?:LEGACY|TEXT)_SHADE|heroShade=legacy|heroShade=soft/)
assert.match(landing, /HERO_TITLE_SHADOW/)
assert.match(landing, /HERO_BODY_SHADOW/)

// Existing palette, not an unrelated pop-tech gradient.
assert.match(landing, /C\.red.*C\.orange.*C\.gold.*C\.green.*C\.turquoise/)
assert.match(landing, /className="block hero-pigment-ink"/)
assert.match(landing, /GRADIENTS\.market/)
assert.match(styles, /\.hero-pigment-ink/)
assert.match(styles, /\.hero-pigment-primary/)
assert.match(styles, /\.hero-pigment-secondary/)
assert.match(styles, /\.hero-pigment-link/)
assert.match(rail, /CHAPTER_PIGMENTS = \[C\.gold, C\.red, C\.green, C\.turquoise\]/)

// Keep real entry points intact through the purely visual changes.
for (const route of ['/chat', '/provide', '/exchange']) {
  assert.ok(landing.includes(`to="${route}"`), `missing main hero CTA ${route}`)
}
assert.match(rail, /aria-label="Landing story chapters"/)
console.log('Mineral inscription: no landscape tint, pigment palette and hero routes verified')
