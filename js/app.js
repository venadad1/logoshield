/* LogoShield Studio — client-side video watermarking engine.
   Everything runs in the browser: no paid API keys, no server upload.
   Rendering is done with ffmpeg.wasm (loaded lazily from a CDN on first render). */

const state = {
  videoFile: null,
  videoURL: null,
  videoMeta: { width: 0, height: 0, duration: 0 },
  logoFile: null,
  logoImg: null,
  variant: "static",     // static | marquee | shield | pulse | rotate | fade
  position: "br",        // tl tc tr ml mc mr bl bc br
  sizePct: 14,           // % of video width
  opacity: 0.85,
  tintColor: "#35c7f0",
  tintStrength: 0,        // 0 = original colors
  density: 3,             // shield tiles per row/col
  speed: 140,             // px/sec for marquee
  animSpeed: 1,           // multiplier for pulse/rotate/fade animation rate
};

const $ = (sel) => document.querySelector(sel);

const els = {};

document.addEventListener("DOMContentLoaded", init);

function init() {
  els.videoDrop = $("#videoDrop");
  els.videoInput = $("#videoInput");
  els.logoDrop = $("#logoDrop");
  els.logoInput = $("#logoInput");
  els.stage = $("#stage");
  els.previewWrap = $("#previewWrap");
  els.previewVideo = $("#previewVideo");
  els.overlayCanvas = $("#overlayCanvas");
  els.renderBtn = $("#renderBtn");
  els.progress = $("#progress");
  els.progressBar = $("#progress > div");
  els.statusLine = $("#statusLine");
  els.resultBox = $("#resultBox");
  els.manualDims = $("#manualDims");
  els.mWidth = $("#mWidth");
  els.mHeight = $("#mHeight");
  els.mDuration = $("#mDuration");
  els.openBgRemoverBtn = $("#openBgRemoverBtn");
  els.bgRemoverOverlay = $("#bgRemoverOverlay");
  els.bgRemoverCanvas = $("#bgRemoverCanvas");
  els.bgTolerance = $("#bgTolerance");
  els.bgTolVal = $("#bgTolVal");
  els.bgCancelBtn = $("#bgCancelBtn");
  els.bgApplyBtn = $("#bgApplyBtn");

  wireDropzone(els.videoDrop, els.videoInput, onVideoFile, "video/*");
  wireDropzone(els.logoDrop, els.logoInput, onLogoFile, "image/*");
  wireVariantCards();
  wirePositionGrid();
  wireSliders();
  wireBottomBar();
  wireBgRemover();

  els.renderBtn.addEventListener("click", handleRender);
  ["mWidth", "mHeight", "mDuration"].forEach((id) => {
    $("#" + id).addEventListener("change", syncManualMeta);
  });

  requestAnimationFrame(previewLoop);
}

/* ---------------- Dropzones ---------------- */
function wireDropzone(zone, input, handler, accept) {
  if (!zone) return;
  zone.addEventListener("click", () => input.click());
  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("dragover"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("dragover");
    const f = e.dataTransfer.files[0];
    if (f) handler(f);
  });
  input.addEventListener("change", () => {
    if (input.files[0]) handler(input.files[0]);
  });
}

function onVideoFile(file) {
  state.videoFile = file;
  if (state.videoURL) URL.revokeObjectURL(state.videoURL);
  state.videoURL = URL.createObjectURL(file);
  $("#videoDrop .fname").textContent = file.name + "  (" + humanSize(file.size) + ")";

  els.stage.querySelector(".stage-empty")?.remove();
  els.previewVideo.src = state.videoURL;
  els.previewVideo.muted = true;
  els.previewVideo.loop = true;
  els.previewVideo.playsInline = true;

  els.previewVideo.addEventListener("loadedmetadata", () => {
    state.videoMeta.width = els.previewVideo.videoWidth || 1280;
    state.videoMeta.height = els.previewVideo.videoHeight || 720;
    state.videoMeta.duration = els.previewVideo.duration || 0;
    els.mWidth.value = state.videoMeta.width;
    els.mHeight.value = state.videoMeta.height;
    els.mDuration.value = Math.round(state.videoMeta.duration || 0);
    els.overlayCanvas.width = state.videoMeta.width;
    els.overlayCanvas.height = state.videoMeta.height;
    els.previewVideo.play().catch(() => {});
    checkReady();
  }, { once: true });

  els.previewVideo.addEventListener("error", () => {
    // Container/codec the browser can't preview (e.g. some .avi/.mkv streams).
    // Rendering still works via ffmpeg.wasm — just ask for dimensions manually.
    els.manualDims.style.display = "grid";
    els.statusLine.textContent = "Preview unavailable for this format — enter width/height/duration below so protection placement stays accurate. Rendering will still work.";
    checkReady();
  });
}

