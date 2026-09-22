// Car tracking primitives.
//
// The naive approach — "for each driver, scan every pixel and test its colour" —
// costs one full pass per driver, so twelve cars means twelve passes per frame.
// This module does the same job in two passes total, regardless of how many cars
// are on track, and adds the temporal layer that makes the result usable for timing:
//
//   1. classify()  one lookup-table pass turns pixels into driver indices
//   2. blobs()     one connected-component pass turns those into car-sized blobs
//   3. Tracker     ties blobs across frames, predicts through occlusion, and
//                  reports velocity so "stopped on track" is detectable
//   4. crossing()  exact segment intersection, so a timing line yields a
//                  sub-frame timestamp instead of a frame-quantised one
//
// Everything here is plain arithmetic — no model, no GPU, no allocations per frame.

/**
 * How far apart two colours are, for the purpose of deciding whether they are the
 * same car.
 *
 * Plain RGB distance is the obvious choice and the wrong one, because it treats a
 * change in brightness exactly like a change in hue. A car is lit differently at
 * every point of the lap — bright on the straight, dark under a bridge — and straight
 * RGB reports that as a different colour, so the match is lost or, worse, handed to
 * another car whose colour happens to sit where the shadow landed.
 *
 * Shading scales all three channels together: it moves a colour along a ray from the
 * origin without changing its direction. So direction is what identifies the paint,
 * and length is mostly lighting. This splits the two and weights brightness far less,
 * which is what makes a shaded car stay itself.
 *
 * Scaled to remain comparable with the RGB distances the tolerance setting was chosen
 * against, so existing calibrations keep roughly their previous strictness.
 */
export function colorDistance(a, b) {
  const sa = a[0] + a[1] + a[2] || 1;
  const sb = b[0] + b[1] + b[2] || 1;
  const dr = a[0] / sa - b[0] / sb;
  const dg = a[1] / sa - b[1] / sb;
  const db = a[2] / sa - b[2] / sb;
  const hue = Math.sqrt(dr * dr + dg * dg + db * db) * 441;   // 441 ~= sqrt(3)*255
  const light = (Math.abs(sa - sb) / 3) * 0.45;
  return Math.hypot(hue, light);
}

const LUT_BITS = 5;                       // 32 levels per channel
const LUT_SIZE = 1 << (LUT_BITS * 3);     // 32768 cells
const LUT_SHIFT = 8 - LUT_BITS;

/**
 * Precomputed nearest-colour lookup cube.
 * Rebuilt only when the roster's colours or the tolerance change, after which
 * classifying a pixel is a single array read.
 */
export class ColorLUT {
  constructor() {
    this.table = new Int8Array(LUT_SIZE).fill(-1);
    this.signature = '';
  }

  /** @param {string[]} colors hex colours, index = driver index */
  build(colors, tolerance) {
    const sig = `${colors.join(',')}|${tolerance}`;
    if (sig === this.signature) return false;
    this.signature = sig;

    const rgb = colors.map(hexToRgb);
    const step = 1 << LUT_SHIFT;
    const half = step >> 1;

    this.table.fill(-1);
    for (let r = 0; r < 256; r += step) {
      for (let g = 0; g < 256; g += step) {
        for (let b = 0; b < 256; b += step) {
          // sample the centre of each cell so quantisation error is symmetric
          const cr = r + half, cg = g + half, cb = b + half;
          let best = -1, bestD = tolerance;
          const cell = [cr, cg, cb];
          for (let i = 0; i < rgb.length; i++) {
            const d = colorDistance(cell, rgb[i]);
            if (d < bestD) { bestD = d; best = i; }
          }
          this.table[cellIndex(r, g, b)] = best;
        }
      }
    }
    return true;
  }

  lookup(r, g, b) {
    return this.table[cellIndex(r, g, b)];
  }
}

function cellIndex(r, g, b) {
  return ((r >> LUT_SHIFT) << (LUT_BITS * 2)) | ((g >> LUT_SHIFT) << LUT_BITS) | (b >> LUT_SHIFT);
}

