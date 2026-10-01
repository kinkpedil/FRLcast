/*
 * How a championship is scored.
 *
 * Lifted out of RaceState so that more than one thing can ask the question. The console
 * needs it to build the table; the post-race report needs it to answer the question an
 * operator is actually asked in the Discord channel afterwards: "so where does that leave
 * the title?", which means scoring a round that has not been added to the championship yet
 * and running the table both with and without it.
 *
 * Written here once rather than twice on purpose. The same shortcut was taken earlier in
 * this project with the wording of a penalty: two places composed the sentence, they were
 * identical on the Monday and different by the Tuesday, and a driver's phone disagreed with
 * the broadcast about what they had been given. Points are worse, because nobody notices
 * until somebody is handed the wrong trophy.
 *
 * Pure. No browser, no Node, no state object: only the rows and the rules.
 */

/**
 * Points for one round's classification.
 *
 * @param {Array}  rows    [{ driverId, name, num, color, position, dnf, fastestLap, pole }]
 * @param {object} points  { table: [25,18,...], fastestLap, pole }
 */
export function scoreRound(rows, points = {}) {
  const table = Array.isArray(points.table) ? points.table : [];
  return rows.map((r, i) => {
    const position = r.position || i + 1;
    // A retirement scores nothing however far up the classification it is listed.
    const base = r.dnf ? 0 : (table[position - 1] || 0);
    const bonus = (!r.dnf && r.fastestLap ? (points.fastestLap || 0) : 0) +
                  (!r.dnf && r.pole ? (points.pole || 0) : 0);
    return {
      driverId: r.driverId,
      name: r.name,
      num: r.num,
      color: r.color,
      position,
      dnf: !!r.dnf,
      fastestLap: !!r.fastestLap,
      pole: !!r.pole,
      points: base + bonus
    };
  });
}

/**
 * The table, from every round scored so far.
 *
 * Ties are broken by countback (most wins, then most seconds, and so on) which is how
 * every real series settles them. Total points alone would leave two drivers level with
 * nothing to separate them, and a championship that ends in a shrug is worse than one
 * decided by a rule nobody likes.
 *
 * @param {Array}  rounds  [{ results: [scored rows] }]
 * @param {object} points  { dropWorst }
 */
export function standingsFrom(rounds = [], points = {}) {
  const drop = Math.max(0, points.dropWorst || 0);
  const by = new Map();

  for (const round of rounds) {
    for (const r of round.results || []) {
      let e = by.get(r.driverId);
      if (!e) {
        e = { driverId: r.driverId, name: r.name, num: r.num, color: r.color, scores: [], finishes: [] };
        by.set(r.driverId, e);
      }
      // the most recent round wins for display, so a rename shows the current name
      e.name = r.name; e.num = r.num; e.color = r.color;
      e.scores.push(r.points);
      e.finishes.push(r.dnf ? 999 : r.position);
    }
  }

  const out = [...by.values()].map((e) => {
    const kept = [...e.scores].sort((a, b) => b - a).slice(0, Math.max(1, e.scores.length - drop));
    const counts = {};
    for (const f of e.finishes) if (f < 999) counts[f] = (counts[f] || 0) + 1;
    return {
      ...e,
      rounds: e.scores.length,
      dropped: e.scores.length - kept.length,
      points: kept.reduce((n, v) => n + v, 0),
      counts
    };
  });

  out.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    for (let pos = 1; pos <= 30; pos++) {
      const d = (b.counts[pos] || 0) - (a.counts[pos] || 0);
      if (d) return d;
    }
    return String(a.name).localeCompare(String(b.name));
  });
  out.forEach((e, i) => { e.rank = i + 1; });
  return out;
}

/*
 * Licence points: the penalty record a driver carries from round to round.
 *
 * A time penalty settles one race; it says nothing about the driver who collects one every
 * week. Leagues answer that the way real series do: each decided penalty also costs points
 * on a licence, and reaching the limit costs a race. Kept here, beside the championship
 * maths, for the same reason: the console, the server's driver endpoint and the report all
 * ask the question, and they must not answer it three ways.
 *
 * Only decided penalties count. An open investigation is not a verdict, and a dropped one
 * was found to be nothing.
 */
