// Development-only Cloudflare Stream HLS proof of concept for #198.
// Uses native HLS in Safari, a pinned hls.js UMD bundle for other browsers.
// The script is loaded only when the explicit localhost Stream flag is active.
// Before public release: install hls.js as a first-party pinned npm dependency.
// Never cache/proxy a Cloudflare Stream manifest (it is a dynamic resource).
const HLS_JS_URL = 'https://cdn.jsdelivr.net/npm/hls.js@1.7.4/dist/hls.min.js'

let scriptPromise

function getHls() {
  if (window.Hls) return Promise.resolve(window.Hls)
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = HLS_JS_URL
      script.async = true
      script.crossOrigin = 'anonymous'
      script.onload = () => {
        if (!window.Hls) reject(new Error('hls.js script loaded but global Hls is missing'))
        else resolve(window.Hls)
      }
      script.onerror = () => reject(new Error('Could not load hls.js for Stream preview'))
      document.head.appendChild(script)
    }).catch(err => {
      scriptPromise = undefined
      throw err
    })
  }
  return scriptPromise
}

/**
 * Starts attaching an HLS manifest to an existing HTMLVideoElement.
 * @param {HTMLVideoElement} video
 * @param {string} manifestUrl
 * @param {(reason: Error) => void} onFatal
 * @returns {Promise<() => void>} teardown; call on React effect cleanup
 */
export async function attachStreamHls(video, manifestUrl, onFatal) {
  if (!manifestUrl.startsWith('https://') || !manifestUrl.endsWith('/manifest/video.m3u8')) {
    throw new Error('Invalid Stream manifest URL')
  }

  // Prefer platform-native HLS where available, notably Safari and iOS.
  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = manifestUrl
    video.load()
    return () => {
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
  }

  const Hls = await getHls()
  if (!Hls.isSupported()) throw new Error('This browser cannot play HLS via MSE')
  const hls = new Hls({
    startLevel: -1, // Automatic bitrate selection; never lock to 4K.
    capLevelToPlayerSize: true,
    maxBufferLength: 8,
    maxMaxBufferLength: 12,
    backBufferLength: 0,
  })
  hls.on(Hls.Events.ERROR, (_event, data) => {
    if (data?.fatal) onFatal(new Error(`Stream HLS failure: ${data.type || 'unknown'} / ${data.details || 'unknown'}`))
  })
  hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(manifestUrl))
  hls.attachMedia(video)
  return () => hls.destroy()
}