export function hexToRgb(hex) {
  const h = String(hex).replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Scratch buffers, kept between frames so a running session allocates nothing. */
const scratch = { size: 0, labels: null, comp: null };

function ensureScratch(n) {
  if (scratch.size >= n) return;
  scratch.size = n;
  scratch.labels = new Int8Array(n);
  scratch.comp = new Int32Array(n);
}

/**
 * Pass 1 — every pixel becomes a driver index or -1.
 * `step` samples every Nth pixel in both axes; 2 quarters the work and is still
 * far finer than a minimap dot, which is typically 6-14px across.
 */
export function classify(imageData, lut, step = 1) {
  const { width, height, data } = imageData;
  const w = Math.ceil(width / step);
  const h = Math.ceil(height / step);
  ensureScratch(w * h);
  const labels = scratch.labels;

  let o = 0;
  for (let y = 0; y < height; y += step) {
    const row = y * width;
    for (let x = 0; x < width; x += step) {
      const i = (row + x) * 4;
      labels[o++] = data[i + 3] < 40 ? -1 : lut.lookup(data[i], data[i + 1], data[i + 2]);
    }
  }
  return { labels, w, h, step };
}

/**
 * Pass 2 — union-find connected components over the label map.
 *
 * With `all`, every component is returned. That matters more than it sounds: keeping
 * only the biggest blob per colour means a large piece of scenery in the same hue — a
 * kerb, a barrier, a painted line — outranks the car and *is* the car as far as the
 * rest of the pipeline can tell. Handing the tracker every candidate lets it pick the
 * one that is actually where the car should be.
 */
export function blobs(classified, minArea = 6, all = false, img = null) {
  const { labels, w, h, step } = classified;
  const comp = scratch.comp;
  const parent = [];

  const find = (x) => { while (parent[x] !== x) x = parent[x] = parent[parent[x]]; return x; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const L = labels[i];
      if (L < 0) { comp[i] = -1; continue; }
      const left = x > 0 && labels[i - 1] === L ? comp[i - 1] : -1;
      const up = y > 0 && labels[i - w] === L ? comp[i - w] : -1;
      if (left < 0 && up < 0) {
        const id = parent.length;
        parent.push(id);
        comp[i] = id;
      } else if (left >= 0 && up >= 0) {
        comp[i] = left;
        if (left !== up) union(left, up);
      } else {
        comp[i] = left >= 0 ? left : up;
      }
    }
  }

  const acc = new Map();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (comp[i] < 0) continue;
      const root = find(comp[i]);
      let a = acc.get(root);
      if (!a) { a = { driver: labels[i], n: 0, sx: 0, sy: 0, sr: 0, sg: 0, sb: 0 }; acc.set(root, a); }
      a.n++; a.sx += x; a.sy += y;
      // Mean colour, gathered in the pass that is already walking these pixels. It is
      // what lets an ambiguous blob be offered to more than one car further down.
      if (img) {
        const q = ((y * step) * img.width + (x * step)) * 4;
        a.sr += img.data[q]; a.sg += img.data[q + 1]; a.sb += img.data[q + 2];
      }
    }
  }

  const shape = (a) => ({
    driver: a.driver, n: a.n, x: (a.sx / a.n) / w, y: (a.sy / a.n) / h,
    color: img ? [a.sr / a.n, a.sg / a.n, a.sb / a.n] : null
  });

  if (all) {
    const list = [];
    for (const a of acc.values()) if (a.n >= minArea) list.push(shape(a));
    return { list, scale: step };
  }

  // biggest blob per driver — fine when nothing else on screen shares the colour
  const best = new Map();
  for (const a of acc.values()) {
    if (a.n < minArea) continue;
    const cur = best.get(a.driver);
    if (!cur || a.n > cur.n) best.set(a.driver, shape(a));
  }
  return { list: [...best.values()], scale: step };
}

/**
 * Where two segments meet. Returns the parameter along p->q, which is what turns a
 * crossing into a timestamp between two frames rather than "sometime this frame".
 */
export function segIntersect(p, q, a, b) {
  const rx = q.x - p.x, ry = q.y - p.y;
  const sx = b.x - a.x, sy = b.y - a.y;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-12) return null;         // parallel
  const t = ((a.x - p.x) * sy - (a.y - p.y) * sx) / denom;
  const u = ((a.x - p.x) * ry - (a.y - p.y) * rx) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u };
}

/** Which side of a directed line a point sits on. */
export function sideOf(a, b, p) {
  return Math.sign((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x));
}

