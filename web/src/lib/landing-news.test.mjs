import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const landing = read('../pages/Landing.tsx')
const section = read('../components/LandingNews.tsx')
const news = read('../pages/News.tsx')
// Keep updates outside the pinned story, including the reduced-motion fallback.
assert.ok(landing.lastIndexOf('<LandingNews />') > landing.indexOf('STORY_CHAPTERS.slice(0, -1).map'))
assert.match(section, /aria-labelledby="latest-news-heading"/)
assert.match(section, /to="\/news"/)
for (const source of [section, news]) assert.match(source, /<NewsEmptyState(?: headingLevel=\{3\})? \/>/)
console.log('Landing news: post-story placement, news route and shared empty state passed')
