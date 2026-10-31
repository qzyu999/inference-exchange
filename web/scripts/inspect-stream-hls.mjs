// Inspect manifest variants only; does not download billable video segments.
// Usage: node scripts/inspect-stream-hls.mjs [manifest URL]
// An allowed Origin or Referer is required if you enabled Stream Allowed Origins.
const defaultManifest = 'https://customer-5w3ijts4etcd5hi9.cloudflarestream.com/02af62eaa08146a6efe21b8a4d76a569/manifest/video.m3u8'
const manifestUrl = process.argv[2] || defaultManifest
if (!/^https:\/\/customer-[a-z0-9]+\.cloudflarestream\.com\/[a-f0-9]{32}\/manifest\/video\.m3u8$/.test(manifestUrl)) {
  console.error('Expected Cloudflare Stream HLS manifest URL ending in /manifest/video.m3u8')
  process.exit(2)
}
const base = process.env.STREAM_TEST_ORIGIN || 'http://localhost:5176'
const response = await fetch(manifestUrl, {
  headers: { Origin: base, Referer: base + '/' },
  signal: AbortSignal.timeout(20000),
}).catch(err => {
  console.error('Could not connect to Cloudflare Stream:', err.message)
  process.exit(1)
})
if (!response.ok) {
  console.error(`Stream manifest failed: HTTP ${response.status} ${response.statusText}`)
  console.error('Verify the video is Ready and Allowed Origins includes localhost:5176.')
  process.exit(1)
}
const manifest = await response.text()
if (!manifest.trim().startsWith('#EXTM3U')) {
  console.error('Response was not an HLS manifest:', manifest.slice(0, 160))
  process.exit(1)
}
const rows = manifest.split(/\r?\n/).map(x=>x.trim()).filter(Boolean)
const variants = []
for (let i=0;i<rows.length;i++) {
  if (!rows[i].startsWith('#EXT-X-STREAM-INF:')) continue
  const attrs=rows[i].slice('#EXT-X-STREAM-INF:'.length)
  const find=(name)=> attrs.match(new RegExp(`(?:^|,)${name}=(?:"([^"]+)"|([^,]+))`))?.slice(1).find(Boolean) || ''
  variants.push({resolution:find('RESOLUTION')||'unknown',bandwidth:find('BANDWIDTH')||'?',codecs:find('CODECS')||'?',uri:rows[i+1]||''})
}
console.log('Stream manifest fetched from Cloudflare:',manifestUrl)
console.log('Status:',response.status,'variants:',variants.length)
if(variants.length)console.table(variants)
else console.log('No EXT-X-STREAM-INF in response; this may be a media playlist or not ready.')
console.log('Manifest inspection requests playlist metadata only (no segments).')
