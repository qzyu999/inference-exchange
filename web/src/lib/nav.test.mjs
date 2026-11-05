// Run: node web/src/lib/nav.test.mjs  (#107, AUTH-018)
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { LANDING_LINKS, getLandingGroups, getLandingAccountLinks, nextBrandCompact, authState, githubLoginHref, loginHref, safeNextPath } from './nav.js'

// Open-redirect cases must fall back
const unsafe = [
  undefined, null, '', 'chat', 'https://evil.example/x', '//evil.example', '/\\evil.example',
  '\\\\evil', 'javascript:alert(1)', '/ok\nSet-Cookie:x', '/v1/admin/controls', '/ws/provider',
  '/login', '/' + 'a'.repeat(600),
]
for (const v of unsafe) assert.equal(safeNextPath(v), '/chat', `unsafe: ${JSON.stringify(v)}`)

const safe = ['/chat', '/keys', '/billing', '/trace?id=abc123', '/docs/requirements/auth', '/admin', '/provide']
for (const v of safe) assert.equal(safeNextPath(v), v, `safe: ${v}`)

assert.equal(loginHref('/keys'), '/login?next=%2Fkeys')
assert.equal(loginHref('/chat'), '/login?next=%2Fchat')
assert.equal(loginHref('https://evil.example'), '/login')
assert.equal(githubLoginHref('/billing'), '/v1/auth/github/login?next=%2Fbilling')
assert.equal(githubLoginHref('//evil.example'), '/v1/auth/github/login')

assert.equal(authState(true, null), 'loading')
assert.equal(authState(false, null), 'signed-out')
assert.equal(authState(true, { user_id: 'u' }), 'signed-in')

// Every primary landing link points at a real route
const routes = readFileSync(new URL('../main.tsx', import.meta.url), 'utf8')
for (const { to } of LANDING_LINKS) {
  const route = to === '/docs' ? '/docs/*' : to
  assert.ok(routes.includes(`path="${route}"`), `route missing for ${to}`)
}
for (const want of ['/chat', '/exchange', '/models', '/providers', '/provide', '/docs']) {
  assert.ok(LANDING_LINKS.some(l => l.to === want), `landing nav missing ${want}`)
}

// Supply discovery and compute contribution are distinct destinations.
assert.equal(LANDING_LINKS.find(l => l.to === '/providers')?.label, 'Providers')
assert.equal(LANDING_LINKS.find(l => l.to === '/provide')?.label, 'Become a provider')
assert.equal(LANDING_LINKS.filter(l => l.to === '/provide').length, 1)

// Grouped routes are reachable; private destinations follow verified identity.
const guestGroups = getLandingGroups(null)
assert.deepEqual(guestGroups.map(group => group.label), ['Use AI', 'Provide compute', 'Network', 'Resources'])
assert.deepEqual(guestGroups.filter(group => group.side === 'left').map(group => group.id), ['use-ai', 'provide'])
assert.deepEqual(guestGroups.filter(group => group.side === 'right').map(group => group.id), ['network', 'resources'])
assert.ok(!guestGroups.flatMap(group => group.items).some(item => item.to === '/dashboard'))
assert.deepEqual(getLandingAccountLinks(null), [])
const member = { user_id: 'member', is_admin: false }
const memberLinks = getLandingAccountLinks(member)
for (const to of ['/keys', '/billing', '/settings', '/dashboard']) assert.ok(memberLinks.some(item => item.to === to))
assert.ok(!memberLinks.some(item => item.to === '/admin'))
assert.ok(!getLandingAccountLinks({ user_id: 'member', is_admin: 'true' }).some(item => item.to === '/admin'))
assert.ok(getLandingAccountLinks({ user_id: 'owner', is_admin: true }).some(item => item.to === '/admin'))
assert.ok(getLandingGroups(member).flatMap(group => group.items).some(item => item.to === '/dashboard'))
for (const { to } of getLandingGroups(member).flatMap(group => group.items).concat(getLandingAccountLinks({ user_id: 'owner', is_admin: true }))) {
  assert.ok(routes.includes(`path="${to === '/docs' ? '/docs/*' : to}"`), `group route missing for ${to}`)
}
const resources = guestGroups.find(group => group.id === 'resources').items
assert.deepEqual(resources.map(item => item.to), ['/start', '/docs', '/news', '/about'])
assert.equal(resources.find(item => item.to === '/news').dividerBefore, true)
const landingNav = readFileSync(new URL('../components/LandingNav.tsx', import.meta.url), 'utf8')
assert.match(landingNav, /aria-expanded=/)
assert.match(landingNav, /aria-controls=/)
assert.match(landingNav, /document\.addEventListener\('pointerdown', onOutsidePointer\)/)
assert.match(landingNav, /event\.key !== 'Escape'/)
assert.match(landingNav, /reloadDocument=\{item\.to === '\/admin'\}/)
assert.match(routes, /path="\/news" element=\{<News \/>\}/)
assert.match(routes, /path="\/about" element=\{<About \/>\}/)

// A scroll deadband prevents repeated toggles while the page rests near a threshold.
assert.equal(nextBrandCompact(0, true), false)
assert.equal(nextBrandCompact(-10, true), false)
assert.equal(nextBrandCompact(23, true), false)
assert.equal(nextBrandCompact(24, true), true)
assert.equal(nextBrandCompact(80, false), false)
assert.equal(nextBrandCompact(81, false), true)
assert.equal(nextBrandCompact(1000, false), true)
for (const y of [24, 40, 80, NaN, Infinity]) {
  assert.equal(nextBrandCompact(y, false), false)
  assert.equal(nextBrandCompact(y, true), true)
}
const navStyles = readFileSync(new URL('../components/landing-nav.css', import.meta.url), 'utf8')
assert.match(navStyles, /--brand-icon-size:44px/)
assert.match(navStyles, /left:50%;top:50%;transform:translate\(-50%,-50%\)/)
assert.match(navStyles, /border-radius:999px/)
assert.match(landingNav, /onPointerEnter=/)
assert.match(landingNav, /onPointerLeave=/)
assert.match(landingNav, /event\.pointerType !== 'mouse'/)
assert.match(navStyles, /prefers-reduced-motion:reduce/)
assert.match(landingNav, /aria-label="Inference Exchange home"/)
assert.match(landingNav, /passive: true/)

// The python and JS validators must agree: the same cases are in tests/test_oauth_return_path.py
console.log(`nav helpers: ${unsafe.length + safe.length} return-path cases ok`)
