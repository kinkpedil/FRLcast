// Detection engine: turns pixels from the emulator window into race events.
//
// Three independent detectors run over operator-calibrated regions of interest:
//   1. minimap   -> per-driver colour blob tracking + progress along the track path
//                   => automatic positions AND automatic lap counting (no HUD needed)
//   2. trigger   -> normalised cross-correlation against a captured reference patch
//                   => "car crossed the finish line" / "checkered flag shown"
//   3. ocr_*     -> Tesseract on an upscaled, thresholded crop of a HUD number
//                   => lap counter, lap time, position, speed read straight off the HUD
//
// Anything a detector produces is a *suggestion*: it is debounced here, then applied
// to the authoritative race state on the server.

import {
  ColorLUT, classify, blobs, Tracker, buildPath, projectOnPath,
  MotionDetector, SceneryFilter, plausibleColors, hexToRgb
} from './tracker.js';
import { PathLearner, ParticleTracker } from './pathtrack.js';

export { buildPath, projectOnPath } from './tracker.js';

const NCC_SIZE = 40;          // reference patches are compared at 40x40 grayscale
const OCR_INTERVAL_MS = 320;  // OCR is expensive; the cheap detectors run every frame

export const ROI_TYPES = {
  minimap: { label: 'Minimap (auto position + laps)', color: '#00e0a4' },
  trigger: { label: 'Trigger zone (finish line)', color: '#ff375f' },
  ocr_lap: { label: 'OCR — lap counter', color: '#0a84ff' },
  ocr_time: { label: 'OCR — lap time', color: '#bf5af2' },
  ocr_position: { label: 'OCR — position', color: '#ffd60a' },
  ocr_speed: { label: 'OCR — speed', color: '#ff9f0a' },
  ocr_name: { label: 'OCR — driver name', color: '#64d2ff' },
  ocr_leaderboard: { label: 'OCR leaderboard (rank/name/best/laps)', color: '#30d1c8' },
  pitzone: { label: 'Pit lane zone', color: '#ffd60a' },
  detect: { label: 'Model zone (ONNX detector)', color: '#30d158' }
};

/** What each drawing tool is for, shown next to the tool picker in the panel. */
export const ROI_HELP = {
  minimap: {
    what: 'The rectangle containing the in-game minimap.',
    how: 'Drag it tight around the minimap. Every car is found inside this box by its colour, so keep HUD elements of similar colour outside it.',
    gives: 'Live position of every car, which feeds lap counting, sector splits, the running order and the track map overlay.'
  },
  finish: {
    what: 'The start/finish line, drawn as a line across the track on the minimap.',
    how: 'Click once on each side of the track, across the racing direction. An arrow shows which way counts — click Flip if it points the wrong way.',
    gives: 'A lap for whichever car crosses it. The exact moment is interpolated between two frames, so timing is finer than your capture frame rate.'
  },
  sector: {
    what: 'A split point. Two sector lines plus the finish line give three sectors.',
    how: 'Draw them in racing order around the lap. They are numbered automatically.',
    gives: 'Per-sector times, personal bests, and session-best (purple) splits on the timing tower.'
  },
  trigger: {
    what: 'A patch of screen compared against a reference image every frame.',
    how: 'Draw it over something that appears consistently — a finish banner, a lap counter flashing. Then press Capture ref while it is on screen.',
    gives: 'A lap event with no minimap needed. Use it when the mode you race has no minimap.'
  },
  pitzone: {
    what: 'The area of the minimap that is pit lane.',
    how: 'Drag a box over the pit lane branch.',
    gives: 'Automatic PIT flag and pit-stop count whenever a tracked car sits inside it.'
  },
  ocr_lap: { what: 'The on-screen lap counter.', how: 'Box the digits only, no background.', gives: 'A lap when the number increments. Backup for when the minimap is unavailable.' },
  ocr_time: { what: 'The on-screen lap time.', how: 'Box the digits only.', gives: 'Reads the game’s own lap time so it can be compared against ours.' },
  ocr_position: { what: 'The on-screen position indicator.', how: 'Box the digits only.', gives: 'A cross-check on the computed running order.' },
  ocr_speed: { what: 'The speedometer.', how: 'Box the digits only.', gives: 'Live speed for the lower third.' },
  ocr_name: { what: 'The driver name shown by the spectator camera.', how: 'Box the name text.', gives: 'Automatically switches the focus driver as the camera changes car.' },
  ocr_leaderboard: { what: 'The in-race leaderboard panel (rank, name, best lap, laps for every driver).', how: 'Box the whole table, from the first driver row to the last. Keep the RANK/NAME/BEST LAP/LAPS header outside the box if you can. Works best while the standings are on screen.', gives: 'Position, lap count and best lap for the whole field at once, and a lap for any driver whose lap count goes up. The one automatic source when the game shows no per-car lap HUD.' },
  detect: { what: 'Region handed to your trained ONNX model.', how: 'Draw it over the gameplay view, then load a model on this page.', gives: 'Object boxes for cars and track features when colour tracking is not enough.' }
};

const WHITELIST = {
  ocr_lap: '0123456789/LAP',
  ocr_time: "0123456789:.'",
  ocr_position: '0123456789PSTNRDHstndrh',
  ocr_speed: '0123456789',
  ocr_name: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_- ',
  // The leaderboard mixes names, times and lap counts, so allow letters, digits and the
  // punctuation a lap time and a car number use.
  ocr_leaderboard: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789:.#_- "
};

/**
 * Parse the leaderboard OCR block into rows.
 *
 * Each on-screen row is "rank name best-lap laps", e.g. "2 Budi Ottoman #24 1:46.400 2".
 * A line only counts as a row if it carries a lap time, which filters out the header and any
 * stray HUD text the box caught. Robust to the middle name being missing or noisy: the time
 * and the numbers around it are the anchors.
 */
