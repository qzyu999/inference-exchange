// AUTH-019: user Settings and operator-only navigation/guard contract.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { canShowAdminConsole } from './role-nav.js'

assert.equal(canShowAdminConsole(null), false)
assert.equal(canShowAdminConsole(undefined), false)
assert.equal(canShowAdminConsole({}), false)
assert.equal(canShowAdminConsole({ name: 'Admin', email: 'admin@example.com' }), false)
assert.equal(canShowAdminConsole({ is_admin: 'true' }), false)
assert.equal(canShowAdminConsole({ is_admin: false }), false)
assert.equal(canShowAdminConsole({ is_admin: true }), true)

const layout = readFileSync(new URL('../components/Layout.tsx', import.meta.url), 'utf8')
const routes = readFileSync(new URL('../main.tsx', import.meta.url), 'utf8')
const admin = readFileSync(new URL('../pages/Admin.tsx', import.meta.url), 'utf8')
const settings = readFileSync(new URL('../pages/Settings.tsx', import.meta.url), 'utf8')
const auth = readFileSync(new URL('./auth.tsx', import.meta.url), 'utf8')

// ACCOUNT_NAV is shared by desktop and mobile. It must not contain admin.
const accountNav = layout.split('const ACCOUNT_NAV = [')[1]?.split('\n]')[0] ?? ''
assert.match(accountNav, /path: '\/settings', label: 'Settings'/)
assert.doesNotMatch(accountNav, /\/admin/)
assert.match(layout, /canShowAdminConsole\(user\) &&/)
assert.match(layout, /path="\/admin" label="Admin Console"/)
assert.match(layout, /reloadDocument=\{path === '\/admin'\}/)
assert.match(layout, /\{sidebarContent\}/g) // desktop and mobile use the same nav

assert.match(routes, /path="\/settings" element=\{<Settings \/>\}/)
assert.match(routes, /path="\/admin" element=\{<Admin \/>\}/)
assert.match(admin, /if \(!canShowAdminConsole\(user\)\)/)
assert.match(admin, /return <AdminConsoleContent \/>/)
assert.match(admin, /function AdminConsoleContent\(\)/)
assert.ok(admin.indexOf('function AdminConsoleContent()') < admin.indexOf("useSWR('adminState'"))
assert.match(auth, /is_admin: data\.is_admin === true/)

assert.match(settings, /loginHref\('\/settings'\)/)
assert.match(settings, /\['settings\/provider-nodes', user\.user_id\]/)
assert.match(settings, /\['settings\/provider-earnings', user\.user_id\]/)
assert.doesNotMatch(settings, /\/v1\/admin\//)
assert.doesNotMatch(settings, /AdminConsoleContent/)
console.log('AUTH-019: settings, admin navigation and render guards passed')
