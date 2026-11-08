export function formatRate(value) {
  if (value == null) return 'Not published'
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return 'Not published'
  return n === 0 ? 'Free' : '$' + n.toLocaleString('en-US', { maximumFractionDigits: 8 })
}
export function savingsLabel(a, b) {
  if (a == null || b == null) return 'Not comparable'
  const x = Number(a), y = Number(b)
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) return 'Not comparable'
  if (x === y) return 'Same price'
  if (y === 0) return 'External offer is free'
  const p = Math.round((y - x) * 100 / y)
  return Math.abs(p) + '% ' + (p >= 0 ? 'lower' : 'higher')
}
export function eligible(ie, other) {
  return Boolean(ie && other && !other.stale && other.comparable &&
    ie.quantization && other.quantization &&
    ie.quantization.toLowerCase() === other.quantization.toLowerCase() &&
    ie.context_length > 0 && ie.context_length === other.context_length)
}
