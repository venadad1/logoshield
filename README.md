# LogoShield Studio

A free, no-API-key, in-browser tool to bake an animated watermark logo into a
video. Rendering runs entirely client-side with **ffmpeg.wasm**, self-hosted
under `js/vendor/` (see below for why) — there's no backend, no upload step,
and no server cost, which is what keeps it free to deploy and free to use.

This is a static site: plain HTML/CSS/JS, no build step, no framework.

## Deploy in one step

Push this folder to a GitHub repo, then connect it to any of:

- **Cloudflare Pages** — "Create a project" → connect the repo → build command: *(none)* → output directory: `/`
- **Vercel** — "Import Project" → framework preset: *Other* → no build command needed. `vercel.json` already sets the required headers.
- **Netlify** — "Add new site" → deploy from Git. `netlify.toml` already points to `publish = "."` and sets headers.

Or skip Git entirely: on Netlify/Cloudflare Pages you can drag-and-drop this
folder directly in their dashboard for an instant deploy.

## Why ffmpeg.wasm loading is split: small parts self-hosted, big parts from a CDN

`js/vendor/` contains local copies of just `@ffmpeg/ffmpeg` and `@ffmpeg/util`
(a few KB total — no `.wasm` in there). This isn't just a preference, it
fixes a real runtime error:

```
Failed to construct 'Worker': Script at 'https://.../worker.js' cannot be
accessed from origin 'https://your-site.pages.dev'.
```

The `FFmpeg` class internally does `new Worker(new URL("./worker.js",
import.meta.url))`. Browsers refuse to construct a dedicated `Worker` from a
cross-origin script URL — a hard platform restriction, not something a CORS
header can fix. Self-hosting just this small package means `import.meta.url`
resolves to your own domain, so the worker is same-origin and the error goes
away. `js/app.js` resolves the vendor path via
`new URL("./vendor/", import.meta.url)`, so this works from any deploy path.

The compiled **`ffmpeg-core.wasm` files are intentionally *not* vendored** —
they're 30+ MB each, and most static hosts (Cloudflare Pages included) reject
any single deployed file over 25 MB, which would silently break the whole
deploy. Loading the core is a plain `fetch()` under the hood (via
`toBlobURL`), and that's not subject to the Worker same-origin restriction —
cross-origin `fetch()` just needs CORS, which the jsDelivr CDN already sends.
So the cores keep loading from
`https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/...` and
`https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@0.12.6/...` at render time.

If you ever need to update the self-hosted part, re-install and copy just
the small package:

```
npm install @ffmpeg/ffmpeg@0.12.10 @ffmpeg/util@0.12.1 --prefix /tmp/ffmpeg-vendor
```

then copy the `.js` files (skip `.d.ts`) from each package's `dist/esm/`
folder into the matching `js/vendor/<name>/` folder here. Leave `core` /
`core-mt` alone — they should stay on the CDN.

## Two-page split: ads page vs. isolated editor page

The site is deliberately split in two:

- **`index.html`** — the marketing/landing page. All 6 ad slots + the sticky
  bottom bar live here. It carries no special cross-origin headers, so ad
  scripts and iframes behave exactly as they would on any normal site.
- **`editor.html`** — the actual watermarking tool. It carries
  `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: credentialless`, which unlocks
  `crossOriginIsolated` and lets ffmpeg.wasm load its **multi-threaded** core
  for faster rendering. This page intentionally has **no ad slots at all**,
  so COEP's stricter cross-origin rules never have anything ad-related to
  break.

Visitors move between the two with a normal link/button
(`Open the Editor →` on the homepage, `← Back to home` on the editor page) —
a full page navigation, not an iframe, so each page's headers apply cleanly
to itself and nowhere else.

`_headers` (Netlify/Cloudflare Pages) and `vercel.json` / `netlify.toml`
(Vercel/Netlify) apply the base hardening headers
(`X-Content-Type-Options`, `Referrer-Policy`) to every path, and add the
COOP/COEP pair scoped **only** to `/editor.html`. If you ever add ads to
`editor.html` too, remove that scoped block — `js/app.js` already checks
`window.crossOriginIsolated` and falls back to a single-threaded ffmpeg core
automatically, so the tool keeps working either way, just without the
multi-thread speed boost.

## Before you launch, replace these

- `logoshield.app` — swap for your real domain in every `<link rel="canonical">`, `sitemap.xml`, `robots.txt`, and Open Graph tag.
- `hello@logoshield.app` in `contact.html` — your real inbox.
- The 6 `.ad-slot` placeholders in `index.html` and the `#bottomBar` — drop in your ad network's real embed code (e.g. Google AdSense) in place of the dashed placeholder boxes. Sizes are labeled (160×600, 300×250, 728×90, native) to match common ad-network unit sizes.
- The favicon / OG image (not included) — add your own before launch for best social-share appearance.

## Honest notes on what this tool can and can't do

- **"Unremovable" watermark:** no watermark is truly impossible to remove
  with enough manual effort. The Diagonal Shield (full-frame tiling) mode
  meaningfully raises the difficulty for *automated* removal tools because
  there's no single isolated patch to reconstruct — but the copy on the site
  deliberately avoids promising it's unbeatable, and you shouldn't either.
