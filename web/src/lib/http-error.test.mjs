// Run: node src/lib/http-error.test.mjs (#142)
// Verify that origin failures never display a Cloudflare HTML document.
import assert from 'node:assert/strict'
import { describeHttpFailure } from './http-error.js'
import { loadAdminState, loadOperatorControls } from './admin-controls.js'

const html = '<!DOCTYPE html><html><body>Cloudflare Ray ID: example; Your IP: hidden</body></html>'
const upstream = new Response(html, { status: 502, headers: { 'Content-Type': 'text/html' } })
const message = await describeHttpFailure(upstream)
assert.match(message, /^HTTP 502:/)
assert.doesNotMatch(message, /DOCTYPE|Cloudflare Ray ID|Your IP|html/i)

const denied = new Response(JSON.stringify({ error: 'Admin access required' }), {
  status: 403, headers: { 'Content-Type': 'application/json' },
})
assert.equal(await describeHttpFailure(denied), 'HTTP 403: Admin access required')

const dangerous = new Response(JSON.stringify({ error: '<html>internal stack or secret</html>' }), {
  status: 500, headers: { 'Content-Type': 'application/json' },
})
assert.equal(await describeHttpFailure(dangerous), 'HTTP 500: Request failed.')

const invalid = new Response('not json', {
  status: 401, headers: { 'Content-Type': 'application/json' },
})
assert.equal(await describeHttpFailure(invalid), 'HTTP 401: Request failed.')

const original = globalThis.fetch
try {
  const attempts = []
  globalThis.fetch = async (url, options) => {
    attempts.push({ url, options })
    return new Response(html, { status: 502, headers: { 'Content-Type': 'text/html' } })
  }
  for (const fn of [loadAdminState, loadOperatorControls]) {
    await assert.rejects(fn(), error => {
      assert.match(error.message, /^HTTP 502:/)
      assert.doesNotMatch(error.message, /DOCTYPE|Cloudflare Ray ID|Your IP/i)
      return true
    })
  }
  assert.deepEqual(attempts.map(x => x.url), ['/v1/admin/state', '/v1/admin/controls'])
  assert.ok(attempts.every(x => x.options.credentials === 'include'))

  // A successful retry must recover without requiring a browser reload.
  globalThis.fetch = async () => new Response(JSON.stringify({ providers: [{ provider_id: 'p1' }] }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
  const recovered = await loadAdminState()
  assert.equal(recovered.providers[0].provider_id, 'p1')
} finally {
  globalThis.fetch = original
}
console.log('admin 502 HTML sanitization, permission failure and retry recovery passed')
