// Driver accounts, kept deliberately apart from the race state.
//
// `/api/state` is served to anything on the network and pushed to every overlay several
// times a second. Nothing in this file may ever reach it: no password, no hash, no token.
// That separation is the whole reason this is its own module and its own file rather than
// another section of state.js — a field added to the wrong object would quietly publish
// credentials to every browser on the LAN.
//
// What this protects, honestly: it stops one driver signing in as another at a club
// event. It is not a defence against anyone who can watch the network. Registration and
// login travel over plain HTTP on port 4700 unless the driver uses the HTTPS port, so on
// a shared or hostile network the password is visible in transit. That is worth knowing
// and not worth pretending otherwise; the stakes here are a name on a leaderboard.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = process.env.FRL_STATE_FILE
  ? path.dirname(path.resolve(process.env.FRL_STATE_FILE))
  : path.join(__dirname, '..', 'data');
const FILE = path.join(DIR, 'drivers-auth.json');

const TOKEN_DAYS = 30;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

/** scrypt with a per-account salt. Deliberately slow, which is the point. */
function hash(password, salt = crypto.randomBytes(16).toString('hex')) {
  const key = crypto.scryptSync(String(password), salt, SCRYPT.keylen, SCRYPT).toString('hex');
  return { salt, key };
}

/**
 * Constant-time compare.
 *
 * A plain === leaks how much of the hash matched through timing. It is a small leak and
 * this is a small system, but comparing secrets in constant time costs one function call.
 */
function same(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export class DriverAuth {
  constructor() {
    this.data = { accounts: [], tokens: {} };
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(FILE)) this.data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    } catch (err) {
      console.error('[auth] could not read accounts:', err.message);
    }
    this.data.accounts ||= [];
    this.data.tokens ||= {};
    this.purge();
  }

  save() {
    try {
      fs.mkdirSync(DIR, { recursive: true });
      // 0600: the file is only ever read by this process, and it holds password hashes.
      fs.writeFileSync(FILE, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    } catch (err) {
      console.error('[auth] could not write accounts:', err.message);
    }
  }

  purge() {
    const now = Date.now();
    let changed = false;
    for (const [t, v] of Object.entries(this.data.tokens)) {
      if (!v || v.expires < now) { delete this.data.tokens[t]; changed = true; }
    }
    if (changed) this.save();
  }

  /** Accounts are identified by racing number: one number, one entrant. */
  find(num) {
    return this.data.accounts.find((a) => String(a.num) === String(num)) || null;
  }

  /**
   * Register, or re-register the same number with the same password.
   *
   * A club event runs on a phone in a hurry, so a driver typing their details again must
   * not hit a wall — but only if they can prove the number is theirs. A different password
   * on an existing number is refused rather than overwriting it.
   */
  register({ nick, num, password, team }) {
    const cleanNick = String(nick || '').trim().slice(0, 24);
    const cleanNum = String(num || '').trim().slice(0, 4);
    const cleanTeam = String(team || '').trim().slice(0, 30);
    if (!cleanNick || !cleanNum) return { ok: false, error: 'Name and number are required' };
    if (String(password || '').length < 4) return { ok: false, error: 'Password must be at least 4 characters' };

    const existing = this.find(cleanNum);
    if (existing) {
      const check = hash(password, existing.salt);
      if (!same(check.key, existing.key)) {
        return { ok: false, error: `Number ${cleanNum} is already registered to someone else` };
      }
      existing.nick = cleanNick;
      // An empty box means "leave it as it is", not "I have no team". A driver rejoining
      // from a new phone should not have to retype it to keep it.
      if (cleanTeam) existing.team = cleanTeam;
      this.save();
      return { ok: true, account: this.publicOf(existing), rejoined: true };
    }

    const { salt, key } = hash(password);
    const account = {
      id: `a${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`,
      nick: cleanNick,
      num: cleanNum,
      team: cleanTeam,
      salt,
      key,
      at: Date.now()
    };
    this.data.accounts.push(account);
    this.save();
    return { ok: true, account: this.publicOf(account) };
  }

  login({ num, password, team }) {
    const account = this.find(num);
    // The same message either way: saying "no such number" tells anyone probing which
    // numbers exist, and the driver whose number it really is gains nothing from it.
    const wrong = { ok: false, error: 'Number or password is wrong' };
    if (!account) return wrong;
    const check = hash(password, account.salt);
    if (!same(check.key, account.key)) return wrong;

    // Signing in is also how a driver corrects their team between rounds, which is the
    // only reason the field is on that screen at all. Blank changes nothing.
    const cleanTeam = String(team || '').trim().slice(0, 30);
    if (cleanTeam) account.team = cleanTeam;

    const token = crypto.randomBytes(24).toString('hex');
    this.data.tokens[token] = {
      accountId: account.id,
      expires: Date.now() + TOKEN_DAYS * 86400000
    };
    this.save();
    return { ok: true, token, account: this.publicOf(account) };
  }

  whoIs(token) {
    const t = this.data.tokens[String(token || '')];
    if (!t || t.expires < Date.now()) return null;
    const account = this.data.accounts.find((a) => a.id === t.accountId);
    return account ? this.publicOf(account) : null;
  }

  logout(token) {
    if (this.data.tokens[token]) { delete this.data.tokens[token]; this.save(); }
  }

  remove(id) {
    this.data.accounts = this.data.accounts.filter((a) => a.id !== id);
    for (const [t, v] of Object.entries(this.data.tokens)) {
      if (v.accountId === id) delete this.data.tokens[t];
    }
    this.save();
  }

  /** Everything about an account that is safe to send anywhere. Never salt or key. */
  publicOf(a) {
    return { id: a.id, nick: a.nick, num: a.num, team: a.team || '', at: a.at };
  }

  list() {
    return this.data.accounts.map((a) => this.publicOf(a));
  }
}
