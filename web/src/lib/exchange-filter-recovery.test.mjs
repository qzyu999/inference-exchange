// Empty search must leave the controls available for recovery.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const source = readFileSync(new URL('../pages/Exchange.tsx', import.meta.url), 'utf8')
assert.match(source, /function clearFilters\(\)/)
assert.match(source, /setIeOnly\(false\)/)
assert.match(source, /onClick=\{clearFilters\}/)
assert.match(source, /No models match these filters/)
assert.match(source, /Available on Inference Exchange/)
assert.match(source, /aria-pressed=\{ieOnly\}/)
console.log('Exchange empty filter recovery passed')
