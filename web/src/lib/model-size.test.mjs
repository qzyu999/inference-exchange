// Run: node web/src/lib/model-size.test.mjs  (#277)
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseParams, paramsLabel } from './model-size.js'

const cases = [
  // Catalog display names and IDs
  ['Meta: Llama 3.2 1B Instruct', 1],
  ['meta-llama/llama-3.2-1b-instruct', 1],
  ['LiquidAI: LFM3-1.7B', 1.7],
  ['Google: Gemma 3 4B', 4],
  ['mistralai/ministral-3b-2512', 3],
  ['Qwen2.5 0.5B Instruct', 0.5],
  ['LiquidAI: LFM2.5-24B-A2B', 24],          // total, not active
  ['Qwen: Qwen3 VL 235B A22B Instruct', 235],
  ['Mistral: Mixtral 8x22B Instruct', 176],  // experts x size
  ['AionLabs: Aion-RP 1.0 (8B)', 8],
  // No stated size
  ['OpenAI: GPT-4o (2024-05-13)', null],
  ['Anthropic: Claude Haiku 4.5', null],
  ['Llama 3 4bit', null],
  ['Z.ai: GLM 5V Turbo', null],
  ['', null],
]
for (const [name, want] of cases) assert.equal(parseParams(name), want, name)

// The display name wins; the ID is the fallback.
assert.equal(parseParams('Venice: Uncensored', 'cognitivecomputations/dolphin-mistral-24b-venice-edition'), 24)
assert.equal(paramsLabel('LiquidAI: LFM3-1.7B'), '1.7B')
assert.equal(paramsLabel('Claude'), null)

// Source contract: reference and catalog models get a size from the name (#277).
const exchange = readFileSync(new URL('../pages/Exchange.tsx', import.meta.url), 'utf8')
assert.match(exchange, /paramsLabel\(f\.display_name, f\.family_key\)/)
assert.match(exchange, /parseParams\(m\.params\)/)

console.log(`model size: ${cases.length} cases + source contract ok`)
