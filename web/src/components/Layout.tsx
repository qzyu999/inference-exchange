import { useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { useCoordinatorStatus, useWebSocket } from '../lib/useWebSocket'
import { useAuth } from '../lib/auth'
import { C, TRUST_COLORS, GRADIENTS } from '../lib/theme'
import { ErrorBoundary } from './ErrorBoundary'
import { MineralAurora, NetworkHeartbeat, useNetworkPulses } from './MineralAurora'

// Trust colors re-exported for convenience (used by child pages)
export { TRUST_COLORS }

const PRIMARY_NAV = [
  { path: '/overview', label: 'Overview', icon: OverviewIcon },
  { path: '/chat', label: 'Chat', icon: ChatIcon },
  { path: '/exchange', label: 'Exchange', icon: ExchangeIcon },
  { path: '/models', label: 'Models', icon: ModelsIcon },
  { path: '/providers', label: 'Providers', icon: ProvidersIcon },
]

const ACCOUNT_NAV = [
  { path: '/billing', label: 'Billing', icon: BillingIcon },
  { path: '/keys', label: 'API keys', icon: KeysIcon },
  { path: '/docs', label: 'Docs', icon: DocsIcon },
  { path: '/admin', label: 'Settings', icon: SettingsIcon },
]

// ─── Icons (simple SVG, 18x18) ──────────────────────────────

function OverviewIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="5.5" height="5.5" rx="1" />
      <rect x="10.5" y="2" width="5.5" height="5.5" rx="1" />
      <rect x="2" y="10.5" width="5.5" height="5.5" rx="1" />
      <rect x="10.5" y="10.5" width="5.5" height="5.5" rx="1" />
    </svg>
  )
}

function ChatIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3.5h12a1 1 0 011 1v7a1 1 0 01-1 1H6l-3 2.5v-2.5a1 1 0 01-1-1v-7a1 1 0 011-1z" />
    </svg>
  )
}

function ExchangeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 13l4-4 3 3 7-8" />
      <path d="M10 4h6v6" />
    </svg>
  )
}

function ModelsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="12" height="12" rx="2" />
      <path d="M3 7h12M7 3v12" />
    </svg>
  )
}

function ProvidersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="9" r="2" />
      <circle cx="9" cy="3" r="1.5" />
      <circle cx="14" cy="13" r="1.5" />
      <circle cx="4" cy="13" r="1.5" />
      <path d="M9 5v2M10.7 10.3l2 1.5M7.3 10.3l-2 1.5" />
    </svg>
  )
}

function BillingIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="9" r="7" />
      <path d="M9 5v8M7 7h3.5a1.5 1.5 0 010 3H7h4a1.5 1.5 0 010 3H7" />
    </svg>
  )
}

function KeysIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11.5 2l4.5 4.5-7 7-4.5-4.5 7-7z" />
      <path d="M2 16l3-3" />
      <path d="M9 4.5l4.5 4.5" />
    </svg>
  )
}

function DocsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 2.5h7l3 3v10H4z" />
      <path d="M11 2.5v3h3M6.5 9h5M6.5 12h5" />
    </svg>
  )
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="9" r="2.5" />
      <path d="M9 1.5v2M9 14.5v2M1.5 9h2M14.5 9h2M3.1 3.1l1.4 1.4M13.5 13.5l1.4 1.4M3.1 14.9l1.4-1.4M13.5 4.5l1.4-1.4" />
    </svg>
  )
}

// ─── Sidebar Nav Item ────────────────────────────────────────

