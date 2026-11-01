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

assert.match(shell, /className="ie-mineral-app flex min-h-screen"/)
assert.match(shell, /ie-mineral-sidebar/)
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
assert.match(css, /@media \(prefers-reduced-motion: reduce\)/)
assert.match(css, /\.ie-mineral-sidebar \.ie-app-nav-item:focus-visible/)
console.log('#203 mineral workbench: theme, app shell, journey contract, accessibility passed')