/**
 * Tells scenery apart from cars, using nothing but where blobs keep turning up.
 *
 * Colour alone cannot do this. A kerb, a painted line or a piece of signage in the
 * roster's hue is indistinguishable from a car pixel by pixel — and it is often *larger*
 * than the car, so any rule that breaks ties by size picks the scenery and stays there
 * for the rest of the session. That is the single biggest source of wrong laps.
 *
 * What separates them is time: a circuit does not move. A blob that keeps appearing at
 * the same spot frame after frame is part of the track. One that travels is a car. So
 * this holds a small register of positions and how long each has been occupied, and
 * marks the settled ones. It costs one pass over the blobs — a few dozen items — not
 * over the pixels.
 */
export class SceneryFilter {
  /**
   * @param settleFrames how many frames a blob must hold still before it is scenery
   * @param radius       how far it may drift and still count as the same spot
   */
  constructor(settleFrames = 12, radius = 0.012) {
    this.settleFrames = settleFrames;
    this.radius = radius;
    this.spots = [];      // { x, y, driver, frames, lastSeen }
    this.frame = 0;
  }

  reset() { this.spots = []; this.frame = 0; }

  /**
   * Mark each blob as moving or not, in place, and return the same list.
   * Blobs already known to be moving (found by the motion detector) are trusted as-is.
   */
  mark(list) {
    this.frame++;

    // One physical blob may appear several times in the list, once per car it could
    // belong to. It is still one object on screen, so it is judged once and the verdict
    // is shared, or the same kerb would be counted as several different spots.
    const verdict = new Map();
    for (const b of list) {
      if (b.moving) continue;            // the motion detector already vouched for it
      const key = b.key != null ? b.key : `${b.x.toFixed(4)},${b.y.toFixed(4)}`;
      if (verdict.has(key)) { b.scenery = verdict.get(key); b.moving = !b.scenery; continue; }

      let spot = null;
      let bestD = this.radius;
      for (const s of this.spots) {
        const d = Math.hypot(s.x - b.x, s.y - b.y);
        if (d < bestD) { bestD = d; spot = s; }
      }
      if (spot) {
        // ease the spot towards the blob so slow drift does not spawn a new entry
        spot.x += (b.x - spot.x) * 0.2;
        spot.y += (b.y - spot.y) * 0.2;
        /*
         * Consecutive frames, not total visits.
         *
         * Scenery is there in every single frame. A car is there for two or three and
         * then gone. Counting visits instead cannot tell those apart, and on a circuit
         * it fails badly: every car goes round the same loop, so each point of the track
         * is revisited constantly by different cars and eventually the whole circuit is
         * declared scenery — after which no car can be acquired anywhere. So a gap
         * resets the count, and only something genuinely present frame after frame ever
         * settles.
         */
        spot.frames = this.frame - spot.lastSeen <= 1 ? spot.frames + 1 : 1;
        spot.lastSeen = this.frame;
      } else {
        this.spots.push({ x: b.x, y: b.y, frames: 1, lastSeen: this.frame });
        spot = this.spots[this.spots.length - 1];
      }
      b.scenery = spot.frames >= this.settleFrames;
      b.moving = !b.scenery;
      verdict.set(key, b.scenery);
    }

    // Forget spots nothing has occupied lately, so a car that parks briefly does not
    // become permanent scenery and the register cannot grow without bound.
    if (this.spots.length > 256 || this.frame % 60 === 0) {
      this.spots = this.spots.filter((s) => this.frame - s.lastSeen < 90);
    }
    return list;
  }
}

/**
 * One car, followed through time.
 * Holding velocity lets the track coast through the frames where a dot is hidden
 * under another car or under the HUD, which is where a naive detector loses laps.
 */
export class Tracker {
  constructor() {
    this.tracks = new Map();   // driverId -> track
  }

  reset() { this.tracks.clear(); }

  get(id) { return this.tracks.get(id); }

