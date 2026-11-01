// Read-only Cloudflare Stream production-media smoke test (#198).
// Verifies that BOTH HLS manifests and BOTH static poster thumbnails exist.
// No raw MP4 requests; no credentials or Cloudflare API tokens required.
// When Allowed Origins are restricted, set HERO_ALLOWED_ORIGIN=https://inferenceex.com
// to simulate the target browser origin.
const host = 'https://customer-5w3ijts4etcd5hi9.cloudflarestream.com'
const sources = [
  { aspect: '16x9', uid: '6dcc0a01091fa0a720a7482f5c758b79', width: 1280, height: 720 },
  { aspect: '21x9', uid: '02af62eaa08146a6efe21b8a4d76a569', width: 1280, height: 548 },
]
const origin = process.env.HERO_ALLOWED_ORIGIN
if (origin && (!/^https:\/\/[^/]+$/.test(origin))) {
  console.error('HERO_ALLOWED_ORIGIN must be an HTTPS origin without a path')
  process.exit(2)
}
const headers = origin ? { Origin: origin } : {}
let failed = 0
for (const { aspect, uid, width, height } of sources) {
  const manifest = `${host}/${uid}/manifest/video.m3u8`
  const poster = `${host}/${uid}/thumbnails/thumbnail.jpg?time=8s&width=${width}&height=${height}&fit=clip`
  try {
    const response = await fetch(manifest, { headers, signal: AbortSignal.timeout(20000) })
    const text = await response.text()
    const ok = response.ok && text.startsWith('#EXTM3U')
      && text.includes('#EXT-X-STREAM-INF') && text.includes('RESOLUTION=')
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'} ${aspect} HLS manifest HTTP ${response.status}: ${manifest}`)
  } catch (error) {
    failed++
    console.error(`FAIL ${aspect} HLS manifest: ${error.message}`)
  }
  try {
    const response = await fetch(poster, { headers, signal: AbortSignal.timeout(20000) })
    const contentType = response.headers.get('content-type') || ''
    const bytes = await response.arrayBuffer()
    const ok = response.ok && contentType.startsWith('image/jpeg') && bytes.byteLength > 1000
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'} ${aspect} static JPEG HTTP ${response.status}, ${contentType}, ${bytes.byteLength} bytes: ${poster}`)
  } catch (error) {
    failed++
    console.error(`FAIL ${aspect} static JPEG: ${error.message}`)
  }
}
if (failed) {
  console.error(`Stream video/poster verification failed (${failed} checks). Keep VITE_HERO_STREAM_ENABLED=false.`)
  process.exit(1)
}
console.log('Both Cloudflare Stream manifests and both still posters verified.')
