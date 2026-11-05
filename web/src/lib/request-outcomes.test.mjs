import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { requestOutcome } from './request-outcomes.js'

assert.equal(requestOutcome('completed').group, 'completed')
for (const status of ['matched', 'matched_from_queue']) {
  assert.equal(requestOutcome(status).group, 'routed')
  assert.match(requestOutcome(status).label, /completion unconfirmed/)
}
for (const status of ['no_compatible_provider', 'no_provider_available', 'model_not_available', 'queue_full', 'queue_timeout']) {
  assert.equal(requestOutcome(status).group, 'rejected')
}
for (const status of [null, undefined, '', 'new_status', 'toString', '__proto__']) {
  assert.equal(requestOutcome(status).group, 'other')
}
// The coordinator returns newest first. Guard both consumers against showing
// the oldest entries or treating a provider match as a completed response.
const overview = readFileSync(new URL('../pages/Overview.tsx', import.meta.url), 'utf8')
const trace = readFileSync(new URL('../pages/Trace.tsx', import.meta.url), 'utf8')
assert.match(overview, /const recentTraces = traces\.slice\(0, 10\)/)
assert.doesNotMatch(overview, /traces\]\.reverse\(\)/)
assert.match(trace, /: traces\[0\] \|\| null/)
assert.doesNotMatch(trace, /traces\[traces\.length - 1\]|traces\]\.reverse\(\)/)
assert.match(trace, /const isCompleted = trace\.status === 'completed'/)
assert.match(overview, /t\.reason/)
assert.match(trace, /trace\.reason/)
assert.match(trace, /trace\.selected_provider && <div/)
console.log('Request outcomes: newest-first history, rejection reasons, and completion evidence passed')
