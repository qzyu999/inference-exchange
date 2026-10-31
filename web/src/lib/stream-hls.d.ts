/** Development-only Cloudflare Stream HLS player attachment; lazy-loads hls.js.
 * Native HLS returns a synchronous cleanup to survive React 18 StrictMode replay.
 * The asynchronous hls.js branch receives a signal to prevent stale attachment.
 */
export declare function attachStreamHls(
  video: HTMLVideoElement,
  manifestUrl: string,
  onFatal: (reason: Error) => void,
  signal?: AbortSignal,
): (() => void) | Promise<() => void>
