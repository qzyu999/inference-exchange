# Local cinematic landing page media (#107, #185)

## No-vignette, native-framing video QA (October 30)

**Why the ordinary landing page looked softer than the preferred raw 4K
preview:** these views previously combined three independent differences:

1. A broad editorial overlay (`rgba(6,14,26,0.82)` at the left edge,
   covering up to 58% of desktop scene width). This was **not a CSS blur
   filter**, but it heavily flattened the sky, grass, and lake colors.
2. Normal `/` often chose **1080p**, while the raw comparison explicitly
   forced `heroQuality=4k`. The automatic chooser's old bandwidth
   threshold also made 4K improbable on browsers without connection hints.
3. The default `wide` framing cropped the 16:9 master, while the preferred
   `contain` mode preserved the whole composition at a smaller scale.

**New review defaults:** The full-screen editorial vignette is **absent**.
Text contrast comes from tightly scoped, layered dark `text-shadow`
and a fractional-width headline outline, not from a screen-wide dark
tint, backdrop blur, filter, or saturation adjustment. The default video
framing is `object-fit: contain`, which preserves sun, moon, mountain
and reflection. The previous full-width `wide` crop is still available
by URL. For local high-DPI desktop previews on `localhost` or
`127.0.0.1`, auto-selection favors the real 4K source; **public**
quality selection remains conservative (usually 1080p) to avoid
unnecessary ~39 MB downloads.

For an apples-to-apples comparison on port 5176, keep the same quality
and crop and vary only the tint:

- `/?heroQuality=4k&heroFit=contain` — **new default treatment**, clear
  scene with localized text contrast
- `/?heroQuality=4k&heroFit=contain&heroShade=legacy` — previous large
  black wash for A/B comparison
- `/?heroRaw=1&heroQuality=4k&heroFit=contain` — underlying original
  footage, no editorial copy, no crystals
- `/?heroQuality=1080p&heroFit=contain` — compare source sharpness,
  leaving crop and text treatment identical
- `/?heroQuality=4k&heroFit=wide` — compare the full-width crop to
  `contain` without changing brightness or source quality

**QA:** check full-screen browser playback on Retina and non-Retina
desktops, especially whether copy remains readable over the bright
water/sky. Confirm no unexpected fullscreen filter or CSS overlay
appears before the mineral dissolve. Inspect
`<video data-hero-source="...">` in DevTools to ensure the selected
source really is 4K when requested. Side margins are an intentional
consequence of maintaining the full 16:9 plate on a wider viewport.
No binary assets have changed. Review in the isolated mandala worktree;
do not change `main` until accepted.

## New full-width sun/moon-safe crop (October 30 review)

The new Seedance footage is 16:9. When a browser viewport is wider than
16:9, `object-fit: contain` displays the full video but leaves side margins;
the old `object-fit: cover; object-position: center` fills the width but
cropped equal amounts from the sky and foreground, risking clipping the
sun/moon. **Default framing is now `wide`**: cover the viewport without any
nonuniform stretch, with `object-position: 50% 12%`, which keeps almost all
the sky and preferentially crops the lower foreground.

For example, in a 1920×900 story viewport (~2.13:1), the displayed frame is
equivalent to a 3840×1800 crop of the 3840×2160 original. With the new 12%
vertical bias, ~43 original pixels are cropped from the top and ~317 from
the bottom. The sun, moon, central summit, and reflection all remain visible
in the sampled frame. On an actual 16:9 viewport, no crop is needed.
This is **CSS-only framing**; no new video downloads/encodes or changes to the
crystal/shader timeline are required.

Preview the exact same 4K source side by side:

- `http://localhost:5176/?heroRaw=1&heroQuality=4k&heroFit=wide` — new default, full width, sky preserved
- `http://localhost:5176/?heroRaw=1&heroQuality=4k&heroFit=cover` — previous centered crop
- `http://localhost:5176/?heroRaw=1&heroQuality=4k&heroFit=contain` — uncropped, side margins on a wide viewport