function syncManualMeta() {
  state.videoMeta.width = parseInt(els.mWidth.value, 10) || state.videoMeta.width;
  state.videoMeta.height = parseInt(els.mHeight.value, 10) || state.videoMeta.height;
  state.videoMeta.duration = parseFloat(els.mDuration.value) || state.videoMeta.duration;
  els.overlayCanvas.width = state.videoMeta.width;
  els.overlayCanvas.height = state.videoMeta.height;
}

function onLogoFile(file) {
  state.logoFile = file;
  const img = new Image();
  img.onload = () => {
    state.logoImg = img;
    els.openBgRemoverBtn.disabled = false;
    checkLogoTransparency(img);
    checkReady();
  };
  img.src = URL.createObjectURL(file);
  $("#logoDrop .fname").textContent = file.name;
}

// Heuristic: sample the four corners of the logo. If every corner is fully
// opaque, the file almost certainly has no real transparency (a common
// export mistake — e.g. a PNG saved with a white background instead of an
// alpha channel). That solid background then rotates/pulses along with the
// artwork instead of staying invisible, which is what makes "rotate" look
// like a translucent blob rather than a spinning icon.
function checkLogoTransparency(img) {
  const warnEl = $("#logoWarning");
  if (!warnEl) return;
  const c = document.createElement("canvas");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const w = c.width, h = c.height;
  const pts = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]];
  const opaqueCorners = pts.every(([x, y]) => ctx.getImageData(x, y, 1, 1).data[3] >= 250);
  if (opaqueCorners) {
    warnEl.style.display = "block";
    warnEl.textContent = "⚠ This logo looks fully opaque (no transparent background detected). Use the \"Remove background / make transparent\" button above before rendering, or Static/Rotate/Shield will show a solid box instead of just the artwork.";
  } else {
    warnEl.style.display = "none";
  }
}

function checkReady() {
  els.renderBtn.disabled = !(state.videoFile && state.logoImg && state.videoMeta.width);
}

/* ---------------- Controls ---------------- */
function wireVariantCards() {
  document.querySelectorAll(".variant-card").forEach((card) => {
    card.addEventListener("click", () => {
      document.querySelectorAll(".variant-card").forEach((c) => c.classList.remove("active"));
      card.classList.add("active");
      state.variant = card.dataset.variant;
      $("#positionBlock").style.display = (state.variant === "shield") ? "none" : "block";
      $("#densityField").style.display = (state.variant === "shield") ? "block" : "none";
      $("#speedField").style.display = (state.variant === "marquee") ? "block" : "none";
      $("#animSpeedField").style.display = ["pulse", "rotate", "fade"].includes(state.variant) ? "block" : "none";
    });
  });
}

function wirePositionGrid() {
  document.querySelectorAll(".pos-dot").forEach((dot) => {
    dot.addEventListener("click", () => {
      document.querySelectorAll(".pos-dot").forEach((d) => d.classList.remove("active"));
      dot.classList.add("active");
      state.position = dot.dataset.pos;
    });
  });
}

function wireSliders() {
  bindRange("sizeRange", (v) => { state.sizePct = +v; }, "sizeVal", (v) => v + "%");
  bindRange("opacityRange", (v) => { state.opacity = +v / 100; }, "opacityVal", (v) => v + "%");
  bindRange("tintStrengthRange", (v) => { state.tintStrength = +v / 100; }, "tintVal", (v) => v + "%");
  bindRange("densityRange", (v) => { state.density = +v; }, "densityVal", (v) => v + " x " + v);
  bindRange("speedRange", (v) => { state.speed = +v; }, "speedVal", (v) => v + " px/s");
  bindRange("animSpeedRange", (v) => { state.animSpeed = +v / 100; }, "animSpeedVal", (v) => (+v / 100).toFixed(1) + "x");
  $("#tintColor").addEventListener("input", (e) => { state.tintColor = e.target.value; });
}
function bindRange(id, onChange, labelId, fmt) {
  const el = $("#" + id);
  if (!el) return;
  const label = $("#" + labelId);
  const update = () => { onChange(el.value); if (label) label.textContent = fmt(el.value); };
  el.addEventListener("input", update);
  update();
}

