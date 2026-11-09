// Parameter count from a model name or ID, for the Exchange size filter (#277).
// Plain JS (with model-size.d.ts) so `node src/lib/model-size.test.mjs` can test it without a runner.

// "8x22B" (mixture of experts): total = experts x size.
const EXPERTS = /(?<![\w.])(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*b(?![a-z0-9])/i
// "1B", "1.7B", "llama-3.2-1b-instruct". Not "a2b" (active parameters), "4bit", or "gpt-4b2".
const SIZE = /(?<![\w.])(\d+(?:\.\d+)?)\s*b(?![a-z0-9])/i

/** Size in billions of parameters, or null when the name does not state it. */
export function parseParams(...names) {
  for (const raw of names) {
    if (!raw) continue
    const text = String(raw).replace(/[/_:]/g, ' ')
    const moe = text.match(EXPERTS)
    if (moe) return Number(moe[1]) * Number(moe[2])
    const m = text.match(SIZE)
    if (m) return Number(m[1])
  }
  return null
}

/** Display label for a parameter count, for example 1.7 -> "1.7B". */
export function paramsLabel(...names) {
  const n = parseParams(...names)
  return n == null ? null : `${Number(n.toFixed(2))}B`
}