  /**
   * Decide which sighting, if any, belongs to each car this frame.
   *
   * Three properties matter, and none of them can be had by letting each car pick its
   * own nearest blob independently:
   *
   *   1. A car cannot teleport. A sighting is only believed if it turns up near where
   *      the track says the car should be and is roughly the size the car has been.
   *      Without this the pin snaps onto whatever scenery shares the hue the moment the
   *      car is hidden, and a decoy parked by a timing line records laps that never
   *      happened.
   *
   *   2. One blob is one car. Two cars in similar colours are routinely offered the
   *      same blob; if both take it, the pins merge and the identities swap as soon as
   *      they separate. So candidates are claimed exclusively, closest claim first.
   *
   *   3. A car that is currently unknown may take what is left over, but it must not
   *      outrank a car that has been following that blob all along. Established tracks
   *      claim first; acquisition happens afterwards from the remainder.
   *
   * @param sightings Map driverId -> candidate or array of candidates. A candidate may
   *   carry `key` naming the physical blob it came from, so the same blob offered to
   *   several drivers is recognised as one object.
   */
  assign(driverIds, sightings, now, { gateRadius = 0.12, gateSizeRatio = 3, stopSpeed = 0.004 } = {}) {
    const listFor = (id) => {
      const offered = sightings.get(id);
      return Array.isArray(offered) ? offered : (offered ? [offered] : []);
    };
    const keyOf = (c) => (c.key != null ? c.key : `${c.x.toFixed(4)},${c.y.toFixed(4)}`);

    const chosen = new Map();
    const taken = new Set();

    // Established tracks bid for anything inside their gate; the closest bid across all
    // cars is settled first, so a contested blob goes to the car it actually fits.
    const bids = [];
    for (const id of driverIds) {
      const t = this.tracks.get(id);
      if (!t || t.lost) continue;
      const dt = Math.max(0.001, (now - t.at) / 1000);
      const px = t.x + t.vx * dt;
      const py = t.y + t.vy * dt;
      const gate = Math.max(gateRadius, Math.hypot(t.vx, t.vy) * dt * 2.5);
      const inGate = listFor(id).filter((c) => {
        if (Math.hypot(c.x - px, c.y - py) > gate) return false;
        return !(t.area && c.n && (c.n > t.area * gateSizeRatio || c.n * gateSizeRatio < t.area));
      });

      /*
       * A track that has stopped moving while something live is in reach is almost
       * certainly stuck on scenery. The gate cannot free it on its own — the scenery
       * sits exactly where a stationary prediction says to look, so it wins every frame
       * for ever. When there is a real alternative, ignore the settled blobs; when there
       * is not, keep them, because a car genuinely parked on track also holds still and
       * must not be thrown away.
       */
      const alive = inGate.filter((c) => !c.scenery);
      const usable = (alive.length && Math.hypot(t.vx, t.vy) <= stopSpeed) ? alive : inGate;

      for (const c of usable) {
        const d = Math.hypot(c.x - px, c.y - py);
        // among equals a candidate found because it moved beats a static one: the
        // circuit does not move, so movement is evidence of being a car
        bids.push({ id, c, cost: c.moving ? d : d + gateRadius * 0.25 });
      }
    }
    bids.sort((a, b) => a.cost - b.cost);
    for (const b of bids) {
      if (chosen.has(b.id)) continue;
      const k = keyOf(b.c);
      if (taken.has(k)) continue;
      chosen.set(b.id, b.c);
      taken.add(k);
    }

    // Whatever is left may be claimed by a car with no position yet. Size alone is a bad
    // tiebreak here — a kerb in the same hue is often larger than the car — so a moving
    // candidate is preferred, and size only decides among equals.
    for (const id of driverIds) {
      if (chosen.has(id)) continue;
      const t = this.tracks.get(id);
      if (t && !t.lost) continue;
      // Settled blobs are excluded outright, not merely ranked lower. Acquiring onto a
      // kerb is not a small error that later frames correct — the track stays there and
      // every lap it "records" is false. Waiting for something that moves is better than
      // being confidently wrong, and a car on the grid becomes eligible the moment it
      // pulls away and stops matching its old spot.
      const free = listFor(id).filter((c) => !taken.has(keyOf(c)) && !c.scenery);
      if (!free.length) continue;
      const moving = free.filter((c) => c.moving);
      const pool = moving.length ? moving : free;
      const pick = pool.reduce((a, b) => (b.n > a.n ? b : a));
      chosen.set(id, pick);
      taken.add(keyOf(pick));
    }

    return chosen;
  }

