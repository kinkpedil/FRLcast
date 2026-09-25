import fs from 'node:fs';
import path from 'node:path';

/*
 * The official FR Legends Tournament Timing API, polled into the same `timing.external`
 * seam the OCR stopgap used. It runs here on the server, never in a browser: the API is
 * plain HTTP, server-to-server, and the key must stay off the wire to any overlay.
 *
 * Flow (see iiley file docs/README.md): resolve the region's server IP with the key, then
 * GET /snapshot once and poll /laps by an (epoch, seq) cursor. Each player carries a best
 * lap, a lap count and a per-lap history; we map a player to a FRLcast driver BY NAME —
 * the in-game player id changes every room, so it is no use as a durable key — and hand
 * recompute() an authoritative order keyed by driver id.
 */
const LOOKUP = 'https://twinturbogames.com/api/servers.php';
const norm = (s) => String(s || '').trim().toLowerCase();

export class TimingApi {
  constructor(race, root) {
    this.race = race;
    this.cfgFile = path.join(root, 'data', 'timing.json');
    this.key = '';
    this.region = 'SoutheastAsia';
    this.load();
    this.reset();
  }

  load() {
    try {
      const j = JSON.parse(fs.readFileSync(this.cfgFile, 'utf8'));
      this.key = j.key || '';
      this.region = j.region || 'SoutheastAsia';
    } catch { /* no config yet */ }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.cfgFile), { recursive: true });
      // 0600: it holds the tournament API key. Never committed (data/ is gitignored).
      fs.writeFileSync(this.cfgFile, JSON.stringify({ key: this.key, region: this.region }, null, 2), { mode: 0o600 });
    } catch (err) { this.lastError = `save: ${err.message}`; }
  }

  setConfig({ key, region }) {
    if (key != null) this.key = String(key).trim();
    if (region) this.region = String(region).trim();
    this.save();
  }

  reset() {
    this.stop();
    this.roomKey = '';
    this.ip = '';
    this.epoch = null;
    this.cursor = null;
    this.players = new Map();   // id -> { name, bestMs, laps, lastMs }
    this.locks = new Map();     // player id -> driver id, stable for this room
    this.matched = 0;
    this.lastError = '';
    this.lastOk = 0;
    this.lastSnapAt = 0;   // snapshot is limited to 1/min; don't re-request faster than that
  }

  stop() {
    this.running = false;
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
  }

  status() {
    return {
      hasKey: !!this.key, region: this.region, running: !!this.running,
      roomKey: this.roomKey, ip: this.ip, players: this.players.size,
      matched: this.matched, error: this.lastError,
      lastOk: this.lastOk
    };
  }

  async resolveIp() {
    const r = await fetch(`${LOOKUP}?region=${encodeURIComponent(this.region)}`, { headers: { 'X-Api-Key': this.key } });
    if (!r.ok) throw new Error(`server-IP lookup returned ${r.status}`);
    const j = await r.json();
    if (!j || !j.ip) throw new Error('server-IP lookup gave no address');
    this.ip = j.ip;
  }

  base() { return `http://${this.ip}:56102`; }
  roomUrl(p) { return `${this.base()}/v1/rooms/${encodeURIComponent(this.roomKey)}${p}`; }

  async start(roomKey) {
    if (!this.key) throw new Error('No API key set');
    const rk = String(roomKey || '').trim();
    if (!rk) throw new Error('No room key');
    this.reset();
    this.roomKey = rk;
    await this.resolveIp();           // fail fast if the key/region is wrong
    this.running = true;
    this.schedule(0);
    return this.status();
  }

  schedule(ms) {
    if (!this.running) return;
    this._timer = setTimeout(() => {
      this.tick()
        .then(() => { this.lastError = ''; this.lastOk = Date.now(); })
        .catch((e) => { this.lastError = e.message; })
        .finally(() => this.schedule(1500));   // ~1.5s, within the 2 rps limit
    }, ms);
  }

  async tick() {
    if (this.cursor == null) {
      // A snapshot is capped at 1/min. When the room is not up yet (404) or the history
      // reset, the cursor stays null; wait out the minute instead of hammering it into a
      // snapshot_abuse 429.
      if (Date.now() - this.lastSnapAt < 60000) return;
      this.lastSnapAt = Date.now();
      await this.snapshot();
    } else {
      await this.laps();
    }
    this.dispatch();
  }

  async get(url) {
    const r = await fetch(url, { headers: { 'X-Api-Key': this.key } });
    const body = await r.json().catch(() => ({}));
    // Server clock minus ours. Lap times are stamped by the game server, the race start by
    // this machine; race mode needs both on one clock.
    if (body && body.serverTime) this.skew = body.serverTime - Date.now();
    return { status: r.status, body, retryAfter: Number(r.headers.get('retry-after')) || 0 };
  }

  upsert(p) {
    if (!p || !p.id) return;
    const cur = this.players.get(p.id) || {};
    if (p.name != null) cur.name = p.name;
    if (p.bestMs != null) cur.bestMs = p.bestMs;
    if (p.laps != null) cur.laps = p.laps;
    const es = p.entries || [];
    // When each lap was completed (server time), for race mode. Snapshot replaces the map
    // and /laps only returns seq > cursor, so nothing is appended twice.
    cur.hist = cur.hist || [];
    for (const e of es) if (e.completedAt != null) cur.hist.push(e.completedAt);
    if (es.length) {
      cur.lastMs = es[es.length - 1].ms;                 // entries are ascending by seq
      const lastSecs = es[es.length - 1].sectors;
      if (Array.isArray(lastSecs) && lastSecs.length) cur.sectors = lastSecs.slice();
      // running best per sector across every lap this player has driven
      cur.best = cur.best || [];
      for (const e of es) {
        const secs = e.sectors || [];
        for (let i = 0; i < secs.length; i++) {
          if (secs[i] > 0 && (cur.best[i] == null || secs[i] < cur.best[i])) cur.best[i] = secs[i];
        }
      }
    }
    this.players.set(p.id, cur);
  }

  async snapshot() {
    const { status, body } = await this.get(this.roomUrl('/snapshot'));
    if (status === 404) throw new Error('Room not found — is it created with this Room Key and running?');
    if (status === 401) throw new Error('API key rejected');
    if (status !== 200) throw new Error(`snapshot ${status}: ${body.error || ''}`);
    this.players = new Map();
    this.locks = new Map();
    this.epoch = body.epoch;
    this.cursor = body.seq;
    for (const p of body.players || []) this.upsert(p);
  }

  async laps() {
    const { status, body, retryAfter } = await this.get(this.roomUrl(`/laps?epoch=${this.epoch}&since=${this.cursor}`));
    if (status === 409) { this.cursor = null; return; }           // history reset -> resnapshot
    if (status === 429 || status === 503) { await new Promise((r) => setTimeout(r, (retryAfter || 1) * 1000)); return; }
    if (status !== 200) throw new Error(`laps ${status}: ${body.error || ''}`);
    if (body.resync) { this.cursor = null; return; }              // we were away too long
    for (const p of body.players || []) this.upsert(p);
    this.cursor = body.seq;
  }

  /** Match a room player to a FRLcast driver by name, and remember it for this room. */
  matchDriver(playerId, name) {
    if (this.locks.has(playerId)) return this.locks.get(playerId);
    const drivers = (this.race.state && this.race.state.drivers) || [];
    const n = norm(name);
    if (!n) return null;
    let d = drivers.find((x) => norm(x.name) === n)
      || drivers.find((x) => norm(x.name).startsWith(n) || n.startsWith(norm(x.name)))
      || drivers.find((x) => norm(x.name).includes(n) || n.includes(norm(x.name)));
    if (!d) return null;
    this.locks.set(playerId, d.id);
    return d.id;
  }

  dispatch() {
    const matched = [];
    for (const [pid, pl] of this.players) {
      const driverId = this.matchDriver(pid, pl.name);
      if (driverId && pl.bestMs != null) matched.push({ driverId, bestMs: pl.bestMs, laps: pl.laps, lastMs: pl.lastMs, sectors: pl.sectors, bestSectors: pl.best, hist: pl.hist || [] });
    }
    this.matched = matched.length;

    const st = (this.race.state && this.race.state.event && this.race.state.event.sessionType) || 'race';
    if (st === 'race' || st === 'endurance') return this.dispatchRace(matched);

    // Qualifying / practice (and anything else): the API's own Contest ranking, best lap first.
    matched.sort((a, b) => a.bestMs - b.bestMs);
    const rows = matched.map((m, i) => ({ driverId: m.driverId, rank: i + 1, laps: m.laps, bestMs: m.bestMs, lastMs: m.lastMs, sectors: m.sectors, bestSectors: m.bestSectors }));
    this.race.apply({ type: 'timing.external', mode: 'best', rows });
  }

  /*
   * Race mode: the API only ranks by best lap (the server does not know track position), so
   * a race order is rebuilt from the lap history instead. A car with more laps since the
   * start is ahead; on the same lap, whoever crossed the line first is ahead. That is exactly
   * what a line-timing screen shows.
   *
   * Only laps completed after the operator pressed Start race count, so laps left over from
   * practice in the same room do not. The gap is measured at the line: the time between two
   * cars completing the same lap, or whole laps once one has actually been lapped (never
   * "+1 LAP" just because the leader happened to cross first a moment ago).
   *
   * Temporary, until the API can report position itself.
   */
  dispatchRace(matched) {
    const started = this.race.state && this.race.state.race && this.race.state.race.startedAt;
    const t0 = started ? started + (this.skew || 0) : null;
    for (const m of matched) {
      m.times = t0 == null ? [] : m.hist.filter((at) => at >= t0).sort((a, b) => a - b);
      m.raceLaps = m.times.length;
      m.lastAt = m.times[m.raceLaps - 1];
    }
    const running = matched.filter((m) => m.raceLaps > 0).sort((a, b) => b.raceLaps - a.raceLaps || a.lastAt - b.lastAt);
    const waiting = matched.filter((m) => m.raceLaps === 0);

    // How far `me` is behind `ref`, taken at the moment `me` last crossed the line.
    const behind = (me, ref) => {
      const c = me.raceLaps;
      const refDone = ref.times.filter((at) => at <= me.lastAt).length;
      if (refDone - c >= 1) return { laps: refDone - c, ms: null };
      const refAt = ref.times[c - 1];
      return { laps: 0, ms: refAt == null ? null : me.lastAt - refAt };
    };

    const rows = running.map((m, i) => {
      const g = i === 0 ? { laps: 0, ms: null } : behind(m, running[0]);
      const iv = i === 0 ? { laps: 0, ms: null } : behind(m, running[i - 1]);
      return {
        driverId: m.driverId, rank: i + 1, laps: m.raceLaps, bestMs: m.bestMs, lastMs: m.lastMs,
        sectors: m.sectors, bestSectors: m.bestSectors, totalMs: m.lastAt - t0,
        gapMs: g.ms, gapLaps: g.laps, intMs: iv.ms, intLaps: iv.laps,
      };
    });
    // No race lap yet: no rank, so the console keeps them in grid order behind the runners.
    for (const m of waiting) {
      rows.push({ driverId: m.driverId, rank: null, laps: 0, bestMs: m.bestMs, lastMs: m.lastMs, sectors: m.sectors, bestSectors: m.bestSectors, gapMs: null, gapLaps: 0, intMs: null, intLaps: 0 });
    }
    this.race.apply({ type: 'timing.external', mode: 'race', rows });
  }
}
