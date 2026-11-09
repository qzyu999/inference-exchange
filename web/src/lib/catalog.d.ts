export function formatRate(value: string | null | undefined): string
export function savingsLabel(a: string | null | undefined, b: string | null | undefined): string
export function eligible(ie: unknown, other: unknown): boolean
export function identityLabel(source?: string, trust?: string): string
export function endpointRows<T>(rows: T[]): T[]
export function catalogFamilies(list: import('./api').CatalogModel[], market: any[]): Array<{
  family_key: string; display_name: string; prices: any[]; provider_count: number
  marketModel?: any; ieProviders: any[]
  family?: string | null; total_parameters?: number | null
}>
