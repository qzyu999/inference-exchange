// Shared model-search semantics, independent of data source or React DOM.
import assert from 'node:assert/strict'
import { searchModelItems } from './model-search.js'
const models = [
  { key: 'qwen', name: 'Qwen2.5 0.5B Instruct', group: 'Qwen', subtitle: '1 provider online', keywords: 'open-weight 0.5B' },
  { key: 'gpt-foo', name: 'GPT Foo', group: 'OpenAI', subtitle: 'reference-only', keywords: 'proprietary' },
  { key: 'llama', name: 'Llama 3.3 70B', group: 'Meta', subtitle: '2 providers', keywords: 'open-weight' },
]
assert.deepEqual(searchModelItems(models, ''), models)
assert.deepEqual(searchModelItems(models, 'QWEN instruct'), [models[0]])
assert.deepEqual(searchModelItems(models, 'open-weight'), [models[0],models[2]])
assert.deepEqual(searchModelItems(models, 'REFERENCE-only'), [models[1]])
assert.deepEqual(searchModelItems(models, 'meta 70B'), [models[2]])
assert.deepEqual(searchModelItems(models, 'not-found'), [])
assert.equal(searchModelItems(Array.from({length: 300}, (_,i)=>({key:String(i),name:'Model '+i})), '299').length,1)

import { isModelSearchDisabled } from './model-search.js'
assert.equal(isModelSearchDisabled({ resultCount: 0 }), true, 'Chat stays disabled without runnable models')
assert.equal(isModelSearchDisabled({ resultCount: 0, hasFilters: true }), false, 'Exchange can reopen empty filtered list')
assert.equal(isModelSearchDisabled({ resultCount: 0, hasFilters: true, loading: true }), true, 'loading state still wins')
assert.equal(isModelSearchDisabled({ resultCount: 0, hasFilters: true, disabled: true }), true, 'explicit disable still wins')
assert.equal(isModelSearchDisabled({ resultCount: 1 }), false, 'normal search stays open')
console.log('shared model search tests passed')
