// Run: node web/src/lib/price.test.mjs  (BILL-013)
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { formatPrice, priceKey } from './price.js'

const cases = [
  [0, '$0.00'],
  [0.05, '$0.05'],
  [0.15, '$0.15'],
  [0.0015, '$0.0015'],      // smallest live catalog price; was "$0.00" in the DOM
  [0.000001, '$0.000001'],  // smallest legal step
  [0.0833333333333333, '$0.083333'],
  [0.1, '$0.10'],
  [3, '$3.00'],
  [300, '$300.00'],
  [1e-7, '<$0.000001'],
  ['0.0050000000', '$0.005'],
  [null, '—'],
  [undefined, '—'],
  [NaN, '—'],
]
for (const [input, want] of cases) assert.equal(formatPrice(input), want, `formatPrice(${input})`)

// Every nonzero 6-decimal price is shown exactly and never as $0.00.
for (let units = 1; units < 200_000; units += 7) {
  const shown = formatPrice(units / 1e6)
  assert.notEqual(shown, '$0.00', `units=${units}`)
  assert.equal(Math.round(Number(shown.slice(1)) * 1e6), units, `units=${units} shown=${shown}`)
}

assert.equal(priceKey(0.0015), priceKey('0.0015000'))
assert.notEqual(priceKey(0.0015), priceKey(0.0016))

// Source contract: price displays use formatPrice, not a fixed 2-decimal format.
const pages = new URL('../pages/', import.meta.url)
for (const file of readdirSync(pages).filter(f => f.endsWith('.tsx'))) {
  const src = readFileSync(new URL(file, pages), 'utf8')
  assert.doesNotMatch(src, /price[\w]*\)?\??\.toFixed\(/i, `${file} formats a price with toFixed`)
}

console.log(`price formatter: ${cases.length} cases + sweep + source contract ok`)
