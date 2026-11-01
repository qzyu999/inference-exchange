import assert from 'node:assert/strict'
import { attachStreamHls } from './stream-hls.js'

const manifest = 'https://customer-5w3ijts4etcd5hi9.cloudflarestream.com/02af62eaa08146a6efe21b8a4d76a569/manifest/video.m3u8'

function videoMock(native) {
  const listeners = new Map()
  return {
    paused: true,
    readyState: 0,
    ended: false,
    src: '',
    canPlayType: () => native ? 'maybe' : '',
    addEventListener(name, callback) { listeners.set(name, callback) },
    removeEventListener(name) { listeners.delete(name) },
    load() { this.loads = (this.loads || 0) + 1 },
    pause() { this.paused = true },
    play() { this.paused = false; return Promise.resolve() },
    removeAttribute(name) { if (name === 'src') this.src = '' },
  }
}

// React 18 development StrictMode setup -> cleanup -> setup should not
// leave a stale resolved cleanup that removes the second setup's source.
const nativeVideo = videoMock(true)
const first = attachStreamHls(nativeVideo, manifest, () => {})
assert.equal(typeof first, 'function', 'native cleanup MUST be synchronous')
assert.equal(nativeVideo.src, manifest)
first()
const second = attachStreamHls(nativeVideo, manifest, () => {})
await Promise.resolve()
assert.equal(nativeVideo.src, manifest, 'second StrictMode setup must remain attached')
second()
assert.equal(nativeVideo.src, '', 'explicit unmount should detach the video source')

// The async hls.js branch must also not attach after the first effect unmounts.
let attachments = 0
let destroys = 0
class FakeHls {
  static Events = { ERROR: 'error', MANIFEST_PARSED: 'manifestParsed', MEDIA_ATTACHED: 'mediaAttached' }
  static isSupported() { return true }
  on() {}
  attachMedia() { attachments++ }
  destroy() { destroys++ }
}
const fakeLoader = () => Promise.resolve(FakeHls)
globalThis.document = { hidden: false }
const mseVideo = videoMock(false)
const firstLifetime = new AbortController()
const firstAsync = attachStreamHls(mseVideo, manifest, () => {}, firstLifetime.signal, fakeLoader)
assert.equal(typeof firstAsync.then, 'function')
firstLifetime.abort()
const secondLifetime = new AbortController()
const secondAsync = attachStreamHls(mseVideo, manifest, () => {}, secondLifetime.signal, fakeLoader)
const stopStale = await firstAsync
const stopCurrent = await secondAsync
assert.equal(attachments, 1, 'aborted StrictMode setup must not attach HLS')
stopStale()
assert.equal(destroys, 0, 'aborted setup must not tear down active playback')
stopCurrent()
assert.equal(destroys, 1, 'active HLS should clean up on unmount')
// The lazily imported Stream HLS adapter must be pre-optimized with the
// React stack at Vite dev-server startup. Otherwise late discovery can
// invalidate pre-bundled React chunks mid-render (duplicate React/hook crash).
const viteConfig = (await import('node:fs')).readFileSync(
  new URL('../../vite.config.ts', import.meta.url), 'utf8'
)
assert.match(viteConfig, /dedupe:\s*\['react', 'react-dom'\]/)
assert.match(viteConfig, /optimizeDeps:\s*\{[\s\S]*?include:\s*\[[^\]]*'react'[^\]]*'react-router-dom'[^\]]*'hls\.js'/)

// Production rendering must never expose a traditional MP4 request.
const landscape = (await import('node:fs')).readFileSync(
  new URL('../components/LandscapeVideo.tsx', import.meta.url), 'utf8'
)
assert.match(landscape, /VITE_HERO_STREAM_ENABLED/)
assert.match(landscape, /PREVIEW_MODE === 'poster' \? false/)
assert.match(landscape, /import\.meta\.env\.VITE_HERO_STREAM_ENABLED !== 'false'/,
  'PR #207 must stream by default while retaining an explicit poster-only build rollback')
assert.match(landscape, /const showVideo = useStream && ready && playing/,
  'video must not hide the still until the browser is actually playing')
assert.match(landscape, /opacity: showVideo \? 1 : 0/,
  'video remains invisible until playback starts')
assert.match(landscape, /opacity: showVideo \? 0 : 1/,
  'poster remains visible until playback, and returns on stalls')
assert.match(landscape, /onPlaying=\{\(\) => setPlaying\(true\)\}/)
assert.match(landscape, /onPause=\{\(\) => setPlaying\(false\)\}/)
assert.match(landscape, /onWaiting=\{\(\) => setPlaying\(false\)\}/)

// The 2400K-inspired filter is restricted to the landscape component's
// finished video/poster composite, with isolation from overlaid editorial,
// navbar, crystal and final product elements on the landing page.
assert.match(landscape, /const WARM_VIDEO_TINT = !LOCAL_PREVIEW/)
assert.match(landscape, /get\('heroTint'\) !== 'off'/)
assert.match(landscape, /isolation: 'isolate'/)
assert.match(landscape, /data-hero-video-tint="warm"/)
assert.match(landscape, /className="hero-video-bedtime-tint pointer-events-none absolute inset-0"/)
assert.ok(landscape.indexOf('data-hero-video-tint="warm"') >
  landscape.indexOf('onError={() => setPosterFailed(true)}'), 'video tint must cover both video and poster')
const tintCSS = (await import('node:fs')).readFileSync(
  new URL('../index.css', import.meta.url), 'utf8'
)
const videoTintRule = tintCSS.match(/\.hero-video-bedtime-tint \{([^}]+)\}/)?.[1]
const appTintRule = tintCSS.match(/\.ie-app-appearance-scope\[data-appearance="blue-light"\]::after \{([^}]+)\}/)?.[1]
assert.ok(videoTintRule && appTintRule, 'both app and video temperature rules must exist')
for (const cssValue of ['background: #FF995B;', 'opacity: 0.48;', 'mix-blend-mode: multiply;']) {
  assert.ok(videoTintRule.includes(cssValue), 'video lacks shared amber treatment: ' + cssValue)
  assert.ok(appTintRule.includes(cssValue), 'video/app tints have diverged: ' + cssValue)
}


// In the contained ultrawide layout, video touches the navbar and any
// letterboxing/ambient poster blur is relegated to the bottom of the stage.
assert.match(landscape, /requestedAspect === '21x9' && framing\.mode === 'contain'/)
assert.match(landscape, /topAnchorUltrawide \? 'items-start' : 'items-center'/)
assert.match(landscape, /topAnchorUltrawide && edgeDirection === 'to bottom'/)
assert.match(landscape, /linear-gradient\(to bottom, black 0%, black 98\.9%, transparent 100%\)/)
assert.match(landscape, /linear-gradient\(\$\{edgeDirection\}, transparent 0%, black 1\.1%, black 98\.9%, transparent 100%\)/)
assert.match(landscape, /STREAM_ENABLED && !reducedMotion && !saveData && !streamFailed/)
assert.match(landscape, /thumbnails\/thumbnail\.jpg/)
assert.match(landscape, /data-hero-delivery=\{useStream \? 'cloudflare-stream-hls' : 'poster-only'\}/)
assert.match(landscape, /autoPlay=\{useStream\}/)
assert.doesNotMatch(landscape, /\.mp4['"]/)
assert.doesNotMatch(landscape, /VIDEO_BY_ASPECT|selectedCandidate|MEDIA_ORIGIN|cdn\.jsdelivr/)
console.log('#198 production Stream-only policy, native and lazy-MSE StrictMode lifecycle passed')
