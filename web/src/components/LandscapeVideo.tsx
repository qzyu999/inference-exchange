import { useEffect, useRef, useState } from 'react'
import { heroMediaUrl } from '../lib/hero-media.js'

interface LandscapeVideoProps {
  progress: number
  reducedMotion: boolean
  onAvailabilityChange: (available: boolean) => void
}

type VideoQuality = '720p' | '1080p' | '4k'
type VideoAspect = '16x9' | '21x9'

// The 21:9 Runway source is reserved for wide desktop viewports. Keep the
// original 16:9 Seedance files for laptop, tablet, and mobile layouts.
const VIDEO_BY_ASPECT: Record<VideoAspect, Record<VideoQuality, string>> = {
  '16x9': {
    '720p': '/media/seedance_2_5_mountain_lake_720p.mp4',
    '1080p': '/media/seedance_2_5_mountain_lake_1080p.mp4',
    '4k': '/media/seedance_2_5_mountain_lake_4k.mp4',
  },
  '21x9': {
    '720p': '/media/seedance_2_5_mountain_lake_21x9_720p.mp4',
    '1080p': '/media/seedance_2_5_mountain_lake_21x9_1080p.mp4',
    '4k': '/media/seedance_2_5_mountain_lake_21x9_4k.mp4',
  },
}
const POSTERS: Record<VideoAspect, string> = {
  '16x9': '/media/seedance_2_5_mountain_lake_poster.webp',
  '21x9': '/media/seedance_2_5_mountain_lake_21x9_poster.webp',
}
const VIDEO_ASPECT_RATIO: Record<VideoAspect, number> = {
  '16x9': 16 / 9,
  '21x9': 3840 / 1644,
}
const NAV_HEIGHT = 56
// Build-time public URL; empty for local Vite and local asset-preview builds.
// Example: VITE_HERO_MEDIA_ORIGIN=https://media.inferenceex.com
const MEDIA_ORIGIN = import.meta.env.VITE_HERO_MEDIA_ORIGIN || ''
const mediaUrl = (localPath: string) => heroMediaUrl(localPath, MEDIA_ORIGIN)
const LEGACY_VIDEO = '/media/alpine-lake-hero.mp4'

interface VideoCandidate {
  path: string
  poster: string
  aspect: VideoAspect
}

function selectAspect(): VideoAspect {
  // Compare the visible hero stage, subtracting the 56px navigation bar.
  const stageAspect = window.innerWidth / Math.max(1, window.innerHeight - NAV_HEIGHT)
  return stageAspect >= 2.05 ? '21x9' : '16x9'
}

function makeCandidates(aspect: VideoAspect, quality: VideoQuality): VideoCandidate[] {
  // Prefer a lower bitrate with the correct composition over switching ratio.
  const qualities: VideoQuality[] = quality === '4k'
    ? ['4k', '1080p', '720p']
    : quality === '1080p' ? ['1080p', '720p'] : ['720p']
  const aspects: VideoAspect[] = aspect === '21x9' ? ['21x9', '16x9'] : ['16x9']
  return [
    ...aspects.flatMap(a => qualities.map(q => ({
      path: mediaUrl(VIDEO_BY_ASPECT[a][q]), poster: mediaUrl(POSTERS[a]), aspect: a,
    }))),
    // Older optional local review footage is never hosted in R2; don't
    // request an HTML SPA fallback or nonexistent file in public builds.
    ...(!MEDIA_ORIGIN
      ? [{ path: LEGACY_VIDEO, poster: mediaUrl(POSTERS['16x9']), aspect: '16x9' as const }]
      : []),
  ]
}

interface NetworkHints {
  effectiveType?: string
  downlink?: number
  saveData?: boolean
}

