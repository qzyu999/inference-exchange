import { PublicPage } from '../components/PublicPage'
import { NewsEmptyState } from '../components/NewsEmptyState'
import '../components/landing-news.css'

export function News() {
  return (
    <PublicPage title="News">
      <NewsEmptyState />
    </PublicPage>
  )
}
