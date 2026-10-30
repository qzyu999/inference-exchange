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
console.log('shared model search tests passed')
