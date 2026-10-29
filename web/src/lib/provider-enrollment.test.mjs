// PROV-018 / PRIV-009: exercise live HTTP client success and error paths.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  SELF_SERVICE_PROFILE,
  enrollSelfServiceProvider,
  listSelfServiceCredentials,
  revokeSelfServiceCredential,
} from './provider-enrollment.js'

const originalFetch = globalThis.fetch
const calls = []
const token = 'pt-ie-TEST-ONE-TIME-ONLY'
const respond = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
})

try {
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    if (url === '/v1/provider/nodes') {
      assert.equal(options.method, 'POST')
      assert.deepEqual(JSON.parse(options.body), {
        name: 'mac-mini', profile: SELF_SERVICE_PROFILE,
      })
      return respond({
        node: { node_id: 'node-a', name: 'mac-mini', status: 'offline', profile: SELF_SERVICE_PROFILE },
        credential: { token_id: 'ptok-id', token },
        simulated_credits: true,
      }, 201)
    }
    if (url === '/v1/provider/credentials' && options.method === undefined) {
      return respond({ credentials: [{ token_id: 'ptok-id', node_id: 'node-a', revoked_at: null }] })
    }
    if (url === '/v1/provider/credentials/ptok-id' && options.method === 'DELETE') {
      return respond({ ok: true, token_id: 'ptok-id', disconnected: ['provider-1'] })
    }
    throw new Error('Unexpected endpoint ' + url)
  }
  const issued = await enrollSelfServiceProvider('mac-mini')
  assert.equal(issued.credential.token, token)
  assert.equal((await listSelfServiceCredentials()).credentials[0].token_id, 'ptok-id')
  assert.deepEqual((await revokeSelfServiceCredential('ptok-id')).disconnected, ['provider-1'])
  assert.equal(calls.length, 3)
  for (const { url, options } of calls) {
    assert.equal(options.credentials, 'include')
    assert.equal(options.cache, 'no-store')
    assert.ok(!url.includes(token), 'raw secret must not appear in URL')
    assert.ok(!options.headers?.Authorization, 'never use a consumer/provider key as session')
  }
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json')

  const denied = [
    [503, 'Provider enrollment is not enabled'],
    [409, 'Active self-service provider node limit reached'],
    [429, 'Daily provider enrollment limit reached'],
    [403, 'A linked GitHub identity is required'],
    [400, 'Invalid provider name'],
  ]
  for (const [status, message] of denied) {
    globalThis.fetch = async () => respond({ error: message }, status)
    await assert.rejects(enrollSelfServiceProvider('mac-mini'), error => {
      assert.equal(error.status, status)
      assert.match(error.message, new RegExp('HTTP ' + status))
      assert.ok(!error.message.includes(token))
      return true
    })
  }
  globalThis.fetch = async () => new Response('<html>CF upstream failure / secret</html>', { status: 502, headers: { 'Content-Type': 'text/html' } })
  await assert.rejects(enrollSelfServiceProvider('mac-mini'), error => {
    assert.match(error.message, /^HTTP 502:/)
    assert.doesNotMatch(error.message, /html|secret|CF upstream/i)
    return true
  })
} finally {
  globalThis.fetch = originalFetch
}

const ui = readFileSync(new URL('../pages/Provide.tsx', import.meta.url), 'utf8')
const api = readFileSync(new URL('./provider-enrollment.js', import.meta.url), 'utf8')
assert.match(ui, /<EnrollmentWizard key=\{user\.user_id\} userId=\{user\.user_id\}/)
assert.match(ui, /\['provide\/credentials', userId\]/)
assert.match(ui, /\['provide\/nodes', userId\]/)
assert.match(ui, /loginHref\('\/provide'\)/)
assert.match(ui, /navigator\.clipboard\.writeText\(issued\.credential\.token\)/)
assert.match(ui, /savedSecret/)
assert.match(ui, /revokeConfirm/)
assert.match(ui, /role="alert"/)
assert.match(ui, /503/)
assert.match(ui, /409/)
assert.match(ui, /429/)
assert.match(ui, /self-reported/)
assert.doesNotMatch(ui, /\/v1\/admin\//)
assert.doesNotMatch(api + ui, /localStorage|sessionStorage|console\.log|window\.location|\?token=/)
console.log('PROV-018: owner-only wizard HTTP, failure paths and one-time secret lifecycle checked')
