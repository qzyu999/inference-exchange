// Run: node web/src/lib/nav.test.mjs  (#107, AUTH-018)
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { LANDING_LINKS, authState, githubLoginHref, loginHref, safeNextPath } from './nav.js'

// Open-redirect cases must fall back
const unsafe = [
  undefined, null, '', 'chat', 'https://evil.example/x', '//evil.example', '/\\evil.example',
  '\\\\evil', 'javascript:alert(1)', '/ok\nSet-Cookie:x', '/v1/admin/controls', '/ws/provider',
  '/login', '/' + 'a'.repeat(600),
]
for (const v of unsafe) assert.equal(safeNextPath(v), '/chat', `unsafe: ${JSON.stringify(v)}`)

const safe = ['/chat', '/keys', '/billing', '/trace?id=abc123', '/docs/requirements/auth', '/admin']
for (const v of safe) assert.equal(safeNextPath(v), v, `safe: ${v}`)

assert.equal(loginHref('/keys'), '/login?next=%2Fkeys')
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
for (const want of ['/chat', '/exchange', '/models', '/providers', '/docs']) {
  assert.ok(LANDING_LINKS.some(l => l.to === want), `landing nav missing ${want}`)
}

// The python and JS validators must agree: the same cases are in tests/test_oauth_return_path.py
console.log(`nav helpers: ${unsafe.length + safe.length} return-path cases ok`)
