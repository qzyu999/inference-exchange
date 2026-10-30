# Local media for the cinematic landing page (#107)

The video and poster are **intentionally not committed** to this code-only review branch.
They were provided as user assets in the ChatGPT conversation and cannot be transferred
through the connected GitHub code editor. This branch can be checked out and built
without them: the existing Three.js scene remains available as a fallback.

To preview the supplied lake footage, download **ie_landing_media.zip** from the
ChatGPT conversation and extract it into the repository root:

```bash
unzip -o ~/Downloads/ie_landing_media.zip -d .
cd web
npm install
npm run dev
```

Expected paths:
- `web/public/media/alpine-lake-hero.mp4` (1280 × 548, H.264)
- `web/public/media/alpine-lake-poster.webp`

This five-second Kling draft is **not seamless**. The implementation plays it once
and holds its final frame instead of using a jarring native loop.

Before production, replace it with a licensed, watermark-free, stationary-camera
seamless loop, then enable looping in `LandscapeVideo.tsx`.

The original generated sun/moon are hidden while the background video is active.
Phase-accurate moon rendering requires a clean sky plate without a baked-in moon
and is a follow-up, not an implemented feature.
