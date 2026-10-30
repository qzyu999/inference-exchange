import { searchModelItems } from './model-search.js'

/**
 * Chat only selects model IDs advertised by GET /v1/models.
 * Do not merge Exchange reference-price/search models into this list (#191).
 */
export function normalizeOnlineModels(ids) {
  if (!Array.isArray(ids)) return []
  const seen = new Set()
  for (const id of ids) {
    if (typeof id === 'string' && id.trim() && id.trim() !== 'default') {
      seen.add(id)
    }
  }
  return [...seen].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}

/** Search every word, case-insensitively, without changing actual model IDs. */
export function searchOnlineModels(models, text) {
  return searchModelItems(models.map(id => ({ key: id, name: id })), text).map(item => item.key)
}

/** A historical "default" alias or stale deep link must never be sent as a Chat model. */
export function isRunnableChatModel(model, models) {
  return typeof model === 'string' && model !== 'default' && models.includes(model)
}
