import type { CSSProperties } from 'react'

export type MineralVariant = 'consumer' | 'market' | 'provider' | 'trust'

const SPECTRUM = 'linear-gradient(90deg, #C83A32 0%, #D77A2F 14%, #C49A45 28%, #087F5B 43%, #4D9A91 57%, #315B72 72%, #4A465F 86%, #702F32 100%)'

const AURAS: Record<MineralVariant, { primary: string; secondary: string; angle: string }> = {
  consumer: {
    primary: 'rgba(198,58,50,0.16)',
    secondary: 'rgba(77,154,145,0.12)',
    angle: '135deg',
  },
  market: {
    primary: 'rgba(198,58,50,0.13)',
    secondary: 'rgba(8,127,91,0.16)',
    angle: '120deg',
  },
  provider: {
    primary: 'rgba(8,127,91,0.16)',
    secondary: 'rgba(196,154,69,0.14)',
    angle: '120deg',
  },
  trust: {
    primary: 'rgba(77,154,145,0.14)',
    secondary: 'rgba(49,91,114,0.16)',
    angle: '110deg',
  },
}

export function MineralField({ variant }: { variant: MineralVariant }) {
  const aura = AURAS[variant]

  const glow: CSSProperties = {
    background: `linear-gradient(${aura.angle}, ${aura.primary} 0%, transparent 48%, ${aura.secondary} 100%)`,
    filter: 'blur(44px)',
    transform: 'scale(1.12)',
  }

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute -inset-16 opacity-90" style={glow} />
      <div
        className="absolute left-0 right-0 top-0 h-[3px] opacity-90"
        style={{ background: SPECTRUM }}
      />
      <div
        className="absolute -top-20 right-[8%] h-48 w-2/3 rounded-full opacity-25 blur-3xl"
        style={{ background: SPECTRUM }}
      />
    </div>
  )
}
