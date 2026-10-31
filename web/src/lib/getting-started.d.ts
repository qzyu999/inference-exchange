export interface StartStep {
  id: string
  title: string
  description: string
  expected: string
  help: string
  action: string
  to: string
  check?: 'auth' | 'models' | 'keys' | 'nodes' | 'earnings'
  gate?: boolean
  platform?: boolean
}
export interface StartJourney {
  id: 'consumer' | 'api' | 'provider' | 'both'
  name: string
  summary: string
  audience: string
  steps: StartStep[]
}
export const JOURNEYS: StartJourney[]
export const GLOSSARY: string[][]
export function feedbackHref(journey: StartJourney, step: StartStep): string
export function progressStorageKey(userId?: string | null): string
export function completedSteps(journey: StartJourney, confirmations: Record<string, boolean>): number
