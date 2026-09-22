/*
 * The same bus the overlays already speak, backed by Supabase instead of a socket.
 *
 * Every overlay listens for `state` and renders whatever shape arrives. So the migration
 * does not need to touch thirteen overlay files: it needs one object that presents that
 * shape and keeps it current. Nothing downstream of here knows which world it is in.
 *
 * Two things make this affordable on a free plan, and both are deliberate.
 *
 * Nothing is broadcast on a timer. Postgres changes arrive when a row actually changes,
 * which during a race means a lap crossing, a flag, a penalty. Between those there is no
 * traffic at all.
 *
 * The smooth part of the picture is arithmetic, not data. A race clock counting up and a
 * car creeping towards the one in front are both functions of elapsed time, and every
 * overlay can work them out from the last change it received and its own wall clock. The
 * old server pushed the whole state once a second to keep those two things moving, which
 * for a two hour event is around 1.26 GB of egress against a 5 GB monthly allowance.
 */

import { labelGaps } from './timing.js';

const SUPABASE_ESM = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

export class CloudBus {
  /**
   * @param {string} role      what this page is, for parity with the socket bus
   * @param {object} opts      { url, anonKey, code }
   */
  constructor(role, opts) {
    this.role = role;
    this.opts = opts;
    this.clientId = `${role}-${Math.random().toString(36).slice(2, 8)}`;
    this.state = null;
    this.handlers = { state: new Set(), signal: new Set(), open: new Set(), close: new Set() };

    // The raw rows, kept as maps so a single row change is a single replacement rather
    // than a reload of the event.
    this.event = null;
    this.drivers = new Map();
    this.penalties = new Map();
    this.feed = [];
    this.radio = [];            // newest-first team-radio messages, for the overlay card
    this.radioChannel = null;   // its own realtime channel — see subscribe()
    this.votes = new Map();     // voter fingerprint -> choice, for the audience poll

    this.connect();
  }

  on(evt, fn) { this.handlers[evt].add(fn); return () => this.handlers[evt].delete(fn); }

  async connect() {
    try {
      const { createClient } = await import(SUPABASE_ESM);
      this.sb = createClient(this.opts.url, this.opts.anonKey, {
        // An overlay is a screen, not a session. Persisting a token here would have OBS
        // quietly holding somebody's login.
        auth: { persistSession: false, autoRefreshToken: false }
      });
      await this.load();
      this.subscribe();
      document.documentElement.classList.remove('disconnected');
      this.handlers.open.forEach((f) => f());

      // Safety net. Realtime is the fast path, but OBS's Browser Source can hold a channel
      // that has quietly stopped delivering — no error, no close, just silence — and the
      // overlay then freezes on whatever flag was last pushed. A slow re-fetch reconciles the
      // whole state every few seconds, so the very worst case is a handful of seconds stale
      // rather than stuck until someone reloads the source. It is a few small selects; on a
      // single broadcast screen that cost is nothing next to a frozen flag on stream.
      clearInterval(this.reconcile);
      this.reconcile = setInterval(() => { this.load().catch(() => {}); }, 5000);
    } catch (err) {
      document.documentElement.classList.add('disconnected');
      this.handlers.close.forEach((f) => f());
      // The event may not exist yet, or the machine may be offline while OBS starts up
      // before the operator does. Keep trying rather than showing a dead overlay.
      clearTimeout(this.retry);
      this.retry = setTimeout(() => this.connect(), 3000);
    }
  }

  /** Everything once, at startup. After this only changes arrive. */
  async load() {
    const code = String(this.opts.code || '').trim().toUpperCase();
    const { data: ev, error } = await this.sb
      .from('events').select('*').eq('code', code).maybeSingle();
    if (error) throw error;
    if (!ev) throw new Error(`No event with code ${code}`);
    this.event = ev;

    const [drivers, penalties, feed] = await Promise.all([
      this.sb.from('drivers').select('*').eq('event_id', ev.id),
      this.sb.from('penalties').select('*').eq('event_id', ev.id)
        .order('created_at', { ascending: false }).limit(200),
      this.sb.from('feed').select('*').eq('event_id', ev.id)
        .order('created_at', { ascending: false }).limit(60)
    ]);

    this.drivers = new Map((drivers.data || []).map((d) => [d.id, d]));
    this.penalties = new Map((penalties.data || []).map((p) => [p.id, p]));
    this.feed = feed.data || [];

    // Votes are optional: the table only exists once the poll migration is applied, so a
    // missing table must not take the whole overlay down with it.
    try {
      const { data: votes } = await this.sb.from('votes').select('voter,choice').eq('event_id', ev.id);
      this.votes = new Map((votes || []).map((v) => [v.voter, v.choice]));
    } catch (e) { this.votes = new Map(); }

    // Team radio, same optional treatment: absent until the radio migration is applied.
    try {
      const { data: radio } = await this.sb.from('team_radio').select('*').eq('event_id', ev.id)
        .order('created_at', { ascending: false }).limit(24);
      this.radio = radio || [];
    } catch (e) { this.radio = []; }

    this.emit();
  }

