function smoothstep(from: number, to: number, value: number) {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)))
  return t * t * (3 - 2 * t)
}

// Lightweight proof-of-concept overlays, intentionally subtle.
// Real water interaction / mineral particle scattering are later art passes.
export function LakeEffects({ progress, reducedMotion }: { progress: number; reducedMotion: boolean }) {
  if (reducedMotion) return null

  const convergence = smoothstep(0.25, 0.38, progress)
  const departure = 1 - smoothstep(0.64, 0.84, progress)
  const opacity = convergence * departure
  const bloom = smoothstep(0.31, 0.47, progress)
  const rippleScale = 0.5 + convergence * 1.1

  return (
    <svg
      viewBox="0 0 1000 600"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 w-full h-full"
      style={{ opacity }}
    >
      <g transform="translate(500 432)" fill="none" stroke="#b7f3e8">
        <ellipse rx={95 * rippleScale} ry={11 * rippleScale} strokeWidth="1.4" strokeOpacity="0.44" />
        <ellipse rx={150 * rippleScale} ry={17 * rippleScale} strokeWidth="1.1" strokeOpacity="0.24" />
        <ellipse rx={220 * rippleScale} ry={27 * rippleScale} strokeWidth="0.8" strokeOpacity="0.12" />
      </g>
      <g
        style={{
          transform: 'translate(500px, 431px) scale(' + bloom + ')',
          transformOrigin: '0px 0px',
          opacity: bloom * 0.74,
        }}
      >
        <path d="M-28 1 Q-30 -26 -9 -42 Q-4 -17 0 -2 Q4 -17 9 -42 Q30 -26 28 1Z" fill="#e7b6b6" stroke="#fff1e5" strokeOpacity="0.45" />
        <path d="M-21 1 Q-41 -10 -49 -24 Q-47 3 -16 9Z M21 1 Q41 -10 49 -24 Q47 3 16 9Z" fill="#efd7bc" stroke="#fff1e5" strokeOpacity="0.4" />
        <path d="M-45 8 Q-2 15 45 8" fill="none" stroke="#87db9e" strokeWidth="3" strokeLinecap="round" />
      </g>
    </svg>
  )
}