function wireBottomBar() {
  const bar = $("#bottomBar");
  const closeBtn = $("#bottomBarClose");
  if (!bar || !closeBtn) return;
  document.body.classList.add("bottom-bar-visible");
  closeBtn.addEventListener("click", () => {
    bar.classList.add("is-hidden");
    document.body.classList.remove("bottom-bar-visible");
  });
}

/* ---------------- Background remover (client-side color-key tool) ----------------
   Free, no-API way to turn an opaque logo into a real transparent PNG: the user
   clicks the background color, we compute a per-pixel distance to that color and
   zero out alpha within tolerance, with a feathered band at the edge so it doesn't
   look jagged. This runs entirely on canvas, nothing leaves the browser. */
const bg = {
  srcCanvas: null,   // full-resolution offscreen canvas holding the ORIGINAL pixels
  srcCtx: null,
  original: null,    // pristine ImageData, re-read every time so edits don't stack
  pickedColor: null, // {r,g,b} chosen by clicking, or auto-picked from corners
};

function wireBgRemover() {
  if (!els.openBgRemoverBtn) return;

  els.openBgRemoverBtn.addEventListener("click", openBgRemover);
  els.bgCancelBtn.addEventListener("click", closeBgRemover);
  els.bgTolerance.addEventListener("input", () => {
    $("#bgTolVal").textContent = els.bgTolerance.value;
    reprocessBgRemover();
  });
  els.bgRemoverCanvas.addEventListener("click", (e) => {
    const rect = els.bgRemoverCanvas.getBoundingClientRect();
    const scaleX = els.bgRemoverCanvas.width / rect.width;
    const scaleY = els.bgRemoverCanvas.height / rect.height;
    const x = Math.round((e.clientX - rect.left) * scaleX);
    const y = Math.round((e.clientY - rect.top) * scaleY);
    const px = bg.original.data;
    const i = (y * bg.original.width + x) * 4;
    bg.pickedColor = { r: px[i], g: px[i + 1], b: px[i + 2] };
    reprocessBgRemover();
  });
  els.bgApplyBtn.addEventListener("click", applyBgRemover);
}

function openBgRemover() {
  if (!state.logoImg) return;
  const img = state.logoImg;
  const MAX = 420; // display/working resolution cap — plenty for a logo, keeps it fast
  const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));

  bg.srcCanvas = document.createElement("canvas");
  bg.srcCanvas.width = w; bg.srcCanvas.height = h;
  bg.srcCtx = bg.srcCanvas.getContext("2d");
  bg.srcCtx.drawImage(img, 0, 0, w, h);
  bg.original = bg.srcCtx.getImageData(0, 0, w, h);

  // auto-pick an initial background color from the four corners so the
  // preview isn't blank the moment the panel opens
  const d = bg.original.data;
  const corners = [0, (w - 1) * 4, (h - 1) * w * 4, ((h - 1) * w + (w - 1)) * 4];
  let r = 0, g = 0, b = 0;
  corners.forEach((i) => { r += d[i]; g += d[i + 1]; b += d[i + 2]; });
  bg.pickedColor = { r: r / 4, g: g / 4, b: b / 4 };

  els.bgRemoverCanvas.width = w;
  els.bgRemoverCanvas.height = h;
  els.bgRemoverOverlay.style.display = "flex";
  reprocessBgRemover();
}

function closeBgRemover() {
  els.bgRemoverOverlay.style.display = "none";
}

