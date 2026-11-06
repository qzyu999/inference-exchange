export interface StartStep {
  id: string; title: string; description: string; expected: string; help: string
  action?: string; to?: string; command?: string
  check?: 'auth' | 'models' | 'keys' | 'nodes'
  gate?: boolean
}
export interface StartJourney { id: 'api' | 'provider'; name: string; summary: string; audience: string; steps: StartStep[] }
export const JOURNEYS: StartJourney[]
export function feedbackHref(journey: StartJourney, step: StartStep): string
export function resolveStartJourney(id?: string): string | undefined
export function sdkExample(model: string): string
