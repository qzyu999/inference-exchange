// #191: Real Chat model IDs and aliases, loading, and searching.
import assert from 'node:assert/strict'
import { normalizeOnlineModels, searchOnlineModels, isRunnableChatModel } from './chat-models.js'

assert.deepEqual(normalizeOnlineModels(undefined), [])
assert.deepEqual(normalizeOnlineModels([]), [])
assert.deepEqual(normalizeOnlineModels(['default', ' default ', '', '  ', 4, null]), [])
assert.deepEqual(normalizeOnlineModels(['Qwen2.5 0.5B Instruct', 'default', 'Qwen2.5 0.5B Instruct']), ['Qwen2.5 0.5B Instruct'])

const many = normalizeOnlineModels([
  'Llama 3.3 70B', 'Qwen2.5 0.5B Instruct', 'Qwen2.5 7B Instruct',
  'DeepSeek R1', 'Mistral 7B'
])
assert.equal(many.length, 5)
assert.deepEqual(searchOnlineModels(many, ''), many)
assert.deepEqual(searchOnlineModels(many, ' qWeN   instruct '), ['Qwen2.5 0.5B Instruct', 'Qwen2.5 7B Instruct'])
assert.deepEqual(searchOnlineModels(many, '70B'), ['Llama 3.3 70B'])
assert.deepEqual(searchOnlineModels(many, 'not-connected'), [])
assert.ok(isRunnableChatModel('Qwen2.5 0.5B Instruct', many))
assert.equal(isRunnableChatModel('default', many), false)
assert.equal(isRunnableChatModel('', many), false)
assert.equal(isRunnableChatModel('Old model from ?model=', many), false)
assert.equal(isRunnableChatModel('Reference-only Claude', many), false)

const scale = Array.from({ length: 200 }, (_, i) => 'Provider model ' + i)
assert.equal(normalizeOnlineModels(scale).length, 200)
assert.equal(searchOnlineModels(scale, 'model 199').length, 1)
console.log('#191 real online-model filtering and validation passed')
