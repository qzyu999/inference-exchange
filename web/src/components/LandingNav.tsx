import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { LANDING_LINKS, authState, loginHref } from '../lib/nav.js'
import { C, GRADIENTS, HERO_PIGMENTS as HP } from '../lib/theme'

// Persistent first-viewport navigation for "/" (#107 P0).
// Plain HTML above the WebGL canvas: it works before, during, and without the scene.

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F0C54B]'
// Opaque pale pigment on dark charcoal, inspired by painted mani stones.
const NAV_PAINT = '#F7EAD6'

function AccountArea({ onNavigate, mobile = false }: { onNavigate?: () => void; mobile?: boolean }) {
  const { user, loading, logout } = useAuth()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onOutsidePointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false)
        menuButton.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onOutsidePointer)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onOutsidePointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const state = authState(loading, user)
  if (state === 'loading') {
    return <span className="hero-mani-nav text-[13px] whitespace-nowrap" style={{ color: NAV_PAINT }} aria-live="polite">Checking sign-in…</span>
  }
  if (state === 'signed-out') {
    return (
      <Link
        to={loginHref(location.pathname + location.search)}
        onClick={onNavigate}
        className={'hero-mani-nav px-3 py-1.5 rounded-lg text-[15px] border whitespace-nowrap ' + FOCUS}
        style={{ color: HP.cream, borderColor: 'rgba(240,197,75,0.55)' }}
      >
        Sign in with GitHub
      </Link>
    )
  }

  if (mobile) {
    // Keep all account actions in one vertical list in the narrow navigation.
    return (
      <div className="flex flex-col items-stretch gap-1">
        <span className="hero-mani-nav text-[13px] break-words px-3 py-2" style={{ color: NAV_PAINT }} title={user!.email}>
          Signed in as {user!.name || user!.email}
        </span>
        <Link to="/keys" onClick={onNavigate} className={'hero-mani-nav block rounded-lg px-3 py-2.5 text-[15px] ' + FOCUS} style={{ color: NAV_PAINT }}>API keys</Link>
        <Link to="/billing" onClick={onNavigate} className={'hero-mani-nav block rounded-lg px-3 py-2.5 text-[15px] ' + FOCUS} style={{ color: NAV_PAINT }}>Account & billing</Link>
        <button type="button" onClick={() => { onNavigate?.(); void logout() }}
          className={'hero-mani-nav rounded-lg px-3 py-2.5 text-left text-[15px] ' + FOCUS}
          style={{ color: NAV_PAINT }}>Sign out</button>
      </div>
    )
  }

  // Avoid putting the account identity and three actions into the fixed 72px row.
  return (
    <div className="relative shrink-0" ref={menuRef}>
      <button
        ref={menuButton}
        type="button"
        aria-expanded={menuOpen}
        aria-controls="landing-account-menu"
        aria-label="Account options"
        onClick={() => setMenuOpen(value => !value)}
        className={'hero-mani-nav inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 py-2 text-[15px] ' + FOCUS}
        style={{ color: NAV_PAINT, borderColor: 'rgba(240,197,75,0.35)' }}
      >
        Account
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m6 9 6 6 6-6" />
        </svg>
      </button>
      <div
        id="landing-account-menu"
        hidden={!menuOpen}
        className="absolute right-0 top-full mt-2 w-64 rounded-xl border p-2 shadow-xl"
        style={{ background: '#292F35', borderColor: 'rgba(240,197,75,0.35)' }}
      >
        <div className="border-b px-3 py-2 mb-1" style={{ borderColor: 'rgba(240,197,75,0.18)' }}>
          <p className="hero-mani-nav truncate text-sm" title={user!.name || user!.email} style={{ color: NAV_PAINT }}>{user!.name || user!.email}</p>
          <p className="truncate text-xs" title={user!.email} style={{ color: '#C2B9A9' }}>{user!.email}</p>
        </div>
        <Link to="/keys" onClick={() => setMenuOpen(false)} className={'hero-mani-nav block rounded-lg px-3 py-2.5 text-[15px] ' + FOCUS} style={{ color: NAV_PAINT }}>API keys</Link>
        <Link to="/billing" onClick={() => setMenuOpen(false)} className={'hero-mani-nav block rounded-lg px-3 py-2.5 text-[15px] ' + FOCUS} style={{ color: NAV_PAINT }}>Account & billing</Link>
        <button type="button" onClick={() => { setMenuOpen(false); void logout() }}
          className={'hero-mani-nav block w-full rounded-lg px-3 py-2.5 text-left text-[15px] ' + FOCUS}
          style={{ color: NAV_PAINT }}>Sign out</button>
      </div>
    </div>
  )
}

