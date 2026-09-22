// Pixel work, off the main thread.
//
// The main thread of the capture machine is already busy: it draws the panel, and on a
// single-machine setup it shares a core with OBS's compositor and encoder. Doing
// classify + connected-components there caps detection at whatever is left over, which
// on a large region is a handful of frames per second.
//
// This worker owns the whole pixel path instead. It is handed the MediaStreamTrack
// itself, so frames never cross to the main thread at all: they arrive here, become
// blob centroids, and only those few numbers are posted back.

import { ColorLUT, classify, blobs, MotionDetector, plausibleColors, hexToRgb } from './tracker.js';

const lut = new ColorLUT();
const motion = new MotionDetector();

let cfg = {
  rois: [],
  palette: [],
  tolerance: 70,
  minBlob: 6,
  step: 2,
  targetFps: 30,
  trackingMode: 'color',
  motionThreshold: 26,
  motionAlpha: 0.02,
  sourceW: 0,
  sourceH: 0
};

let paletteRgb = [];
let atlas = null;
let actx = null;
let slots = new Map();
let atlasSig = '';

let reader = null;
let running = false;
let lastTick = 0;
let frames = 0;
let fpsAt = 0;
let srcFrames = 0;      // everything the capture delivers, before our throttle
let srcAt = 0;
let sourceFps = 0;

self.onmessage = async (ev) => {
  const m = ev.data;
  if (m.type === 'config') {
    /*
     * Only throw the background plate away when the picture it describes has actually
     * changed shape. It used to be reset on every config message, and config is pushed
     * on every state update — several a second — so the plate never survived the eight
     * frames it needs to become usable and motion detection silently found nothing at
     * all. Thresholds and palettes do not invalidate a plate; geometry does.
     */
    const geometryBefore = JSON.stringify([cfg.rois, cfg.step]);
    cfg = { ...cfg, ...m.cfg };
    const geometryAfter = JSON.stringify([cfg.rois, cfg.step]);

    lut.build(cfg.palette, cfg.tolerance);
    paletteRgb = cfg.palette.map(hexToRgb);
    if (geometryBefore !== geometryAfter) {
      motion.reset();
      atlasSig = '';                     // regions or scale moved
    }
  } else if (m.type === 'start') {
    start(m.track);
  } else if (m.type === 'frame') {
    // The main thread could not hand over the track, so it hands over frames instead.
    // A VideoFrame is transferable everywhere WebCodecs is, and the reading side keeps
    // no pixel work for itself either way.
    countSource();
    const t = performance.now();
    try {
      if (t - lastTick >= 1000 / cfg.targetFps - 1) { lastTick = t; handle(m.frame, t); }
    } finally { m.frame.close(); }
  } else if (m.type === 'stop') {
    stop();
  }
};

function stop() {
  running = false;
  if (reader) {
    try { reader.cancel(); } catch { /* already gone */ }
    reader = null;
  }
}

async function start(track) {
  stop();
  if (!track) return;
  const processor = new self.MediaStreamTrackProcessor({ track });
  reader = processor.readable.getReader();
  running = true;
  fpsAt = performance.now();
  frames = 0;

  while (running) {
    let frame;
    try {
      const { value, done } = await reader.read();
      if (done) break;
      frame = value;
    } catch { break; }

    countSource();
    try {
      const now = performance.now();
      // Drop rather than queue: a late frame is worthless for timing, and a backlog
      // would make every later crossing timestamp progressively more wrong.
      if (now - lastTick >= 1000 / cfg.targetFps - 1) {
        lastTick = now;
        handle(frame, now);
      }
    } finally {
      frame.close();
    }
  }
  try { reader && reader.releaseLock(); } catch { /* stream closed */ }
}

/** How many frames the capture is really producing, whatever we do with them. */
function countSource() {
  srcFrames++;
  const now = performance.now();
  if (!srcAt) { srcAt = now; return; }
  if (now - srcAt <= 1000) return;
  sourceFps = Math.round((srcFrames * 1000) / (now - srcAt));
  srcFrames = 0;
  srcAt = now;
}

