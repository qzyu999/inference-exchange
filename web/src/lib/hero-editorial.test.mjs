import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const paletteSource = readFileSync(new URL('./theme.ts', import.meta.url), 'utf8')
const landing = readFileSync(new URL('../pages/Landing.tsx', import.meta.url), 'utf8')
const rail = readFileSync(new URL('../components/ScrollChapterRail.tsx', import.meta.url), 'utf8')
const nav = readFileSync(new URL('../components/LandingNav.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

// The mountain/lake plate is kept intact, not covered with legibility washes.
assert.match(landing, /data-hero-shade="off"/)
assert.doesNotMatch(landing, /SHOW_(?:LEGACY|TEXT)_SHADE|heroShade=legacy|heroShade=soft/)
assert.match(landing, /HERO_TITLE_SHADOW/)
assert.match(landing, /HERO_BODY_SHADOW/)

// The new inscription colors reference actual user-supplied painting motifs.
// Lapis / indigo replace black shadows; saffron and cinnabar replace white ink.
assert.match(landing, /HERO_PIGMENTS as HP/)
assert.match(landing, /HERO_PIGMENT_RULE.*HP\.lapis.*HP\.saffron.*HP\.orpiment.*HP\.cinnabar.*HP\.jade/)
assert.match(landing, /HERO_PIGMENT_WORD.*HP\.cream.*HP\.orpiment.*HP\.saffron.*HP\.cinnabar/)
assert.match(landing, /HERO_PRODUCT_GRADIENT/)
assert.match(landing, /WebkitTextStroke: '0\.65px rgba\(43,34,72,0\.83\)'/)
for (const [name, color] of Object.entries({
  lapis: '#163E8C', indigoSmoke: '#433763', orpiment: '#F0C54B',
  saffron: '#E29A2D', cinnabar: '#C94C2F', coralLotus: '#E48773',
  jade: '#5F8E61', cream: '#F6E7C7', silk: '#F2DFC0',
})) {
  assert.match(paletteSource, new RegExp(`${name}: '${color}'`), `changed hero reference pigment ${name}`)
}
assert.match(styles, /--hero-lapis: #163E8C/)
assert.match(styles, /--hero-orpiment: #F0C54B/)
for (const name of ['ink', 'primary', 'secondary', 'link']) {
  assert.match(styles, new RegExp(`\\.hero-pigment-${name}`))
}
assert.match(rail, /CHAPTER_PIGMENTS = \[HP\.orpiment, HP\.cinnabar, HP\.jade, HP\.lapis\]/)
assert.match(landing, /hero-body-inscription/)
assert.match(landing, /hero-fine-inscription/)
assert.match(landing, /hero-mineral-thread/)
assert.match(nav, /mineral-spectrum-text hero-mineral-wordmark/)
assert.match(styles, /\.hero-body-inscription/)
assert.match(styles, /\.hero-mineral-wordmark/)
assert.match(styles, /\.hero-mineral-thread/)
assert.match(styles, /\.hero-mineral-wordmark,\s*\.hero-mineral-thread \{ animation: none; \}/)
assert.match(nav, /HERO_PIGMENTS as HP/)
assert.match(nav, /background: '#0E1018'/)
assert.doesNotMatch(nav, /background: 'linear-gradient\(95deg, #102D6D/)

// Preserve real routes, chapter semantics and reduced-motion controls.
for (const route of ['/chat', '/provide', '/exchange']) {
  assert.ok(landing.includes(`to="${route}"`), `missing hero CTA ${route}`)
}
assert.match(rail, /aria-label="Landing story chapters"/)
assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/)
console.log('Landing pigment study: no tint, lapis/saffron palette, accessible routes verified')
