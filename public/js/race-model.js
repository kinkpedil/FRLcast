/*
 * What is likely to happen, from what has happened.
 *
 * The commentary needs to say more than what just occurred: whether a lead is safe, who is
 * still in the podium fight, who is about to lose something. Those are questions about the
 * future, and the honest way to answer them is to run the race forward from each driver's
 * own measured pace rather than to have a language model guess at a number.
 *
 * So this is arithmetic, with nothing from a browser or from Node in it. Same reason as
 * timing.js: the overlay, the console and a desktop test all run the identical code, and a
 * probability shown on the broadcast can be reproduced in a test that takes no screenshots.
 *
 * ------------------------------------------------------------------ one warning, encoded
 *
 * `totalMs` does not mean the same thing on both sides. The console computes a driver's
 * absolute race time; a hosted overlay receives the deficit to the leader, because that is
 * what the database stores. Every driver moves by the same constant between the two, so
 * differences are identical and absolutes are not. Nothing below may read totalMs except
 * through deficits(), which subtracts the leader.
 */

// ---------------------------------------------------------------- pace

/**
 * How quickly a driver is lapping, and how consistently.
 *
 * The mean alone would make a driver who has had one safety car lap look half a second
 * slower than they are for the rest of the race, so the slow tail is trimmed: a lap far
 * above this driver's own median is a lap behind a yellow, a pit stop or a spin, and none
 * of those describe the pace they will run next lap.
 *
 * Returns null rather than a guess when there is not enough to go on. A caller that cannot
 * cope with null is a caller that would otherwise print a made up number.
 */
