/** Shared until the first news post is published. */
export function NewsEmptyState({ headingLevel = 2 }: { headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3'
  return (
    <div className="ie-news-empty">
      <Heading>No news posts yet.</Heading>
      <p>Releases and updates will appear here.</p>
    </div>
  )
}
