// Run: node src/lib/admin-controls.test.mjs (#135)
// Exercise HTTP methods, cookie-authenticated requests, redaction and failure handling.
import assert from 'node:assert/strict'
import {
  loadOperatorControls, updateOperatorControls, clearOperatorQueue,
  quarantineProvider, releaseProvider,
} from './admin-controls.js'

const original = globalThis.fetch
const calls = []
const ok = payload => ({ ok: true, status: 200, json: async () => payload })

try {
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return ok({ ok: true, status: 'confirmed' })
  }
  await loadOperatorControls()
  await updateOperatorControls({ inference_paused: true })
  await updateOperatorControls({ signup_disabled: true, max_concurrent_per_account: 2 })
  await clearOperatorQueue()
  await quarantineProvider('provider/1', 'test quarantine')
  await releaseProvider('provider/1')

  assert.equal(calls.length, 6)
  assert.ok(calls.every(x => x.options.credentials === 'include'))
  assert.deepEqual(calls.map(x => x.options.method),
    ['GET', 'POST', 'POST', 'POST', 'POST', 'POST'])
  assert.equal(calls[0].url, '/v1/admin/controls')
  assert.equal(calls[3].url, '/v1/admin/queue/clear')
  assert.equal(calls[4].url, '/v1/admin/providers/provider%2F1/quarantine')
  assert.equal(calls[5].url, '/v1/admin/providers/provider%2F1/release')
  assert.deepEqual(JSON.parse(calls[1].options.body), { inference_paused: true })
  assert.deepEqual(JSON.parse(calls[4].options.body), { reason: 'test quarantine' })

  globalThis.fetch = async () => ({
    ok: false, status: 403, json: async () => ({ error: 'Admin access required' }),
  })
  await assert.rejects(loadOperatorControls(), /HTTP 403: Admin access required/)
  await assert.rejects(updateOperatorControls({ signup_disabled: false }), /HTTP 403/)

  globalThis.fetch = async () => ({
    ok: false, status: 502, json: async () => { throw new Error('HTML page with potentially sensitive details') },
  })
  await assert.rejects(clearOperatorQueue(), err => {
    assert.equal(err.message, 'HTTP 502')
    return true
  })
  console.log('admin controls API: happy/error paths and credential handling passed')
} finally {
  globalThis.fetch = original
}