The poster image and actual video use the exact same crop parameters so
there is no framing jump as the first frame loads. The selected mode is
visible on the `<video data-hero-framing="...">` attribute. For a full UI
comparison, omit `heroRaw=1`. **Mobile remains a special case**: no 16:9
horizontal video can show both far-apart sky objects on a tall portrait
screen while filling the viewport; a separate mobile composition would be
needed for that.

## Current Seedance 2.5 media — adaptive-quality preview

Two new 30-second locked-camera source clips were provided on October 30:

| Source | Original codec | Source size | Resolution |
| --- | --- | ---: | --- |
| 4K MP4 | H.264, with audio | 111.4 MB | 3840×2160 |
| 1080p MOV | 10-bit HEVC 4:4:4, PCM audio | 62.4 MB | 1920×1080 |

They are **not shipped to browsers in their original form**. The locally
provided `seedance_2_5_mountain_lake_web_assets.zip` contains four optimized
assets for `web/public/media/`:

| Asset | Resolution | Approx bytes | Purpose |
| --- | --- | ---: | --- |
| `seedance_2_5_mountain_lake_720p.mp4` | 1280×720 | 4.6 MB | mobile / slow / metered |
| `seedance_2_5_mountain_lake_1080p.mp4` | 1920×1080 | 11.2 MB | safe desktop default |
| `seedance_2_5_mountain_lake_4k.mp4` | 3840×2160 | 38.7 MB | high-resolution, fast desktop |
| `seedance_2_5_mountain_lake_poster.webp` | 1920×1080 | ~0.34 MB | fast first paint and reduced-motion |

All video derivatives: **H.264 High, 24 fps, yuv420p, silent, 30 seconds,
MP4 +faststart**, broadly compatible with Chrome and Safari. The original
sources remain unchanged.

### Install the local media bundle

```sh
cd ~/projects/inference-exchange-mandala-review
git pull --ff-only
unzip -o ~/Downloads/seedance_2_5_mountain_lake_web_assets.zip -d web/public/media
cd web
npm run build
npm run dev -- --port 5176 --strictPort
```

Test `http://localhost:5176/`; view the actual chosen file in DevTools
Network or inspect the video's `data-hero-source` DOM attribute.

**One source per page view**, selected when React mounts:

- Mobile (<768px CSS width), Data Saver, or 2G/3G-like connections: 720p
- Normal desktop and browsers lacking connection-speed data (Safari): 1080p
- Large 4K-class display **and** explicit network hints of a fast connection
  **and** sufficient memory/CPU: 4K

Debug / override the automatic choice with `?heroQuality=720p`,
`?heroQuality=1080p`, or `?heroQuality=4k`. The default framing is now
`heroFit=wide`; `heroFit=cover` is the former centered crop and
`heroFit=contain` preserves the full source image. Missing variants fall back to 1080p or the
legacy `alpine-lake-hero.mp4` if present. There is **no runtime quality
switch while playing**: each `<video>` fetches only the selected asset.

`preload="metadata"` is only a network hint. Muted autoplay will normally
download/buffer the selected clip as it plays; subsequent visits may reuse
HTTP-cached bytes depending on `Cache-Control`, the CDN and browser eviction.
The browser does **not** automatically download all three clips. Full adaptive
bitrate streaming requires HLS/DASH segmented media, not multiple MP4s alone.
For production, serve versioned objects via Cloudflare R2/CDN with byte-range
requests, correct `video/mp4` MIME type and explicit cache headers; avoid
committing large binaries into the Git repo.

**QA before deployment:** check Safari/Chrome first paint, source selection,
loop seam, mobile battery, data usage, GPU animations and source licensing.
Do not assume the uploaded clip is visually seamless without checking.

## Canonical landing-page review branch (October 30, 2026)

**Continue all cinematic landing-page work on**
`feat/185-mineral-mandala-dissolve`. GitHub comparison verified this branch
contains **all commits** from both previous prototype branches:

- `feat/107-cinematic-lake-video-scroll` — ancestor, 0 commits missing
- `feat/185-landing-editorial-snap-chapters` — ancestor, 0 commits missing

