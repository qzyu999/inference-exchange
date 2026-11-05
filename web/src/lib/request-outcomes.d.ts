export interface RequestOutcome {
  label: string
  group: 'completed' | 'routed' | 'rejected' | 'other'
  tone: 'success' | 'warning' | 'danger' | 'muted'
}
export function requestOutcome(status: string | null | undefined): RequestOutcome
