// Shared $/Mtok price formatting (BILL-013).
// Plain JS (with price.d.ts) so `node src/lib/price.test.mjs` can test it without a runner.

/** Prices have at most 6 decimal places: $0.000001/Mtok is the smallest step. */
export const PRICE_DECIMALS = 6
const SCALE = 10 ** PRICE_DECIMALS

/**
 * Format a USD-per-million-token price.
 * - Show at least 2 decimals and at most 6. Do not show trailing zeros after 2 decimals.
 *   0.05 -> "$0.05", 0.0015 -> "$0.0015", 0.083333 -> "$0.083333", 3 -> "$3.00"
 * - Exactly zero -> "$0.00". A nonzero price never looks like "$0.00".
 * - A nonzero price below $0.000001 -> "<$0.000001".
 * - Missing or invalid -> "—".
 */
export function formatPrice(value) {
  if (value == null || value === '') return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  const sign = n < 0 ? '-' : ''
  const units = Math.round(Math.abs(n) * SCALE)
  if (units === 0) return n === 0 ? '$0.00' : sign + '<$0.000001'
  const [whole, frac = ''] = (units / SCALE).toFixed(PRICE_DECIMALS).replace(/0+$/, '').split('.')
  return `${sign}$${whole}.${frac.padEnd(2, '0')}`
}

/** Stable key for grouping equal prices at full precision. */
export function priceKey(value) {
  return String(Math.round((Number(value) || 0) * SCALE))
}
