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

  wireDropzone(els.videoDrop, els.videoInput, onVideoFile, "video/*");
  wireDropzone(els.logoDrop, els.logoInput, onLogoFile, "image/*");
  wireVariantCards();
  wirePositionGrid();
  wireSliders();
  wireBottomBar();

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
  img.onload = () => { state.logoImg = img; checkReady(); };
  img.src = URL.createObjectURL(file);
  $("#logoDrop .fname").textContent = file.name;
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
      const s = 1 + 0.08 * Math.sin(t * 2.4);
      drawAt(pos.x, pos.y, 1, s);
      break;
    }
    case "rotate": {
      drawAt(pos.x, pos.y, 1, 1, t * 0.6);
      break;
    }
    case "fade": {
      const a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 1.6));
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

// Bake size/opacity/tint into a still transparent PNG (used for static / marquee / shield).
function renderStaticLogoPNG() {
  const W = state.videoMeta.width;
  const logoW = Math.max(8, Math.round(W * (state.sizePct / 100)));
  const logoH = Math.round(logoW * (state.logoImg.naturalHeight / state.logoImg.naturalWidth));
  const c = document.createElement("canvas");
  c.width = logoW; c.height = logoH;
  const ctx = c.getContext("2d");
  ctx.globalAlpha = state.opacity;
  ctx.drawImage(state.logoImg, 0, 0, logoW, logoH);
  if (state.tintStrength > 0) {
    ctx.globalCompositeOperation = "source-atop";
    ctx.globalAlpha = state.opacity * state.tintStrength;
    ctx.fillStyle = state.tintColor;
    ctx.fillRect(0, 0, logoW, logoH);
  }
  return new Promise((resolve) => c.toBlob((b) => resolve({ blob: b, w: logoW, h: logoH }), "image/png"));
}

// Bake a short looping transparent WebM (VP9+alpha) for pulse / rotate / fade.
async function renderAnimatedLogoClip() {
  const W = state.videoMeta.width;
  const baseW = Math.max(8, Math.round(W * (state.sizePct / 100)));
  const baseH = Math.round(baseW * (state.logoImg.naturalHeight / state.logoImg.naturalWidth));
  const pad = Math.round(Math.max(baseW, baseH) * 0.25); // headroom for pulse/rotate
  const cw = baseW + pad * 2, ch = baseH + pad * 2;
  const canvas = document.createElement("canvas");
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext("2d", { alpha: true });

  const fps = 25, loopSeconds = 4;
  const stream = canvas.captureStream(fps);
  const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp9", videoBitsPerSecond: 4_000_000 });
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  const frameCount = fps * loopSeconds;
  let frame = 0;

  return new Promise((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: "video/webm" }));
    recorder.start();
    const drawNext = () => {
      const t = frame / fps;
      ctx.clearRect(0, 0, cw, ch);
      ctx.save();
      ctx.translate(cw / 2, ch / 2);
      let alpha = state.opacity, scale = 1, rot = 0;
      if (state.variant === "pulse") scale = 1 + 0.1 * Math.sin(t * 2 * Math.PI / loopSeconds * 2);
      if (state.variant === "rotate") rot = (t / loopSeconds) * Math.PI * 2;
      if (state.variant === "fade") alpha = state.opacity * (0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * 2 * Math.PI / loopSeconds)));
      ctx.rotate(rot);
      ctx.scale(scale, scale);
      ctx.globalAlpha = alpha;
      ctx.drawImage(state.logoImg, -baseW / 2, -baseH / 2, baseW, baseH);
      if (state.tintStrength > 0) {
        ctx.globalCompositeOperation = "source-atop";
        ctx.globalAlpha = alpha * state.tintStrength;
        ctx.fillStyle = state.tintColor;
        ctx.fillRect(-baseW / 2, -baseH / 2, baseW, baseH);
      }
      ctx.restore();
      frame++;
      if (frame < frameCount) {
        setTimeout(drawNext, 1000 / fps);
      } else {
        recorder.stop();
      }
    };
    drawNext();
  }).then((blob) => ({ blob, w: cw, h: ch }));
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
    const isAnimated = ["pulse", "rotate", "fade"].includes(state.variant);

    let overlayAsset, overlayInputArgs, filterComplex, outMap;

    if (isAnimated) {
      setProgress(5, "Baking animated logo layer…");
      overlayAsset = await renderAnimatedLogoClip();
      overlayInputArgs = ["-stream_loop", "-1", "-i", "overlay.webm"];
      const pos = positionXY(state.position, W, H, overlayAsset.w, overlayAsset.h, margin);
      filterComplex = `[0:v][1:v]overlay=x=${Math.round(pos.x)}:y=${Math.round(pos.y)}:shortest=1[outv]`;
    } else if (state.variant === "shield") {
      const asset = await renderStaticLogoPNG();
      overlayAsset = asset;
      overlayInputArgs = ["-loop", "1", "-i", "logo.png"];
      const cols = state.density, rows = state.density;
      const cellW = W / cols, cellH = H / rows;
      const parts = [];
      let cur = "0:v";
      let idx = 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const offset = (r % 2 === 1) ? cellW / 2 : 0;
          const x = Math.round(((c * cellW + offset) % W) - asset.w / 2 + cellW / 2 - asset.w / 2);
          const y = Math.round(r * cellH + cellH / 2 - asset.h / 2);
          const next = (idx === rows * cols - 1) ? "outv" : `t${idx}`;
          parts.push(`[${cur}][1:v]overlay=x=${x}:y=${y}${idx === rows * cols - 1 ? ":shortest=1" : ""}[${next}]`);
          cur = next;
          idx++;
        }
      }
      filterComplex = parts.join(";");
    } else if (state.variant === "marquee") {
      const asset = await renderStaticLogoPNG();
      overlayAsset = asset;
      overlayInputArgs = ["-loop", "1", "-i", "logo.png"];
      const pos = positionXY(state.position, W, H, asset.w, asset.h, margin);
      const span = W + asset.w;
      filterComplex = `[0:v][1:v]overlay=x='mod(t*${state.speed}\\,${span})-${asset.w}':y=${Math.round(pos.y)}:shortest=1[outv]`;
    } else {
      const asset = await renderStaticLogoPNG();
      overlayAsset = asset;
      overlayInputArgs = ["-loop", "1", "-i", "logo.png"];
      const pos = positionXY(state.position, W, H, asset.w, asset.h, margin);
      filterComplex = `[0:v][1:v]overlay=x=${Math.round(pos.x)}:y=${Math.round(pos.y)}:shortest=1[outv]`;
    }

    setProgress(15, "Loading render engine…");
    const ffmpeg = await loadFFmpeg((msg) => { /* console.debug(msg) */ });
    ffmpeg.on("progress", ({ progress }) => {
      setProgress(20 + Math.min(78, Math.round(progress * 78)), "Rendering with protected watermark…");
    });

    const inExt = (state.videoFile.name.split(".").pop() || "mp4").toLowerCase();
    const inName = "input." + inExt;
    await ffmpeg.writeFile(inName, new Uint8Array(await state.videoFile.arrayBuffer()));

    if (isAnimated) {
      await ffmpeg.writeFile("overlay.webm", new Uint8Array(await overlayAsset.blob.arrayBuffer()));
    } else {
      await ffmpeg.writeFile("logo.png", new Uint8Array(await overlayAsset.blob.arrayBuffer()));
    }

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

    setProgress(20, "Encoding…");
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
