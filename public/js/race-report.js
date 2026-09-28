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

  // ---------------------------------------------------------------- the lap chart
  //
  // Where every car was at the end of each lap (race-state records it at the line), with the
  // grid as lap 0 when one was set. Race sessions only, and only once a lap has been run.
  const chart = race.lapChart || {};
  const series = drivers.map((d) => ({
    name: d.name, num: d.num, color: d.color || '#8e8e93', dnf: !!d.dnf,
    points: [startOf.get(d.id) ?? null, ...(chart[d.id] || [])]
  })).filter((s) => s.points.slice(1).some((p) => p != null));
  const chartLaps = series.reduce((n, s) => Math.max(n, s.points.length - 1), 0);
  report.lapChart = (event.sessionType || 'race') !== 'qualifying' && (event.sessionType || 'race') !== 'practice' && chartLaps >= 1
    ? { laps: chartLaps, cars: Math.max(drivers.length, ...series.flatMap((s) => s.points.filter((p) => p != null))), series }
    : null;

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

/**
 * A prose recap of the race, in one paragraph, for a caption on YouTube or Instagram.
 * Built from the same report as everything else, so it never invents a fact the
 * classification does not carry. Bilingual; `lang` picks EN or ID. No em-dash, by house rule.
 */
export function recapText(report, lang = 'en') {
  if (report.empty) return '';
  const id = lang === 'id';
  const ev = report.event;
  const where = [ev.track, ev.session].filter(Boolean).join(', ');
  const title = [ev.name, ev.round].filter(Boolean).join(' ');
  const s = [];

  if (report.winner) {
    const w = report.winner, m = report.margin, podium = report.classification.filter((r) => !r.dnf).slice(0, 3);
    const second = podium[1], third = podium[2];
    if (id) {
      let line = `${w.name} memenangi ${title}${where ? ' di ' + where : ''}`;
      if (m && m.text) line += `, unggul ${m.text} atas ${m.to.name}`;
      else if (second) line += `, di depan ${second.name}`;
      if (third) line += `, dengan ${third.name} melengkapi podium`;
      s.push(line + '.');
    } else {
      let line = `${w.name} won ${title}${where ? ' at ' + where : ''}`;
      if (m && m.text) line += `, by ${m.text} over ${m.to.name}`;
      else if (second) line += `, ahead of ${second.name}`;
      if (third) line += `, with ${third.name} completing the podium`;
      s.push(line + '.');
    }
  }

  if (report.fastest) {
    const f = report.fastest;
    s.push(id
      ? `Lap tercepat milik ${f.name} (${f.bestText}).`
      : `${f.name} set the fastest lap of the race (${f.bestText}).`);
  }

  const mover = report.movers && report.movers[0];
  if (mover && mover.startedAt) {
    s.push(id
      ? `Kenaikan terbanyak: ${mover.name}, naik ${mover.gained} posisi dari P${mover.startedAt} ke P${mover.position}.`
      : `Biggest mover was ${mover.name}, up ${mover.gained} place${mover.gained > 1 ? 's' : ''} from P${mover.startedAt} to P${mover.position}.`);
  }

  if (report.retirements && report.retirements.length) {
    const names = report.retirements.map((r) => r.name).join(', ');
    const n = report.retirements.length;
    s.push(id
      ? `${n} mobil tidak finish (${names}).`
      : `${n} car${n > 1 ? 's' : ''} failed to finish (${names}).`);
  }

  const applied = (report.penalties || []).filter((p) => !p.open);
  if (applied.length) {
    s.push(id
      ? `Steward menjatuhkan ${applied.length} penalti.`
      : `Stewards handed down ${applied.length} penalt${applied.length > 1 ? 'ies' : 'y'}.`);
  }

  return s.join(' ');
}

/**
 * A formal, printable classification sheet as a standalone HTML document, for stewards and
 * league records. Distinct from the broadcast report: black on white, A4, with the event
 * header, a full results table, the stewards' penalties and a signature line. Open it in a
 * new window and print or save as PDF. Built from the same report, so it never invents data.
 */
