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

  // The source is attached after the React <video> initially renders.
  // Browser autoplay is not guaranteed to retrigger after this async step.
  // Attempt muted playback again once metadata/segments are available.
  const startWhenReady = () => {
    if (document.hidden || video.readyState < 2 || video.ended) return
    void video.play().catch(error => {
      console.warn('[hero-stream] Playback was rejected:', error?.name || error)
    })
  }

  // Prefer platform-native HLS where available, notably Safari and iOS.
  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    console.info('[hero-stream] Native browser HLS selected')
    video.addEventListener('loadeddata', startWhenReady)
    video.addEventListener('canplay', startWhenReady)
    video.src = manifestUrl
    video.load()
    return () => {
      video.removeEventListener('loadeddata', startWhenReady)
      video.removeEventListener('canplay', startWhenReady)
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
  }

  console.info('[hero-stream] Loading hls.js for adaptive playback')
  const Hls = await getHls()
  if (!Hls.isSupported()) throw new Error('This browser cannot play HLS via MSE')
  const hls = new Hls({
    startLevel: -1, // Automatic bitrate selection; never lock to 4K.
    capLevelToPlayerSize: true,
    maxBufferLength: 8,
    maxMaxBufferLength: 12,
    backBufferLength: 0,
  })
  video.addEventListener('canplay', startWhenReady)
  hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
    console.info('[hero-stream] HLS manifest parsed:', {
      variants: data?.levels?.length ?? 0,
      resolutions: (data?.levels ?? []).map(level => `${level.width}x${level.height}`),
    })
    startWhenReady()
  })
  hls.on(Hls.Events.ERROR, (_event, data) => {
    console.warn('[hero-stream] hls.js error:', {
      fatal: data?.fatal,
      type: data?.type,
      details: data?.details,
      status: data?.response?.code ?? data?.response?.status,
    })
    if (data?.fatal) onFatal(new Error(`Stream HLS failure: ${data.type || 'unknown'} / ${data.details || 'unknown'}`))
  })
  hls.on(Hls.Events.MEDIA_ATTACHED, () => {
    console.info('[hero-stream] HLS media attached; requesting manifest')
    hls.loadSource(manifestUrl)
  })
  hls.attachMedia(video)
  return () => {
    video.removeEventListener('canplay', startWhenReady)
    hls.destroy()
  }
}