- **"Unlimited length" rendering:** there's no artificial cap in the code,
  but everything runs in the visitor's browser tab, so the real limit is
  their device's RAM/CPU. Very long or high-resolution sources will be slower
  and more memory-hungry than a server-grade encoder would be.
- **Pulse / Rotate / Fade are pre-baked PNG sequences, not live ffmpeg
  filter math:** earlier versions asked ffmpeg itself to animate the logo
  live, using time-based filter expressions (`scale` with `eval=frame`,
  `rotate=a='t*...'`, chained `fade` filters). Those checked out as
  mathematically smooth and frame-accurate in extensive testing with a
  native ffmpeg build, but real users kept seeing stutter/trembling, or
  (for fade) the logo never appearing at all — later traced mostly to the
  render pipeline not checking ffmpeg's actual exit code (see below), but
  rather than re-introduce the more advanced filter expressions,
  `renderAnimationSequence()` pre-renders one full animation cycle as a
  sequence of full-resolution transparent PNGs (position/scale/rotation/
  alpha already baked into each frame via canvas), and ffmpeg's job is
  reduced to the most basic operation there is: `-loop 1 -framerate <fps>
  -i f%03d.png`, then `overlay=x=0:y=0`. This works well for these three
  because they're subtle, slow-cycling effects where ~15 fps of animation
  resolution (floor 24, cap 90 frames per cycle) is visually plenty.
- **Sliding marquee stays on a live ffmpeg position expression, not a
  sequence:** the pre-baked approach above was tried for marquee too, but
  it made the slide look distinctly robotic/steppy. Full-width continuous
  translation needs a much higher update rate than a slow pulse or rotation
  does — hitting a smooth-looking fps for a multi-second, full-screen slide
  would mean pre-baking hundreds of frames, which isn't practical to
  generate and write per render. Marquee instead uses
  `overlay=x='mod(t*speed,span)-w'`, which ffmpeg re-evaluates on every
  single output frame at the video's true frame rate — smooth by
  construction, and now that render failures are actually caught (below)
  there's no reason to expect the same silent-corruption issue that made
  everything look broken before.
- **The render pipeline now actually checks whether it worked:** earlier
  versions ignored `ffmpeg.exec()`'s return value (an exit code — 0 for
  success) and never sanity-checked the output file size, so an encode that
  failed partway through could still produce a small/corrupt file that got
  handed to the person as a "ready" download — a file that looked done
  instantly but had no playable video in it. The render now throws (and
  surfaces ffmpeg's own recent log lines) if the exit code is non-zero or
  the output is implausibly small.
- **Diagonal Shield renders as one overlay, not a dozen-plus:** the tiled
  pattern (all tiles, at their final per-tile opacity) is composited once,
  client-side, into a single full-resolution transparent PNG. An earlier
  version chained one ffmpeg `overlay` filter per tile (up to 25 for a 5×5
  density), which could overwhelm the ffmpeg.wasm virtual filesystem/memory
  and fail with a generic `FS error`. A single overlay is simpler, faster,
  and doesn't have that failure mode.
- **Constant frame rate normalization:** the main video is always passed
  through `fps=30` before compositing, and the output is encoded with
  `-fps_mode cfr`, since many real-world clips (phone recordings, screen
  recordings, forwarded videos) are variable frame rate and that alone can
  make compositing look uneven regardless of what's being overlaid.
- **Rendering speed:** the app uses `-preset veryfast` (a step up from the
  fastest `ultrafast` preset) with an explicit, regular keyframe interval
  (`-g 60 -keyint_min 30 -sc_threshold 0`) and copies the audio track
  untouched to minimize work, plus multi-threading when cross-origin
  isolation is available. `ultrafast` was tried first and encodes faster,
  but its very aggressive scene-cut detection produces irregular keyframe
  placement that some players/devices decode less smoothly — exactly the
  kind of subtle stutter that kept getting reported for the animated
  variants even after the frame-rate fixes above checked out fine
  frame-by-frame in testing. `veryfast` with a fixed GOP structure is a
  small, worthwhile trade-off for meaningfully more consistent playback. It
  will still be bounded by the visitor's hardware — a browser tab is not a
  render farm.

## File map

```
index.html            landing page: hero, ad inventory, features, FAQ teaser, CTA to the editor
editor.html            the actual tool: dropzones, live preview, controls, render — isolated, ad-free
about.html / faq.html / privacy-policy.html / terms.html / contact.html
css/style.css          design tokens + shared layout (rails, sticky bottom bar, editor grid)
js/app.js              uploads, live canvas preview, watermark baking, ffmpeg.wasm pipeline (used by editor.html)
js/vendor/             self-hosted @ffmpeg/ffmpeg + @ffmpeg/util only (small; wasm cores load from CDN)
robots.txt / sitemap.xml
_headers / vercel.json / netlify.toml   base headers site-wide + COOP/COEP scoped to /editor.html only
```
