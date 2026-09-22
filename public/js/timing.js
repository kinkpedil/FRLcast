/*
 * How a gap is written down.
 *
 * Pure arithmetic and string building, with nothing from a browser or from Node in it, so
 * the broadcast server and a hosted event can both import it. That matters more than it
 * looks: "LEADER", "DNF", "+1 LAP" and "+1.240" are six different cases, and a second copy
 * of these rules would start out identical and drift, leaving the same race described two
 * ways depending on where the overlay got its data.
 */

/** Milliseconds as a gap: seconds to three places, minutes when it runs long. */
export function fmtGap(ms) {
  if (ms == null || Number.isNaN(ms)) return '--';
  const s = ms / 1000;
  if (s < 60) return s.toFixed(3);
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(3).padStart(6, '0')}`;
}

/**
 * Fill in `gap` and `interval` on an already sorted classification.
 *
 * Written onto the drivers rather than returned, because that is the shape every overlay
 * reads and the sort order is the caller's business, not this function's.
 *
 * @param {Array} ranked  drivers in finishing order, position 1 first
 * @param {object} opts   { drift, quali } for the two sessions that measure something else
 */
export function labelGaps(ranked, { drift = false, quali = false } = {}) {
  const leader = ranked[0];

  ranked.forEach((d, i) => {
    d.position = i + 1;

    if (!leader || d === leader) {
      // A drift leader shows their score, because there is nothing to be ahead of yet.
      d.gap = drift ? String(d.driftScore) : 'LEADER';
      d.interval = '';
      return;
    }

    // Somebody who is out is not a number of seconds behind. Saying so is the point.
    if (d.dnf) { d.gap = 'DNF'; d.interval = 'DNF'; return; }

    const ahead = ranked[i - 1];

    if (drift) {
      d.gap = `-${leader.driftScore - d.driftScore}`;
      d.interval = `-${ahead.driftScore - d.driftScore}`;
      return;
    }

    if (quali) {
      // Qualifying compares best laps, not race time: a driver can be quickest and still
      // have spent longer on track than everybody.
      d.gap = d.bestLap == null || leader.bestLap == null
        ? '--' : `+${fmtGap(d.bestLap - leader.bestLap)}`;
      d.interval = d.bestLap == null || ahead.bestLap == null
        ? '--' : `+${fmtGap(d.bestLap - ahead.bestLap)}`;
      return;
    }

    // A lap down is not a time gap and must never be shown as one: "+1 LAP" and "+84.320"
    // would be read as the same distance by anybody glancing at a tower.
    const lapDown = leader.lapsDone - d.lapsDone;
    d.gap = lapDown > 0
      ? `+${lapDown} LAP${lapDown > 1 ? 'S' : ''}`
      : `+${fmtGap(d.totalMs - leader.totalMs)}`;

    const aheadLapDown = ahead.lapsDone - d.lapsDone;
    d.interval = aheadLapDown > 0
      ? `+${aheadLapDown}L`
      : `+${fmtGap(d.totalMs - ahead.totalMs)}`;
  });

  return ranked;
}
