import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { searchModelItems } from '../lib/model-search.js'
import { C } from '../lib/theme'

export interface ModelSearchItem {
  key: string
  name: string
  subtitle?: string
  group?: string
  keywords?: string
  priceLabel?: string
  badges?: Array<{ label: string; color?: string; background?: string }>
}

interface ModelSearchProps {
  items: ModelSearchItem[]
  value: string
  onChange: (modelKey: string) => void
  label: string
  placeholder: string
  emptyMessage: string
  className?: string
  filters?: ReactNode
  loading?: boolean
  disabled?: boolean
  selectedLabel?: string
}

/**
 * Single shared searchable model palette.
 * Discovery (Exchange) and inference (Chat) supply DIFFERENT permitted model lists.
 * An item in this component is not evidence it is runnable; Chat enforces that upstream.
 */
export function ModelSearch({
  items, value, onChange, label, placeholder, emptyMessage,
  className = '', filters, loading = false, disabled = false,
  selectedLabel = 'Select a model',
}: ModelSearchProps) {
  const listboxId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)

  const filtered = useMemo(() => searchModelItems(items, query), [items, query])
  const active = Math.min(activeIndex, Math.max(0, filtered.length - 1))
  const activeOptionId = filtered.length ? listboxId + '-option-' + active : undefined
  const selected = items.find(item => item.key === value)
  const blocked = disabled || loading || items.length === 0

  useEffect(() => {
    if (!open) return
    searchRef.current?.focus()
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  useEffect(() => { setActiveIndex(0) }, [query])
  useEffect(() => { if (blocked && open) setOpen(false) }, [blocked, open])
  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [open, active, query])

  function close(restoreFocus = false) {
    setOpen(false)
    setQuery('')
    if (restoreFocus) triggerRef.current?.focus()
  }

  function choose(key: string) {
    if (!items.some(item => item.key === key)) return
    onChange(key)
    close(true)
  }

  function onSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      close(true)
    } else if (e.key === 'Tab') {
      close()
    } else if (e.key === 'ArrowDown' && filtered.length) {
      e.preventDefault()
      setActiveIndex(index => Math.min(index + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp' && filtered.length) {
      e.preventDefault()
      setActiveIndex(index => Math.max(index - 1, 0))
    } else if (e.key === 'Home' && filtered.length) {
      e.preventDefault()
      setActiveIndex(0)
    } else if (e.key === 'End' && filtered.length) {
      e.preventDefault()
      setActiveIndex(filtered.length - 1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filtered.length) choose(filtered[active].key)
    }
  }

  return (
    <div ref={rootRef} className={'relative min-w-0 max-w-full ' + className}>
      <button type="button" ref={triggerRef} disabled={blocked}
        aria-label={label} aria-haspopup="listbox" aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        onClick={() => {
          if (open) close(true)
          else { setQuery(''); setActiveIndex(0); setOpen(true) }
        }}
        className="flex w-full items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-left shadow-sm transition-colors hover:border-amber-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
        style={{ color: C.blueBlack }}>
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 opacity-60">
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
        </svg>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold">
            {loading ? 'Checking models…' : selected?.name || value || (items.length ? selectedLabel : emptyMessage)}
          </span>
          <span className="block truncate text-[10px] text-gray-500">
            {value && !selected && !loading ? 'Unavailable — choose another model' :
              items.length === 1 ? '1 model' : items.length + ' models'}
          </span>
        </span>
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 opacity-60">
          <path d={open ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} />
        </svg>
      </button>

      {open && !blocked && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl">
          <div className="border-b border-gray-100 p-3">
            <label htmlFor={listboxId + '-search'} className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              {label}
            </label>
            <input id={listboxId + '-search'} ref={searchRef}
              role="combobox" aria-autocomplete="list" aria-expanded={true}
              aria-controls={listboxId} aria-activedescendant={activeOptionId}
              aria-label={label} type="search" autoComplete="off" value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={onSearchKeyDown} placeholder={placeholder}
              className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-amber-500"
              style={{ color: C.blueBlack }}
            />
          </div>
          {filters && <div className="border-b border-gray-100 px-3 py-2">{filters}</div>}
          <div ref={listRef} role="listbox" id={listboxId} aria-label={label}
            className="max-h-72 overflow-y-auto overscroll-contain p-1.5">
            <div role="status" className="px-2 py-1 text-[11px] text-gray-500">
              {filtered.length} {filtered.length === 1 ? 'model' : 'models'} match
            </div>
            {filtered.map((item, index) => (
              <div key={item.key}>
                {item.group && (index === 0 || filtered[index - 1].group !== item.group) && (
                  <div className="px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                    {item.group}
                  </div>
                )}
                <button id={listboxId + '-option-' + index} role="option" type="button"
                  aria-selected={item.key === value} tabIndex={-1}
                  data-active={index === active ? 'true' : undefined}
                  onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(item.key)}
                  className={
                    'flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left transition-colors ' +
                    (index === active ? 'bg-amber-50' : 'hover:bg-gray-50')
                  }>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold" style={{ color: C.blueBlack }}>{item.name}</div>
                    {item.subtitle && <div className="truncate text-[11px] text-gray-500">{item.subtitle}</div>}
                  </div>
                  {item.badges?.length ? (
                    <div className="flex shrink-0 items-center gap-1">
                      {item.badges.map(badge => (
                        <span key={badge.label} className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                          style={{ background: badge.background || '#f3f4f6', color: badge.color || '#6b7280' }}>
                          {badge.label}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {item.priceLabel && (
                    <div className="shrink-0 text-xs font-semibold tabular-nums" style={{ color: C.gold }}>{item.priceLabel}</div>
                  )}
                  {value === item.key && <span className="shrink-0 text-xs font-semibold" style={{ color: C.gold }}>✓</span>}
                </button>
              </div>
            ))}
            {!filtered.length && <div className="px-3 py-6 text-center text-xs text-gray-500">
              No models match your search or filters.
            </div>}
          </div>
          <div className="border-t border-gray-100 px-3 py-2 text-[10px] text-gray-500">
            ↑↓ Navigate · Enter Select · Esc Close
          </div>
        </div>
      )}
    </div>
  )
}
