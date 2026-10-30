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
- `http://localhost:5174/` — complete intro, crystal, ripples and landscape
- `http://localhost:5174/?heroRaw=1` — video alone below the navbar
- `http://localhost:5174/?heroFit=cover` — viewport crop comparison
- `http://localhost:5174/?heroRaw=1&heroFit=cover` — crop without overlays

`object-fit: contain` remains the default to preserve the mountain and
its reflection, which means a wide-video letterbox on taller screens.

## Remaining production work

This is a visual test asset, not yet a release/master: true 1080p-or-better
source detail, a precisely matched seamless loop, audio-free media delivery
rights, responsive framing, grain/codec quality assessment and other
cinematic refinements remain tracked in #185. Since the sun and moon are
baked into the footage, live moon phases need a separate clean sky layer.
