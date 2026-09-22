// Optional trained-model path: run your own YOLOv8/YOLO11 ONNX model over the frame.
//
// Drop an export at  public/models/frlegends.onnx  plus  public/models/frlegends.labels.json
// (a JSON array of class names, e.g. ["car","finish_line","player_car","minimap_dot"]).
// Train it on your own recordings — see TRAINING.md.

const ORT_CDN = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/ort.min.js';

export class Detector {
  constructor() {
    this.session = null;
    this.labels = [];
    this.inputSize = 640;
    this.inputName = null;
    this.busy = false;
    this.lastResult = [];
    this.confThreshold = 0.4;
    this.iouThreshold = 0.45;
  }

  get ready() { return !!this.session; }

  async load(modelUrl = '/models/frlegends.onnx', labelsUrl = '/models/frlegends.labels.json') {
    if (!window.ort) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = ORT_CDN;
        s.onload = resolve;
        s.onerror = () => reject(new Error('failed to load onnxruntime-web (needs internet once)'));
        document.head.appendChild(s);
      });
    }
    window.ort.env.wasm.numThreads = Math.min(4, navigator.hardwareConcurrency || 2);

    try {
      const res = await fetch(labelsUrl);
      if (res.ok) this.labels = await res.json();
    } catch { /* labels are optional; fall back to class indices */ }

    this.session = await window.ort.InferenceSession.create(modelUrl, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all'
    });
    this.inputName = this.session.inputNames[0];

    const dims = this.session.inputMetadata?.[0]?.dimensions;
    if (dims && dims.length === 4 && typeof dims[2] === 'number') this.inputSize = dims[2];
    return { labels: this.labels, inputSize: this.inputSize };
  }

  /** Letterbox a source canvas into a square NCHW float tensor. */
  preprocess(sourceCanvas) {
    const S = this.inputSize;
    const c = document.createElement('canvas');
    c.width = S; c.height = S;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#727272';
    ctx.fillRect(0, 0, S, S);

    const sw = sourceCanvas.width, sh = sourceCanvas.height;
    const scale = Math.min(S / sw, S / sh);
    const dw = Math.round(sw * scale), dh = Math.round(sh * scale);
    const dx = Math.floor((S - dw) / 2), dy = Math.floor((S - dh) / 2);
    ctx.drawImage(sourceCanvas, dx, dy, dw, dh);

    const { data } = ctx.getImageData(0, 0, S, S);
    const tensor = new Float32Array(3 * S * S);
    const plane = S * S;
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      tensor[p] = data[i] / 255;
      tensor[plane + p] = data[i + 1] / 255;
      tensor[2 * plane + p] = data[i + 2] / 255;
    }
    return { tensor, scale, dx, dy, sw, sh };
  }

  async detect(sourceCanvas) {
    if (!this.session || this.busy) return this.lastResult;
    this.busy = true;
    try {
      const { tensor, scale, dx, dy, sw, sh } = this.preprocess(sourceCanvas);
      const S = this.inputSize;
      const input = new window.ort.Tensor('float32', tensor, [1, 3, S, S]);
      const output = await this.session.run({ [this.inputName]: input });
      const out = output[this.session.outputNames[0]];
      this.lastResult = this.decode(out, { scale, dx, dy, sw, sh });
      return this.lastResult;
    } finally {
      this.busy = false;
    }
  }

  /** YOLOv8 head: [1, 4 + numClasses, numAnchors], boxes are cx,cy,w,h in model pixels. */
  decode(out, geo) {
    const [, ch, anchors] = out.dims;
    const d = out.data;
    const numClasses = ch - 4;
    const boxes = [];

    for (let i = 0; i < anchors; i++) {
      let best = 0, bestCls = -1;
      for (let c = 0; c < numClasses; c++) {
        const score = d[(4 + c) * anchors + i];
        if (score > best) { best = score; bestCls = c; }
      }
      if (best < this.confThreshold) continue;

      const cx = d[0 * anchors + i], cy = d[1 * anchors + i];
      const w = d[2 * anchors + i], h = d[3 * anchors + i];
      const x = (cx - w / 2 - geo.dx) / geo.scale;
      const y = (cy - h / 2 - geo.dy) / geo.scale;
      boxes.push({
        x: x / geo.sw,
        y: y / geo.sh,
        w: (w / geo.scale) / geo.sw,
        h: (h / geo.scale) / geo.sh,
        score: best,
        cls: bestCls,
        label: this.labels[bestCls] || `class_${bestCls}`
      });
    }
    return nms(boxes, this.iouThreshold);
  }
}

function iou(a, b) {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
}

function nms(boxes, threshold) {
  const sorted = boxes.sort((a, b) => b.score - a.score);
  const keep = [];
  for (const box of sorted) {
    if (keep.every((k) => k.cls !== box.cls || iou(k, box) < threshold)) keep.push(box);
  }
  return keep;
}
