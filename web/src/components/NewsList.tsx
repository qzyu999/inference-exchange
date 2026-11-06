import { Link } from 'react-router-dom'
import { NEWS_POSTS } from '../lib/news-content'
import { formatNewsDate } from '../lib/news.js'
import { NewsEmptyState } from './NewsEmptyState'
import './landing-news.css'

export function NewsList({ limit, headingLevel = 2 }: { limit?: number; headingLevel?: 2 | 3 }) {
  const posts = limit === undefined ? NEWS_POSTS : NEWS_POSTS.slice(0, limit)
  const Heading = headingLevel === 2 ? 'h2' : 'h3'
  if (!posts.length) return <NewsEmptyState headingLevel={headingLevel} />
  return (
    <ul className="ie-news-list">
      {posts.map(post => (
        <li key={post.slug}>
          <article className="ie-news-card">
            <time dateTime={post.date}>{formatNewsDate(post.date)}</time>
            <Heading><Link to={`/news/${post.slug}`}>{post.title}</Link></Heading>
            <p>{post.summary}</p>
          </article>
        </li>
      ))}
    </ul>
  )
}
