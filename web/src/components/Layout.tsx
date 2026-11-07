import { HomeIcon } from './HomeIcon'
import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { useCoordinatorStatus, useWebSocket } from '../lib/useWebSocket'
import { useAuth } from '../lib/auth'
import { loginHref } from '../lib/nav.js'
import { canShowAdminConsole, canShowProviderDashboard } from '../lib/role-nav.js'
import { C, TRUST_COLORS, UI, GRADIENTS, APP_PIGMENTS as AP } from '../lib/theme'
import { ErrorBoundary } from './ErrorBoundary'
import { MineralAurora, NetworkHeartbeat, useNetworkPulses } from './MineralAurora'

// Trust colors re-exported for convenience (used by child pages)
export { TRUST_COLORS }

const PRIMARY_NAV = [
  { path: '/home', label: 'Home', icon: HomeIcon },
  { path: '/start', label: 'Getting Started', icon: StartIcon },
  { path: '/overview', label: 'Overview', icon: OverviewIcon },
  { path: '/chat', label: 'Chat', icon: ChatIcon },
  { path: '/exchange', label: 'Exchange', icon: ExchangeIcon },
  { path: '/models', label: 'Models', icon: ModelsIcon },
  { path: '/providers', label: 'Providers', icon: ProvidersIcon },
  { path: '/provide', label: 'Offer Compute', icon: OfferComputeIcon },
]

const ACCOUNT_NAV = [
  { path: '/dashboard', label: 'Provider Dashboard', icon: OverviewIcon },
  { path: '/billing', label: 'Billing', icon: BillingIcon },
  { path: '/keys', label: 'API keys', icon: KeysIcon },
  { path: '/docs', label: 'Docs', icon: DocsIcon },
  { path: '/settings', label: 'Settings', icon: SettingsIcon },
]

// Lucide outline icons (ISC/MIT). See public/licenses/lucide-icons.txt.

function StartIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <polygon points="3 11 22 2 13 21 11 13 3 11" />
    </svg>
  )
}

function OverviewIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect width="18" height="18" x="3" y="3" rx="2" />
  <path d="M3 9h18" />
  <path d="M9 21V9" />
    </svg>
  )
}

function ChatIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" />
  <path d="M8 12h.01" />
  <path d="M12 12h.01" />
  <path d="M16 12h.01" />
    </svg>
  )
}

function ExchangeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M10 18v-7" />
  <path d="M11.119 2.205a2 2 0 0 1 1.762 0l7.84 3.846A.5.5 0 0 1 20.5 7h-17a.5.5 0 0 1-.22-.949z" />
  <path d="M14 18v-7" />
  <path d="M18 18v-7" />
  <path d="M3 22h18" />
  <path d="M6 18v-7" />
    </svg>
  )
}

function ModelsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z" />
  <path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12" />
  <path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17" />
    </svg>
  )
}

function ProvidersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect width="20" height="8" x="2" y="2" rx="2" ry="2" />
  <rect width="20" height="8" x="2" y="14" rx="2" ry="2" />
  <line x1="6" x2="6.01" y1="6" y2="6" />
  <line x1="6" x2="6.01" y1="18" y2="18" />
    </svg>
  )
}

function OfferComputeIcon({ className }: { className?: string }) {
  // Use the selected Untitled UI asset from its publisher, without redistributing it.
  const image = 'url("https://cdn.prod.website-files.com/6365d860c7b7a7191055eb8a/69ab9bf38699e5f36a162e59_server-03.svg")'
  return (
    <span className={className} aria-hidden="true" style={{
      display: 'inline-block', width: 18, height: 18,
      backgroundColor: 'currentColor',
      maskImage: image, WebkitMaskImage: image,
      maskSize: 'contain', WebkitMaskSize: 'contain',
      maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat',
      maskPosition: 'center', WebkitMaskPosition: 'center',
    }} />
  )
}

function BillingIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect width="20" height="12" x="2" y="6" rx="2" />
  <circle cx="12" cy="12" r="2" />
  <path d="M6 12h.01M18 12h.01" />
    </svg>
  )
}

function KeysIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z" />
  <circle cx="16.5" cy="7.5" r=".5" fill="currentColor" />
    </svg>
  )
}

function DocsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M12 5v16" />
  <path d="M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z" />
    </svg>
  )
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    // Feather settings gear (MIT). See public/licenses/feather-icons.txt.
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
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
      reloadDocument={path === '/admin'}
      aria-current={active ? 'page' : undefined}
      className={`ie-app-nav-item flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors ${active ? 'sidebar-active-bar' : ''}`}
      style={{
        // Preserve the live alpha active item: neutral charcoal and a
        // four-color mineral indicator (the gradient lives in CSS).
        background: active ? C.sidebarHover : 'transparent',
        color: active ? '#fff' : AP.sidebarText,
      }}
    >
      <Icon className="shrink-0" />
      <span>{label}</span>
    </Link>
  )
}

// A single, explicit non-landing appearance preference. Light is the default
// even for users who previously saw the optional warm tint enabled by default.
const APPEARANCE_KEY = 'ie-app-appearance'
const APPEARANCE_MODES = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'blue-light', label: 'Night Shift' },
] as const
type AppAppearance = (typeof APPEARANCE_MODES)[number]['value']

// Small custom SVGs share one stroke style and fit the compact sidebar.
// Keep labels visible: icons are decoration, not the sole mode identifier.
function AppearanceIcon({ mode }: { mode: AppAppearance }) {
  const common = {
    width: 18, height: 18, viewBox: '0 0 24 24',
    fill: 'none', stroke: 'currentColor', strokeWidth: 1.7,
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
  }
  if (mode === 'light') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
      </svg>
    )
  }
  if (mode === 'dark') {
    return (
      <svg {...common}>
        <path d="M20.1 14.9A8.5 8.5 0 0 1 9.1 3.9 8.5 8.5 0 1 0 20.1 14.9Z" />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <path d="M3 18h18M6 21h12M7 14a5 5 0 0 1 10 0M12 3v3M4.8 6.8l2.1 2.1M19.2 6.8l-2.1 2.1M3 12h2m14 0h2" />
    </svg>
  )
}

function readAppearance(): AppAppearance {
  try {
    const stored = window.localStorage.getItem(APPEARANCE_KEY)
    if (stored === 'dark' || stored === 'blue-light') return stored
  } catch { /* Storage can be disabled in private browsing. */ }
  return 'light'
}

function AppearanceSelector({ value, onChange }: {
  value: AppAppearance
  onChange: (next: AppAppearance) => void
}) {
  return (
    <div role="group" aria-label="Appearance" className="ie-app-appearance-selector grid grid-cols-3 gap-1 rounded-xl p-1">
      {APPEARANCE_MODES.map(mode => (
        <button
          key={mode.value}
          type="button"
          aria-pressed={value === mode.value}
          onClick={() => onChange(mode.value)}
          className="ie-app-appearance-option flex min-h-[56px] min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-1 py-1.5 text-[10px] leading-tight font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F0C54B]"
          title={mode.value === 'blue-light' ? 'Warm paper and muted colors' : mode.label + ' appearance'}
        >
          <AppearanceIcon mode={mode.value} />
          <span className="text-center">{mode.label}</span>
        </button>
      ))}
    </div>
  )
}

// ─── Layout ──────────────────────────────────────────────────