export function parseLeaderboard(text) {
  const rows = [];
  for (const raw of String(text || '').split(/\n+/)) {
    const line = raw.trim();
    if (!line) continue;
    const tm = line.match(/(\d{1,2}:\d{2}\.\d{3})/);
    if (!tm) continue;
    const rankM = line.match(/^\D*(\d{1,2})\b/);
    const rank = rankM ? Number(rankM[1]) : null;
    const bestMs = (() => { const m = tm[1].match(/(\d{1,2}):(\d{2})\.(\d{3})/); return m ? (+m[1]) * 60000 + (+m[2]) * 1000 + (+m[3]) : null; })();
    const after = line.slice(line.indexOf(tm[1]) + tm[1].length);
    const lapsM = after.match(/(\d{1,3})/);
    const laps = lapsM ? Number(lapsM[1]) : null;
    let name = line.slice(rankM ? rankM[0].length : 0, line.indexOf(tm[1])).trim();
    const numM = name.match(/#\s*(\d+)/);
    const num = numM ? numM[1] : '';
    name = name.replace(/#\s*\d+/, '').replace(/[|]/g, '').trim();
    rows.push({ rank, name, num, bestMs, laps });
  }
  return rows;
}

export function parseTimeString(str) {
  if (!str) return null;
  const s = String(str).replace(/[^\d:.']/g, '').replace(/'/g, ':');
  let m = s.match(/^(\d{1,2}):(\d{1,2})[.:](\d{1,3})$/);
  if (m) return (+m[1]) * 60000 + (+m[2]) * 1000 + Number(m[3].padEnd(3, '0'));
  m = s.match(/^(\d{1,3})[.:](\d{1,3})$/);
  if (m) return (+m[1]) * 1000 + Number(m[2].padEnd(3, '0'));
  return null;
}

function toGray(imageData, size = NCC_SIZE) {
  // box-downsample to size x size, mean-centred grayscale
  const { width: w, height: h, data } = imageData;
  const out = new Float32Array(size * size);
  const cellW = w / size;
  const cellH = h / size;
  for (let gy = 0; gy < size; gy++) {
    for (let gx = 0; gx < size; gx++) {
      const x0 = Math.floor(gx * cellW), x1 = Math.max(x0 + 1, Math.floor((gx + 1) * cellW));
      const y0 = Math.floor(gy * cellH), y1 = Math.max(y0 + 1, Math.floor((gy + 1) * cellH));
      let sum = 0, n = 0;
      for (let y = y0; y < y1 && y < h; y++) {
        for (let x = x0; x < x1 && x < w; x++) {
          const i = (y * w + x) * 4;
          sum += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
          n++;
        }
      }
      out[gy * size + gx] = n ? sum / n : 0;
    }
  }
  return out;
}

function ncc(a, b) {
  let ma = 0, mb = 0;
  for (let i = 0; i < a.length; i++) { ma += a[i]; mb += b[i]; }
  ma /= a.length; mb /= b.length;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  const den = Math.sqrt(da * db);
  return den < 1e-6 ? 0 : num / den;
}

export class VisionEngine {
  constructor(capture, bus) {
    this.capture = capture;
    this.bus = bus;
    this.running = false;
    this.fps = 0;
    this.targetFps = 10;      // low-spec default; raise with the Performance presets
    this.ocrWorker = null;
    this.ocrBusy = false;
    this.lastOcrAt = 0;
    this.ocrResults = {};        // roiId -> { text, conf, at }
    this.triggerState = {};      // roiId -> { armed, lastFireAt, score }
    this.blobState = {};         // driverId -> { progress, lastProgress, lost, lap }
    this.debug = { blobs: [], scores: {}, unnamed: 0 };
    this.pendingTelemetry = {};
    this.lastProgressFlush = 0;
    this.lut = new ColorLUT();
    this.motion = new MotionDetector();
    this.scenery = new SceneryFilter();
    this.tracker = new Tracker();
    // Learned circuit geometry, and the estimator that uses it. Until a lap has been
    // driven there is nothing to learn from, so the plane tracker above carries the
    // session on its own and hands over once the shape is known.
    this.learner = new PathLearner();
    this.pathTracker = new ParticleTracker();
    this.usingPath = false;
    this.pitState = {};          // driverId -> consecutive frames inside the pit box
    this.offTrack = {};          // driverId -> consecutive frames outside the circuit
    this.jumped = {};            // driverId -> already reported a jump start this session
    this.settings = {
      // color  — match each pixel against the roster colours. Needs the car to be
      //          big enough that its colour survives rendering and downscaling.
      // motion — find what departs from a running plate of the static circuit. Reaches
      //          cars of three or four pixels that colour matching cannot see at all.
      // hybrid — colour first, motion fills in whoever it missed.
      trackingMode: 'color',
      motionThreshold: 26,
      motionAlpha: 0.02,
      colorTolerance: 70,
      // how far from its predicted position a car may be seen, as a fraction of the
      // region, and how much its blob may change size between frames
      gateRadius: 0.12,
      gateSizeRatio: 3,
      // How far off the learned centreline still counts as on the road. The circuit is
      // learned from one car's line, so this has to allow for the width of the track
      // either side of it plus however untidily that lap was driven.
      trackWidth: 0.06,
      stopSpeed: 0.004,
      // Track cars along the learned circuit rather than freely on the plane.
      pathTracking: true,
      minBlobPixels: 6,
      sampleStep: 3,             // copy every 3rd pixel: 9x fewer, accuracy unchanged
      maxMissedMs: 900,          // how long a track coasts on velocity when unseen
      stopSeconds: 4,            // stationary for this long => STOPPED ON TRACK
      triggerThreshold: 0.82,
      triggerCooldownMs: 6000,
      minLapMs: 8000,
      minSplitMs: 1500,
      lapFromLines: true,        // preferred: geometric line crossings
      lapFromMinimap: false,     // fallback: progress wrap, when no finish line drawn
      lapFromTrigger: true,
      lapFromOcr: false,
      pathDirection: 1
    };
    this.mode = 'idle';
    this.health = 'ok';
    this.sourceFps = 0;
    this.srcFrames = 0;
    this.srcAt = 0;
    this.worker = null;
    this.workerCfgSig = '';
    this.workerTrack = null;
    this.workerFeed = null;
    this.useWorker = true;      // the fast path; falls back on its own if unavailable
    this.frames = 0;
    this.fpsAt = 0;
    this.lastTick = 0;
    this.onFrame = () => {};
    this.onEvent = () => {};
  }

  get state() { return this.bus.state; }

  // ---------- OCR worker ----------

  /**
   * The OCR engine, fetched only if a region actually asks for it.
   *
   * The local broadcast server serves it from /vendor; the hosted site does not, so fall back
   * to a CDN. Without the fallback the hosted console failed with "could not load the OCR
   * engine" the moment a leaderboard/OCR region started.
   */
  async loadTesseract() {
    if (window.Tesseract) return;
    if (!this.tesseractLoading) {
      const sources = [
        '/vendor/tesseract/tesseract.min.js',
        'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js'
      ];
      const tryLoad = (src) => new Promise((resolve, reject) => {
        const el = document.createElement('script');
        el.src = src;
        el.onload = resolve;
        el.onerror = () => reject(new Error('failed: ' + src));
        document.head.appendChild(el);
      });
      this.tesseractLoading = (async () => {
        let lastErr;
        for (const src of sources) {
          try { await tryLoad(src); if (window.Tesseract) { this.tesseractSource = src; return; } } catch (e) { lastErr = e; }
        }
        throw new Error('could not load the OCR engine');
      })();
    }
    return this.tesseractLoading;
  }

  async ensureOcr() {
    if (this.ocrWorker) return this.ocrWorker;
    if (this.ocrCreating) return this.ocrCreating;   // one creation at a time (it can take ~15s)
    // Tell the operator this is happening: the first worker downloads a few MB of engine +
    // language data from the CDN and can take 10-20s, during which OCR looks dead. A status
    // line makes the wait legible instead of a silent gap.
    this.onEvent({ type: 'ocr-status', state: 'loading', message: 'Loading OCR engine (first run downloads a few MB)…' });
    this.ocrCreating = (async () => {
      await this.loadTesseract();
      if (!window.Tesseract) throw new Error('Tesseract not loaded');
      const localOpts = { workerPath: '/vendor/tesseract/worker.min.js', corePath: '/vendor/tesseract-core', langPath: '/vendor/tessdata' };
      // If the engine script itself came from the CDN, the local /vendor copy is not being
      // served (hosted site) — go straight to the library defaults and skip the vendor attempt
      // that would only 404 and spew a console error. Local server: try vendor first (offline).
      const fromCdn = (this.tesseractSource || '').startsWith('http');
      const opts = fromCdn ? [{}, localOpts] : [localOpts, {}];
      let lastErr;
      for (const o of opts) {
        try {
          const w = await window.Tesseract.createWorker('eng', 1, o);
          this.ocrWorker = w;
          this.onEvent({ type: 'ocr-status', state: 'ready', message: 'OCR engine ready' });
          return w;
        } catch (err) { lastErr = err; }
      }
      this.onEvent({ type: 'ocr-status', state: 'error', message: 'OCR engine failed to load: ' + (lastErr && lastErr.message || lastErr) });
      throw lastErr;
    })().finally(() => { this.ocrCreating = null; });
    return this.ocrCreating;
  }

  /**
   * Can the whole pixel path move off this thread?
   *
   * Only when nothing else needs pixels here: OCR and trigger zones both read the
   * main-thread atlas, and quietly breaking them to gain frame rate would be a bad
   * trade the operator never agreed to.
   */
  get canUseWorker() {
    const needsMainThreadPixels = this.rois().some(
      (r) => r.type.startsWith('ocr_') || (r.type === 'trigger' && r.ref)
    );
    return typeof Worker === 'function'
      && typeof OffscreenCanvas === 'function'
      && typeof window.MediaStreamTrackProcessor === 'function'
      && !!this.capture.stream
      && !needsMainThreadPixels;
  }

  startWorker() {
    const source = this.capture.stream.getVideoTracks()[0];
    if (!source) return false;
    // A transferred track is detached from this thread, which would stop the <video>
    // and with it every preview. Hand the worker a clone instead.
    let track;
    try {
      track = source.clone();
    } catch {
      return false;
    }

    this.worker = new Worker('/js/vision-worker.js', { type: 'module' });
    this.worker.onmessage = (ev) => {
      const m = ev.data;
      if (m.type !== 'blobs') return;
      const roi = this.rois('minimap')[0];
      this.debug.blobs = [];
      this.debug.unnamed = m.unnamed || 0;
      if (m.pixels != null) this.capture.copiedPixels = m.pixels;
      if (m.sourceFps != null) this.sourceFps = m.sourceFps;
      if (m.fps) {
        this.fps = m.fps;
        this.health = m.fps >= this.targetFps * 0.6 ? 'ok' : (document.hidden ? 'throttled' : 'slow');
        this.bus.action('vision.status', {
          patch: {
            fps: this.fps, health: this.health, hidden: document.hidden,
            mode: 'worker', pixels: m.pixels, sourceFps: this.sourceFps,
            estimator: this.usingPath ? 'path' : 'plane',
            circuit: this.learner.path ? this.learner.path.segs.length : 0
          }
        });
      }
      if (roi) {
        this.applyBlobs(roi, m.list.filter((b) => b.roiId === roi.id), m.at);
      }
      this.onFrame(this.debug);
    };

    this.workerTrack = track;
    this.pushWorkerConfig();

    // Best case the whole track moves across and this thread never sees a frame.
    // Not every build allows that, so fall back to shipping the frames themselves —
    // still no pixel work here, just a read and a transfer.
    try {
      this.worker.postMessage({ type: 'start', track }, [track]);
      this.workerFeed = 'track';
    } catch {
      try { track.stop(); } catch { /* nothing to stop */ }
      this.workerTrack = null;
      this.workerFeed = 'frames';
      this.capture.streamFrames((frame) => {
        if (!this.running || !this.worker) return false;
        const now = performance.now();
        if (now - this.lastTick < 1000 / this.targetFps - 1) return false;   // drop, do not queue
        this.lastTick = now;
        this.worker.postMessage({ type: 'frame', frame }, [frame]);
        return true;                                                        // worker owns it now
      });
    }
    return true;
  }

  pushWorkerConfig() {
    if (!this.worker) return;
    // called on every state update, so say nothing when nothing changed
    const st = this.state;
    const active = (st ? st.drivers : []).filter((d) => !d.dnf);
    const cfg = {
        rois: this.activeRois().map((r) => ({ id: r.id, x: r.x, y: r.y, w: r.w, h: r.h })),
        palette: active.map((d) => d.color),
        tolerance: this.settings.colorTolerance,
        minBlob: this.settings.minBlobPixels,
        step: this.settings.sampleStep,
        targetFps: this.targetFps,
        trackingMode: this.settings.trackingMode,
        motionThreshold: this.settings.motionThreshold,
        motionAlpha: this.settings.motionAlpha
    };
    const sig = JSON.stringify(cfg);
    if (sig === this.workerCfgSig) return;
    this.workerCfgSig = sig;
    this.worker.postMessage({ type: 'config', cfg });
  }

  stopWorker() {
    if (!this.worker) return;
    this.worker.postMessage({ type: 'stop' });
    this.worker.terminate();
    this.worker = null;
    if (this.workerFeed === 'frames') this.capture.stopFrames();
    this.workerFeed = null;
    if (this.workerTrack) {
      try { this.workerTrack.stop(); } catch { /* already stopped */ }
      this.workerTrack = null;
    }
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.blobState = {};
    this.triggerState = {};
    this.pitState = {};
    this.offTrack = {};
    this.jumped = {};
    this.tracker.reset();
    this.motion.reset();
    this.frames = 0;
    this.fpsAt = performance.now();
    this.lastTick = 0;

    // Prefer the frame-driven path: frames are delivered as the capture pipeline
    // produces them, so detection does not depend on a timer the browser is free to
    // throttle once this tab is in the background.
    if (this.useWorker && this.canUseWorker && this.startWorker()) {
      this.mode = 'worker';
    } else if (this.capture.canStreamFrames) {
      this.mode = 'frames';
      this.capture.streamFrames((frame) => this.onCaptureFrame(frame));
    } else {
      this.mode = 'timer';
      this.loop();
    }
    this.bus.action('vision.status', { patch: { active: true, mode: this.mode } });
  }

  stop() {
    this.running = false;
    this.stopWorker();
    this.capture.stopFrames();
    this.bus.action('vision.status', { patch: { active: false, fps: 0, mode: 'idle' } });
  }

  /** One delivered frame, throttled down to the configured detection rate. */
  onCaptureFrame(frame) {
    if (!this.running) return;
    this.countSourceFrame();
    const now = performance.now();
    if (now - this.lastTick < 1000 / this.targetFps - 1) return;   // drop, do not queue
    this.lastTick = now;
    if (!this.capture.useFrame(frame)) return;
    try {
      this.tickCheap();
      this.tickOcr();
    } catch (err) {
      console.error('[vision]', err);
    }
    this.countFrame(now);
    this.onFrame(this.debug);
  }

  /**
   * Frames the capture actually hands over, before our own rate limiting.
   *
   * Without this there is no way to tell "the detector is too slow" from "the source
   * is only producing two frames a second" — and those have completely different
   * fixes. Windows does not paint a window nobody can see, so an occluded or
   * minimised game window starves the capture no matter how fast the detector is.
   */
  countSourceFrame() {
    this.srcFrames = (this.srcFrames || 0) + 1;
    const now = performance.now();
    if (!this.srcAt) { this.srcAt = now; return; }
    if (now - this.srcAt <= 1000) return;
    this.sourceFps = Math.round((this.srcFrames * 1000) / (now - this.srcAt));
    this.srcFrames = 0;
    this.srcAt = now;
    this.bus.action('vision.status', { patch: { sourceFps: this.sourceFps } });
  }

  /** Achieved rate, and whether the browser is starving us. */
  countFrame(now) {
    this.frames++;
    if (now - this.fpsAt <= 1000) return;
    this.fps = Math.round((this.frames * 1000) / (now - this.fpsAt));
    this.frames = 0;
    this.fpsAt = now;
    const health = this.fps >= this.targetFps * 0.6 ? 'ok'
      : document.hidden ? 'throttled' : 'slow';
    if (health !== this.health) {
      this.health = health;
      if (health !== 'ok') {
        this.bus.action('vision.log', { entry: { kind: 'health', source: health } });
      }
    }
    this.bus.action('vision.status', {
      patch: {
        fps: this.fps, health, hidden: document.hidden, mode: this.mode,
        pixels: this.capture.copiedPixels || 0,
        estimator: this.usingPath ? 'path' : 'plane',
        circuit: this.learner.path ? this.learner.path.segs.length : 0
      }
    });
  }

  async loop() {
    let last = performance.now();
    this.fpsAt = last;
    this.frames = 0;

    while (this.running) {
      const t0 = performance.now();
      if (this.capture.grab()) {
        try {
          this.tickCheap();
          await this.tickOcr();
        } catch (err) {
          console.error('[vision]', err);
        }
      }
      this.countFrame(t0);
      this.onFrame(this.debug);
      const budget = 1000 / this.targetFps;
      const spent = performance.now() - t0;
      await new Promise((r) => setTimeout(r, Math.max(4, budget - spent)));
      last = t0;
    }
  }

  rois(type) {
    const list = this.state?.calibration?.rois || [];
    return type ? list.filter((r) => r.type === type) : list;
  }

  // ---------- per-frame detectors ----------

  /** Regions the detectors will read this tick — everything else is never copied. */
  /**
   * Regions whose pixels are actually read this frame.
   *
   * Not every region is an image region. A pit zone is pure geometry — it asks
   * whether a tracked point is inside a rectangle — and a trigger without a captured
   * reference has nothing to compare against. Copying those was buying nothing and
   * costing a full-frame read every tick.
   */
  activeRois() {
    return this.rois().filter((r) => {
      if (r.type === 'minimap') return true;
      if (r.type === 'trigger') return !!r.ref;
      return r.type.startsWith('ocr_');
    });
  }

  tickCheap() {
    this.debug.blobs = [];
    this.debug.unnamed = 0;
    // one small copy per calibrated region instead of one copy of the whole frame
    this.capture.grabRegions(this.activeRois(), 1 / Math.max(1, this.settings.sampleStep));
    const roi = this.rois('minimap')[0];
    if (roi) this.trackCars(roi);
    for (const t of this.rois('trigger')) this.detectTrigger(t);
  }

  lines() {
    return (this.state && this.state.calibration.lines) || [];
  }

  /**
   * The whole car-tracking pass: classify -> blobs -> tracker -> timing lines.
   * Cost is independent of how many cars are on track, because the per-pixel work
   * is a single lookup and the component pass visits each pixel once.
   */
  trackCars(roi) {
    const st = this.state;
    if (!st || !st.drivers.length) return;
    const active = st.drivers.filter((d) => !d.dnf);
    if (!active.length) return;

    this.lut.build(active.map((d) => d.color), this.settings.colorTolerance);

    const img = this.capture.imageData(roi);
    const list = this.findCars(img, active);
    this.applyBlobs(roi, list.map((b) => ({ ...b, roiId: roi.id })), Date.now());
  }

  /** Blobs for this frame, by whichever method the operator chose. */
  findCars(img, active) {
    const s = this.settings;
    const palette = active.map((d) => hexToRgb(d.color));
    const minArea = Math.max(2, Math.round(s.minBlobPixels / (s.sampleStep ** 2)));

    /*
     * Every blob, offered to every car whose colour it could be.
     *
     * Two decisions live here, and both were once made the other way round with
     * measurable cost. Keeping only the biggest blob per colour hands the tracker a
     * kerb instead of the car whenever the kerb is larger, which it usually is. And
     * naming each blob after its single closest colour means that when two cars are
     * painted almost alike, one of them is offered every blob and the other is offered
     * none — invisible, however good the tracking is. The tracker claims each physical
     * blob once, so offering it several times is safe.
     */
    let seq = 0;
    const byColor = () => {
      const out = [];
      for (const b of blobs(classify(img, this.lut, 1), minArea, true, img).list) {
        const key = 'c' + (seq++);
        for (const d of plausibleColors(b.color, palette, s.colorTolerance)) {
          out.push({ driver: d, x: b.x, y: b.y, n: b.n, key, moving: false });
        }
      }
      return out;
    };

    const byMotion = () => {
      const m = this.motion.detect(img, {
        alpha: s.motionAlpha,
        threshold: s.motionThreshold,
        minArea
      });
      const out = [];
      for (const b of m.list) {
        const key = 'm' + (seq++);
        // -1 means "something moved here but its colour does not say who". Those used
        // to be discarded; they are now handed to the tracker, which can often name
        // them from where the car was a frame ago.
        //
        // Colour is checked even when only one driver is registered. Skipping it there
        // seemed harmless — with one car, what else could be moving? — but everything
        // else in frame moves too: scenery scrolling past, other cars, the HUD. Without
        // the colour test every one of them was reported as that driver.
        //
        // Judged at the same strictness as the colour search. This used to have its own
        // hardcoded limit, three times looser, so the operator could tighten the
        // tolerance until the colour path was clean and motion would still name asphalt
        // as the blue car and light grey as the yellow one.
        const who = plausibleColors(b.color, palette, s.colorTolerance);
        if (!who.length) { this.debug.unnamed++; continue; }
        for (const d of who) out.push({ driver: d, x: b.x, y: b.y, n: b.n, key, moving: true });
      }
      return out;
    };

    if (s.trackingMode === 'motion') return byMotion();
    if (s.trackingMode !== 'hybrid') return byColor();

    // hybrid: both searches report, and the tracker picks between them on position.
    // Filtering motion down to "drivers colour missed" was hiding the better candidate
    // whenever colour had found the wrong thing rather than nothing.
    return byColor().concat(byMotion());
  }

  /**
   * Record the shape of the circuit from a car driving round it.
   *
   * One car is followed for as long as it stays confident, because a trail stitched from
   * several cars at different points of the lap is not a circuit. When the trail closes,
   * the geometry is published so the track map overlay has something to draw even though
   * nobody traced it by hand.
   */
  learnCircuit(tracks, ids) {
    // The operator clearing the circuit is how a re-learn is asked for. The engine holds
    // the geometry in memory, so it has to notice the server's copy going away or it
    // would keep using a shape nobody can see any more.
    const stored = (this.state && this.state.calibration.learnedPath) || [];
    if (this.learner.path && !stored.length) {
      this.learner.reset();
      this.pathTracker.reset();
      this.usingPath = false;
    }
    if (this.learner.path) return;
    let src = this.learner.owner ? tracks.get(this.learner.owner) : null;
    if (!src || src.lost) {
      src = null;
      for (const id of ids) {
        const t = tracks.get(id);
        if (t && !t.lost && t.everMoved && (!src || (t.area || 0) > (src.area || 0))) src = t;
      }
    }
    if (!src || src.lost) return;
    const path = this.learner.feed(src.id, src.x, src.y);
    if (!path) return;
    this.bus.action('calibration.set', {
      patch: { learnedPath: path.pts.map((p) => ({ x: +p.x.toFixed(4), y: +p.y.toFixed(4) })) }
    });
  }

  /**
   * Everything after the pixels: match blobs to cars, run the tracker, test the timing
   * lines. Cheap enough to stay on the main thread, and shared by both the in-thread
   * detector and the worker.
   */
  applyBlobs(roi, list, now) {
    const st = this.state;
    if (!st) return;
    const active = st.drivers.filter((d) => !d.dnf);
    if (!active.length) return;

    // Which of these blobs are part of the circuit rather than cars. Judged here, on
    // the main thread, so it applies equally to blobs computed in the worker.
    this.scenery.mark(list);

    // blob coordinates are region-local; timing lines live in frame coordinates
    const sightings = new Map();
    const offer = (id, s) => {
      const cur = sightings.get(id);
      if (cur) cur.push(s); else sightings.set(id, [s]);
    };
    for (const b of list) {
      // driver < 0 means the colour was too ambiguous to name this blob. Measured:
      // guessing an owner for it by nearest track made timing worse, not better —
      // a merged two-car blob sits between both, so the guess moves a car across a
      // line at the wrong moment. Coasting on the last known velocity is better.
      if (b.driver < 0) continue;
      const d = active[b.driver];
      if (!d) continue;
      const fx = roi.x + b.x * roi.w;
      const fy = roi.y + b.y * roi.h;
      offer(d.id, { x: fx, y: fy, n: b.n, key: b.key, moving: !!b.moving, scenery: !!b.scenery });
      this.debug.blobs.push({ driverId: d.id, color: d.color, roiId: roi.id, x: b.x, y: b.y, n: b.n });
    }

    const ids = active.map((d) => d.id);
    const opts = {
      maxMissedMs: this.settings.maxMissedMs,
      stopMs: this.settings.stopSeconds * 1000,
      gateRadius: this.settings.gateRadius,
      gateSizeRatio: this.settings.gateSizeRatio
    };

    // The plane tracker always runs: it is the fallback, and it is what draws the
    // circuit in the first place.
    const planeTracks = this.tracker.update(ids, sightings, now, opts);
    this.learnCircuit(planeTracks, ids);

    /*
     * Two estimators, and they are deliberately not given the same job.
     *
     * The particle filter is the better judge of *which car is which*: it carries
     * several explanations at once, so a car hidden behind another or sharing a colour
     * with one is far less likely to have its identity handed away. Measured at three
     * frames a second — where this system actually runs — it cuts identity swaps from
     * 53% to 27%.
     *
     * But it is a sampled estimator, so it is not exactly repeatable, and once in every
     * few sessions it would anchor to a neighbouring blob on the very frame a car
     * crosses a timing line. A lap time 250ms out is worse than any tracking gain is
     * worth, and a stopwatch that is not repeatable is not a stopwatch. So the timing
     * lines are read from the plane tracker, which is deterministic and measured at
     * 0-5ms, and the filter is used for position, running order and the pins.
     */
    let tracks = planeTracks;
    if (this.settings.pathTracking !== false && this.learner.path) {
      this.pathTracker.setPath(this.learner.path);
      const pathTracks = this.pathTracker.update(ids, sightings, now, opts);
      // Only take over once it actually holds the field; otherwise the session would be
      // handed to an estimator that has not converged.
      let held = 0;
      for (const id of ids) { const t = pathTracks.get(id); if (t && !t.lost) held++; }
      this.usingPath = held >= Math.max(1, Math.ceil(ids.length * 0.5));
      if (this.usingPath) tracks = pathTracks;
    }

    /*
     * Two ways to know how far round a car is, in order of authority.
     *
     * A hand-traced racing line is expressed in coordinates local to the minimap region;
     * the learned circuit is in frame coordinates, because that is the space the tracker
     * and its sightings live in. They are not interchangeable, so each is projected in
     * its own space rather than being merged into one list.
     */
    const manualPath = buildPath(st.calibration.trackPath);
    const learnedCircuit = this.learner.path;
    const lines = this.lines();
    const pitBox = this.rois('pitzone')[0];

    for (const d of active) {
      const t = tracks.get(d.id);
      if (!t) continue;

      // --- timing lines: geometric, order-checked, sub-frame accurate ---
      // Always read from the plane tracker — see the note above.
      const timed = planeTracks.get(d.id);
      if (this.settings.lapFromLines && lines.length && timed) {
        for (const cross of this.tracker.crossings(timed, lines)) {
          // A freshly drawn line accepts both directions; the first car over it
          // teaches the line which way counts, so later wobbles are ignored.
          if (cross.line.learn) {
            this.bus.action('line.set', { line: { id: cross.line.id, dir: cross.dir, learn: false } });
          }
          this.bus.action('timing.cross', {
            driverId: d.id,
            kind: cross.line.kind,
            index: cross.line.index,
            at: Math.round(cross.at),
            source: `line:${cross.line.name || cross.line.kind}`,
            minLapMs: this.settings.minLapMs,
            minSplitMs: this.settings.minSplitMs
          });
          this.bus.action('vision.log', {
            entry: { kind: cross.line.kind, driverId: d.id, source: cross.line.name }
          });
          this.onEvent({
            type: cross.line.kind, driverId: d.id,
            source: cross.line.name || cross.line.kind, confidence: 1
          });
        }
      }

      // --- progress round the lap, for ordering and the track map ---
      //
      // The particle tracker already holds this exactly: progress round the circuit is
      // the coordinate it estimates in, so there is nothing to re-derive. Only when it
      // is not driving does the position have to be projected onto a line.
      let progress = null;
      if (t.progress != null) progress = t.progress;
      else if (learnedCircuit) progress = learnedCircuit.project({ x: t.x, y: t.y }).s;
      else if (manualPath) {
        const local = { x: (t.x - roi.x) / roi.w, y: (t.y - roi.y) / roi.h };
        progress = projectOnPath(manualPath, local).progress;
      }

      if (progress != null) {
        const prev = this.blobState[d.id] || {};

        // legacy wrap detection stays available for tracks with no finish line drawn
        if (this.settings.lapFromMinimap && !lines.some((l) => l.kind === 'finish')) {
          const dir = this.settings.pathDirection;
          const fwd = dir > 0
            ? prev.progress > 0.72 && progress < 0.28
            : prev.progress < 0.28 && progress > 0.72;
          if (fwd && now - (prev.lastEmit || 0) > this.settings.minLapMs) {
            this.emitLap(d.id, 'wrap', 1);
            prev.lastEmit = now;
          }
        }
        prev.progress = progress;
        this.blobState[d.id] = prev;
        this.pendingTelemetry[d.id] = { ...(this.pendingTelemetry[d.id] || {}), progress };
      }

      /*
       * Race control, for the two things that can honestly be detected.
       *
       * Everything a steward normally calls — contact, blocking, causing a collision —
       * is a judgement about intent and fault that no amount of blob tracking can reach.
       * These two are different: they are geometry and timing, which is exactly what this
       * system already measures. So they are reported, and nothing else is.
       *
       * Both raise a finding, not a punishment. The decision belongs to a person, and a
       * detector that mistracked a car for three frames must not be able to hand down a
       * penalty on air.
       */
      const race = st.race || {};
      const rules = race.rules || {};

      // A car moving before the green flag. The margin is generous: cars creep on the
      // grid, and a creep is not a jump start.
      if (rules.jumpStart && race.status === 'formation' && !this.jumped[d.id] &&
          t.speed > this.settings.stopSpeed * 6 && t.everMoved) {
        this.jumped[d.id] = true;
        this.bus.action('penalty.add', {
          driverId: d.id, kind: 'time', seconds: rules.jumpStartSeconds || 5,
          reason: 'Moved before the start', auto: true
        });
      }
      if (race.status === 'green' && this.jumped[d.id] === undefined) this.jumped[d.id] = false;

      /*
       * Off the circuit, judged against the line the detector learned by watching a car
       * drive it. Counted over consecutive frames, because a single frame off is a
       * mistracked blob far more often than it is a car leaving the road.
       */
      if (rules.trackLimits && learnedCircuit && race.status === 'green' && !t.lost) {
        const lateral = learnedCircuit.project({ x: t.x, y: t.y }).lateral;
        const off = lateral > (this.settings.trackWidth || 0.06);
        const n = (this.offTrack[d.id] || 0);
        this.offTrack[d.id] = off ? n + 1 : 0;
        // one report per excursion: rearm only once the car is properly back on
        if (this.offTrack[d.id] === 6) {
          this.bus.action('trackLimit.note', { driverId: d.id });
        }
      }

      // --- pit lane, with hysteresis so one stray frame is not a pit stop ---
      if (pitBox) {
        const inside = t.x >= pitBox.x && t.x <= pitBox.x + pitBox.w &&
                       t.y >= pitBox.y && t.y <= pitBox.y + pitBox.h && !t.lost;
        const c = (this.pitState[d.id] || 0);
        this.pitState[d.id] = inside ? Math.min(c + 1, 30) : Math.max(c - 1, 0);
        const pit = this.pitState[d.id] >= 8;
        if (pit !== d.pit) {
          this.pendingTelemetry[d.id] = { ...(this.pendingTelemetry[d.id] || {}), pit };
        }
      }

      const tele = this.pendingTelemetry[d.id] || {};
      tele.speed = Math.round(t.speed * 10000) / 10000;
      tele.trackedAt = t.lost ? d.trackedAt : now;
      if (t.stopped !== d.stopped) tele.stopped = t.stopped;
      this.pendingTelemetry[d.id] = tele;
    }

    this.flushTelemetry();
  }

  /** Tracker output changes every frame; ship it in one throttled batch. */
  flushTelemetry() {
    const now = Date.now();
    if (now - this.lastProgressFlush < 250) return;
    const map = this.pendingTelemetry;
    this.pendingTelemetry = {};
    this.lastProgressFlush = now;
    if (Object.keys(map).length) this.bus.action('driver.tracked', { map });
  }

  detectTrigger(roi) {
    if (!roi.ref) return;
    const img = this.capture.imageData(roi);
    const cur = toGray(img);
    const ref = Float32Array.from(roi.ref);
    const score = ncc(cur, ref);
    this.debug.scores[roi.id] = score;

    const st = this.triggerState[roi.id] || { armed: true, lastFireAt: 0 };
    const now = Date.now();
    if (score >= this.settings.triggerThreshold && st.armed && now - st.lastFireAt > this.settings.triggerCooldownMs) {
      st.armed = false;
      st.lastFireAt = now;
      const driverId = roi.driverId || this.state?.overlay?.focusDriverId;
      if (this.settings.lapFromTrigger && driverId) this.emitLap(driverId, `trigger:${roi.name || roi.id}`, score);
      else this.onEvent({ type: 'trigger', roi: roi.id, score });
    }
    if (score < this.settings.triggerThreshold - 0.06) st.armed = true;
    this.triggerState[roi.id] = st;
  }

  async tickOcr() {
    const ocrRois = this.rois().filter((r) => r.type.startsWith('ocr_'));
    if (!ocrRois.length || this.ocrBusy) return;
    const now = performance.now();
    if (now - this.lastOcrAt < OCR_INTERVAL_MS) return;
    this.lastOcrAt = now;
    this.ocrBusy = true;
    try {
      const worker = await this.ensureOcr();
      for (const roi of ocrRois) {
        const isLb = roi.type === 'ocr_leaderboard';
        // Light HUD text sits on a dark panel, so invert the binarisation to get the black-on-
        // white Tesseract reads best. The leaderboard defaults to inverted; any per-ROI opts win.
        const opts = roi.opts || (isLb ? { invert: true, scale: 4, threshold: 0.5 } : {});
        const canvas = this.capture.ocrCanvas(roi, opts);
        await worker.setParameters({
          tessedit_char_whitelist: WHITELIST[roi.type] || '',
          // The leaderboard is a multi-line block; everything else is a single HUD value.
          tessedit_pageseg_mode: isLb ? '6' : '7'
        });
        const { data } = await worker.recognize(canvas);
        // A single HUD value has its spaces stripped; the leaderboard must keep its line breaks
        // (and spaces between name and time) so the parser can split it into rows.
        const text = isLb ? (data.text || '').replace(/[ \t]+/g, ' ').trim() : (data.text || '').trim().replace(/\s+/g, '');
        const conf = data.confidence || 0;
        const prev = this.ocrResults[roi.id];
        this.ocrResults[roi.id] = { text, conf, at: Date.now() };
        // Surface the raw leaderboard read on change (even below gate / empty) so setup can be
        // debugged: a blank read means the crop/capture is wrong, garbage means tune the box.
        if (isLb && (!prev || prev.text !== text)) this.onEvent({ type: 'ocr', roi: roi.id, roiType: roi.type, text: text.replace(/\n/g, ' | ') || '(blank)', conf });
        // The leaderboard is a stylised multi-line block, so Tesseract's average confidence
        // runs lower than a single clean HUD number; its parser is strict (a row must carry a
        // real lap time) so a lower gate is safe here.
        const gate = roi.minConf ?? (isLb ? 20 : 60);
        if (conf >= gate && text && (!prev || prev.text !== text)) {
          this.handleOcr(roi, text, conf, prev?.text);
        }
      }
    } catch (err) {
      console.error('[ocr]', err);
      this.onEvent({ type: 'error', message: String(err.message || err) });
    } finally {
      this.ocrBusy = false;
    }
  }

  handleOcr(roi, text, conf, prevText) {
    const driverId = roi.driverId || this.state?.overlay?.focusDriverId;
    this.onEvent({ type: 'ocr', roi: roi.id, roiType: roi.type, text, conf });

    if (roi.type === 'ocr_lap' && this.settings.lapFromOcr && driverId) {
      const cur = Number((text.match(/(\d+)/) || [])[1]);
      const prev = Number((String(prevText || '').match(/(\d+)/) || [])[1]);
      if (Number.isFinite(cur) && Number.isFinite(prev) && cur === prev + 1) {
        this.emitLap(driverId, 'ocr_lap', conf / 100);
      }
    }

    if (roi.type === 'ocr_time' && driverId) {
      const ms = parseTimeString(text);
      if (ms && ms > 3000) this.onEvent({ type: 'lapTime', driverId, ms, conf });
    }

    if (roi.type === 'ocr_name') {
      const match = this.matchDriver(text);
      if (match && this.state.overlay.focusDriverId !== match.id) {
        this.bus.action('overlay.update', { patch: { focusDriverId: match.id } });
      }
    }

    if (roi.type === 'ocr_leaderboard') {
      const rows = parseLeaderboard(text);
      if (rows.length) this.applyLeaderboard(rows, conf);
    }
  }

  /** Match an OCR'd name (or "#num") to a registered driver: number first, then fuzzy name. */
  matchDriver(text, num) {
    const drivers = this.state?.drivers || [];
    if (num) { const byNum = drivers.find((d) => String(d.num) === String(num)); if (byNum) return byNum; }
    const t = String(text || '').toLowerCase().replace(/\s/g, '');
    if (t.length < 3) return null;
    return drivers.find((d) => {
      const n = (d.name || '').toLowerCase().replace(/\s/g, '');
      return n && (n.includes(t.slice(0, 5)) || t.includes(n.slice(0, 5)));
    }) || null;
  }

  /**
   * Apply a parsed leaderboard as an authoritative standings snapshot.
   *
   * The in-game board already ranks the field and reports each driver's lap count and best lap,
   * so rather than re-deriving any of that, match each row to a registered driver and hand the
   * whole snapshot to the state via `timing.external`. recompute() then orders by the board's
   * rank and shows its lap counts and best laps directly. Rows that match no driver are dropped.
   */
  applyLeaderboard(rows, conf) {
    this.onEvent({ type: 'leaderboard', rows, conf });
    const out = [];
    for (const r of rows) {
      const d = this.matchDriver(r.name, r.num);
      if (!d) continue;
      out.push({ driverId: d.id, rank: r.rank, laps: r.laps, bestMs: r.bestMs });
    }
    if (out.length) this.bus.action('timing.external', { rows: out });
  }

  emitLap(driverId, source, confidence) {
    this.bus.action('lap.record', { driverId, source, minLapMs: this.settings.minLapMs });
    this.bus.action('vision.log', { entry: { kind: 'lap', driverId, source, confidence } });
    this.onEvent({ type: 'lap', driverId, source, confidence });
  }

  /** Capture the current pixels of a trigger ROI as its reference patch. */
  captureReference(roi) {
    if (!this.capture.grab()) return null;
    return Array.from(toGray(this.capture.imageData(roi)));
  }
}
