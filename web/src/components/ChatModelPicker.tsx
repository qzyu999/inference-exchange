import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { searchOnlineModels } from '../lib/chat-models.js'
import { C } from '../lib/theme'

interface ChatModelPickerProps {
  models: string[]
  value: string
  onChange: (model: string) => void
  providerCounts?: Record<string, number>
  disabled?: boolean
  loading?: boolean
}

/**
 * Small, keyboard-accessible search palette for runnable IE models (#191).
 * External reference-only models are not valid Chat targets.
 */
export function ChatModelPicker({
  models, value, onChange, providerCounts = {}, disabled = false, loading = false,
}: ChatModelPickerProps) {
  const listboxId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)

  const results = useMemo(() => searchOnlineModels(models, query), [models, query])
  const activeOptionId = results.length
    ? listboxId + '-option-' + Math.min(activeIndex, results.length - 1)
    : undefined
  const selectedOnline = models.includes(value)
  const blocked = disabled || loading || models.length === 0

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

  useEffect(() => {
    if (open && blocked) setOpen(false)
  }, [open, blocked])

  useEffect(() => {
    if (!open) return
    const option = listRef.current?.querySelector('[data-active="true"]')
    option?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex, query])

  function close(focusTrigger = false) {
    setOpen(false)
    setQuery('')
    if (focusTrigger) triggerRef.current?.focus()
  }

  function choose(id: string) {
    if (!models.includes(id)) return
    onChange(id)
    close(true)
  }

  function onSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      close(true)
    } else if (e.key === 'Tab') {
      close()
    } else if (e.key === 'ArrowDown' && results.length) {
      e.preventDefault()
      setActiveIndex(i => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp' && results.length) {
      e.preventDefault()
      setActiveIndex(i => Math.max(0, i - 1))
    } else if (e.key === 'Home' && results.length) {
      e.preventDefault()
      setActiveIndex(0)
    } else if (e.key === 'End' && results.length) {
      e.preventDefault()
      setActiveIndex(results.length - 1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (results.length) choose(results[Math.min(activeIndex, results.length - 1)])
    }
  }

  return (
    <div ref={rootRef} className="relative min-w-0 w-full sm:w-[340px] max-w-full">
      <button type="button" ref={triggerRef}
        aria-label="Choose an online model for Chat"
        aria-haspopup="listbox" aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        disabled={blocked}
        onClick={() => {
          if (open) close(true)
          else { setQuery(''); setActiveIndex(0); setOpen(true) }
        }}
        className="flex w-full items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-left shadow-sm transition-colors hover:border-amber-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-500 disabled:opacity-60 disabled:cursor-not-allowed"
        style={{ color: C.blueBlack }}>
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 opacity-60">
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
        </svg>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold">
            {loading ? 'Checking available models…' : value || (models.length ? 'Choose an online model' : 'No models online')}
          </span>
          <span className="block truncate text-[10px] text-gray-500">
            {value && !selectedOnline && !loading ? 'Unavailable — choose another' :
              models.length === 1 ? '1 runnable model' : models.length + ' runnable models'}
          </span>
        </span>
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 opacity-60">
          <path d={open ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} />
        </svg>
      </button>
      {open && !blocked && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl"
          style={{ minWidth: 'min(100%, 280px)' }}>
          <div className="border-b border-gray-100 p-3">
            <label htmlFor={listboxId + '-search'} className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1.5">
              Search connected models
            </label>
            <input id={listboxId + '-search'} ref={searchRef}
              role="combobox" aria-autocomplete="list" aria-expanded={true}
              aria-controls={listboxId} aria-activedescendant={activeOptionId}
              aria-label="Search online models"
              type="search" autoComplete="off" value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={onSearchKeyDown}
              placeholder="Model name, family, size…"
              className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-amber-500"
              style={{ color: C.blueBlack }} />
          </div>
          <div ref={listRef} id={listboxId} role="listbox" aria-label="Runnable inference models"
            className="max-h-72 overflow-y-auto overscroll-contain p-1.5">
            <p role="status" className="px-2 py-1.5 text-[11px] text-gray-500">
              {results.length} available {results.length === 1 ? 'model' : 'models'}
            </p>
            {results.map((id, index) => (
              <button key={id} id={listboxId + '-option-' + index} type="button"
                role="option" aria-selected={id === value} tabIndex={-1}
                data-active={index === activeIndex ? 'true' : undefined}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(id)}
                className={
                  'flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left transition-colors ' +
                  (index === activeIndex ? 'bg-amber-50' : 'hover:bg-gray-50')
                }>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold" style={{ color: C.blueBlack }}>{id}</span>
                  {providerCounts[id] > 0 && (
                    <span className="block text-[11px] text-gray-500">
                      {providerCounts[id]} connected {providerCounts[id] === 1 ? 'provider' : 'providers'}
                    </span>
                  )}
                </span>
                {id === value && <span className="text-xs font-semibold" style={{ color: C.gold }}>Selected</span>}
              </button>
            ))}
            {!results.length && (
              <div className="px-3 py-6 text-center text-xs text-gray-500">
                No connected model matches your search.
              </div>
            )}
          </div>
          <div className="border-t border-gray-100 px-3 py-2 text-[10px] text-gray-500">
            ↑↓ to navigate · Enter to select · Esc to close
          </div>
        </div>
      )}
    </div>
  )
}
