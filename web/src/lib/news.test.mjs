import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { collectNewsPosts, parseNewsPost, formatNewsDate } from './news.js'
const post = (date, extra = '') => `---\ntitle: A post\ndate: ${date}\nsummary: A short summary\n${extra}---\nHello **world**.`
assert.equal(parseNewsPost('one.md', post('2026-11-05')).body, 'Hello **world**.')
assert.equal(formatNewsDate('2026-11-05'), 'November 5, 2026')
assert.deepEqual(collectNewsPosts({ 'old.md': post('2026-01-01'), 'new.md': post('2026-11-05'), 'draft.md': post('2026-11-06', 'draft: true\n') }).map(p => p.slug), ['new', 'old'])
assert.deepEqual(collectNewsPosts({ 'b.md': post('2026-11-05'), 'a.md': post('2026-11-05') }).map(p => p.slug), ['a', 'b'])
assert.deepEqual(collectNewsPosts({}), [])
assert.throws(() => collectNewsPosts({ 'a/same.md': post('2026-11-05'), 'b/same.md': post('2026-11-05') }), /Duplicate/)
for (const date of ['2026-02-30', '2026-13-01', '2026-1-01', 'bad']) assert.throws(() => parseNewsPost('bad.md', post(date)))
for (const source of [post('2026-11-05').replace('title: A post\n', ''), post('2026-11-05', 'draft: yes\n'), post('2026-11-05', 'title: Duplicate\n'), 'No metadata', post('2026-11-05').replace('Hello **world**.', '')]) assert.throws(() => parseNewsPost('bad.md', source))
assert.throws(() => parseNewsPost('Bad Name.md', post('2026-11-05')))
assert.equal(parseNewsPost('quoted.md', post('2026-11-05').replace('title: A post', 'title: "A post: an update"')).title, 'A post: an update')
// Validate the real content in every production build.
const directory = new URL('../../content/news/', import.meta.url)
const files = Object.fromEntries((existsSync(directory) ? readdirSync(directory) : []).filter(name => name.endsWith('.md')).map(name => [name, readFileSync(new URL(name, directory), 'utf8')]))
const published = collectNewsPosts(files)
console.log(`News: metadata, dates, sorting, drafts and ${published.length} published post(s) passed`)
