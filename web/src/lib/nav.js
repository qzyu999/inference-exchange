// Landing navigation and safe sign-in return paths (#107, AUTH-018).
// Plain JS (with nav.d.ts) so `node src/lib/nav.test.mjs` can test it.

export const LANDING_LINKS = [
  { to: '/start', label: 'Getting Started' },
  { to: '/chat', label: 'Chat' },
  { to: '/exchange', label: 'Exchange' },
  { to: '/models', label: 'Models' },
  { to: '/providers', label: 'Providers' },
  { to: '/provide', label: 'Offer Compute' },
  { to: '/docs', label: 'Docs' },
]

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
