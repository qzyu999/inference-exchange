import { PublicPage } from '../components/PublicPage'

export function News() {
  return (
    <PublicPage title="News">
      <div className="ie-public-page-empty">
        <h2>No news posts yet.</h2>
        <p>Releases and updates will appear here.</p>
      </div>
    </PublicPage>
  )
}
