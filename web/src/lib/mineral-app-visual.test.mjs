import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const theme = read('./theme.ts')
const shell = read('../components/Layout.tsx')
const start = read('../pages/GettingStarted.tsx')
const css = read('../index.css')
const palette = read('../app-theme.css')

// Pilot uses semantic app tokens, never a blanket replacement of C or trust
// status semantics. Landing preserves its separate cinematic presentation.
assert.match(theme, /export const APP_PIGMENTS = \{/)
for (const [name, hex] of Object.entries({
  deepLapis: '#102D6D', lapis: '#163E8C', orpiment: '#F0C54B',
  cinnabar: '#C94C2F', jade: '#5F8E61', parchment: '#F7F2E8',
  paper: '#FFFDF7', ink: '#263A63',
})) assert.ok(theme.includes(`${name}: '${hex}'`), `missing ${name} token`)

// App-only appearance selector is shared by desktop/mobile sidebar and Login.
// Light is the default; persisted valid values can restore Dark or Blue light.
assert.match(shell, /className="ie-mineral-app ie-app-appearance-scope flex min-h-screen"/)
assert.match(shell, /className="ie-app-appearance-scope min-h-screen"/)
assert.match(shell, /data-appearance=\{appearance\}/g)
assert.equal((shell.match(/<AppearanceSelector value=\{appearance\} onChange=\{setAppearance\}/g) || []).length, 2)
assert.match(shell, /role="group" aria-label="Appearance"/)
assert.match(shell, /aria-pressed=\{value === mode\.value\}/)
assert.match(shell, /mode\.value === 'blue-light'/)
// Label change is presentation-only: the persisted 'blue-light' value and
// warm appearance stays compatible with existing saved choices.
assert.match(shell, /\{ value: 'blue-light', label: 'Night Shift' \}/)
assert.doesNotMatch(shell, /label: 'Blue light filter'/)
assert.match(shell, /function AppearanceIcon\(\{ mode \}: \{ mode: AppAppearance \}\)/)
assert.match(shell, /if \(mode === 'light'\)/)
assert.match(shell, /if \(mode === 'dark'\)/)
assert.match(shell, /<circle cx="12" cy="12" r="4"/) // sun
assert.match(shell, /A8\.5 8\.5/) // crescent moon
assert.match(shell, /M3 18h18M6 21h12/) // setting sun + horizon
assert.match(shell, /'aria-hidden': true as const/)
assert.match(shell, /<AppearanceIcon mode=\{mode\.value\} \/>/)
assert.match(shell, /<span className="text-center">\{mode\.label\}<\/span>/)
assert.match(shell, /min-h-\[56px\]/)

for (const mode of ['Light', 'Dark', 'Night Shift']) {
  assert.ok(shell.includes("label: '" + mode + "'"), 'missing appearance option: ' + mode)
}
assert.match(shell, /const APPEARANCE_KEY = 'ie-app-appearance'/)
assert.match(shell, /window\.localStorage\.getItem\(APPEARANCE_KEY\)/)
assert.match(shell, /window\.localStorage\.setItem\(APPEARANCE_KEY, appearance\)/)
assert.match(shell, /if \(stored === 'dark' \|\| stored === 'blue-light'\) return stored/)
assert.match(shell, /return 'light'/)
assert.doesNotMatch(shell, /ie-app-bedtime-tint|warmTint|setWarmTint|Bedtime tint/)
assert.ok(!read('../pages/Landing.tsx').includes('ie-app-appearance-scope'))
assert.match(shell, /location\.pathname === '\/'/)
assert.match(shell, /className="ie-app-content flex-1/)
assert.match(shell, /className="ie-app-content"/)
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
assert.match(shell, /variant=\{appearance === 'dark' \? 'dark' : 'light'\} opacity=\{0\.06\}/)
assert.ok(!shell.includes('ie-app-workspace'))
assert.ok(!css.includes('.ie-app-workspace'))
assert.ok(!shell.includes("background: '#292F35', borderBottom"))
assert.match(shell, /ie-app-wordmark/)
assert.match(shell, /ie-app-spectrum-rule/)
assert.match(shell, /aria-current=\{active \? 'page' : undefined\}/)
assert.match(shell, /path: '\/start', label: 'Getting Started'/)
assert.match(shell, /path: '\/providers', label: 'Providers'/)
assert.match(shell, /path: '\/provide', label: 'Offer Compute'/)
assert.match(shell, /'\/provide': \{ title: 'Offer Compute'/)
assert.doesNotMatch(shell, /Provide \(preview\)|Provide compute/)
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
// All three appearances define complete role palettes. Verify real contrast
// pairs, including selected/hover surfaces and semantic status panels.
const luminance = hex => hex.match(/[a-f0-9]{2}/gi)
  .map(x => parseInt(x, 16) / 255)
  .map(x => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)
  .reduce((sum, x, i) => sum + x * [0.2126, 0.7152, 0.0722][i], 0)
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) /
  (Math.min(luminance(a), luminance(b)) + 0.05)
const modes = [...palette.matchAll(/\.ie-app-appearance-scope(?:\[data-appearance="(dark|blue-light)"\])? \{([^}]+)\}/g)]
  .filter(match => match[2].includes('--ui-page:'))
assert.equal(modes.length, 3)
for (const [, mode = 'light', body] of modes) {
  const colors = Object.fromEntries([...body.matchAll(/--ui-([a-z0-9-]+): (#[A-Fa-f0-9]{6});/g)]
    .map(([, name, color]) => [name, color]))
  for (const surface of ['page', 'surface', 'surface-muted', 'hover', 'selected']) {
    for (const ink of ['text', 'body', 'muted', 'accent', 'link', 'success', 'warning', 'danger', 'info', 'purple']) {
      assert.ok(contrast(colors[ink], colors[surface]) >= 4.5,
        `${mode}: ${ink} on ${surface} is ${contrast(colors[ink], colors[surface]).toFixed(2)}:1`)
    }
  }
  for (const status of ['success', 'warning', 'danger', 'info', 'purple']) {
    for (const ink of [status, 'text', 'body', 'muted']) {
      assert.ok(contrast(colors[ink], colors[status + '-surface']) >= 4.5,
        `${mode}: ${ink} on ${status} panel must meet text contrast`)
    }
  }
  for (let i = 1; i <= 9; i++) {
    assert.ok(contrast(colors['chart-' + i], colors['surface-muted']) >= 3, mode + ': chart series ' + i)
  }
  for (const action of ['action', 'action-hover', 'danger-action', 'success-action']) {
    assert.ok(contrast(colors['on-action'], colors[action]) >= 4.5, mode + ': ' + action + ' button')
  }
  assert.ok(contrast(colors['code-text'], colors['code-surface']) >= 4.5, mode + ': code')
  for (const surface of ['page', 'surface', 'surface-muted']) {
    assert.ok(contrast(colors.focus, colors[surface]) >= 3, mode + ': focus indicator')
    assert.ok(contrast(colors['control-border'], colors[surface]) >= 3, mode + ': input boundary')
  }
}
assert.doesNotMatch(css, /\[style\*=/, 'appearance must not depend on serialized inline RGB strings')
assert.doesNotMatch(css, /ie-start-(ink|gold|link)/, 'onboarding shares the app palette')
assert.match(palette, /\.ie-app-content ::selection/)
assert.match(palette, /color-scheme: dark/)
assert.match(palette, /color-scheme: light/)
assert.doesNotMatch(css, /\.ie-app-appearance-scope\[data-appearance="blue-light"\]::after/)
assert.match(shell, /color: UI\.body/)
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

console.log('#203 mineral workbench: Light / Dark / Blue light filter appearance, accessible app shell, journey contract passed')
