// Browser-only operator API. Keep credentials in the HttpOnly IE session cookie.
// Cloudflare Access must independently protect admin paths on the deployed hostname.
async function request(path, { method = 'GET', body } = {}) {
  const response = await fetch(path, {
    method,
    credentials: 'include',
    ...(body === undefined ? {} : {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  })
  if (!response.ok) {
    let message = `HTTP ${response.status}`
    try {
      const payload = await response.json()
      const detail = payload?.error || payload?.detail
      if (typeof detail === 'string') message += `: ${detail}`
    } catch { /* Do not leak HTML error pages or opaque proxy responses. */ }
    throw new Error(message)
  }
  return response.json()
}

export const loadOperatorControls = () => request('/v1/admin/controls')
export const updateOperatorControls = changes => request('/v1/admin/controls', { method: 'POST', body: changes })
export const clearOperatorQueue = () => request('/v1/admin/queue/clear', { method: 'POST' })
export const quarantineProvider = (providerId, reason) => request(
  `/v1/admin/providers/${encodeURIComponent(providerId)}/quarantine`,
  { method: 'POST', body: { reason } },
)
export const releaseProvider = providerId => request(
  `/v1/admin/providers/${encodeURIComponent(providerId)}/release`,
  { method: 'POST' },
)
