import { Link } from 'react-router-dom'
import { NewsList } from './NewsList'
import './landing-news.css'

export function LandingNews() {
  return (
    <section className="ie-landing-news" aria-labelledby="latest-news-heading">
      <div className="ie-landing-news-inner">
        <div className="ie-landing-news-header">
          <h2 id="latest-news-heading">Latest news</h2>
          <Link to="/news">View all news <span aria-hidden="true">↗</span></Link>
        </div>
        <NewsList limit={3} headingLevel={3} />
      </div>
    </section>
  )
}
