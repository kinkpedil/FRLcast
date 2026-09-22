// Screen/window capture for the emulator running FR Legends.
// The operator picks the emulator window once; every frame after that is ours.
//
// The expensive parts of capture are not the detection maths, they are the pixels:
//
//   * asking the compositor for 60fps when detection wants 15 makes the OS do 4x
//     the work before we even see a frame;
//   * copying a whole 1920x1080 frame to read a 200x180 minimap moves two million
//     pixels to use thirty-six thousand.
//
// So this class asks for exactly the frame rate the engine runs at, and copies only
// the calibrated regions, packed into one small atlas canvas.

export class Capture {
  constructor() {
    this.stream = null;
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;

    // atlas: only the calibrated regions, packed together
    this.atlas = document.createElement('canvas');
    this.actx = this.atlas.getContext('2d', { willReadFrequently: true });
    this.actx.imageSmoothingEnabled = false;   // nearest-neighbour: no colour blending
    this.slots = new Map();                    // roiId -> {x,y,w,h} inside the atlas
    this.atlasSig = '';

    // full frame, drawn only when something actually needs all of it
    this.full = document.createElement('canvas');
    this.fctx = this.full.getContext('2d', { willReadFrequently: true });

    this.source = null;        // video element or VideoFrame for the current tick
    this.sourceW = 0;
    this.sourceH = 0;
    this.copiedPixels = 0;     // last tick, for the performance readout

    this.quality = { fps: 10, maxWidth: 1280, scale: 1 };
    this.onChange = () => {};
    this.audio = null;
    this.wakeLock = null;
    this.frameReader = null;
  }

  /** Frames can be pulled from the track itself on browsers that support it. */
  get canStreamFrames() {
    return typeof window.MediaStreamTrackProcessor === 'function' && !!this.stream;
  }

  get active() {
    return !!(this.stream && this.stream.active && this.video.videoWidth);
  }

  get width() { return this.video.videoWidth || 0; }
  get height() { return this.video.videoHeight || 0; }

  /** Back-compat: the ONNX detector wants a full frame. */
  get canvas() { return this.full; }