  /**
   * @param sightings Map driverId -> {x,y} in frame-normalised coords (or absent)
   * @param opts { maxMissedMs, smooth, stopSpeed, stopMs, gateRadius, gateSizeRatio }
   */
  update(driverIds, sightings, now, opts = {}) {
    const {
      maxMissedMs = 900,
      smooth = 0.45,
      stopSpeed = 0.004,   // normalised units per second
      stopMs = 3000,
      // How far from where the car should be a sighting may appear and still be
      // believed, as a fraction of the region.
      gateRadius = 0.12,
      gateSizeRatio = 3
    } = opts;

    const chosen = this.assign(driverIds, sightings, now, { gateRadius, gateSizeRatio, stopSpeed });

    for (const id of driverIds) {
      let t = this.tracks.get(id);
      let seen = chosen.get(id) || null;

      if (!t) {
        if (!seen) continue;
        this.tracks.set(id, {
          id, x: seen.x, y: seen.y, vx: 0, vy: 0,
          prev: null, seenAt: now, at: now, speed: 0,
          stopped: false, stillSince: now, lost: false, area: seen.n || 0,
          everMoved: false
        });
        continue;
      }

      const dt = Math.max(0.001, (now - t.at) / 1000);
      t.prev = { x: t.x, y: t.y, at: t.at };

      // Re-acquiring after a loss is a jump, not motion, so the step it happens on
      // must not be tested against the timing lines.
      if (seen && t.lost) {
        t.x = seen.x; t.y = seen.y;
        t.vx = 0; t.vy = 0;
        t.area = seen.n || 0;
        t.seenAt = now;
        t.at = now;
        t.lost = false;
        t.prev = null;
        t.stillSince = now;
        t.stopped = false;
        continue;
      }

      if (seen) {
        const nx = t.x + (seen.x - t.x) * smooth;
        const ny = t.y + (seen.y - t.y) * smooth;
        // velocity is measured from the smoothed track, then smoothed again: raw
        // frame-to-frame deltas on a 6px dot are far too noisy to threshold on
        t.vx = t.vx * 0.6 + ((nx - t.x) / dt) * 0.4;
        t.vy = t.vy * 0.6 + ((ny - t.y) / dt) * 0.4;
        t.x = nx; t.y = ny;
        t.area = seen.n || t.area;
        t.seenAt = now;
        t.lost = false;
      } else if (now - t.seenAt <= maxMissedMs) {
        t.x += t.vx * dt;      // coast on the last known velocity
        t.y += t.vy * dt;
      } else {
        t.lost = true;
        t.vx = t.vy = 0;
      }

      t.at = now;
      t.speed = Math.hypot(t.vx, t.vy);
      if (t.speed > stopSpeed) { t.stillSince = now; t.everMoved = true; }
      t.stopped = !t.lost && now - t.stillSince > stopMs;

      /*
       * Let go of scenery.
       *
       * Tracks are acquired before the scenery register has seen enough frames to know
       * what is part of the circuit, so the first blob a car claims may well be a kerb.
       * Once it is settled there nothing dislodges it: it is stationary, so the gate
       * keeps pointing at it, and it is the only thing in reach. Releasing the track
       * makes it go looking again, and acquisition prefers things that move.
       *
       * A track that has never moved since it was acquired is released the instant its
       * blob is proven to be scenery: it was wrong from birth and waiting only prolongs
       * the error. One that has driven and then stopped is given the full grace period
       * instead, because a car parked on track behaves identically to scenery and must
       * not be dropped the moment it comes to rest. That window is the same one the PIT
       * and STOPPED indicators already use.
       */
      if (seen && seen.scenery && (!t.everMoved || t.stopped)) {
        t.lost = true;
        t.vx = t.vy = 0;
        t.prev = null;
      }
    }
    return this.tracks;
  }

  /**
   * Every timing line this track crossed on its last step, with the interpolated
   * moment it happened and the direction it was travelling.
   */
  crossings(track, lines) {
    if (!track || !track.prev || track.lost) return [];
    const p = track.prev;
    const q = { x: track.x, y: track.y };
    if (p.x === q.x && p.y === q.y) return [];

    const out = [];
    for (const line of lines) {
      const hit = segIntersect(p, q, line.a, line.b);
      if (!hit) continue;
      const dir = sideOf(line.a, line.b, q) || 1;   // side it ended up on
      if (line.dir && dir !== line.dir) continue;   // wrong way over the line
      out.push({
        line,
        dir,
        at: p.at + hit.t * (track.at - p.at),
        where: hit.u                                 // 0..1 along the line itself
      });
    }
    return out;
  }
}

