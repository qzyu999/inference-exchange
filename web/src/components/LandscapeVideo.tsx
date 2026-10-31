import { useEffect, useRef, useState } from 'react'

interface LandscapeVideoProps {
  progress: number
  reducedMotion: boolean
  onAvailabilityChange: (available: boolean) => void
}

type VideoQuality = '720p' | '1080p' | '4k'

const VIDEO_BY_QUALITY: Record<VideoQuality, string> = {
  '720p': '/media/seedance_2_5_mountain_lake_720p.mp4',
  '1080p': '/media/seedance_2_5_mountain_lake_1080p.mp4',
  '4k': '/media/seedance_2_5_mountain_lake_4k.mp4',
}
const POSTER = '/media/seedance_2_5_mountain_lake_poster.webp'
const LEGACY_VIDEO = '/media/alpine-lake-hero.mp4'

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
  const localHighDpiReview = /^(localhost|127\\.0\\.0\\.1)$/.test(window.location.hostname)
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

function getVideoFraming(): {
  mode: HeroFraming
  fit: 'cover' | 'contain'
  position: string
} {
  const setting = new URLSearchParams(window.location.search).get('heroFit')
  // The user prefers the native, uncropped 16:9 composition (like the
  // QuickTime preview). Make that the default instead of zooming/cropping
  // the source, which magnifies any already-soft video detail.
  // Full bleed is still available with ?heroFit=wide, and the previous
  // center crop with ?heroFit=cover. Never distort/stretch the video.
  const mode: HeroFraming = setting === 'wide'
    ? 'wide'
    : setting === 'center' || setting === 'cover'
      ? 'center'
      : 'contain'
  return {
    mode,
    fit: mode === 'contain' ? 'contain' : 'cover',
    position: mode === 'wide' ? '50% 12%' : '50% 50%',
  }
}

/**
 * Serve exactly one web-optimized source at a time. This is NOT adaptive
 * bitrate streaming: quality is chosen once on page load, based on viewport
 * and optional connection hints. The browser progressively fetches/buffers the
 * selected MP4; it never requests the other renditions unless the first fails.
 * Full ABR would require HLS/DASH segmented media and a streaming pipeline.
 */
export function LandscapeVideo({ progress, reducedMotion, onAvailabilityChange }: LandscapeVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [quality] = useState<VideoQuality>(pickQuality)
  const candidateSources = quality === '4k'
    ? [VIDEO_BY_QUALITY['4k'], VIDEO_BY_QUALITY['1080p'], LEGACY_VIDEO]
    : quality === '720p'
      ? [VIDEO_BY_QUALITY['720p'], VIDEO_BY_QUALITY['1080p'], LEGACY_VIDEO]
      : [VIDEO_BY_QUALITY['1080p'], LEGACY_VIDEO]
  const [sourceIndex, setSourceIndex] = useState(0)
  const [ready, setReady] = useState(false)
  const [posterReady, setPosterReady] = useState(false)
  const [loopEligible, setLoopEligible] = useState(false)
  const [posterFailed, setPosterFailed] = useState(false)
  // When Data Saver is requested, show the still instead of starting video
  // playback (which overrides the preload hint and consumes mobile data).
  const saveData = (navigator as Navigator & { connection?: NetworkHints }).connection?.saveData === true
  const shouldAutoplay = !reducedMotion && !saveData
  const framing = getVideoFraming()
  const edges = getHeroEdges()
  const useAmbientEdges = framing.mode === 'contain' && edges === 'ambient'
  const selectedSource = candidateSources[sourceIndex]

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
          margins of the contained 16:9 frame. It never filters the main video. */}
      {useAmbientEdges && (
        <div
          className="pointer-events-none absolute -inset-10"
          aria-hidden="true"
          style={{
            backgroundImage: `url("${POSTER}")`,
            backgroundPosition: 'center center',
            backgroundSize: 'cover',
            filter: 'blur(24px) brightness(0.57) saturate(0.82)',
            transform: 'scale(1.04)',
          }}
        />
      )}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        {/* A real 16:9 video-sized element avoids the opaque black letterboxing
            that <video object-fit=contain> can paint into its own full-screen
            layout box. In cover modes, keep the old full-stage geometry. */}
        <div
          className={framing.mode === 'contain'
            ? 'relative w-full max-h-full shrink-0 overflow-hidden'
            : 'absolute inset-0 overflow-hidden'}
          style={framing.mode === 'contain' ? {
            aspectRatio: '16 / 9',
            maxWidth: 'calc((100svh - 3.5rem) * 1.7777778)',
            // Feather only the foreground frame boundary into the side fill.
            // The video remains 100% sharp everywhere else.
            WebkitMaskImage: useAmbientEdges
              ? 'linear-gradient(to right, transparent 0%, black 1.1%, black 98.9%, transparent 100%)'
              : undefined,
            maskImage: useAmbientEdges
              ? 'linear-gradient(to right, transparent 0%, black 1.1%, black 98.9%, transparent 100%)'
              : undefined,
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
            poster={POSTER}
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
              setLoopEligible(false)
              setSourceIndex(index => Math.min(index + 1, candidateSources.length - 1))
            }}
          />
          {!ready && !posterFailed && (
            <img
              src={POSTER}
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
