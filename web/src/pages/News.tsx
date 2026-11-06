import { PublicPage } from '../components/PublicPage'
import { NewsList } from '../components/NewsList'
import '../components/landing-news.css'

export function News() {
  return (
    <PublicPage title="News">
      <NewsList />
    </PublicPage>
  )
}
