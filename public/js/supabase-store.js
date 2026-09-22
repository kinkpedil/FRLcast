/*
 * The operator's console, writing an event back to Postgres.
 *
 * RaceState calls write() whenever anything changes, which during a race is several times
 * a second. Writing the whole event each time would undo the entire point of the design:
 * every write is a row change, every row change is a Realtime message to every overlay, and
 * a two hour event would spend the free plan's monthly egress in an afternoon.
 *
 * So this diffs. It keeps the last thing it wrote and sends only the columns that actually
 * differ. A race where nothing has happened for ten seconds produces no traffic at all.
 */

/** Columns on `drivers`, and how to read each one out of a state driver. */
const DRIVER_COLS = {
  num: (d) => d.num,
  name: (d) => d.name,
  short: (d) => d.short || '',
  team: (d) => d.team || '',
  color: (d) => d.color,
  // Set when a car is claimed by an accepted sign-in, null for one the operator typed in.
  account_id: (d) => d.accountId || null,
  position: (d) => d.position || 0,
  laps_done: (d) => d.lapsDone || 0,
  last_lap: (d) => d.lastLap ?? null,
  best_lap: (d) => d.bestLap ?? null,
  progress: (d) => d.progress || 0,
  pit: (d) => !!d.pit,
  dnf: (d) => !!d.dnf,
  finished: (d) => !!d.finished,
  stopped: (d) => !!d.stopped,
  predicted: (d) => !!d.predicted,
  blue_flag: (d) => !!d.blueFlag
};

/** Columns on `events`. */
const EVENT_COLS = {
  name: (s) => s.event.name,
  round: (s) => s.event.round,
  track: (s) => s.event.track || '',
  session_type: (s) => s.event.sessionType || 'race',
  session_label: (s) => s.event.sessionName || '',
  total_laps: (s) => s.race.totalLaps || 0,
  status: (s) => s.race.status,
  flag_source: (s) => s.race.flagSource || 'operator',
  started_at: (s) => iso(s.race.startedAt),
  finished_at: (s) => iso(s.race.finishedAt),
  paused_at: (s) => iso(s.race.pausedAt),
  paused_total: (s) => s.race.pausedTotal || 0,
  clear_since: (s) => iso(s.race.clearSince)
};

function iso(ms) { return ms ? new Date(ms).toISOString() : null; }

/** Everything that lives in the settings blob rather than in a column of its own. */
function settingsOf(state) {
  return {
    overlay: state.overlay,
    drift: state.drift,
    calibration: state.calibration,
    championship: state.championship,
    standings: state.standings,
    records: state.records,
    sessions: state.sessions,
    commentary: state.commentary,
    grid: state.race.grid,
    rules: state.race.rules,
    flags: state.race.flags,
    // No column of their own, so they ride in the blob — otherwise a hosted overlay never
    // learns the session length and its countdown falls back to counting up.
    timeLimitSec: state.race.timeLimitSec || 0,
    predictOrder: state.race.predictOrder !== false
  };
}

export class SupabaseStore {

  /**
   * @param {object} sb        a supabase-js client, signed in as the event's owner
   * @param {object} eventRow  the row from `events`
   * @param {?object} snapshot the state RaceState should start from, already assembled
   */
  constructor(sb, eventRow, snapshot) {
    this.sb = sb;
    this.eventId = eventRow.id;
    this.snapshot = snapshot;

    // What was last sent. Everything is compared against this, so the first write after a
    // reload sends only what has genuinely moved since the page loaded.
    this.lastEvent = {};
    this.lastSettings = null;
    this.lastDrivers = new Map();
    this.sentPenalties = new Set((snapshot?.race?.penalties || []).map((p) => p.id));
    this.sentFeed = new Set((snapshot?.feed || []).map((f) => f.t + '|' + f.text));

    if (snapshot) this.remember(snapshot);

    this.chain = Promise.resolve();
    this.failures = 0;
  }

  read() { return this.snapshot; }

  /**
   * Called by RaceState. Returns immediately: an operator pressing a flag must not wait
   * for a round trip, and the writes are ordered among themselves by the chain below.
   */
  write(state) {
    const work = this.plan(state);
    if (!work) return;
    this.remember(state);
    this.chain = this.chain.then(() => this.send(work)).catch((err) => {
      // A failed write is not a reason to stop trying: the next change will carry the same
      // values, because `remember` only runs when a plan was actually produced.
      this.failures++;
      console.error('[store] write failed:', err.message || err);
    });
  }