// ---------------------------------------------------------------- track geometry

/** Cumulative-length parameterisation of the operator-drawn racing line. */
export function buildPath(points) {
  if (!points || points.length < 2) return null;
  const segs = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    segs.push({ a, b, len, start: total });
    total += len;
  }
  return { segs, total };
}

/** Project a point onto the path, returning progress in 0..1 and the distance to it. */
export function projectOnPath(path, p) {
  let best = { progress: 0, dist: Infinity };
  for (const s of path.segs) {
    const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
    const l2 = dx * dx + dy * dy;
    let t = l2 === 0 ? 0 : ((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    const px = s.a.x + t * dx, py = s.a.y + t * dy;
    const dist = Math.hypot(p.x - px, p.y - py);
    if (dist < best.dist) best = { progress: (s.start + t * s.len) / path.total, dist };
  }
  return best;
}

/** The inverse: where along the path a given progress value sits. */
export function pointAtProgress(path, progress) {
  if (!path) return { x: 0, y: 0 };
  const target = Math.max(0, Math.min(1, progress)) * path.total;
  for (const s of path.segs) {
    if (s.start + s.len >= target) {
      const t = s.len ? (target - s.start) / s.len : 0;
      return { x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t };
    }
  }
  const last = path.segs[path.segs.length - 1];
  return { x: last.b.x, y: last.b.y };
}

// ---------------------------------------------------------------- motion detection

/**
 * Finds what moves, rather than what is a particular colour.
 *
 * Colour matching needs enough pixels of the car to survive the game's own rendering,
 * the encoder and the downscale. On a wide drone shot of a big circuit a car is three
 * to five pixels and its colour has been blended into the tarmac underneath it — there
 * is nothing left to match.
 *
 * The circuit, however, does not move. A running average of each pixel is therefore a
 * near-perfect background plate, and anything that departs from it is a car. Three
 * moving pixels against a static plate is a strong signal even when their colour is
 * mush, which is exactly the case colour matching cannot reach.
 *
 * Identity still comes from colour, but taken as the mean over the whole blob rather
 * than per pixel, which survives blending far better.
 */
export class MotionDetector {
  constructor() {
    this.bg = null;         // running average, one float per pixel per channel
    this.w = 0;
    this.h = 0;
    this.warm = 0;
  }

  reset() {
    this.bg = null;
    this.warm = 0;
  }

  /**
   * @param imageData the region to search
   * @param opts.alpha    how fast the plate adapts (0.02 = a few seconds)
   * @param opts.threshold how far a pixel must depart from the plate to count
   * @param opts.minArea  smallest blob worth reporting, in pixels
   * @returns blobs with a centroid in 0..1 and their mean colour
   */
  detect(imageData, { alpha = 0.02, threshold = 26, minArea = 2 } = {}) {
    const { width: w, height: h, data } = imageData;
    const n = w * h;

    if (!this.bg || this.w !== w || this.h !== h) {
      this.w = w; this.h = h;
      this.bg = new Float32Array(n * 3);
      for (let i = 0, p = 0; i < n; i++, p += 4) {
        this.bg[i * 3] = data[p];
        this.bg[i * 3 + 1] = data[p + 1];
        this.bg[i * 3 + 2] = data[p + 2];
      }
      this.warm = 0;
      return { list: [], warming: true };
    }

    ensureScratch(n);
    const labels = scratch.labels;
    const thr2 = threshold * threshold;

    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const b = i * 3;
      const dr = data[p] - this.bg[b];
      const dg = data[p + 1] - this.bg[b + 1];
      const db = data[p + 2] - this.bg[b + 2];
      const moving = dr * dr + dg * dg + db * db > thr2;
      labels[i] = moving ? 0 : -1;

      // A moving pixel updates the plate far more slowly than a still one, so a car
      // that lingers does not paint itself into the background within a lap.
      const a = moving ? alpha * 0.05 : alpha;
      this.bg[b] += dr * a;
      this.bg[b + 1] += dg * a;
      this.bg[b + 2] += db * a;
    }

    this.warm++;
    if (this.warm < 8) return { list: [], warming: true };

    const list = [];
    for (const c of componentsOf(labels, w, h, minArea)) {
      // mean colour over the blob: individually the pixels are blended, together they
      // still carry the car's hue
      let r = 0, g = 0, bl = 0;
      for (const idx of c.pixels) {
        const p = idx * 4;
        r += data[p]; g += data[p + 1]; bl += data[p + 2];
      }
      list.push({
        x: (c.sx / c.n) / w,
        y: (c.sy / c.n) / h,
        n: c.n,
        color: [r / c.n, g / c.n, bl / c.n]
      });
    }
    return { list, warming: false };
  }
}

/** Every connected component of a label map, not just the largest per label. */
export function componentsOf(labels, w, h, minArea = 1) {
  const comp = scratch.comp;
  const parent = [];
  const find = (x) => { while (parent[x] !== x) x = parent[x] = parent[parent[x]]; return x; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (labels[i] < 0) { comp[i] = -1; continue; }
      const left = x > 0 && labels[i - 1] === labels[i] ? comp[i - 1] : -1;
      const up = y > 0 && labels[i - w] === labels[i] ? comp[i - w] : -1;
      if (left < 0 && up < 0) { const id = parent.length; parent.push(id); comp[i] = id; }
      else if (left >= 0 && up >= 0) { comp[i] = left; if (left !== up) union(left, up); }
      else comp[i] = left >= 0 ? left : up;
    }
  }

  const acc = new Map();
  for (let i = 0; i < w * h; i++) {
    if (comp[i] < 0) continue;
    const root = find(comp[i]);
    let a = acc.get(root);
    if (!a) { a = { n: 0, sx: 0, sy: 0, pixels: [] }; acc.set(root, a); }
    a.n++;
    a.sx += i % w;
    a.sy += (i / w) | 0;
    if (a.pixels.length < 400) a.pixels.push(i);
  }

  return [...acc.values()].filter((c) => c.n >= minArea);
}

