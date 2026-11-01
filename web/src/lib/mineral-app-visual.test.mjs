import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const theme = read('./theme.ts')
const shell = read('../components/Layout.tsx')
const start = read('../pages/GettingStarted.tsx')
const css = read('../index.css')

// Pilot uses semantic app tokens, never a blanket replacement of C or trust
// status semantics. Landing preserves its separate cinematic presentation.
assert.match(theme, /export const APP_PIGMENTS = \{/)
for (const [name, hex] of Object.entries({
  deepLapis: '#102D6D', lapis: '#163E8C', orpiment: '#F0C54B',
  cinnabar: '#C94C2F', jade: '#5F8E61', parchment: '#F7F2E8',
  paper: '#FFFDF7', ink: '#263A63',
})) assert.ok(theme.includes(`${name}: '${hex}'`), `missing ${name} token`)

assert.match(shell, /className="ie-mineral-app ie-app-temperature-scope flex min-h-screen"/)
assert.match(shell, /className="ie-app-temperature-scope min-h-screen"/)
assert.match(shell, /data-warm-tint=\{warmTint \? 'on' : 'off'\}/)
assert.match(shell, /aria-pressed=\{warmTint\}/)
assert.match(shell, /window\.localStorage\.getItem\('ie-app-bedtime-tint'\)/)
assert.match(shell, /window\.localStorage\.setItem\('ie-app-bedtime-tint', warmTint \? 'on' : 'off'\)/)
assert.ok(!read('../pages/Landing.tsx').includes('ie-app-temperature-scope'))
assert.match(shell, /ie-mineral-sidebar/)
// One shared gradient token drives BOTH the landing navigation and app sidebar.
assert.ok(theme.includes("sidebar: 'linear-gradient(180deg, ' + C.blueBlack"))
assert.equal(shell.split('background: GRADIENTS.sidebar').length - 1, 3)
assert.ok(shell.includes('background: GRADIENTS.sidebar, borderBottom'))
// Match the current main branch's actual neutral/off-white page gradient,
// rather than the preceding green-sage/tan or amber bedtime experiments.
assert.ok(theme.includes("atmosphere: 'linear-gradient(180deg, #F8F8F5 0%, ' + C.pageBg"))
assert.ok(shell.includes('background: `linear-gradient(180deg, #F8F8F5 0%, ${C.pageBg} 40%, #F3F2EE 100%)`'))
assert.ok(!theme.includes('#D0C3B1 0%'))
assert.ok(!theme.includes('#E5D8C5 100%'))
assert.ok(!theme.includes('MINERAL_FIELD_BACKGROUND'))
assert.ok(!theme.includes("APP_TEXT ="))
assert.ok(shell.includes('variant="light" opacity={0.06}'))
assert.ok(!shell.includes('ie-app-workspace'))
assert.ok(!css.includes('.ie-app-workspace'))
assert.ok(!shell.includes("background: '#292F35', borderBottom"))
assert.match(shell, /ie-app-wordmark/)
assert.match(shell, /ie-app-spectrum-rule/)
assert.match(shell, /aria-current=\{active \? 'page' : undefined\}/)
assert.match(shell, /path: '\/start', label: 'Getting Started'/)
assert.match(shell, /\{sidebarContent\}/g)
assert.match(shell, /location\.pathname === '\/'/)

// Getting Started remains functional and data-driven, not a static redesign.
assert.match(start, /ie-mineral-journey/)
assert.match(start, /ie-mineral-panel/)
assert.match(start, /ie-mineral-action/)
assert.match(start, /role="progressbar"/)
assert.match(start, /aria-current=\{i === stepIndex \? 'step' : undefined\}/)
assert.match(start, /useSWR\(needModels \? 'models'/)
assert.match(start, /Private-alpha availability/)
assert.match(start, /What if this doesn't work\? \/ I'm stuck/)
assert.match(start, /Copy setup commands/)

// Motion belongs to accents, never operational copy; honor accessibility.
assert.match(css, /\.ie-mineral-sidebar \.ie-app-wordmark/)
assert.match(css, /\.ie-mineral-app \.ie-mineral-journey/)
assert.match(css, /\.ie-mineral-app \.ie-mineral-panel/)
assert.ok(css.includes('--ie-app-surface: #FFFDF7'))
assert.ok(!css.includes('.ie-mineral-app .bg-white {'))
assert.ok(css.includes('background: linear-gradient(140deg, #FFFDF7 0%, #FAF5E9 100%)'))
// An amber multiply veil is deliberately ABOVE the rendered page, to tint
// blues too (as f.lux would), while keeping main's original palette unedited.
assert.match(css, /\.ie-app-temperature-scope\[data-warm-tint="on"\]::after \{/)
assert.match(css, /background: #FF995B;/)
assert.match(css, /opacity: 0\.48;/)
assert.match(css, /mix-blend-mode: multiply;/)
assert.match(css, /pointer-events: none;/)
assert.match(css, /@media \(forced-colors: active\), print/)
assert.doesNotMatch(css, /\.ie-mineral-app\s*\{[^}]*filter:/)
const tint = (hex, overlay = '#FF995B', strength = 0.48) =>
  hex.match(/[a-f0-9]{2}/gi).map((x, i) =>
    Math.round(parseInt(x, 16) * (1 - strength +
      strength * parseInt(overlay.slice(1 + i * 2, 3 + i * 2), 16) / 255)))
const warmPaper = tint('#FFFDF7')
assert.equal(warmPaper[0], 255)
assert.ok(warmPaper[1] < 215 && warmPaper[2] < 180, 'white paper becomes orange-warm, not green')
assert.ok(contrast('#263A63', '#FFFDF7') >= 7, 'original untinted paper retains strong contrast')
const luminance = (hex) => {
  const [r, g, b] = hex.match(/[a-f0-9]{2}/gi).map(x => parseInt(x, 16) / 255)
    .map(x => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)
  return r * 0.2126 + g * 0.7152 + b * 0.0722
}
const contrast = (a, b) => {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((a, b) => b - a)
  return (lighter + 0.05) / (darker + 0.05)
}
for (const ink of ['#263A63', '#46546A', '#845918', '#31644E']) {
  assert.ok(contrast(ink, '#FFFDF7') >= 4.5, 'readable ink on original app paper: ' + ink)
}
assert.ok(luminance('#F8F8F5') > 0.8, 'original main background should remain a light neutral')
for (const name of [
  'Overview', 'Chat', 'Exchange', 'Models', 'Providers', 'Provide', 'Billing',
  'Keys', 'Settings', 'Admin', 'Trace', 'ProviderDashboard', 'Docs',
  'GettingStarted', 'Login', 'NotFound',
]) {
  assert.doesNotMatch(read('../pages/' + name + '.tsx'), /APP_TEXT\./,
    'no experimental text-token overrides in ' + name)
}
assert.match(css, /@media \(prefers-reduced-motion: reduce\)/)
assert.match(css, /\.ie-mineral-sidebar \.ie-app-nav-item:focus-visible/)
// Selected app nav items retain the original live-alpha rainbow indicator
// and subtle charcoal hover, rather than the newer amber highlight.
assert.match(shell, /background: active \? C\.sidebarHover : 'transparent'/)
assert.match(shell, /color: active \? '#fff' : AP\.sidebarText/)
assert.match(css, /background: linear-gradient\(to bottom, #C83A32, #C49A45, #4D9A91, #315B72\)/)
assert.doesNotMatch(css, /\.ie-mineral-sidebar \.sidebar-active-bar::after\s*\{/)
assert.match(css, /\.ie-mineral-sidebar \.ie-app-nav-item\[aria-current="page"\]:hover\s*\{\s*background: rgba\(255,255,255,0\.06\)/)

console.log('#203 mineral workbench: theme, app shell, journey contract, accessibility passed')