function NavItem({ path, label, icon: Icon, active }: {
  path: string; label: string; icon: React.FC<{ className?: string }>; active: boolean
}) {
  return (
    <Link
      to={path}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors ${active ? 'sidebar-active-bar' : ''}`}
      style={{
        background: active ? C.sidebarHover : 'transparent',
        color: active ? '#fff' : C.sidebarText,
      }}
    >
      <Icon className="shrink-0" />
      <span>{label}</span>
    </Link>
  )
}

// ─── Layout ──────────────────────────────────────────────────

export function Layout() {
  const location = useLocation()
  const coordinatorOnline = useCoordinatorStatus()
  const { user, logout } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)

  // Subscribe to live exchange events for reactive aurora
  const { events } = useWebSocket('/ws/events')
  const pulses = useNetworkPulses(events, performance.now() / 1000)

  // Landing page gets full-screen layout (no sidebar) — preserves scroll sequence
  if (location.pathname === '/') {
    return (
      <ErrorBoundary>
        <Outlet />
      </ErrorBoundary>
    )
  }

  if (location.pathname === '/login') {
    return (
      <div className="min-h-screen" style={{ background: `linear-gradient(180deg, #F8F8F5 0%, ${C.pageBg} 40%, #F3F2EE 100%)` }}>
        <div className="px-6 py-4">
          <Link to="/" className="text-sm font-semibold tracking-tight uppercase" style={{ color: C.gold }}>
            Inference Exchange
          </Link>
        </div>
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </div>
    )
  }

  const sidebarContent = (
    <>
      {/* Brand */}
      <div className="px-4 pt-5 pb-6" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
        <Link to="/" className="flex items-center gap-2.5">
          <img src="/logo-icon.svg" alt="IE" className="w-6 h-6" />
          <div>
            <div className="text-sm font-bold uppercase tracking-wider mineral-spectrum-text">
              Inference
            </div>
            <div className="text-[11px] uppercase tracking-wider" style={{ color: '#666' }}>
              Exchange
            </div>
          </div>
        </Link>
      </div>

      {/* Primary nav */}
      <nav className="px-3 space-y-0.5">
        {PRIMARY_NAV.map(item => (
          <NavItem
            key={item.path}
            {...item}
            active={location.pathname === item.path}
          />
        ))}
      </nav>

      {/* Mineral stratum vein separator */}
      <div className="px-4 mt-6 mb-3">
        <div className="h-[1px] rounded-full" style={{ background: GRADIENTS.mineralBar, opacity: 0.25 }} />
        <div className="text-[10px] uppercase tracking-wider mt-4 mb-2" style={{ color: '#555' }}>
          Account
        </div>
      </div>
      <nav className="px-3 space-y-0.5">
        {ACCOUNT_NAV.map(item => (
          <NavItem
            key={item.path}
            {...item}
            active={location.pathname === item.path || (item.path === '/docs' && location.pathname.startsWith('/docs'))}
          />
        ))}
      </nav>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Network status + user */}
      <div className="px-4 pb-5 space-y-3">
        {coordinatorOnline !== null && (
          <div className="flex items-center gap-2">
            <NetworkHeartbeat online={!!coordinatorOnline} eventCount={events.length} />
            <span className="text-xs" style={{ color: coordinatorOnline ? C.green : '#B7443B' }}>
              {coordinatorOnline ? 'Network online' : 'Network offline'}
            </span>
          </div>
        )}
        {user && (
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <div className="text-xs truncate" style={{ color: '#888' }}>{user.name || user.email}</div>
              <div className="text-[10px]" style={{ color: '#555' }}>
                {user.email !== user.name ? user.email.split('@')[0] : ''}
              </div>
            </div>
            <button
              onClick={logout}
              className="text-[10px] px-2 py-1 rounded-lg transition-colors"
              style={{ color: '#666' }}
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </>
  )

  return (
    <div className="flex min-h-screen" style={{ background: `linear-gradient(180deg, #F8F8F5 0%, ${C.pageBg} 40%, #F3F2EE 100%)` }}>
      {/* Desktop sidebar */}
      <aside
        className="hidden lg:flex flex-col w-52 shrink-0 sticky top-0 h-screen overflow-y-auto"
        style={{ background: GRADIENTS.sidebar }}
      >
        {sidebarContent}
      </aside>

      {/* Mobile hamburger + overlay */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 px-4 py-3 flex items-center justify-between"
        style={{ background: '#F8F8F5', borderBottom: '1px solid rgba(0,0,0,0.05)' }}
      >
        <Link to="/" className="text-sm font-bold uppercase tracking-wider" style={{ color: C.gold }}>
          IE
        </Link>
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="p-2 rounded-lg"
          style={{ color: C.pageText }}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            {mobileOpen
              ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            }
          </svg>
        </button>
      </div>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <>
          <div
            className="lg:hidden fixed inset-0 z-40 bg-black/40"
            onClick={() => setMobileOpen(false)}
          />
          <aside
            className="lg:hidden fixed top-0 left-0 bottom-0 z-50 w-56 flex flex-col overflow-y-auto"
            style={{ background: GRADIENTS.sidebar }}
            onClick={(e) => {
              // Close on nav link clicks
              if ((e.target as HTMLElement).closest('a')) setMobileOpen(false)
            }}
          >
            {sidebarContent}
          </aside>
        </>
      )}

      {/* Main content */}
      <div className="flex-1 min-w-0 lg:ml-0 relative">
        {/* Continuous mineral light field. Product surfaces stay quiet; the spectrum lives behind them. */}
        <div className="absolute left-0 right-0 top-0 z-20 h-[2px]" style={{ background: GRADIENTS.fullSpectrum }} />
        {/* Living mineral aurora — reactive to network events */}
        <div className="absolute inset-0 z-0 overflow-hidden">
          <MineralAurora variant="light" opacity={0.06} speed={0.0002} pulses={pulses} className="absolute inset-0" />
        </div>

        {/* Page title area + network status */}
        <div className="relative z-10 px-6 md:px-10 pt-14 lg:pt-8 pb-6 flex items-start justify-between">
          <div>
            <PageTitle pathname={location.pathname} />
          </div>
          {coordinatorOnline !== null && (
            <div className="hidden lg:flex items-center gap-2 pt-1">
              <span className="text-xs" style={{ color: coordinatorOnline ? C.green : '#B7443B' }}>
                Network · {coordinatorOnline ? 'live' : 'offline'}
              </span>
              <NetworkHeartbeat online={!!coordinatorOnline} eventCount={events.length} />
            </div>
          )}
        </div>

        {/* Page content */}
        <div className="relative z-10 px-6 md:px-10 pb-10 mineral-glow">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </div>
      </div>
    </div>
  )
}

