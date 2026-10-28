import assert from 'node:assert/strict'
import { createUserKey } from './key-creation.js'

const key = 'sk-ie-created-on-server'
assert.equal(await createUserKey(async name => {
  assert.equal(name, 'macmini-sdk')
  return { api_key: key }
}, 'macmini-sdk'), key)

await assert.rejects(
  createUserKey(async () => { throw new Error('HTTP 401') }, 'test'),
  /HTTP 401/
)
await assert.rejects(
  createUserKey(async () => ({ api_key: '' }), 'test'),
  /Server did not return/
)
await assert.rejects(
  createUserKey(async () => ({ api_key: 'sk-ie-cached-from-another-account!' }), 'test'),
  /Server did not return/
)
await assert.rejects(
  createUserKey(async () => ({ api_key: 'default-key' }), 'test'),
  /Server did not return/
)
console.log('Key creation contract: only successful server-issued keys are accepted')
