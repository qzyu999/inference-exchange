// PROV-018 / PRIV-009. Owner requests use only the current IE browser session.
// Never store a returned secret in a module, SWR cache, browser storage or URL.
import { describeHttpFailure } from './http-error.js'

const BASE = import.meta.env?.VITE_API_BASE || ''
export const SELF_SERVICE_PROFILE = 'apple-silicon-macos-gguf-metal-l0'

async function request(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    cache: 'no-store',
    ...options,
  })
  if (!response.ok) {
    const message = await describeHttpFailure(response)
    const error = new Error(message)
    error.status = response.status
    throw error
  }
  return response.json()
}

export function listSelfServiceCredentials() {
  return request('/v1/provider/credentials')
}

export function enrollSelfServiceProvider(name) {
  return request('/v1/provider/nodes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, profile: SELF_SERVICE_PROFILE }),
  })
}

export function revokeSelfServiceCredential(tokenId) {
  // tokenId is public metadata, not a raw provider credential.
  return request('/v1/provider/credentials/' + encodeURIComponent(tokenId), {
    method: 'DELETE',
  })
}
