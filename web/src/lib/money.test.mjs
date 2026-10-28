// Run: node web/src/lib/money.test.mjs  (BILL-009, #122)
import assert from 'node:assert/strict'
import { formatUsd, formatUsdPrecise, sumMicro, microToUsd } from './money.js'

const cases = [
  [0, '$0.00'],
  [0.000001, '$0.000001'],
  [0.0001, '$0.000100'],
  [0.004999, '$0.004999'],
  [0.005, '$0.005000'],
  [0.009999, '$0.009999'],
  [0.01, '$0.01'],
  [1, '$1.00'],
  [10, '$10.00'],
  [9.9999, '$10.00'],
  [-0.0001, '-$0.000100'],
  [null, '$0.00'],
  [undefined, '$0.00'],
]
for (const [input, want] of cases) assert.equal(formatUsd(input), want, `formatUsd(${input})`)

// A nonzero amount never renders as $0.00
for (let micro = 1; micro < 20_000; micro += 37) {
  assert.notEqual(formatUsd(micro / 1e6), '$0.00', `micro=${micro}`)
}

assert.equal(formatUsdPrecise(9.9999), '$9.999900')
assert.equal(formatUsdPrecise(0), '$0.000000')

// Accumulated microcharges: 37 minimum charges sum exactly, without float drift
const tx = Array.from({ length: 37 }, () => ({ cost_micro: 100, cost_usd: 0.0001 }))
assert.equal(sumMicro(tx), 3700)
assert.equal(formatUsd(microToUsd(sumMicro(tx))), '$0.003700')
// Old payloads without cost_micro fall back to cost_usd
assert.equal(sumMicro([{ cost_usd: 0.1 }, { cost_usd: 0.2 }]), 300_000)
// Balance reconciles: $10 - 37 x $0.0001
assert.equal(formatUsdPrecise(microToUsd(10_000_000 - sumMicro(tx))), '$9.996300')

console.log(`money formatter: ${cases.length} cases + sweeps ok`)
