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

  // Four-K is opt-in automatically ONLY when the browser reports good network
  // conditions and a large, capable display. Safari does not expose the
  // Network Information API, so its safe default remains 1080p.
  const largeDisplay = physicalWidth >= 3200 && physicalHeight >= 1800
  const fastConnection = connection?.effectiveType === '4g'
    && (connection.downlink ?? 0) >= 20
  const capableMachine = (nav.deviceMemory ?? 8) >= 8
    && (nav.hardwareConcurrency || 4) >= 4
  return largeDisplay && fastConnection && capableMachine ? '4k' : '1080p'
}

function getVideoFit(): 'contain' | 'cover' {
  return new URLSearchParams(window.location.search).get('heroFit') === 'contain'
    ? 'contain'
    : 'cover'
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
  const fit = getVideoFit()
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
      <video
        ref={videoRef}
        key={selectedSource}
        className="absolute inset-0 h-full w-full"
        style={{
          objectFit: fit,
          objectPosition: 'center center',
          opacity: ready ? 1 : 0,
          transition: 'opacity 200ms ease-out',
        }}
        src={selectedSource}
        poster={POSTER}
        data-hero-quality={quality}
        data-hero-source={selectedSource}
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
          style={{ objectFit: fit, objectPosition: 'center center' }}
          onLoad={() => setPosterReady(true)}
          onError={() => setPosterFailed(true)}
        />
      )}
    </div>
  )
}
