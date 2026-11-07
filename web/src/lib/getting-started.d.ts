export interface StartStep {
  id: string; title: string; description: string; expected: string; help: string
  action?: string; to?: string; command?: string
  check?: 'auth' | 'models' | 'keys' | 'nodes'
  gate?: boolean
  takeaway?: string; label?: string; reference?: string
}
export interface StartJourney { id: 'ocip' | 'api' | 'provider'; name: string; summary: string; audience: string; steps: StartStep[] }
export const JOURNEYS: StartJourney[]
export function feedbackHref(journey: StartJourney, step: StartStep): string
export function resolveStartJourney(id?: string): string | undefined
export type OcipMinimum = 'open' | 'contained' | 'hardened' | 'confidential'
export const OCIP_MINIMUMS: ReadonlyArray<{ value: OcipMinimum; label: string }>
export function sdkExample(model: string, minimum?: OcipMinimum): string
