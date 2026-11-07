import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import vm from 'node:vm'
import { nodeFallbackExample, pythonFallbackExample } from './fallback-examples.js'

// Execute the displayed snippets with fake SDKs. No credentials or network calls.
const scenarios = [
  ['success', 200, null, 'open', 0, false],
  ['missing model', 503, 'model_not_available', 'open', 1, false],
  ['L0 alias', 503, 'model_not_available', ' L0 ', 1, false],
  ['higher minimum', 503, 'model_not_available', 'hardened', 0, true],
  ['wrong status', 401, 'model_not_available', 'open', 0, true],
  ['no provider', 503, 'no_provider_available', 'open', 0, true],
  ['trust mismatch', 503, 'no_compatible_provider', 'open', 0, true],
  ['timeout', 0, null, 'open', 0, true],
  ['interrupted stream', 200, null, 'open', 0, true],
]

for (const stream of [false, true]) {
  for (const [name, status, code, minimum, expectedCalls, expectedError] of scenarios) {
    if (name === 'interrupted stream' && !stream) continue
    const calls = []
    class APIError extends Error {
      constructor() { super(name); this.status = status; this.code = code }
    }
    class OpenAI {
      static APIError = APIError
      constructor(options) {
        this.chat = { completions: { create: async request => {
          calls.push({ options, request })
          if (options.apiKey === 'ie-secret') {
            if (status === 0) throw new Error('timeout')
            if (status !== 200) throw new APIError()
          }
          if (stream) return (async function* () {
            yield { choices: [{ delta: { content: 'hello' } }] }
            if (name === 'interrupted stream') throw new Error('stream disconnected')
          })()
          return { choices: [{ message: { content: 'hello' } }] }
        } } }
      }
    }
    const source = nodeFallbackExample(stream, [])
      .replace('import OpenAI from "openai";', '')
      .replace('const minimum = "open";', `const minimum = ${JSON.stringify(minimum)};`)
    const context = vm.createContext({ OpenAI, console: { log() {} }, process: {
      env: { IE_API_KEY: 'ie-secret', OPENROUTER_API_KEY: 'or-secret', IE_MODEL: 'requested' },
      stdout: { write() {} },
    } })
    let failed = false
    try { await vm.runInContext(`(async () => { ${source} })()`, context) } catch { failed = true }
    assert.equal(failed, expectedError, `Node ${stream} ${name}`)
    assert.equal(calls.length, 1 + expectedCalls, `Node calls ${name}`)
    assert.equal(calls[0].options.apiKey, 'ie-secret')
    assert.equal(calls[0].request.model, 'requested')
    assert.equal(calls[0].request.stream, stream)
    if (expectedCalls) {
      assert.equal(calls[1].options.baseURL, 'https://openrouter.ai/api/v1')
      assert.equal(calls[1].options.apiKey, 'or-secret')
      assert.equal(calls[1].request.model, 'openrouter/free')
      assert.equal(calls[1].request.ocip_min_confidence, undefined)
      assert.equal(calls[1].request.stream, stream)
    }
    const pythonSource = pythonFallbackExample(stream, [])
      .replace('minimum = "open"', `minimum = ${JSON.stringify(minimum)}`)
    const harness = `
import os, sys, types, json
from types import SimpleNamespace as NS
source, status, code, name, expected_calls, expected_error = json.loads(sys.stdin.read())
os.environ.update(IE_API_KEY="ie-secret", OPENROUTER_API_KEY="or-secret", IE_MODEL="requested")
calls = []
class APIStatusError(Exception):
    def __init__(self):
        self.status_code, self.code = status, code
class OpenAI:
    def __init__(self, **options):
        def create(**request):
            calls.append((options, request))
            if options["api_key"] == "ie-secret":
                if status == 0: raise TimeoutError()
                if status != 200: raise APIStatusError()
            if request["stream"]:
                def chunks():
                    yield NS(choices=[NS(delta=NS(content="hello"))])
                    if name == "interrupted stream": raise ConnectionError()
                return chunks()
            return NS(choices=[NS(message=NS(content="hello"))])
        self.chat = NS(completions=NS(create=create))
sys.modules["openai"] = NS(OpenAI=OpenAI, APIStatusError=APIStatusError)
failed = False
try: exec(source)
except Exception: failed = True
assert failed == expected_error, (name, failed)
assert len(calls) == 1 + expected_calls, (name, calls)
assert calls[0][0]["api_key"] == "ie-secret"
assert calls[0][1]["model"] == "requested"
if expected_calls:
    options, request = calls[1]
    assert options["base_url"] == "https://openrouter.ai/api/v1"
    assert options["api_key"] == "or-secret"
    assert request["model"] == "openrouter/free"
    assert "extra_body" not in request
    assert request["stream"] == calls[0][1]["stream"]
`
    const result = spawnSync('python3', ['-c', harness], {
      input: JSON.stringify([pythonSource, status, code, name, expectedCalls, expectedError]),
      encoding: 'utf8',
    })
    assert.equal(result.status, 0, `Python ${stream} ${name}: ${result.stderr}`)
  }
}
console.log('Python and Node fallback snippets passed success, error, trust, and streaming checks')