No merge or cherry-pick is needed. Treat the prior branches as rollback
checkpoints, not active development branches; the current review worktree
is `~/projects/inference-exchange-mandala-review` (port 5176). Keep the
separate worktrees intact while evaluating the experience. Do **not**
merge to `main` until the visual review and alpha regressions pass.

### High-resolution plate and product framing

The canonical experiment now uses native 3840×2160 and 1920×1080 Seedance
footage instead of the old 1650×720 ultrawide plate. Preserve the centered
mountain/reflection, left-side editorial typography and sun/moon composition.
The legacy `alpine-lake-hero.mp4` remains only a local-media fallback.
Inspect `heroFit=wide`, `heroFit=cover` and `heroFit=contain` plus the loop seam on multiple
desktop aspect ratios; avoid over-optimizing away detail in the snow or water.


The photo/video files are intentionally not committed to GitHub on this
experimental branch. Use the locally provided media bundle to test the scene.

## Updated 30-second mountain-reflection video

A new still-camera landscape video was supplied for local review:

- Source: `mountain_reflection.mp4`
- Duration: **30.09 seconds**
- Dimensions: **1650 × 720** (approximately 2.29:1, not 1080p)
- Video: H.264, approximately 1.38 Mb/s, 30 fps
- Audio: removed for the web preview
- The video stream is **copied without re-encoding**; a 1650 × 720 WebP
  poster is extracted from the source
- The video is played in a loop because it is at least 20 seconds long.
  The exact loop seam has not yet been professionally retouched.

## Install in the separate review worktree

Download `ie_mountain_reflection_30s_preview.zip` from the ChatGPT
conversation into your Downloads folder.

```sh
cd ~/projects/inference-exchange-landing-review
git pull --ff-only
unzip -o ~/Downloads/ie_mountain_reflection_30s_preview.zip -d .
cd web
npm run build
npm run dev -- --port 5174 --strictPort
```

Expected files:
- `web/public/media/alpine-lake-hero.mp4`
- `web/public/media/alpine-lake-poster.webp`

The change overwrites **only your local review-worktree media files**.
Nothing changes in the separate production/provider directory.

Review modes:
- `http://localhost:5174/` — complete intro, crystals and landscape
- `http://localhost:5174/?heroRaw=1` — video alone below the navbar
- `http://localhost:5174/?heroFit=contain` — preserve full source without cropping (shows letterbox bands)
- `http://localhost:5174/?heroRaw=1&heroFit=contain` — uncropped video without overlays

`object-fit: cover` is now the default so the landscape touches the navbar
and the bottom edge of the scene without dark horizontal gaps. At a
1920 × 962 viewport with a 56px navbar, the 1650 × 720 source loses
approximately 3.8% of its width on each side; it is never stretched.
The `contain` override remains for side-by-side crop comparisons.
Longer term, use a genuinely 16:9 or responsive source master to avoid
this compromise across different screens.

## Remaining production work

This is a visual test asset, not yet a release/master: true 1080p-or-better
source detail, a precisely matched seamless loop, audio-free media delivery
rights, responsive framing, grain/codec quality assessment and other
cinematic refinements remain tracked in #185. Since the sun and moon are
baked into the footage, live moon phases need a separate clean sky layer.

## Editorial scroll-scrub review (#185)

Branch: `feat/185-landing-editorial-snap-chapters` (based on
`feat/107-cinematic-lake-video-scroll`).

After the first visual pass, mandatory CSS scroll snapping felt too abrupt.
This follow-up deliberately **removes mandatory snapping** and uses a pinned
photographic/Three.js viewport with scroll-driven scene pacing:

- Four named reading states, each held for ~60% of its scroll beat, followed by
  a reversible smoothstep transition over the remaining ~40%.
- Editorial copy stays readable through the hold and cross-fades late in the
  transition (rather than changing halfway through a full-viewport slide).
- The fourth beat ends with a controlled fade of the lake / tetrahedrons.
  The pinned scene then scrolls out naturally into the product section.
- Chapter rail buttons jump gently to the start of each reading hold.
- No intercepted wheel events, added animation dependency, or mandatory snap.
- Reduced-motion / no-WebGL fallbacks and the live product CTAs remain usable.
  The sand-mandala dissolution effect remains tracked separately in #185.

