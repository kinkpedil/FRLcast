// Tracking in the space the cars actually live in.
//
// The tracker in tracker.js follows each car as a free point on a plane. That is more
// freedom than a race car has, and every unit of unearned freedom is somewhere the pin
// can go wrong: onto a kerb beside the track, onto another car, into the infield.
//
// A circuit is a closed one-dimensional loop. A car has one meaningful coordinate —
// how far round it is — and that coordinate only ever increases. Tracking in that space
// instead of on the plane changes what is even expressible:
//
//   * a candidate away from the track is not a car, whatever colour it is, and needs no
//     special rule to reject — it simply has no probability mass
//   * a car hidden behind another keeps advancing at its own pace instead of freezing
//   * running order and lap count fall straight out of the coordinate, rather than being
//     reconstructed from line crossings after the fact
//
// The estimator is a particle filter rather than a single predicted point, because the
// hard cases are genuinely ambiguous: two cars in similar colours, or two cars merged
// into one blob, admit several explanations at once. A single-point tracker must commit
// to one every frame and lives with the consequences; a cloud of particles carries the
// alternatives forward and lets later frames settle it. In one dimension this is cheap —
// a hundred particles per car is a few thousand numbers, not a model.
//
// Observations are associated softly (every particle is weighted by every gated
// observation, not assigned to one), which is what lets a merged blob feed two cars
// without either of them being declared the owner.

const TAU = 1;                       // progress is 0..1 round the lap

/** Shortest signed distance from a to b on a loop, in -0.5..0.5. */
export function loopDelta(a, b) {
  let d = b - a;
  d -= Math.floor(d + 0.5);
  return d;
}

/**
 * A closed circuit as an arc-length parameterised polyline.
 * Progress is 0..1 and wraps, so there is no seam to special-case.
 */