export const LICENCE_DEFAULT = {
  on: false,
  threshold: 12,
  // A warning is a warning; the rest scale with how much the race was taken from someone.
  perKind: { warning: 0, time: 1, drivethrough: 2, blackflag: 3, dq: 4 }
};

/** Points one penalty puts on a licence: the steward's own figure if they gave one. */
export function penaltyPoints(p, cfg = LICENCE_DEFAULT) {
  if (p && p.points != null && p.points !== '' && Number.isFinite(Number(p.points))) {
    return Math.max(0, Math.round(Number(p.points)));
  }
  const per = { ...LICENCE_DEFAULT.perKind, ...((cfg && cfg.perKind) || {}) };
  return Math.max(0, Number(per[p && p.type]) || 0);
}

/**
 * One session's penalties as licence entries, one per driver.
 *
 * @param {Array}  penalties  race-control penalties [{ driverId, type, seconds, reason, status, points }]
 * @param {Array}  drivers    [{ id, name, num }] for the names to file them under
 * @param {Array}  rounds     banked rounds: a penalty already charged to one is skipped. Read
 *                            from the rounds rather than a flag on the penalty, because a
 *                            hosted event reloads its penalties from a table with no such column.
 */
export function licenceEntries(penalties = [], drivers = [], cfg = LICENCE_DEFAULT, rounds = []) {
  const who = new Map(drivers.map((d) => [d.id, d]));
  const charged = new Set(rounds.flatMap((r) => (r.licence || []).flatMap((e) => (e.items || []).map((it) => it.id))).filter(Boolean));
  const by = new Map();
  for (const p of penalties) {
    // Applied only, and not yet charged to a banked round: banking twice must not charge twice.
    if (p.status !== 'applied' || p.banked || charged.has(p.id)) continue;
    const pts = penaltyPoints(p, cfg);
    if (!pts) continue;
    let e = by.get(p.driverId);
    if (!e) {
      const d = who.get(p.driverId) || {};
      e = { driverId: p.driverId, name: d.name || '', num: d.num || '', points: 0, items: [] };
      by.set(p.driverId, e);
    }
    e.points += pts;
    e.items.push({ id: p.id, type: p.type, seconds: p.seconds || 0, reason: p.reason || '', points: pts });
  }
  return [...by.values()];
}

/**
 * Every driver's licence across the banked rounds.
 *
 * Points add up round by round. The round that takes a driver to the limit earns a ban
 * for the next round and wipes the licence clean, so a ban is paid once and not again
 * every week after. `pending` is what the session on the timing screen would add if it
 * were banked now, so a steward sees the consequence before deciding.
 *
 * @param {Array}  rounds   championship rounds, oldest first, each with `licence` entries
 * @param {object} cfg      { threshold, perKind }
 * @param {Array}  pending  licenceEntries() for the session not yet banked
 * @returns {Array} [{ driverId, name, num, points, pending, season, bans, banned, bannedWith }]
 */
export function licenceFrom(rounds = [], cfg = LICENCE_DEFAULT, pending = []) {
  const threshold = Math.max(1, Math.round(Number(cfg && cfg.threshold) || LICENCE_DEFAULT.threshold));
  const by = new Map();
  const get = (id, name, num) => {
    let e = by.get(id);
    if (!e) {
      e = { driverId: id, name: name || '', num: num || '', points: 0, pending: 0, season: 0, bans: 0, banned: false, bannedWith: 0 };
      by.set(id, e);
    }
    if (name) e.name = name;
    if (num) e.num = num;
    return e;
  };
  for (const round of rounds) {
    // A ban earned by the previous round is served by this one.
    for (const e of by.values()) e.banned = false;
    for (const it of round.licence || []) {
      const e = get(it.driverId, it.name, it.num);
      e.points += it.points || 0;
      e.season += it.points || 0;
    }
    for (const e of by.values()) {
      if (e.points >= threshold) {
        e.banned = true;
        e.bannedWith = e.points;
        e.bans += 1;
        e.points = 0;
      }
    }
  }
  for (const it of pending) get(it.driverId, it.name, it.num).pending += it.points || 0;
  const out = [...by.values()].map((e) => ({ ...e, threshold, atRisk: e.points + e.pending >= threshold }));
  out.sort((a, b) => (b.banned - a.banned) || (b.points + b.pending) - (a.points + a.pending)
    || String(a.name).localeCompare(String(b.name)));
  return out;
}