If you already checked out the separate editorial review worktree:

```sh
cd ~/projects/inference-exchange-editorial-review
git pull --ff-only
cd web
npm run build
npm run dev -- --port 5175 --strictPort
```

To compare side by side **without changing the existing review worktree**:

```sh
cd ~/projects/inference-exchange
git fetch origin
git worktree add -b review/landing-editorial ../inference-exchange-editorial-review origin/feat/185-landing-editorial-snap-chapters
mkdir -p ../inference-exchange-editorial-review/web/public/media
cp ../inference-exchange-landing-review/web/public/media/alpine-lake-hero.mp4 ../inference-exchange-editorial-review/web/public/media/
cp ../inference-exchange-landing-review/web/public/media/alpine-lake-poster.webp ../inference-exchange-editorial-review/web/public/media/
cd ../inference-exchange-editorial-review/web
npm ci
npm run build
npm run dev -- --port 5175 --strictPort
```

Test slow and fast trackpad scrolling, smooth scene holds, reverse scrubbing,
right-hand chapter markers, navigation/keyboard access, reduced-motion mode,
mobile, and the natural handoff into the product section. The original
preview remains at port 5174 if it is running. No production configuration,
provider processes, or `main` files are changed.


## Why the final dissolve stalled and looked invisible (October 30 review)

Two independent problems were identified directly in the implementation:

1. The in-place product `<section>` used
   `overflow-y-auto overscroll-contain`. That nested scroll container
   prevented wheel/trackpad scroll chaining to the document once the
   product overlay was interactive. A headless Chromium reproduction
   confirmed that wheel input stayed stuck with `overscroll-behavior:
   contain` and advanced normally with default `auto`. The pinned
   product now keeps mobile overflow but uses default overscroll chaining,
   and uses `md:overflow-visible` on desktop.
2. The final effect was compressed into only the last 40% of a single
   viewport of scroll, then double-eased. Grains traveled too far to the
   right and were roughly 1–2 pixels, translucent and faded out quickly.
   The visible particle window was therefore tiny.

Fixes on this branch:

- A **1.85-viewport continuous scroll-scrub dissolve** after a 0.35
  viewport readable Transformation hold, followed by a final resting
  product screen. Chapter navigation is still native and reversible.
- One shared procedural wind profile for each triangle-sampled grain
  *and* the original tetrahedron faces and edge lines. Grains begin
  lifting, then corresponding solid fragments are `discard`ed by
  `onBeforeCompile` shader hooks. Unlike a global opacity fade, this
  reveals genuine piecewise material erosion.
- Slower accelerating gust with brighter, larger (but capped) grains,
  less lateral displacement, and a longer onscreen particle fade. No
  second cubic easing pass is applied to already eased scroll progress.
- Pigment-flow GPU work is skipped while the layer is invisible;
  the same renderer and background instance persist throughout.

**Technical distinction:** this uses the *principles* of sand-blow
effects (GPU `THREE.Points`, spatially phased grain release, matched
surface erosion), not copied source code and not a feedback-buffer
(GPGPU/FBO) fluid or particle simulation. That heavier option is not
necessary to establish the art direction and can be tested separately.

Validation performed: code and diff inspection, a headless Chromium
scroll-chaining reproduction, and a numerical monotonicity/reversibility
test of the scroll timeline. The full React `npm run build` and live
browser shader validation **still require local testing**.

```sh
cd ~/projects/inference-exchange-mandala-review
git pull --ff-only
cd web
npm run build
npm run dev -- --port 5176 --strictPort
```

With DevTools Console open, check that the WebGL program compiles without
`THREE.WebGLProgram` shader errors. Move slowly through the last
**Transformation** scene using the trackpad (without dragging the native
scrollbar), and reverse the motion to reconstruct the crystals. Verify that
the final product CTA buttons remain clickable and wheel scrolling isn't
captured by the product overlay.

## Single-scene mineral smear revision

The first prototype had two different `MineralFlowField` canvases, a 2px
mineral-spectrum divider and a separate product section. This caused an
unwanted hard seam and made the sand feel disconnected from the crystals.

