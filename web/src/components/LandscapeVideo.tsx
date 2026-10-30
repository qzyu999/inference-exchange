import { useEffect, useRef, useState } from 'react'
import { C } from '../lib/theme'

interface LandscapeVideoProps {
  progress: number
  reducedMotion: boolean
  onAvailabilityChange: (available: boolean) => void
}

// Optional media: if the MP4 isn't present, the existing Three.js scene remains
// available. Copy the video and poster from the review bundle (see media/README).
export function LandscapeVideo({ progress, reducedMotion, onAvailabilityChange }: LandscapeVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [ready, setReady] = useState(false)

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

  // The 5-second source isn't seamless. Hold its last frame rather than
  // forcing an obvious discontinuity every five seconds.
  const fade = Math.min(1, Math.max(0, (progress - 0.82) / 0.18))

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden="true"
      style={{
        background: 'radial-gradient(ellipse at 50% 72%, #1b5c70 0%, #101e30 55%, ' + C.blueBlack + ' 100%)',
        opacity: 1 - fade,
      }}
    >
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-cover"
        style={{
          objectPosition: 'center center',
          opacity: ready ? 1 : 0,
          transition: 'opacity 900ms ease-out',
        }}
        src="/media/alpine-lake-hero.mp4"
        poster="/media/alpine-lake-poster.webp"
        autoPlay={!reducedMotion}
        muted
        playsInline
        preload="metadata"
        onLoadedData={() => setReady(true)}
        onError={() => setReady(false)}
      />
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(180deg, rgba(6,14,22,0.56) 0%, rgba(6,14,22,0.08) 35%, rgba(5,17,26,0.10) 55%, rgba(5,17,26,0.56) 100%)',
        }}
      />
    </div>
  )
}