// ─── Page titles ─────────────────────────────────────────────

const PAGE_META: Record<string, { title: string; subtitle: string }> = {
  '/overview': { title: 'Network', subtitle: 'Operational transparency for the exchange.' },
  '/chat': { title: 'Chat', subtitle: 'Familiar entry point first. Exchange mechanics stay one click away.' },
  '/exchange': { title: 'Exchange', subtitle: 'A serious market surface for users who care about the routing mechanics.' },
  '/models': { title: 'Models', subtitle: 'Choose the model first; then inspect how the exchange can serve it.' },
  '/providers': { title: 'Providers', subtitle: 'Browse supply as evidence, not a directory of marketing claims.' },
  '/billing': { title: 'Billing', subtitle: 'Alpha credits, usage and the economics of every request.' },
  '/keys': { title: 'API keys', subtitle: 'One secure place for keys, quick start and request attribution.' },
  '/admin': { title: 'Settings', subtitle: 'System configuration and diagnostics.' },
  '/trace': { title: 'Request trace', subtitle: 'Inspect the evidence behind a completed request.' },
  '/dashboard': { title: 'Provider', subtitle: 'The provider side is about turning hardware into a transparent economic offer.' },
  '/docs': { title: 'Docs', subtitle: 'Principles and requirements. The code implements these.' },
}

function PageTitle({ pathname }: { pathname: string }) {
  const meta = PAGE_META[pathname.startsWith('/docs') ? '/docs' : pathname]
  if (!meta) return null

  const gradient =
    pathname === '/chat' ? GRADIENTS.demandToExchange :
    pathname === '/exchange' || pathname === '/models' ? GRADIENTS.market :
    pathname === '/providers' || pathname === '/dashboard' ? GRADIENTS.supplyToValue :
    pathname === '/trace' ? GRADIENTS.trust :
    GRADIENTS.titleText

  return (
    <div>
      <h1
        className="text-2xl font-bold tracking-tight"
        style={{
          backgroundImage: gradient,
          backgroundClip: 'text',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
        }}
      >
        {meta.title}
      </h1>
      <p className="text-sm mt-1" style={{ color: '#888' }}>
        {meta.subtitle}
      </p>
    </div>
  )
}
