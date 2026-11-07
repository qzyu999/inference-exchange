import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { getLandingGroups } from '../lib/nav.js'
import './landing-nav.css'

/** Same destinations and dropdown styles as the header, anchored to the landscape. */
export function BridgeNavigation({ visible }: { visible: boolean }) {
  const { user } = useAuth()
  const location = useLocation()
  const groups = getLandingGroups(user).filter(group => group.id === 'use-ai' || group.id === 'provide')
  const [active, setActive] = useState<string | null>(null)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const root = useRef<HTMLElement>(null)
  const panel = useRef<HTMLUListElement>(null)
  const triggers = useRef<Record<string, HTMLButtonElement | null>>({})
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoverOpened = useRef<string | null>(null)
  const group = groups.find(item => item.id === active)

  function cancelClose() {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }
  function close() { cancelClose(); hoverOpened.current = null; setActive(null) }
  function contains(node: Node | null) { return !!node && (root.current?.contains(node) || panel.current?.contains(node)) }
  function leave() {
    cancelClose()
    if (contains(document.activeElement)) return
    timer.current = setTimeout(close, 180)
  }
  function open(id: string, focusLinks = false) {
    cancelClose()
    setActive(id)
    if (focusLinks) requestAnimationFrame(() => panel.current?.querySelector('a')?.focus({ preventScroll: true }))
  }

  useEffect(() => () => cancelClose(), [])
  useEffect(() => { close() }, [visible, location.pathname, location.search])
  useEffect(() => {
    if (!active) return
    const outside = (event: PointerEvent) => { if (!contains(event.target as Node)) close() }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      triggers.current[active]?.focus({ preventScroll: true })
      close()
    }
    const scroll = (event: Event) => { if (event.target === document || event.target === window) close() }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    window.addEventListener('scroll', scroll, { passive: true, capture: true })
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
      window.removeEventListener('scroll', scroll, true)
      window.removeEventListener('resize', close)
    }
  }, [active])
  useLayoutEffect(() => {
    if (!active || !visible) return
    const anchor = triggers.current[active]?.getBoundingClientRect()
    const menu = panel.current?.getBoundingClientRect()
    if (!anchor || !menu) return
    setPosition({
      left: Math.max(16, Math.min(window.innerWidth - menu.width - 16, anchor.left + (anchor.width - menu.width) / 2)),
      top: Math.max(16, Math.min(window.innerHeight - menu.height - 16,
        anchor.top >= menu.height + 26 ? anchor.top - menu.height - 10 : anchor.bottom + 10)),
    })
  }, [active, visible, user?.user_id])

  const onBlur = (event: React.FocusEvent) => { if (!contains(event.relatedTarget as Node | null)) close() }
  return <nav ref={root} aria-label="Landscape shortcuts" className="ie-bridge-navigation" onBlur={onBlur}>
    {groups.map(item => <div key={item.id} className={'ie-bridge-bank ie-bridge-bank-' + (item.id === 'use-ai' ? 'use' : 'provide')}
      onPointerEnter={event => {
        if (event.pointerType !== 'mouse' || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return
        hoverOpened.current = item.id
        open(item.id)
      }} onPointerLeave={event => { if (event.pointerType === 'mouse') leave() }}>
      <button type="button" ref={node => { triggers.current[item.id] = node }}
        disabled={!visible} aria-expanded={active === item.id} aria-controls={'bridge-' + item.id + '-links'}
        className="ie-public-nav-trigger ie-bridge-bank-trigger"
        onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); open(item.id, true) } }}
        onClick={event => {
          if (hoverOpened.current === item.id) { hoverOpened.current = null; open(item.id, event.detail === 0) }
          else if (active === item.id) close()
          else open(item.id, event.detail === 0)
        }}>
        {item.id === 'use-ai'
          ? <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="12" rx="1"/><path d="M1 20h22M9 15v5m6-5v5"/></svg>
          : <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M8 1v4m8-4v4M8 19v4m8-4v4M1 8h4m-4 8h4m14-8h4m-4 8h4"/></svg>}
        {item.label}<svg aria-hidden="true" className="ie-bridge-chevron" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>
      </button>
    </div>)}
    {visible && group && createPortal(<ul ref={panel} id={'bridge-' + group.id + '-links'}
      aria-label={group.label + ' links'} className="ie-public-nav-dropdown ie-bridge-dropdown"
      style={position} onPointerEnter={cancelClose} onPointerLeave={event => { if (event.pointerType === 'mouse') leave() }} onBlur={onBlur}>
      {group.items.map(item => <li key={item.to}><Link className="ie-public-nav-link hero-mani-nav" to={item.to} onClick={close}>{item.label}</Link></li>)}
    </ul>, document.body)}
  </nav>
}