export function Layout() {
  const location = useLocation()
  const coordinatorOnline = useCoordinatorStatus()
  const { user, loading: authLoading, logout } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [appearance, setAppearance] = useState<AppAppearance>(readAppearance)
  useEffect(() => {
    try { window.localStorage.setItem(APPEARANCE_KEY, appearance) }
    catch { /* Retain in-session preference if storage is unavailable. */ }
  }, [appearance])

  // Subscribe to live exchange events for reactive aurora
  const { events } = useWebSocket('/ws/events')
  const pulses = useNetworkPulses(events, performance.now() / 1000)

  // Landing page gets full-screen layout (no sidebar) — preserves scroll sequence
  if (location.pathname === '/' || ['/news', '/about'].includes(location.pathname) || location.pathname.startsWith('/news/')) {
    return (
      <ErrorBoundary>
        <Outlet />
      </ErrorBoundary>
    )
  }

  if (location.pathname === '/login') {
    return (
      <div className="ie-app-appearance-scope min-h-screen" data-appearance={appearance} style={{ background: `linear-gradient(180deg, #F8F8F5 0%, ${C.pageBg} 40%, #F3F2EE 100%)` }}>
        <div className="relative z-10 flex items-center justify-between gap-4 px-6 py-4">
          <Link to="/" className="text-sm font-semibold tracking-tight uppercase" style={{ color: C.gold }}>
            Inference Exchange
          </Link>
          <div className="w-64 max-w-[65vw]">
            <AppearanceSelector value={appearance} onChange={setAppearance} />
          </div>
        </div>
        <div className="ie-app-content">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </div>
      </div>
    )
  }

  const sidebarContent = (
    <>
      {/* Brand */}
      <div className="px-4 pt-5 pb-6" style={{ borderBottom: '1px solid rgba(240,197,75,0.24)' }}>
        <Link to="/" className="flex items-center gap-2.5">
          <img src="/logo-icon.svg" alt="IE" className="w-6 h-6" />
          <div>
            <div className="ie-app-wordmark text-sm font-bold uppercase tracking-wider mineral-spectrum-text">
              Inference
            </div>
            <div className="text-[11px] uppercase tracking-wider" style={{ color: AP.silk }}>
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
            active={location.pathname === item.path || (item.path === '/start' && location.pathname.startsWith('/start/'))}
          />
        ))}
      </nav>

      {/* Mineral stratum vein separator */}
      <div className="px-4 mt-6 mb-3">
        <div className="ie-app-spectrum-rule h-[1px] rounded-full" style={{ background: GRADIENTS.mineralBar, opacity: 0.8 }} />
        <div className="text-[10px] uppercase tracking-wider mt-4 mb-2" style={{ color: AP.sidebarMuted }}>
          Account
        </div>
      </div>
      <nav className="px-3 space-y-0.5">
        {ACCOUNT_NAV.filter(item => item.path !== '/dashboard' || canShowProviderDashboard(user)).map(item => (
          <NavItem
            key={item.path}
            {...item}
            active={location.pathname === item.path || (item.path === '/docs' && location.pathname.startsWith('/docs'))}
          />
        ))}
        {canShowAdminConsole(user) && (
          <NavItem path="/admin" label="Admin Console" icon={SettingsIcon} active={location.pathname === '/admin'} />
        )}
      </nav>

      {/* Spacer */}
      <div className="flex-1" />

      {/* App appearance only: never affects the cinematic landing screen. */}
      <div className="px-3 pb-3">
        <AppearanceSelector value={appearance} onChange={setAppearance} />
      </div>
      {/* Network status + user */}
      <div className="px-4 pb-5 space-y-3">
        {coordinatorOnline !== null && (
          <div className="flex items-center gap-2">
            <NetworkHeartbeat online={!!coordinatorOnline} eventCount={events.length} />
            <span className="text-xs" style={{ color: coordinatorOnline ? UI.success : UI.danger }}>
              {coordinatorOnline ? 'Network online' : 'Network offline'}
            </span>
          </div>
        )}
        {user && (
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <div className="text-xs truncate" style={{ color: AP.sidebarText }}>{user.name || user.email}</div>
              <div className="text-[10px]" style={{ color: AP.sidebarMuted }}>
                {user.email !== user.name ? user.email.split('@')[0] : ''}
              </div>
            </div>
            <button
              onClick={logout}
              className="text-[10px] px-2 py-1 rounded-lg transition-colors"
              style={{ color: AP.sidebarText }}
            >
              Sign out
            </button>
          </div>
        )}
        {!user && !authLoading && (
          <Link
            to={loginHref(location.pathname + location.search)}
            className="block text-center text-xs font-medium px-3 py-2 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E8C77A]"
            style={{ color: AP.cloud, background: 'rgba(240,197,75,0.16)', border: '1px solid rgba(240,197,75,0.3)' }}
          >
            Sign in with GitHub
          </Link>
        )}
      </div>
    </>
  )

  return (
    <div className="ie-mineral-app ie-app-appearance-scope flex min-h-screen" data-appearance={appearance} style={{ background: `linear-gradient(180deg, #F8F8F5 0%, ${C.pageBg} 40%, #F3F2EE 100%)` }}>
      {/* Desktop sidebar */}
      <aside
        className="ie-mineral-sidebar hidden lg:flex flex-col w-52 shrink-0 sticky top-0 h-screen overflow-y-auto"
        style={{ background: GRADIENTS.sidebar }}
      >
        {sidebarContent}
      </aside>

      {/* Mobile hamburger + overlay */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 px-4 py-3 flex items-center justify-between"
        style={{ background: GRADIENTS.sidebar, borderBottom: '1px solid rgba(240,197,75,0.34)' }}
      >
        <Link to="/" className="text-sm font-bold uppercase tracking-wider" style={{ color: AP.orpiment }}>
          IE
        </Link>
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="p-2 rounded-lg"
          style={{ color: AP.cloud }}
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
            className="ie-mineral-sidebar lg:hidden fixed top-0 left-0 bottom-0 z-50 w-56 flex flex-col overflow-y-auto"
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
      <div className="ie-app-content flex-1 min-w-0 lg:ml-0 relative">
        {/* Continuous mineral light field. Product surfaces stay quiet; the spectrum lives behind them. */}
        <div className="ie-app-spectrum-rule absolute left-0 right-0 top-0 z-20 h-[2px]" style={{ background: GRADIENTS.fullSpectrum }} />
        {/* Living mineral aurora — reactive to network events */}
        <div className="absolute inset-0 z-0 overflow-hidden">
          <MineralAurora variant={appearance === 'dark' ? 'dark' : 'light'} opacity={0.06} speed={0.0002} pulses={pulses} className="absolute inset-0" />
        </div>

        {/* Page title area + network status */}
        <div className="relative z-10 px-6 md:px-10 pt-14 lg:pt-8 pb-6 flex items-start justify-between">
          <div>
            <PageTitle pathname={location.pathname} dark={appearance === 'dark'} />
          </div>
          {coordinatorOnline !== null && (
            <div className="hidden lg:flex items-center gap-2 pt-1">
              <span className="text-xs" style={{ color: coordinatorOnline ? UI.success : UI.danger }}>
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
  '/home': { title: 'Home', subtitle: 'Your account, activity, and next steps.' },
  '/start': { title: 'Getting Started', subtitle: 'Use the API, provide compute, or understand OCIP.' },
  '/overview': { title: 'Network', subtitle: 'Operational transparency for the exchange.' },
  '/chat': { title: 'Chat', subtitle: 'Familiar entry point first. Exchange mechanics stay one click away.' },
  '/exchange': { title: 'Exchange', subtitle: 'A serious market surface for users who care about the routing mechanics.' },
  '/models': { title: 'Models', subtitle: 'Choose the model first; then inspect how the exchange can serve it.' },
  '/providers': { title: 'Providers', subtitle: 'Browse supply as evidence, not a directory of marketing claims.' },
  '/provide': { title: 'Offer Compute', subtitle: 'Bring your own Apple Silicon to the exchange.' },
  '/billing': { title: 'Billing', subtitle: 'Alpha credits, usage and the economics of every request.' },
  '/keys': { title: 'API keys', subtitle: 'One secure place for keys, quick start and request attribution.' },
  '/settings': { title: 'Settings', subtitle: 'Manage your IE account and owned provider nodes.' },
  '/admin': { title: 'Admin Console', subtitle: 'Operator-only system configuration and diagnostics.' },
  '/trace': { title: 'Request trace', subtitle: 'Inspect the evidence behind a completed request.' },
  '/dashboard': { title: 'Provider', subtitle: 'The provider side is about turning hardware into a transparent economic offer.' },
  '/docs': { title: 'Docs', subtitle: 'Principles and requirements. The code implements these.' },
}

function PageTitle({ pathname, dark }: { pathname: string; dark: boolean }) {
  const meta = PAGE_META[pathname.startsWith('/docs') ? '/docs' : pathname.startsWith('/start/') ? '/start' : pathname]
  if (!meta) return null

  const gradient =
    dark ? 'linear-gradient(110deg, #F2DCA8 0%, #B2D2C3 54%, #B9C9EA 100%)' :
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
      <p className="text-sm mt-1" style={{ color: UI.body }}>
        {meta.subtitle}
      </p>
    </div>
  )
}
