import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import useSWR from 'swr'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { C, GRADIENTS, HERO_PIGMENTS as HP } from '../lib/theme'
import { HeroScene } from '../components/HeroScene'
import { LandingNav } from '../components/LandingNav'
import { MineralFlowField } from '../components/MineralFlowField'
import { LandscapeVideo } from '../components/LandscapeVideo'
import { STORY_CHAPTERS } from '../components/ScrollChapterRail'

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

// Intro + all six verbatim original main transition messages.
const CHAPTER_COPY = [
  { title: 'Inference Exchange', description: 'An open market for AI inference. Send OpenAI-compatible requests; providers with spare hardware compete to serve them.' },
  { title: 'Supply meets demand' },
  { title: 'Two forces converge', description: 'Consumers bid. Providers offer. The exchange matches.' },
  { title: 'The intersection is the product' },
  { title: 'Trust is labelled, not assumed', description: 'Providers report a trust level. The exchange shows it as claimed until evidence verifies it.' },
  { title: 'Providers compete. You benefit.', description: 'Price, speed, privacy — the matching engine optimizes for what you care about.' },
  { title: 'Distributed AI inference, powered by everyone.' },
] as const

// The pinned story uses the original main text styling (not the later
// animated rainbow/letterpress experiment). Keep the final product accent.
const HERO_PRODUCT_GRADIENT = `linear-gradient(90deg, ${HP.orpiment} 0%, ${HP.saffron} 28%, ${HP.coralLotus} 64%, #C2E1B7 100%)`

// The approved warm tint is isolated inside LandscapeVideo, not story text.
// Debug-only visual centerline, at the same 50% stage x used by the video.
const SHOW_ALIGNMENT_GUIDES = new URLSearchParams(window.location.search).get('heroGuides') === '1'

// The interactive CTA shifts the EXACT existing main mineral-border paint,
// not a new conic palette or radial spotlight. No render-time state, canvas
// or Motion dependency. Local ?ctaEffect=stone keeps the earlier inlay A/B.
const STATIC_CTA_PREVIEW = /^(localhost|127[.]0[.]0[.]1)$/.test(window.location.hostname)
  && new URLSearchParams(window.location.search).get('ctaEffect') === 'stone'

