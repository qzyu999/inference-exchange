// Run: node web/src/lib/docs.test.mjs
// Mirrors resolveDocLink/slugFor in docs.ts (kept dependency-free; no test runner in web/).
import assert from 'node:assert/strict'

function slugFor(file) {
  const s = file.replace(/\.md$/, '')
  if (s === 'README') return ''
  return s.endsWith('/README') ? s.slice(0, -'/README'.length) : s
}

function resolveDocLink(href, fromSlug, fromIsIndex) {
  if (/^[a-z]+:/i.test(href) || href.startsWith('#') || href.startsWith('/')) return null
  const [pathPart, hash] = href.split('#')
  if (!pathPart.endsWith('.md')) return null
  const base = fromIsIndex ? fromSlug : fromSlug.split('/').slice(0, -1).join('/')
  const parts = base ? base.split('/') : []
  for (const seg of pathPart.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg !== '.' && seg !== '') parts.push(seg)
  }
  const slug = slugFor(parts.join('/'))
  return `/docs${slug ? '/' + slug : ''}${hash ? '#' + hash : ''}`
}

const cases = [
  ['principles.md', '', true, '/docs/principles'],
  ['requirements/README.md', '', true, '/docs/requirements'],
  ['auth.md', 'requirements', true, '/docs/requirements/auth'],
  ['../principles.md', 'requirements', true, '/docs/principles'],
  ['requirements/README.md', 'architecture', false, '/docs/requirements'],
  ['decisions/0004-single-vm-sqlite.md', 'status', false, '/docs/decisions/0004-single-vm-sqlite'],
  ['../principles.md', 'decisions/0001-github-oauth', false, '/docs/principles'],
  ['0001-github-oauth.md', 'decisions', true, '/docs/decisions/0001-github-oauth'],
  ['../architecture.md', 'security/pcc-comparison', false, '/docs/architecture'],
  ['https://example.com', '', true, null],
  ['#anchor', '', true, null],
]

for (const [href, from, idx, want] of cases) {
  assert.equal(resolveDocLink(href, from, idx), want, `${href} from ${from}`)
}
console.log(`docs link resolver: ${cases.length} cases ok`)