export function classificationHtml(report, lang = 'en') {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const id = lang === 'id';
  const ev = report.event || {};
  const rows = report.classification || [];
  const leader = rows.find((r) => !r.dnf) || rows[0] || null;
  const leaderLaps = leader ? leader.laps : 0;
  const when = new Date().toLocaleString(id ? 'id-ID' : 'en-GB');
  const title = id ? (report.provisional ? 'KLASIFIKASI SEMENTARA' : 'KLASIFIKASI RESMI')
                   : (report.provisional ? 'PROVISIONAL CLASSIFICATION' : 'OFFICIAL CLASSIFICATION');
  const T = id
    ? { pos: 'POS', no: 'NO', driver: 'PEMBALAP', team: 'TIM', laps: 'LAP', best: 'LAP TERBAIK', gap: 'SELISIH', pen: 'PENALTI', status: 'STATUS',
        fastest: 'Lap tercepat', stewards: 'Keputusan steward', lap: 'lap', none: 'Tidak ada penalti.', dir: 'Race Director', sign: 'Tanda tangan', gen: 'Dibuat oleh' }
    : { pos: 'POS', no: 'NO', driver: 'DRIVER', team: 'TEAM', laps: 'LAPS', best: 'BEST LAP', gap: 'GAP', pen: 'PENALTY', status: 'STATUS',
        fastest: 'Fastest lap', stewards: 'Stewards decisions', lap: 'lap', none: 'No penalties.', dir: 'Race Director', sign: 'Signature', gen: 'Generated by' };

  const gapCell = (r) => {
    if (r.dnf) return '';
    if (r.position === 1) return '—';
    if (r.laps === leaderLaps && r.gapMs != null) return '+' + fmtGap(r.gapMs);
    const down = leaderLaps - r.laps;
    return down > 0 ? `+${down} ${down > 1 ? (id ? 'lap' : 'laps') : 'lap'}` : '';
  };
  const statusCell = (r) => r.dnf ? (r.penaltySec === -1 ? 'RET' : (r.dnfKind === 'ret' ? 'RET' : 'DNF')) : '';

  const body = rows.map((r) => `<tr${r.dnf ? ' class="dnf"' : ''}>
    <td class="c">${r.position}</td>
    <td class="c mono">${esc(r.num)}</td>
    <td>${esc(r.name)}</td>
    <td class="team">${esc(r.team || '')}</td>
    <td class="c">${r.laps || 0}</td>
    <td class="c mono">${esc(r.bestText || '--')}</td>
    <td class="r mono">${esc(gapCell(r))}</td>
    <td class="c mono">${r.penaltySec > 0 ? '+' + r.penaltySec + 's' : ''}</td>
    <td class="c">${r.dnf ? (r.retired ? 'RET' : 'DNF') : ''}</td>
  </tr>`).join('');

  const applied = (report.penalties || []).filter((p) => !p.open);
  const stewards = applied.length
    ? '<ul>' + applied.map((p) => `<li><b>#${esc(p.num)} ${esc(p.driver)}</b> — ${esc(p.headline)}${p.lap ? ` (${T.lap} ${p.lap})` : ''}: ${esc(p.reason)}</li>`).join('') + '</ul>'
    : `<p class="muted">${T.none}</p>`;

  const fastest = report.fastest
    ? `<p class="fast">${T.fastest}: <b>#${esc(report.fastest.num)} ${esc(report.fastest.name)}</b> — ${esc(report.fastest.bestText)}</p>`
    : '';

  return `<!doctype html><html lang="${id ? 'id' : 'en'}"><head><meta charset="utf-8">
<title>${esc([ev.name, ev.round].filter(Boolean).join(' '))} — ${title}</title>
<style>
  @page { size: A4; margin: 16mm; }
  * { box-sizing: border-box; }
  body { font: 12px/1.5 -apple-system, "Segoe UI", Arial, sans-serif; color: #111; margin: 0; padding: 24px; }
  .doc { max-width: 800px; margin: 0 auto; }
  .head { border-bottom: 3px solid #111; padding-bottom: 12px; margin-bottom: 6px; }
  .event { font-size: 24px; font-weight: 800; margin: 0; }
  .sub { color: #555; font-size: 13px; margin-top: 3px; }
  .doctype { display: inline-block; margin-top: 12px; font-size: 14px; font-weight: 800; letter-spacing: .12em; padding: 5px 12px; border: 2px solid #111; }
  .doctype.prov { border-color: #b00; color: #b00; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0 8px; font-size: 12px; }
  th { text-align: left; font-size: 10px; letter-spacing: .08em; color: #444; border-bottom: 2px solid #111; padding: 6px 8px; }
  td { padding: 6px 8px; border-bottom: 1px solid #ddd; }
  td.c { text-align: center; } td.r { text-align: right; }
  .mono { font-family: "SF Mono", Consolas, monospace; }
  .team { color: #555; }
  tr.dnf td { color: #999; }
  .fast { margin: 10px 0; }
  h2 { font-size: 13px; letter-spacing: .06em; text-transform: uppercase; border-bottom: 1px solid #111; padding-bottom: 4px; margin: 22px 0 8px; }
  .muted { color: #777; }
  ul { margin: 6px 0; padding-left: 20px; } li { margin: 4px 0; }
  .sign { display: flex; gap: 40px; margin-top: 40px; }
  .sign .line { flex: 1; border-top: 1px solid #111; padding-top: 6px; font-size: 11px; color: #555; }
  .foot { margin-top: 26px; font-size: 10px; color: #999; display: flex; justify-content: space-between; }
  @media screen { body { background: #eef1f5; } .doc { background: #fff; padding: 30px; box-shadow: 0 8px 40px rgba(0,0,0,.15); } }
</style></head>
<body onload="setTimeout(function(){window.print();},250)">
<div class="doc">
  <div class="head">
    <p class="event">${esc(ev.name || 'RACE')}</p>
    <p class="sub">${esc([ev.round, ev.track, ev.session].filter(Boolean).join(' · '))}${ev.totalLaps ? ` · ${ev.totalLaps} ${id ? 'lap' : 'laps'}` : ''} · ${esc(when)}</p>
  </div>
  <span class="doctype${report.provisional ? ' prov' : ''}">${title}</span>
  <table>
    <thead><tr><th class="c">${T.pos}</th><th class="c">${T.no}</th><th>${T.driver}</th><th>${T.team}</th><th class="c">${T.laps}</th><th class="c">${T.best}</th><th class="r">${T.gap}</th><th class="c">${T.pen}</th><th class="c">${T.status}</th></tr></thead>
    <tbody>${body}</tbody>
  </table>
  ${fastest}
  <h2>${T.stewards}</h2>
  ${stewards}
  <div class="sign">
    <div class="line">${T.dir}</div>
    <div class="line">${T.sign}</div>
  </div>
  <div class="foot"><span>${T.gen} FRLcast · frlcast.my.id</span><span>${esc(when)}</span></div>
</div>
</body></html>`;
}
