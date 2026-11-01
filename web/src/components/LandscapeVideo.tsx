import { useEffect, useRef, useState } from 'react'
import { attachStreamHls } from '../lib/stream-hls.js'

interface LandscapeVideoProps {
  progress: number
  reducedMotion: boolean
  onAvailabilityChange: (available: boolean) => void
}

type VideoAspect = '16x9' | '21x9'
type HeroFraming = 'wide' | 'center' | 'contain'
type HeroEdges = 'ambient' | 'solid'

const NAV_HEIGHT = 56
const VIDEO_ASPECT_RATIO: Record<VideoAspect, number> = {
  '16x9': 16 / 9,
  '21x9': 3840 / 1644,
}

// Public Cloudflare Stream URLs supplied and verified by the video owner.
// No raw .mp4, R2 video object, or third-party player script is used here.
const STREAM_HOST = 'https://customer-5w3ijts4etcd5hi9.cloudflarestream.com'
const STREAM_UID: Record<VideoAspect, string> = {
  '16x9': '6dcc0a01091fa0a720a7482f5c758b79',
  '21x9': '02af62eaa08146a6efe21b8a4d76a569',
}
const STREAM_MANIFEST: Record<VideoAspect, string> = {
  '16x9': `${STREAM_HOST}/${STREAM_UID['16x9']}/manifest/video.m3u8`,
  '21x9': `${STREAM_HOST}/${STREAM_UID['21x9']}/manifest/video.m3u8`,
}

// Stream-generated stills are JPEG thumbnails, NOT streaming video segments.
// Their 16:9 and ultrawide framing is preserved using fit=clip. These poster
// URLs must be tested on the eventual deployment domain before video rollout.
const STREAM_POSTER: Record<VideoAspect, string> = {
  '16x9': `${STREAM_HOST}/${STREAM_UID['16x9']}/thumbnails/thumbnail.jpg?time=8s&width=1280&height=720&fit=clip`,
  '21x9': `${STREAM_HOST}/${STREAM_UID['21x9']}/thumbnails/thumbnail.jpg?time=8s&width=1280&height=548&fit=clip`,
}
const LOCAL_PREVIEW = /^(localhost|127[.]0[.]0[.]1)$/.test(window.location.hostname)
const PREVIEW_MODE = LOCAL_PREVIEW
  ? new URLSearchParams(window.location.search).get('heroDelivery')
  : null
// The cinematic hero is Stream HLS by default for this approved PR.
// VITE_HERO_STREAM_ENABLED=false (rebuild/redeploy) is a poster-only rollback.
// Local query flags are debugging overrides and work ONLY on localhost.
const STREAM_ENABLED = PREVIEW_MODE === 'poster' ? false
  : PREVIEW_MODE === 'stream' ? true
    : import.meta.env.VITE_HERO_STREAM_ENABLED !== 'false'
// The same warm multiply tint used by non-landing pages, scoped to the
// *video layer only*. Local ?heroTint=off is a visual A/B preview escape hatch.
const WARM_VIDEO_TINT = !LOCAL_PREVIEW
  || new URLSearchParams(window.location.search).get('heroTint') !== 'off'

interface NetworkHints {
  saveData?: boolean
}

function selectAspect(): VideoAspect {
  const forced = new URLSearchParams(window.location.search).get('heroAspect')
  if (LOCAL_PREVIEW && (forced === '21x9' || forced === '16x9')) return forced
  const stageAspect = window.innerWidth / Math.max(1, window.innerHeight - NAV_HEIGHT)
  return stageAspect >= 2.05 ? '21x9' : '16x9'
}

function getHeroEdges(): HeroEdges {
  const requested = new URLSearchParams(window.location.search).get('heroEdges')
  return LOCAL_PREVIEW && requested === 'solid' ? 'solid' : 'ambient'
}