function pickQuality(): VideoQuality {
  // Deterministic reviewer override: ?heroQuality=720p|1080p|4k.
  const override = new URLSearchParams(window.location.search).get('heroQuality')
  if (override === '720p' || override === '1080p' || override === '4k') return override

  const nav = navigator as Navigator & {
    connection?: NetworkHints
    deviceMemory?: number
  }
  const connection = nav.connection
  const physicalWidth = window.innerWidth * (window.devicePixelRatio || 1)
  const physicalHeight = window.innerHeight * (window.devicePixelRatio || 1)
  const slowNetwork = connection?.saveData === true
    || /^(slow-2g|2g|3g)$/.test(connection?.effectiveType ?? '')

  // Err on the small side: media decoding and cellular data are often more
  // important than having 4K pixels on a physically small screen.
  if (slowNetwork || window.innerWidth < 768 || physicalWidth < 1280) return '720p'

  // Local high-DPI desktop review should actually show the 4K plate. In
  // the previous implementation even localhost usually selected 1080p, so
  // comparing "/" with "?heroQuality=4k" was NOT an apples-to-apples test.
  // Production keeps the conservative bandwidth/device guard below.
  const localHighDpiReview = /^(localhost|127[.]0[.]0[.]1)$/.test(window.location.hostname)
    && window.innerWidth >= 1024 && physicalWidth >= 2600
  if (localHighDpiReview) return '4k'

  // Four-K is selected in production ONLY when the browser reports good
  // conditions and a large display. Safari lacks consistent connection
  // hints, so public visitors there still default to 1080p.
  const largeDisplay = physicalWidth >= 3200 && physicalHeight >= 1800
  const fastConnection = connection?.effectiveType === '4g'
    && (connection.downlink ?? 0) >= 20
  const capableMachine = (nav.deviceMemory ?? 8) >= 8
    && (nav.hardwareConcurrency || 4) >= 4
  return largeDisplay && fastConnection && capableMachine ? '4k' : '1080p'
}

type HeroFraming = 'wide' | 'center' | 'contain'
type HeroEdges = 'ambient' | 'solid'

function getHeroEdges(): HeroEdges {
  // The centered full-frame video is still the hero. Edge filling is a
  // decorative layer behind it, never a second copy of the video stream.
  return new URLSearchParams(window.location.search).get('heroEdges') === 'solid'
    ? 'solid'
    : 'ambient'
}

function getVideoFraming(aspect: VideoAspect): {
  mode: HeroFraming
  fit: 'cover' | 'contain'
  position: string
} {
  const setting = new URLSearchParams(window.location.search).get('heroFit')
  // Wide video now fills wide viewports. On 16:9/portrait screens, preserve
  // the full 16:9 plate. URL overrides retain existing A/B behavior.
  const mode: HeroFraming = setting === 'contain'
    ? 'contain'
    : setting === 'wide'
      ? 'wide'
      : setting === 'center' || setting === 'cover'
        ? 'center'
        : aspect === '21x9' ? 'center' : 'contain'
  return {
    mode,
    fit: mode === 'contain' ? 'contain' : 'cover',
    position: mode === 'wide' && aspect === '16x9' ? '50% 12%' : '50% 50%',
  }
}

/**
 * Serve exactly one web-optimized source at a time. This is NOT adaptive
 * bitrate streaming: quality is chosen once on page load, based on viewport
 * and optional connection hints. The browser progressively fetches/buffers the
 * selected MP4; it requests another rendition only when the first fails.
 * Full ABR would require HLS/DASH segmented media and a streaming pipeline.
 */
