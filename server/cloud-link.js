import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { SupabaseStore } from '../public/js/supabase-store.js';

/*
 * The online link: drivers anywhere, race control on the desktop app.
 *
 * An FR Legends league is online. The drivers are at home, not on the operator's WiFi, so
 * a phone can never reach this server's LAN address. The hosted site already solved
 * reaching phones: the driver app talks to Supabase with an event code, and driver_state
 * reads the flag from `events`, the car from `drivers` and the penalties from `penalties`.
 *
 * So this server keeps being the timing computer and simply keeps a hosted event in step:
 *   - out: every change to the race state is mirrored into that event's rows, through the
 *     same SupabaseStore the hosted console uses (one mapping, not two);
 *   - in:  sign-ins (`registrations`) and team radio (`team_radio`) are read back every few
 *     seconds and applied here, so they appear in this console and on the local overlays.
 * Drivers type the event code in the app from anywhere; the operator keeps the Piper voice,
 * the timing API and everything else only the desktop app has.
 *
 * Signing in: the operator's FRLcast website account (email + password, typed once into the
 * local console). Only the refresh token is kept, in data/cloud.json (gitignored, 0600),
 * never in the race state that is broadcast to every overlay, same rule as the timing key.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PULL_MS = 3000;
const PUSH_GAP_MS = 1000;

/** The project URL and public anon key, from the same file the website uses. */
function loadConfig(root) {
  const env = { url: process.env.FRL_SUPABASE_URL, key: process.env.FRL_SUPABASE_ANON_KEY };
  if (env.url && env.key) return env;
  for (const f of [path.join(root, 'site', 'supabase-config.js'), path.join(root, 'public', 'supabase-config.js')]) {
    try {
      const text = fs.readFileSync(f, 'utf8');
      const url = (/url:\s*'([^']+)'/.exec(text) || [])[1];
      const key = (/anonKey:\s*'([^']+)'/.exec(text) || [])[1];
      if (url && key) return { url, key };
    } catch { /* try the next one */ }
  }
  return { url: '', key: '' };
}

/*
 * A small PostgREST client with the slice of the supabase-js query builder SupabaseStore
 * uses (from().update/insert/delete().eq/in, awaited for { error }). Enough to share the
 * store without shipping supabase-js and its realtime stack inside the desktop app.
 */
