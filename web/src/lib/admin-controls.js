import { describeHttpFailure } from './http-error.js'
// Browser-only operator API. Keep credentials in the HttpOnly IE session cookie.
const BASE = import.meta.env?.VITE_API_BASE || ''
// Cloudflare Access must independently protect admin paths on the deployed hostname.
async function request(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    ...(body === undefined ? {} : {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  })
  if (!response.ok) throw new Error(await describeHttpFailure(response))
  const type = response.headers?.get?.('content-type')?.toLowerCase() || ''
  if (type && !type.includes('json')) throw new Error('Unexpected response from the coordinator. Retry when the origin recovers.')
  try {
    return await response.json()
  } catch {
    throw new Error('Invalid response from the coordinator. Retry when the origin recovers.')
  }
}

export const loadAdminState = () => request('/v1/admin/state')
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
