/**
 * Convert an API failure to a short, user-safe diagnostic.
 * Never render upstream HTML, proxy pages, arbitrary text bodies or secrets.
 */
export async function describeHttpFailure(response) {
  const status = response.status
  const fallback = [502, 503, 504].includes(status)
    ? `HTTP ${status}: Service temporarily unavailable. Check the coordinator, Caddy and tunnel; retry when the origin recovers.`
    : `HTTP ${status}: Request failed.`

  const contentType = response.headers?.get?.('content-type')?.toLowerCase() || ''
  if (!contentType.includes('json')) return fallback

  try {
    const body = await response.json()
    const error = body?.error
    const message = typeof error === 'string' ? error
      : typeof error?.message === 'string' ? error.message
        : typeof body?.detail === 'string' ? body.detail : null
    // Messages must be short, single-line, plain text. Avoid exposing secrets,
    // stack traces, echoed prompt content or Cloudflare HTML from a bad gateway.
    if (message && message.length <= 240
        && !/[<>\r\n]/.test(message)
        && !/(?:sk-ie|pt-ie)-|bearer\s+|cookie\s*[:=]/i.test(message)) {
      return `HTTP ${status}: ${message}`
    }
    // A short machine error code helps developers without echoing arbitrary text.
    const code = typeof error?.code === 'string' ? error.code : null
    if (code && /^[a-z][a-z0-9_]{1,63}$/i.test(code)) {
      return `HTTP ${status}: ${code}`
    }
  } catch {
    // Broken/mislabelled JSON is treated as an opaque upstream failure.
  }
  return fallback
}