/** Pack the calibrated regions into one canvas, one row each. */
function layoutAtlas(w, h) {
  const sig = cfg.rois.map((r) => `${r.id}:${r.x},${r.y},${r.w},${r.h}`).join('|') + `@${cfg.step}@${w}x${h}`;
  if (sig === atlasSig) return;
  atlasSig = sig;
  slots = new Map();

  const scale = 1 / Math.max(1, cfg.step);
  let y = 0, maxW = 1;
  for (const r of cfg.rois) {
    const sw = Math.max(1, Math.round(r.w * w * scale));
    const sh = Math.max(1, Math.round(r.h * h * scale));
    slots.set(r.id, { x: 0, y, w: sw, h: sh });
    y += sh;
    maxW = Math.max(maxW, sw);
  }

  if (!atlas) atlas = new OffscreenCanvas(maxW, Math.max(1, y));
  atlas.width = maxW;
  atlas.height = Math.max(1, y);
  actx = atlas.getContext('2d', { willReadFrequently: true });
  actx.imageSmoothingEnabled = false;   // nearest neighbour keeps colours pure
}

function handle(frame, now) {
  const w = frame.displayWidth || frame.codedWidth;
  const h = frame.displayHeight || frame.codedHeight;
  if (!w || !h || !cfg.rois.length || !cfg.palette.length) return;

  layoutAtlas(w, h);

  let copied = 0;
  for (const r of cfg.rois) {
    const slot = slots.get(r.id);
    if (!slot) continue;
    const sx = Math.max(0, Math.min(w - 1, Math.round(r.x * w)));
    const sy = Math.max(0, Math.min(h - 1, Math.round(r.y * h)));
    const sw = Math.max(1, Math.min(w - sx, Math.round(r.w * w)));
    const sh = Math.max(1, Math.min(h - sy, Math.round(r.h * h)));
    try {
      actx.drawImage(frame, sx, sy, sw, sh, slot.x, slot.y, slot.w, slot.h);
      copied += slot.w * slot.h;
    } catch { /* frame went away */ }
  }

  const out = [];
  let seq = 0;                 // names each physical blob, so one blob offered to
                               // several cars is still claimed only once
  let unnamed = 0;             // moving blobs whose colour matched nobody
  for (const r of cfg.rois) {
    const slot = slots.get(r.id);
    if (!slot) continue;
    const img = actx.getImageData(slot.x, slot.y, slot.w, slot.h);
    const minArea = Math.max(2, Math.round(cfg.minBlob / (cfg.step ** 2)));

    // Every blob, offered to every car it could be — see the note in vision.js.
    const byColor = () => {
      const res = [];
      for (const b of blobs(classify(img, lut, 1), minArea, true, img).list) {
        const key = 'c' + (seq++);
        for (const d of plausibleColors(b.color, paletteRgb, cfg.tolerance)) {
          res.push({ driver: d, x: b.x, y: b.y, n: b.n, key, moving: false });
        }
      }
      return res;
    };
    const byMotion = () => {
      const m = motion.detect(img, {
        alpha: cfg.motionAlpha,
        threshold: cfg.motionThreshold,
        minArea
      });
      const res = [];
      for (const b of m.list) {
        const key = 'm' + (seq++);
        // -1 travels back to the main thread, where the tracker can name it from
        // continuity; dropping it here would throw that chance away.
        //
        // Colour is checked even for a single registered driver: a lone palette entry
        // does not mean a lone moving object, and skipping the test made every moving
        // thing in frame report as that driver.
        //
        // Same strictness as the colour search — see the note in vision.js. A separate,
        // looser limit here meant tightening the tolerance never cleaned up motion.
        const who = plausibleColors(b.color, paletteRgb, cfg.tolerance);
        if (!who.length) { unnamed++; continue; }
        for (const d of who) res.push({ driver: d, x: b.x, y: b.y, n: b.n, key, moving: true });
      }
      return res;
    };

    let list;
    if (cfg.trackingMode === 'motion') list = byMotion();
    else if (cfg.trackingMode === 'hybrid') {
      list = byColor().concat(byMotion());
    } else list = byColor();

    for (const b of list) {
      out.push({ roiId: r.id, driver: b.driver, x: b.x, y: b.y, n: b.n, key: b.key, moving: !!b.moving });
    }
  }

  // the frame-transfer path never calls start(), so seed the window on first use
  if (!fpsAt) fpsAt = now;
  frames++;
  let fps = 0;
  if (now - fpsAt > 1000) {
    fps = Math.round((frames * 1000) / (now - fpsAt));
    frames = 0;
    fpsAt = now;
  }

  self.postMessage({ type: 'blobs', list: out, at: Date.now(), pixels: copied, fps, sourceFps, w, h, unnamed });
}
