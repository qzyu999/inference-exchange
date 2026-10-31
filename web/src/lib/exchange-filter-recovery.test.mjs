// Regression #194: Exchange filters may give zero hits, without trapping the menu.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const exchange = read('../pages/Exchange.tsx')
const picker = read('../components/ModelSearch.tsx')
assert.match(exchange, /function clearFilters\(\)/)
for (const reset of [
  'setFilterOpen(null)', 'setFilterCache(false)', 'setFilterBenchmarked(false)',
  'setFilterSize(null)', 'setFilterPriceCap(null)', 'setFilterFamily(null)',
]) assert.ok(exchange.includes(reset), 'Missing reset: ' + reset)
assert.match(exchange, /onClick=\{clearFilters\}/)
assert.match(exchange, /selectedName=\{activeUnified\?\.name\}/)
assert.match(picker, /hasFilters: Boolean\(filters\)/)
assert.match(picker, /Selected model hidden by filters/)
assert.match(picker, /Change or clear the filters above/)
console.log('#194 Exchange filter empty-result recovery contract passed')