The revised `feat/185-mineral-mandala-dissolve` branch eliminates all three:

- **One GPU shader canvas** lives in the pinned scene from the first frame,
  invisible until the final chapter. The same instance becomes the background
  of the live product UI.
- The crystal geometry erodes into 30k/8.5k scroll-driven grains; a shader
  reveal tied to that exact dissolution progress spreads pigment from the
  center toward the right. No pre-rendered video transition is required.
- In the last scroll beat, the landscape fades away, mineral bands emerge,
  and the real headline, chat/provide actions and live market card **fade in
  inside the same pinned viewport**. There is no second slide, divider, or
  background reinitialization.
- An additional ~0.85 viewport scroll resting zone keeps the final screen
  available to read and interact with, without forcing snap or wheel traps.
  Scrolling back reconstructs the scene.
- `Skip story` jumps to the final scene's actual scroll position (rather
  than calling `scrollIntoView` on a pinned child), and keyboard focus moves
  to the product panel when it is ready.
- The reduced-motion / no-WebGL fallback exposes the product content directly.
  All financial/trust disclaimers and actual React routes are preserved.

### Update existing mandala review worktree

```sh
cd ~/projects/inference-exchange-mandala-review
git pull --ff-only
cd web
npm run build
npm run dev -- --port 5176 --strictPort
```

Open `http://localhost:5176/`, scroll through the last Transformation
chapter, and confirm there is no horizontal dividing line or second background.
Test backscroll, Skip story, the chat/provider buttons, the live market card,
and final panel scrolling on a short/mobile display.

**QA caveat:** this is a visual prototype. The full React build, frame pacing,
and shader compilation on actual browser hardware require local verification.
It is not merged to `main`.

## Experimental mineral sand-mandala dissolve (#185)

New standalone branch: `feat/185-mineral-mandala-dissolve`, built on
`feat/185-landing-editorial-snap-chapters`. Your original editorial preview
and alpha/provider environments are not changed.

- The regular tetrahedrons stay full-sized and retain their rise/descent,
  intersection and rotation.
- On the final scroll beat (~scene progress 0.82 onward), 30,000 desktop /
  8,500 narrow-screen **GPU grains sampled from their real triangular faces**
  erode outward in a deterministic rightward gust. Reverse scrolling rebuilds
  the same objects without jittering or replaying a physics simulation.
- A separate GLSL pigment-flow field appears behind the grains while the
  mountain fades. That same field continues behind the final product headline
  and live market card, beneath accessible HTML controls.
- The styling derives from mineral pigments and impermanence without copying
  sacred sand-mandala iconography.
- Reduced-motion visitors get a static pigment background. If WebGL is
  unavailable, its CSS gradient remains visible; navigation remains usable.
- This is a first **art-direction prototype**, not a licensed sand asset or
  physically simulated sand fluid. Tune pigment density, flow and seamless
  section matching after reviewing on real hardware. No new NPM packages.

### Open a separate preview alongside the earlier experiment (5176)

```sh
cd ~/projects/inference-exchange
git fetch origin
git worktree add -b review/landing-mandala ../inference-exchange-mandala-review origin/feat/185-mineral-mandala-dissolve

mkdir -p ../inference-exchange-mandala-review/web/public/media
cp ../inference-exchange-editorial-review/web/public/media/alpine-lake-hero.mp4 ../inference-exchange-mandala-review/web/public/media/
cp ../inference-exchange-editorial-review/web/public/media/alpine-lake-poster.webp ../inference-exchange-mandala-review/web/public/media/

cd ../inference-exchange-mandala-review/web
npm ci
npm run build
npm run dev -- --port 5176 --strictPort
```

Open `http://localhost:5176/` and scroll slowly through the final
**Transformation** chapter into `Distributed AI inference, powered by
everyone.`. Scroll backward to assess grain reconstruction and ensure the
original geometry does not shrink. Also check reduced motion, resized window,
marketplace buttons, and GPU performance. The old editorial preview can remain
open at `http://localhost:5175/`.
