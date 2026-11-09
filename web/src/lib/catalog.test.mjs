import assert from 'node:assert/strict'
import { savingsLabel, formatRate, eligible, catalogFamilies, identityLabel } from './catalog.js'
assert.equal(formatRate('0'), 'Free')
assert.equal(formatRate(null), 'Not published')
assert.equal(savingsLabel('0.05','0.20'), '75% lower')
assert.equal(savingsLabel('0.01','0.05'), '80% lower')
assert.equal(savingsLabel('0.15','0.60'), '75% lower')
assert.equal(savingsLabel('0.6','0.5'), '20% higher')
assert.equal(savingsLabel('0','0'), 'Same price')
assert.equal(savingsLabel('1','0'), 'External offer is free')
assert.equal(savingsLabel(null,'1'), 'Not comparable')
assert.equal(eligible({quantization:'Q4_K_M',context_length:4096},{quantization:'FP16',context_length:4096,comparable:true}),false)
assert.equal(eligible({quantization:'FP16',context_length:4096},{quantization:'FP16',context_length:4096,comparable:true,stale:true}),false)
assert.equal(eligible({quantization:'FP16',context_length:4096},{quantization:'FP16',context_length:4096,comparable:true}),true)
// Two exact catalog identities must remain distinct even with an old parser collision.
const p1 = { id: 'p1', name: 'Local 2.5', original_model: 'Qwen2.5 7B Instruct' }
const p2 = { id: 'p2', name: 'Local 3', original_model: 'Qwen3 7B Instruct' }
const market = [{ canonical_id: 'qwen-7b-instruct', providers: [p1, p2] }]
const families = catalogFamilies([
  { id: 'qwen/v2.5', name: 'Qwen 2.5', offers: [{ ie: true, id: 'ie/p1/Qwen2.5 7B Instruct', provider: p1.name }] },
  { id: 'qwen/v3', name: 'Qwen 3', offers: [{ ie: true, id: 'ie/p2/Qwen3 7B Instruct', provider: p2.name }] },
  { id: 'ie/Qwen2.5 0.5B Instruct', name: 'Qwen2.5 0.5B Instruct', offers: [] },
], market)
assert.deepEqual(families.map(f => f.family_key), ['qwen/v2.5', 'qwen/v3', 'ie/Qwen2.5 0.5B Instruct'])
assert.deepEqual(families[0].ieProviders.map(p => p.id), [p1.id])
assert.deepEqual(families[1].ieProviders.map(p => p.id), [p2.id])
assert.equal(families[2].prices.length, 0)
const liveWithoutMarket = catalogFamilies([
  { id: 'ie/Local', name: 'Local', offers: [{ ie: true, id: 'ie/p3/Local', provider: 'Local provider', output: '0.1' }] },
], [])
assert.equal(liveWithoutMarket[0].ieProviders[0].name, 'Local provider')
assert.equal(liveWithoutMarket[0].provider_count, 1)
const provenance = catalogFamilies([{
  id: 'meta-llama/llama-3.2-1b-instruct', name: 'Llama 3.2 1B Instruct',
  offers: [{
    id: 'openrouter/llama/cloudflare', provider: 'Cloudflare', route: 'OpenRouter',
    quantization: 'FP16', context_length: 4096, input: '0', cache_read: null, output: '0.1',
    source_url: 'https://openrouter.ai/meta-llama/llama-3.2-1b-instruct',
    source_type: 'api', observed_at: 100, stale: true,
  }],
}], [])[0].prices[0]
assert.deepEqual(provenance.publishedRates, { input: '0', cache: null, output: '0.1' })
assert.equal(provenance.display_name, 'via OpenRouter · stale')
assert.equal(provenance.quantization, 'FP16')
assert.equal(provenance.observed_at, 100)
assert.equal(provenance.source_type, 'api')
assert.match(provenance.source_url, /^https:\/\/openrouter.ai\//)
assert.equal(identityLabel('provider_repository', 'reported'), 'Reported by provider · repository')
assert.equal(identityLabel('reviewed_alias', 'reviewed'), 'Reviewed alias')
console.log('Catalog savings tests passed')
