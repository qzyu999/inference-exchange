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
assert.doesNotMatch(landing, /HERO_TITLE_SHADOW|HERO_BODY_SHADOW/)
assert.doesNotMatch(landing, /hero-story-spectrum|WebkitTextStroke/)

// Bring back the original live-alpha narrative, centered and concise,
// while retaining the *new* four scroll holds/scene poses/transition logic.
for (const phrase of [
  'Inference Exchange',
  'An open market for AI inference. Send OpenAI-compatible requests;',
  'SUPPLY MEETS DEMAND',
  'Two forces converge',
  'Consumers bid. Providers offer. The exchange matches.',
  'The intersection is the product',
  'Trust is labelled, not assumed.',
  'Providers compete. You benefit.',
]) {
  assert.ok(landing.includes(phrase), 'missing original centered story copy: ' + phrase)
}
assert.match(landing, /const CHAPTER_HOLD = 0\.60/)
assert.match(landing, /const FINAL_HOLD_UNITS = 0\.35/)
assert.match(landing, /const FINAL_SCROLL_UNITS = LAST_CHAPTER \+ 2\.2/)
assert.match(landing, /const SCENE_POSES = \[\.\.\.STORY_CHAPTERS\.map/)
assert.match(landing, /key=\{chapter\.title\}/)
assert.match(landing, /className="absolute inset-0 flex items-center justify-center px-6 sm:px-10 text-center"/)
assert.match(landing, /className="relative mx-auto w-full max-w-2xl text-center"/)
assert.match(landing, /className="mt-8 flex flex-wrap items-center justify-center gap-3"/)
assert.doesNotMatch(landing, /'Intelligence,'|'without borders\.'|'A network'|'in motion\.'/)

// Exact original main landing typography and warm ink, inside the new pinned
// chapter crossfades. Remove the animated rainbow and later letterpress look.
assert.match(landing, /className="text-4xl md:text-6xl font-bold tracking-tight"/)
assert.match(landing, /color: C\.warmWhite, textShadow: '0 2px 24px rgba\(0,0,0,0\.6\)'/)
assert.match(landing, /className="text-3xl md:text-5xl font-bold tracking-tight leading-tight"/)
assert.match(landing, /className="bg-clip-text text-transparent"/)
assert.match(landing, /backgroundImage: 'linear-gradient\(135deg, ' \+ C\.warmWhite \+ ', ' \+ C\.sand \+ '\)'/)
assert.match(landing, /color: '#e6e0cf', textShadow: '0 1px 12px rgba\(0,0,0,0\.7\)'/)
assert.match(landing, /color: '#8a8578'/)
assert.match(landing, /style=\{\{ background: C\.warmWhite, color: C\.black \}\}/)
assert.match(landing, /background: 'rgba\(14,16,24,0\.5\)'/)
assert.doesNotMatch(landing, /mineral-spectrum-text hero-mineral-wordmark hero-story-spectrum/)
assert.doesNotMatch(landing, /hero-pigment-(?:primary|secondary|link)/)
assert.doesNotMatch(landing, /hero-body-inscription|hero-fine-inscription/)
assert.match(landing, /CHAPTER_COPY\.map\(\(chapter, index\) =>/)
assert.match(landing, /transition: 'opacity 420ms ease, visibility 420ms'/)
assert.match(landing, /<LandscapeVideo/)
const landscapeVideo = readFileSync(new URL('../components/LandscapeVideo.tsx', import.meta.url), 'utf8')
assert.match(landscapeVideo, /data-hero-video-tint="warm"/)

assert.match(landing, /HERO_PRODUCT_GRADIENT/)
assert.doesNotMatch(landing, /WebkitTextStroke/)
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
// The opening scenic chapter retains its light atmospheric pigment CTAs.
// The final product slide deliberately restores the original live alpha scheme:
// translucent dark Live Exchange card, warm-white gradient-hover primary action,
// and the quiet transparent mineral-bordered provider CTA.
assert.match(landing, /className="rounded-2xl p-6 w-full max-w-sm mineral-border"/)
assert.match(landing, /background: 'rgba\(255,255,255,0\.06\)'/)
assert.match(landing, /style=\{\{ color: C\.warmWhite, background: 'rgba\(216,209,190,0\.06\)' \}\}/)
assert.match(landing, /group-hover:opacity-100 transition-opacity" style=\{\{ background: GRADIENTS\.heroText \}\}/)
const finalSlide = landing.slice(landing.indexOf('{/* One actual product screen'))
assert.ok(finalSlide.includes('Start a conversation') && finalSlide.includes('Become a provider'))
assert.doesNotMatch(finalSlide, /hero-pigment-(primary|secondary)/)
assert.doesNotMatch(landing, /hero-exchange-card/)
assert.match(styles, /\.mineral-border::before/)
// Atmospheric wash stays for the opening chapter, not the last product slide.
assert.match(styles, /--hero-atmosphere-wash: linear-gradient\(138deg/)
for (const color of ['#B2C0BB', '#D2D6C9', '#E2D2B8', '#E6CEAA', '#F2E5D0', '#FAF7EE']) {
  assert.ok(styles.includes(color), `missing atmospheric wash stop ${color}`)
}
assert.match(styles, /\.hero-pigment-primary \{[\s\S]*?background: var\(--hero-atmosphere-wash\)/)
assert.match(styles, /\.hero-pigment-secondary \{[\s\S]*?var\(--hero-atmosphere-wash\)/)
assert.doesNotMatch(styles, /rgba\(30, 94, 86, 0\.93\)/)
assert.doesNotMatch(landing, /rgba\(16,45,109,0\.76\)/)
assert.doesNotMatch(landing, /hero-body-inscription|hero-fine-inscription/)
assert.match(nav, /mineral-spectrum-text hero-mineral-wordmark/)
assert.match(styles, /\.hero-body-inscription/)
assert.match(styles, /\.hero-mineral-wordmark/)
assert.match(styles, /\.hero-mineral-thread/)
assert.match(styles, /\.hero-mineral-wordmark,\s*\.hero-mineral-thread \{ animation: none; \}/)
assert.match(nav, /HERO_PIGMENTS as HP/)
assert.match(nav, /background: GRADIENTS\.sidebar/)
// Navbar is the cover for the ultrawide video's narrow top seam; extend its
// background outside normal flow rather than changing scene/sticky geometry.
assert.match(nav, /className="pointer-events-none absolute inset-x-0 top-full h-4"/)
assert.match(nav, /background: '#252A30'/)
assert.match(nav, /aria-hidden="true"/)
assert.match(nav, /borderBottom: '1px solid rgba\(240,197,75,0\.34\)'/)
assert.match(landing, /className="sticky top-14 left-0 z-10 h-\[calc\(100svh-3\.5rem\)\]/)

assert.match(nav, /GRADIENTS, HERO_PIGMENTS as HP/)
assert.doesNotMatch(nav, /background: '#0E1018'/)
assert.doesNotMatch(nav, /background: 'linear-gradient\(95deg, #102D6D/)

// Preserve real routes, chapter semantics and reduced-motion controls.
for (const route of ['/chat', '/provide', '/exchange']) {
  assert.ok(landing.includes(`to="${route}"`), `missing hero CTA ${route}`)
}
assert.match(rail, /aria-label="Landing story chapters"/)
assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/)
console.log('Landing pinned chapters: original main text styling, original CTAs, stable scroll, and video tint preserved')
