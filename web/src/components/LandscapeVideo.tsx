import { useEffect, useRef, useState } from 'react'
import { heroMediaUrl } from '../lib/hero-media.js'
import { attachStreamHls } from '../lib/stream-hls.js'

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
// User-supplied public Stream video manifest URLs. The opt-in trial runs only
// on localhost; regular local and production visitors continue to use MP4.
const STREAM_MANIFEST_BY_ASPECT: Record<VideoAspect, string> = {
  '16x9': 'https://customer-5w3ijts4etcd5hi9.cloudflarestream.com/6dcc0a01091fa0a720a7482f5c758b79/manifest/video.m3u8',
  '21x9': 'https://customer-5w3ijts4etcd5hi9.cloudflarestream.com/02af62eaa08146a6efe21b8a4d76a569/manifest/video.m3u8',
}
const LOCAL_PREVIEW = /^(localhost|127[.]0[.]0[.]1)$/.test(window.location.hostname)
const STREAM_PREVIEW = LOCAL_PREVIEW
  && new URLSearchParams(window.location.search).get('heroDelivery') === 'stream'
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
  // Allow explicit 21:9 review on a standard 16:9 monitor; do not let
  // debug URL parameters affect visitors on inferenceex.com.
  const forced = new URLSearchParams(window.location.search).get('heroAspect')
  if (LOCAL_PREVIEW && (forced === '21x9' || forced === '16x9')) return forced
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
 * Default playback serves exactly one web-optimized MP4 selected on load;
 * it is not adaptive bitrate streaming. On localhost only, ?heroDelivery=stream
 * enables a Cloudflare Stream HLS adaptive-bitrate pilot for both compositions.
 * The pilot uses the same <video> and falls back to the static poster on
 * HLS failure. Ordinary (non-preview) MP4 playback is unchanged for now.
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
  const [streamFailed, setStreamFailed] = useState(false)
  // When Data Saver is requested, show the still instead of starting video
  // playback (which overrides the preload hint and consumes mobile data).
  const saveData = (navigator as Navigator & { connection?: NetworkHints }).connection?.saveData === true
  const shouldAutoplay = !reducedMotion && !saveData
  const selectedCandidate = candidateSources[Math.min(sourceIndex, candidateSources.length - 1)]
  // In the opt-in Stream preview, never request an MP4. If HLS is unavailable,
  // reduced motion is requested, or Save-Data is on, render the static poster.
  // Ordinary non-preview builds still use the legacy MP4 until migration.
  const useStream = STREAM_PREVIEW && shouldAutoplay && !streamFailed && sourceIndex === 0
  const posterOnly = STREAM_PREVIEW && !useStream
  const selectedManifest = STREAM_MANIFEST_BY_ASPECT[selectedCandidate.aspect]
  const selectedSource = useStream ? selectedManifest
    : posterOnly ? `poster-only-${selectedCandidate.aspect}` : selectedCandidate.path
  const selectedPoster = selectedCandidate.poster
  const framing = getVideoFraming(selectedCandidate.aspect)
  const edges = getHeroEdges()
  const useAmbientEdges = framing.mode === 'contain' && edges === 'ambient'
  const frameRatio = VIDEO_ASPECT_RATIO[selectedCandidate.aspect]
  const frameAspectCss = selectedCandidate.aspect === '21x9' ? '3840 / 1644' : '16 / 9'
  useEffect(() => {
    if (!useStream) return
    const video = videoRef.current
    if (!video) return
    const controller = new AbortController()
    let release: (() => void) | undefined
    const fail = (error: Error) => {
      if (controller.signal.aborted) return
      console.warn('[hero-stream] Stream preview failed, showing static poster:', error)
      setReady(false)
      setLoopEligible(false)
      setStreamFailed(true)
    }
    try {
      const attachment = attachStreamHls(video, selectedManifest, fail, controller.signal)
      // Native HLS must attach and tear down synchronously. In React 18
      // StrictMode, the stale first cleanup otherwise runs *after* the second
      // setup, silently removing its src (networkState=0, readyState=0).
      if (typeof attachment === 'function') {
        release = attachment
      } else {
        void attachment.then(stop => {
          if (controller.signal.aborted) stop()
          else release = stop
        }).catch(fail)
      }
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)))
    }
    return () => {
      controller.abort()
      release?.()
    }
  }, [useStream, selectedManifest])
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
      if (document.hidden) {
        video.pause()
      } else if (!video.ended && video.readyState >= 2) {
        void video.play().catch(error => {
          // Muted autoplay rejections and unsupported-media failures used to be
          // swallowed. The pilot needs visible diagnostics for these cases.
          if (useStream) console.warn('[hero-stream] Video play() failed:', error)
        })
      }
    }
    document.addEventListener('visibilitychange', sync)
    sync()
    return () => document.removeEventListener('visibilitychange', sync)
  }, [shouldAutoplay, ready, sourceIndex, useStream])

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
            src={STREAM_PREVIEW ? undefined : selectedCandidate.path}
            poster={selectedPoster}
            data-hero-delivery={useStream ? 'cloudflare-stream-hls' : posterOnly ? 'poster-only' : 'mp4'}
            data-hero-aspect={selectedCandidate.aspect}
            data-hero-quality={useStream ? 'adaptive' : quality}
            data-hero-source={selectedSource}
            data-hero-framing={framing.mode}
            autoPlay={shouldAutoplay && !posterOnly}
            loop={loopEligible && !posterOnly}
            muted
            playsInline
            preload={shouldAutoplay && !posterOnly ? 'metadata' : 'none'}
            onLoadedMetadata={(event) => {
              setLoopEligible(event.currentTarget.duration >= 20)
            }}
            onLoadedData={() => setReady(true)}
            onError={() => {
              setReady(false)
              setPosterReady(false)
              setPosterFailed(false)
              setLoopEligible(false)
              if (STREAM_PREVIEW) {
                // Never downgrade the Stream trial to a large MP4 download.
                setStreamFailed(true)
              } else {
                setSourceIndex(index => Math.min(index + 1, candidateSources.length - 1))
              }
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
