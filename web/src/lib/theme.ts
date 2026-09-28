/**
 * Inference Exchange — Mineral Gradient Palette
 *
 * Derived from the Figma UX design (issue #51). The palette is inspired by
 * natural minerals rather than typical AI-product neon. Warm tones (amber,
 * copper, cinnabar, garnet) represent the demand/consumer side; cool tones
 * (jade, chrysocolla, slate) represent the supply/provider side.
 *
 * Every color used across the app imports from here — no more per-file
 * `const C = { ... }` duplication.
 */

// ─── Core brand colors ───────────────────────────────────────

export const C = {
  // Warm mineral spectrum (demand / consumer side)
  red:       '#B7443B',   // cinnabar — errors, destructive, fallback
  orange:    '#D77A2F',   // carnelian — warming accent
  gold:      '#C49A45',   // raw amber — primary brand accent
  copper:    '#CE8637',   // vivid copper — gradient accent (from Figma)

  // Cool mineral spectrum (supply / provider side)
  green:     '#3F8055',   // aventurine — success, online, verified
  turquoise: '#4D9A91',   // chrysocolla — intersection, speed/TPS
  jade:      '#1C8565',   // malachite — vivid supply accent
  deepBlue:  '#315B72',   // labradorite — encryption, input pricing

  // Neutral mineral tones
  indigo:    '#4A465F',   // sodalite — muted accent, decorative
  blueBlack: '#292F35',   // obsidian — sidebar bg, dark text, buttons

  // Surfaces
  black:     '#292B2A',   // near-black body bg (WebGL scene)
  darkBg:    '#383330',   // warm dark surface (Figma design screens)
  pageBg:    '#F5F5F1',   // cool stone — light page background
  warmWhite: '#D8D1BE',   // sandstone — text-on-dark, landing accents
  sand:      '#E1CBA1',   // lighter sand — badges, highlights
  parchment: '#ECEAE4',   // card borders, dividers on light bg

  // Sidebar
  sidebarBg:     '#292F35',
  sidebarText:   '#a8a8a0',
  sidebarActive: '#C49A45',
  sidebarHover:  'rgba(255,255,255,0.06)',

  // Page text
  pageText: '#292F35',
} as const

// ─── Trust level badge colors ────────────────────────────────

export const TRUST_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  open:         { bg: '#f3f3f3', text: '#999',       label: 'Open' },
  contained:    { bg: '#eef3f7', text: C.deepBlue,   label: 'Contained' },
  hardened:     { bg: '#fdf6ec', text: C.gold,        label: 'Hardened+' },
  confidential: { bg: '#edf7f1', text: C.green,       label: 'Confidential' },
}

// ─── Gradient definitions ────────────────────────────────────

export const GRADIENTS = {
  /** Hero headline: warm mineral gradient (gold → copper → cinnabar) */
  heroText: `linear-gradient(to right, ${C.gold}, ${C.copper}, ${C.red})`,

  /** Landing hero BG fade */
  heroBg: `linear-gradient(to bottom, ${C.black}, ${C.blueBlack})`,

  /** Sidebar vertical: obsidian → deep garnet-indigo → slate */
  sidebar: `linear-gradient(180deg, ${C.blueBlack} 0%, #2D2832 35%, #2A2F36 70%, #252A30 100%)`,

  /** Mineral accent bar: warm copper → gold → jade transition */
  mineralBar: `linear-gradient(to right, ${C.red}, ${C.copper}, ${C.gold}, ${C.turquoise}, ${C.jade})`,

  /** Mineral glow: subtle warm radial for page backgrounds */
  mineralGlow: `radial-gradient(ellipse at 20% 0%, rgba(206,134,55,0.04) 0%, transparent 60%), radial-gradient(ellipse at 80% 100%, rgba(77,154,145,0.03) 0%, transparent 60%)`,

  /** Card border shimmer: copper → gold for featured cards */
  cardBorder: `linear-gradient(135deg, ${C.copper}44, ${C.gold}66, ${C.turquoise}44)`,

  /** Text gradient for page titles */
  titleText: `linear-gradient(135deg, ${C.blueBlack}, ${C.indigo})`,

  /** Full mineral spectrum for special emphasis */
  fullSpectrum: `linear-gradient(to right, ${C.red}, ${C.copper}, ${C.gold}, ${C.green}, ${C.turquoise}, ${C.jade})`,
} as const

// ─── WebGL / Three.js hex ints ───────────────────────────────

export const GL = {
  amber:    0xCE8637,  // copper/amber for demand tetra
  emerald:  0x3F8055,  // aventurine for supply tetra
  bg:       0x292B2A,  // scene background
  chryso:   0x4D9A91,  // octahedron intersection
  gold:     0xC49A45,  // sun
  warmWhite:0xD8D1BE,  // dust, moon
  darkBg:   0x383330,  // warm dark for scene fade-to
} as const
