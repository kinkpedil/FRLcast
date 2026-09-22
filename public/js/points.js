/*
 * How a championship is scored.
 *
 * Lifted out of RaceState so that more than one thing can ask the question. The console
 * needs it to build the table; the post-race report needs it to answer the question an
 * operator is actually asked in the Discord channel afterwards — "so where does that leave
 * the title?" — which means scoring a round that has not been added to the championship yet
 * and running the table both with and without it.
 *
 * Written here once rather than twice on purpose. The same shortcut was taken earlier in
 * this project with the wording of a penalty: two places composed the sentence, they were
 * identical on the Monday and different by the Tuesday, and a driver's phone disagreed with
 * the broadcast about what they had been given. Points are worse, because nobody notices
 * until somebody is handed the wrong trophy.
 *
 * Pure. No browser, no Node, no state object — only the rows and the rules.
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
 * Ties are broken by countback — most wins, then most seconds, and so on — which is how
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
