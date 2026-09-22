/*
 * The race, after it has finished.
 *
 * Everything here already happened and is already stored. What was missing was somewhere to
 * read it: the operator finishes a round, the overlays go dark, and the answer to "so what
 * happened" lives in twelve rows of a timing screen nobody outside the stream ever saw.
 *
 * So this assembles one report from the state and nothing else. No new data is collected,
 * no new table is written, and it can be built for a race that finished ten minutes ago or
 * ten weeks ago from the same rows.
 *
 * Pure, like the model and the commentary. The page that renders it is a separate file, and
 * the whole of this can be checked on a desktop against a race nobody had to run.
 *
 * ------------------------------------------------------------------ one warning, again
 *
 * `totalMs` is absolute race time on the console and the deficit to the leader on a hosted
 * overlay. Only differences between drivers mean the same thing on both sides, so nothing
 * below reads it except through gapTo().
 */

import { fmtGap } from './timing.js';
import { scoreRound, standingsFrom } from './points.js';

/** Milliseconds between two cars, or null when one of them has no time at all. */
function gapTo(a, b) {
  if (!a || !b || a.totalMs == null || b.totalMs == null) return null;
  return b.totalMs - a.totalMs;
}

/** A lap time as it is written on a results sheet. */
export function lapTime(ms) {
  if (ms == null) return null;
  const total = ms / 1000;
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return m ? `${m}:${s.toFixed(3).padStart(6, '0')}` : s.toFixed(3);
}

const PEN_WORDS = {
  time: 'Time penalty', warning: 'Warning', drivethrough: 'Drive through',
  blackflag: 'Black flag', dq: 'Disqualified', note: 'Note'
};

function penaltyHeadline(p) {
  return p.type === 'time' ? `+${p.seconds}s` : (PEN_WORDS[p.type] || 'Decision');
}

/**
 * Everything worth printing about a finished race.
 *
 * @param {object} state  the broadcast state, either side
 * @returns {object} a report, or one with `empty` set when there is nothing to say
 */
export function buildReport(state) {
  const race = state.race || {};
  const event = state.event || {};
  const champ = state.championship || {};
  const drivers = (state.drivers || []).slice().sort((a, b) => a.position - b.position);

  const report = {
    event: {
      name: event.name || 'UNTITLED EVENT',
      round: event.round || '',
      track: event.track || '',
      session: event.sessionName || '',
      type: event.sessionType || 'race',
      totalLaps: race.totalLaps || 0,
      startedAt: race.startedAt || null,
      finishedAt: race.finishedAt || null
    },
    // Said plainly rather than hidden: a report built mid-race is a provisional one, and an
    // operator pasting it into a channel should know which they have.
    provisional: race.status !== 'finished',
    empty: !drivers.length,
    classification: [],
    winner: null,
    margin: null,
    fastest: null,
    penalties: [],
    movers: [],
    retirements: [],
    round: { scored: [], counted: false },
    standings: { before: [], after: [], moved: [] }
  };
  if (report.empty) return report;

  // ---------------------------------------------------------------- the classification
  //
  // The grid gives every driver a place to have started from. Without one there is no
  // honest way to say who gained: a report that invents a starting position is a report
  // that hands somebody a "biggest mover" they never earned.
  const grid = Array.isArray(race.grid) ? race.grid : [];
  const startOf = new Map(grid.map((id, i) => [id, i + 1]));
  const leader = drivers.find((d) => !d.dnf) || drivers[0];

  report.classification = drivers.map((d, i) => {
    const ahead = drivers[i - 1];
    const from = startOf.get(d.id) || null;
    return {
      position: d.position || i + 1,
      num: d.num,
      name: d.name,
      team: d.team || '',
      color: d.color,
      laps: d.lapsDone || 0,
      best: d.bestLap ?? null,
      bestText: lapTime(d.bestLap),
      gapMs: d.dnf ? null : gapTo(leader, d),
      intervalMs: d.dnf || !ahead || ahead.dnf ? null : gapTo(ahead, d),
      dnf: !!d.dnf,
      penaltySec: d.penaltyServed || 0,
      startedAt: from,
      gained: from ? from - (d.position || i + 1) : null
    };
  });

  // ---------------------------------------------------------------- the headline
  const first = report.classification.find((r) => !r.dnf) || null;
  const second = report.classification.filter((r) => !r.dnf)[1] || null;
  if (first) {
    report.winner = first;
    // The margin only means something when the car behind covered the same distance.
    report.margin = second && second.laps === first.laps
      ? { ms: second.gapMs, text: second.gapMs == null ? null : `+${fmtGap(second.gapMs)}`, to: second }
      : second
        ? { ms: null, text: `+${first.laps - second.laps} lap${first.laps - second.laps > 1 ? 's' : ''}`, to: second }
        : null;
  }

  const timed = report.classification.filter((r) => r.best != null);
  if (timed.length) {
    const quick = timed.reduce((a, b) => (b.best < a.best ? b : a));
    const next = timed.filter((r) => r !== quick).sort((a, b) => a.best - b.best)[0];
    report.fastest = {
      ...quick,
      marginMs: next ? next.best - quick.best : null,
      marginText: next ? `+${fmtGap(next.best - quick.best)}` : null
    };
  }

  // ---------------------------------------------------------------- stewarding
  const byId = new Map(drivers.map((d) => [d.id, d]));
  report.penalties = (race.penalties || [])
    .filter((p) => p.status !== 'dropped')
    .map((p) => {
      const d = byId.get(p.driverId);
      return {
        id: p.id,
        driver: d ? d.name : 'UNKNOWN',
        num: d ? d.num : '',
        headline: penaltyHeadline(p),
        type: p.type,
        seconds: p.seconds || 0,
        reason: p.reason || 'Incident',
        lap: p.lap || 0,
        open: p.status === 'investigating'
      };
    })
    .sort((a, b) => a.lap - b.lap);

  report.retirements = report.classification.filter((r) => r.dnf);

  // Who gained the most, only when a grid was actually set.
  report.movers = report.classification
    .filter((r) => r.gained != null && r.gained > 0 && !r.dnf)
    .sort((a, b) => b.gained - a.gained)
    .slice(0, 3);

  // ---------------------------------------------------------------- the championship
  //
  // The question an operator is asked within a minute of the flag. Answering it means
  // scoring this round whether or not it has been added yet, and running the table both
  // ways — which is the whole reason the scoring rules were lifted into points.js.
  const points = champ.points || {};
  const rounds = champ.rounds || [];

  const rows = report.classification.map((r) => ({
    driverId: drivers.find((d) => d.num === r.num && d.name === r.name)?.id,
    name: r.name, num: r.num, color: r.color,
    position: r.position, dnf: r.dnf,
    fastestLap: !!(report.fastest && report.fastest.num === r.num && report.fastest.name === r.name),
    pole: r.startedAt === 1
  }));
  report.round.scored = scoreRound(rows, points);

  /*
   * Is this round already in the championship?
   *
   * A round carries no reference to the session it came from, so it has to be recognised by
   * what is in it. The first attempt compared only which drivers were listed, and the same
   * twelve drivers turn out for every round of a league — so round one was mistaken for
   * round three, quietly dropped from the "before" table, and the report announced a
   * championship swing that had not happened.
   *
   * Two things have to agree now: the name the operator gave it, and the finishing order
   * driver by driver. When they do not, this counts as a round not yet added — which is the
   * safe way round, because that case is labelled on screen and the other is not.
   */
  const sameOrder = (results) =>
    results.length === report.round.scored.length
    && results.every((r, i) => r.driverId === report.round.scored[i].driverId
                            && r.position === report.round.scored[i].position);
  const named = (event.round || '').trim().toLowerCase();
  const at = rounds.findIndex((rd) =>
    (!named || String(rd.name || '').trim().toLowerCase() === named) && sameOrder(rd.results || []));

  report.round.counted = at >= 0;
  const withoutThis = at >= 0 ? rounds.filter((_, i) => i !== at) : rounds;
  report.standings.before = standingsFrom(withoutThis, points);
  report.standings.after = standingsFrom(
    [...withoutThis, { results: report.round.scored }], points);

  const rankBefore = new Map(report.standings.before.map((e) => [e.driverId, e.rank]));
  report.standings.moved = report.standings.after.map((e) => ({
    ...e,
    was: rankBefore.get(e.driverId) ?? null,
    change: rankBefore.has(e.driverId) ? rankBefore.get(e.driverId) - e.rank : null
  }));

  return report;
}

