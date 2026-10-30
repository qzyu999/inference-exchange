import { useEffect, useRef, useState } from 'react'
import { C } from '../lib/theme'

interface LandscapeVideoProps {
  progress: number
  reducedMotion: boolean
  onAvailabilityChange: (available: boolean) => void
}

const VIDEO = '/media/alpine-lake-hero.mp4'
const POSTER = '/media/alpine-lake-poster.webp'

// Keep the entire 2.34:1 source visible by default, even in a 16:9 viewport.
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

  // The current 5-second source is not seamless. Hold its final frame instead
  // of introducing a conspicuous jump at every loop.
  const fade = Math.min(1, Math.max(0, (progress - 0.82) / 0.18))

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden="true"
      style={{ backgroundColor: C.blueBlack, opacity: 1 - fade }}
    >
      {/* Fill only the letterbox area with a softened copy of the poster.
          It is BEHIND the actual video, so it cannot tint or blur footage. */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: 'url(' + POSTER + ')',
          backgroundSize: 'cover',
          backgroundPosition: 'center center',
          filter: 'blur(24px) brightness(0.65)',
          transform: 'scale(1.08)',
        }}
      />

      {/* The previous implementation used object-cover (cropped/zoomed) plus
          a strong full-frame black gradient (color tint). Neither is applied. */}
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
        muted
        playsInline
        preload="metadata"
        onLoadedData={() => setReady(true)}
        onError={() => setReady(false)}
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
