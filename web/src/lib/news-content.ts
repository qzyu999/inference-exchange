import { collectNewsPosts } from './news.js'

// Bundled at build time. No database or publishing service is required.
const files = import.meta.glob('../../content/news/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
export const NEWS_POSTS = collectNewsPosts(files)
