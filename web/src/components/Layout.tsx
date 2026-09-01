import { Link, Outlet, useLocation } from 'react-router-dom'
import { useCoordinatorStatus } from '../lib/useWebSocket'

const NAV = [
  { path: '/', label: 'Home' },
  { path: '/exchange', label: 'Exchange' },
  { path: '/chat', label: 'Chat' },
  { path: '/models', label: 'Models' },
  { path: '/providers', label: 'Providers' },
  { path: '/billing', label: 'Billing' },
  { path: '/keys', label: 'API Keys' },
  { path: '/admin', label: 'Admin' },
]

export function Layout() {
  const location = useLocation()
  const coordinatorOnline = useCoordinatorStatus()

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-lg font-bold">
            <span className="text-purple-600">⚡</span> Inference Exchange
          </Link>
          {coordinatorOnline !== null && (
            <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full ${
              coordinatorOnline
                ? 'bg-green-100 text-green-700'
                : 'bg-red-100 text-red-700'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${
                coordinatorOnline ? 'bg-green-500' : 'bg-red-500'
              }`} />
              {coordinatorOnline ? 'Connected' : 'Disconnected'}
            </span>
          )}
        </div>
        <nav className="flex gap-1">
          {NAV.map(({ path, label }) => (
            <Link
              key={path}
              to={path}
              className={`px-3 py-1.5 rounded-md text-sm ${
                location.pathname === path
                  ? 'bg-purple-50 text-purple-700 font-medium'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="max-w-7xl mx-auto px-6 py-6">
        <Outlet />
      </main>
    </div>
  )
}