class Query {
  constructor(link, table) {
    this.link = link; this.table = table;
    this.method = 'GET'; this.body = undefined; this.params = []; this.prefer = '';
  }
  select(cols = '*') { this.params.push(`select=${encodeURIComponent(cols)}`); return this; }
  update(patch) { this.method = 'PATCH'; this.body = patch; this.prefer = 'return=minimal'; return this; }
  insert(rows) { this.method = 'POST'; this.body = rows; this.prefer = 'return=minimal'; return this; }
  delete() { this.method = 'DELETE'; this.prefer = 'return=minimal'; return this; }
  eq(col, v) { this.params.push(`${col}=eq.${encodeURIComponent(v)}`); return this; }
  gt(col, v) { this.params.push(`${col}=gt.${encodeURIComponent(v)}`); return this; }
  in(col, list) { this.params.push(`${col}=in.(${list.map((v) => encodeURIComponent(v)).join(',')})`); return this; }
  order(col, { ascending = true } = {}) { this.params.push(`order=${col}.${ascending ? 'asc' : 'desc'}`); return this; }
  limit(n) { this.params.push(`limit=${n}`); return this; }
  async run() {
    try {
      const data = await this.link.rest(this.method, `${this.table}?${this.params.join('&')}`, this.body, this.prefer);
      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  }
  then(ok, fail) { return this.run().then(ok, fail); }
}

export class CloudLink {
  constructor(root, race) {
    this.root = root;
    this.race = race;
    this.cfg = loadConfig(root);
    this.file = path.join(root, 'data', 'cloud.json');
    this.saved = {};
    try { this.saved = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { /* not linked yet */ }
    this.session = null;         // { access, expiresAt }
    this.event = null;           // the linked events row
    this.store = null;
    this.cloudIds = new Set();   // registration ids that came from the hosted event
    this.cloudAccounts = new Set();
    this.pending = new Set();    // registrations being written right now
    this.lastRegs = '';
    this.quiet = false;          // first read after linking: nothing in it is news
    this.radioCursor = '';
    this.lastError = '';
    this.lastPushAt = 0;
    this.lastPullAt = 0;
    this.busy = false;
    this.dirty = false;
    this.timer = null;
    this.pullTimer = null;
    this.unsub = null;
  }

  get configured() { return !!(this.cfg.url && this.cfg.key); }

  status() {
    const regs = (this.race.state.registrations || []).filter((r) => this.cloudIds.has(r.id));
    return {
      configured: this.configured,
      signedIn: !!this.saved.refreshToken,
      email: this.saved.email || '',
      linked: !!this.event,
      code: this.event ? this.event.code : (this.saved.code || ''),
      eventName: this.event ? this.event.name : '',
      pending: regs.filter((r) => r.status === 'pending').length,
      lastPushAt: this.lastPushAt || null,
      lastPullAt: this.lastPullAt || null,
      error: this.lastError
    };
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.saved, null, 2), { mode: 0o600 });
    } catch (e) { console.error('[online] could not save the link:', e.message); }
  }

  // ---------------------------------------------------------------- auth

  async auth(grant, body) {
    const res = await fetch(`${this.cfg.url}/auth/v1/token?grant_type=${grant}`, {
      method: 'POST',
      headers: { apikey: this.cfg.key, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000)
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error_description || j.msg || j.message || `Sign-in failed (${res.status})`);
    this.session = { access: j.access_token, expiresAt: Date.now() + (j.expires_in || 3600) * 1000 };
    // Refresh tokens rotate: keep the newest or the next start cannot sign back in.
    this.saved.refreshToken = j.refresh_token;
    if (j.user) { this.saved.userId = j.user.id; this.saved.email = j.user.email; }
    this.save();
  }

  async login(email, password) {
    if (!this.configured) throw new Error('This copy has no Supabase project configured.');
    await this.auth('password', { email: String(email || '').trim(), password: String(password || '') });
  }

  async token() {
    if (this.session && this.session.expiresAt - 60000 > Date.now()) return this.session.access;
    if (!this.saved.refreshToken) throw new Error('Sign in to your FRLcast account first.');
    await this.auth('refresh_token', { refresh_token: this.saved.refreshToken });
    return this.session.access;
  }

  logout() {
    this.unlink();
    this.saved = {};
    this.session = null;
    this.save();
  }

  async rest(method, pathAndQuery, body, prefer, retried = false) {
    const res = await fetch(`${this.cfg.url}/rest/v1/${pathAndQuery}`, {
      method,
      headers: {
        apikey: this.cfg.key,
        authorization: `Bearer ${await this.token()}`,
        'content-type': 'application/json',
        ...(prefer ? { prefer } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000)
    });
    if (res.status === 401 && !retried) {
      this.session = null;
      return this.rest(method, pathAndQuery, body, prefer, true);
    }
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try { const j = JSON.parse(text); msg = j.message || j.hint || text; } catch { /* plain text */ }
      this.lastRestError = String(msg).slice(0, 200);
      throw new Error(`${res.status} ${msg}`.slice(0, 300));
    }
    return text ? JSON.parse(text) : null;
  }

  from(table) { return new Query(this, table); }

  async events() {
    const { data, error } = await this.from('events').select('id,code,name,round,updated_at')
      .eq('owner', this.saved.userId || '').order('updated_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  // ---------------------------------------------------------------- ids

  /*
   * Supabase keys cars and penalties by uuid. Everything made since the move to shared
   * timing already is one, but an event file from before that can carry short ids, and one
   * such row fails the whole write. Those get a stable uuid derived from the event and the
   * local id, so the same car always lands on the same row.
   */
  uid(localId) {
    if (!localId) return null;
    if (UUID.test(localId)) return localId;
    const h = crypto.createHash('sha1').update(`${this.event.id}:${localId}`).digest('hex');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
  }

  /** The race state as the hosted event should see it. */
  mirrorOf(s) {
    const U = (id) => this.uid(id);
    const drivers = s.drivers.map((d) => ({
      ...d,
      id: U(d.id),
      // Only a hosted account is a real row in driver_accounts; a LAN sign-in's id is not,
      // and a foreign key that points nowhere would sink the write.
      accountId: this.cloudAccounts.has(d.accountId) ? d.accountId : null,
      // The predicted running order moves every second; the phones do not need it and it
      // would be a row update per car per second. Positions still follow every crossing.
      progress: 0
    }));
    const race = {
      ...s.race,
      penalties: (s.race.penalties || []).map((p) => ({ ...p, driverId: U(p.driverId) })),
      grid: Array.isArray(s.race.grid) ? s.race.grid.map((g) => (typeof g === 'string' ? U(g) : g)) : s.race.grid
    };
    const feed = (s.feed || []).map((f) => ({ ...f, driverId: f.driverId ? U(f.driverId) : null }));
    return { ...s, drivers, race, feed };
  }

  // ---------------------------------------------------------------- link

  async link(code) {
    code = String(code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{4,12}$/.test(code)) throw new Error('An event code is 4 to 12 letters or digits.');
    await this.token();
    const { data, error } = await this.from('events').select('id,owner,code,name').eq('code', code);
    if (error) throw error;
    const row = (data || [])[0];
    if (!row) throw new Error(`No event with code ${code}. Create it on the website dashboard first.`);
    if (row.owner !== this.saved.userId) throw new Error(`Event ${code} belongs to another account.`);

    this.unlink(false);
    this.event = row;
    await this.baseline();

    // Radio: start from the newest message already there, so old calls are not replayed.
    const last = await this.from('team_radio').select('created_at').eq('event_id', row.id)
      .order('created_at', { ascending: false }).limit(1);
    this.radioCursor = (last.data && last.data[0] && last.data[0].created_at) || '1970-01-01T00:00:00Z';

    this.saved.code = code;
    this.save();
    this.lastError = '';
    this.quiet = true;
    await this.pull();
    this.quiet = false;
    await this.reconcile();
    await this.pushNow();

    this.unsub = this.race.subscribe(() => this.schedule());
    this.pullTimer = setInterval(() => this.pull().catch(() => {}), PULL_MS);
    console.log(`  Online link: drivers join event ${code} from anywhere with the driver app.`);
    return this.status();
  }

  /**
   * What the hosted event already holds, so the first write updates and deletes rather
   * than inserting duplicates. Called again after a failed write to resync from the truth.
   */
  async baseline() {
    const [drv, pen] = await Promise.all([
      this.from('drivers').select('id').eq('event_id', this.event.id),
      this.from('penalties').select('id').eq('event_id', this.event.id)
    ]);
    if (drv.error) throw drv.error;
    if (pen.error) throw pen.error;
    this.store = new SupabaseStore(this, this.event, null);
    // Every existing car is "known but different": ours are updated, the rest deleted.
    this.store.lastDrivers = new Map((drv.data || []).map((r) => [r.id, {}]));
    this.store.sentPenalties = new Set((pen.data || []).map((r) => r.id));
    // The local log's history is not replayed into the hosted one; only what happens next.
    this.store.sentFeed = new Set((this.race.state.feed || []).map((f) => f.t + '|' + f.text));
  }

  unlink(forget = true) {
    if (this.unsub) { this.unsub(); this.unsub = null; }
    clearInterval(this.pullTimer); this.pullTimer = null;
    clearTimeout(this.timer); this.timer = null;
    if (this.event && this.cloudIds.size) {
      // Take the hosted sign-ins off this console's list; they belong to the event.
      const rows = (this.race.state.registrations || []).filter((r) => !this.cloudIds.has(r.id));
      this.race.apply({ type: 'registration.sync', rows });
    }
    this.event = null;
    this.store = null;
    this.cloudIds = new Set();
    this.cloudAccounts = new Set();
    this.lastRegs = '';
    if (forget) { delete this.saved.code; this.save(); }
  }

  /** Relink on start when the last session ended linked. */
  async resume() {
    if (!this.configured || !this.saved.refreshToken || !this.saved.code) return;
    try { await this.link(this.saved.code); } catch (e) {
      this.lastError = `Could not reconnect to ${this.saved.code}: ${e.message}`;
      console.error('[online]', this.lastError);
    }
  }

  // ---------------------------------------------------------------- out: state -> event

  schedule() {
    if (!this.event || this.timer) return;
    if (this.busy) { this.dirty = true; return; }
    const wait = Math.max(0, this.lastPushAt + PUSH_GAP_MS - Date.now());
    this.timer = setTimeout(() => { this.timer = null; this.push(); }, wait);
  }

  async push() {
    if (!this.event || !this.store) return;
    this.busy = true;
    this.dirty = false;
    const before = this.store.failures;
    try {
      this.store.write(this.mirrorOf(this.race.state));
      await this.store.chain;
      if (this.store.failures > before) {
        // The store remembers a change before sending it, so after a failure the next diff
        // would skip what was lost. Rebuild the baseline and send everything once more.
        this.lastError = `A write to the online event failed (${this.lastRestError || 'unknown error'}); resending. Two cars with one number is the usual cause.`;
        await this.baseline();
        this.dirty = true;
      } else {
        if (this.lastError.startsWith('A write')) this.lastError = '';
        this.lastPushAt = Date.now();
      }
    } catch (e) {
      this.lastError = e.message;
    } finally {
      this.busy = false;
      if (this.dirty) this.schedule();
    }
  }

  /** Write now and wait for it: a sign-in row must not point at a car not yet there. */
  async pushNow() {
    clearTimeout(this.timer); this.timer = null;
    while (this.busy) await new Promise((r) => setTimeout(r, 50));
    await this.push();
  }

  // ---------------------------------------------------------------- in: event -> here

  async pull() {
    if (!this.event) return;
    const ev = this.event.id;
    const [regs, radio] = await Promise.all([
      this.from('registrations').select('id,account_id,nick,num,team,status,driver_id,created_at')
        .eq('event_id', ev).order('created_at', { ascending: true }),
      this.from('team_radio').select('id,team,from_nick,from_num,text,created_at')
        .eq('event_id', ev).gt('created_at', this.radioCursor).order('created_at', { ascending: true })
    ]);
    if (regs.error || radio.error) {
      this.lastError = (regs.error || radio.error).message;
      return;
    }
    if (this.lastError && !this.lastError.startsWith('A write')) this.lastError = '';
    this.lastPullAt = Date.now();
    this.applyRegistrations(regs.data || []);
    for (const m of radio.data || []) {
      const at = new Date(m.created_at).getTime();
      this.race.apply({ type: 'driver.radio', id: at, at, team: m.team, from: m.from_nick, num: m.from_num, text: m.text });
      this.radioCursor = m.created_at;
    }
  }

  applyRegistrations(data) {
    const back = new Map(this.race.state.drivers.map((d) => [this.uid(d.id), d.id]));
    const local = new Map((this.race.state.registrations || []).map((r) => [r.id, r]));
    const rows = data.map((r) => {
      // A row this console is mid-way through writing keeps what the console decided.
      const held = this.pending.has(r.id) ? local.get(r.id) : null;
      return {
        id: r.id, accountId: r.account_id, nick: r.nick, num: r.num, team: r.team || '',
        at: new Date(r.created_at).getTime(),
        status: held ? held.status : r.status,
        driverId: held ? held.driverId : (back.get(r.driver_id) || null)
      };
    });
    this.cloudAccounts = new Set(data.map((r) => r.account_id));
    const sig = JSON.stringify(rows);
    if (sig === this.lastRegs) return;

    const known = this.cloudIds;
    for (const r of rows) {
      if (!this.quiet && !known.has(r.id) && r.status === 'pending') {
        this.race.apply({ type: 'feed.push', kind: 'flag', text: `${r.nick} #${r.num} SIGNED IN (ONLINE)` });
      }
    }
    this.cloudIds = new Set(rows.map((r) => r.id));
    this.lastRegs = sig;
    // The LAN sign-ins stay; the hosted ones are replaced by what the event holds now.
    const lan = (this.race.state.registrations || []).filter((r) => !known.has(r.id) && !this.cloudIds.has(r.id));
    this.race.apply({ type: 'registration.sync', rows: [...lan, ...rows] });
  }

  /**
   * After linking: an accepted driver whose car is not on this grid gets one, by number
   * when a car with that number exists, otherwise back in the queue to be accepted again.
   */
  async reconcile() {
    const regs = (this.race.state.registrations || []).filter((r) => this.cloudIds.has(r.id));
    for (const r of regs) {
      if (r.status !== 'approved' || r.driverId) continue;
      const car = this.race.state.drivers.find((d) => String(d.num) === String(r.num));
      const patch = car ? { driver_id: this.uid(car.id) } : { status: 'pending', driver_id: null };
      if (car) {
        await this.pushNow();
        this.race.apply({ type: 'registration.sync', rows: this.race.state.registrations.map((x) => (x.id === r.id ? { ...x, driverId: car.id } : x)) });
      }
      const { error } = await this.from('registrations').update(patch).eq('id', r.id);
      if (error) this.lastError = error.message;
    }
    this.lastRegs = '';
    await this.pull();
  }

  /** Accept / refuse / forget a hosted sign-in. Returns true when it was one. */
  intercept(a) {
    if (!this.event || !a || !this.cloudIds.has(a.id)) return false;
    if (!['registration.approve', 'registration.reject', 'registration.remove'].includes(a.type)) return false;
    this.writeRegistration(a).catch((e) => { this.lastError = `Could not save that sign-in: ${e.message}`; });
    return true;
  }

  async writeRegistration(a) {
    this.pending.add(a.id);
    try {
      this.race.apply(a);
      if (a.type === 'registration.remove') {
        const { error } = await this.from('registrations').delete().eq('id', a.id);
        if (error) throw error;
        return;
      }
      const after = (this.race.state.registrations || []).find((x) => x.id === a.id);
      // The car first (the sign-in row points at it by foreign key), then the row.
      await this.pushNow();
      const { error } = await this.from('registrations')
        .update({ status: after.status, driver_id: after.driverId ? this.uid(after.driverId) : null })
        .eq('id', a.id);
      if (error) throw error;
    } finally {
      this.pending.delete(a.id);
      this.lastRegs = '';
      this.pull().catch(() => {});
    }
  }
}
