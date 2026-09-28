import { useEffect, useRef } from 'react'

/**
 * MineralAurora
 *
 * A restrained, living mineral-pigment field. Unlike a generic AI rainbow,
 * the spectrum is spatially continuous: warm demand colors migrate through
 * gold and green into turquoise, blue, indigo and maroon.
 *
 * Network events inject small pulses into the field. The effect is deliberately
 * low-contrast so product data remains the visual priority.
 */

const SPECTRUM: Array<[number, number, number]> = [
  [200, 58, 50],   // cinnabar / red
  [215, 122, 47],  // orange
  [196, 154, 69],  // gold
  [8, 127, 91],    // green
  [77, 154, 145],  // turquoise
  [49, 91, 114],   // deep blue
  [74, 70, 95],    // indigo
  [112, 47, 50],   // maroon
]

function fade(t: number) { return t * t * t * (t * (t * 6 - 15) + 10) }
function lerp(a: number, b: number, t: number) { return a + (b - a) * t }

function hash(x: number, y: number): number {
  let h = x * 374761393 + y * 668265263
  h = (h ^ (h >> 13)) * 1274126177
  return (h ^ (h >> 16)) & 0xff
}

function noise2d(x: number, y: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = fade(x - xi)
  const yf = fade(y - yi)
  const aa = hash(xi, yi) / 255
  const ab = hash(xi, yi + 1) / 255
  const ba = hash(xi + 1, yi) / 255
  const bb = hash(xi + 1, yi + 1) / 255
  return lerp(lerp(aa, ba, xf), lerp(ab, bb, xf), yf)
}

function fbm(x: number, y: number, octaves: number): number {
  let value = 0
  let amplitude = 0.5
  let frequency = 1
  for (let i = 0; i < octaves; i++) {
    value += amplitude * noise2d(x * frequency, y * frequency)
    amplitude *= 0.5
    frequency *= 2
  }
  return value
}

function spectrumColor(position: number): [number, number, number] {
  const p = Math.max(0, Math.min(0.9999, position)) * (SPECTRUM.length - 1)
  const i = Math.floor(p)
  const t = p - i
  const a = SPECTRUM[i]
  const b = SPECTRUM[Math.min(i + 1, SPECTRUM.length - 1)]
  return [
    lerp(a[0], b[0], t),
    lerp(a[1], b[1], t),
    lerp(a[2], b[2], t),
  ]
}

interface Pulse {
  x: number
  y: number
  warmth: number
  energy: number
  born: number
}

interface MineralAuroraProps {
  className?: string
  opacity?: number
  speed?: number
  variant?: 'dark' | 'light'
  pulses?: Pulse[]
  mouseX?: number
}

export function MineralAurora({
  className = '',
  opacity = 0.12,
  speed = 0.00003,
  variant = 'dark',
  pulses = [],
  mouseX,
}: MineralAuroraProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef(0)
  const timeRef = useRef(performance.now() / 1000)
  const pulsesRef = useRef<Pulse[]>([])
  const mouseXRef = useRef(0.5)

  pulsesRef.current = pulses
  if (mouseX !== undefined) mouseXRef.current = mouseX

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const W = 128
    const H = 80
    canvas.width = W
    canvas.height = H

    const imageData = ctx.createImageData(W, H)
    const data = imageData.data

    const render = () => {
      const t = reducedMotion ? 0 : timeRef.current
      const mx = mouseXRef.current

      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const nx = x / (W - 1)
          const ny = y / (H - 1)

          const n1 = fbm(nx * 2.4 + t * 0.018, ny * 2.2 + t * 0.009, 3)
          const n2 = fbm(nx * 1.8 - t * 0.012, ny * 3.0 + t * 0.016, 3)
          const n3 = fbm(nx * 3.5 + t * 0.025, ny * 1.6 - t * 0.011, 2)

          // The field moves along the full mineral spectrum rather than
          // jumping between separate warm/cool palettes.
          let spectrumT = nx * 0.78 + n1 * 0.20 + n2 * 0.08
          spectrumT += (0.5 - mx) * 0.06

          let pulseAlpha = 0
          for (const pulse of pulsesRef.current) {
            const age = Math.max(0, t - pulse.born)
            const energy = Math.max(0, 1 - age * 0.9)
            if (energy <= 0) continue
            const dx = nx - pulse.x
            const dy = ny - pulse.y
            const dist = Math.sqrt(dx * dx + dy * dy)
            const radius = age * 0.22
            const ring = Math.exp(-Math.pow((dist - radius) / 0.09, 2))
            spectrumT += pulse.warmth * ring * energy * 0.08
            pulseAlpha += ring * energy * 0.28
          }

          const [r, g, b] = spectrumColor(spectrumT)

          const edgeX = 1 - Math.pow(2 * nx - 1, 4)
          const edgeY = 1 - Math.pow(2 * ny - 1, 4)
          const vignette = Math.max(0, edgeX * edgeY)

          const baseAlpha = variant === 'dark'
            ? n3 * 0.38 + n1 * 0.16
            : n3 * 0.18 + n1 * 0.08

          const alpha = Math.max(0, Math.min(1, (baseAlpha + pulseAlpha) * vignette))

          const idx = (y * W + x) * 4
          data[idx] = r
          data[idx + 1] = g
          data[idx + 2] = b
          data[idx + 3] = alpha * 255
        }
      }

      ctx.putImageData(imageData, 0, 0)
      if (!reducedMotion) {
        timeRef.current += speed
        frameRef.current = requestAnimationFrame(render)
      }
    }

    render()
    return () => cancelAnimationFrame(frameRef.current)
  }, [speed, variant])

  return (
    <canvas
      ref={canvasRef}
      className={`pointer-events-none ${className}`}
      style={{
        width: '100%',
        height: '100%',
        opacity,
        filter: 'blur(34px) saturate(0.92)',
        imageRendering: 'auto',
      }}
      aria-hidden="true"
    />
  )
}