function getVideoFraming(aspect: VideoAspect): {
  mode: HeroFraming
  fit: 'cover' | 'contain'
  position: string
} {
  const setting = LOCAL_PREVIEW
    ? new URLSearchParams(window.location.search).get('heroFit')
    : null
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
 * Production delivery policy (#198):
 * - Video: adaptive Cloudflare Stream HLS by default (build opt-out available).
 * - Fallback: one static Stream thumbnail, never a standalone MP4 request.
 * - Poster remains visible UNTIL playback actually starts, and while stalled.
 * - Save-Data, reduced motion, fatal HLS error or rollout-off: poster only.
 * Native Safari HLS returns synchronous cleanup for React StrictMode replay.
 */
export function LandscapeVideo({ progress, reducedMotion, onAvailabilityChange }: LandscapeVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [requestedAspect, setRequestedAspect] = useState<VideoAspect>(selectAspect)
  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [posterReady, setPosterReady] = useState(false)
  const [posterFailed, setPosterFailed] = useState(false)
  const [streamFailed, setStreamFailed] = useState(false)
  const [loopEligible, setLoopEligible] = useState(false)

  useEffect(() => {
    const update = () => setRequestedAspect(selectAspect())
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  useEffect(() => {
    setReady(false)
    setPlaying(false)
    setPosterReady(false)
    setPosterFailed(false)
    setStreamFailed(false)
    setLoopEligible(false)
  }, [requestedAspect])

  const saveData = (navigator as Navigator & { connection?: NetworkHints }).connection?.saveData === true
  const useStream = STREAM_ENABLED && !reducedMotion && !saveData && !streamFailed
  const manifest = STREAM_MANIFEST[requestedAspect]
  const poster = STREAM_POSTER[requestedAspect]
  const framing = getVideoFraming(requestedAspect)
  const edges = getHeroEdges()
  const useAmbientEdges = framing.mode === 'contain' && edges === 'ambient'
  // loadeddata is not proof of successful autoplay: never expose a black video
  // layer until the browser emits playing, and restore the poster on stalls.
  const showVideo = useStream && ready && playing
  const frameRatio = VIDEO_ASPECT_RATIO[requestedAspect]
  const frameAspectCss = requestedAspect === '21x9' ? '3840 / 1644' : '16 / 9'

  useEffect(() => {
    if (!useStream) return
    const video = videoRef.current
    if (!video) return

    const controller = new AbortController()
    let release: (() => void) | undefined
    const fail = (error: Error) => {
      if (controller.signal.aborted) return
      console.warn('[hero-stream] HLS unavailable; showing static poster:', error)
      setReady(false)
      setPlaying(false)
      setLoopEligible(false)
      setStreamFailed(true)
    }

    try {
      const attachment = attachStreamHls(video, manifest, fail, controller.signal)
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
  }, [useStream, manifest])

  useEffect(() => {
    onAvailabilityChange(ready || posterReady)
  }, [ready, posterReady, onAvailabilityChange])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !useStream) return
    const sync = () => {
      if (document.hidden) {
        video.pause()
      } else if (!video.ended && video.readyState >= 2) {
        void video.play().catch(error => {
          console.warn('[hero-stream] Muted playback unavailable:', error)
        })
      }
    }
    document.addEventListener('visibilitychange', sync)
    sync()
    return () => document.removeEventListener('visibilitychange', sync)
  }, [useStream, ready])

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
  // When ultrawide footage is letterboxed vertically, meet the navbar
  // without a transparent top seam; keep the ambient poster blur only below.
  // On side-gapped/16:9 layouts, retain the original symmetric soft edges.
  const topAnchorUltrawide = requestedAspect === '21x9' && framing.mode === 'contain'
  const frameMask = useAmbientEdges
    ? topAnchorUltrawide && edgeDirection === 'to bottom'
      ? 'linear-gradient(to bottom, black 0%, black 98.9%, transparent 100%)'
      : `linear-gradient(${edgeDirection}, transparent 0%, black 1.1%, black 98.9%, transparent 100%)`
    : undefined
  const fade = Math.min(1, Math.max(0, (progress - 0.82) / 0.18))

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden="true"
      style={{ backgroundColor: '#292F35', opacity: 1 - fade, isolation: 'isolate' }}
    >
      {useAmbientEdges && (
        <div
          className="pointer-events-none absolute -inset-10"
          aria-hidden="true"
          style={{
            backgroundImage: `url("${poster}")`,
            backgroundPosition: 'center',
            backgroundSize: 'cover',
            filter: 'blur(24px) brightness(0.57) saturate(0.82)',
            transform: 'scale(1.04)',
          }}
        />
      )}
      <div className={`pointer-events-none absolute inset-0 flex justify-center ${topAnchorUltrawide ? 'items-start' : 'items-center'}`}>
        <div
          className={framing.mode === 'contain'
            ? 'relative w-full max-h-full shrink-0 overflow-hidden'
            : 'absolute inset-0 overflow-hidden'}
          style={framing.mode === 'contain' ? {
            aspectRatio: frameAspectCss,
            maxWidth: `calc((100svh - 3.5rem) * ${frameRatio})`,
            WebkitMaskImage: frameMask,
            maskImage: frameMask,
          } : undefined}
          data-hero-edges={edges}
        >
          <video
            ref={videoRef}
            key={manifest}
            className="absolute inset-0 h-full w-full"
            style={{
              objectFit: framing.mode === 'contain' ? 'cover' : framing.fit,
              objectPosition: framing.position,
              opacity: showVideo ? 1 : 0,
              transition: 'opacity 200ms ease-out',
            }}
            // Source is attached only by attachStreamHls; no direct MP4 path.
            poster={poster}
            data-hero-delivery={useStream ? 'cloudflare-stream-hls' : 'poster-only'}
            data-hero-aspect={requestedAspect}
            data-hero-quality="adaptive"
            data-hero-source={useStream ? manifest : 'poster-only'}
            data-hero-framing={framing.mode}
            autoPlay={useStream}
            loop={useStream && loopEligible}
            muted
            playsInline
            preload={useStream ? 'metadata' : 'none'}
            onLoadedMetadata={event => setLoopEligible(event.currentTarget.duration >= 20)}
            onLoadedData={() => setReady(true)}
            onPlaying={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onWaiting={() => setPlaying(false)}
            onError={() => {
              setReady(false)
              setPlaying(false)
              setLoopEligible(false)
              setStreamFailed(true)
            }}
          />
          {!posterFailed && (
            <img
              key={poster}
              src={poster}
              alt=""
              className="pointer-events-none absolute inset-0 h-full w-full"
              style={{
                objectFit: framing.mode === 'contain' ? 'cover' : framing.fit,
                objectPosition: framing.position,
                opacity: showVideo ? 0 : 1,
                transition: 'opacity 200ms ease-out',
              }}
              onLoad={() => setPosterReady(true)}
              onError={() => setPosterFailed(true)}
            />
          )}
        </div>
      </div>
      {/* Warm only the footage and the ambient poster blur, never the title,
          crystal, nav or final product screen which live in sibling layers. */}
      {WARM_VIDEO_TINT && (
        <div
          aria-hidden="true"
          data-hero-video-tint="warm"
          className="hero-video-bedtime-tint pointer-events-none absolute inset-0"
        />
      )}
    </div>
  )
}
