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
globalThis.window = { Hls: FakeHls }
globalThis.document = { hidden: false }
const mseVideo = videoMock(false)
const firstLifetime = new AbortController()
const firstAsync = attachStreamHls(mseVideo, manifest, () => {}, firstLifetime.signal)
assert.equal(typeof firstAsync.then, 'function')
firstLifetime.abort()
const secondLifetime = new AbortController()
const secondAsync = attachStreamHls(mseVideo, manifest, () => {}, secondLifetime.signal)
const stopStale = await firstAsync
const stopCurrent = await secondAsync
assert.equal(attachments, 1, 'aborted StrictMode setup must not attach HLS')
stopStale()
assert.equal(destroys, 0, 'aborted setup must not tear down active playback')
stopCurrent()
assert.equal(destroys, 1, 'active HLS should clean up on unmount')
// The experimental Stream route must never silently request a large MP4
// if Stream fails or the viewer prefers a static poster.
const landscape = (await import('node:fs')).readFileSync(
  new URL('../components/LandscapeVideo.tsx', import.meta.url), 'utf8'
)
assert.match(landscape, /src=\{STREAM_PREVIEW \? undefined : selectedCandidate\.path\}/)
assert.match(landscape, /STREAM_PREVIEW && !useStream/)
assert.match(landscape, /posterOnly \? 'poster-only' : 'mp4'/)
assert.doesNotMatch(landscape, /falling back to MP4/)

console.log('#198 native and hls.js StrictMode playback lifecycle tests passed')
