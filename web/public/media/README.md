# Local cinematic landing page media (#107, #185)

The background video and poster are intentionally **not committed** to this
code-only experimental branch. Reviewers provide them as local files.

## Quality comparison preview (October 29, 2026)

To address the feedback that the first prototype looks **too zoomed-in,
grainy and tinted**, this branch now:

- Defaults to `object-fit: contain`, retaining the complete 2.34:1 composition
  instead of cropping it to the browser viewport. It shows softened poster
  imagery only *behind* the visible video where letterboxing is necessary.
- Removes the full-frame dark gradient that previously covered the footage.
- Allows A/B diagnostic query parameters:
  - `/?heroRaw=1` — just the background video, with no Three.js or lotus/ripple
    layers and no intro text; persistent navigation remains.
  - `/?heroFit=cover` — old full-bleed crop, but without the dark tint.
  - `/?heroRaw=1&heroFit=cover` — raw footage with the previous crop.
- Retains existing animated Three.js tetrahedrons by default.

The original Kling clip is **1460 × 624 at ~12.6 Mb/s**, compared with the
original compressed preview at **1280 × 548 at ~1.6 Mb/s**. The high-quality
test bundle remuxes the original H.264 stream without reducing its resolution
or picture quality. It is *not* a native 1080p clip; full source regeneration
for that and ~30s water flow remains tracked in #185.

## Install in a separate review worktree

Download `ie_landing_quality_preview.zip` from the ChatGPT conversation and
extract it into the root of the **review worktree**, not the running alpha
checkout:

```sh
cd ~/projects/inference-exchange-landing-review
unzip -o ~/Downloads/ie_landing_quality_preview.zip -d .
cd web
npm ci
npm run build
npm run dev -- --port 5174 --strictPort
```

Expected files (local/untracked):
- `web/public/media/alpine-lake-hero.mp4`
- `web/public/media/alpine-lake-poster.webp`

The current five-second Kling clip is **not a seamless loop**. It plays once
and holds its last frame. This preview is intended for visual evaluation,
not production: watermark-free rights-cleared source footage, native 1080p+
quality, longer looping environmental water, and responsive art direction
remain future work in #185.

While the video is loaded, the generated sun/moon are hidden. A genuinely
phase-accurate moon requires a sky plate without a baked-in moon, and has
not been implemented.