function reprocessBgRemover() {
  if (!bg.original || !bg.pickedColor) return;
  const tolerance = +els.bgTolerance.value;
  const feather = 40;
  const { r: br, g: bgc, b: bb } = bg.pickedColor;

  const out = new ImageData(new Uint8ClampedArray(bg.original.data), bg.original.width, bg.original.height);
  const px = out.data;
  for (let i = 0; i < px.length; i += 4) {
    const dr = px[i] - br, dg = px[i + 1] - bgc, db = px[i + 2] - bb;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    let factor;
    if (dist <= tolerance) factor = 0;
    else if (dist >= tolerance + feather) factor = 1;
    else factor = (dist - tolerance) / feather;
    px[i + 3] = Math.round(px[i + 3] * factor);
  }
  bg.srcCtx.putImageData(out, 0, 0);
  const previewCtx = els.bgRemoverCanvas.getContext("2d");
  previewCtx.clearRect(0, 0, els.bgRemoverCanvas.width, els.bgRemoverCanvas.height);
  previewCtx.drawImage(bg.srcCanvas, 0, 0);
}

function applyBgRemover() {
  // Re-render at full original resolution (not the capped working size) so
  // exported logo quality matches the source file, using the same picked
  // color/tolerance the user just previewed.
  const img = state.logoImg;
  const w = img.naturalWidth, h = img.naturalHeight;
  const full = document.createElement("canvas");
  full.width = w; full.height = h;
  const fctx = full.getContext("2d");
  fctx.drawImage(img, 0, 0);
  const data = fctx.getImageData(0, 0, w, h);

  const tolerance = +els.bgTolerance.value;
  const feather = 40;
  const { r: br, g: bgc, b: bb } = bg.pickedColor;
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const dr = px[i] - br, dg = px[i + 1] - bgc, db = px[i + 2] - bb;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    let factor;
    if (dist <= tolerance) factor = 0;
    else if (dist >= tolerance + feather) factor = 1;
    else factor = (dist - tolerance) / feather;
    px[i + 3] = Math.round(px[i + 3] * factor);
  }
  fctx.putImageData(data, 0, 0);

  full.toBlob((blob) => {
    const newImg = new Image();
    newImg.onload = () => {
      state.logoImg = newImg;
      checkLogoTransparency(newImg);
      $("#logoDrop .fname").textContent = (state.logoFile?.name || "logo") + " (background removed)";
      closeBgRemover();
    };
    newImg.src = URL.createObjectURL(blob);
  }, "image/png");
}

/* ---------------- Live preview (canvas over <video>) ---------------- */
function previewLoop() {
  const ctx = els.overlayCanvas?.getContext("2d");
  if (ctx && state.logoImg && els.previewVideo && !els.previewVideo.paused) {
    ctx.clearRect(0, 0, els.overlayCanvas.width, els.overlayCanvas.height);
    drawWatermarkFrame(ctx, els.overlayCanvas.width, els.overlayCanvas.height, els.previewVideo.currentTime || 0);
  }
  requestAnimationFrame(previewLoop);
}

// Shared drawing routine used both for the live preview canvas and for
// pre-rendering the transparent overlay asset that gets baked into export.
function drawWatermarkFrame(ctx, W, H, t) {
  const logoW = Math.max(8, Math.round(W * (state.sizePct / 100)));
  const logoH = Math.round(logoW * (state.logoImg.naturalHeight / state.logoImg.naturalWidth));
  const margin = Math.round(W * 0.02);

  const drawAt = (x, y, alphaMul = 1, scaleMul = 1, rotateRad = 0) => {
    ctx.save();
    ctx.globalAlpha = state.opacity * alphaMul;
    const cx = x + logoW / 2, cy = y + logoH / 2;
    ctx.translate(cx, cy);
    ctx.rotate(rotateRad);
    ctx.scale(scaleMul, scaleMul);
    ctx.drawImage(state.logoImg, -logoW / 2, -logoH / 2, logoW, logoH);
    if (state.tintStrength > 0) {
      ctx.globalCompositeOperation = "source-atop";
      ctx.globalAlpha = state.opacity * alphaMul * state.tintStrength;
      ctx.fillStyle = state.tintColor;
      ctx.fillRect(-logoW / 2, -logoH / 2, logoW, logoH);
    }
    ctx.restore();
  };

  const pos = positionXY(state.position, W, H, logoW, logoH, margin);

  switch (state.variant) {
    case "static":
      drawAt(pos.x, pos.y);
      break;
    case "marquee": {
      const span = W + logoW;
      const x = ((t * state.speed) % span) - logoW;
      drawAt(x, pos.y);
      break;
    }
    case "pulse": {
      const s = 1 + 0.08 * Math.sin(t * 2.4 * state.animSpeed);
      drawAt(pos.x, pos.y, 1, s);
      break;
    }
    case "rotate": {
      drawAt(pos.x, pos.y, 1, 1, t * 0.6 * state.animSpeed);
      break;
    }
    case "fade": {
      const a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 1.6 * state.animSpeed));
      drawAt(pos.x, pos.y, a);
      break;
    }
    case "shield": {
      const cols = state.density, rows = state.density;
      const cellW = W / cols, cellH = H / rows;
      let i = 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const offset = (r % 2 === 1) ? cellW / 2 : 0;
          const x = (c * cellW + offset) % W - logoW / 2 + cellW / 2 - logoW/2;
          const y = r * cellH + cellH / 2 - logoH / 2;
          const alt = (i % 2 === 0) ? 0.55 : 0.35;
          drawAt(x, y, alt);
          i++;
        }
      }
      break;
    }
  }
}

