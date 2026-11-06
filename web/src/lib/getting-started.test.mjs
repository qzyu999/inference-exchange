import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JOURNEYS, feedbackHref, resolveStartJourney, sdkExample } from './getting-started.js'
import { PROVIDER_COMMANDS } from './provider-start-commands.js'
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const page = read('../pages/GettingStarted.tsx')
const shell = read('../components/Layout.tsx')
const routes = read('../main.tsx')
assert.deepEqual(JOURNEYS.map(item => [item.id, item.name]), [['api', 'Use the API'], ['provider', 'Provide compute']])
assert.equal(resolveStartJourney('consumer'), 'api')
assert.equal(resolveStartJourney('both'), '')
assert.equal(resolveStartJourney('api'), 'api')
assert.equal(resolveStartJourney('provider'), 'provider')
assert.equal(resolveStartJourney('missing'), 'missing')
for (const journey of JOURNEYS) {
  assert.equal(new Set(journey.steps.map(step => step.id)).size, journey.steps.length)
  for (const step of journey.steps) {
    for (const field of ['title', 'description', 'help']) assert.ok(step[field]?.trim())
    assert.ok(step.description.length < 190, 'keep each instruction short')
    if (step.to) assert.ok(['/login', '/keys', '/provide', '/dashboard'].includes(step.to))
    const report = new URL(feedbackHref(journey, step))
    assert.equal(report.origin, 'https://github.com')
    assert.equal(report.pathname, '/qzyu999/inference-exchange/issues/new')
    assert.ok(report.searchParams.get('body').includes('Step ID: ' + step.id))
    assert.match(report.searchParams.get('body'), /Do not share API keys, provider tokens/)
  }
}
// Keep provider commands tied to the already-reviewed preview, including the
// pinned agent version and verified model download. No new installer recipe.
const guide = read('../../../docs/guides/provider-l0-apple-silicon-preview.md')
const blocks = [...guide.matchAll(/```bash\n([\s\S]*?)```/g)].map(match => match[1].trim())
for (const [name, index] of [['hardware', 0], ['server', 1], ['model', 2], ['agent', 3]]) assert.equal(PROVIDER_COMMANDS[name], blocks[index])
assert.equal(PROVIDER_COMMANDS.connect, blocks[4] + '\n' + blocks[5])
assert.match(PROVIDER_COMMANDS.model, /shasum -a 256 -c -/)
assert.match(PROVIDER_COMMANDS.connect, /getpass/)
assert.doesNotMatch(PROVIDER_COMMANDS.connect, /\?token=|--token/)
// Model IDs stay quoted as data; no credential is embedded in an example.
for (const model of ['Qwen2.5 0.5B Instruct', 'a"b\nc']) {
  const code = sdkExample(model)
  assert.ok(code.includes('model=' + JSON.stringify(model)))
  assert.match(code, /os.environ\["IE_API_KEY"\]/)
  assert.match(code, /"ocip_min_confidence": "open"/)
  assert.doesNotMatch(code, /sk-ie-|pt-ie-/)
}
assert.match(page, /allowOpen && model/)
assert.match(page, /The coordinator and provider can read/)
assert.match(page, /models\?\.data.find/)
assert.match(page, /\['myKeys', user.user_id\]/)
assert.match(page, /\['dashboard\/provider-nodes', user.user_id\]/)
assert.doesNotMatch(page, /localStorage|createUserKey|enrollSelfServiceProvider|\/v1\/admin/)
assert.match(page, /You marked your first request complete/)
assert.match(page, /Need help\?/)
assert.match(page, /read -rs IE_API_KEY/)
assert.match(page, /Windows CMD/)
assert.match(shell, /pathname.startsWith\('\/start\/'\)/)
assert.match(routes, /path="\/start\/:journey"/)
console.log('Getting Started: two paths, aliases, scoped checks, explicit Open consent, examples and versioned commands passed')
