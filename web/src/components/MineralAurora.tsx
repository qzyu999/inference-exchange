import { useEffect, useRef, useCallback } from 'react'

/**
 * MineralAurora — A living, breathing gradient mesh that sits behind content.
 *
 * Uses a canvas with organic noise to create an aurora-like effect that slowly
 * shifts through the mineral palette. Think northern lights, but in copper,
 * gold, jade, and chrysocolla instead of green and purple.
 *
 * Supports reactive mode: external pulses (from network events) inject energy
 * into the noise field, causing warm or cool ripples that decay naturally.
 * The mouse position can bias the color temperature across the canvas.
 */

// Mineral palette as [r, g, b] triplets — warm to cool
const WARM_PALETTE = [
  [183, 68, 59],    // cinnabar
  [206, 134, 55],   // copper
  [196, 154, 69],   // gold
]
const COOL_PALETTE = [
  [63, 128, 85],    // aventurine
  [77, 154, 145],   // chrysocolla
  [28, 133, 101],   // jade
]
const NEUTRAL_PALETTE = [
  [49, 91, 114],    // labradorite
  [74, 70, 95],     // sodalite
]
const FULL_PALETTE = [...WARM_PALETTE, ...COOL_PALETTE, ...NEUTRAL_PALETTE]

// Simple 2D noise
function fade(t: number) { return t * t * t * (t * (t * 6 - 15) + 10) }
function lerp(a: number, b: number, t: number) { return a + t * (b - a) }

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
  let value = 0, amplitude = 0.5, frequency = 1
  for (let i = 0; i < octaves; i++) {
    value += amplitude * noise2d(x * frequency, y * frequency)
    amplitude *= 0.5
    frequency *= 2
  }
  return value
}

/** A pulse injected from outside — decays over time */
interface Pulse {
  x: number       // 0-1 normalized position
  y: number
  warmth: number  // -1 (cool) to +1 (warm)
  energy: number  // starts at 1, decays to 0
  born: number    // time when created
}

interface MineralAuroraProps {
  className?: string
  opacity?: number
  speed?: number
  variant?: 'dark' | 'light'
  /** Inject a reactive pulse (from network events) */
  pulses?: Pulse[]
  /** Mouse position 0-1 for cursor-reactive color bias (landing only) */
  mouseX?: number
}

export function MineralAurora({ className = '', opacity = 0.12, speed = 0.0003, variant = 'dark', pulses = [], mouseX }: MineralAuroraProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef(0)
  const timeRef = useRef(0)
  const pulsesRef = useRef<Pulse[]>([])
  const mouseXRef = useRef(0.5)

  // Keep pulses ref current
  pulsesRef.current = pulses
  if (mouseX !== undefined) mouseXRef.current = mouseX

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return

    const W = 128
    const H = 80
    canvas.width = W
    canvas.height = H

    const imageData = ctx.createImageData(W, H)
    const data = imageData.data

    const animate = () => {
      timeRef.current += speed
      const t = timeRef.current

      // Decay and clean up old pulses
      const activePulses = pulsesRef.current.filter(p => {
        const age = t - p.born
        p.energy = Math.max(0, 1 - age * 2)
        return p.energy > 0.01
      })

      const mx = mouseXRef.current // 0=left (warm), 1=right (cool)

      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const nx = x / W
          const ny = y / H

          const n1 = fbm(nx * 3 + t * 0.7, ny * 2.5 + t * 0.3, 3)
          const n2 = fbm(nx * 2 - t * 0.5, ny * 3 + t * 0.8, 3)
          const n3 = fbm(nx * 4 + t * 1.2, ny * 1.5 - t * 0.4, 2)

          // Base warmth: noise-driven, biased by mouse position
          let warmth = n1 - 0.5 // -0.5 to 0.5
          if (mx !== undefined) {
            // Left = warm bias, right = cool bias
            warmth += (0.5 - mx) * 0.4
          }

          // Add pulse influence
          for (const pulse of activePulses) {
            const dx = nx - pulse.x
            const dy = ny - pulse.y
            const dist = Math.sqrt(dx * dx + dy * dy)
            // Expanding ring ripple
            const ringRadius = (t - pulse.born) * 0.8
            const ringWidth = 0.15
            const ringInfluence = Math.exp(-Math.pow((dist - ringRadius) / ringWidth, 2))
            warmth += pulse.warmth * ringInfluence * pulse.energy * 0.6
          }

          warmth = Math.max(-1, Math.min(1, warmth))

          // Pick palette based on warmth
          let palette: number[][]
          let palIdx: number
          if (warmth > 0.15) {
            palette = WARM_PALETTE
            palIdx = warmth * (palette.length - 1)
          } else if (warmth < -0.15) {
            palette = COOL_PALETTE
            palIdx = -warmth * (palette.length - 1)
          } else {
            // Neutral zone — use full palette with noise-driven selection
            palette = FULL_PALETTE
            palIdx = (n2 + 0.5) * (palette.length - 1)
          }

          const ci = Math.floor(palIdx) % palette.length
          const ci2 = (ci + 1) % palette.length
          const blend = palIdx - Math.floor(palIdx)

          const [r1, g1, b1] = palette[ci]
          const [r2, g2, b2] = palette[ci2]

          const r = lerp(r1, r2, blend)
          const g = lerp(g1, g2, blend)
          const b = lerp(b1, b2, blend)

          // Alpha
          let alphaBase = variant === 'dark'
            ? n3 * 0.6 + n1 * 0.3
            : n3 * 0.35 + n1 * 0.15

          // Pulses boost alpha in their ripple area
          for (const pulse of activePulses) {
            const dx = nx - pulse.x
            const dy = ny - pulse.y
            const dist = Math.sqrt(dx * dx + dy * dy)
            const ringRadius = (t - pulse.born) * 0.8
            const ringInfluence = Math.exp(-Math.pow((dist - ringRadius) / 0.15, 2))
            alphaBase += ringInfluence * pulse.energy * 0.4
          }

          const vx = 1 - Math.pow(2 * nx - 1, 4)
          const vy = 1 - Math.pow(2 * ny - 1, 4)
          const alpha = Math.max(0, Math.min(1, alphaBase * vx * vy))

          const idx = (y * W + x) * 4
          data[idx] = r
          data[idx + 1] = g
          data[idx + 2] = b
          data[idx + 3] = alpha * 255
        }
      }

      ctx.putImageData(imageData, 0, 0)
      frameRef.current = requestAnimationFrame(animate)
    }

    frameRef.current = requestAnimationFrame(animate)
    return () => { cancelAnimationFrame(frameRef.current) }
  }, [speed, variant])

  return (
    <canvas
      ref={canvasRef}
      className={`pointer-events-none ${className}`}
      style={{
        width: '100%',
        height: '100%',
        opacity,
        filter: 'blur(40px)',
        imageRendering: 'auto',
      }}
    />
  )
}

