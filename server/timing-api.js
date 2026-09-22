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
    return { status: r.status, body, retryAfter: Number(r.headers.get('retry-after')) || 0 };
  }

  upsert(p) {
    if (!p || !p.id) return;
    const cur = this.players.get(p.id) || {};
    if (p.name != null) cur.name = p.name;
    if (p.bestMs != null) cur.bestMs = p.bestMs;
    if (p.laps != null) cur.laps = p.laps;
    const es = p.entries || [];
    if (es.length) cur.lastMs = es[es.length - 1].ms;   // entries are ascending by seq
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
      if (driverId && pl.bestMs != null) matched.push({ driverId, bestMs: pl.bestMs, laps: pl.laps, lastMs: pl.lastMs });
    }
    // Contest mode: rank by best single lap, ascending.
    matched.sort((a, b) => a.bestMs - b.bestMs);
    const rows = matched.map((m, i) => ({ driverId: m.driverId, rank: i + 1, laps: m.laps, bestMs: m.bestMs, lastMs: m.lastMs }));
    this.matched = rows.length;
    this.race.apply({ type: 'timing.external', rows });
  }
}