function positionXY(pos, W, H, w, h, m) {
  const xMap = { l: m, c: (W - w) / 2, r: W - w - m };
  const yMap = { t: m, m: (H - h) / 2, b: H - h - m };
  const col = pos[1] === "l" ? "l" : pos[1] === "r" ? "r" : "c";
  const row = pos[0] === "t" ? "t" : pos[0] === "b" ? "b" : "m";
  return { x: xMap[col], y: yMap[row] };
}

/* ---------------- Render pipeline (ffmpeg.wasm) ---------------- */
let ffmpegInstance = null;

// The @ffmpeg/ffmpeg package itself is self-hosted under js/vendor/ (a few
// KB total). That's the part that matters for same-origin: its FFmpeg class
// internally does `new Worker(new URL("./worker.js", import.meta.url))`,
// and browsers refuse to construct a dedicated Worker from a cross-origin
// script URL — no CORS header fixes that. Resolving it via import.meta.url
// of *this* module means it works from any deploy path.
//
// The multi-megabyte ffmpeg-core.wasm files are intentionally NOT vendored
// into this repo — static hosts like Cloudflare Pages reject any single
// deployed file over 25 MB, and the compiled cores are 30+ MB each. Loading
// them is a plain fetch() (via toBlobURL below), which cross-origin CORS
// handles fine, so they're pulled from a CDN at render time instead.
const VENDOR_BASE = new URL("./vendor/", import.meta.url);
const CORE_CDN_BASE = "https://cdn.jsdelivr.net/npm";
const CORE_VERSION = "0.12.6";

async function loadFFmpeg(onLog) {
  if (ffmpegInstance) return ffmpegInstance;
  const { FFmpeg } = await import(new URL("ffmpeg/index.js", VENDOR_BASE).href);
  const { toBlobURL } = await import(new URL("util/index.js", VENDOR_BASE).href);
  const ffmpeg = new FFmpeg();
  ffmpeg.on("log", ({ message }) => onLog && onLog(message));

  const multiThread = window.crossOriginIsolated === true;
  const coreBase = multiThread
    ? `${CORE_CDN_BASE}/@ffmpeg/core-mt@${CORE_VERSION}/dist/esm`
    : `${CORE_CDN_BASE}/@ffmpeg/core@${CORE_VERSION}/dist/esm`;

  const config = {
    coreURL: await toBlobURL(`${coreBase}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${coreBase}/ffmpeg-core.wasm`, "application/wasm"),
  };
  if (multiThread) {
    config.workerURL = await toBlobURL(`${coreBase}/ffmpeg-core.worker.js`, "text/javascript");
  }
  await ffmpeg.load(config);
  ffmpegInstance = ffmpeg;
  return ffmpeg;
}

