// PRIV-009 / BILL-011: the provider dashboard displays real private data.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const dashboard = readFileSync(new URL('../pages/ProviderDashboard.tsx', import.meta.url), 'utf8')
const provide = readFileSync(new URL('../pages/Provide.tsx', import.meta.url), 'utf8')
const routes = readFileSync(new URL('../main.tsx', import.meta.url), 'utf8')
const api = readFileSync(new URL('./api.ts', import.meta.url), 'utf8')

assert.match(routes, /<Route path="\/dashboard" element=\{<ProviderDashboard \/>\} \/>/)
assert.doesNotMatch(routes, /import\.meta\.env\.DEV && <Route path="\/dashboard"/)
assert.match(provide, /to="\/dashboard"/)
assert.match(dashboard, /loginHref\('\/dashboard'\)/)
assert.match(dashboard, /user \? \['dashboard\/provider-nodes', user\.user_id\] : null/)
assert.match(dashboard, /user \? \['dashboard\/provider-earnings', user\.user_id\] : null/)
assert.match(dashboard, /api\.ownedProviderNodes/)
assert.match(dashboard, /api\.ownedProviderEarnings/)
assert.match(dashboard, /formatUsdPrecise\(microToUsd\(/)
assert.match(dashboard, /summary\?\.reconciled/)
assert.match(dashboard, /role="alert"/)
assert.match(dashboard, /No provider nodes belong to this account/)
assert.match(dashboard, /Not verified/)
assert.match(dashboard, /simulated credits/i)
assert.doesNotMatch(dashboard, /adminState|\/v1\/admin\/|useSWR\('admin/)
assert.doesNotMatch(dashboard, /\$2\.10|99\.2%|500 requests|Fresh|Published hash|Qwen 3\.5|2nd cheapest/)
assert.doesNotMatch(dashboard, /pt-ie-|token_hash|localStorage/)
assert.match(api, /ownedProviderNodes: \(\) => get/)
assert.match(api, /ownedProviderEarnings: \(\) => get/)
console.log('PRIV-009 / BILL-011: live provider dashboard contract passed')
