import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const theme = read('./theme.ts')
const shell = read('../components/Layout.tsx')
const start = read('../pages/GettingStarted.tsx')
const css = read('../index.css')
const landingMineral = read('../components/MineralFlowField.tsx')

// Pilot uses semantic app tokens, never a blanket replacement of C or trust
// status semantics. Landing preserves its separate cinematic presentation.
assert.match(theme, /export const APP_PIGMENTS = \{/)
for (const [name, hex] of Object.entries({
  deepLapis: '#102D6D', lapis: '#163E8C', orpiment: '#F0C54B',
  cinnabar: '#C94C2F', jade: '#5F8E61', parchment: '#BDC5C7',
  paper: '#D0D4D3', ink: '#263A63',
})) assert.ok(theme.includes(`${name}: '${hex}'`), `missing ${name} token`)

assert.match(shell, /className="ie-mineral-app flex min-h-screen"/)
assert.match(shell, /ie-mineral-sidebar/)
// One shared gradient token drives BOTH the landing navigation and app sidebar.
assert.ok(theme.includes("sidebar: 'linear-gradient(180deg, ' + C.blueBlack"))
assert.equal(shell.split('background: GRADIENTS.sidebar').length - 1, 3)
assert.ok(shell.includes('background: GRADIENTS.sidebar, borderBottom'))
// The actual final landing slide and the non-landing workbench share
// one dark, low-glare mineral background token (not a new GPU canvas).
assert.match(theme, /export const MINERAL_FIELD_BACKGROUND = 'radial-gradient\(ellipse at 80% 30%/)
assert.ok(theme.includes('rgba(8,127,91,0.18)'))
assert.ok(theme.includes('rgba(200,58,50,0.12)'))
assert.ok(theme.includes('#111A26'))
assert.ok(theme.includes('atmosphere: MINERAL_FIELD_BACKGROUND'))
assert.ok(landingMineral.includes("import { MINERAL_FIELD_BACKGROUND } from '../lib/theme'"))
assert.ok(landingMineral.includes('background: MINERAL_FIELD_BACKGROUND'))
assert.ok(shell.includes('background: AP.atmosphere'))
assert.ok(shell.includes('<MineralAurora variant="dark" opacity={0.10}'))
assert.doesNotMatch(shell, /<MineralFlowField/)
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
assert.ok(css.includes('background-color: var(--ie-app-surface)'))
assert.ok(css.includes('background-color: #C7CDCD'))
assert.ok(css.includes('background-color: #D8CBB8'))
assert.ok(css.includes('background-color: #D9C8C6'))
assert.ok(css.includes('background: linear-gradient(140deg, #D0D4D3 0%, #C5CBCC 100%)'))
assert.ok(css.includes('--ie-app-surface: #D0D4D3'))
assert.match(shell, /<main className="ie-app-workspace relative z-10 mx-4 md:mx-8 mb-10 rounded-2xl p-4 md:p-6">/)
assert.match(css, /\.ie-app-workspace \{/)
assert.ok(css.includes('background: #BAC3C5'))
assert.ok(css.includes('color: #263844'))
assert.match(css, /\.ie-app-workspace input:is\(:not\(\[type\]\), \[type="text"\]/)
assert.match(css, /\.ie-app-workspace \.text-gray-500/)
assert.ok(!css.includes('background-color: #C6D1CB'))

// Objective guards for ALL routes: dark finale field around a neutral work
// canvas and cards. Metadata/status text must contrast on the darker canvas.
const luminance = (hex) => {
  const rgb = hex.match(/[a-f0-9]{2}/gi).map(channel => parseInt(channel, 16) / 255)
  const [red, green, blue] = rgb.map(x => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)
  return red * 0.2126 + green * 0.7152 + blue * 0.0722
}
const contrast = (a, b) => {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (lighter + 0.05) / (darker + 0.05)
}
assert.ok(luminance('#111A26') < 0.025, 'landing-finale/app backdrop should remain dark')
assert.ok(luminance('#BAC3C5') < 0.57, 'workspace should not be glaringly bright')
for (const color of ['#BAC3C5', '#D0D4D3', '#C5CBCC']) {
  assert.ok(luminance(color) < 0.67, 'panel too bright: ' + color)
  assert.ok(contrast('#263A63', color) >= 6, 'page/card headings must be readable on ' + color)
}
assert.ok(contrast('#E2EBE2', '#111A26') >= 7, 'page subtitles should contrast with dark field')
assert.ok(contrast('#263844', '#BAC3C5') >= 6, 'default workspace text needs strong contrast')
for (const [name, color] of Object.entries({
  muted: '#42505A', soft: '#42505A', gold: '#644718', green: '#1A5542',
  turquoise: '#205566', red: '#7B3834',
})) {
  assert.ok(theme.includes(`${name}: '${color}'`), 'missing app text ink token: ' + name)
  assert.ok(contrast(color, '#BAC3C5') >= 4.5, 'status/metadata contrast too weak: ' + name)
}

assert.match(css, /@media \(prefers-reduced-motion: reduce\)/)
assert.match(css, /\.ie-mineral-sidebar \.ie-app-nav-item:focus-visible/)
// Scan every routed app surface, not only the homepage. The shared layout is
// the single source of truth for dark-field/readable-paper separation.
const pageNames = [
  'Overview','Chat','Exchange','Models','Providers','Provide','Billing','Keys',
  'Settings','Admin','Trace','ProviderDashboard','Docs','GettingStarted',
  'Login','NotFound',
]
for (const name of pageNames) {
  const page = read('../pages/' + name + '.tsx')
  assert.ok(page.length > 200, 'missing app route implementation: ' + name)
  assert.doesNotMatch(page, /MINERAL_FIELD_BACKGROUND/, 'dark backdrop leaked directly into ' + name)
}
const exchange = read('../pages/Exchange.tsx')
assert.ok(exchange.includes("background: '#D0D4D3'"), 'exchange data tables need neutral paper')
const chat = read('../pages/Chat.tsx')
assert.match(chat, /prose prose-sm prose-invert/, 'dark assistant message bubbles keep inverse text')
assert.match(css, /\.ie-app-workspace input::placeholder/)

// Selected app nav items retain the original live-alpha rainbow indicator
// and subtle charcoal hover, rather than the newer amber highlight.
assert.match(shell, /background: active \? C\.sidebarHover : 'transparent'/)
assert.match(shell, /color: active \? '#fff' : AP\.sidebarText/)
assert.match(css, /background: linear-gradient\(to bottom, #C83A32, #C49A45, #4D9A91, #315B72\)/)
assert.doesNotMatch(css, /\.ie-mineral-sidebar \.sidebar-active-bar::after\s*\{/)
assert.match(css, /\.ie-mineral-sidebar \.ie-app-nav-item\[aria-current="page"\]:hover\s*\{\s*background: rgba\(255,255,255,0\.06\)/)

console.log('#203 mineral workbench: theme, app shell, journey contract, accessibility passed')