// Bake size + color tint into a still transparent PNG. Used as the overlay
// source for every variant (including the animated ones) — opacity and any
// time-based animation are applied afterwards inside the ffmpeg filter
// graph itself, not baked into the bitmap. Real alpha channel end to end.
function renderStaticLogoPNG() {
  const W = state.videoMeta.width;
  const logoW = Math.max(8, Math.round(W * (state.sizePct / 100)));
  const logoH = Math.round(logoW * (state.logoImg.naturalHeight / state.logoImg.naturalWidth));
  const c = document.createElement("canvas");
  c.width = logoW; c.height = logoH;
  const ctx = c.getContext("2d");
  ctx.drawImage(state.logoImg, 0, 0, logoW, logoH);
  if (state.tintStrength > 0) {
    ctx.globalCompositeOperation = "source-atop";
    ctx.globalAlpha = state.tintStrength;
    ctx.fillStyle = state.tintColor;
    ctx.fillRect(0, 0, logoW, logoH);
  }
  return new Promise((resolve) => c.toBlob((b) => resolve({ blob: b, w: logoW, h: logoH }), "image/png"));
}

// Builds a chain of alternating alpha fade-out/fade-in segments covering the
// full video duration, for the "fade ghost" variant. Pure ffmpeg filters —
// no pre-recorded clip involved, so there's no alpha-encoding step that can
// go wrong.
function buildFadeChain(duration, animSpeed = 1) {
  const half = 1.5 / Math.max(0.1, animSpeed); // seconds per half-cycle
  const D = Math.max(duration || 6, half * 2);
  const parts = [];
  let t = 0, out = true;
  while (t < D - 0.01) {
    const d = Math.min(half, D - t);
    parts.push(`fade=t=${out ? "out" : "in"}:st=${t.toFixed(2)}:d=${d.toFixed(2)}:alpha=1`);
    t += d;
    out = !out;
  }
  return parts.join(",");
}

