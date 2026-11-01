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
  cinnabar: '#C94C2F', jade: '#5F8E61', parchment: '#CEDCD2',
  paper: '#D9E4DC', ink: '#263A63',
})) assert.ok(theme.includes(`${name}: '${hex}'`), `missing ${name} token`)

assert.match(shell, /className="ie-mineral-app flex min-h-screen"/)
assert.match(shell, /ie-mineral-sidebar/)
// One shared gradient token drives BOTH the landing navigation and app sidebar.
assert.ok(theme.includes("sidebar: 'linear-gradient(180deg, ' + C.blueBlack"))
assert.equal(shell.split('background: GRADIENTS.sidebar').length - 1, 3)
assert.ok(shell.includes('background: GRADIENTS.sidebar, borderBottom'))
// Reference painting's dusky sky blue-to-earth-sage gradient, no near-white
// endpoint or bright yellow/orange radial hotspots in the app backdrop.
assert.ok(theme.includes("atmosphere: 'radial-gradient("))
assert.ok(theme.includes('#426A75 0%'))
assert.ok(theme.includes('#6A8E87 54%'))
assert.ok(theme.includes('#91A48B 100%'))
assert.ok(!theme.includes('#FAF7EE 100%'))
assert.ok(!theme.includes('rgba(229,171,101,0.23)'))
assert.ok(shell.includes('background: AP.atmosphere'))
assert.ok(theme.includes("appTitle: 'linear-gradient(100deg, #EFF2E7"))
assert.ok(shell.includes('const gradient = GRADIENTS.appTitle'))
assert.ok(shell.includes("color: '#E2EBE2'"))
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
assert.match(css, /\.ie-mineral-app \.bg-white \{/)
assert.ok(css.includes('background-color: #D9E4DC'))
assert.ok(css.includes('background: linear-gradient(140deg, #D9E4DC 0%, #CEDCD2 100%)'))
assert.ok(css.includes('--ie-app-surface: #D9E4DC'))

// A few objective luminance/contrast guards keep the tranquil palette from
// drifting back to a near-white page or unreadable dark-on-teal headings.
const luminance = (hex) => {
  const rgb = hex.match(/[a-f0-9]{2}/gi).map(channel => parseInt(channel, 16) / 255)
  const [red, green, blue] = rgb.map(x => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)
  return red * 0.2126 + green * 0.7152 + blue * 0.0722
}
const contrast = (a, b) => {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (lighter + 0.05) / (darker + 0.05)
}
for (const color of ['#426A75', '#537A7C', '#6A8E87', '#829C8B', '#91A48B']) {
  assert.ok(luminance(color) < 0.40, 'app background too bright: ' + color)
}
assert.ok(contrast('#E2EBE2', '#426A75') >= 4.5, 'app page subtitle needs 4.5:1 contrast on sky-blue')
assert.ok(contrast('#263A63', '#D9E4DC') >= 7, 'card text needs strong contrast on muted paper')

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
