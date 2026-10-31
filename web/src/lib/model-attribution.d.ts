export interface ModelAttributionRecord {
  model?: string | null
  requested_model?: string | null
  served_model?: string | null
}

export function requestedModelLabel(tx: ModelAttributionRecord | null | undefined): string
export function servedModelLabel(tx: ModelAttributionRecord | null | undefined): string
