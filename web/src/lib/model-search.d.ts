export interface SearchableModelItem {
  key: string
  name: string
  subtitle?: string
  group?: string
  keywords?: string
}
export function searchModelItems<T extends SearchableModelItem>(items: readonly T[], query: string): T[]

export function isModelSearchDisabled(state: {
  disabled?: boolean
  loading?: boolean
  resultCount?: number
  hasFilters?: boolean
}): boolean