export function useNetworkPulses(
  events: Array<{ type: string; timestamp: number }>,
  _time: number,
): Pulse[] {
  const pulsesRef = useRef<Pulse[]>([])

  useEffect(() => {
    if (events.length === 0) return
    const latest = events[events.length - 1]
    const born = performance.now() / 1000

    let warmth = 0
    let x = 0.5
    let y = 0.5

    if (latest.type === 'match') {
      warmth = 0.20
      x = 0.5
      y = 0.45
    } else if (latest.type === 'provider_connect') {
      warmth = 0.45
      x = 0.12
      y = 0.5
    } else if (latest.type === 'provider_disconnect') {
      warmth = -0.35
      x = 0.88
      y = 0.5
    } else if (latest.type === 'billing') {
      warmth = 0.05
      x = 0.62
      y = 0.32
    } else if (latest.type === 'attestation') {
      warmth = -0.12
      x = 0.72
      y = 0.68
    }

    if (warmth !== 0) {
      pulsesRef.current = [
        ...pulsesRef.current.filter(p => born - p.born < 5).slice(-7),
        { x, y, warmth, energy: 1, born },
      ]
    }
  }, [events.length])

  return pulsesRef.current
}

export function NetworkHeartbeat({ online, eventCount }: { online: boolean; eventCount: number }) {
  const pulseRef = useRef<HTMLSpanElement>(null)
  const prevCountRef = useRef(eventCount)

  useEffect(() => {
    if (eventCount > prevCountRef.current && pulseRef.current) {
      pulseRef.current.style.transform = 'scale(1.8)'
      pulseRef.current.style.opacity = '0.6'
      const timeout = setTimeout(() => {
        if (pulseRef.current) {
          pulseRef.current.style.transform = 'scale(1)'
          pulseRef.current.style.opacity = '1'
        }
      }, 300)
      prevCountRef.current = eventCount
      return () => clearTimeout(timeout)
    }
    prevCountRef.current = eventCount
  }, [eventCount])

  return (
    <span className="relative inline-flex items-center justify-center w-3 h-3">
      <span
        className="absolute inset-0 rounded-full animate-ping"
        style={{
          background: online ? '#087F5B' : '#C83A32',
          opacity: 0.2,
          animationDuration: online ? '3s' : '1.5s',
        }}
      />
      <span
        ref={pulseRef}
        className="relative rounded-full w-2.5 h-2.5 transition-all duration-300"
        style={{
          background: online
            ? 'linear-gradient(135deg, #087F5B, #4D9A91)'
            : 'linear-gradient(135deg, #C83A32, #D77A2F)',
          boxShadow: online
            ? '0 0 6px rgba(8,127,91,0.35)'
            : '0 0 6px rgba(200,58,50,0.35)',
        }}
      />
    </span>
  )
}
