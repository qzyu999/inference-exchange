import { useEffect, useRef, useState } from 'react'

interface LandscapeVideoProps {
  progress: number
  reducedMotion: boolean
  onAvailabilityChange: (available: boolean) => void
}

const VIDEO = '/media/alpine-lake-hero.mp4'
const POSTER = '/media/alpine-lake-poster.webp'

// Keep the full ultra-wide video visible by default, even in a 16:9 viewport.
// ?heroFit=cover is a review-only comparison for the old cropped presentation.
function getVideoFit(): 'contain' | 'cover' {
  return new URLSearchParams(window.location.search).get('heroFit') === 'cover'
    ? 'cover'
    : 'contain'
}

// Optional media: if the MP4 isn't present, the existing Three.js scene remains
// available. Copy video/poster into web/public/media (see media/README.md).
export function LandscapeVideo({ progress, reducedMotion, onAvailabilityChange }: LandscapeVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [ready, setReady] = useState(false)
  const fit = getVideoFit()
  const [loopEligible, setLoopEligible] = useState(false)

  useEffect(() => {
    onAvailabilityChange(ready)
  }, [ready, onAvailabilityChange])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (reducedMotion) {
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
  }, [reducedMotion, ready])

  // Loop only longer, near-stationary source footage. The original short Kling
  // preview is not seamless, so it still stops rather than visibly jumping.
  const fade = Math.min(1, Math.max(0, (progress - 0.82) / 0.18))

  // Match the opaque navigation bar. No blurred poster or color wash behind
  // the actual footage (particularly at the letterbox edges).
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden="true"
      style={{ backgroundColor: '#0E1018', opacity: 1 - fade }}
    >
      {/* Raw video only. Letterboxing uses a flat matte, not blurred footage. */}
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full"
        style={{
          objectFit: fit,
          objectPosition: 'center center',
          opacity: ready ? 1 : 0,
          transition: 'opacity 200ms ease-out',
        }}
        src={VIDEO}
        poster={POSTER}
        autoPlay={!reducedMotion}
        loop={loopEligible}
        muted
        playsInline
        preload="metadata"
        onLoadedMetadata={(event) => {
          // Use the 30-second stationary footage as an ambient loop. A missing
          // asset or an old five-second draft retains the original hold behavior.
          setLoopEligible(event.currentTarget.duration >= 20)
        }}
        onLoadedData={() => setReady(true)}
        onError={() => {
          setLoopEligible(false)
          setReady(false)
        }}
      />

      {/* Show the full-resolution still while the first video frame loads,
          also for reduced-motion visitors whose video may not autoplay. */}
      {!ready && (
        <img
          src={POSTER}
          alt=""
          className="absolute inset-0 h-full w-full"
          style={{ objectFit: fit, objectPosition: 'center center' }}
        />
      )}
    </div>
  )
}