  /** Work out what changed. Returns null when nothing did, which is the common case. */
  plan(state) {
    const work = { event: null, settings: null, drivers: [], inserts: [], removed: [], penalties: [], feed: [] };
    let any = false;

    const ev = {};
    for (const [col, read] of Object.entries(EVENT_COLS)) {
      const v = read(state);
      if (v !== this.lastEvent[col]) ev[col] = v;
    }
    if (Object.keys(ev).length) { work.event = ev; any = true; }

    // The settings blob is compared as text. It is one column, it changes rarely, and a
    // field by field diff of ten nested objects would cost more than the comparison saves.
    const settings = JSON.stringify(settingsOf(state));
    if (settings !== this.lastSettings) { work.settings = settings; any = true; }

    const seen = new Set();
    for (const d of state.drivers) {
      seen.add(d.id);
      const was = this.lastDrivers.get(d.id);
      const row = {};
      for (const [col, read] of Object.entries(DRIVER_COLS)) {
        const v = read(d);
        if (!was || v !== was[col]) row[col] = v;
      }
      // Milliseconds behind the leader. Stored rather than the driver's own total, because
      // that is what an overlay needs and it survives a leader retiring.
      const leader = state.drivers.find((x) => x.position === 1);
      const gap = leader && d.totalMs != null && leader.totalMs != null
        ? d.totalMs - leader.totalMs : null;
      if (!was || gap !== was.gap_ms) row.gap_ms = gap;

      /*
       * New or existing, which is not the same question as changed.
       *
       * An earlier version only ever sent updates, so a car added in the console produced
       * `update drivers where id = <an id no row has>`, which matches nothing and succeeds
       * quietly. The grid filled up on the operator's screen and stayed empty everywhere
       * else.
       */
      if (!was) {
        work.inserts.push({ id: d.id, event_id: this.eventId, ...row });
        any = true;
      } else if (Object.keys(row).length) {
        work.drivers.push({ id: d.id, row });
        any = true;
      }
    }

    // And a car taken off the grid has to leave the database too, or it keeps appearing on
    // every overlay until somebody deletes the row by hand.
    for (const id of this.lastDrivers.keys()) {
      if (!seen.has(id)) { work.removed.push(id); any = true; }
    }

    for (const p of state.race.penalties || []) {
      if (this.sentPenalties.has(p.id)) continue;
      work.penalties.push({
        id: p.id, event_id: this.eventId, driver_id: p.driverId, type: p.type,
        seconds: p.seconds, reason: p.reason, lap: p.lap, status: p.status,
        served: !!p.served, auto: !!p.auto
      });
      any = true;
    }

    for (const f of state.feed || []) {
      const key = f.t + '|' + f.text;
      if (this.sentFeed.has(key)) continue;
      work.feed.push({ event_id: this.eventId, kind: f.kind, text: f.text, driver_id: f.driverId });
      any = true;
    }

    return any ? work : null;
  }

  async send(work) {
    const q = this.sb;
    if (work.event || work.settings) {
      const patch = { ...(work.event || {}) };
      if (work.settings) patch.settings = JSON.parse(work.settings);
      const { error } = await q.from('events').update(patch).eq('id', this.eventId);
      if (error) throw error;
    }

    // Cars first, so a lap or a penalty that arrives in the same breath as a new driver has
    // a row to land on.
    if (work.inserts.length) {
      const { error } = await q.from('drivers').insert(work.inserts);
      if (error) throw error;
    }

    // One statement per driver that moved, not one per driver. On a lap crossing that is
    // usually one row; on a restart it is the whole grid, and that is a rare moment.
    for (const { id, row } of work.drivers) {
      const { error } = await q.from('drivers').update(row).eq('id', id);
      if (error) throw error;
    }

    if (work.removed.length) {
      const { error } = await q.from('drivers').delete().in('id', work.removed);
      if (error) throw error;
    }

    if (work.penalties.length) {
      const { error } = await q.from('penalties').insert(work.penalties);
      if (error) throw error;
    }
    if (work.feed.length) {
      const { error } = await q.from('feed').insert(work.feed);
      if (error) throw error;
    }
  }

  /** Snapshot what has now been sent, so the next diff is against the truth. */
  remember(state) {
    for (const [col, read] of Object.entries(EVENT_COLS)) this.lastEvent[col] = read(state);
    this.lastSettings = JSON.stringify(settingsOf(state));

    const leader = state.drivers.find((x) => x.position === 1);
    this.lastDrivers = new Map(state.drivers.map((d) => {
      const row = {};
      for (const [col, read] of Object.entries(DRIVER_COLS)) row[col] = read(d);
      row.gap_ms = leader && d.totalMs != null && leader.totalMs != null
        ? d.totalMs - leader.totalMs : null;
      return [d.id, row];
    }));

    for (const p of state.race.penalties || []) this.sentPenalties.add(p.id);
    for (const f of state.feed || []) this.sentFeed.add(f.t + '|' + f.text);
  }
}

/**
 * Load an event and hand back a RaceState wired to it.
 *
 * The snapshot is assembled with the same mapping the overlays use, so the console and the
 * overlays are looking at one shape rather than two that happen to agree.
 */
export async function openEvent(sb, code, RaceState, CloudBus) {
  const bus = new CloudBus('panel', { code, url: sb.supabaseUrl, anonKey: sb.supabaseKey });
  await new Promise((resolve, reject) => {
    const done = bus.on('state', () => { done(); resolve(); });
    setTimeout(() => reject(new Error('The event did not load')), 15000);
  });
  const store = new SupabaseStore(sb, bus.event, bus.state);
  return { race: new RaceState(store), bus, store };
}
