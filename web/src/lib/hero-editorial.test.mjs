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

// Original main had one intro plus six transition messages (not four new
// chapter slogans). Verify exact wording/order inside CHAPTER_COPY, without
// imposing the original free-flowing fade timeline on the pinned experience.
const originalCopy = [
  'Inference Exchange',
  'Supply meets demand',
  'Two forces converge',
  'The intersection is the product',
  'Trust is labelled, not assumed',
  'Providers compete. You benefit.',
  'Distributed AI inference, powered by everyone.',
]
const copy = landing.slice(landing.indexOf('const CHAPTER_COPY = ['),
  landing.indexOf('] as const', landing.indexOf('const CHAPTER_COPY = [')))
let previous = -1
for (const phrase of originalCopy) {
  const at = copy.indexOf(`title: '${phrase}'`)
  assert.ok(at > previous, 'missing/out-of-order original main title: ' + phrase)
  previous = at
}
for (const exactSub of [
  'An open market for AI inference. Send OpenAI-compatible requests; providers with spare hardware compete to serve them.',
  'Consumers bid. Providers offer. The exchange matches.',
  'Providers report a trust level. The exchange shows it as claimed until evidence verifies it. Browser chat uses TLS; it is not end-to-end encrypted.',
  'Price, speed, privacy — the matching engine optimizes for what you care about.',
]) assert.ok(copy.includes(exactSub), 'missing original main support copy: ' + exactSub)
assert.ok(!copy.includes('SUPPLY MEETS DEMAND'), 'newer eyebrow should be gone')
assert.equal((rail.match(/sceneProgress: /g) || []).length, 7,
  'exactly seven pinned states must map to continuous crystal poses')
assert.ok(rail.includes('sceneProgress: 0.82'),
  'final pre-gust crystal pose must remain at 0.82')
assert.doesNotMatch(landing, /<ScrollChapterRail/,
  'original main had NO right-hand progress rail')
