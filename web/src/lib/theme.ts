/**
 * Inference Exchange — Tibetan mineral spectrum
 *
 * A restrained pigment system inspired by saturated mineral colors used in
 * Tibetan Buddhist painting, expanded into a product-specific computational spectrum.
 * The spectrum is an energy field; individual colors carry semantic weight.
 */

export const C = {
  red: '#C83A32',
  orange: '#D77A2F',
  gold: '#C49A45',
  green: '#087F5B',
  turquoise: '#4D9A91',
  deepBlue: '#315B72',
  indigo: '#4A465F',
  maroon: '#702F32',
  blueBlack: '#292F35',
  black: '#292B2A',
  darkBg: '#383330',
  pageBg: '#F5F5F1',
  warmWhite: '#D8D1BE',
  sand: '#E1CBA1',
  parchment: '#ECEAE4',
  copper: '#D77A2F',
  jade: '#087F5B',
  sidebarBg: '#292F35',
  sidebarText: '#A8A8A0',
  sidebarActive: '#C49A45',
  sidebarHover: 'rgba(255,255,255,0.06)',
  pageText: '#292F35',
} as const

/**
 * Product workbench pilot (#203). These semantic mineral tones reconcile
 * the new Tibetan/Sichuan-inspired landing art with dense data interfaces.
 * Keep C/TRUST_COLORS untouched while piloting the shared shell.
 */
export const APP_PIGMENTS = {
  deepLapis: '#102D6D',
  lapis: '#163E8C',
  indigoSmoke: '#433763',
  orpiment: '#F0C54B',
  saffron: '#E29A2D',
  cinnabar: '#C94C2F',
  jade: '#5F8E61',
  malachite: '#3F7B67',
  silk: '#F2DFC0',
  cloud: '#FBF4E4',
  parchment: '#F7F2E8',
  paper: '#FFFDF7',
  line: '#D9C8AA',
  ink: '#263A63',
  body: '#46546A',
  goldInk: '#845918',
  jadeInk: '#31644E',
  sidebarText: '#EADFCB',
  sidebarMuted: '#C4BBD0',
  // Soft illustrated-sky wash: sage-gray mist above, a small ochre sun haze
  // at the horizon, resolving to light silk. The entire page stays readable.
  atmosphere: 'radial-gradient(ellipse 59% 39% at 84% 27%, rgba(229,171,101,0.23) 0%, transparent 75%), radial-gradient(ellipse 65% 40% at 12% 8%, rgba(107,149,146,0.17) 0%, transparent 76%), linear-gradient(180deg, #C5D1CD 0%, #D6D9CA 19%, #E5D5BA 43%, #ECD8B9 57%, #F5EBD9 80%, #FAF7EE 100%)',
} as const

// Trust levels are claimed by providers and not yet independently verified (see #1). Say so wherever they are shown.
export const TRUST_CLAIM_NOTE = 'Self-reported by the provider. Independent verification is not live yet.'

export const TRUST_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  open: { bg: '#F3F3F3', text: '#888', label: 'Open' },
  contained: { bg: '#EEF3F7', text: C.deepBlue, label: 'Contained' },
  hardened: { bg: '#FDF6EC', text: C.gold, label: 'Hardened+' },
  confidential: { bg: '#EDF7F1', text: C.green, label: 'Confidential' },
}

export const GRADIENTS = {
  heroText: 'linear-gradient(90deg, ' + C.gold + ', ' + C.orange + ', ' + C.red + ')',
  heroBg: 'linear-gradient(180deg, ' + C.black + ', ' + C.blueBlack + ')',
  sidebar: 'linear-gradient(180deg, ' + C.blueBlack + ' 0%, #302A31 34%, #293137 70%, #252A30 100%)',
  fullSpectrum: 'linear-gradient(90deg, ' + C.red + ' 0%, ' + C.orange + ' 14%, ' + C.gold + ' 28%, ' + C.green + ' 43%, ' + C.turquoise + ' 57%, ' + C.deepBlue + ' 72%, ' + C.indigo + ' 86%, ' + C.maroon + ' 100%)',
  demandToExchange: 'linear-gradient(90deg, ' + C.red + ', ' + C.orange + ', ' + C.gold + ', ' + C.turquoise + ')',
  market: 'linear-gradient(90deg, ' + C.red + ', ' + C.gold + ', ' + C.green + ', ' + C.turquoise + ')',
  supplyToValue: 'linear-gradient(90deg, ' + C.green + ', ' + C.turquoise + ', ' + C.gold + ')',
  trust: 'linear-gradient(90deg, ' + C.turquoise + ', ' + C.deepBlue + ', ' + C.indigo + ', ' + C.maroon + ')',
  mineralBar: 'linear-gradient(90deg, ' + C.red + ', ' + C.orange + ', ' + C.gold + ', ' + C.green + ', ' + C.turquoise + ', ' + C.deepBlue + ', ' + C.indigo + ', ' + C.maroon + ')',
  mineralGlow: 'radial-gradient(ellipse at 12% 0%, rgba(215,122,47,0.045) 0%, transparent 58%), radial-gradient(ellipse at 88% 100%, rgba(77,154,145,0.04) 0%, transparent 58%)',
  cardBorder: 'linear-gradient(135deg, ' + C.red + '33, ' + C.gold + '55, ' + C.turquoise + '44, ' + C.deepBlue + '33)',
  titleText: 'linear-gradient(135deg, ' + C.blueBlack + ', ' + C.indigo + ')',
} as const

export const GL = {
  amber: 0xC83A32,
  emerald: 0x087F5B,
  bg: 0x292B2A,
  chryso: 0x4D9A91,
  gold: 0xC49A45,
  warmWhite: 0xD8D1BE,
  darkBg: 0x383330,
} as const