  /**
   * Why capture cannot start here, or '' when it can.
   *
   * Browsers withhold navigator.mediaDevices outside a secure context, so on a plain-http
   * LAN address the object is missing rather than the call failing — which surfaces as
   * "Cannot read properties of undefined". Say what is actually wrong instead.
   */
  get blockedReason() {
    if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) return '';
    if (!window.isSecureContext) {
      const url = `https://${location.hostname}:${Number(location.port || 80) + 1}${location.pathname}`;
      return 'Screen capture needs a secure connection. This page is on plain http, ' +
             'so the browser hides the capture API completely.\n\n' +
             `Open this address instead:\n${url}\n\n` +
             'The certificate is self-signed, so accept the warning once ' +
             '(Advanced, then Proceed).';
    }
    return 'This browser has no screen capture support. On Android and iOS no browser ' +
           'can capture the screen — use a desktop or laptop as the capture node.';
  }

  async start(quality = {}) {
    Object.assign(this.quality, quality);
    const blocked = this.blockedReason;
    if (blocked) throw new Error(blocked);
    const video = { frameRate: { ideal: this.quality.fps, max: Math.max(this.quality.fps, 30) } };
    if (this.quality.maxWidth) video.width = { max: this.quality.maxWidth };

    this.stream = await navigator.mediaDevices.getDisplayMedia({ video, audio: false });
    this.video.srcObject = this.stream;
    await this.video.play();
    for (let i = 0; i < 60 && !this.video.videoWidth; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    this.stream.getVideoTracks()[0].addEventListener('ended', () => this.stop());
    this.keepAwake();
    this.onChange();
    return { w: this.width, h: this.height };
  }

  /**
   * Change frame rate / resolution without making the operator pick the window again.
   * Not every source honours every constraint, so the caller should read back
   * `trackSettings()` rather than assume.
   */
  async applyQuality(quality = {}) {
    Object.assign(this.quality, quality);
    const track = this.stream && this.stream.getVideoTracks()[0];
    if (!track) return null;
    const c = { frameRate: { ideal: this.quality.fps, max: Math.max(this.quality.fps, 30) } };
    if (this.quality.maxWidth) c.width = { max: this.quality.maxWidth };
    try {
      await track.applyConstraints(c);
    } catch (err) {
      console.warn('[capture] constraints rejected:', err.message);
    }
    return this.trackSettings();
  }

  trackSettings() {
    const track = this.stream && this.stream.getVideoTracks()[0];
    return track ? track.getSettings() : null;
  }

  // ---------------------------------------------------------------- keep awake

  /**
   * Two defences against the browser putting this tab to sleep mid-broadcast.
   *
   * A hidden tab has its timers clamped hard — measured here at ~430ms average and
   * one-second stalls against a 66ms target. A tab producing audio is exempt from
   * that clamping, so we emit an inaudible tone while capture runs. The screen wake
   * lock separately stops the display sleeping, which on some setups also freezes
   * window capture.
   */
  keepAwake() {
    try {
      if (!this.audio) {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        gain.gain.value = 0.0001;     // inaudible, but not silent: zero would not count
        osc.frequency.value = 30;
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        this.audio = { ctx, osc, gain };
      }
      this.audio.ctx.resume();
    } catch (err) {
      console.warn('[capture] audio keep-alive unavailable:', err.message);
    }

    if (navigator.wakeLock && !this.wakeLock) {
      navigator.wakeLock.request('screen')
        .then((lock) => {
          this.wakeLock = lock;
          lock.addEventListener('release', () => { this.wakeLock = null; });
        })
        .catch(() => { /* denied without a gesture on some builds; not fatal */ });
    }
  }

  releaseAwake() {
    try { this.audio?.ctx.suspend(); } catch { /* already gone */ }
    try { this.wakeLock?.release(); } catch { /* already gone */ }
    this.wakeLock = null;
  }

  // ---------------------------------------------------------------- frame source

  /**
   * Frame-driven capture: the pipeline hands us each frame as the OS produces it,
   * so nothing here waits on a timer the browser is allowed to throttle.
   */
  streamFrames(onFrame) {
    if (!this.canStreamFrames) return null;
    const track = this.stream.getVideoTracks()[0];
    const processor = new window.MediaStreamTrackProcessor({ track });
    const reader = processor.readable.getReader();
    let stopped = false;

    (async () => {
      while (!stopped) {
        let frame;
        try {
          const { value, done } = await reader.read();
          if (done) break;
          frame = value;
        } catch { break; }
        // A handler that returns true has taken ownership (transferred it to a
        // worker); closing it here would then throw on an already-detached frame.
        let owned = false;
        try { owned = onFrame(frame) === true; } finally { if (!owned) frame.close(); }
      }
      try { reader.releaseLock(); } catch { /* stream already closed */ }
    })();

    this.frameReader = () => {
      stopped = true;
      try { reader.cancel(); } catch { /* already cancelled */ }
    };
    return this.frameReader;
  }

  stopFrames() {
    if (this.frameReader) this.frameReader();
    this.frameReader = null;
    this.source = null;
  }

  /** Point the class at a delivered VideoFrame. Valid only until the callback returns. */
  useFrame(frame) {
    const w = frame.displayWidth || frame.codedWidth;
    const h = frame.displayHeight || frame.codedHeight;
    if (!w || !h) return false;
    this.source = frame;
    this.sourceW = w;
    this.sourceH = h;
    return true;
  }

  /** Point the class at the video element. The timer path uses this. */
  grab() {
    if (!this.active) return false;
    this.source = this.video;
    this.sourceW = this.video.videoWidth;
    this.sourceH = this.video.videoHeight;
    return true;
  }

  // ---------------------------------------------------------------- region atlas

  /** Pack the calibrated regions into one canvas, one row each. */
  layoutAtlas(rois, scale) {
    const sig = rois.map((r) => `${r.id}:${r.x.toFixed(4)},${r.y.toFixed(4)},${r.w.toFixed(4)},${r.h.toFixed(4)}`).join('|') +
                `@${scale}@${this.sourceW}x${this.sourceH}`;
    if (sig === this.atlasSig) return;
    this.atlasSig = sig;
    this.slots.clear();

    let y = 0, maxW = 1;
    for (const r of rois) {
      const w = Math.max(1, Math.round(r.w * this.sourceW * scale));
      const h = Math.max(1, Math.round(r.h * this.sourceH * scale));
      this.slots.set(r.id, { x: 0, y, w, h });
      y += h;
      maxW = Math.max(maxW, w);
    }
    this.atlas.width = maxW;
    this.atlas.height = Math.max(1, y);
    this.actx.imageSmoothingEnabled = false;
  }

  /**
   * Copy just the calibrated regions out of the current frame.
   * `scale` below 1 downsamples during the copy, which is cheaper than copying at
   * full resolution and skipping pixels afterwards. Nearest-neighbour keeps colours
   * pure, which the colour classifier depends on.
   */
  grabRegions(rois, scale = 1) {
    if (!this.source || !rois.length) { this.copiedPixels = 0; return false; }
    this.layoutAtlas(rois, scale);

    let copied = 0;
    for (const r of rois) {
      const slot = this.slots.get(r.id);
      if (!slot) continue;
      const sx = Math.max(0, Math.min(this.sourceW - 1, Math.round(r.x * this.sourceW)));
      const sy = Math.max(0, Math.min(this.sourceH - 1, Math.round(r.y * this.sourceH)));
      const sw = Math.max(1, Math.min(this.sourceW - sx, Math.round(r.w * this.sourceW)));
      const sh = Math.max(1, Math.min(this.sourceH - sy, Math.round(r.h * this.sourceH)));
      try {
        this.actx.drawImage(this.source, sx, sy, sw, sh, slot.x, slot.y, slot.w, slot.h);
        copied += slot.w * slot.h;
      } catch { /* frame closed underneath us */ }
    }
    this.copiedPixels = copied;
    return true;
  }

  /** Pixels of the current frame, for one region. */
  imageData(roi) {
    const slot = this.slots.get(roi.id);
    if (slot) return this.actx.getImageData(slot.x, slot.y, slot.w, slot.h);

    // region not in the atlas (a one-off read, e.g. capturing a trigger reference)
    this.fullFrameCanvas();
    const x = Math.max(0, Math.min(this.full.width - 1, Math.round(roi.x * this.full.width)));
    const y = Math.max(0, Math.min(this.full.height - 1, Math.round(roi.y * this.full.height)));
    const w = Math.max(1, Math.min(this.full.width - x, Math.round(roi.w * this.full.width)));
    const h = Math.max(1, Math.min(this.full.height - y, Math.round(roi.h * this.full.height)));
    return this.fctx.getImageData(x, y, w, h);
  }

  /** The whole frame — only for the ONNX detector, the layout backdrop and previews. */
  fullFrameCanvas() {
    if (!this.source) return this.full;
    if (this.full.width !== this.sourceW || this.full.height !== this.sourceH) {
      this.full.width = this.sourceW;
      this.full.height = this.sourceH;
    }
    try { this.fctx.drawImage(this.source, 0, 0); } catch { /* frame closed */ }
    return this.full;
  }

  // ---------------------------------------------------------------- helpers

  /** Upscaled + contrast-boosted crop — OCR on small mobile HUD text needs this. */
  ocrCanvas(roi, { scale = 4, invert = false, threshold = 0.55 } = {}) {
    const src = this.imageData(roi);
    const out = document.createElement('canvas');
    out.width = src.width * scale;
    out.height = src.height * scale;
    const octx = out.getContext('2d');

    const bin = new ImageData(src.width, src.height);
    for (let i = 0; i < src.data.length; i += 4) {
      const lum = (src.data[i] * 0.299 + src.data[i + 1] * 0.587 + src.data[i + 2] * 0.114) / 255;
      let v = lum > threshold ? 255 : 0;
      if (invert) v = 255 - v;
      bin.data[i] = bin.data[i + 1] = bin.data[i + 2] = v;
      bin.data[i + 3] = 255;
    }

    const tmp = document.createElement('canvas');
    tmp.width = src.width;
    tmp.height = src.height;
    tmp.getContext('2d').putImageData(bin, 0, 0);

    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = 'high';
    octx.drawImage(tmp, 0, 0, out.width, out.height);
    return out;
  }

  dataURL(quality = 0.6, maxW = 960) {
    if (!this.active) return null;
    if (!this.source) this.grab();
    const full = this.fullFrameCanvas();
    const s = Math.min(1, maxW / full.width);
    const out = document.createElement('canvas');
    out.width = Math.round(full.width * s);
    out.height = Math.round(full.height * s);
    out.getContext('2d').drawImage(full, 0, 0, out.width, out.height);
    return out.toDataURL('image/jpeg', quality);
  }

  stop() {
    this.stopFrames();
    this.releaseAwake();
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    this.stream = null;
    this.video.srcObject = null;
    this.source = null;
    this.slots.clear();
    this.atlasSig = '';
    this.onChange();
  }
}
