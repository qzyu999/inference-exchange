import { useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { C, HERO_PIGMENTS as HP } from '../lib/theme'
import { HeroScene } from '../components/HeroScene'
import { LandingNav } from '../components/LandingNav'
import { MineralFlowField } from '../components/MineralFlowField'
import { LandscapeVideo } from '../components/LandscapeVideo'
import { STORY_CHAPTERS, ScrollChapterRail } from '../components/ScrollChapterRail'

const NAV_HEIGHT = 56
const LAST_CHAPTER = STORY_CHAPTERS.length - 1
const EXIT_POSITION = STORY_CHAPTERS.length
// The earlier chapters retain their leisurely holds. For the final sand-blow
// effect, use a longer, separate 2.2-viewport scroll segment instead of
// squeezing the whole gust into the last 40% of one viewport.
const CHAPTER_HOLD = 0.60
const FINAL_HOLD_UNITS = 0.35
const FINAL_SCROLL_UNITS = LAST_CHAPTER + 2.2
const SCENE_POSES = [...STORY_CHAPTERS.map(chapter => chapter.sceneProgress), 1]

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function smoothstep(value: number): number {
  const x = clamp01(value)
  return x * x * (3 - 2 * x)
}

// Apple-style pacing, without intercepting the wheel or forcing a snap:
// holding phase -> eased reversible transition -> holding phase.
function getStoryPosition(scrollUnits: number): number {
  const raw = Math.max(0, Math.min(FINAL_SCROLL_UNITS, scrollUnits))
  if (raw >= FINAL_SCROLL_UNITS) return EXIT_POSITION
  if (raw >= LAST_CHAPTER) {
    // The crystal gust occupies 1.85 full viewport-heights of natural,
    // reversible scrolling. A short hold lets the user read Transformation.
    const transition = smoothstep(
      (raw - LAST_CHAPTER - FINAL_HOLD_UNITS) /
      (FINAL_SCROLL_UNITS - LAST_CHAPTER - FINAL_HOLD_UNITS),
    )
    return LAST_CHAPTER + transition
  }
  const chapter = Math.floor(raw)
  const within = raw - chapter
  const transition = smoothstep((within - CHAPTER_HOLD) / (1 - CHAPTER_HOLD))
  return chapter + transition
}

function getSceneProgress(position: number): number {
  const lower = Math.min(LAST_CHAPTER, Math.floor(position))
  const upper = Math.min(EXIT_POSITION, lower + 1)
  const fraction = clamp01(position - lower)
  return SCENE_POSES[lower] + (SCENE_POSES[upper] - SCENE_POSES[lower]) * fraction
}

function useScrollUnits(ref: React.RefObject<HTMLDivElement | null>) {
  const [units, setUnits] = useState(0)

  useEffect(() => {
    const update = () => {
      if (!ref.current) return
      const sectionStart = ref.current.getBoundingClientRect().top + window.scrollY
      const chapterHeight = Math.max(1, window.innerHeight - NAV_HEIGHT)
      const next = Math.max(0, Math.min(FINAL_SCROLL_UNITS,
        (window.scrollY - sectionStart) / chapterHeight,
      ))
      setUnits(prev => Math.abs(prev - next) > 0.001 ? next : prev)
    }

    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    update()
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [ref])

  return units
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

// Warm painted silk and gold pigment over the untouched mountain landscape.
// Legibility comes from lapis / indigo ink hugging the letterforms, never black
// shading across the photographic scene.
const HERO_TITLE_SHADOW = '0 1px 2px rgba(43,34,72,0.94), 0 3px 8px rgba(19,49,99,0.76), 0 7px 17px rgba(43,34,72,0.48)'
const HERO_BODY_SHADOW = '0 1px 2px rgba(43,34,72,0.98), 0 2px 7px rgba(19,49,99,0.79), 0 4px 13px rgba(43,34,72,0.54)'
const HERO_PIGMENT_RULE = `linear-gradient(90deg, ${HP.lapis} 0%, ${HP.saffron} 24%, ${HP.orpiment} 44%, ${HP.cinnabar} 67%, ${HP.jade} 87%, transparent 100%)`
const HERO_PIGMENT_WORD = `linear-gradient(95deg, ${HP.cream} 0%, ${HP.orpiment} 29%, ${HP.saffron} 52%, ${HP.cinnabar} 76%, #F1CE91 100%)`
const HERO_PRODUCT_GRADIENT = `linear-gradient(90deg, ${HP.orpiment} 0%, ${HP.saffron} 28%, ${HP.coralLotus} 64%, #C2E1B7 100%)`

// No landscape tint. All contrast stays within text glyphs and controls.
// Debug-only visual centerline, at the same 50% stage x used by the video.
const SHOW_ALIGNMENT_GUIDES = new URLSearchParams(window.location.search).get('heroGuides') === '1'

function EditorialStory({
  activeIndex,
  exitProgress,
  onSkip,
  onNext,
}: {
  activeIndex: number
  exitProgress: number
  onSkip: () => void
  onNext: () => void
}) {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-20"
      data-hero-shade="off"
      style={{ opacity: 1 - exitProgress }}
    >
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
              pointerEvents: visible && exitProgress < 0.95 ? 'auto' : 'none',
            }}
          >
            <div className="relative w-full max-w-lg text-left pt-8">
              {/* Pigment striation and a tiny faceted mineral chip, not a
                  decorative religious motif. The scene itself remains clear. */}
              <div className="flex items-center gap-3 mb-6">
                <span className="flex h-2 w-11 shrink-0 items-center" aria-hidden="true">
                  <span className="block h-px w-9" style={{ background: HERO_PIGMENT_RULE, boxShadow: '0 1px 3px rgba(43,34,72,0.55)' }} />
                  <span className="block h-[5px] w-[5px] rotate-45" style={{ background: index % 2 === 0 ? HP.cinnabar : HP.jade, boxShadow: '0 0 0 1px rgba(240,197,75,0.75), 0 1px 4px rgba(43,34,72,0.6)' }} />
                </span>
                <p className="text-[11px] font-semibold tracking-[0.24em] uppercase" style={{ color: HP.label, textShadow: HERO_BODY_SHADOW }}>
                  {chapter.eyebrow}
                </p>
              </div>
              <h1
                id={'landing-chapter-title-' + index}
                className="text-[clamp(2.65rem,4.6vw,4.9rem)] font-semibold tracking-[-0.045em] leading-[1.06]"
                style={{ color: HP.cream, textShadow: HERO_TITLE_SHADOW, WebkitTextStroke: '0.65px rgba(43,34,72,0.83)' }}
              >
                <span className="block">{chapter.headline[0]}</span>
                <span className="block hero-pigment-ink" style={{ backgroundImage: HERO_PIGMENT_WORD }}>{chapter.headline[1]}</span>
              </h1>
              <div className="mt-5 flex items-center gap-2" aria-hidden="true">
                <span className="block h-px w-24 sm:w-28" style={{ background: HERO_PIGMENT_RULE, boxShadow: '0 1px 3px rgba(43,34,72,0.55)' }} />
                <span className="block h-1 w-1 rotate-45" style={{ background: HP.orpiment, boxShadow: '0 0 0 1px rgba(255,237,179,0.63)' }} />
              </div>
              <p
                className="mt-5 text-base md:text-lg font-medium leading-relaxed max-w-[29rem]"
                style={{ color: HP.silk, textShadow: HERO_BODY_SHADOW, WebkitTextStroke: '0.24px rgba(43,34,72,0.62)' }}
              >
                {chapter.description}
              </p>
              {index === 0 && (
                <div className="mt-9 flex flex-wrap items-center gap-3">
                  <Link
                    to="/chat"
                    className="hero-pigment-primary inline-flex items-center gap-2 rounded-md px-5 py-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F2D59C]"
                  >
                    <span aria-hidden="true" className="h-[6px] w-[6px] shrink-0 rotate-45" style={{ background: HP.cinnabar, boxShadow: '0 0 0 1px rgba(255,230,174,0.72)' }} />
                    Start chatting
                  </Link>
                  <Link
                    to="/provide"
                    className="hero-pigment-secondary inline-flex items-center gap-2 rounded-md px-5 py-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F2D59C]"
                  >
                    <span aria-hidden="true" className="h-[6px] w-[6px] shrink-0 rotate-45" style={{ background: HP.jade, boxShadow: '0 0 0 1px rgba(240,197,75,0.72)' }} />
                    Become a provider
                  </Link>
                  <Link
                    to="/exchange"
                    className="hero-pigment-link px-1 py-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F2D59C]"
                    style={{ textShadow: HERO_BODY_SHADOW }}
                  >
                    Explore exchange
                  </Link>
                </div>
              )}
              {index === 2 && (
                <p className="mt-5 text-xs leading-relaxed max-w-md" style={{ color: HP.silk, textShadow: HERO_BODY_SHADOW }}>
                  Trust levels are provider claims until independently verified. Browser chat uses TLS; it is not end-to-end encrypted.
                </p>
              )}
              {index === 3 && (
                <button
                  type="button"
                  onClick={onSkip}
                  className="hero-pigment-link mt-8 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#F2D59C]"
                  style={{ textShadow: HERO_BODY_SHADOW }}
                >
                  Enter the exchange →
                </button>
              )}
            </div>
          </section>
        )
      })}

      <div
        className="absolute bottom-7 left-6 sm:left-10 lg:left-[8vw] flex items-center gap-4"
        style={{ pointerEvents: exitProgress < 0.95 ? 'auto' : 'none' }}
      >
        {activeIndex === 0 && (
          <button
            type="button"
            onClick={onNext}
            className="text-xs font-semibold tracking-[0.13em] uppercase focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#F0C77D]"
            style={{ color: HP.cream, textShadow: HERO_BODY_SHADOW }}
          >
            Scroll to explore ↓
          </button>
        )}
        <button
          type="button"
          onClick={onSkip}
          className="text-xs font-medium tracking-[0.13em] uppercase focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#F0C77D]"
          style={{ color: HP.cream, textShadow: HERO_BODY_SHADOW }}
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
        background: 'rgba(16,45,109,0.76)',
        border: '1px solid rgba(240,197,75,0.42)',
        boxShadow: '0 12px 40px rgba(30,28,74,0.26), inset 0 1px 0 rgba(251,244,228,0.12)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <div className="text-[10px] uppercase tracking-wider font-medium mb-1.5" style={{ color: HP.orpiment }}>
        Live Exchange
      </div>
      <h3 className="text-xl font-bold mb-5" style={{ color: HP.cream }}>
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
                <span className="text-sm font-medium truncate" style={{ color: HP.cream }}>
                  {m.model}
                </span>
              </div>
              <div className="flex items-center gap-4 shrink-0 text-right">
                <span className="text-xs" style={{ color: '#E8C9A3' }}>
                  {m.provider_count} provider{m.provider_count !== 1 ? 's' : ''}
                </span>
                <span className="text-sm font-semibold" style={{ color: HP.orpiment }}>
                  {priceRange}
                </span>
              </div>
            </div>
          )
        }) : (
          <>
            {[1, 2, 3].map(i => (
              <div key={i} className="flex items-center justify-between">
                <div className="h-3 rounded-full w-28" style={{ background: 'rgba(240,197,75,0.12)' }} />
                <div className="h-3 rounded-full w-16" style={{ background: 'rgba(240,197,75,0.12)' }} />
              </div>
            ))}
          </>
        )}
      </div>

      <div className="mt-5 pt-4" style={{ borderTop: '1px solid rgba(240,197,75,0.25)' }}>
        <div className="text-[10px] uppercase tracking-wider font-medium" style={{ color: HP.orpiment }}>
          Trust levels are claims
        </div>
        <div className="text-xs mt-0.5" style={{ color: HP.silk }}>
          Shown as self-reported until verified. Browser chat uses TLS; it is not end-to-end encrypted.
        </div>
      </div>
    </div>
  )
}

