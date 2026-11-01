// #186: checked source-level first-tester UI contract. This is not live browser evidence.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const chat = read('../pages/Chat.tsx')
const keys = read('../pages/Keys.tsx')
const overview = read('../pages/Overview.tsx')
const provide = read('../pages/Provide.tsx')
const nav = read('../components/Layout.tsx')

assert.match(chat, /const \[minTrust, setMinTrust\] = useState\('hardened'\)/)
assert.match(chat, /onClick=\{\(\) => setMinTrust\('open'\)\}/)
assert.match(chat, /ocip_min_confidence: minTrust/)
assert.match(chat, /streaming \|\| trustMismatch/)
assert.match(chat, /aria-expanded=\{showSidebar\}/)
assert.match(chat, /id="chat-advanced-settings"/)
assert.match(chat, /ocip_preference: 'balanced'/)
assert.match(chat, /body\.ocip_max_price = parseFloat\(maxPrice\)/)
assert.doesNotMatch(chat, /maxInputPrice|maxCachePrice|OpenRouter available|PREFERENCES|Most Secure/)
assert.match(chat, /coordinator and provider can read prompts and responses/i)

assert.match(keys, /https:\/\/alpha\.inferenceex\.com\/v1/)
assert.match(keys, /ocip_min_confidence/)
assert.match(keys, /SDK_NONSTREAM/)
assert.match(keys, /SDK_STREAM/)
assert.match(keys, /Copy Python code/)
assert.doesNotMatch(keys, /curl \/v1\/chat\/completions/)

assert.doesNotMatch(overview, /Math\.random|v0\.1\.0|'verified' : 'unavailable'/)
assert.match(overview, /Recent routed traces/)
assert.match(overview, /Provider-reported trust levels/)
assert.match(provide, /Private-alpha availability/)
assert.match(provide, /Provider enrollment is disabled by default/)
assert.match(nav, /path: '\/provide', label: 'Offer Compute'/)
console.log('#186 alpha UI truthfulness contract passed')