export class CircuitPath {
  constructor(points) {
    this.pts = points;
    this.segs = [];
    let total = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];     // closed: last joins first
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len <= 0) continue;
      this.segs.push({ a, b, len, start: total });
      total += len;
    }
    this.total = total;
  }

  /** @returns {{s:number, lateral:number}} progress round the lap, and distance off it */
  project(p) {
    let bestD = Infinity, bestS = 0;
    for (const s of this.segs) {
      const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
      const l2 = dx * dx + dy * dy;
      let t = l2 === 0 ? 0 : ((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = s.a.x + t * dx, qy = s.a.y + t * dy;
      const d = Math.hypot(p.x - qx, p.y - qy);
      if (d < bestD) { bestD = d; bestS = (s.start + t * s.len) / this.total; }
    }
    return { s: bestS, lateral: bestD };
  }

  /** Where a progress value sits on the plane. */
  at(s) {
    const target = ((s % TAU) + TAU) % TAU * this.total;
    for (const g of this.segs) {
      if (g.start + g.len >= target) {
        const t = g.len ? (target - g.start) / g.len : 0;
        return { x: g.a.x + (g.b.x - g.a.x) * t, y: g.a.y + (g.b.y - g.a.y) * t };
      }
    }
    const last = this.segs[this.segs.length - 1];
    return { x: last.b.x, y: last.b.y };
  }
}

/**
 * Works out the shape of the circuit by watching a car drive round it.
 *
 * Asking the operator to trace the track by hand is one more thing to get wrong, and it
 * has to be redone for every venue. But a car that completes a lap has already drawn the
 * circuit — the trajectory *is* the centreline. So positions are recorded as they are
 * tracked, and when the trail comes back to where it started having travelled far enough
 * to be a real lap rather than a wobble, it is closed and resampled into a path.
 *
 * Recording from whichever car is currently most confident, rather than a fixed one,
 * means a car being lost or confused does not poison the geometry.
 */
export class PathLearner {
  constructor({ minLoop = 0.9, sampleGap = 0.006, resampleTo = 160 } = {}) {
    this.minLoop = minLoop;        // total distance to travel before a loop may close
    this.sampleGap = sampleGap;    // how far the car must move to record another point
    this.resampleTo = resampleTo;
    this.trail = [];
    this.travelled = 0;
    this.path = null;
    this.owner = null;
  }

  reset() { this.trail = []; this.travelled = 0; this.path = null; this.owner = null; }

  /** Offer one confident position. Returns the path if this completed it. */
  feed(id, x, y) {
    if (this.path) return this.path;
    if (this.owner && this.owner !== id) return null;
    this.owner = id;

    const last = this.trail[this.trail.length - 1];
    if (last) {
      const step = Math.hypot(x - last.x, y - last.y);
      if (step < this.sampleGap) return null;
      // A jump means the pin moved between objects rather than the car driving. Trusting
      // it would cut a chord across the infield and corrupt the whole circuit.
      if (step > this.sampleGap * 12) { this.reset(); return null; }
      this.travelled += step;
    }
    this.trail.push({ x, y });

    if (this.travelled > this.minLoop * 0.35 && this.trail.length > 24) {
      const first = this.trail[0];
      const back = Math.hypot(x - first.x, y - first.y);
      if (back < this.sampleGap * 3) {
        this.path = new CircuitPath(this.smooth(this.trail));
        return this.path;
      }
    }
    if (this.trail.length > 4000) this.reset();     // never grow without bound
    return null;
  }

  /** Even out tracking noise, then resample to a fixed number of points. */
  smooth(trail) {
    const n = trail.length;
    const soft = trail.map((_, i) => {
      let sx = 0, sy = 0;
      for (let k = -2; k <= 2; k++) {
        const p = trail[(i + k + n) % n];
        sx += p.x; sy += p.y;
      }
      return { x: sx / 5, y: sy / 5 };
    });
    const out = [];
    for (let i = 0; i < this.resampleTo; i++) {
      out.push(soft[Math.floor((i * n) / this.resampleTo)]);
    }
    return out;
  }
}

/**
 * One car's belief about where it is on the lap, carried as a cloud of particles.
 *
 * Each particle is a complete hypothesis: this far round, going this fast. They are all
 * advanced, all scored against what was seen, and the poor ones are replaced by copies
 * of the good ones. The reported position is the cloud's mean; how tightly the cloud is
 * packed is the confidence, which is information a single-point tracker cannot express
 * at all.
 */
class Cloud {
  constructor(n) {
    this.n = n;
    this.s = new Float64Array(n);
    this.v = new Float64Array(n);
    this.w = new Float64Array(n).fill(1 / n);
    this.alive = false;
  }

  seed(s, v, spread) {
    for (let i = 0; i < this.n; i++) {
      this.s[i] = s + (Math.random() - 0.5) * spread;
      this.v[i] = v * (0.6 + Math.random() * 0.8);
      this.w[i] = 1 / this.n;
    }
    this.alive = true;
  }

  /** Circular mean of the cloud, and how spread out it is. */
  summary() {
    let cx = 0, cy = 0, vs = 0;
    for (let i = 0; i < this.n; i++) {
      const a = this.s[i] * Math.PI * 2;
      cx += Math.cos(a) * this.w[i];
      cy += Math.sin(a) * this.w[i];
      vs += this.v[i] * this.w[i];
    }
    const r = Math.hypot(cx, cy);                 // 1 = agreed, 0 = no idea
    let s = Math.atan2(cy, cx) / (Math.PI * 2);
    if (s < 0) s += 1;
    return { s, v: vs, agreement: r };
  }
}

export class ParticleTracker {
  /**
   * @param opts.particles   hypotheses per car
   * @param opts.sSigma      how far a car may be from its prediction, in laps
   * @param opts.lateral     how far off the centreline a sighting may be and still count
   * @param opts.clutter     background probability, so an unexplained frame does not
   *                         force the cloud onto whatever noise was in view
   */
  constructor({ particles = 96, sSigma = 0.012, lateral = 0.05, clutter = 0.25 } = {}) {
    this.cfg = { particles, sSigma, lateral, clutter };
    this.path = null;
    this.clouds = new Map();
    this.tracks = new Map();
    this.direction = 0;        // learned: +1 or -1 round the loop
    this.debug = { unseeded: 0, stale: 0, disagree: 0, alive: 0 };
  }

  reset() { this.clouds.clear(); this.tracks.clear(); this.direction = 0; }

  setPath(path) {
    if (path === this.path) return;
    this.path = path;
    this.clouds.clear();
    this.tracks.clear();
  }

  get(id) { return this.tracks.get(id); }

  /**
   * @param sightings Map driverId -> candidate or array of candidates, in the same
   *   normalised frame coordinates the path is expressed in.
   */
  update(driverIds, sightings, now, opts = {}) {
    if (!this.path) return this.tracks;
    const { maxMissedMs = 900, stopSpeed = 0.004, stopMs = 3000 } = opts;
    const { particles, sSigma, lateral, clutter } = this.cfg;

    for (const id of driverIds) {
      const offered = sightings.get(id);
      const raw = Array.isArray(offered) ? offered : (offered ? [offered] : []);

      // Project once per observation, not once per particle: this is the only part of
      // the frame whose cost grows with the size of the circuit.
      const obs = [];
      for (const c of raw) {
        const pr = this.path.project(c);
        if (pr.lateral > lateral) continue;         // not on the circuit, so not a car
        obs.push({ s: pr.s, lateral: pr.lateral, n: c.n, scenery: !!c.scenery, raw: c });
      }

      let cloud = this.clouds.get(id);
      let t = this.tracks.get(id);

      if (!cloud || !cloud.alive) {
        const live = obs.filter((o) => !o.scenery);
        if (!live.length) { this.debug.unseeded++; continue; }
        const pick = live.reduce((a, b) => (b.n > a.n ? b : a));
        cloud = cloud || new Cloud(particles);
        cloud.seed(pick.s, 0, sSigma * 4);
        this.clouds.set(id, cloud);
        const at = this.path.at(pick.s);
        this.tracks.set(id, {
          id, x: at.x, y: at.y, vx: 0, vy: 0, prev: null,
          progress: pick.s, agreement: 0, speed: 0, pace: null,
          seenAt: now, at: now, stopped: false, stillSince: now,
          lost: false, area: pick.n || 0, everMoved: false
        });
        continue;
      }

      const dt = Math.max(0.001, (now - t.at) / 1000);

      /*
       * Predict.
       *
       * Speed is estimated for the car as a whole rather than carried by each particle.
       * Letting every particle hold its own velocity sounds more general, but velocity
       * is only ever observed through position, so those extra dimensions are explored
       * by random walk alone — and a walk small enough to be stable takes hundreds of
       * frames to reach racing speed, by which time the cloud has been left behind by
       * the car it is supposed to be following. Estimating the one speed directly from
       * how far the cloud has moved converges in a few frames instead.
       *
       * The spread grows with speed: a fast car is less predictable between frames than
       * a slow one, and the cloud has to be wide enough to still contain the truth.
       */
      const spread = Math.max(sSigma * 0.6, Math.abs(t.pace || 0) * dt * 0.4);
      for (let i = 0; i < cloud.n; i++) {
        const g = (Math.random() + Math.random() + Math.random() - 1.5) * 1.1;  // ~normal
        cloud.s[i] = (cloud.s[i] + (t.pace || 0) * dt + g * spread + 1) % 1;
      }

      /*
       * Validate before associating.
       *
       * Soft association is what lets a merged blob feed two cars, but it must be soft
       * only among explanations that are actually plausible. Every blob of a similar
       * colour anywhere on the circuit is offered to this car; weighting the cloud
       * against all of them drags probability mass to the far side of the lap, the cloud
       * goes bimodal, and a car that is being seen perfectly well is reported as lost
       * because its own estimate no longer agrees with itself. So observations are gated
       * against the prediction first, and only the survivors get a vote.
       *
       * The gate grows with speed, because a fast car covers more ground between frames
       * and its next sighting is legitimately further away.
       */
      let centre = 0, cy0 = 0;
      for (let i = 0; i < cloud.n; i++) {
        const a2 = cloud.s[i] * Math.PI * 2;
        centre += Math.cos(a2) * cloud.w[i];
        cy0 += Math.sin(a2) * cloud.w[i];
      }
      let predS = Math.atan2(cy0, centre) / (Math.PI * 2);
      if (predS < 0) predS += 1;
      const gate = Math.max(sSigma * 5, Math.abs(t.pace || 0) * dt * 4);
      const near = obs.filter((o) => Math.abs(loopDelta(predS, o.s)) <= gate);

      // ---- weight: soft association across the surviving explanations
      let sum = 0;
      const inv2s2 = 1 / (2 * sSigma * sSigma);
      for (let i = 0; i < cloud.n; i++) {
        let p = clutter;
        for (const o of near) {
          const d = loopDelta(cloud.s[i], o.s);
          // scenery is not excluded outright, only heavily discounted: a car stopped on
          // track looks exactly like scenery, and refusing it would lose the car
          const q = Math.exp(-d * d * inv2s2) * (o.scenery ? 0.15 : 1);
          p += q;
        }
        cloud.w[i] *= p;
        sum += cloud.w[i];
      }

      const seenSomething = near.some((o) => !o.scenery);
      if (sum <= 1e-12) {
        for (let i = 0; i < cloud.n; i++) cloud.w[i] = 1 / cloud.n;
      } else {
        for (let i = 0; i < cloud.n; i++) cloud.w[i] /= sum;
      }

      // ---- resample when the cloud has collapsed onto a few particles
      let ess = 0;
      for (let i = 0; i < cloud.n; i++) ess += cloud.w[i] * cloud.w[i];
      ess = 1 / Math.max(1e-12, ess);
      if (ess < cloud.n * 0.5) this.resample(cloud);

      const est = cloud.summary();

      /*
       * Report the measurement, not the model.
       *
       * The circuit is what makes association reliable — it says where a car can be and
       * which blobs are even candidates. It is not, however, an accurate account of
       * where the car is: it is a polyline learned from a smoothed trail, so a position
       * read off it is quantised to that geometry. Timing lines are crossed at an
       * interpolated instant between two positions, and feeding them path-quantised
       * points cost more than a lap time is worth — measured at 65-74ms of error against
       * 5ms from the raw sightings.
       *
       * So the filter decides *which* blob is this car, and the blob itself says where.
       * The path is only fallen back on while the car is unseen, which is exactly when
       * coasting along the circuit beats coasting in a straight line.
       */
      let anchor = null;
      let bestD = Infinity;
      for (const o of near) {
        const d = Math.abs(loopDelta(est.s, o.s));
        if (d < bestD) { bestD = d; anchor = o; }
      }
      const at = anchor
        ? { x: t.x + (anchor.raw.x - t.x) * 0.45, y: t.y + (anchor.raw.y - t.y) * 0.45 }
        : this.path.at(est.s);

      const prevProgress = t.progress;
      const moved = loopDelta(prevProgress, est.s);

      // Speed, smoothed. Raw frame-to-frame progress on a small blob is far too noisy
      // to predict with, but its average over a second or so is exactly the pace.
      const rate = moved / dt;
      t.pace = t.pace == null ? rate : t.pace * 0.82 + rate * 0.18;
      if (this.direction && Math.sign(t.pace) !== this.direction) t.pace *= 0.6;
      t.prev = { x: t.x, y: t.y, at: t.at };
      t.progress = est.s;
      t.agreement = est.agreement;
      t.x = at.x; t.y = at.y;
      t.vx = (t.x - t.prev.x) / dt;
      t.vy = (t.y - t.prev.y) / dt;
      t.speed = Math.abs(t.pace);
      t.at = now;
      if (seenSomething) t.seenAt = now;

      const step = moved;
      if (Math.abs(step) / dt > stopSpeed) { t.stillSince = now; t.everMoved = true; }
      t.stopped = now - t.stillSince > stopMs;

      // Direction is learned from the whole field, so one confused car cannot flip it.
      if (Math.abs(step) > 1e-5 && est.agreement > 0.6) {
        this.direction = this.direction === 0
          ? Math.sign(step)
          : (Math.abs(step) > 0.0002 ? this.direction : this.direction);
      }

      /*
       * Lost is reported when the cloud stops agreeing, not merely when nothing was
       * seen. A car behind another is unseen but perfectly well known; a car whose
       * particles have scattered across the lap is genuinely unknown, and saying so is
       * more useful than printing a confident position that is a guess.
       */
      const stale = now - t.seenAt > maxMissedMs;
      t.lost = stale || est.agreement < 0.25;
      if (stale) this.debug.stale++;
      else if (t.lost) this.debug.disagree++;
      else this.debug.alive++;
      if (t.lost) { cloud.alive = false; t.prev = null; }
    }

    return this.tracks;
  }

  /** Systematic resampling: low variance, and one pass. */
  resample(cloud) {
    const n = cloud.n;
    const s = new Float64Array(n);
    const v = new Float64Array(n);
    const step = 1 / n;
    let u = Math.random() * step;
    let acc = cloud.w[0];
    let j = 0;
    for (let i = 0; i < n; i++) {
      while (u > acc && j < n - 1) { j++; acc += cloud.w[j]; }
      s[i] = cloud.s[j];
      v[i] = cloud.v[j];
      u += step;
    }
    cloud.s.set(s);
    cloud.v.set(v);
    cloud.w.fill(1 / n);
  }
}
