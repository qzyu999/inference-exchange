import { Link, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { PublicPage } from '../components/PublicPage'
import { NEWS_POSTS } from '../lib/news-content'
import { formatNewsDate } from '../lib/news.js'
import '../components/landing-news.css'

export function NewsPost() {
  const { slug } = useParams()
  const post = NEWS_POSTS.find(item => item.slug === slug)
  if (!post) return (
    <PublicPage title="Post not found">
      <p>This news post is not available.</p>
      <Link to="/news">Back to news</Link>
    </PublicPage>
  )
  return (
    <PublicPage title={post.title}>
      <article className="ie-news-post">
        <time dateTime={post.date}>{formatNewsDate(post.date)}</time>
        <p className="ie-news-summary">{post.summary}</p>
        <div className="ie-news-body">
          <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{post.body}</ReactMarkdown>
        </div>
      </article>
      <Link className="ie-news-back" to="/news">← All news</Link>
    </PublicPage>
  )
}
