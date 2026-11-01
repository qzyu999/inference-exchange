// #171 — the private provider dashboard must be discoverable for signed-in users.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { canShowProviderDashboard } from './role-nav.js'

for (const user of [null, undefined, {}, { is_admin: true }, { user_id: '' }, { user_id: 123 }]) {
  assert.equal(canShowProviderDashboard(user), false, 'missing authenticated user')
}
assert.equal(canShowProviderDashboard({ user_id: 'user-abc', is_admin: false }), true)
assert.equal(canShowProviderDashboard({ user_id: 'user-def', is_admin: true }), true)

const layout = readFileSync(new URL('../components/Layout.tsx', import.meta.url), 'utf8')
const routes = readFileSync(new URL('../main.tsx', import.meta.url), 'utf8')
const dashboard = readFileSync(new URL('../pages/ProviderDashboard.tsx', import.meta.url), 'utf8')
const provide = readFileSync(new URL('../pages/Provide.tsx', import.meta.url), 'utf8')

const primary = layout.split('const PRIMARY_NAV = [')[1]?.split('\n]')[0] ?? ''
const account = layout.split('const ACCOUNT_NAV = [')[1]?.split('\n]')[0] ?? ''
assert.match(primary, /path: '\/providers', label: 'Providers'/)
assert.match(primary, /path: '\/provide', label: 'Offer Compute'/)
assert.match(account, /path: '\/dashboard', label: 'Provider Dashboard'/)
assert.match(account, /path: '\/billing', label: 'Billing'/)
assert.doesNotMatch(primary, /path: '\/dashboard'/)
assert.match(layout, /ACCOUNT_NAV\.filter\(item => item\.path !== '\/dashboard' \|\| canShowProviderDashboard\(user\)\)/)
assert.match(layout, /\{sidebarContent\}/g) // one menu for mobile and desktop
assert.match(layout, /active=\{location\.pathname === item\.path/)
assert.match(routes, /path="\/dashboard" element=\{<ProviderDashboard \/>\}/)
assert.match(provide, /to="\/dashboard"/)
assert.match(dashboard, /loginHref\('\/dashboard'\)/)
assert.match(dashboard, /No provider nodes belong to this account/)
assert.match(dashboard, /to="\/provide"/)
assert.match(dashboard, /user \? \['dashboard\/provider-nodes', user\.user_id\] : null/)
assert.match(dashboard, /user \? \['dashboard\/provider-earnings', user\.user_id\] : null/)
assert.doesNotMatch(dashboard, /\/v1\/admin\//)
console.log('#171 provider dashboard navigation, guest and owner states passed')
