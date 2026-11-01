// Production Cloudflare Stream HLS player adapter (#198).
// Safari/iOS use native HLS. Other browsers import the app-bundled,
// lockfile-pinned hls.js lazily. No CDN script injection or raw MP4 fallback.
// Do not proxy/cache Cloudflare Stream's dynamic manifests.
let libraryPromise

function getHls() {
  if (!libraryPromise) {
    libraryPromise = import('hls.js')
      .then(mod => mod.default || mod.Hls)
      .catch(error => {
        libraryPromise = undefined
        throw error
      })
  }
  return libraryPromise
}

/**
 * Starts attaching an HLS manifest to an existing HTMLVideoElement.
 * @param {HTMLVideoElement} video
 * @param {string} manifestUrl
 * @param {(reason: Error) => void} onFatal
 * @param {AbortSignal} [signal] React effect lifetime; prevents stale async attachments
 * @param {() => Promise<any>} [loadHls] Injected only by lifecycle tests.
 * @returns {(() => void) | Promise<() => void>} Sync teardown for native HLS,
 * or async teardown for hls.js (after an optional library load).
 */
export function attachStreamHls(video, manifestUrl, onFatal, signal, loadHls = getHls) {
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

  // The React 18 StrictMode dev mount -> cleanup -> mount cycle is
  // synchronous. Returning the native teardown synchronously is critical:
  // with an async function the *first* mount's delayed Promise.then(stop)
  // could detach the second mount's source, leaving networkState=0.
  if (signal?.aborted) return () => {}
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
  return loadHls().then(Hls => {
  // hls.js is loaded asynchronously. React may have unmounted the first
  // StrictMode effect before this resolves, so do NOT attach stale media.
  if (signal?.aborted) return () => {}
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
  })
}
