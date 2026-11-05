import { Link } from 'react-router-dom'

export function NotFound() {
  return (
    <div className="max-w-md mx-auto mt-20 text-center">
      <div className="text-6xl font-bold text-ui-muted mb-4">404</div>
      <h1 className="text-xl font-bold text-ui-text mb-2">Page not found</h1>
      <p className="text-sm text-ui-muted mb-6">The page you're looking for doesn't exist.</p>
      <Link to="/" className="px-4 py-2 bg-ui-action text-ui-on-action rounded-xl text-sm font-medium hover:bg-ui-action-hover">
        Back to home
      </Link>
    </div>
  )
}