assert.doesNotMatch(landing, /ScrollChapterRail activeIndex/)
assert.match(landing, /\{activeIndex === 0 && \(/)
assert.match(landing, /Skip intro/)
assert.doesNotMatch(landing, /Skip story|Enter the exchange →/)

assert.match(landing, /const CHAPTER_HOLD = 0\.60/)
assert.match(landing, /const FINAL_HOLD_UNITS = 0\.35/)
assert.match(landing, /const FINAL_SCROLL_UNITS = LAST_CHAPTER \+ 2\.2/)
assert.match(landing, /const SCENE_POSES = \[\.\.\.STORY_CHAPTERS\.map/)
assert.match(landing, /key=\{chapter\.title\}/)
assert.match(landing, /className="absolute inset-0 flex items-center justify-center px-6 sm:px-10 text-center"/)
assert.match(landing, /className="relative mx-auto w-full max-w-2xl text-center"/)
assert.match(landing, /className="mt-8 flex flex-wrap items-center justify-center gap-3"/)
assert.doesNotMatch(landing, /'Intelligence,'|'without borders\.'|'A network'|'in motion\.'/)

// Original main headline sizes and STATIC pigment gradients, now painted
// with the same mani-stone incised glyph edge as smaller text. No rainbow
// motion, backdrop scrim or oversized legacy glow.
assert.match(landing, /className="hero-mani-heading text-4xl md:text-6xl font-bold tracking-tight"/)
assert.match(landing, /className="hero-mani-heading text-3xl md:text-5xl font-bold tracking-tight leading-tight"/)
assert.match(landing, /className="hero-mani-heading-pigment bg-clip-text text-transparent"/)
assert.match(landing, /className="hero-mani-heading text-4xl md:text-5xl font-bold tracking-tight leading-\[1\.1\]"/)
assert.match(landing, /className="hero-mani-heading text-xl font-bold mb-5"/)
assert.ok(landing.includes('backgroundImage: index === 1 || index === LAST_CHAPTER'))
assert.ok(landing.includes('GRADIENTS.heroText'))
assert.ok(landing.includes('linear-gradient(135deg, ${C.warmWhite}, ${C.sand})'))
// Mani-stone inspired small lettering replaces low-contrast gray on video.
assert.match(landing, /hero-mani-copy mt-4 max-w-xl/)
assert.match(landing, /hero-mani-copy text-base md:text-lg mt-4/)
assert.match(landing, /hero-mani-fine text-\[13px\]/)
assert.doesNotMatch(landing, /color: '#8a8578'/)
assert.match(landing, /hero-mani-meta text-\[13px\]/)
assert.match(landing, /color: '#F4E8D4'/)
assert.match(landing, /color: '#F0C978'/)
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
assert.doesNotMatch(landing, /<ScrollChapterRail/, 'RHS design must not render')
// The opening scenic chapter restores the original alpha CTA styling.
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
// Mani stone-inspired painted glyphs: opaque lime-white pigment with a
// controlled dark carved edge. Avoid a paragraph-wide landscape scrim.
assert.match(styles, /\.hero-mani-copy,\s*\.hero-mani-fine \{/)
assert.match(styles, /color: #F8EAD5;/)
assert.match(styles, /-webkit-text-stroke: 0\.35px rgba\(19, 28, 33, 0\.98\);/)
assert.match(styles, /paint-order: stroke fill;/)
assert.match(styles, /\.hero-mani-nav \{/)
assert.match(styles, /color: #F7EAD6;/)
assert.match(styles, /\.hero-mani-meta \{/)
assert.match(styles, /\.hero-mani-heading \{/)
assert.match(styles, /color: #F8EAD5;/)
assert.match(styles, /-webkit-text-stroke: 0\.8px rgba\(16, 24, 29, 0\.96\);/)
assert.match(styles, /\.hero-mani-heading-pigment \{/)
assert.match(styles, /-webkit-text-stroke: 0\.95px rgba\(16, 24, 29, 0\.98\);/)
assert.match(styles, /text-shadow: none;/)
assert.match(styles, /\.hero-mani-heading,\s*\.hero-mani-heading-pigment \{/)
assert.doesNotMatch(landing, /0 2px 24px rgba\(0,0,0,0\.6\)/)
assert.match(nav, /const NAV_PAINT = '#F7EAD6'/)
assert.match(nav, /hero-mani-nav text-\[13px\]/)
assert.doesNotMatch(landing, /style=\{\{ color: '#8a8578' \}\}/)
assert.doesNotMatch(landing, /background: 'rgba\(16,45,109,0\.76\)'/)
// For stable dark surfaces we can test actual WCAG contrast numerically.
function luma(hex) {
  const channels = hex.slice(1).match(/.{2}/g).map(x => parseInt(x, 16) / 255)
    .map(x => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}
function contrast(a, b) {
  const [lighter, darker] = [luma(a), luma(b)].sort((a, b) => b - a)
  return (lighter + 0.05) / (darker + 0.05)
}
for (const ink of ['#F7EAD6', '#F4E8D4', '#F0C978']) {
  assert.ok(contrast(ink, '#292F35') >= 7, ink + ' should be high contrast on dark mineral cards')
  assert.ok(contrast(ink, '#252A30') >= 7, ink + ' should be high contrast on charcoal navbar')
}

assert.match(nav, /HERO_PIGMENTS as HP/)
assert.match(nav, /background: GRADIENTS\.sidebar/)
// Navbar covers the same 16px video seam as before, but now with a truly
// centered 72px content row. No dead strip underneath a 56px row.
assert.match(nav, /className="max-w-7xl mx-auto px-4 md:px-8 h-\[72px\] flex items-center/)
assert.match(nav, /hero-mineral-wordmark text-base font-bold uppercase/)
assert.match(nav, /src="\/logo-icon\.svg" alt="" className="w-7 h-7"/)
assert.match(nav, /to=\{l\.to\} className=\{\x60hero-mani-nav text-\[15px\] \$\{FOCUS\}\x60\}/)
assert.match(nav, /borderBottom: '1px solid rgba\(240,197,75,0\.34\)'/)
assert.match(nav, /boxShadow: '0 2px 12px rgba\(31,31,32,0\.22\)'/)
assert.doesNotMatch(nav, /absolute inset-x-0 top-full h-4/,
  'no separate extension with an empty visual strip')
assert.doesNotMatch(nav, /background: '#252A30'/,
  'single gradient covers the navbar without a color seam')
assert.match(landing, /const NAV_HEIGHT = 56/)
assert.match(landing, /className="sticky top-14 left-0 z-10 h-\[calc\(100svh-3\.5rem\)\]/)

assert.match(nav, /GRADIENTS, HERO_PIGMENTS as HP/)
assert.doesNotMatch(nav, /background: '#0E1018'/)
assert.doesNotMatch(nav, /background: 'linear-gradient\(95deg, #102D6D/)

// Preserve real routes, chapter semantics and reduced-motion controls.
for (const route of ['/chat', '/provide', '/exchange']) {
  assert.ok(landing.includes(`to="${route}"`), `missing hero CTA ${route}`)
}
assert.match(rail, /export const STORY_CHAPTERS = \[/)
assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/)
console.log('Landing: all original six transitions, intro, seven smooth pinned holds, no RHS rail, video tint preserved')
