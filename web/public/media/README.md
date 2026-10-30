# Local cinematic landing page media (#107, #185)

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
