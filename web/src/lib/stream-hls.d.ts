/** Production Cloudflare Stream HLS player. Loads lockfile-managed hls.js
 * lazily on browsers without native HLS. Native cleanup remains synchronous
 * for React 18 StrictMode; async MSE attachment respects AbortSignal.
 */
import type Hls from 'hls.js'
export declare function attachStreamHls(
  video: HTMLVideoElement,
  manifestUrl: string,
  onFatal: (reason: Error) => void,
  signal?: AbortSignal,
  loadHls?: () => Promise<typeof Hls>,
): (() => void) | Promise<() => void>