// ─── Main ────────────────────────────────────────────────────

export function Landing() {
  const storyRef = useRef<HTMLDivElement>(null)
  const heroRef = useRef<HTMLElement>(null)
  const scrollUnits = useScrollUnits(storyRef)
  const chapterPosition = getStoryPosition(scrollUnits)
  // Keep the outgoing headline readable until the visual transition is
  // mostly complete, then cross-fade to the next chapter's stable state.
  const activeIndex = Math.max(0, Math.min(LAST_CHAPTER, Math.floor(chapterPosition + 0.20)))
  const sceneProgress = getSceneProgress(chapterPosition)
  const [webglFailed, setWebglFailed] = useState(false)
  const [videoReady, setVideoReady] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)
  const rawVideoOnly = new URLSearchParams(window.location.search).get('heroRaw') === '1'
  const storyEnabled = !webglFailed && !reducedMotion && !rawVideoOnly
  const exitProgress = storyEnabled ? clamp01(chapterPosition - LAST_CHAPTER) : 1
  // The same pinned scene becomes the product screen during the gust.
  // The last 0.85 viewport remains on that finished screen for reading.
  const productOpacity = rawVideoOnly ? 0 : storyEnabled
    ? smoothstep((exitProgress - 0.53) / 0.42)
    : 1
  const skipRequestedRef = useRef(false)

  useEffect(() => {
    if (productOpacity > 0.95 && skipRequestedRef.current) {
      heroRef.current?.focus({ preventScroll: true })
      skipRequestedRef.current = false
    }
  }, [productOpacity])

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReducedMotion(query.matches)
    onChange()
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  // Keep the browser's native, continuous scroll momentum. This page must
  // never trap trackpad/wheel input with mandatory snapping. Explicit chapter
  // clicks still scroll smoothly to the start of a chapter's reading hold.
  useEffect(() => {
    const root = document.documentElement
    const previousType = root.style.scrollSnapType
    const previousPadding = root.style.scrollPaddingTop
    root.style.scrollSnapType = 'none'
    root.style.scrollPaddingTop = ''
    return () => {
      root.style.scrollSnapType = previousType
      root.style.scrollPaddingTop = previousPadding
    }
  }, [])

  const navigateToChapter = (index: number) => {
    const story = storyRef.current
    if (!story || !storyEnabled) return
    const storyTop = story.getBoundingClientRect().top + window.scrollY
    const height = Math.max(1, window.innerHeight - NAV_HEIGHT)
    window.scrollTo({
      top: storyTop + Math.max(0, Math.min(LAST_CHAPTER, index)) * height,
      behavior: reducedMotion ? 'auto' : 'smooth',
    })
  }

  const skipStory = () => {
    if (!storyEnabled || !storyRef.current) {
      heroRef.current?.focus({ preventScroll: true })
      return
    }
    skipRequestedRef.current = true
    const storyTop = storyRef.current.getBoundingClientRect().top + window.scrollY
    const height = Math.max(1, window.innerHeight - NAV_HEIGHT)
    // Scroll to the final in-place product pose, not to the fixed/sticky DOM
    // element. scrollIntoView on a pinned element cannot reach its timeline.
    window.scrollTo({
      top: storyTop + FINAL_SCROLL_UNITS * height,
      behavior: 'smooth',
    })
  }

  return (
    <>
      <LandingNav />

      <div ref={storyRef} className="relative" style={{ paddingTop: NAV_HEIGHT, background: C.blueBlack }}>
        {/* One pinned stage: the world stays in place as browser scrolling
            advances through reading holds, then smooth, reversible transitions. */}
        <div className="sticky top-14 left-0 z-10 h-[calc(100svh-3.5rem)] w-full overflow-hidden">
          <LandscapeVideo
            progress={rawVideoOnly ? 0 : storyEnabled ? sceneProgress : 1}
            reducedMotion={reducedMotion}
            onAvailabilityChange={setVideoReady}
          />
          {/* Dissolution completes on this same pinned canvas: mineral ribbons
              emerge as the video dims, beneath the original crystal geometry. */}
          {!rawVideoOnly && (
            <MineralFlowField
              className="absolute inset-0 z-[1]"
              opacity={storyEnabled ? clamp01((sceneProgress - 0.82) / 0.18) : 1}
              progress={storyEnabled ? clamp01((sceneProgress - 0.82) / 0.18) : 1}
            />
          )}
          {storyEnabled && (
            <HeroScene
              scrollProgress={sceneProgress}
              landscapeMode={videoReady}
              reducedMotion={reducedMotion}
              onInitFailed={() => setWebglFailed(true)}
            />
          )}

          {storyEnabled && (
            <EditorialStory
              activeIndex={storyEnabled ? activeIndex : 0}
              exitProgress={exitProgress}
              onSkip={skipStory}
              onNext={() => navigateToChapter(1)}
            />
          )}
          {SHOW_ALIGNMENT_GUIDES && (
            <div className="pointer-events-none absolute inset-0 z-50" aria-hidden="true">
              <div className="absolute inset-y-0 left-1/2 border-l border-dashed border-amber-300/90" />
              <span
                className="absolute left-1/2 top-3 -translate-x-1/2 rounded px-2 py-1 text-[10px] font-mono tracking-wide text-white"
                style={{ background: 'rgba(4,10,20,0.82)' }}
              >
                Video center / camera axis
              </span>
              <span className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-amber-300 bg-amber-300/40" />
            </div>
          )}
          {/* One actual product screen, revealed in-place over the very same
              pigment canvas. It is NOT a second page or second WebGL field. */}
          {!rawVideoOnly && (
            <section
              id={storyEnabled ? 'inference-exchange-product' : 'landing-main'}
              ref={heroRef}
              tabIndex={-1}
              aria-label="Inference Exchange product overview"
              aria-hidden={productOpacity < 0.95}
              className="absolute inset-0 z-30 overflow-y-auto md:overflow-visible outline-none"
              style={{
                opacity: productOpacity,
                visibility: productOpacity > 0.001 ? 'visible' : 'hidden',
                pointerEvents: productOpacity > 0.95 ? 'auto' : 'none',
              }}
            >
            {/* Hero content: headline left, live exchange card right */}
            <div className="relative z-10 min-h-full flex items-center">
              <div className="max-w-7xl mx-auto w-full px-6 md:px-10 py-12">
                <div className="flex flex-col lg:flex-row items-center justify-between gap-12 lg:gap-16">
                {/* Left: headline + CTAs */}
                <div className="flex-1 max-w-xl">
                  <h2 className="text-4xl md:text-5xl font-bold tracking-tight leading-[1.1]" style={{ color: HP.cream }}>
                    Distributed AI inference,
                    <br />
                    <span
                      className="bg-clip-text text-transparent"
                      style={{ backgroundImage: HERO_PRODUCT_GRADIENT }}
                    >
                      powered by everyone.
                    </span>
                  </h2>
    
                  <p className="text-base mt-6 leading-relaxed max-w-md" style={{ color: HP.silk }}>
                    OpenAI-compatible inference with a live supply side.
                    Your request is routed by price, speed and trust. Providers compete to serve it.
                  </p>
    
                  <div className="flex flex-wrap gap-3 mt-8">
                    <Link
                      to="/chat"
                      tabIndex={productOpacity > 0.95 ? undefined : -1}
                      className="hero-pigment-primary inline-flex items-center gap-2 rounded-md px-6 py-3 font-semibold text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F0C54B]"
                    >
                      <span aria-hidden="true" className="h-[6px] w-[6px] rotate-45" style={{ background: HP.cinnabar }} />
                      Start a conversation
                    </Link>
                    <Link
                      to="/provide"
                      tabIndex={productOpacity > 0.95 ? undefined : -1}
                      className="hero-pigment-secondary inline-flex items-center gap-2 rounded-md px-6 py-3 font-semibold text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F0C54B]"
                    >
                      <span aria-hidden="true" className="h-[6px] w-[6px] rotate-45" style={{ background: HP.jade }} />
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
            </section>
          )}
        </div>
        {/* Three regular chapter transitions plus an extended 2.2-viewport
            GPU-sand transition. A final reading hold keeps the in-place product
            visible without introducing nested desktop scrolling or a new page. */}
        {storyEnabled && STORY_CHAPTERS.slice(0, -1).map(chapter => (
          <div key={chapter.label} className="h-[calc(100svh-3.5rem)] w-full" aria-hidden="true" />
        ))}
        {storyEnabled && (
          <>
            <div style={{ height: 'calc(220svh - 7.7rem)' }} aria-hidden="true" />
            <div style={{ height: 'calc(85svh - 2.975rem)' }} aria-hidden="true" />
          </>
        )}
      </div>

      {storyEnabled && chapterPosition < EXIT_POSITION - 0.03 && (
        <ScrollChapterRail activeIndex={activeIndex} onSelect={navigateToChapter} />
      )}
    </>
  )
}
