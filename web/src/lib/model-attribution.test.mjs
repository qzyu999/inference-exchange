import assert from 'node:assert/strict'
import { requestedModelLabel, servedModelLabel } from './model-attribution.js'

assert.equal(requestedModelLabel({model:'default'}), 'default')
assert.equal(servedModelLabel({model:'default'}), 'Auto-routed · served model not recorded')
assert.equal(servedModelLabel({model:'qwen'}), 'Served model not recorded')
assert.equal(servedModelLabel({model:'default', requested_model:'default', served_model:'qwen'}), 'qwen')
assert.equal(servedModelLabel({model:'qwen', requested_model:'qwen', served_model:'qwen'}), 'qwen')
assert.equal(servedModelLabel({model:'default', served_model:''}), 'Auto-routed · served model not recorded')
console.log('model attribution display tests passed')
