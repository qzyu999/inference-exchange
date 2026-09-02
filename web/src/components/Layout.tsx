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
    <div className="min-h-screen bg-[#fafafa]">
      <header className="bg-white/80 backdrop-blur-xl border-b border-gray-200/60 px-6 py-3 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight text-gray-900">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
                <span className="text-white text-sm font-bold">IE</span>
              </div>
              Inference Exchange
            </Link>
            {coordinatorOnline !== null && (
              <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium ${
                coordinatorOnline
                  ? 'bg-emerald-50 text-emerald-600'
                  : 'bg-red-50 text-red-500'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${
                  coordinatorOnline ? 'bg-emerald-500' : 'bg-red-400'
                }`} />
                {coordinatorOnline ? 'Live' : 'Offline'}
              </span>
            )}
          </div>
          <nav className="flex gap-0.5">
            {NAV.map(({ path, label }) => (
              <Link
                key={path}
                to={path}
                className={`px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${
                  location.pathname === path
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-6 py-8">
        <Outlet />
      </main>
    </div>
  )
}