  /** Tally of the current votes: { counts: {choice: n}, total }. */
  voteCounts() {
    const counts = {};
    let total = 0;
    for (const choice of this.votes.values()) { counts[choice] = (counts[choice] || 0) + 1; total++; }
    return { counts, total };
  }

  /** Cast or change this browser's vote. Used by the public live page. */
  async vote(choice) {
    if (!this.sb || !this.event) return;
    let voter = '';
    try { voter = localStorage.getItem('frl.voter') || ''; if (!voter) { voter = 'v' + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('frl.voter', voter); } } catch (e) { voter = 'v' + Date.now(); }
    this.votes.set(voter, choice);
    this.emit();
    const { error } = await this.sb.from('votes')
      .upsert({ event_id: this.event.id, voter, choice }, { onConflict: 'event_id,voter' });
    if (error) throw error;
  }

  subscribe() {
    if (this.channel) this.sb.removeChannel(this.channel);
    if (this.radioChannel) { this.sb.removeChannel(this.radioChannel); this.radioChannel = null; }
    const id = this.event.id;

    // One channel, five tables, filtered to this event in the database rather than here:
    // an unfiltered subscription would carry every other league's race across the wire
    // and spend the message allowance on rows this overlay then throws away.
    this.channel = this.sb.channel(`event:${id}`);
    const watch = (table, apply) => {
      this.channel.on('postgres_changes',
        { event: '*', schema: 'public', table, filter: `${table === 'events' ? 'id' : 'event_id'}=eq.${id}` },
        (payload) => { apply(payload); this.emit(); });
    };

    watch('events', (p) => {
      if (!p.new || !p.new.id) return;
      // Realtime drops oversized jsonb from the payload: this event's `settings` (eight
      // scenes, the layout, the grid) is past the per-row byte cap, so a flag change arrives
      // as a row with `settings` missing entirely. Overwriting blindly wiped the overlay's
      // whole config for that frame — every widget's placement gone, and `activeScene` gone
      // with it, which the overlay then read as a scene change and fired the stinger on every
      // flag. Keep the settings we already have whenever the update did not carry them.
      const prev = this.event || {};
      // Realtime can drop the oversized `settings` jsonb, and delivers it either missing or as
      // an empty object depending on the change. Trust the incoming settings only when it is
      // actually complete (carries the overlay config the overlays render from); otherwise keep
      // the full copy we already loaded, so a flag change never wipes the overlay for a frame.
      const inc = p.new.settings;
      const complete = inc && inc.overlay && inc.overlay.show;
      this.event = { ...p.new, settings: complete ? inc : (prev.settings || inc || {}) };
    });
    watch('drivers', (p) => {
      if (p.eventType === 'DELETE') this.drivers.delete(p.old.id);
      else this.drivers.set(p.new.id, p.new);
    });
    watch('penalties', (p) => {
      if (p.eventType === 'DELETE') this.penalties.delete(p.old.id);
      else this.penalties.set(p.new.id, p.new);
    });
    watch('feed', (p) => {
      if (p.eventType === 'INSERT') this.feed = [p.new, ...this.feed].slice(0, 60);
    });
    // Poll votes: present only once the migration is applied. A row is keyed by voter, so an
    // update (a re-vote) simply overwrites the map entry.
    watch('votes', (p) => {
      if (p.eventType === 'DELETE') this.votes.delete(p.old.voter);
      else if (p.new) this.votes.set(p.new.voter, p.new.choice);
    });
    this.channel.subscribe((status) => {
      const live = status === 'SUBSCRIBED';
      document.documentElement.classList.toggle('disconnected', !live);
      if (live) {
        this.handlers.open.forEach((f) => f());
      } else {
        this.handlers.close.forEach((f) => f());
        // A dropped or errored channel does not come back on its own. Tear it down and build a
        // fresh one, and re-fetch on the way so nothing that changed while it was down is
        // missed. The reconcile poll above keeps the picture correct in the meantime.
        if (status === 'CHANNEL_ERROR' || status === 'CLOSED' || status === 'TIMED_OUT') {
          clearTimeout(this.resub);
          this.resub = setTimeout(() => { this.load().catch(() => {}); this.subscribe(); }, 3000);
        }
      }
    });

    // Team radio rides its OWN channel, on purpose. Binding a postgres_changes listener to a
    // table that is not yet in the realtime publication makes the WHOLE channel come back
    // CHANNEL_ERROR — so putting team_radio on the main channel took flags, drivers and
    // penalties down with it whenever the radio migration had not been applied. Its own
    // channel fails alone and the broadcast keeps running; when the migration lands it simply
    // starts working, no code change.
    this.radioRetries = 0;
    this.subscribeRadio(id);
  }