/**
 * Nearest driver colour to a measured mean colour, or -1 when the answer is not clear.
 *
 * The margin matters more than the distance. When two cars run close together their
 * motion blobs merge and the mean colour lands between two entries in the palette —
 * and a confident wrong answer there is far worse than no answer, because it credits
 * one car's lap to another. A dropped blob only costs a frame; the tracker coasts
 * through it. A misattributed one corrupts the timing.
 */
/**
 * Every car a blob could plausibly belong to, closest first.
 *
 * Naming a blob after its single nearest colour throws away the one case that matters
 * most. When two cars are painted nearly the same, every pixel of both resolves to
 * whichever of the two is marginally closer — so one car is offered every blob and the
 * other is offered none, and no amount of clever tracking can recover a car it is never
 * shown. Handing an ambiguous blob to both and letting position settle it is the only
 * way the second car is ever seen.
 *
 * `spread` is how much further than the best match a rival may be and still be offered:
 * 1.6 means "within 60% more distance". Cars in clearly different colours are never
 * within that of each other, so this costs nothing when the roster is sensible.
 */
export function plausibleColors(rgb, palette, maxDistance = 120, spread = 1.6) {
  const scored = [];
  for (let i = 0; i < palette.length; i++) {
    const d = colorDistance(rgb, palette[i]);
    if (d <= maxDistance) scored.push({ i, d });
  }
  if (!scored.length) return [];
  scored.sort((a, b) => a.d - b.d);
  const limit = scored[0].d * spread;
  return scored.filter((s) => s.d <= limit).map((s) => s.i);
}

export function nearestColor(rgb, palette, maxDistance = 120, margin = 0.7) {
  let best = -1, bestD = Infinity, secondD = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const d = colorDistance(rgb, palette[i]);
    if (d < bestD) { secondD = bestD; bestD = d; best = i; }
    else if (d < secondD) secondD = d;
  }
  if (bestD > maxDistance) return -1;
  // ambiguous: the runner-up is nearly as close, so this blob is probably two cars
  if (secondD < Infinity && bestD > secondD * margin) return -1;
  return best;
}