/**
 * The same report as something that can be pasted into a chat window.
 *
 * Markdown rather than a screenshot, because a screenshot of a table is unreadable on a
 * phone and cannot be searched for a driver's name six weeks later.
 */
export function reportAsText(report) {
  if (report.empty) return 'No classification to report.';
  const out = [];
  const ev = report.event;

  out.push(`**${ev.name}**${ev.round ? ` — ${ev.round}` : ''}`);
  const where = [ev.track, ev.session].filter(Boolean).join(' · ');
  if (where) out.push(where);
  if (report.provisional) out.push('_Provisional — the race has not been flagged finished._');
  out.push('');

  if (report.winner) {
    const m = report.margin;
    out.push(`🏆 **${report.winner.name}** #${report.winner.num}`
      + (m && m.text ? ` wins by ${m.text} from ${m.to.name}` : ' wins'));
  }
  if (report.fastest) {
    out.push(`⚡ Fastest lap: **${report.fastest.name}** ${report.fastest.bestText}`
      + (report.fastest.marginText ? ` (${report.fastest.marginText} clear)` : ''));
  }
  if (report.movers.length) {
    const m = report.movers[0];
    out.push(`📈 Biggest mover: **${m.name}**, P${m.startedAt} to P${m.position} (+${m.gained})`);
  }
  out.push('');

  out.push('**Classification**');
  out.push('```');
  for (const r of report.classification) {
    const pos = String(r.position).padStart(2, ' ');
    const num = ('#' + r.num).padStart(4, ' ');
    const name = r.name.padEnd(16, ' ').slice(0, 16);
    const gap = r.dnf ? 'DNF'
      : r.position === 1 ? 'WINNER'
      : r.gapMs == null ? '--' : '+' + fmtGap(r.gapMs);
    out.push(`${pos} ${num} ${name} ${String(r.laps).padStart(3, ' ')} laps  ${gap}`);
  }
  out.push('```');

  if (report.penalties.length) {
    out.push('');
    out.push('**Stewards**');
    for (const p of report.penalties) {
      out.push(`- ${p.driver} #${p.num} — ${p.headline}${p.open ? ' (under investigation)' : ''}`
        + `, lap ${p.lap}: ${p.reason}`);
    }
  }

  if (report.standings.moved.length) {
    out.push('');
    out.push(`**Championship**${report.round.counted ? '' : ' _(with this round included)_'}`);
    for (const e of report.standings.moved.slice(0, 10)) {
      const arrow = e.change == null ? 'new' : e.change > 0 ? `▲${e.change}` : e.change < 0 ? `▼${-e.change}` : '–';
      out.push(`${e.rank}. ${e.name} — ${e.points} pts  ${arrow}`);
    }
  }

  return out.join('\n');
}
