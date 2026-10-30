import { useState, useEffect, useRef } from 'react'
import useSWR from 'swr'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { C, GRADIENTS } from '../lib/theme'
import { HeroScene } from '../components/HeroScene'
import { LandingNav } from '../components/LandingNav'
import { MineralAurora } from '../components/MineralAurora'
import { LandscapeVideo } from '../components/LandscapeVideo'
import { ScrollChapterRail } from '../components/ScrollChapterRail'

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

// A localized dark text surface keeps copy readable against bright snow
// without darkening or blurring the scenic video across the whole screen.
const SCENE_TEXT_SURFACE = {
  background: 'linear-gradient(135deg, rgba(8, 15, 25, 0.82), rgba(8, 15, 25, 0.70))',
  border: '1px solid rgba(255, 255, 255, 0.16)',
  boxShadow: '0 18px 60px rgba(0, 0, 0, 0.26)',
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
    // Starts after the first-viewport intro fades (#107), so the two do not overlap
    { text: 'Supply meets demand', from: 0.06, peak: 0.12, to: 0.22 },
    { text: 'Two forces converge', sub: 'Consumers bid. Providers offer. The exchange matches.', from: 0.15, peak: 0.25, to: 0.38 },
    { text: 'The intersection is the product', from: 0.32, peak: 0.42, to: 0.55 },
    // #87/#107: match the real browser path. Do not claim E2E or verified trust.
    { text: 'Trust is labelled, not assumed', sub: 'Providers report a trust level. The exchange shows it as claimed until evidence verifies it. Browser chat uses TLS; it is not end-to-end encrypted.', from: 0.48, peak: 0.58, to: 0.68 },
    { text: 'Providers compete. You benefit.', sub: 'Price, speed, privacy — the matching engine optimizes for what you care about.', from: 0.60, peak: 0.70, to: 0.80 },
    { text: 'Distributed AI inference, powered by everyone.', from: 0.75, peak: 0.83, to: 0.93 },
  ]

  return (
    <div className="pointer-events-none fixed inset-x-0 top-14 bottom-0 z-20 flex items-center justify-center">
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
            className="absolute w-full max-w-2xl px-5 text-center"
            style={{ opacity, transform: `translateY(${yShift}px)`, transition: 'none' }}
          >
            <div className="rounded-2xl px-5 py-6 md:px-9 md:py-8" style={SCENE_TEXT_SURFACE}>
              <div className="mx-auto mb-4 h-0.5 w-20 rounded-full" aria-hidden="true" style={{ background: GRADIENTS.heroText }} />
              <h2 className="text-3xl md:text-5xl font-bold tracking-tight leading-tight" style={{ color: '#F8F6F1', textShadow: '0 2px 12px rgba(0,0,0,0.45)' }}>
                {o.text}
              </h2>
              {o.sub && (
                <p className="text-base md:text-lg mt-4 leading-relaxed max-w-lg mx-auto" style={{ color: '#F1ECE4' }}>
                  {o.sub}
                </p>
              )}
            </div>
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
      className="rounded-2xl p-6 w-full max-w-sm mineral-border"
      style={{
        background: 'rgba(255,255,255,0.06)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <div className="text-[10px] uppercase tracking-wider font-medium mb-1.5" style={{ color: C.gold }}>
        Live Exchange
      </div>
      <h3 className="text-xl font-bold mb-5" style={{ color: C.warmWhite }}>
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
                <span className="text-sm font-medium truncate" style={{ color: C.warmWhite }}>
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
          Trust levels are claims
        </div>
        <div className="text-xs mt-0.5" style={{ color: '#a9a294' }}>
          Shown as self-reported until verified. Browser chat uses TLS, not end-to-end encryption.
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
  const [mouseX, setMouseX] = useState(0.5)
  const [videoReady, setVideoReady] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)
  // Video-only A/B review: /?heroRaw=1 removes all canvas/FX layers.
  const rawVideoOnly = new URLSearchParams(window.location.search).get('heroRaw') === '1'

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReducedMotion(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  const [skipped, setSkipped] = useState(false)
  const heroRef = useRef<HTMLDivElement>(null)
  const sequenceDone = progress >= 0.95
  const storyEnabled = !webglFailed && !reducedMotion
  const heroVisible = webglFailed || reducedMotion || sequenceDone || skipped
  const introVisible = !rawVideoOnly && (progress < 0.06 || reducedMotion) && !webglFailed

  const jumpToChapter = (at: number) => {
    const container = scrollContainerRef.current
    if (!container) return
    const start = container.getBoundingClientRect().top + window.scrollY
    const distance = Math.max(0, container.offsetHeight - window.innerHeight)
    window.scrollTo({ top: start + at * distance, behavior: 'smooth' })
  }

  // Skip intro: show the product hero at once. Do not require the scroll story.
  const skipIntro = () => {
    setSkipped(true)
    requestAnimationFrame(() => {
      heroRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' })
      heroRef.current?.focus({ preventScroll: true })
    })
  }

  // Track mouse position for cursor-reactive aurora
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      setMouseX(e.clientX / window.innerWidth)
    }
    window.addEventListener('mousemove', onMove, { passive: true })
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  return (
    <>
      <LandingNav />
      {/* The opaque 3.5rem navbar owns its own vertical space. All scene layers
          share the same sticky viewport beneath it: no footage behind the nav. */}
      {/* ── Scroll sequence ──────────────────────────────── */}
      <div
        ref={scrollContainerRef}
        style={{
          height: storyEnabled ? '350vh' : '100svh',
          paddingTop: '3.5rem',
          background: C.blueBlack,
        }}
        className="relative box-border"
      >
        <div className="sticky top-14 left-0 w-full h-[calc(100svh-3.5rem)] overflow-hidden z-10">
          <LandscapeVideo progress={progress} reducedMotion={reducedMotion} onAvailabilityChange={setVideoReady} />
          {!rawVideoOnly && (
            <HeroScene
              scrollProgress={progress}
              landscapeMode={videoReady}
              reducedMotion={reducedMotion}
              onInitFailed={() => setWebglFailed(true)}
            />
          )}

          {webglFailed && (
            <div id="landing-main" className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: C.black }}>
              <img
                src="/logo-icon.svg"
                alt="Inference Exchange"
                className="w-40 h-40 md:w-56 md:h-56 animate-spin"
                style={{ animationDuration: '20s' }}
              />
              <h1 className="text-3xl md:text-5xl font-bold tracking-tight mt-8 text-center px-6" style={{ color: C.warmWhite }}>
                Distributed AI inference,{' '}
                <span style={{ color: C.red }}>powered by everyone.</span>
              </h1>
              <p className="text-base mt-4 max-w-md text-center px-6" style={{ color: '#a9a294' }}>
                Providers compete to serve your requests. The exchange routes each request by price, speed and the trust level you choose.
              </p>
              <div className="flex gap-3 mt-8">
                <Link to="/chat" className="px-6 py-3 rounded-2xl font-medium text-sm transition-colors" style={{ background: C.warmWhite, color: C.black }}>
                  Start a conversation &rarr;
                </Link>
                <Link to="/provide" className="px-6 py-3 rounded-2xl font-medium text-sm border transition-colors" style={{ color: C.warmWhite, borderColor: 'rgba(216,209,190,0.3)', background: 'rgba(216,209,190,0.08)' }}>
                  Become a provider
                </Link>
              </div>
            </div>
          )}

          {storyEnabled && !rawVideoOnly && <ScrollOverlay progress={progress} />}

          {/* First viewport: what IE is, and how to use it, with no scroll (#107 P0) */}
          {!webglFailed && (
            <section
              id="landing-main"
              aria-labelledby="landing-title"
              className="absolute inset-0 z-30 flex flex-col items-center justify-center px-6 text-center transition-opacity duration-300"
              style={{
                opacity: introVisible ? 1 : 0,
                visibility: introVisible ? 'visible' : 'hidden',
                pointerEvents: introVisible ? 'auto' : 'none',
              }}
            >
              <div className="w-full max-w-2xl rounded-3xl px-5 py-7 md:px-10 md:py-10" style={SCENE_TEXT_SURFACE}>
                <h1 id="landing-title" className="text-4xl md:text-6xl font-bold tracking-tight" style={{ color: '#F8F6F1', textShadow: '0 2px 12px rgba(0,0,0,0.45)' }}>
                  Inference Exchange
                </h1>
                <p className="mt-4 max-w-xl mx-auto text-base md:text-lg leading-relaxed" style={{ color: '#F1ECE4' }}>
                  An open market for AI inference. Send OpenAI-compatible requests; providers with spare hardware compete to serve them.
                </p>
                <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                  <Link to="/chat" className="px-6 py-3 rounded-xl text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E8C77A]" style={{ background: C.warmWhite, color: C.black }}>
                    Start chatting
                  </Link>
                  <Link to="/provide" className="px-6 py-3 rounded-xl text-sm font-medium border focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E8C77A]" style={{ color: '#F8F6F1', borderColor: 'rgba(255,255,255,0.42)', background: 'rgba(14,16,24,0.76)' }}>
                    Become a provider
                  </Link>
                  <Link to="/exchange" className="px-6 py-3 rounded-xl text-sm font-medium border focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E8C77A]" style={{ color: '#F8F6F1', borderColor: 'rgba(255,255,255,0.34)', background: 'rgba(14,16,24,0.76)' }}>
                    Go to Exchange
                  </Link>
                </div>
              </div>
              <div className="absolute bottom-8 flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => reducedMotion ? skipIntro() : jumpToChapter(0.20)}
                  className="text-xs tracking-wider uppercase px-3 py-2 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E8C77A]"
                  style={{ color: '#F8F6F1', background: 'rgba(8,15,25,0.76)', textShadow: '0 1px 4px rgba(0,0,0,0.45)' }}
                >
                  {reducedMotion ? 'Explore the product ↓' : 'Explore the story ↓'}
                </button>
                <button
                  type="button"
                  onClick={skipIntro}
                  className="text-xs tracking-wider uppercase px-3 py-2 rounded-lg border focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E8C77A]"
                  style={{ color: '#F8F6F1', borderColor: 'rgba(255,255,255,0.42)', background: 'rgba(8,15,25,0.76)' }}
                >
                  Skip intro
                </button>
              </div>
            </section>
          )}
        </div>
      </div>

      {storyEnabled && progress < 0.98 && <ScrollChapterRail progress={progress} onSelect={jumpToChapter} />}

      {/* ── Mineral spectrum divider ─────────────────── */}
      <div
        className="relative z-10 h-[2px]"
        style={{ background: GRADIENTS.fullSpectrum }}
      />

      {/* ── Hero section (after scroll) ──────────────────── */}
      <div
        ref={heroRef}
        tabIndex={-1}
        aria-label="Inference Exchange product overview"
        className="relative z-10 min-h-screen flex flex-col overflow-hidden pt-14 outline-none"
        style={{
          background: C.blueBlack,
          opacity: heroVisible ? 1 : 0,
          // Hidden content must not take keyboard focus
          visibility: heroVisible ? 'visible' : 'hidden',
          transition: 'opacity 0.6s ease, visibility 0.6s',
        }}
      >
        {/* Living mineral aurora — cursor-reactive behind hero content */}
        <div className="absolute inset-0 z-0">
          <MineralAurora variant="dark" opacity={0.18} speed={0.0004} mouseX={mouseX} className="absolute inset-0" />
        </div>

        {/* Hero content: headline left, live exchange card right */}
        <div className="relative z-10 flex-1 flex items-center">
          <div className="max-w-7xl mx-auto w-full px-6 md:px-10 py-12">
            <div className="flex flex-col lg:flex-row items-center justify-between gap-12 lg:gap-16">
            {/* Left: headline + CTAs */}
            <div className="flex-1 max-w-xl">
              <h2 className="text-4xl md:text-5xl font-bold tracking-tight leading-[1.1]" style={{ color: C.warmWhite }}>
                Distributed AI inference,
                <br />
                <span
                  className="bg-clip-text text-transparent"
                  style={{ backgroundImage: GRADIENTS.heroText }}
                >
                  powered by everyone.
                </span>
              </h2>

              <p className="text-base mt-6 leading-relaxed max-w-md" style={{ color: '#8a8578' }}>
                OpenAI-compatible inference with a live supply side.
                Your request is routed by price, speed and trust. Providers compete to serve it.
              </p>

              <div className="flex gap-3 mt-8">
                <Link
                  to="/chat"
                  className="group relative px-6 py-3 rounded-xl font-medium text-sm transition-all overflow-hidden"
                  style={{ color: C.blueBlack }}
                >
                  <span className="absolute inset-0 rounded-xl transition-opacity" style={{ background: C.warmWhite }} />
                  <span className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: GRADIENTS.heroText }} />
                  <span className="relative z-10 group-hover:text-white transition-colors">Start a conversation</span>
                </Link>
                <Link
                  to="/provide"
                  className="group relative px-6 py-3 rounded-xl font-medium text-sm border transition-all overflow-hidden mineral-border"
                  style={{
                    color: C.warmWhite,
                    background: 'rgba(216,209,190,0.06)',
                  }}
                >
                  <span className="relative z-10">Become a provider</span>
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
