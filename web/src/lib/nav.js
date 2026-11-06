// Landing navigation and safe sign-in return paths (#107, AUTH-018).
// Plain JS (with nav.d.ts) so `node src/lib/nav.test.mjs` can test it.

import { canShowAdminConsole, canShowProviderDashboard } from './role-nav.js'

const LANDING_GROUPS = [
  { id: 'use-ai', label: 'Use AI', side: 'left', items: [
    { to: '/chat', label: 'Chat' },
    { to: '/models', label: 'Models' },
    { to: '/exchange', label: 'Exchange' },
  ] },
  { id: 'provide', label: 'Provide compute', side: 'left', items: [
    { to: '/provide', label: 'Become a provider' },
    { to: '/dashboard', label: 'Provider dashboard', signedInOnly: true },
  ] },
  { id: 'network', label: 'Network', side: 'right', items: [
    { to: '/overview', label: 'Overview' },
    { to: '/providers', label: 'Providers' },
  ] },
  { id: 'resources', label: 'Resources', side: 'right', items: [
    { to: '/start', label: 'Getting Started' },
    { to: '/docs', label: 'Documentation' },
    { to: '/news', label: 'News', dividerBefore: true },
    { to: '/about', label: 'About Us' },
  ] },
]

export function getLandingGroups(user) {
  return LANDING_GROUPS.map(group => ({ ...group,
    items: group.items.filter(item => !item.signedInOnly || canShowProviderDashboard(user)),
  }))
}

export const LANDING_LINKS = getLandingGroups(null).flatMap(group => group.items)

export function getLandingAccountLinks(user) {
  if (!user?.user_id) return []
  return [
    { to: '/keys', label: 'API keys' },
    { to: '/billing', label: 'Account & billing' },
    { to: '/settings', label: 'Settings' },
    ...(canShowProviderDashboard(user) ? [{ to: '/dashboard', label: 'Provider dashboard' }] : []),
    ...(canShowAdminConsole(user) ? [{ to: '/admin', label: 'Admin Console' }] : []),
  ]
}

/** Same rules as oauth_github.safe_next_path: a same-origin app path or the fallback. */
export function safeNextPath(value, fallback = '/chat') {
  if (typeof value !== 'string' || !value || value.length > 512) return fallback
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i)
    if (c < 0x20 || c === 0x7f) return fallback
  }
  const path = value.split('?')[0]
  if (path.startsWith('/v1/') || path.startsWith('/ws/') || path === '/login') return fallback
  return value
}

/** The /login URL that returns the visitor to `from` after sign-in. */
export function loginHref(from) {
  const next = safeNextPath(from, '')
  return next ? `/login?next=${encodeURIComponent(next)}` : '/login'
}

/** The GitHub OAuth start URL, carrying a validated return path. */
export function githubLoginHref(next) {
  const safe = safeNextPath(next, '')
  return safe ? `/v1/auth/github/login?next=${encodeURIComponent(safe)}` : '/v1/auth/github/login'
}

/** One of 'loading' | 'signed-in' | 'signed-out', for the account area of the nav. */
export function authState(loading, user) {
  if (user) return 'signed-in'
  return loading ? 'loading' : 'signed-out'
}

/** Separate thresholds prevent flicker near the top of the page. */
export function nextBrandCompact(scrollY, compact) {
  if (!Number.isFinite(scrollY)) return compact
  if (scrollY > 80) return true
  if (scrollY < 24) return false
  return compact
}

/** Keep setup destinations through sign-in; exchange discovery stays public. */
export function landingActionHref(destination, signedIn) {
  return !signedIn && (destination === '/keys' || destination === '/provide')
    ? loginHref(destination)
    : destination
}