async function handleRender() {
  if (!state.videoFile || !state.logoImg) return;
  els.renderBtn.disabled = true;
  els.resultBox.style.display = "none";
  els.progress.style.display = "block";
  setProgress(0, "Preparing assets…");

  try {
    const W = state.videoMeta.width, H = state.videoMeta.height;
    const margin = Math.round(W * 0.02);

    setProgress(8, "Baking logo layer…");
    const asset = await renderStaticLogoPNG();
    // Without an explicit framerate, a looped still image defaults to 25 fps
    // in ffmpeg. If the source video runs at 30/50/60 fps, the overlay has to
    // reuse the same logo frame for several video frames in a row, which is
    // exactly what makes pulse/rotate/fade/marquee look like they stutter
    // instead of animating smoothly. Forcing 60 fps here covers every common
    // video frame rate, so the overlay always has a fresh value to draw.
    const overlayInputArgs = ["-loop", "1", "-framerate", "60", "-i", "logo.png"];

    // Shared first stage for every variant: give the PNG a real alpha
    // channel and apply the requested opacity as a constant multiplier.
    // Everything downstream (position, animation) works on top of this.
    const base = `[1:v]format=rgba,colorchannelmixer=aa=${state.opacity.toFixed(3)}`;
    let filterComplex;

    if (state.variant === "shield") {
      const cols = state.density, rows = state.density;
      const cellW = W / cols, cellH = H / rows;
      const parts = [
        `${base}[wmA]`,
        `[wmA]split=2[wmA1][wmA2]`,
        `[wmA1]colorchannelmixer=aa=0.65[wmHi]`,
        `[wmA2]colorchannelmixer=aa=0.4[wmLo]`,
      ];
      let cur = "0:v";
      let idx = 0;
      const total = rows * cols;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const offset = (r % 2 === 1) ? cellW / 2 : 0;
          const x = Math.round(((c * cellW + offset) % W) - asset.w / 2 + cellW / 2 - asset.w / 2);
          const y = Math.round(r * cellH + cellH / 2 - asset.h / 2);
          const src = (idx % 2 === 0) ? "wmHi" : "wmLo";
          const next = (idx === total - 1) ? "outv" : `t${idx}`;
          parts.push(`[${cur}][${src}]overlay=x=${x}:y=${y}${idx === total - 1 ? ":shortest=1" : ""}[${next}]`);
          cur = next;
          idx++;
        }
      }
      filterComplex = parts.join(";");

    } else if (state.variant === "marquee") {
      const pos = positionXY(state.position, W, H, asset.w, asset.h, margin);
      const span = W + asset.w;
      filterComplex = `${base}[wm];[0:v][wm]overlay=x='mod(t*${state.speed}\,${span})-${asset.w}':y=${Math.round(pos.y)}:shortest=1[outv]`;

    } else if (state.variant === "pulse") {
      const pos = positionXY(state.position, W, H, asset.w, asset.h, margin);
      const cx = pos.x + asset.w / 2, cy = pos.y + asset.h / 2;
      const rate = (2 * Math.PI * state.animSpeed / 3).toFixed(4);
      filterComplex =
        `${base}[wmA];` +
        `[wmA]scale=w='iw*(1+0.08*sin(${rate}*t))':h='ih*(1+0.08*sin(${rate}*t))':eval=frame[wm];` +
        `[0:v][wm]overlay=x='${cx}-w/2':y='${cy}-h/2':shortest=1[outv]`;

    } else if (state.variant === "rotate") {
      const pos = positionXY(state.position, W, H, asset.w, asset.h, margin);
      const cx = pos.x + asset.w / 2, cy = pos.y + asset.h / 2;
      const rate = (0.6 * state.animSpeed).toFixed(4);
      filterComplex =
        `${base}[wmA];` +
        `[wmA]rotate=a='t*${rate}':ow='hypot(iw\,ih)':oh='hypot(iw\,ih)':c=none[wm];` +
        `[0:v][wm]overlay=x='${cx}-w/2':y='${cy}-h/2':shortest=1[outv]`;

    } else if (state.variant === "fade") {
      const pos = positionXY(state.position, W, H, asset.w, asset.h, margin);
      const fadeChain = buildFadeChain(state.videoMeta.duration, state.animSpeed);
      filterComplex = `${base},${fadeChain}[wm];[0:v][wm]overlay=x=${Math.round(pos.x)}:y=${Math.round(pos.y)}:shortest=1[outv]`;

    } else {
      // static corner (default)
      const pos = positionXY(state.position, W, H, asset.w, asset.h, margin);
      filterComplex = `${base}[wm];[0:v][wm]overlay=x=${Math.round(pos.x)}:y=${Math.round(pos.y)}:shortest=1[outv]`;
    }

    setProgress(20, "Loading render engine…");
    const ffmpeg = await loadFFmpeg((msg) => { /* console.debug(msg) */ });
    ffmpeg.on("progress", ({ progress }) => {
      setProgress(25 + Math.min(73, Math.round(progress * 73)), "Rendering with protected watermark…");
    });

    const inExt = (state.videoFile.name.split(".").pop() || "mp4").toLowerCase();
    const inName = "input." + inExt;
    await ffmpeg.writeFile(inName, new Uint8Array(await state.videoFile.arrayBuffer()));
    await ffmpeg.writeFile("logo.png", new Uint8Array(await asset.blob.arrayBuffer()));

    const outName = "output.mp4";
    const args = [
      "-i", inName,
      ...overlayInputArgs,
      "-filter_complex", filterComplex,
      "-map", "[outv]", "-map", "0:a?",
      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "20",
      "-c:a", "copy",
      "-movflags", "+faststart",
      outName,
    ];

    setProgress(25, "Encoding…");
    await ffmpeg.exec(args);

    setProgress(98, "Preparing download…");
    const data = await ffmpeg.readFile(outName);
    const blob = new Blob([data.buffer], { type: "video/mp4" });
    const url = URL.createObjectURL(blob);

    els.resultBox.style.display = "block";
    const a = els.resultBox.querySelector("a.download");
    a.href = url;
    a.download = "logoshield-" + (state.videoFile.name.replace(/\.[^.]+$/, "")) + ".mp4";
    setProgress(100, "Done — your protected video is ready.");
  } catch (err) {
    console.error(err);
    els.statusLine.textContent = "Render failed: " + (err?.message || err) + " — try a shorter clip or a modern browser (Chrome/Edge) for the fastest multi-threaded engine.";
  } finally {
    els.renderBtn.disabled = false;
  }
}

function setProgress(pct, label) {
  els.progressBar.style.width = pct + "%";
  els.statusLine.textContent = label;
}

function humanSize(bytes) {
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}