/** Hook to generate pulses from network events */
export function useNetworkPulses(events: Array<{ type: string; timestamp: number }>, time: number): Pulse[] {
  const pulsesRef = useRef<Pulse[]>([])

  useEffect(() => {
    if (events.length === 0) return
    const latest = events[events.length - 1]

    // Match events → warm pulse from center
    // Provider events → cool pulse from random edge
    // Billing events → gold pulse
    let warmth = 0
    let x = 0.5, y = 0.5
    if (latest.type === 'match') {
      warmth = 0.8
      x = 0.4 + Math.random() * 0.2
      y = 0.4 + Math.random() * 0.2
    } else if (latest.type === 'provider_connect') {
      warmth = -0.8
      x = Math.random() > 0.5 ? 0.9 : 0.1
      y = Math.random()
    } else if (latest.type === 'provider_disconnect') {
      warmth = -0.4
      x = Math.random() > 0.5 ? 0.9 : 0.1
      y = Math.random()
    } else if (latest.type === 'billing') {
      warmth = 0.5
      x = 0.5
      y = 0.3
    } else if (latest.type === 'attestation') {
      warmth = -0.3
      x = 0.5
      y = 0.7
    }

    if (warmth !== 0) {
      pulsesRef.current = [
        ...pulsesRef.current.filter(p => p.energy > 0.01).slice(-8),
        { x, y, warmth, energy: 1, born: time }
      ]
    }
  }, [events.length, time])

  return pulsesRef.current
}

/**
 * NetworkHeartbeat — A breathing pulse indicator that reflects real event cadence.
 * Replaces the static status dot with a living rhythm.
 */
export function NetworkHeartbeat({ online, eventCount }: { online: boolean; eventCount: number }) {
  const pulseRef = useRef<HTMLSpanElement>(null)
  const prevCountRef = useRef(eventCount)

  useEffect(() => {
    if (eventCount > prevCountRef.current && pulseRef.current) {
      // Trigger a beat animation
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
      {/* Breathing outer ring */}
      <span
        className="absolute inset-0 rounded-full animate-ping"
        style={{
          background: online ? '#3F8055' : '#B7443B',
          opacity: 0.2,
          animationDuration: online ? '3s' : '1.5s',
        }}
      />
      {/* Core dot with event-reactive beat */}
      <span
        ref={pulseRef}
        className="relative rounded-full w-2.5 h-2.5 transition-all duration-300"
        style={{
          background: online
            ? 'linear-gradient(135deg, #3F8055, #4D9A91)'
            : 'linear-gradient(135deg, #B7443B, #CE8637)',
          boxShadow: online
            ? '0 0 6px rgba(63,128,85,0.4)'
            : '0 0 6px rgba(183,68,59,0.4)',
        }}
      />
    </span>
  )
}
