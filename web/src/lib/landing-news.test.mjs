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
assert.match(section, /<NewsList limit=\{3\} headingLevel=\{3\} \/>/)
assert.match(news, /<NewsList \/>/)
const list = read('../components/NewsList.tsx')
assert.match(list, /<NewsEmptyState headingLevel=\{headingLevel\} \/>/)
assert.match(read('../main.tsx'), /path="\/news\/:slug"/)
assert.match(read('../components/Layout.tsx'), /location\.pathname\.startsWith\('\/news\/'\)/)
assert.match(read('../pages/NewsPost.tsx'), /skipHtml/)
assert.match(read('../pages/NewsPost.tsx'), /Post not found/)
console.log('Landing news: post-story placement, news route and shared empty state passed')
