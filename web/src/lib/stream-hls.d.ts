/** Development-only Cloudflare Stream HLS player attachment; lazy-loads hls.js. */
export declare function attachStreamHls(
  video: HTMLVideoElement,
  manifestUrl: string,
  onFatal: (reason: Error) => void,
): Promise<() => void>
