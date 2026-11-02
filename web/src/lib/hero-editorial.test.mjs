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
  'Providers report a trust level. The exchange shows it as claimed until evidence verifies it.',
  'Price, speed, privacy — the matching engine optimizes for what you care about.',
]) assert.ok(copy.includes(exactSub), 'missing original main support copy: ' + exactSub)
assert.ok(!copy.includes('SUPPLY MEETS DEMAND'), 'newer eyebrow should be gone')
assert.doesNotMatch(landing, /Browser chat uses TLS|end-to-end encrypt/i,
  'security transport detail belongs in Chat, not the landing story or exchange card')
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
assert.doesNotMatch(landing, /mineral-spectrum-text hero-mineral-wordmark hero-story-spectrum/)
assert.doesNotMatch(landing, /hero-pigment-(?:primary|secondary|link)/)
assert.doesNotMatch(landing, /hero-body-inscription|hero-fine-inscription/)
assert.match(landing, /CHAPTER_COPY\.map\(\(chapter, index\) =>/)
assert.match(landing, /transition: 'opacity 420ms ease, visibility 420ms'/)
assert.match(landing, /<LandscapeVideo/)
const landscapeVideo = readFileSync(new URL('../components/LandscapeVideo.tsx', import.meta.url), 'utf8')
assert.doesNotMatch(landscapeVideo, /data-hero-video-tint="warm"|WARM_VIDEO_TINT|heroTint=off/,
  'landing HLS video and fallback poster must use their original colors, no warm overlay')
assert.doesNotMatch(styles, /\.hero-video-bedtime-tint\s*\{/)

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
// Three opening CTAs plus two finale CTAs retain routes, labels and quiet
// background hierarchy. On hover/focus reveal only a fine static mineral
// edge, inspired by pigment inlaid into carved stone. No flying grains,
// sweeping rainbow, shifting text, animation loops or layout changes.
assert.match(landing, /function StoneCTA\(/)
assert.match(landing, /<Link\s+to=\{to\}\s+tabIndex=\{tabIndex\}/)
assert.equal((landing.match(/<StoneCTA to=/g) || []).length, 5)
for (const [route, label, tone] of [
  ['/chat', 'Start chatting', 'light'],
  ['/provide', 'Become a provider', 'outline'],
  ['/exchange', 'Go to Exchange', 'quiet'],
]) {
  assert.ok(landing.includes('<StoneCTA to="' + route + '" tone="' + tone + '">' + label + '</StoneCTA>'),
    'missing opening mineral CTA ' + label)
}
const finalSlide = landing.slice(landing.indexOf('{/* One actual product screen'))
assert.match(finalSlide, /<StoneCTA to="\/chat" tone="light"[\s\S]*?Start a conversation\s*<\/StoneCTA>/)
assert.match(finalSlide, /<StoneCTA to="\/provide" tone="outline"[\s\S]*?Become a provider\s*<\/StoneCTA>/)
assert.equal((finalSlide.match(/<StoneCTA to=/g) || []).length, 2)
assert.match(finalSlide, /tabIndex=\{productOpacity > 0\.95 \? undefined : -1\}/)
assert.match(styles, /\.hero-stone-cta \{/)
assert.match(styles, /\.hero-stone-cta--light \{\s*color: #292B2A;\s*background: #D8D1BE;/)
assert.match(styles, /\.hero-stone-cta--outline \{[^}]*color: #F8EAD5;\s*background: rgba\(14, 16, 24, 0\.58\);/,
  'provider CTA should use the same readable charcoal surface as Go to Exchange')
assert.match(styles, /\.hero-stone-cta--quiet \{\s*color: #F8EAD5;\s*background: rgba\(14, 16, 24, 0\.58\);/)
const inlay = styles.match(/\.hero-stone-cta::after \{([^}]+)\}/)?.[1]
assert.ok(inlay, 'static mineral inlay must exist')
assert.match(inlay, /height: 2px;/)
assert.match(inlay, /background: linear-gradient\(90deg, #9D5C47 0%, #C49A45 52%, #668B78 100%\)/)
assert.match(inlay, /opacity: 0;/)
assert.match(styles, /\.hero-stone-cta:is\(:hover, :focus-visible\)::after \{\s*opacity: 1;/)
assert.match(styles, /\.hero-stone-cta:focus-visible \{\s*outline: 2px solid/)
// First-principles regression: the LIVE main's original gradient belongs
// to .mineral-border::before (an animated masked border), not a conic fill.
// Interactive buttons reuse that same recipe and only shift paint position.
assert.match(landing, /const STATIC_CTA_PREVIEW =/)
assert.match(landing, /get\('ctaEffect'\) === 'stone'/)
assert.match(landing, /onPointerMove=\{movePigmentSpotlight\}/)
assert.match(landing, /getBoundingClientRect\(\)/)
assert.match(landing, /style\.setProperty\('--pigment-x'/)
assert.match(landing, /style\.setProperty\('--pigment-y'/)
assert.doesNotMatch(landing, /--pigment-angle|hero-stone-cta--spotlight/,
  'a new conic swirl would alter the visual reference')
assert.match(landing, /' mineral-border hero-stone-cta--interactive'/)
assert.match(landing, /window\.matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches/)
assert.match(landing, /className="hero-stone-cta__label"/)
const paint = styles.match(/--mineral-border-paint: linear-gradient\(135deg,([^;]+)\);/)?.[1]
assert.ok(paint, 'original main mineral border paint must be a shared token')
const mainBorderStops = [
  '#C83A3240', '#D77A2F55', '#C49A4555', '#087F5B44',
  '#4D9A9144', '#315B7240', '#4A465F38', '#702F3238',
]
let stopAt = -1
for (const stop of mainBorderStops) {
  const at = paint.indexOf(stop)
  assert.ok(at > stopAt, 'original main border stops changed or reordered: ' + stop)
  stopAt = at
}
const borderRule = styles.match(/\.mineral-border::before \{([^}]+)\}/)?.[1]
const interactiveBorder = styles.match(/\.hero-stone-cta--interactive::before \{([^}]+)\}/)?.[1]
const interactiveFill = styles.match(/\.hero-stone-cta--interactive::after \{([^}]+)\}/)?.[1]
assert.ok(borderRule && interactiveBorder && interactiveFill)
assert.match(borderRule, /background: var\(--mineral-border-paint\)/)
assert.match(borderRule, /background-size: 220% 220%/)
assert.match(borderRule, /-webkit-mask-composite: xor;/)
assert.doesNotMatch(interactiveBorder, /animation:/,
  'at rest the CTA must inherit the original main border animation')
const interactingBorder = styles.match(/\.hero-stone-cta--interactive:is\(:hover, :focus-visible\)::before \{([^}]+)\}/)?.[1]
assert.ok(interactingBorder, 'the border must respond to pointer/focus')
assert.match(interactingBorder, /animation: none;/,
  'on hover the cursor must take over from the 14s border drift')
assert.match(interactingBorder, /background-position: var\(--pigment-x\) var\(--pigment-y\)/)
assert.match(interactiveFill, /background: var\(--mineral-border-paint\)/)
assert.match(interactiveFill, /background-size: 220% 220%/)
assert.match(interactiveFill, /background-position: var\(--pigment-x\) var\(--pigment-y\)/)
assert.match(interactiveFill, /opacity: 0;/)
assert.match(styles, /\.hero-stone-cta--interactive:is\(:hover, :focus-visible\)::after \{\s*opacity: 1;/)
assert.match(styles, /\.hero-stone-cta--interactive::after \{ transition: none; \}/,
  'reduced-motion users should get an immediate static gradient')
assert.doesNotMatch(styles, /hero-stone-cta--spotlight|@keyframes hero-sand-wisp/)
assert.doesNotMatch(interactiveFill, /conic-gradient|radial-gradient|filter:|animation:/,
  'interactive fill should only use original main border pigment')
assert.doesNotMatch(landing, /SandCTA|hero-sand-cta__wash|hero-sand-cta__grains/)
assert.doesNotMatch(finalSlide, /group-hover:text-white|group-hover:opacity-100/,
  'previous full-surface standalone CTA gradient must remain removed')
assert.doesNotMatch(finalSlide, /hero-pigment-(primary|secondary)/)
assert.doesNotMatch(landing, /hero-exchange-card/)
assert.match(landing, /className="rounded-2xl p-6 w-full max-w-sm mineral-border"/)
assert.match(landing, /background: 'rgba\(255,255,255,0\.06\)'/)
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
// Large letterforms have delicate enclosed counters (e, a, P). Even a thin
// dark stroke paints INSIDE those counters, leaving black lines with clipped
// pigment gradients. Guard against reintroducing that rasterization artifact.
const largeHeading = styles.match(/\.hero-mani-heading \{([^}]+)\}/)?.[1]
const pigmentHeading = styles.match(/\.hero-mani-heading-pigment \{([^}]+)\}/)?.[1]
assert.ok(largeHeading && pigmentHeading, 'both headline styles must exist')
for (const rule of [largeHeading, pigmentHeading]) {
  assert.match(rule, /-webkit-text-stroke: 0;/,
    'large lettering must explicitly disable interior glyph outlines')
  assert.doesNotMatch(rule, /paint-order: stroke fill|stroke-width:/,
    'large letter counters must remain smooth: no hidden stroke overrides')
}
assert.match(largeHeading, /color: #F8EAD5;/)
assert.match(largeHeading, /0 -1px 0 rgba\(255, 247, 228, 0\.22\)/,
  'subtle upper mineral-pigment highlight creates painted-stone relief')
assert.match(largeHeading, /0 3px 6px rgba\(11, 18, 24, 0\.76\)/,
  'downward shadow supplies depth without a dark edge inside counters')
assert.doesNotMatch(largeHeading, /filter:|drop-shadow/,
  'only gradient spans need composited-alpha shadowing')
assert.match(pigmentHeading, /text-shadow: none;/,
  'clipped gradient glyphs must not use ordinary text-shadow')
assert.match(pigmentHeading, /filter:\s*drop-shadow\(0 1px 1px rgba\(11, 18, 24, 0\.76\)\)\s*drop-shadow\(0 3px 5px rgba\(11, 18, 24, 0\.42\)\)/,
  'only soft offset shadows on the final gradient glyph, no hard black border')
assert.doesNotMatch(styles, /\.hero-mani-heading,\s*\.hero-mani-heading-pigment\s*\{[^}]*-webkit-text-stroke-width:/)
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
assert.match(nav, /className="max-w-7xl mx-auto px-3 sm:px-4 xl:px-6 h-\[72px\] flex items-center/)
assert.match(nav, /hero-mineral-wordmark truncate text-sm sm:text-base font-bold uppercase/)
assert.match(nav, /src="\/logo-icon\.svg" alt="" className="w-7 h-7 shrink-0"/)
assert.match(nav, /to=\{l\.to\} className=\{\x60hero-mani-nav text-\[15px\] whitespace-nowrap \$\{FOCUS\}\x60\}/)
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
console.log('Landing: seven pinned holds, five CTAs reuse exact main mineral-border pigment with pointer movement')
