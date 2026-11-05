import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { getLandingGroups, getLandingAccountLinks, authState, loginHref, type LandingGroup } from '../lib/nav.js'
import { C, GRADIENTS, HERO_PIGMENTS as HP } from '../lib/theme'
import './landing-nav.css'

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F0C54B]'

function Chevron() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m6 9 6 6 6-6" /></svg>
}

export function LandingNav() {
  const { user, loading, logout } = useAuth()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [activeMenu, setActiveMenu] = useState<string | null>(null)
  const headerRef = useRef<HTMLElement>(null)
  const mobileButtonRef = useRef<HTMLButtonElement>(null)
  const triggerRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const groups = getLandingGroups(user)
  const accountLinks = getLandingAccountLinks(user)
  const state = authState(loading, user)

  function closeMenus() {
    setActiveMenu(null)
    setMobileOpen(false)
  }

  useEffect(() => { closeMenus() }, [location.pathname, location.search])

  useEffect(() => {
    if (!activeMenu && !mobileOpen) return
    const onOutsidePointer = (event: PointerEvent) => {
      if (!headerRef.current?.contains(event.target as Node)) closeMenus()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (activeMenu) {
        triggerRefs.current[activeMenu]?.focus()
        setActiveMenu(null)
      } else {
        setMobileOpen(false)
        mobileButtonRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onOutsidePointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onOutsidePointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [activeMenu, mobileOpen])

  // A breakpoint change closes disclosures that are no longer visible.
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1280px)')
    query.addEventListener('change', closeMenus)
    return () => query.removeEventListener('change', closeMenus)
  }, [])

  const toggle = (id: string) => setActiveMenu(current => current === id ? null : id)
  const linkClass = `ie-public-nav-link hero-mani-nav ${FOCUS}`

  function groupMenu(group: LandingGroup, mobile = false) {
    const id = `${mobile ? 'mobile' : 'desktop'}-${group.id}`
    const expanded = activeMenu === id
    return (
      <li className="ie-public-nav-group" key={id}>
        <button type="button" ref={node => { triggerRefs.current[id] = node }}
          className={`ie-public-nav-trigger hero-mani-nav ${FOCUS}`}
          aria-expanded={expanded} aria-controls={`${id}-links`} onClick={() => toggle(id)}>
          {group.label}<Chevron />
        </button>
        <ul id={`${id}-links`} hidden={!expanded} className={mobile ? 'ie-public-nav-sublist' : 'ie-public-nav-dropdown'}>
          {group.items.map(item => (
            <li key={item.to} className={item.dividerBefore ? 'ie-public-nav-divider' : undefined}>
              <Link to={item.to} className={linkClass} onClick={closeMenus}>{item.label}</Link>
            </li>
          ))}
        </ul>
      </li>
    )
  }

  const account = state === 'loading'
    ? <span className="ie-public-nav-loading hero-mani-nav" aria-live="polite">Checking sign-in…</span>
    : state === 'signed-out'
      ? <Link to={loginHref(location.pathname + location.search)} onClick={closeMenus} className={`ie-public-nav-account hero-mani-nav ${FOCUS}`}>Sign in</Link>
      : <div className="ie-public-nav-group ie-public-nav-account-group">
          <button type="button" ref={node => { triggerRefs.current.account = node }}
            aria-expanded={activeMenu === 'account'} aria-controls="landing-account-menu"
            className={`ie-public-nav-account hero-mani-nav ${FOCUS}`} onClick={() => { setMobileOpen(false); toggle('account') }}>
            Account<Chevron />
          </button>
          <div id="landing-account-menu" hidden={activeMenu !== 'account'} className="ie-public-nav-dropdown ie-public-nav-account-dropdown">
            <div className="ie-public-nav-identity">
              <p title={user!.name || user!.email}>Signed in as {user!.name || user!.email}</p>
              {user!.name && <p title={user!.email}>{user!.email}</p>}
            </div>
            <ul>{accountLinks.map(item => <li key={item.to}><Link to={item.to} reloadDocument={item.to === '/admin'} onClick={closeMenus} className={linkClass}>{item.label}</Link></li>)}</ul>
            <button type="button" className={`${linkClass} ie-public-nav-signout`} onClick={() => { closeMenus(); void logout() }}>Sign out</button>
          </div>
        </div>

  return (
    <header ref={headerRef} className="ie-public-nav" style={{ background: GRADIENTS.sidebar, color: HP.cream }}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) closeMenus() }}>
      <a href={location.pathname === '/' ? '#landing-main' : '#public-main'} className={`ie-public-nav-skip sr-only focus:not-sr-only ${FOCUS}`} style={{ background: HP.cream, color: C.blueBlack }}>Skip to content</a>
      <nav aria-label="Main" className="ie-public-nav-row">
        <div className="ie-public-nav-left">
          <button ref={mobileButtonRef} type="button" aria-expanded={mobileOpen} aria-controls="landing-mobile-menu"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'} className={`ie-public-nav-mobile-trigger ${FOCUS}`}
            onClick={() => { setActiveMenu(null); setMobileOpen(open => !open) }}>
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path strokeWidth="1.5" strokeLinecap="round" d={mobileOpen ? 'M6 6l12 12M6 18L18 6' : 'M4 6h16M4 12h16M4 18h16'} /></svg>
          </button>
          <ul className="ie-public-nav-desktop">{groups.filter(group => group.side === 'left').map(group => groupMenu(group))}</ul>
        </div>
        <Link to="/" aria-label="Inference Exchange home" onClick={closeMenus} className={`ie-public-nav-brand ${FOCUS}`}>
          <img src="/logo-icon.svg" alt="" width="28" height="28" />
          <span className="mineral-spectrum-text hero-mineral-wordmark">Inference Exchange</span>
        </Link>
        <div className="ie-public-nav-right">
          <ul className="ie-public-nav-desktop">{groups.filter(group => group.side === 'right').map(group => groupMenu(group))}</ul>
          {account}
          <Link to="/chat" onClick={closeMenus} className={`ie-public-nav-try ${FOCUS}`} style={{ background: '#F2E6D0', color: C.blueBlack }}>Try inference</Link>
        </div>
      </nav>
      <div id="landing-mobile-menu" hidden={!mobileOpen} className="ie-public-nav-mobile-menu">
        <ul>{groups.map(group => groupMenu(group, true))}</ul>
        <Link to="/chat" onClick={closeMenus} className={`${linkClass} ie-public-nav-mobile-try`}>Try inference →</Link>
      </div>
    </header>
  )
}
