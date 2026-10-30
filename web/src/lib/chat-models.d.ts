/** Normalized, currently online IE model IDs, not external reference-only models. */
export function normalizeOnlineModels(ids: unknown): string[]
export function searchOnlineModels(models: readonly string[], search: string): string[]
export function isRunnableChatModel(model: string, models: readonly string[]): boolean