export function paceOf(driver, { minLaps = 2 } = {}) {
  const laps = (driver.lapTimes || []).filter((t) => t > 0);
  if (laps.length < minLaps) return null;

  const sorted = [...laps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const kept = laps.filter((t) => t <= median * 1.35);
  const use = kept.length >= minLaps ? kept : laps;

  const mean = use.reduce((n, t) => n + t, 0) / use.length;

  /*
   * Spread, with a floor under it.
   *
   * Two laps within a few thousandths of each other produce a standard deviation near
   * zero, and a simulation run from that says the race is already decided when it plainly
   * is not. The floor is one per cent of a lap, which is about what a consistent driver
   * varies by anyway, so early confidence stays honest.
   */
  const variance = use.reduce((n, t) => n + (t - mean) ** 2, 0) / Math.max(1, use.length - 1);
  const sd = Math.max(Math.sqrt(variance), mean * 0.01);

  return { mean, sd, laps: use.length };
}

/** Each driver's deficit to the leader in milliseconds, whichever side built the state. */
function deficits(drivers) {
  const base = Math.min(...drivers.map((d) => d.totalMs || 0));
  const out = new Map();
  for (const d of drivers) out.set(d.id, (d.totalMs || 0) - base);
  return out;
}

// ---------------------------------------------------------------- the simulation

/** Normal deviate, Box-Muller. Two uniforms in, one sample out. */
function gauss(rand) {
  const u = 1 - rand();
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * A small deterministic generator.
 *
 * Two overlays showing the same race must agree, and a test must be able to assert on an
 * exact number. Math.random gives neither. Seeded from the lap and the number of cars, so
 * the figures move as the race moves rather than shimmering between frames.
 */
function rng(seed) {
  let s = (seed | 0) || 1;
  return () => {
    s ^= s << 13; s |= 0;
    s ^= s >>> 17;
    s ^= s << 5; s |= 0;
    return ((s >>> 0) % 100000) / 100000;
  };
}

/**
 * Win and podium probability, by running the rest of the race many times.
 *
 * Each simulated lap is a sample from that driver's own pace, so a driver who has been
 * quick and consistent finishes ahead in most runs and a driver who has been quick once
 * does not. Cars a lap down simply have more laps left to cover, which is exactly why they
 * lose: no separate rule is needed for them.
 *
 * @param {Array}  runners  drivers still classified, leader first
 * @param {number} totalLaps
 * @param {number} runs
 */
function simulate(runners, totalLaps, runs, seed) {
  const rand = rng(seed);
  const gap = deficits(runners);
  const wins = new Map(runners.map((d) => [d.id, 0]));
  const podiums = new Map(runners.map((d) => [d.id, 0]));

  // A driver with no measured pace cannot be simulated, and the field's median is a much
  // better stand-in than nothing: it says "about like everybody else", which for a car
  // that has just joined is the only defensible claim.
  const paces = runners.map((d) => paceOf(d));
  const known = paces.filter(Boolean).map((p) => p.mean).sort((a, b) => a - b);
  const fallbackMean = known.length ? known[Math.floor(known.length / 2)] : 60000;

  const plan = runners.map((d, i) => {
    const p = paces[i] || { mean: fallbackMean, sd: fallbackMean * 0.03, laps: 0 };
    return {
      id: d.id,
      start: gap.get(d.id),
      left: Math.max(0, totalLaps - (d.lapsDone || 0)),
      mean: p.mean,
      sd: p.sd
    };
  });

  const times = new Array(plan.length);
  for (let r = 0; r < runs; r++) {
    for (let i = 0; i < plan.length; i++) {
      const c = plan[i];
      let t = c.start;
      for (let l = 0; l < c.left; l++) t += Math.max(c.mean * 0.75, c.mean + gauss(rand) * c.sd);
      times[i] = t;
    }
    // Rank this run. A full sort per run costs more than it buys with a dozen cars, so the
    // three places that matter are picked out directly.
    let first = 0;
    for (let i = 1; i < times.length; i++) if (times[i] < times[first]) first = i;
    wins.set(plan[first].id, wins.get(plan[first].id) + 1);

    const order = times.map((t, i) => [t, i]).sort((a, b) => a[0] - b[0]);
    for (let k = 0; k < Math.min(3, order.length); k++) {
      const id = plan[order[k][1]].id;
      podiums.set(id, podiums.get(id) + 1);
    }
  }

  return { wins, podiums, runs };
}

// ---------------------------------------------------------------- what is going wrong

/**
 * Trouble, as signals rather than as a probability.
 *
 * There is no honest number for "chance of a problem": FR Legends has no tyres and no fuel
 * to model, and a retirement rate invented to fill the gap would be a decoration with a
 * percent sign on it. What can be said is what is actually visible, and every one of these
 * is something an operator or a viewer could point at on the screen.
 */
export function risksOf(state, { previous = null } = {}) {
  const out = [];
  const drivers = state.drivers || [];
  const byId = new Map(drivers.map((d) => [d.id, d]));

  for (const d of drivers) {
    if (d.dnf) continue;

    if (d.blackFlag) out.push({ driverId: d.id, kind: 'blackflag', weight: 100 });
    if (d.penaltyPending) out.push({ driverId: d.id, kind: 'investigation', weight: 70 });
    if (d.stopped) out.push({ driverId: d.id, kind: 'stopped', weight: 90 });
    if (d.pit) out.push({ driverId: d.id, kind: 'pit', weight: 40 });
    if (d.blueFlag) out.push({ driverId: d.id, kind: 'blue', weight: 30 });

    // Losing their own pace, measured against themselves rather than against the field: a
    // slow car dropping off is news, a slow car staying slow is not.
    const laps = (d.lapTimes || []).filter((t) => t > 0);
    if (laps.length >= 5) {
      const recent = laps.slice(-3);
      const best = [...laps].sort((a, b) => a - b).slice(0, 5);
      const avg = (xs) => xs.reduce((n, t) => n + t, 0) / xs.length;
      const off = (avg(recent) - avg(best)) / avg(best);
      if (off > 0.025) {
        out.push({ driverId: d.id, kind: 'fading', weight: Math.min(80, off * 1000), off });
      }
    }

    // Somebody closing. Read from the previous outlook rather than from a stored value,
    // so it survives a reload with nothing worse than one quiet lap.
    if (previous && previous.gaps) {
      const was = previous.gaps.get(d.id);
      const ahead = drivers.find((x) => x.position === d.position - 1);
      if (was != null && ahead) {
        const now = (d.totalMs || 0) - (ahead.totalMs || 0);
        const closing = was - now;
        if (now > 0 && now < 3000 && closing > 250) {
          out.push({ driverId: d.id, kind: 'closing', weight: 50, on: ahead.id, closing, gap: now });
          out.push({ driverId: ahead.id, kind: 'underpressure', weight: 55, from: d.id, gap: now });
        }
      }
    }
  }

  return out.sort((a, b) => b.weight - a.weight).map((r) => ({
    ...r, driver: byId.get(r.driverId) || null
  }));
}

// ---------------------------------------------------------------- the whole picture

/** Words for a probability, because a percent on its own oversells thin evidence. */
function band(p, sample) {
  if (sample < 3) return 'unknown';
  if (p >= 0.75) return 'strong';
  if (p >= 0.4) return 'favoured';
  if (p >= 0.15) return 'live';
  if (p > 0.02) return 'outside';
  return 'remote';
}

/**
 * Everything the commentary is allowed to claim.
 *
 * @param {object} state     the broadcast state, either side
 * @param {object} opts      { runs, previous } — previous is the last outlook, for deltas
 */
export function outlook(state, { runs = 2000, previous = null } = {}) {
  const race = state.race || {};
  const sessionType = (state.event || {}).sessionType || 'race';
  const drivers = (state.drivers || []).slice().sort((a, b) => a.position - b.position);

  const gaps = new Map(drivers.map((d) => [d.id, d.totalMs || 0]));
  const risks = risksOf(state, { previous });

  const base = {
    mode: sessionType,
    status: race.status,
    lapsLeft: null,
    confidence: 'none',
    drivers: [],
    risks,
    gaps
  };

  // Only a race that is running and knows how long it is can be projected forward. A drift
  // event is decided by judges, and qualifying by one lap nobody has driven yet; saying
  // nothing is the correct output for both.
  const totalLaps = race.totalLaps || 0;
  const runners = drivers.filter((d) => !d.dnf && !d.finished && !d.blackFlag);
  if (sessionType !== 'race' || !totalLaps || race.status === 'idle' || !race.startedAt
      || runners.length < 2) {
    return base;
  }

  const leaderLaps = Math.max(0, ...drivers.map((d) => d.lapsDone || 0));
  base.lapsLeft = Math.max(0, totalLaps - leaderLaps);

  const measured = runners.filter((d) => paceOf(d)).length;
  base.confidence = measured < 2 ? 'none'
    : leaderLaps < 3 ? 'thin'
    : 'fair';
  if (base.confidence === 'none') return base;

  const seed = leaderLaps * 1000 + runners.length * 7 + (base.lapsLeft || 0);
  const { wins, podiums } = simulate(runners, totalLaps, runs, seed);

  base.drivers = runners.map((d) => {
    const p = paceOf(d);
    const win = wins.get(d.id) / runs;
    const podium = podiums.get(d.id) / runs;
    return {
      id: d.id, num: d.num, name: d.name, position: d.position,
      win, podium,
      band: band(win, p ? p.laps : 0),
      pace: p,
      sample: p ? p.laps : 0
    };
  }).sort((a, b) => b.win - a.win);

  return base;
}
