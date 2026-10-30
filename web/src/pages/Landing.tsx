import { useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { C, GRADIENTS } from '../lib/theme'
import { HeroScene } from '../components/HeroScene'
import { LandingNav } from '../components/LandingNav'
import { MineralAurora } from '../components/MineralAurora'
import { LandscapeVideo } from '../components/LandscapeVideo'
import { STORY_CHAPTERS, ScrollChapterRail } from '../components/ScrollChapterRail'

const NAV_HEIGHT = 56
const LAST_CHAPTER = STORY_CHAPTERS.length - 1

// Continuous 3D movement between four stable chapter poses. The copy is bound
// to a discrete chapter, not to six unrelated fade windows.
function getSceneProgress(position: number): number {
  const lower = Math.min(LAST_CHAPTER, Math.floor(position))
  const upper = Math.min(LAST_CHAPTER, lower + 1)
  const fraction = position - lower
  return STORY_CHAPTERS[lower].sceneProgress +
    (STORY_CHAPTERS[upper].sceneProgress - STORY_CHAPTERS[lower].sceneProgress) * fraction
}

function useChapterPosition(ref: React.RefObject<HTMLDivElement | null>) {
  const [position, setPosition] = useState(0)

  useEffect(() => {
    const update = () => {
      if (!ref.current) return
      const sectionStart = ref.current.getBoundingClientRect().top + window.scrollY
      const chapterHeight = Math.max(1, window.innerHeight - NAV_HEIGHT)
      const next = Math.max(0, Math.min(LAST_CHAPTER,
        (window.scrollY - sectionStart) / chapterHeight,
      ))
      setPosition(prev => Math.abs(prev - next) > 0.002 ? next : prev)
    }

    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    update()
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [ref])

  return position
}

const CHAPTER_COPY = [
  {
    eyebrow: '01 / INFERENCE EXCHANGE',
    headline: ['Intelligence,', 'without borders.'],
    description: 'An open market for AI inference. People who need AI meet providers making their computing capacity available.',
  },
  {
    eyebrow: '02 / CONVERGENCE',
    headline: ['Two forces.', 'One intersection.'],
    description: 'Consumers request inference. Independent providers offer the hardware to serve it.',
  },
  {
    eyebrow: '03 / THE EXCHANGE',
    headline: ['Access meets', 'opportunity.'],
    description: 'Discover models and available providers. Compare price, availability and self-reported trust levels.',
  },
  {
    eyebrow: '04 / TRANSFORMATION',
    headline: ['A network', 'in motion.'],
    description: 'Computing capacity changes constantly. An open exchange connects the supply with the people who need it.',
  },
] as const

// Text floats directly on the landscape; no cards, borders or background blur.
// The soft vignette is limited to the left side, leaving the central mountain
// and reflection bright and unobstructed.
function EditorialStory({
  activeIndex,
  onSkip,
  onNext,
}: {
  activeIndex: number
  onSkip: () => void
  onNext: () => void
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      <div
        className="absolute inset-y-0 left-0 w-[88%] sm:w-[72%] lg:w-[58%]"
        aria-hidden="true"
        style={{
          background: 'linear-gradient(90deg, rgba(6,14,26,0.82) 0%, rgba(6,14,26,0.62) 42%, rgba(6,14,26,0.24) 76%, transparent 100%)',
        }}
      />
      {CHAPTER_COPY.map((chapter, index) => {
        const visible = index === activeIndex
        return (
          <section
            key={chapter.eyebrow}
            id={index === 0 ? 'landing-main' : undefined}
            aria-labelledby={'landing-chapter-title-' + index}
            aria-hidden={!visible}
            className="absolute inset-0 flex items-center px-6 sm:px-10 lg:px-[8vw]"
            style={{
              opacity: visible ? 1 : 0,
              visibility: visible ? 'visible' : 'hidden',
              transition: 'opacity 420ms ease, visibility 420ms',
              pointerEvents: visible ? 'auto' : 'none',
            }}
          >
            <div className="relative w-full max-w-lg text-left pt-8">
              <div className="flex items-center gap-3 mb-7">
                <span className="h-[2px] w-8 shrink-0" style={{ background: '#F0C77D' }} aria-hidden="true" />
                <p className="text-[11px] font-semibold tracking-[0.23em] uppercase" style={{ color: '#F6D9AA' }}>
                  {chapter.eyebrow}
                </p>
              </div>
              <h1
                id={'landing-chapter-title-' + index}
                className="text-[clamp(2.65rem,4.6vw,4.9rem)] font-semibold tracking-[-0.045em] leading-[1.06]"
                style={{ color: '#FFFFFF', textShadow: '0 2px 20px rgba(0,0,0,0.35)' }}
              >
                <span className="block">{chapter.headline[0]}</span>
                <span className="block">{chapter.headline[1]}</span>
              </h1>
              <p
                className="mt-7 text-base md:text-lg leading-relaxed max-w-[29rem]"
                style={{ color: '#F7F5F0', textShadow: '0 2px 9px rgba(0,0,0,0.5)' }}
              >
                {chapter.description}
              </p>
              {index === 0 && (
                <div className="mt-9 flex flex-wrap gap-3">
                  <Link
                    to="/chat"
                    className="rounded-lg px-5 py-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F0C77D]"
                    style={{ background: '#F2E9D4', color: '#101722' }}
                  >
                    Start chatting
                  </Link>
                  <Link
                    to="/provide"
                    className="rounded-lg px-5 py-3 text-sm font-semibold border focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F0C77D]"
                    style={{ borderColor: 'rgba(255,255,255,0.62)', color: '#FFFFFF', background: 'rgba(6,14,26,0.32)' }}
                  >
                    Become a provider
                  </Link>
                  <Link
                    to="/exchange"
                    className="rounded-lg px-5 py-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F0C77D]"
                    style={{ color: '#FFFFFF', textDecoration: 'underline', textUnderlineOffset: '5px' }}
                  >
                    Explore exchange
                  </Link>
                </div>
              )}
              {index === 2 && (
                <p className="mt-5 text-xs leading-relaxed max-w-md" style={{ color: '#E5DDC9' }}>
                  Trust levels are provider claims until independently verified. Browser chat uses TLS, not end-to-end encryption.
                </p>
              )}
              {index === 3 && (
                <button
                  type="button"
                  onClick={onSkip}
                  className="mt-8 text-sm font-semibold underline underline-offset-8 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#F0C77D]"
                  style={{ color: '#F5D49B' }}
                >
                  Enter the exchange →
                </button>
              )}
            </div>
          </section>
        )
      })}

      <div className="pointer-events-auto absolute bottom-7 left-6 sm:left-10 lg:left-[8vw] flex items-center gap-4">
        {activeIndex === 0 && (
          <button
            type="button"
            onClick={onNext}
            className="text-xs font-semibold tracking-[0.13em] uppercase focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#F0C77D]"
            style={{ color: '#FFFFFF', textShadow: '0 1px 7px rgba(0,0,0,0.8)' }}
          >
            Scroll to explore ↓
          </button>
        )}
        <button
          type="button"
          onClick={onSkip}
          className="text-xs font-medium tracking-[0.13em] uppercase focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#F0C77D]"
          style={{ color: '#ECE7DE', textShadow: '0 1px 7px rgba(0,0,0,0.8)' }}
        >
          Skip story
        </button>
      </div>
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
  const storyRef = useRef<HTMLDivElement>(null)
  const heroRef = useRef<HTMLDivElement>(null)
  const chapterPosition = useChapterPosition(storyRef)
  const activeIndex = Math.max(0, Math.min(LAST_CHAPTER, Math.round(chapterPosition)))
  const sceneProgress = getSceneProgress(chapterPosition)
  const [webglFailed, setWebglFailed] = useState(false)
  const [videoReady, setVideoReady] = useState(false)
  const [storyInView, setStoryInView] = useState(true)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [mouseX, setMouseX] = useState(0.5)
  const rawVideoOnly = new URLSearchParams(window.location.search).get('heroRaw') === '1'
  const storyEnabled = !webglFailed && !reducedMotion && !rawVideoOnly

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReducedMotion(query.matches)
    onChange()
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  // Use native browser snap points rather than forcing wheel deltas or an
  // animation library. Limit mandatory snapping to desktop-sized viewports,
  // and restore document styles when navigating away from the landing page.
  useEffect(() => {
    if (!storyEnabled) return
    const root = document.documentElement
    const previousType = root.style.scrollSnapType
    const previousPadding = root.style.scrollPaddingTop
    const desktop = window.matchMedia('(min-width: 768px)')
    const sync = () => {
      root.style.scrollSnapType = desktop.matches ? 'y mandatory' : 'none'
      root.style.scrollPaddingTop = desktop.matches ? NAV_HEIGHT + 'px' : ''
    }
    sync()
    desktop.addEventListener('change', sync)
    return () => {
      desktop.removeEventListener('change', sync)
      root.style.scrollSnapType = previousType
      root.style.scrollPaddingTop = previousPadding
    }
  }, [storyEnabled])

  useEffect(() => {
    // Once the actual marketplace takes over, remove the chapter navigation.
    const update = () => {
      const bottom = storyRef.current?.getBoundingClientRect().bottom ?? 0
      setStoryInView(prev => {
        const next = bottom > window.innerHeight * 0.65
        return prev === next ? prev : next
      })
    }
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    update()
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [])

  useEffect(() => {
    const onMove = (event: MouseEvent) => setMouseX(event.clientX / window.innerWidth)
    window.addEventListener('mousemove', onMove, { passive: true })
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  const navigateToChapter = (index: number) => {
    const story = storyRef.current
    if (!story || !storyEnabled) return
    const storyTop = story.getBoundingClientRect().top + window.scrollY
    const height = Math.max(1, window.innerHeight - NAV_HEIGHT)
    window.scrollTo({
      top: storyTop + Math.max(0, Math.min(LAST_CHAPTER, index)) * height,
      behavior: 'smooth',
    })
  }

  const skipStory = () => {
    heroRef.current?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' })
    heroRef.current?.focus({ preventScroll: true })
  }

  return (
    <>
      <LandingNav />

      <div ref={storyRef} className="relative" style={{ paddingTop: NAV_HEIGHT, background: C.blueBlack }}>
        {/* One shared stage: video, crystals and all chapter text remain aligned.
            The blank, viewport-sized chapters below are real snap targets. */}
        <div className="sticky top-14 left-0 z-10 h-[calc(100svh-3.5rem)] w-full overflow-hidden">
          <LandscapeVideo
            progress={storyEnabled ? sceneProgress : 0}
            reducedMotion={reducedMotion}
            onAvailabilityChange={setVideoReady}
          />
          {!rawVideoOnly && (
            <HeroScene
              scrollProgress={sceneProgress}
              landscapeMode={videoReady}
              reducedMotion={reducedMotion}
              onInitFailed={() => setWebglFailed(true)}
            />
          )}

          {webglFailed && (
            <div id="landing-main" className="absolute inset-0 z-30 flex flex-col items-center justify-center p-6 text-center" style={{ background: C.blueBlack }}>
              <h1 className="text-4xl font-semibold" style={{ color: C.warmWhite }}>Inference Exchange</h1>
              <p className="mt-4 max-w-lg" style={{ color: C.warmWhite }}>
                An open market connecting people who need AI inference with available compute.
              </p>
              <div className="mt-7 flex flex-wrap justify-center gap-3">
                <Link to="/chat" className="px-5 py-3 rounded-lg font-medium" style={{ background: C.warmWhite, color: C.black }}>
                  Start chatting
                </Link>
                <Link to="/provide" className="px-5 py-3 rounded-lg border" style={{ color: C.warmWhite, borderColor: C.warmWhite }}>
                  Become a provider
                </Link>
              </div>
            </div>
          )}

          {!webglFailed && !rawVideoOnly && (
            <EditorialStory
              activeIndex={storyEnabled ? activeIndex : 0}
              onSkip={skipStory}
              onNext={() => navigateToChapter(1)}
            />
          )}
        </div>
        {storyEnabled && STORY_CHAPTERS.slice(1).map((chapter) => (
          <div
            key={chapter.label}
            className="h-[calc(100svh-3.5rem)] w-full"
            style={{ scrollSnapAlign: 'start' }}
            aria-hidden="true"
          />
        ))}
        {/* The first snap point sits at the start of the photographic stage.
            It must not be the sticky child, whose painted position moves. */}
        {storyEnabled && (
          <div
            className="pointer-events-none absolute top-14 left-0 h-px w-px"
            style={{ scrollSnapAlign: 'start' }}
            aria-hidden="true"
          />
        )}
      </div>

      {storyEnabled && storyInView && (
        <ScrollChapterRail activeIndex={activeIndex} onSelect={navigateToChapter} />
      )}

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
          scrollSnapAlign: storyEnabled ? 'start' : 'none',
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
