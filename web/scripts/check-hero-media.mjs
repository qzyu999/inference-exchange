// Public, unauthenticated CDN smoke test: all eight required hero files.
// Usage: node scripts/check-hero-media.mjs https://media.inferenceex.com
// Never pass R2 API tokens to this script or publish credentials in Vite env.
import { heroMediaUrl } from '../src/lib/hero-media.js'

const origin = process.argv[2] || process.env.VITE_HERO_MEDIA_ORIGIN
if (!origin) {
  console.error('Usage: node scripts/check-hero-media.mjs https://<public-media-domain>')
  process.exit(2)
}

const assets = [
  'seedance_2_5_mountain_lake_720p.mp4',
  'seedance_2_5_mountain_lake_1080p.mp4',
  'seedance_2_5_mountain_lake_4k.mp4',
  'seedance_2_5_mountain_lake_poster.webp',
  'seedance_2_5_mountain_lake_21x9_720p.mp4',
  'seedance_2_5_mountain_lake_21x9_1080p.mp4',
  'seedance_2_5_mountain_lake_21x9_4k.mp4',
  'seedance_2_5_mountain_lake_21x9_poster.webp',
]

let failures = 0
for (const name of assets) {
  const expected = name.endsWith('.webp') ? 'image/webp' : 'video/mp4'
  let url
  try {
    url = heroMediaUrl('/media/' + name, origin)
    const res = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(20000),
    })
    const mime = res.headers.get('content-type')?.split(';')[0].trim() || '(missing)'
    const length = Number(res.headers.get('content-length'))
    const good = res.ok && mime === expected && length > 0
    if (!good) failures++
    console.log(`${good ? 'PASS' : 'FAIL'} HEAD ${res.status} ${mime}, ${res.headers.get('content-length') || '?'} B, cache=${res.headers.get('cf-cache-status') || '?'}: ${url}`)
  } catch (err) {
    failures++
    console.error(`FAIL HEAD ${url || name}: ${err.message}`)
  }
}

// A browser uses HTTP byte ranges to progressively read/seek in MP4.
// Require an actual partial-content response, not an HTML fallback page.
const videoUrl = heroMediaUrl('/media/seedance_2_5_mountain_lake_21x9_720p.mp4', origin)
try {
  const res = await fetch(videoUrl, {
    headers: { Range: 'bytes=0-1023' },
    signal: AbortSignal.timeout(20000),
  })
  const range = res.headers.get('content-range') || ''
  const good = res.status === 206 && /^bytes 0-1023\/\d+$/.test(range)
  await res.body?.cancel()
  if (!good) failures++
  console.log(`${good ? 'PASS' : 'FAIL'} GET range: HTTP ${res.status}, Content-Range=${range || '(missing)'}`)
} catch (err) {
  failures++
  console.error(`FAIL GET range: ${err.message}`)
}

if (failures) {
  console.error(`CDN hero media verification failed (${failures} checks). Do NOT deploy this version.`)
  process.exit(1)
}
console.log('All eight hero assets and an MP4 byte-range request verified on the public CDN.')
