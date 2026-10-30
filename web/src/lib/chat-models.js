/**
 * Chat only selects model IDs advertised by GET /v1/models.
 * Do not merge Exchange reference-price/search models into this list (#191).
 */
export function normalizeOnlineModels(ids) {
  if (!Array.isArray(ids)) return []
  const seen = new Set()
  for (const id of ids) {
    if (typeof id === 'string' && id.trim() && id !== 'default') {
      seen.add(id)
    }
  }
  return [...seen].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}

/** Search every word, case-insensitively, without changing actual model IDs. */
export function searchOnlineModels(models, text) {
  const terms = text.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
  if (!terms.length) return models
  return models.filter(id => terms.every(term => id.toLocaleLowerCase().includes(term)))
}

/** A historical "default" alias or stale deep link must never be sent as a Chat model. */
export function isRunnableChatModel(model, models) {
  return typeof model === 'string' && model !== 'default' && models.includes(model)
}
