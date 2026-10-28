// Shared currency formatting for billing surfaces (BILL-009, #122).
// Plain JS (with money.d.ts) so `node src/lib/money.test.mjs` can test it without a runner.

const MICRO = 1_000_000

/**
 * Format a USD amount so that a nonzero value never looks like $0.00.
 * - exactly zero -> "$0.00"
 * - |v| >= $0.01 -> two decimals ("$10.00", "$1.23")
 * - smaller      -> six decimals ("$0.000100", "$0.004999")
 * Inputs are rounded to whole micro-USD first, the unit that the coordinator stores.
 */
export function formatUsd(value) {
  const micro = Math.round((Number(value) || 0) * MICRO)
  if (micro === 0) return '$0.00'
  const sign = micro < 0 ? '-' : ''
  const abs = Math.abs(micro)
  const digits = abs >= 10_000 ? 2 : 6
  return `${sign}$${(abs / MICRO).toFixed(digits)}`
}

/** Full micro-USD precision, for hover titles and reconciliation. */
export function formatUsdPrecise(value) {
  const micro = Math.round((Number(value) || 0) * MICRO)
  const sign = micro < 0 ? '-' : ''
  return `${sign}$${(Math.abs(micro) / MICRO).toFixed(6)}`
}

/** Sum amounts in integer micro-USD. Prefers exact *_micro fields when present. */
export function sumMicro(items, microKey = 'cost_micro', usdKey = 'cost_usd') {
  let total = 0
  for (const item of items || []) {
    const micro = item?.[microKey]
    total += Number.isInteger(micro) ? micro : Math.round((Number(item?.[usdKey]) || 0) * MICRO)
  }
  return total
}

export function microToUsd(micro) {
  return (Number(micro) || 0) / MICRO
}
