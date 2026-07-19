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
- **Rendering speed:** the app uses `-preset ultrafast` and copies the audio
  stream untouched to minimize work, plus multi-threading when cross-origin
  isolation is available. It will still be bounded by the visitor's hardware
  — a browser tab is not a render farm.

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
