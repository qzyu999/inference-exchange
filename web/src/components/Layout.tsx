import { useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { useCoordinatorStatus } from '../lib/useWebSocket'
import { useAuth } from '../lib/auth'
import { ErrorBoundary } from './ErrorBoundary'

const NAV = [
  { path: '/', label: 'Home' },
  { path: '/exchange', label: 'Exchange' },
  { path: '/chat', label: 'Chat' },
  { path: '/models', label: 'Models' },
  { path: '/providers', label: 'Providers' },
  { path: '/billing', label: 'Billing' },
  { path: '/keys', label: 'API Keys' },
]

export function Layout() {
  const location = useLocation()
  const coordinatorOnline = useCoordinatorStatus()
  const { user, logout } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="min-h-screen bg-[#fafafa]">
      <header className="bg-white/80 backdrop-blur-xl border-b border-gray-200/60 px-4 md:px-6 py-3 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight text-gray-900">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
                <span className="text-white text-sm font-bold">IE</span>
              </div>
              <span className="hidden sm:inline">Inference Exchange</span>
            </Link>
            {coordinatorOnline !== null && (
              <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium ${
                coordinatorOnline ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${coordinatorOnline ? 'bg-emerald-500' : 'bg-red-400'}`} />
                {coordinatorOnline ? 'Live' : 'Offline'}
              </span>
            )}
          </div>

          {/* Desktop nav */}
          <div className="hidden lg:flex items-center gap-2">
            <nav className="flex gap-0.5 mr-3">
              {NAV.map(({ path, label }) => (
                <Link key={path} to={path}
                  className={`px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${
                    location.pathname === path ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
                  }`}>{label}</Link>
              ))}
            </nav>
            {user ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">{user.email}</span>
                <span className="text-xs font-medium text-emerald-600">${user.balance_usd.toFixed(2)}</span>
                <button onClick={logout} className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded-lg hover:bg-gray-100">Sign out</button>
              </div>
            ) : (
              <Link to="/login" className="px-3 py-1.5 bg-gray-900 text-white rounded-lg text-[13px] font-medium hover:bg-gray-800">Sign in</Link>
            )}
          </div>

          {/* Mobile hamburger */}
          <button onClick={() => setMobileOpen(!mobileOpen)} className="lg:hidden p-2 rounded-lg hover:bg-gray-100">
            <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              {mobileOpen
                ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              }
            </svg>
          </button>
        </div>

        {/* Mobile nav dropdown */}
        {mobileOpen && (
          <div className="lg:hidden mt-3 pb-3 border-t border-gray-100 pt-3">
            <nav className="flex flex-col gap-1">
              {NAV.map(({ path, label }) => (
                <Link key={path} to={path} onClick={() => setMobileOpen(false)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium ${
                    location.pathname === path ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'
                  }`}>{label}</Link>
              ))}
            </nav>
            <div className="mt-3 pt-3 border-t border-gray-100">
              {user ? (
                <div className="flex items-center justify-between px-3">
                  <span className="text-sm text-gray-500">{user.email}</span>
                  <button onClick={() => { logout(); setMobileOpen(false) }} className="text-sm text-gray-400">Sign out</button>
                </div>
              ) : (
                <Link to="/login" onClick={() => setMobileOpen(false)} className="block px-3 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium text-center">Sign in</Link>
              )}
            </div>
          </div>
        )}
      </header>
      <main className="max-w-7xl mx-auto px-4 md:px-6 py-6 md:py-8">
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  )
}