export function LandscapeVideo({ progress, reducedMotion, onAvailabilityChange }: LandscapeVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [quality] = useState<VideoQuality>(pickQuality)
  const [requestedAspect, setRequestedAspect] = useState<VideoAspect>(selectAspect)
  useEffect(() => {
    const update = () => setRequestedAspect(selectAspect())
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  const candidateSources = makeCandidates(requestedAspect, quality)
  const [sourceIndex, setSourceIndex] = useState(0)
  const [ready, setReady] = useState(false)
  const [posterReady, setPosterReady] = useState(false)
  const [loopEligible, setLoopEligible] = useState(false)
  const [posterFailed, setPosterFailed] = useState(false)
  // When Data Saver is requested, show the still instead of starting video
  // playback (which overrides the preload hint and consumes mobile data).
  const saveData = (navigator as Navigator & { connection?: NetworkHints }).connection?.saveData === true
  const shouldAutoplay = !reducedMotion && !saveData
  const selectedCandidate = candidateSources[Math.min(sourceIndex, candidateSources.length - 1)]
  const selectedSource = selectedCandidate.path
  const selectedPoster = selectedCandidate.poster
  const framing = getVideoFraming(selectedCandidate.aspect)
  const edges = getHeroEdges()
  const useAmbientEdges = framing.mode === 'contain' && edges === 'ambient'
  const frameRatio = VIDEO_ASPECT_RATIO[selectedCandidate.aspect]
  const frameAspectCss = selectedCandidate.aspect === '21x9' ? '3840 / 1644' : '16 / 9'
  useEffect(() => {
    setSourceIndex(0)
    setReady(false)
    setPosterReady(false)
    setPosterFailed(false)
  }, [requestedAspect])
  // A wide stage letterboxes horizontally; a tall stage letterboxes vertically.
  // Feather the actual boundary, not the unrelated pair of edges.
  const [edgeDirection, setEdgeDirection] = useState<'to right' | 'to bottom'>(() =>
    window.innerWidth / Math.max(1, window.innerHeight - NAV_HEIGHT) >= frameRatio
      ? 'to right' : 'to bottom'
  )
  useEffect(() => {
    const update = () => setEdgeDirection(
      window.innerWidth / Math.max(1, window.innerHeight - NAV_HEIGHT) >= frameRatio
        ? 'to right' : 'to bottom'
    )
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [frameRatio])
  const frameMask = useAmbientEdges
    ? `linear-gradient(${edgeDirection}, transparent 0%, black 1.1%, black 98.9%, transparent 100%)`
    : undefined

  useEffect(() => {
    onAvailabilityChange(ready || posterReady)
  }, [ready, posterReady, onAvailabilityChange])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (!shouldAutoplay) {
      video.pause()
      return
    }

    const sync = () => {
      if (document.hidden) video.pause()
      else if (!video.ended) void video.play().catch(() => {})
    }
    document.addEventListener('visibilitychange', sync)
    sync()
    return () => document.removeEventListener('visibilitychange', sync)
  }, [shouldAutoplay, ready, sourceIndex])

  // The new sources are silent, 30-second, locked-off video plates.
  // Keep the landscape bright until the very last crystal dissolve.
  const fade = Math.min(1, Math.max(0, (progress - 0.82) / 0.18))

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden="true"
      style={{ backgroundColor: '#0E1018', opacity: 1 - fade }}
    >
      {/* Edge fill uses the already-requested static poster (not another video).
          It lives BEHIND the sharp video and is visible only in the letterbox
          margins of a contained source frame. It never filters the main video. */}
      {useAmbientEdges && (
        <div
          className="pointer-events-none absolute -inset-10"
          aria-hidden="true"
          style={{
            backgroundImage: `url("${selectedPoster}")`,
            backgroundPosition: 'center center',
            backgroundSize: 'cover',
            filter: 'blur(24px) brightness(0.57) saturate(0.82)',
            transform: 'scale(1.04)',
          }}
        />
      )}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        {/* A source-aspect-matched frame avoids the opaque black letterboxing
            that <video object-fit=contain> can paint into its own full-screen
            layout box. In cover modes, keep the old full-stage geometry. */}
        <div
          className={framing.mode === 'contain'
            ? 'relative w-full max-h-full shrink-0 overflow-hidden'
            : 'absolute inset-0 overflow-hidden'}
          style={framing.mode === 'contain' ? {
            aspectRatio: frameAspectCss,
            maxWidth: `calc((100svh - 3.5rem) * ${frameRatio})`,
            // Feather only the foreground frame boundary into the side fill.
            // The video remains 100% sharp everywhere else.
            WebkitMaskImage: frameMask,
            maskImage: frameMask,
          } : undefined}
          data-hero-edges={edges}
        >
          <video
            ref={videoRef}
            key={selectedSource}
            className="absolute inset-0 h-full w-full"
            style={{
              objectFit: framing.mode === 'contain' ? 'cover' : framing.fit,
              objectPosition: framing.position,
              opacity: ready ? 1 : 0,
              transition: 'opacity 200ms ease-out',
            }}
            src={selectedSource}
            poster={selectedPoster}
            data-hero-aspect={selectedCandidate.aspect}
            data-hero-quality={quality}
            data-hero-source={selectedSource}
            data-hero-framing={framing.mode}
            autoPlay={shouldAutoplay}
            loop={loopEligible}
            muted
            playsInline
            preload={shouldAutoplay ? 'metadata' : 'none'}
            onLoadedMetadata={(event) => {
              setLoopEligible(event.currentTarget.duration >= 20)
            }}
            onLoadedData={() => setReady(true)}
            onError={() => {
              setReady(false)
              setPosterReady(false)
              setPosterFailed(false)
              setLoopEligible(false)
              setSourceIndex(index => Math.min(index + 1, candidateSources.length - 1))
            }}
          />
          {!ready && !posterFailed && (
            <img
              src={selectedPoster}
              alt=""
              className="absolute inset-0 h-full w-full"
              style={{
                objectFit: framing.mode === 'contain' ? 'cover' : framing.fit,
                objectPosition: framing.position,
              }}
              onLoad={() => setPosterReady(true)}
              onError={() => setPosterFailed(true)}
            />
          )}
        </div>
      </div>
    </div>
  )
}