export function LandingNav() {
  const [open, setOpen] = useState(false)
  const { user, loading } = useAuth()
  const location = useLocation()
  const menuButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); menuButton.current?.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50"
      style={{
        background: GRADIENTS.sidebar,
        borderBottom: '1px solid rgba(240,197,75,0.34)',
        boxShadow: '0 2px 12px rgba(31,31,32,0.22)',
      }}
    >
      {/* Use one centered 72px navigation row instead of a 56px row plus
          a 16px decorative spacer. The row still covers the same video
          seam, with no change to the 56px-offset story geometry. */}
      <a
        href="#landing-main"
        className={`sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:px-3 focus:py-2 focus:rounded-lg ${FOCUS}`}
        style={{ background: '#F2E6D0', color: C.blueBlack }}
      >
        Skip to content
      </a>
      <nav aria-label="Main" className="max-w-7xl mx-auto px-3 sm:px-4 xl:px-6 h-[72px] flex items-center justify-between gap-2 xl:gap-3">
        <Link to="/" className={`flex items-center gap-2 min-w-0 xl:shrink-0 ${FOCUS}`}>
          <img src="/logo-icon.svg" alt="" className="w-7 h-7 shrink-0" />
          <span className="mineral-spectrum-text hero-mineral-wordmark truncate text-sm sm:text-base font-bold uppercase tracking-wider">
            Inference Exchange
          </span>
        </Link>

        <ul className="hidden xl:flex items-center gap-3 shrink-0">
          {LANDING_LINKS.map(l => (
            <li key={l.to}>
              <Link to={l.to} className={`hero-mani-nav text-[15px] whitespace-nowrap ${FOCUS}`} style={{ color: NAV_PAINT }}>{l.label}</Link>
            </li>
          ))}
        </ul>

        <div className="hidden xl:flex items-center gap-3 shrink-0">
          <AccountArea />
          <Link
            to="/chat"
            className={`px-4 py-2 rounded-lg text-[15px] font-semibold whitespace-nowrap shrink-0 ${FOCUS}`}
            style={{ background: '#F2E6D0', color: C.blueBlack }}
          >
            Try inference
          </Link>
        </div>

        {/* Mobile: chat AND sign-in/account stay visible without opening the menu. */}
        <div className="flex xl:hidden items-center gap-1.5 shrink-0">
          <Link
            to="/chat"
            className={`px-2.5 py-2 rounded-lg text-sm font-semibold ${FOCUS}`}
            style={{ background: '#F2E6D0', color: C.blueBlack }}
            aria-label="Try inference"
          >
            Try
          </Link>
          {!loading && (
            <Link
              to={user ? '/keys' : loginHref(location.pathname + location.search)}
              className={`hero-mani-nav px-2 py-2 rounded-lg text-sm ${FOCUS}`}
              style={{ color: NAV_PAINT }}
            >
              {user ? 'Account' : 'Sign in'}
            </Link>
          )}
          <button
            ref={menuButton}
            type="button"
            aria-expanded={open}
            aria-controls="landing-mobile-menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen(o => !o)}
            className={`p-2 rounded-lg min-w-[44px] min-h-[44px] flex items-center justify-center ${FOCUS}`}
            style={{ color: HP.cream }}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              {open
                ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />}
            </svg>
          </button>
        </div>
      </nav>

      {open && (
        <div id="landing-mobile-menu" className="xl:hidden px-4 pb-4 max-h-[calc(100svh-72px)] overflow-y-auto" style={{ background: GRADIENTS.sidebar }}>
          <ul className="flex flex-col">
            {LANDING_LINKS.map(l => (
              <li key={l.to}>
                <Link
                  to={l.to}
                  onClick={() => setOpen(false)}
                  className={`hero-mani-nav block py-3 text-base ${FOCUS}`}
                  style={{ color: NAV_PAINT, borderBottom: '1px solid rgba(240,197,75,0.23)' }}
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="pt-3">
            <AccountArea mobile onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </header>
  )
}
