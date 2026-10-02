/**
 * Docs bundled from ../docs at build time, so /docs always matches the deployed commit.
 * Each page is lazy-loaded; nothing is fetched until the page is opened.
 */

const loaders = import.meta.glob('../../../docs/**/*.md', { query: '?raw', import: 'default' }) as Record<
  string,
  () => Promise<string>
>

const PREFIX = '../../../docs/'

/** "requirements/auth.md" -> "requirements/auth"; "requirements/README.md" -> "requirements" */
export function slugFor(file: string): string {
  const s = file.replace(/\.md$/, '')
  if (s === 'README') return ''
  return s.endsWith('/README') ? s.slice(0, -'/README'.length) : s
}

const bySlug: Record<string, () => Promise<string>> = {}
for (const [path, load] of Object.entries(loaders)) {
  const file = path.slice(PREFIX.length)
  if (file.startsWith('figma-screens/')) continue
  bySlug[slugFor(file)] = load
}

export function loadDoc(slug: string): Promise<string> | null {
  const load = bySlug[slug]
  return load ? load() : null
}

export function hasDoc(slug: string): boolean {
  return slug in bySlug
}

/** Resolve a relative markdown link inside the doc at `fromSlug` to an app route, or null if external. */
export function resolveDocLink(href: string, fromSlug: string, fromIsIndex: boolean): string | null {
  if (/^[a-z]+:/i.test(href) || href.startsWith('#') || href.startsWith('/')) return null
  const [pathPart, hash] = href.split('#')
  if (!pathPart.endsWith('.md')) return null
  // Directory of the current file: index pages live "inside" their slug
  const base = fromIsIndex ? fromSlug : fromSlug.split('/').slice(0, -1).join('/')
  const parts = base ? base.split('/') : []
  for (const seg of pathPart.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg !== '.' && seg !== '') parts.push(seg)
  }
  const slug = slugFor(parts.join('/'))
  return `/docs${slug ? '/' + slug : ''}${hash ? '#' + hash : ''}`
}

export function isIndexSlug(slug: string): boolean {
  return bySlug[slug] !== undefined && loaders[`${PREFIX}${slug ? slug + '/' : ''}README.md`] !== undefined
}

export interface NavItem {
  slug: string
  label: string
}

export interface NavSection {
  title: string
  items: NavItem[]
}

export const DOC_NAV: NavSection[] = [
  {
    title: 'Start',
    items: [
      { slug: '', label: 'Overview' },
      { slug: 'principles', label: 'Principles' },
      { slug: 'architecture', label: 'Architecture' },
      { slug: 'status', label: 'Status' },
    ],
  },
  {
    title: 'Requirements',
    items: [
      { slug: 'requirements', label: 'How requirements work' },
      { slug: 'requirements/auth', label: 'Auth' },
      { slug: 'requirements/privacy', label: 'Privacy' },
      { slug: 'requirements/billing', label: 'Billing' },
      { slug: 'requirements/routing', label: 'Routing' },
      { slug: 'requirements/providers', label: 'Providers' },
      { slug: 'requirements/ops', label: 'Operations' },
    ],
  },
  {
    title: 'Guides',
    items: [{ slug: 'guides/getting-started', label: 'Getting started' }],
  },
  {
    title: 'Decisions',
    items: [{ slug: 'decisions', label: 'All decisions' }],
  },
  {
    title: 'Security',
    items: [
      { slug: 'security/threat-model', label: 'Threat model' },
      { slug: 'security/protocol', label: 'Protocol' },
    ],
  },
  {
    title: 'Reference',
    items: [{ slug: 'archive', label: 'Archive (not normative)' }],
  },
]
