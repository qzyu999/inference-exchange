# Cinematic hero media on Cloudflare R2 and CDN

**Status:** documented and wired for review in draft [PR #197](https://github.com/qzyu999/inference-exchange/pull/197), not yet deployed. **No R2 bucket, DNS record, or production asset availability has been verified by this change.** Do not merge or deploy the new landing page until the checklist below passes.

## Update: Cloudflare Stream adaptive streaming evaluation (Oct 31, 2026)

**Do not treat the R2-only approach below as a final product decision.**
An adaptive streaming pilot is tracked in [issue #198](https://github.com/qzyu999/inference-exchange/issues/198).
The current PR #197 is **still draft** and the R2 flow below remains the
non-production baseline/rollback while we test better user experiences.

### What Stream changes

- **R2/CDN + MP4 (current):** Vite chooses 16:9 vs 21:9 and one of the
  already-encoded `720p`, `1080p`, `4k` MP4 files. The browser may fetch
  the file using HTTP range requests, but the chosen quality **does not
  dynamically change** when bandwidth changes. Full 3840×1644/3840×2160
  playback is possible on capable devices.
- **Cloudflare Stream:** upload one original per composition; Cloudflare
  transcodes an adaptive HLS/DASH rendition ladder automatically. A
  compatible HLS/DASH player switches bitrates while watching and fetches
  short media segments rather than selecting a full standalone MP4 once.
  **According to Cloudflare's 2026 documentation the maximum playback is
  1080p (starting at 360p): 4K playback is NOT provided by Stream's
  standard on-demand encoding ladder.** Uploading a 4K Runway master does
  not establish that visitors will see 4K.
- **Hybrid candidate:** Stream for normal bandwidth-adaptive playback
  (particularly mobile), with a direct R2 4K MP4 option/fallback for
  large, high-bandwidth screens where the original 21:9 fidelity is
  worth the bandwidth. This is a proposal, not implemented.
- **Custom HLS on R2:** pre-encode/package our own bitrate ladder
  (potentially including 4K) and publish manifests and segments to R2.
  The browser can adapt with native HLS/HLS.js but we take ownership of
  transcoding, packaging, manifests, caching, player failure handling.
  Evaluate complexity only if Stream's resolution limit is unacceptable.

### Stream price and 30-second looping trade-off

Cloudflare's currently documented pricing:
**$5 per 1,000 stored minutes/month, purchased in prepaid 1,000-minute units**,
plus **$1 per 1,000 minutes delivered**; encoding and bandwidth included.
Both 30-second masters consume about 1 stored minute of allowance total,
but the smallest documented storage-capacity purchase is $5/month.

| Illustrative playback demand | Delivered minutes | Variable delivery cost |
| --- | ---: | ---: |
| 10,000 visitors × 30 seconds | ~5,000 | ~$5 |
| 10,000 visitors × 2 minutes | ~20,000 | ~$20 |
| 100,000 visitors × 30 seconds | ~50,000 | ~$50 |

These are **idealized** viewing-duration estimates; Cloudflare bills
HLS segment requests (4-second rounding for uploaded video), including
prefetching/buffering. Browser-cached repeat loops may not be charged
again, depending on the player's caching behavior. Do not assume every
loop generates a new 30 seconds of billable delivery; measure this in
Stream Analytics with the actual player. Fees and published prices can
change.

### Trial architecture without touching the alpha

```text
Local dev on port 5176 (private preview with explicit experimental flag)
  React LandscapeVideo + poster + Three.js overlay
         |
         +-- Default: existing native MP4 in web/public/media/
         |
         +-- Pilot: HLS Stream manifest per composition
                   (Cloudflare Stream: upload 16:9 + 21:9 originals)
                        -> Browser native HLS (Safari)
                        -> HLS.js loaded on demand (other browsers)
                        -> ABR rendition based on throughput/buffer
         |
         +-- Fallback: existing MP4/R2 path when Stream fails
```

**Do not use a generic iframe as an untested replacement** for the
background `<video>` element. The current pinned scene depends on
controlled CSS object fit, muted autoplay, no controls, looping, video
readiness, paused hidden tabs, reduced-motion/Data Saver, and multiple
WebGL overlays. A native video element driven by native HLS/HLS.js
better matches that interface; verify iOS Safari, Chrome and Firefox.

For the pilot, upload each master through the Stream dashboard (under
200 MB permits simple upload), copy their **real** manifest URLs/UIDs,
and inspect each manifest's output dimensions before any implementation
claims about the ultrawide rendition. Never commit Cloudflare API tokens.
Avoid forcing a `clientBandwidthHint` in normal user playback since
it overrides ABR choices. Keep a static poster visible before decoding.
Do not fetch manifests/segments at all if `prefers-reduced-motion`
or `Save-Data` asks for static mode.

Measure **first playable frame, transferred bytes at 5/15/30 seconds,
quality switches, rebuffering, full-window composition, frame quality,
loop request count, hidden-tab behavior, and mobile data consumption**.
Compare against the exact same viewport/connection using current MP4.
The decision to replace or augment R2 should be made after these tests,
not solely from Stream marketing claims.

Official docs:
- [Cloudflare Stream overview / 360p–1080p](https://developers.cloudflare.com/stream/)
- [Pricing, four-second segments and cached loops](https://developers.cloudflare.com/stream/pricing/)
- [Use your own HLS player](https://developers.cloudflare.com/stream/viewing-videos/using-own-player/)
- [HLS.js example](https://developers.cloudflare.com/stream/examples/hls-js/)
- [Stream player autoplay/loop behavior](https://developers.cloudflare.com/stream/viewing-videos/using-the-stream-player/)
- [Basic dashboard upload](https://developers.cloudflare.com/stream/uploading-videos/upload-video-file/)

## Real Cloudflare Stream 21:9 pilot — uploaded October 31, 2026

The user uploaded the original 3840×1644, 30s ultrawide Runway master
to Cloudflare Stream and provided its actual HLS playback URL:

```text
https://customer-5w3ijts4etcd5hi9.cloudflarestream.com/02af62eaa08146a6efe21b8a4d76a569/manifest/video.m3u8
```

**Security:** This is a public *playback* URL, not an API key. Cloudflare
Stream **Allowed Origins** have been requested for `inferenceex.com`
and `localhost:5176`; verify these are saved in dashboard before
testing. By itself, a public video UID is not access control, billing cap,
or protection against all scripted playback abuse. Do not commit
Cloudflare API credentials.

**Status:** The manifest URL matches Cloudflare's documented format.
Live variant resolutions and authenticated/allowed-origin playback
were **not** accessible to the build agent, so do not claim real
360/480/720/1080 variants are verified until local inspection succeeds.

### 1. Inspect the *actual* adaptive bitrate manifest

Open a terminal on the Mac mini:

```bash
cd ~/projects/inference-exchange-mandala-review
git pull --ff-only
cd web
npm run inspect:stream-hls
```

The command sends a **single HLS manifest request** with localhost
Origin/Referer headers; it deliberately does **not** request media segments
or autoplay the video. It prints Cloudflare's actual `RESOLUTION`,
`BANDWIDTH`, `CODECS`, and rendition URI entries. If it reports 403,
verify the video is `Ready` and the Allowed Origins list includes
`localhost:5176`. If it reports DNS/network failure, inspect from
the Mac mini's unrestricted network.

Inspect the output: the ladder may cap at 1080p and may preserve or
normalize the original 21:9 display ratio. **Do not guess** before
seeing the playlist. Cloudflare documentation says Stream does not
offer native 4K playback.

### Troubleshooting: Stream selected but no decoded frame

If the browser console returns
`{ delivery: 'cloudflare-stream-hls', resolution: '0x0', playing: false, error: null }`,
this means the experimental Stream path was selected but **no video
metadata/frame has loaded yet**. That alone does not establish a
Cloudflare outage. Refresh after pulling the latest PR branch; the
pilot now logs `[hero-stream]` messages when hls.js attaches, parses
the manifest, encounters network errors or sees autoplay rejection.
Observe these in Chrome Console; the player attempts muted playback
explicitly as soon as HLS segments can be decoded.

Open DevTools → Network and filter `cloudflarestream` or `m3u8`.
Check first whether `hls.min.js` from pinned jsDelivr loads;
then the master `video.m3u8`, rendition `.m3u8`, and actual
segments. A **403** from Cloudflare can indicate a mismatch in
the Stream *Allowed Origins* list (`localhost:5176`); a blocked
third-party HLS.js script can indicate network/CSP/extensions; a
successful manifest followed by failing segments usually indicates a
segment fetch or media decode problem. Inspect the *specific failing
request*, its HTTP status and browser console detail, rather than
guessing.

In the same local dev session, Vite's normal proxy targets
`http://localhost:8000` for `/health` and `/v1`, and
`ws://localhost:8000` for `/ws`. If that backend isn't running,
repeated HTTP 500 / WebSocket handshake failures appear in DevTools.
These are **independent of the Cloudflare HLS video** and do not by
themselves imply a Stream failure. Start a safe local coordinator
only if full application API functionality is necessary for that test.
Do not route the staging or production backend to an arbitrary dev
proxy to silence the errors.

### 2. Compare MP4 and HLS in the *existing* real landing page

The PR includes a **localhost-only** opt-in HLS pilot. It does not
affect the public site or the default local review. The HLS test uses
the existing full-screen `LandscapeVideo` element with the same
posters, crystals, and scroll transition, not a standalone iframe.

```bash
cd ~/projects/inference-exchange-mandala-review/web
npm run dev -- --port 5176 --strictPort
```

Open these separately (on the same viewport/window and network):

- **MP4 baseline**:
  `http://localhost:5176/?heroAspect=21x9&heroFit=contain`
- **HLS pilot**:
  `http://localhost:5176/?heroAspect=21x9&heroFit=contain&heroDelivery=stream`

The `heroAspect=21x9` override is only available on localhost so
ordinary 16:9 monitors can test the 21:9 source without accidental
cropping. For a real wide desktop, omit `heroAspect` and test the default
2.05:1 threshold and `heroFit=center`.

The HLS mode uses **native HLS where the browser supports it (Safari)**
and lazily loads a pinned **hls.js 1.7.4 UMD bundle** from jsDelivr for
Chrome/Firefox/Edge. This third-party script is used only in the
explicit localhost pilot: before production, replace with a lockfile-
pinned npm `hls.js` dependency and audit CSP/supply-chain policy.

The demo never attempts Stream delivery when reduced-motion or
Save-Data is active. On a fatal HLS load/player error, it falls back to
the same 21:9 MP4 as the normal page. Since we have uploaded only
**21:9** to Stream, ordinary **16:9** still uses native MP4 until
the second source has been uploaded and validated.

In Chrome/Safari DevTools **Network**, disable cache for first-visit
measurement; use the same network throttling profile for both modes.
For HLS, expect `video.m3u8`, rendition playlists and segment requests
(not the standalone 4K MP4). For MP4 expect `...21x9_*.mp4` requests.
HLS may start in lower quality and increase over a few seconds.

Check which mode actually ran:

```js
const video = document.querySelector('video[data-hero-delivery]')
console.log({
  delivery: video?.dataset.heroDelivery,
  aspect: video?.dataset.heroAspect,
  quality: video?.dataset.heroQuality,
  currentSrc: video?.currentSrc,
  dimensions: [video?.videoWidth, video?.videoHeight],
})
```

The values in HLS mode are **decoded playback dimensions**, not
necessarily the complete ABR ladder. Use the manifest inspector for
the ladder and Network waterfall for actual segment/rendition choice.

Test Chrome and Safari, page hidden/visible, backward/forward scroll,
30s loop, reduced-motion / Save-Data, and throttled 3G/4G. Record
transferred **bytes** and first-frame time for the Stream and MP4
alternatives. Avoid looping unnecessarily while benchmarking, since
Stream delivery minutes can be billable. If hls.js CDN is blocked,
expect a console warning and MP4 fallback.

The experiment **does not change default production playback** and
does not constitute permission to merge PR #197. Keep the CDN/R2 and
cost/abuse protections in issue [#198](https://github.com/qzyu999/inference-exchange/issues/198).

## What serves what?

```text
Developer laptop
  GitHub source (JS/TS/CSS, README, manifests; NOT the large MP4/WebP files)
       |
       +--> npm run dev (Vite): http://localhost:5176/
       |        `/media/file.mp4` -> web/public/media/file.mp4 on that laptop
       |
       +--> npm run build (Vite): static HTML/JS/CSS bundle
                     |
Public user --> inferenceex.com --> existing Caddy/web frontend origin
                         |
                         +--> HTML/JS chooses video based on viewport + network
                                   |
                     media.inferenceex.com (proposed)
                         Cloudflare CDN edge cache
                                   |
                         Cloudflare R2 Standard storage
                         bucket `ie-public-media` (proposed)
                         keys: `seedance_2_5_mountain_lake_*.mp4/.webp`
```

Cloudflare R2 **stores** objects. A **custom domain** enables Cloudflare's public edge-cache delivery of those objects. The browser requests the selected media URL directly and can use `Range` requests to buffer only needed portions. The media does not flow through the coordinator or the Mac mini when the CDN origin is configured. Cloudflare's existing DNS/Tunnel/Access setup for the website and API is separate; do not change those existing hostnames.

GitHub holds small text manifests and build configuration, not large user-generated binary media. The eight optimized files total substantially less than R2's Standard free-storage allowance at the time of this writing, but storage/operation usage and future traffic are billable according to Cloudflare's live pricing. R2 has no egress-bandwidth fee; *not* a promise of an entirely free website.

Official references:
- [R2: get started](https://developers.cloudflare.com/r2/get-started/)
- [R2: public buckets and custom domains](https://developers.cloudflare.com/r2/buckets/public-buckets/)
- [Cloudflare cache with R2](https://developers.cloudflare.com/cache/interaction-cloudflare-products/r2/)
- [R2 uploads](https://developers.cloudflare.com/r2/objects/upload-objects/)
- [Cache default types and TTL](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/)
- [CDN range requests](https://developers.cloudflare.com/cache/reference/range-requests/)
- [Vite environment variables](https://vite.dev/guide/env-and-mode)
- [R2 pricing](https://developers.cloudflare.com/r2/pricing/)

## 1. Asset inventory — upload exactly these eight files

Choose the **optimized WEB** files only, never the 90 MB Runway master. The original 16:9 and new 21:9 downloads are provided separately in the project conversation; on the Mac review worktree they should both be extracted into `web/public/media/`.

| Object key at **R2 bucket root** | Local file | Content-Type |
| --- | --- | --- |
| `seedance_2_5_mountain_lake_720p.mp4` | `web/public/media/seedance_2_5_mountain_lake_720p.mp4` | `video/mp4` |
| `seedance_2_5_mountain_lake_1080p.mp4` | `web/public/media/seedance_2_5_mountain_lake_1080p.mp4` | `video/mp4` |
| `seedance_2_5_mountain_lake_4k.mp4` | `web/public/media/seedance_2_5_mountain_lake_4k.mp4` | `video/mp4` |
| `seedance_2_5_mountain_lake_poster.webp` | `web/public/media/seedance_2_5_mountain_lake_poster.webp` | `image/webp` |
| `seedance_2_5_mountain_lake_21x9_720p.mp4` | `web/public/media/seedance_2_5_mountain_lake_21x9_720p.mp4` | `video/mp4` |
| `seedance_2_5_mountain_lake_21x9_1080p.mp4` | `web/public/media/seedance_2_5_mountain_lake_21x9_1080p.mp4` | `video/mp4` |
| `seedance_2_5_mountain_lake_21x9_4k.mp4` | `web/public/media/seedance_2_5_mountain_lake_21x9_4k.mp4` | `video/mp4` |
| `seedance_2_5_mountain_lake_21x9_poster.webp` | `web/public/media/seedance_2_5_mountain_lake_21x9_poster.webp` | `image/webp` |

**Important:** Upload at the bucket **root**, not a nested `media/` folder. If Cloudflare's object browser shows the filename under a `media` folder, move or re-upload it at root. R2 keys map to `https://media.inferenceex.com/<object-key>`.

## 2. Cloudflare dashboard: create a dedicated public-media bucket

1. Sign in to [dash.cloudflare.com](https://dash.cloudflare.com/) with the account managing `inferenceex.com`.
2. Open **Storage & databases → R2 → Overview**. Activate R2 billing/subscription if prompted (check the current pricing/free allowance before accepting).
3. Choose **Create bucket**. Suggested name: `ie-public-media`; storage class: **Standard**, not Infrequent Access. This is a proposed name—check if it is available first.
4. Open the bucket's **Objects** area and choose **Upload**. Start by uploading **one poster** (`seedance_2_5_mountain_lake_21x9_poster.webp`) directly to bucket root. Confirm the object key matches the table.
5. Open **Settings → Public access → Custom Domains → Connect Domain**. Enter the proposed `media.inferenceex.com`. Cloudflare should propose the DNS record; carefully confirm it does not collide with an existing DNS record. Connect only this new subdomain, not `inferenceex.com` or `api-dev.inferenceex.com`.
6. Wait for Cloudflare to show an **active** custom domain. Visit `https://media.inferenceex.com/seedance_2_5_mountain_lake_21x9_poster.webp`. It should return an image, not a Cloudflare Access sign-in page, 404, or website HTML.
7. Upload the remaining **seven** objects to the same bucket root. You can select multiple files in the dashboard; ensure the browser uploads finish successfully. MP4 and WebP MIME types must match the table.
8. Do **not** enable the `r2.dev` development URL for production. Public R2 objects are intentionally public: do **not** upload tokens, private user prompts, or account records. No secret or credential belongs in `VITE_*` variables.

Cloudflare caches MP4 and WebP extensions by default on proxied custom domains, so an initial Cache Everything rule is **not necessary**. For this first release, avoid aggressively long cache lifetimes while you may replace video files. Later, prefer versioned names and long immutable caching rather than overwriting filenames.

## 3. Test public object access **before** changing website configuration

From any shell with Node 22+ and a checkout of this branch:

```bash
cd ~/projects/inference-exchange-mandala-review
git pull --ff-only
cd web
npm run check:hero-media -- https://media.inferenceex.com
```

The verifier checks all **eight** expected URLs for HTTP 2xx, nonempty content, expected `video/mp4`/`image/webp` MIME types and the first 1024 bytes of a 21:9 video using an HTTP `Range` request (`206 Partial Content` and `Content-Range`). **Do not merge if this command fails.**

Manual request checks (for diagnosis):

```bash
curl -I https://media.inferenceex.com/seedance_2_5_mountain_lake_21x9_poster.webp

curl -sS -o /dev/null -D - \
  -H 'Range: bytes=0-1023' \
  https://media.inferenceex.com/seedance_2_5_mountain_lake_21x9_720p.mp4
```

Look for `200` and `image/webp` for the poster; `206`, `video/mp4`, and `Content-Range: bytes 0-1023/...` for the video. A `CF-Cache-Status: MISS` is normal for a first request; later requests **may** be `HIT` (depends on location and cache policy). Cloudflare's Range behavior is not a guarantee that the entire video is cached in every edge location.

## 4. Local Vite tests — two independent modes

**Mode A: local files, no Cloudflare dependency (default).** Keep the media files installed in `web/public/media`; do not set `VITE_HERO_MEDIA_ORIGIN`:

```bash
cd ~/projects/inference-exchange-mandala-review/web
env -u VITE_HERO_MEDIA_ORIGIN npm run dev -- --port 5176 --strictPort
```

The page at `http://localhost:5176` requests `http://localhost:5176/media/seedance_...` from **Vite**, not Cloudflare. This works without internet access to R2 and allows isolated A/B visual reviews.

**Mode B: real Cloudflare media, but local application code.** Start Vite with an explicit media origin:

```bash
cd ~/projects/inference-exchange-mandala-review/web
VITE_HERO_MEDIA_ORIGIN=https://media.inferenceex.com \
  npm run dev -- --port 5176 --strictPort
```

The page is **still on localhost:5176**; only media URLs go to the Cloudflare custom domain. Use Chrome/Firefox/Safari Network tab filtered by `mp4` or `webp` to confirm the **Request URL** hostname. Restart Vite whenever you change the environment variable. Query override `?heroQuality=4k` still forces the high-res source (use only for review).

In DevTools, run:

```js
const video = document.querySelector('video[data-hero-aspect]')
console.log(video?.dataset.heroAspect, video?.currentSrc, video?.videoWidth, video?.videoHeight)
```

Expected aspect: `21x9` for a hero stage at least 2.05:1, otherwise `16x9`. Ensure the poster is visible before the video is ready; check autoplay, loop, scroll, reduced-motion, and browser console. Do not rely only on the source's URL without checking the video plays successfully.

## 5. Production: configure the **build**, not the running API

The frontend code reads `import.meta.env.VITE_HERO_MEDIA_ORIGIN`. Vite substitutes this **at build time**; it is not loaded from the coordinator's running environment. It is a public HTTPS origin, **not an R2 API token**.

Local production-style build (inside `web/`):

```bash
VITE_HERO_MEDIA_ORIGIN=https://media.inferenceex.com npm run build
```

Docker web image build (repo root):

```bash
docker build -f deploy/Dockerfile.web \
  --build-arg VITE_HERO_MEDIA_ORIGIN=https://media.inferenceex.com \
  -t ie-web-cdn-test .
```

The image build now supports this build argument. Your actual Mac-mini production frontend has its own deployment/launch process: **do not bypass the existing review, backups, deployment verification, or rollback procedures**. Ensure the same `VITE_HERO_MEDIA_ORIGIN` is applied to whichever Vite build is ultimately copied into the production served directory.

If you build locally with `web/public/media` still present, Vite will also copy local assets to `dist/media/`. The clean GitHub checkout used for deployment excludes those ignored files, which is the desired separation. Never accidentally stage the large binary files in Git.

**Release order**:
1. Confirm all eight files are public on R2 custom domain and verifier is green.
2. Review PR #197's successful CI and code, synchronize with the latest main if needed.
3. Test actual localhost **CDN mode** on desktop and mobile.
4. Produce a production **candidate** build with CDN origin and test its network requests before switching live traffic.
5. Merge PR after final review, deploy the built frontend through the existing production procedure, verify public website media loads, and monitor errors.
6. If anything is wrong, restore the previous known-good web build; leave the R2 bucket intact. A frontend rollback does **not** require deletion of the videos.

Avoid mixing Cloudflare Access rules on the public-media subdomain with the separately protected private-alpha app/API endpoints. Media is public by design; the alpha product can retain its own authentication and authorization.

## 6. Troubleshooting

| Symptom | Likely cause / check |
| --- | --- |
| Browser loads `/media/file.mp4` from localhost | Local mode is active; set `VITE_HERO_MEDIA_ORIGIN` before restarting Vite |
| Public build still loads `/media/file.mp4` from website | Vite production build omitted the build-time variable; rebuild and re-deploy |
| Cloudflare video URL returns 404 | Wrong object key, wrong bucket, or a missing upload; use root-level keys from table |
| URL redirects to Access login | Public-media domain was protected by an Access policy; separate it from the alpha/API Access policies |
| `HEAD` returns `text/html` | Request reached SPA fallback, not R2 object |
| `Range` GET is 200 or range missing | Check custom domain/R2 response headers, Cache Rules and whether object is genuine MP4 |
| Video plays locally but not production | Wrong MIME, 404, mixed content, autoplay restriction, browser codec, or missing build-time variable |
| Change to a file does not show immediately | CDN/browser cache; use a versioned object name or deliberate cache purge |
| Loading a 4K video uses too much data | Default public quality selection should prefer 1080p or 720p; remove `?heroQuality=4k` |

## 7. Merge gate / ownership

- [ ] R2 Standard bucket has been created (bucket name recorded).
- [ ] The public custom domain has become active and does not conflict with existing inferenceex.com routing.
- [ ] All eight **web** objects uploaded (no master footage or secrets).
- [ ] All media URLs pass `npm run check:hero-media -- https://media.inferenceex.com`.
- [ ] Local Vite test passes in **both modes**.
- [ ] Desktop/mobile Safari/Chrome video, scroll transition, and accessibility smoke checks pass.
- [ ] The production build has `VITE_HERO_MEDIA_ORIGIN` set and contains the correct URLs.
- [ ] The draft PR's CI remains green after synchronization with the latest main.
- [ ] A backup and rollback plan is ready; user explicitly approves the release.

**Until every item above is checked, keep PR #197 as draft and do not switch live production.**
