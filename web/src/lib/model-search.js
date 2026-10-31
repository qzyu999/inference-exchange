/**
 * Shared model search semantics for Chat inference and Exchange discovery.
 * No model data is fetched or merged here. The parent decides which models exist.
 */
export function searchModelItems(items, query) {
  const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (!tokens.length) return items
  return items.filter(item => {
    const haystack = [
      item.key, item.name, item.subtitle, item.group, item.keywords,
    ].filter(Boolean).join(' ').toLocaleLowerCase()
    return tokens.every(token => haystack.includes(token))
  })
}

/**
 * An empty result list may be the result of a *reversible filter*, not a
 * permanently unavailable catalog. Keep the filter popup accessible (#194).
 */
export function isModelSearchDisabled({ disabled = false, loading = false, resultCount = 0, hasFilters = false }) {
  return Boolean(disabled || loading || (resultCount === 0 && !hasFilters))
}