  /*
   * Team radio's realtime, on its own channel and its own retry.
   *
   * In OBS the reconcile poll is a background-throttled timer and barely runs, so this channel
   * is what actually puts a message on the card the instant it is sent. It used to be killed
   * permanently on the first error — a single transient drop and radio was dead for the rest
   * of the broadcast, which is exactly the "message never appears" everyone hit. Now it comes
   * back like the main channel does. A genuinely missing table (migration not applied) errors
   * every time, so the retries are capped rather than looping forever.
   */
  subscribeRadio(id) {
    if (this.radioChannel) { try { this.sb.removeChannel(this.radioChannel); } catch (e) { /* gone */ } }
    this.radioChannel = this.sb.channel(`event:${id}:radio:${Date.now()}`);
    this.radioChannel.on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'team_radio', filter: `event_id=eq.${id}` },
      (p) => { if (p.new) { this.radio = [p.new, ...this.radio].slice(0, 24); this.radioRetries = 0; this.emit(); } });
    this.radioChannel.subscribe((status) => {
      if (status === 'SUBSCRIBED') { this.radioRetries = 0; return; }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        // Come back after a moment — unless it keeps failing, which means the table is not
        // there and retrying forever would just burn the connection.
        if (this.radioRetries++ < 6) {
          clearTimeout(this.radioResub);
          this.radioResub = setTimeout(() => this.subscribeRadio(id), 3000);
        } else {
          try { this.sb.removeChannel(this.radioChannel); } catch (e) { /* gone */ }
          this.radioChannel = null;
        }
      }
    });
  }

  // ---------------------------------------------------------------- shape

  /**
   * The rows, arranged the way the overlays already expect to find them.
   *
   * The names differ because the two sides have different jobs: a column is snake_case and
   * says what it stores, a field on the state object is camelCase and says what it means to
   * whoever is drawing it. This is the only place that knows both.
   */
  build() {
    const ev = this.event;
    if (!ev) return null;

    const settings = ev.settings || {};
    const pens = [...this.penalties.values()]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const drivers = [...this.drivers.values()].map((d) => {
      const mine = pens.filter((p) => p.driver_id === d.id);
      return {
        id: d.id,
        num: d.num,
        name: d.name,
        short: d.short,
        team: d.team,
        color: d.color,
        position: d.position,
        lapsDone: d.laps_done,
        lastLap: d.last_lap,
        bestLap: d.best_lap,
        // Filled in below by the shared rules. The columns hold milliseconds; what an
        // overlay prints is "LEADER", "+1 LAP" or "+1.240", and deciding which is not a
        // thing to do twice.
        gapMs: d.gap_ms,
        totalMs: d.gap_ms == null ? 0 : Number(d.gap_ms),
        progress: d.progress,
        pit: d.pit,
        dnf: d.dnf,
        finished: d.finished,
        stopped: d.stopped,
        predicted: d.predicted,
        blueFlag: d.blue_flag,

        // Derived here rather than stored, because they are a reading of the penalty rows
        // this page already holds. A stored copy is a second thing to keep in step, and it
        // would be wrong for as long as it took somebody to notice.
        blackFlag: mine.some((p) =>
          p.status === 'applied' && (p.type === 'blackflag' || p.type === 'dq') && !p.served),
        penaltyPending: mine.some((p) => p.status === 'investigating'),
        penaltySec: mine.reduce((sum, p) =>
          sum + (p.status === 'applied' && p.type === 'time' ? p.seconds : 0), 0),
        penaltyServed: mine.reduce((sum, p) =>
          sum + (p.status === 'applied' && p.type === 'time' ? p.seconds : 0), 0)
      };
    }).sort((a, b) => a.position - b.position);

    // totalMs above is each driver's deficit to the leader, so the leader's own is zero and
    // the differences between them are the intervals. That is all labelGaps needs.
    labelGaps(drivers, {
      drift: ev.session_type === 'drift',
      quali: ev.session_type === 'quali'
    });

    const ms = (t) => (t ? new Date(t).getTime() : null);

    return {
      event: {
        name: ev.name,
        round: ev.round,
        track: ev.track,
        sessionType: ev.session_type,
        sessionName: ev.session_label
      },
      race: {
        status: ev.status,
        flagSource: ev.flag_source,
        totalLaps: ev.total_laps,
        timeLimitSec: Number(settings.timeLimitSec || 0),
        predictOrder: settings.predictOrder !== false,
        startedAt: ms(ev.started_at),
        finishedAt: ms(ev.finished_at),
        pausedAt: ms(ev.paused_at),
        pausedTotal: Number(ev.paused_total || 0),
        clearSince: ms(ev.clear_since),
        penalties: pens.map((p) => ({
          id: p.id, driverId: p.driver_id, type: p.type, seconds: p.seconds,
          reason: p.reason, lap: p.lap, status: p.status, served: p.served,
          auto: p.auto, at: ms(p.created_at)
        })),
        // Settings the console keeps as one blob rather than as columns nothing queries.
        grid: settings.grid || [],
        rules: settings.rules || {},
        flags: settings.flags || {}
      },
      drivers,
      feed: this.feed.map((f) => ({
        t: ms(f.created_at), kind: f.kind, text: f.text, driverId: f.driver_id
      })),
      radio: (this.radio || []).map((r) => ({
        id: r.id, from: r.from_nick, num: r.from_num, team: r.team, text: r.text, at: ms(r.created_at)
      })),
      overlay: settings.overlay || {},
      votes: this.voteCounts(),
      drift: settings.drift || {},
      calibration: settings.calibration || {},
      championship: settings.championship || {},
      standings: settings.standings || [],
      records: settings.records || {},
      sessions: settings.sessions || [],
      commentary: settings.commentary || {}
    };
  }

  emit() {
    this.state = this.build();
    if (this.state) this.handlers.state.forEach((f) => f(this.state));
  }

  // ---------------------------------------------------------------- writing

  /**
   * Overlays never call this. The console does, and only for an event it owns: the
   * policies on every table check that, so a wrong call fails at the database rather than
   * changing somebody else's race.
   */
  async action(type, extra = {}) {
    if (!this.sb || !this.event) return;
    const { writeAction } = await import('./cloudwrite.js');
    return writeAction(this.sb, this.event, type, extra);
  }

  /**
   * There is no signal channel here yet.
   *
   * On the socket bus this carried things that never belonged in the state: which pages
   * are connected, a demo trigger, the WebRTC handshake for phone capture. None of them
   * are worth a Realtime broadcast on a metered plan, and none are needed to render an
   * overlay, so they are dropped rather than faked.
   */
  signal() { /* intentionally nothing */ }

  raw() { /* the socket protocol has no meaning here */ }
}

/**
 * Which bus a page should use.
 *
 * `?event=NDL3` means a hosted event. Anything else means the broadcast server that served
 * this page, which is how every existing league still works. The same rule the driver app
 * uses, for the same reason: the console has not moved yet, and a page that could only
 * talk to the new world would be a page that shows nothing.
 */
export function cloudOptions() {
  const p = new URLSearchParams(location.search);
  const code = p.get('event');
  if (!code) return null;
  // One config file for the whole site. supabase-config.js already sets this for the
  // sign-in page, and asking somebody to keep a second copy of the same two values in a
  // second place is how one of them ends up stale.
  const cfg = window.FRL_SUPABASE || {};
  const url = p.get('sb') || cfg.url || window.FRL_SUPABASE_URL || '';
  const anonKey = p.get('key') || cfg.anonKey || window.FRL_SUPABASE_ANON_KEY || '';
  if (!url || !anonKey) return null;
  return { code, url, anonKey };
}
