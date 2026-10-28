import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { LANDING_LINKS, authState, loginHref } from '../lib/nav.js'
import { C } from '../lib/theme'

// Persistent first-viewport navigation for "/" (#107 P0).
// Plain HTML above the WebGL canvas: it works before, during, and without the scene.

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E8C77A]'

function AccountArea({ onNavigate }: { onNavigate?: () => void }) {
  const { user, loading, logout } = useAuth()
  const location = useLocation()
  const state = authState(loading, user)

  if (state === 'loading') {
    // Reserve the space, and do not claim either state while /v1/auth/me resolves
    return <span className="text-xs" style={{ color: '#a9a294' }} aria-live="polite">Checking sign-in…</span>
  }
  if (state === 'signed-out') {
    return (
      <Link
        to={loginHref(location.pathname + location.search)}
        onClick={onNavigate}
        className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${FOCUS}`}
        style={{ color: C.warmWhite, borderColor: 'rgba(216,209,190,0.35)' }}
      >
        Sign in with GitHub
      </Link>
    )
  }
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <span className="text-xs truncate max-w-[12rem]" style={{ color: '#d8d1be' }} title={user!.email}>
        Signed in as {user!.name || user!.email}
      </span>
      <Link to="/keys" onClick={onNavigate} className={`text-sm ${FOCUS}`} style={{ color: C.warmWhite }}>API keys</Link>
      <Link to="/billing" onClick={onNavigate} className={`text-sm ${FOCUS}`} style={{ color: C.warmWhite }}>Account</Link>
      <button
        type="button"
        onClick={() => { onNavigate?.(); logout() }}
        className={`text-sm ${FOCUS}`}
        style={{ color: '#d8d1be' }}
      >
        Sign out
      </button>
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
      style={{ background: 'rgba(14,16,24,0.82)', backdropFilter: 'blur(10px)', borderBottom: '1px solid rgba(216,209,190,0.12)' }}
    >
      <a
        href="#landing-main"
        className={`sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:px-3 focus:py-2 focus:rounded-lg ${FOCUS}`}
        style={{ background: C.warmWhite, color: C.black }}
      >
        Skip to content
      </a>
      <nav aria-label="Main" className="max-w-7xl mx-auto px-4 md:px-8 h-14 flex items-center justify-between gap-4">
        <Link to="/" className={`flex items-center gap-2 shrink-0 ${FOCUS}`}>
          <img src="/logo-icon.svg" alt="" className="w-6 h-6" />
          <span className="text-sm font-semibold uppercase tracking-wider" style={{ color: C.warmWhite }}>
            Inference Exchange
          </span>
        </Link>

        <ul className="hidden md:flex items-center gap-5">
          {LANDING_LINKS.map(l => (
            <li key={l.to}>
              <Link to={l.to} className={`text-sm ${FOCUS}`} style={{ color: '#d8d1be' }}>{l.label}</Link>
            </li>
          ))}
        </ul>

        <div className="hidden md:flex items-center gap-4">
          <AccountArea />
          <Link
            to="/chat"
            className={`px-4 py-2 rounded-lg text-sm font-semibold ${FOCUS}`}
            style={{ background: C.warmWhite, color: C.black }}
          >
            Try inference
          </Link>
        </div>

        {/* Mobile: chat AND sign-in/account stay visible without opening the menu. */}
        <div className="flex md:hidden items-center gap-1.5">
          <Link
            to="/chat"
            className={`px-2.5 py-2 rounded-lg text-sm font-semibold ${FOCUS}`}
            style={{ background: C.warmWhite, color: C.black }}
            aria-label="Try inference"
          >
            Try
          </Link>
          {!loading && (
            <Link
              to={user ? '/keys' : loginHref(location.pathname + location.search)}
              className={`px-2 py-2 rounded-lg text-sm font-medium ${FOCUS}`}
              style={{ color: C.warmWhite }}
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
            style={{ color: C.warmWhite }}
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
        <div id="landing-mobile-menu" className="md:hidden px-4 pb-4" style={{ background: 'rgba(14,16,24,0.96)' }}>
          <ul className="flex flex-col">
            {LANDING_LINKS.map(l => (
              <li key={l.to}>
                <Link
                  to={l.to}
                  onClick={() => setOpen(false)}
                  className={`block py-3 text-base ${FOCUS}`}
                  style={{ color: C.warmWhite, borderBottom: '1px solid rgba(216,209,190,0.08)' }}
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="pt-3">
            <AccountArea onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </header>
  )
}