function movePigmentSpotlight(event: ReactPointerEvent<HTMLAnchorElement>) {
  if (STATIC_CTA_PREVIEW || (event.pointerType !== 'mouse' && event.pointerType !== 'pen')
    || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const rect = event.currentTarget.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
  const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
  event.currentTarget.style.setProperty('--pigment-x', `${Math.round(x * 100)}%`)
  event.currentTarget.style.setProperty('--pigment-y', `${Math.round(y * 100)}%`)
}

function StoneCTA({
  to,
  tone,
  children,
  tabIndex,
}: {
  to: string
  tone: 'light' | 'outline' | 'quiet'
  children: ReactNode
  tabIndex?: number
}) {
  return (
    <Link
      to={to}
      tabIndex={tabIndex}
      onPointerMove={movePigmentSpotlight}
      className={`hero-stone-cta hero-stone-cta--${tone}${STATIC_CTA_PREVIEW ? '' : ' mineral-border hero-stone-cta--interactive'}`}
    >
      <span className="hero-stone-cta__label">{children}</span>
    </Link>
  )
}

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
        // Main's original intro and six static transition styles. The seven
        // pinned holds/crossfades are the only deliberate pacing change.
        const shortTitle = index === 0 ? chapter.title : (
          <span
            className="hero-mani-heading-pigment bg-clip-text text-transparent"
            style={{ backgroundImage: index === 1 || index === LAST_CHAPTER ? GRADIENTS.heroText : `linear-gradient(135deg, ${C.warmWhite}, ${C.sand})` }}
          >
            {chapter.title}
          </span>
        )
        return (
          <section
            key={chapter.title}
            id={index === 0 ? 'landing-main' : undefined}
            aria-labelledby={'landing-chapter-title-' + index}
            aria-hidden={!visible}
            className="absolute inset-0 flex items-center justify-center px-6 sm:px-10 text-center"
            style={{
              opacity: visible ? 1 : 0,
              visibility: visible ? 'visible' : 'hidden',
              transition: 'opacity 420ms ease, visibility 420ms',
              pointerEvents: visible && exitProgress < 0.95 ? 'auto' : 'none',
            }}
          >
            <div className="relative mx-auto w-full max-w-2xl text-center">
              {index === 0 ? (
                <h1
                  id={'landing-chapter-title-' + index}
                  className="hero-mani-heading text-4xl md:text-6xl font-bold tracking-tight"
                >
                  {shortTitle}
                </h1>
              ) : (
                <h2
                  id={'landing-chapter-title-' + index}
                  className="hero-mani-heading text-3xl md:text-5xl font-bold tracking-tight leading-tight"
                >
                  {shortTitle}
                </h2>
              )}
              {'description' in chapter && (
                <p
                  className={index === 0
                    ? 'hero-mani-copy mt-4 max-w-xl mx-auto text-base md:text-lg leading-relaxed'
                    : 'hero-mani-copy text-base md:text-lg mt-4 leading-relaxed max-w-lg mx-auto'}
                >
                  {chapter.description}
                </p>
              )}
              {index === 0 && (
                <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                  <StoneCTA to="/chat" tone="light">Start chatting</StoneCTA>
                  <StoneCTA to="/provide" tone="outline">Become a provider</StoneCTA>
                  <StoneCTA to="/exchange" tone="quiet">Go to Exchange</StoneCTA>
                </div>
              )}
            </div>
          </section>
        )
      })}
      {activeIndex === 0 && (
        <div className="absolute bottom-8 inset-x-6 flex items-center justify-center gap-4"
          style={{ pointerEvents: exitProgress < 0.95 ? 'auto' : 'none' }}>
          <button type="button" onClick={onNext}
            className="hero-mani-fine text-[13px] tracking-wider uppercase px-3 py-2 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E8C77A]">
            Scroll to explore ↓
          </button>
          <button type="button" onClick={onSkip}
            className="hero-mani-fine text-[13px] tracking-wider uppercase px-3 py-2 rounded-lg border focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E8C77A]"
            style={{ borderColor: 'rgba(216,209,190,0.45)' }}>
            Skip intro
          </button>
        </div>
      )}
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
      style={{ background: 'rgba(255,255,255,0.06)', backdropFilter: 'blur(12px)' }}
    >
      <div className="hero-mani-meta text-xs uppercase tracking-wider mb-1.5" style={{ color: '#F0C978' }}>
        Live Exchange
      </div>
      <h3 className="hero-mani-heading text-xl font-bold mb-5">
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
                <span className="hero-mani-meta text-[13px]" style={{ color: '#F4E8D4' }}>
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
        <div className="hero-mani-meta text-xs uppercase tracking-wider" style={{ color: '#F0C978' }}>
          Trust levels are claims
        </div>
        <div className="hero-mani-meta text-[13px] leading-relaxed mt-1" style={{ color: '#F4E8D4' }}>
          Shown as self-reported until verified.
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
  // never trap trackpad/wheel input with mandatory snapping. The original
  // landing had no RHS chapter rail; the intro Explore action remains.
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
                  <h2 className="hero-mani-heading text-4xl md:text-5xl font-bold tracking-tight leading-[1.1]">
                    Distributed AI inference,
                    <br />
                    <span
                      className="hero-mani-heading-pigment bg-clip-text text-transparent"
                      style={{ backgroundImage: HERO_PRODUCT_GRADIENT }}
                    >
                      powered by everyone.
                    </span>
                  </h2>
    
                  <p className="text-base md:text-lg mt-6 leading-relaxed max-w-md" style={{ color: '#F5E9D6', textShadow: '0 1px 2px rgba(11,16,23,0.72)' }}>
                    OpenAI-compatible inference with a live supply side.
                    Your request is routed by price, speed and trust. Providers compete to serve it.
                  </p>
    
                  <div className="flex flex-wrap gap-3 mt-8">
                    <StoneCTA to="/chat" tone="light"
                      tabIndex={productOpacity > 0.95 ? undefined : -1}>
                      Start a conversation
                    </StoneCTA>
                    <StoneCTA to="/provide" tone="outline"
                      tabIndex={productOpacity > 0.95 ? undefined : -1}>
                      Become a provider
                    </StoneCTA>
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
        {/* Six original message transitions with smooth holds plus extended 2.2-viewport
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


    </>
  )
}
