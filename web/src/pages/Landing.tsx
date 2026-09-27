import { useState, useEffect, useRef } from 'react'
import useSWR from 'swr'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { HeroScene } from '../components/HeroScene'

// ─── Brand palette ───────────────────────────────────────────
const C = {
  red: '#B7443B',
  orange: '#D77A2F',
  gold: '#C49A45',
  white: '#D8D1BE',
  maroon: '#702F32',
  black: '#292B2A',
  green: '#3F8055',
  turquoise: '#4D9A91',
  deepBlue: '#315B72',
  blueBlack: '#292F35',
  indigo: '#4A465F',
}

// ─── Helpers ─────────────────────────────────────────────────

function useScrollProgress(ref: React.RefObject<HTMLDivElement | null>): number {
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const onScroll = () => {
      const rect = el.getBoundingClientRect()
      const total = el.scrollHeight - window.innerHeight
      const scrolled = -rect.top
      setProgress(Math.min(1, Math.max(0, scrolled / total)))
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [ref])

  return progress
}

// ─── Scroll overlay ──────────────────────────────────────────

function ScrollOverlay({ progress }: { progress: number }) {
  const overlays: {
    text: string
    sub?: string
    from: number
    peak: number
    to: number
  }[] = [
    { text: 'Inference Exchange', sub: 'Supply meets demand', from: 0.0, peak: 0.08, to: 0.22 },
    { text: 'Two forces converge', sub: 'Consumers bid. Providers offer. The exchange matches.', from: 0.15, peak: 0.25, to: 0.38 },
    { text: 'The intersection is the product', from: 0.32, peak: 0.42, to: 0.55 },
    { text: 'End-to-end encrypted', sub: 'The coordinator never sees your data. X25519 forward secrecy on every request.', from: 0.48, peak: 0.58, to: 0.68 },
    { text: 'Providers compete. You benefit.', sub: 'Price, speed, privacy — the matching engine optimizes for what you care about.', from: 0.60, peak: 0.70, to: 0.80 },
    { text: 'Private AI inference, powered by everyone.', from: 0.75, peak: 0.83, to: 0.93 },
  ]

  return (
    <div className="pointer-events-none fixed inset-0 z-20 flex items-center justify-center">
      {overlays.map((o, i) => {
        let opacity = 0
        if (progress >= o.from && progress <= o.to) {
          if (progress <= o.peak) {
            opacity = (progress - o.from) / (o.peak - o.from)
          } else {
            opacity = 1 - (progress - o.peak) / (o.to - o.peak)
          }
        }
        opacity = Math.max(0, Math.min(1, opacity))
        const yShift = (1 - opacity) * 20

        return (
          <div
            key={i}
            className="absolute text-center px-6 max-w-2xl"
            style={{ opacity, transform: `translateY(${yShift}px)`, transition: 'none' }}
          >
            <h2 style={{ color: C.white }} className="text-3xl md:text-5xl font-bold tracking-tight leading-tight">
              {o.text}
            </h2>
            {o.sub && (
              <p className="text-base md:text-lg mt-4 leading-relaxed max-w-lg mx-auto" style={{ color: '#8a8578' }}>
                {o.sub}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Live Exchange Card ──────────────────────────────────────

function LiveExchangeCard() {
  const { data: marketData } = useSWR('market', api.market, { refreshInterval: 8000 })
  const models = (marketData?.models || []) as Array<{
    model: string
    provider_count: number
    cheapest_output: number
    providers: Array<{ price_output: number }>
  }>

  // Show top 3 models by provider count
  const topModels = [...models]
    .sort((a, b) => b.provider_count - a.provider_count)
    .slice(0, 3)

  return (
    <div
      className="rounded-2xl p-6 w-full max-w-sm"
      style={{
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.08)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <div className="text-[10px] uppercase tracking-wider font-medium mb-1.5" style={{ color: C.gold }}>
        Live Exchange
      </div>
      <h3 className="text-xl font-bold mb-5" style={{ color: C.white }}>
        Supply &times; demand
      </h3>

      <div className="space-y-3.5">
        {topModels.length > 0 ? topModels.map(m => {
          const prices = m.providers?.map(p => p.price_output).filter(p => p > 0) || []
          const minPrice = prices.length ? Math.min(...prices) : m.cheapest_output
          const maxPrice = prices.length ? Math.max(...prices) : m.cheapest_output
          const priceRange = minPrice === maxPrice
            ? `$${minPrice.toFixed(2)}`
            : `$${minPrice.toFixed(2)}–$${maxPrice.toFixed(2)}`

          return (
            <div key={m.model} className="flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-sm font-medium truncate" style={{ color: C.white }}>
                  {m.model}
                </span>
              </div>
              <div className="flex items-center gap-4 shrink-0 text-right">
                <span className="text-xs" style={{ color: '#8a8578' }}>
                  {m.provider_count} provider{m.provider_count !== 1 ? 's' : ''}
                </span>
                <span className="text-sm font-semibold" style={{ color: C.gold }}>
                  {priceRange}
                </span>
              </div>
            </div>
          )
        }) : (
          <>
            {[1, 2, 3].map(i => (
              <div key={i} className="flex items-center justify-between">
                <div className="h-3 rounded-full w-28" style={{ background: 'rgba(255,255,255,0.06)' }} />
                <div className="h-3 rounded-full w-16" style={{ background: 'rgba(255,255,255,0.06)' }} />
              </div>
            ))}
          </>
        )}
      </div>

      <div className="mt-5 pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="text-[10px] uppercase tracking-wider font-medium" style={{ color: C.gold }}>
          End-to-end encrypted
        </div>
        <div className="text-xs mt-0.5" style={{ color: '#8a8578' }}>
          Coordinator never sees your prompt.
        </div>
      </div>
    </div>
  )
}

// ─── Main ────────────────────────────────────────────────────

export function Landing() {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const progress = useScrollProgress(scrollContainerRef)
  const [webglFailed, setWebglFailed] = useState(false)

  const sequenceDone = progress >= 0.95

  return (
    <>
      {/* ── Scroll sequence ──────────────────────────────── */}
      <div ref={scrollContainerRef} style={{ height: webglFailed ? '100vh' : '500vh' }} className="relative">
        <div className="sticky top-0 left-0 w-full h-screen overflow-hidden z-10">
          <HeroScene scrollProgress={progress} onInitFailed={() => setWebglFailed(true)} />

          {webglFailed && (
            <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: C.black }}>
              <img
                src="/logo-icon.svg"
                alt="Inference Exchange"
                className="w-40 h-40 md:w-56 md:h-56 animate-spin"
                style={{ animationDuration: '20s' }}
              />
              <h1 className="text-3xl md:text-5xl font-bold tracking-tight mt-8 text-center px-6" style={{ color: C.white }}>
                Private AI inference,{' '}
                <span style={{ color: C.red }}>powered by everyone.</span>
              </h1>
              <p className="text-base mt-4 max-w-md text-center px-6" style={{ color: '#8a8578' }}>
                Providers compete to serve your requests. Prompts and responses are encrypted end-to-end.
              </p>
              <div className="flex gap-3 mt-8">
                <Link to="/chat" className="px-6 py-3 rounded-2xl font-medium text-sm transition-colors" style={{ background: C.white, color: C.black }}>
                  Start a conversation &rarr;
                </Link>
                <Link to="/providers" className="px-6 py-3 rounded-2xl font-medium text-sm border transition-colors" style={{ color: C.white, borderColor: 'rgba(216,209,190,0.3)', background: 'rgba(216,209,190,0.08)' }}>
                  Become a provider
                </Link>
              </div>
            </div>
          )}

          <ScrollOverlay progress={progress} />

          <div
            className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 z-30 transition-opacity duration-500"
            style={{ opacity: progress < 0.05 ? 1 : 0 }}
          >
            <span className="text-xs tracking-wider uppercase" style={{ color: '#8a8578' }}>Scroll / explore</span>
            <div className="w-5 h-8 rounded-full flex items-start justify-center p-1.5" style={{ border: `1px solid ${C.indigo}` }}>
              <div className="w-1 h-2 rounded-full animate-bounce" style={{ background: C.white }} />
            </div>
          </div>
        </div>
      </div>

      {/* ── Hero section (after scroll) ──────────────────── */}
      <div
        className="relative z-10 min-h-screen flex flex-col"
        style={{
          background: C.blueBlack,
          opacity: webglFailed || sequenceDone ? 1 : 0,
          transition: 'opacity 0.6s ease',
        }}
      >
        {/* Top bar */}
        <div className="max-w-7xl mx-auto w-full px-6 md:px-10 py-5 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <img src="/logo-icon.svg" alt="IE" className="w-6 h-6" />
            <span className="text-sm font-semibold uppercase tracking-wider" style={{ color: C.gold }}>
              Inference Exchange
            </span>
          </Link>
          <span className="text-xs hidden sm:block" style={{ color: '#8a8578' }}>
            Open protocol. Open marketplace.
          </span>
        </div>

        {/* Hero content: headline left, live exchange card right */}
        <div className="flex-1 flex items-center">
          <div className="max-w-7xl mx-auto w-full px-6 md:px-10 py-12">
            <div className="flex flex-col lg:flex-row items-center justify-between gap-12 lg:gap-16">
            {/* Left: headline + CTAs */}
            <div className="flex-1 max-w-xl">
              <h1 className="text-4xl md:text-5xl font-bold tracking-tight leading-[1.1]" style={{ color: C.white }}>
                Private AI inference,
                <br />
                <span
                  className="bg-clip-text text-transparent"
                  style={{ backgroundImage: `linear-gradient(to right, ${C.gold}, ${C.orange}, ${C.red})` }}
                >
                  powered by everyone.
                </span>
              </h1>

              <p className="text-base mt-6 leading-relaxed max-w-md" style={{ color: '#8a8578' }}>
                OpenAI-compatible inference with a live supply side.
                Your request is routed by price, speed and trust. Providers compete to serve it.
              </p>

              <div className="flex gap-3 mt-8">
                <Link
                  to="/chat"
                  className="px-6 py-3 rounded-xl font-medium text-sm transition-colors"
                  style={{ background: C.white, color: C.blueBlack }}
                >
                  Start a conversation
                </Link>
                <Link
                  to="/providers"
                  className="px-6 py-3 rounded-xl font-medium text-sm border transition-colors"
                  style={{
                    color: C.white,
                    borderColor: 'rgba(216,209,190,0.25)',
                    background: 'rgba(216,209,190,0.06)',
                  }}
                >
                  Become a provider
                </Link>
              </div>
            </div>

            {/* Right: live exchange card */}
            <div className="w-full lg:w-auto flex justify-center lg:justify-end">
              <LiveExchangeCard />
            </div>
          </div>
          </div>
        </div>
      </div>
    </>
  )
}
