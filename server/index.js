import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
// The timing logic itself lives under public/ because the operator's browser has to be
// able to load it too: for a hosted event the console is the timing computer, and it
// must run the same code this server does rather than a second implementation of it.
import { RaceState } from '../public/js/race-state.js';
import { assetId, ASSET_MAX } from '../public/js/design.js';
import { FileStore } from './file-store.js';
import { ensureCert } from './tls.js';
import { DriverAuth } from './drivers-auth.js';
import { TimingApi } from './timing-api.js';
import { Updates } from './updates.js';
import { CloudLink } from './cloud-link.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 4700;
const TLS_PORT = Number(process.env.TLS_PORT) || PORT + 1;

/**
 * Every IPv4 address another machine could reach us on, best guess first.
 *
 * Picking "the first non-internal address" is wrong on a real desktop: VPN clients,
 * WSL and hypervisors all add adapters that answer that description, and handing the
 * operator a Radmin VPN address when their laptop is on Ethernet sends them chasing a
 * connection that will never work. So rank them and print them all.
 */
function lanAddresses() {
  const VIRTUAL = /vpn|hamachi|radmin|virtualbox|vmware|wsl|hyper-v|vethernet|loopback|tap|tun|docker|bluetooth/i;
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const n of list || []) {
      if (!n || n.family !== 'IPv4' || n.internal) continue;
      const privateLan = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(n.address);
      out.push({
        address: n.address,
        name,
        netmask: n.netmask,
        subnet: subnetLabel(n.address, n.netmask),
        likely: privateLan && !VIRTUAL.test(name)
      });
    }
  }
  return out.sort((a, b) => Number(b.likely) - Number(a.likely));
}

/**
 * A readable name for the network an address sits on, so the operator can compare it
 * against the other device at a glance: "192.168.100.x" rather than a masked address.
 */
function subnetLabel(address, netmask) {
  if (!netmask) return address;
  const a = address.split('.').map(Number);
  const m = netmask.split('.').map(Number);
  const bits = m.reduce((n, o) => n + ((o >>> 0).toString(2).match(/1/g) || []).length, 0);
  const net = a.map((v, i) => v & m[i]);
  if (bits === 24) return `${net.slice(0, 3).join('.')}.x`;
  if (bits === 16) return `${net.slice(0, 2).join('.')}.x.x`;
  if (bits === 8) return `${net[0]}.x.x.x`;
  return `${net.join('.')}/${bits}`;
}

/** Strip the IPv6 mapping Node puts on IPv4 peers, so addresses read normally. */
function cleanIp(ip) {
  if (!ip) return '';
  const v = ip.replace(/^::ffff:/, '');
  return v === '::1' || v === '127.0.0.1' ? 'this machine' : v;
}

const race = new RaceState(new FileStore());
const auth = new DriverAuth();
const timing = new TimingApi(race, ROOT);
const LIVE = ['formation', 'green', 'yellow', 'safety', 'red'];
const cloud = new CloudLink(ROOT, race);

/*
 * Every action from a console goes through here. A sign-in that came from the online event
 * is answered in that event's database as well, so it is handed to the link instead.
 */
function applyAction(a) {
  if (cloud.intercept(a)) return true;
  return race.apply(a);
}

const updates = new Updates(ROOT, {
  isRacing: () => !!race.state.race.startedAt && LIVE.includes(race.state.race.status)
});
const app = express();
app.use(express.json({ limit: '8mb' }));

// OBS's embedded browser caches aggressively and will happily keep running an old
// overlay build after you edit one. serve-static writes its own Cache-Control, so the
// override has to go through setHeaders rather than an upstream middleware.
const noCache = {
  setHeaders(res, filePath) {
    if (/\.(html|js|css)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
};

/*
 * The uploaded logo is the one file here that did not come from this repository, and SVG
 * is a document format that can carry script. Rendered through <img> it is inert, but
 * opening /brand/logo.svg directly would run it in this origin: where the operator's
 * session lives. A sandbox header costs nothing and removes the question entirely.
 */
app.use('/brand', (_req, res, next) => {
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

app.use(express.static(path.join(ROOT, 'public'), noCache));
// tesseract + its worker/wasm assets, served locally so OBS/offline still works
app.use('/vendor/tesseract', express.static(path.join(ROOT, 'node_modules', 'tesseract.js', 'dist')));
app.use('/vendor/tesseract-core', express.static(path.join(ROOT, 'node_modules', 'tesseract.js-core')));

app.get('/api/state', (_req, res) => res.json(race.state));

// Reachability check the second device can open directly in its browser.
app.get('/api/ping', (req, res) => {
  res.json({
    ok: true,
    server: lanAddresses(),
    you: cleanIp(req.socket.remoteAddress),
    at: Date.now()
  });
});

// tlsPort is here for the driver page: over plain http Android blocks both the service
// worker and the Notification API, so a phone has to be told where the https door is.
// null when no certificate could be made, which is the honest answer: there is no door.
app.get('/api/net', (_req, res) => res.json({
  port: PORT, tlsPort: secure ? TLS_PORT : null, addresses: lanAddresses(), clients: clientList()
}));

app.post('/api/action', (req, res) => {
  const ok = applyAction(req.body);
  res.json({ ok, state: race.state });
});

/*
 * The public certificate, offered over plain http so a second machine can fetch it
 * without first having to trust it. Installing it there as a trusted root removes the
 * "Your connection is not private" warning for good.
 *
 * Only the certificate is served. The private key never leaves this machine: certs/ is
 * outside every static root on purpose, and this route names one file explicitly rather
 * than exposing the directory.
 */
app.get('/frl-ca.crt', (req, res) => {
  const file = path.join(ROOT, 'certs', 'cert.pem');
  if (!fs.existsSync(file)) return res.status(404).send('No certificate has been generated.');
  res.type('application/x-x509-ca-cert');
  res.setHeader('Content-Disposition', 'attachment; filename="frl-ca.crt"');
  return res.sendFile(file);
});

/*
 * League logo upload.
 *
 * The image is written to disk and referenced by URL, never carried in the state: state
 * goes out over the socket several times a second while a race runs, and an inlined logo
 * would be retransmitted with every lap.
 *
 * The filename is fixed and the extension comes from the declared image type, never from
 * anything the client sends, so there is no path to traverse and no way to land an
 * executable extension in a served directory. Anything that is not a small image is
 * refused outright.
 */
const LOGO_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg' };

app.post('/api/brand/logo', (req, res) => {
  const dataUrl = String((req.body && req.body.dataUrl) || '');
  const m = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return res.status(400).json({ ok: false, error: 'Not an image' });

  const ext = LOGO_TYPES[m[1].toLowerCase()];
  if (!ext) return res.status(400).json({ ok: false, error: 'Use PNG, JPEG, WebP or SVG' });

  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 2 * 1024 * 1024) return res.status(413).json({ ok: false, error: 'Logo must be under 2MB' });

  try {
    const dir = path.join(ROOT, 'public', 'brand');
    fs.mkdirSync(dir, { recursive: true });
    // one logo, one name: replacing it must not leave the old one served
    for (const e of Object.values(LOGO_TYPES)) {
      const old = path.join(dir, `logo.${e}`);
      if (fs.existsSync(old)) fs.rmSync(old, { force: true });
    }
    fs.writeFileSync(path.join(dir, `logo.${ext}`), buf);
    const url = `/brand/logo.${ext}?v=${Date.now()}`;
    race.apply({ type: 'brand.update', patch: { logoUrl: url } });
    return res.json({ ok: true, url });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete('/api/brand/logo', (_req, res) => {
  try {
    const dir = path.join(ROOT, 'public', 'brand');
    for (const e of Object.values(LOGO_TYPES)) {
      const f = path.join(dir, `logo.${e}`);
      if (fs.existsSync(f)) fs.rmSync(f, { force: true });
    }
  } catch { /* nothing to remove */ }
  race.apply({ type: 'brand.update', patch: { logoUrl: '' } });
  res.json({ ok: true });
});

/*
 * Design studio assets: pictures and fonts for the custom broadcast design.
 *
 * Same rules as the logo, and stricter about what a file is: the type comes from the
 * file's own first bytes, never from the name or the MIME type the browser guessed (a
 * look imported from another league is a file nobody here made). Files are named by a
 * server-made id, so nothing the client sends becomes a path. They live in
 * public/brand/assets, which the updater never overwrites and which the /brand sandbox
 * header above already covers.
 */
const ASSET_DIR = path.join(ROOT, 'public', 'brand', 'assets');
const ASSET_BYTES = 5 * 1024 * 1024;

function sniffAsset(buf) {
  const head = buf.subarray(0, 12);
  const ascii = head.toString('latin1');
  if (head[0] === 0x89 && ascii.slice(1, 4) === 'PNG') return { ext: 'png', kind: 'image' };
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { ext: 'jpg', kind: 'image' };
  if (ascii.startsWith('GIF8')) return { ext: 'gif', kind: 'image' };
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return { ext: 'webp', kind: 'image' };
  if (ascii.startsWith('wOF2')) return { ext: 'woff2', kind: 'font' };
  if (ascii.startsWith('wOFF')) return { ext: 'woff', kind: 'font' };
  if (ascii.startsWith('OTTO')) return { ext: 'otf', kind: 'font' };
  if ((head[0] === 0 && head[1] === 1 && head[2] === 0 && head[3] === 0) || ascii.startsWith('true')) return { ext: 'ttf', kind: 'font' };
  const text = buf.subarray(0, 2048).toString('utf8').trimStart().toLowerCase();
  if (text.startsWith('<svg') || (text.startsWith('<?xml') && text.includes('<svg'))) return { ext: 'svg', kind: 'image' };
  return null;
}

app.post('/api/design/asset', (req, res) => {
  const m = /^data:[^;,]*;base64,([A-Za-z0-9+/=]+)$/.exec(String((req.body && req.body.dataUrl) || ''));
  if (!m) return res.status(400).json({ ok: false, error: 'Not a file' });
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > ASSET_BYTES) return res.status(413).json({ ok: false, error: 'Files must be under 5MB' });
  const type = sniffAsset(buf);
  if (!type) return res.status(400).json({ ok: false, error: 'Use PNG, JPEG, GIF, WebP or SVG for pictures, and WOFF2, WOFF, TTF or OTF for fonts' });

  const list = race.state.overlay.assets || [];
  if (list.length >= ASSET_MAX) return res.status(400).json({ ok: false, error: `At most ${ASSET_MAX} files: remove one first` });
  const name = String((req.body && req.body.name) || 'asset').slice(0, 60);
  const id = assetId(name, new Set(list.map((a) => a.id)));
  try {
    fs.mkdirSync(ASSET_DIR, { recursive: true });
    fs.writeFileSync(path.join(ASSET_DIR, `${id}.${type.ext}`), buf);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
  const asset = { id, name, kind: type.kind, url: `/brand/assets/${id}.${type.ext}?v=${Date.now()}` };
  race.apply({ type: 'overlay.update', patch: { assets: [...list, asset] } });
  res.json({ ok: true, asset });
});

app.delete('/api/design/asset/:id', (req, res) => {
  const id = String(req.params.id || '');
  const list = race.state.overlay.assets || [];
  const hit = list.find((a) => a.id === id);
  if (!hit) return res.status(404).json({ ok: false, error: 'No such file' });
  // Only a file this route wrote: the id is checked against the list, and the extension
  // comes from the stored URL, so no client text reaches the path.
  const m = /^\/brand\/assets\/([a-z0-9-]+)\.(png|jpg|gif|webp|svg|woff2|woff|otf|ttf)(\?|$)/.exec(hit.url);
  if (m && m[1] === id) {
    try { fs.rmSync(path.join(ASSET_DIR, `${id}.${m[2]}`), { force: true }); } catch { /* already gone */ }
  }
  race.apply({ type: 'overlay.update', patch: { assets: list.filter((a) => a.id !== id) } });
  res.json({ ok: true });
});

/*
 * Driver sign-in.
 *
 * Everything secret stays inside DriverAuth and its own file. These routes only ever hand
 * back a name, a number and a session token; the queue they write into the race state
 * carries no more than that, because that state is public on this network.
 */
const clientOf = (req) => cleanIp(req.socket.remoteAddress);

app.post('/api/driver/register', (req, res) => {
  const { nick, num, password, team } = req.body || {};
  const out = auth.register({ nick, num, password, team });
  if (!out.ok) return res.status(400).json(out);
  race.apply({
    type: 'registration.add',
    accountId: out.account.id, nick: out.account.nick, num: out.account.num,
    team: out.account.team
  });
  const login = auth.login({ num: out.account.num, password });
  console.log(`[driver] ${out.account.nick} #${out.account.num} signed in from ${clientOf(req)}`);
  return res.json({ ok: true, token: login.token, driver: out.account, rejoined: !!out.rejoined });
});

app.post('/api/driver/login', (req, res) => {
  const { num, password, team } = req.body || {};
  const out = auth.login({ num, password, team });
  if (!out.ok) return res.status(401).json(out);
  // Signing in again re-raises the request if the operator had turned it down, so a
  // driver who fixed whatever was wrong does not have to be told to re-register.
  race.apply({
    type: 'registration.add',
    accountId: out.account.id, nick: out.account.nick, num: out.account.num,
    team: out.account.team
  });
  return res.json({ ok: true, token: out.token, driver: out.account });
});

app.post('/api/driver/logout', (req, res) => {
  auth.logout((req.body || {}).token);
  res.json({ ok: true });
});

/**
 * Everything a driver's phone needs, and nothing else.
 *
 * Deliberately not /api/state: a driver does not need the roster, the calibration or the
 * penalty record, and sending a phone the whole broadcast state several times a second
 * would cost battery for information it cannot use.
 */
/*
 * A driver's own numbers, plus the pit board: the cars directly ahead and behind with the
 * gap to each, the gap to the leader, and the laps left. Taken from the running order the
 * leaderboard uses, so it follows every timing source (vision, the timing API, manual).
 * The hosted event builds the same shape in SQL (driver_state); keep the two in step.
 */
function pitBoard(s, d) {
  const byPos = (n) => (s.drivers || []).find((x) => x.position === n) || null;
  const car = (x, gap) => (x ? { num: x.num, name: x.name, gap: x.dnf ? 'DNF' : (gap || '') } : null);
  const ahead = byPos(d.position - 1);
  const behind = byPos(d.position + 1);
  // Laps left only means something in a lap race. The session type decides, not a leftover
  // time limit (qualifying sets one, and it stays in the state when the session changes).
  const laps = (s.event.sessionType || 'race') === 'race' && s.race.totalLaps > 0;
  // Laps left to serve a drive-through before it escalates to a black flag. Only the type
  // autoFlags actually escalates, and only when the rule is on, so a driver sees the same
  // countdown the automation is running. Null when nothing is pending or the rule is off.
  let serveInLaps = null;
  const unserved = Math.max(0, (s.race.flags && s.race.flags.blackFlagUnserved) || 0);
  if (unserved) {
    for (const p of s.race.penalties || []) {
      if (p.driverId !== d.id || p.type !== 'drivethrough' || p.status !== 'applied' || p.served) continue;
      // Only a drive-through from this session (see inSession in public/js/timing.js).
      if (s.race.sessionEpoch && (Number(p.at) || 0) < s.race.sessionEpoch) continue;
      const left = Math.max(0, unserved - ((d.lapsDone || 0) - (p.lap || 0)));
      serveInLaps = serveInLaps == null ? left : Math.min(serveInLaps, left);
    }
  }
  // Endurance is timed, not lap counted: the phone shows the time left, worked out from
  // the green-flag stamp and any red-flag pauses, the same clock the overlay uses.
  let timeLeftMs = null;
  if ((s.event.sessionType || 'race') === 'endurance' && (s.race.timeLimitSec || 0) > 0 && s.race.startedAt) {
    const now = Date.now();
    const paused = (s.race.pausedTotal || 0) + (s.race.pausedAt ? now - s.race.pausedAt : 0);
    const elapsed = now - s.race.startedAt - paused;
    timeLeftMs = Math.max(0, s.race.timeLimitSec * 1000 - elapsed);
  }
  return {
    position: d.position, lapsDone: d.lapsDone, lastLap: d.lastLap, bestLap: d.bestLap,
    blueFlag: !!d.blueFlag, blackFlag: !!d.blackFlag,
    penaltyPending: !!d.penaltyPending, penaltyServed: d.penaltyServed || 0, pit: !!d.pit,
    cars: (s.drivers || []).length,
    gap: d.position > 1 && !d.dnf ? (d.gap || '') : '',
    // My interval is my gap to the car ahead; the car behind's interval is its gap to me.
    ahead: car(ahead, d.interval),
    behind: car(behind, behind && behind.interval),
    lapsLeft: laps ? Math.max(0, s.race.totalLaps - (d.lapsDone || 0)) : null,
    serveInLaps,
    timeLeftMs,
    // A note race control pushed to this driver's phone (empty when none).
    message: (s.messages && s.messages[d.id] && s.messages[d.id].text) || '',
    // Start-light gantry, so the phone can show its own light strip on the grid.
    lights: s.race.lights || 0,
    // Pit lane state is session wide, but it rides in the driver's own object so the phone
    // reads one payload. Defaults open on an older state that never set it.
    pitOpen: s.race.pitOpen !== false,
    totalLaps: s.race.totalLaps || 0,
    session: s.event.sessionType || 'race',
    // Licence points, when the league uses them (null otherwise): the phone shows the count
    // and warns before a ban, from the same view the console and the hosted mirror read.
    licence: (s.licence && s.licence[d.id]) || null,
    // The drift event as this driver sees it (null outside a drift session).
    drift: (s.driftView && s.driftView[d.id]) || null
  };
}

app.get('/api/driver/me', (req, res) => {
  const who = auth.whoIs(req.query.token);
  if (!who) return res.status(401).json({ ok: false, error: 'Signed out' });
  const s = race.state;
  const reg = s.registrations.find((r) => r.accountId === who.id) || null;
  const d = reg && reg.driverId ? race.driver(reg.driverId) : null;
  // latest team-radio message for this driver's team, while it is still fresh (2 min)
  const team = (d && d.team) || who.team || '';
  const rmsg = team ? teamRadio.get(teamKeyOf(team)) : null;
  const radio = (rmsg && Date.now() - rmsg.at < 120000) ? rmsg : null;
  // This driver's most recent penalty appeal and the steward's ruling, so the app can show
  // whether it is still open, upheld or overturned.
  const myAppeal = d ? (s.appeals || []).find((x) => x.driverId === d.id) || null : null;
  res.json({
    ok: true,
    driver: who,
    team,
    radio,
    appeal: myAppeal ? { status: myAppeal.status, reason: myAppeal.reason, ruling: myAppeal.ruling } : null,
    status: reg ? reg.status : 'pending',
    flag: s.race.status,
    event: { name: s.event.name, round: s.event.round, session: s.event.sessionName },
    // Race control's pre-show countdown, so the app can remind the driver before it ends.
    countdown: s.overlay.countdown && s.overlay.countdown.target > Date.now()
      ? { target: s.overlay.countdown.target, label: s.overlay.countdown.label || '' } : null,
    me: d ? pitBoard(s, d) : null,
    /*
     * This driver's own penalties, most recent first, with the wording race control sees.
     *
     * Only theirs. The full penalty list is race control's business and would tell every
     * driver on the grid what every other driver is being investigated for, which is not
     * something a phone in the paddock should be handing out.
     *
     * `text` is built here rather than on the phone so the app and the broadcast overlay
     * cannot drift into describing the same penalty differently: the driver reading it
     * and the steward who issued it have to be looking at the same sentence.
     */
    penalties: d ? (s.race.penalties || [])
      .filter((p) => p.driverId === d.id)
      .slice(0, 20)
      .map((p) => ({
        id: p.id, type: p.type, seconds: p.seconds, reason: p.reason,
        at: p.at, lap: p.lap, status: p.status, served: !!p.served,
        // Headline and reason only, matching the hosted event exactly. The composed
        // sentence is not sent because nothing reads it, and a second copy of it drifted
        // from the timing code's within a day of being written.
        headline: race.penaltyHeadline(p)
      })) : []
  });
});

/*
 * Team radio: a driver messages their own team. In an endurance race the incoming driver
 * types "box box box" and the driver on track gets it: nobody on another team does.
 * Kept in memory (latest message per team); the phone polls it through /api/driver/me.
 */
const teamRadio = new Map();   // teamKey -> { id, team, from, text, at }
const teamKeyOf = (name) => String(name || '').trim().toLowerCase();
function driverTeam(who) {
  const s = race.state;
  const reg = s.registrations.find((r) => r.accountId === who.id) || null;
  const d = reg && reg.driverId ? race.driver(reg.driverId) : null;
  return (d && d.team) || who.team || '';
}

/*
 * An incident report from a driver's phone: which car (by number) and what happened. The
 * reporter comes from the token, never from the body, so nobody can file one in another
 * driver's name. It goes to race control's queue; it never becomes a penalty by itself.
 */
app.post('/api/driver/report', (req, res) => {
  const body = req.body || {};
  const who = auth.whoIs(body.token);
  if (!who) return res.status(401).json({ ok: false, error: 'Signed out' });
  const text = String(body.text || '').trim();
  if (!text) return res.status(400).json({ ok: false, error: 'Say what happened' });
  const s = race.state;
  const reg = s.registrations.find((r) => r.accountId === who.id) || null;
  const d = reg && reg.driverId ? race.driver(reg.driverId) : null;
  race.apply({
    type: 'incident.add',
    fromNum: who.num, fromName: (d && d.name) || who.nick,
    againstNum: String(body.against || '').trim(),
    lap: d ? d.lapsDone : null,
    text
  });
  res.json({ ok: true });
});

app.post('/api/driver/appeal', (req, res) => {
  const body = req.body || {};
  const who = auth.whoIs(body.token);
  if (!who) return res.status(401).json({ ok: false, error: 'Signed out' });
  const reason = String(body.reason || '').trim();
  if (!reason) return res.status(400).json({ ok: false, error: 'Say why you are appealing' });
  const s = race.state;
  const reg = s.registrations.find((r) => r.accountId === who.id) || null;
  const d = reg && reg.driverId ? race.driver(reg.driverId) : null;
  if (!d) return res.status(400).json({ ok: false, error: 'No car for this driver' });
  race.apply({ type: 'appeal.add', driverId: d.id, penaltyId: body.penaltyId || null, reason });
  res.json({ ok: true });
});

app.post('/api/driver/radio', (req, res) => {
  const who = auth.whoIs((req.body || {}).token);
  if (!who) return res.status(401).json({ ok: false, error: 'Signed out' });
  const s = race.state;
  const reg = s.registrations.find((r) => r.accountId === who.id) || null;
  const d = reg && reg.driverId ? race.driver(reg.driverId) : null;
  const team = (d && d.team) || who.team || '';
  if (!team) return res.json({ ok: false, error: 'You are not on a team yet' });
  const text = String((req.body || {}).text || '').trim().slice(0, 120);
  if (!text) return res.json({ ok: false, error: 'Empty message' });
  const at = Date.now();
  const from = who.nick || '';
  const num = (d && d.num) || who.num || '';
  // Two audiences: teammates poll this Map for a private notification; the broadcast overlay
  // reads race.state.radio, which every message joins so the director can put it on air.
  teamRadio.set(teamKeyOf(team), { id: at, team, from, text, at });
  race.apply({ type: 'driver.radio', id: at, at, team, from, num, text });
  res.json({ ok: true });
});

// Simple REST hook so you can fire laps from a stream deck / autohotkey / phone
app.get('/api/lap/:driverId', (req, res) => {
  const ok = race.apply({ type: 'lap.record', driverId: req.params.driverId, source: 'http' });
  res.json({ ok });
});

/*
 * Piper TTS: a natural local commentary voice.
 *
 * The commentary overlay's built-in voice is the browser's own speechSynthesis, which in
 * OBS's embedded Chromium only has the robotic local SAPI voices. Piper is a fast neural
 * TTS that runs right here on the operator's machine (real-time factor ~0.1 on CPU, so a
 * sentence is ready before it needs to be spoken), and these two routes let the overlay
 * speak through it instead. It is optional and local-only: a hosted event has no server to
 * run Piper, so the overlay falls back to the browser voice whenever these routes are
 * absent or fail.
 *
 * Set it up with env: FRL_PIPER (the piper binary), FRL_VOICES (a folder of *.onnx voices,
 * each with its .onnx.json beside it), or drop both under tools/piper/.
 */
function resolvePiper() {
  const bin = process.env.FRL_PIPER
    || [path.join(ROOT, 'tools', 'piper', 'piper.exe'), path.join(ROOT, 'tools', 'piper', 'piper')]
      .find((p) => fs.existsSync(p)) || null;
  const voicesDir = process.env.FRL_VOICES || path.join(ROOT, 'tools', 'piper', 'voices');
  let voices = [];
  try {
    voices = fs.readdirSync(voicesDir)
      .filter((f) => f.endsWith('.onnx') && fs.existsSync(path.join(voicesDir, `${f}.json`)))
      .map((f) => f.replace(/\.onnx$/, ''));
  } catch { /* no voices folder yet */ }
  return { bin: bin && fs.existsSync(bin) ? bin : null, voicesDir, voices };
}

// Re-scanned per request so an operator can add a voice or install Piper without a restart;
// it is a couple of stat calls, not a hot path.
app.get('/api/tts/voices', (_req, res) => {
  const p = resolvePiper();
  res.json({ ok: !!p.bin, engine: p.bin ? 'piper' : null, voices: p.voices });
});

app.post('/api/tts', (req, res) => {
  const p = resolvePiper();
  if (!p.bin) return res.status(503).json({ ok: false, error: 'Piper is not set up on this machine' });
  const text = String((req.body && req.body.text) || '').trim().slice(0, 600);
  if (!text) return res.status(400).json({ ok: false, error: 'No text' });

  // The voice must be one we listed. The client never sends a path, so there is nothing to
  // traverse and no way to point Piper at an arbitrary file.
  const asked = String((req.body && req.body.voice) || '');
  const voice = p.voices.includes(asked) ? asked : p.voices[0];
  if (!voice) return res.status(503).json({ ok: false, error: 'No Piper voice installed' });
  const model = path.join(p.voicesDir, `${voice}.onnx`);

  const tmp = path.join(os.tmpdir(), `frltts-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.wav`);
  const child = spawn(p.bin, ['-m', model, '-f', tmp, '-q'], { windowsHide: true });
  let finished = false;
  const fail = (msg) => { if (!finished) { finished = true; if (!res.headersSent) res.status(500).json({ ok: false, error: msg }); } fs.rm(tmp, { force: true }, () => {}); };
  child.on('error', (e) => fail(e.message));
  child.on('close', (code) => {
    if (finished) return;
    if (code !== 0 || !fs.existsSync(tmp)) return fail('Synthesis failed');
    finished = true;
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(tmp, (err) => { fs.rm(tmp, { force: true }, () => {}); if (err && !res.headersSent) res.status(500).end(); });
  });
  child.stdin.on('error', () => {});   // a killed child closes stdin; not our problem to report
  child.stdin.write(text);
  child.stdin.end();
  // A wedged synth must not hold the request open forever.
  setTimeout(() => { if (!finished) { try { child.kill(); } catch { /* already gone */ } fail('Synthesis timed out'); } }, 15000);
});

/*
 * Voice catalog + on-demand install.
 *
 * There are ~130 Piper voices across 40-odd languages; bundling them all would be tens of
 * gigabytes, so instead the console lists the catalog and downloads only the voice the
 * operator picks, into the same tools/piper/voices folder /api/tts reads. The Piper binary
 * still has to be present (env or tools/piper); this only fetches voice models.
 */
const PIPER_REPO = 'https://huggingface.co/rhasspy/piper-voices/resolve/main';
let ttsCatalog = null;   // cached voices.json, fetched once

async function piperCatalog() {
  if (ttsCatalog) return ttsCatalog;
  const r = await fetch(`${PIPER_REPO}/voices.json`);
  if (!r.ok) throw new Error(`catalog ${r.status}`);
  const raw = await r.json();
  ttsCatalog = Object.values(raw).map((v) => {
    const onnx = Object.keys(v.files || {}).find((f) => f.endsWith('.onnx'));
    const json = Object.keys(v.files || {}).find((f) => f.endsWith('.onnx.json'));
    const lang = v.language || {};
    return {
      key: v.key,
      lang: [lang.name_english, lang.country_english].filter(Boolean).join(', '),
      code: lang.code || '',
      quality: v.quality || '',
      speakers: v.num_speakers || 1,
      onnx, json
    };
  }).filter((v) => v.onnx && v.json);
  return ttsCatalog;
}

app.get('/api/tts/catalog', async (_req, res) => {
  const p = resolvePiper();
  try {
    const cat = await piperCatalog();
    const have = new Set(p.voices);
    res.json({
      ok: true,
      binary: !!p.bin,
      voices: cat.map(({ onnx, json, ...v }) => ({ ...v, installed: have.has(v.key) }))
    });
  } catch (e) {
    res.status(502).json({ ok: false, error: `Could not reach the voice catalog: ${e.message}` });
  }
});

app.post('/api/tts/install', async (req, res) => {
  const key = String((req.body && req.body.key) || '');
  try {
    const cat = await piperCatalog();
    const voice = cat.find((v) => v.key === key);
    if (!voice) return res.status(404).json({ ok: false, error: 'No such voice' });

    const dir = process.env.FRL_VOICES || path.join(ROOT, 'tools', 'piper', 'voices');
    fs.mkdirSync(dir, { recursive: true });
    // Name the files by the catalog key (safe chars) rather than the client string, so there
    // is no path to traverse; the key came from our own catalog, not the request body.
    for (const [remote, local] of [[voice.onnx, `${voice.key}.onnx`], [voice.json, `${voice.key}.onnx.json`]]) {
      const resp = await fetch(`${PIPER_REPO}/${remote}`);
      if (!resp.ok) throw new Error(`${local} ${resp.status}`);
      const buf = Buffer.from(await resp.arrayBuffer());
      fs.writeFileSync(path.join(dir, local), buf);
    }
    res.json({ ok: true, key: voice.key });
  } catch (e) {
    res.status(502).json({ ok: false, error: `Install failed: ${e.message}` });
  }
});

/*
 * Official timing API control. The poller lives on the server (the API key must never
 * reach a browser); these routes let the console set the key, start against a Room Key,
 * and watch status. Local-only, like the rest of the authoritative timing.
 */
app.get('/api/timing/status', (_req, res) => res.json(timing.status()));

app.post('/api/timing/config', (req, res) => {
  timing.setConfig({ key: (req.body || {}).key, region: (req.body || {}).region });
  res.json(timing.status());
});

app.post('/api/timing/start', async (req, res) => {
  try {
    const st = await timing.start((req.body || {}).roomKey);
    res.json({ ok: true, ...st });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message, ...timing.status() });
  }
});

app.post('/api/timing/stop', (_req, res) => {
  timing.stop();
  res.json({ ok: true, ...timing.status() });
});

/*
 * Version and updates. Reading is open to the LAN (it is only a version number and public
 * release notes); installing is limited to this machine, because the server has no auth and
 * an update restarts it: another device on the network must not be able to do that mid-event.
 */
const fromThisMachine = (req) => /^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(req.socket.remoteAddress || '');

app.get('/api/version', async (req, res) => {
  await updates.check(req.query.refresh === '1');
  res.json(updates.status());
});

app.post('/api/update/channel', (req, res) => {
  updates.setChannel((req.body || {}).channel);
  res.json(updates.status());
});

app.post('/api/update/apply', async (req, res) => {
  if (!fromThisMachine(req)) {
    return res.status(403).json({ ok: false, error: 'Updates can only be installed on the machine running FRLcast.' });
  }
  const tag = String((req.body || {}).tag || '');
  const opts = { force: !!(req.body || {}).force };
  await updates.check();
  try { updates.precheck(tag, opts); } catch (e) { return res.status(400).json({ ok: false, error: e.message }); }
  // Answer now and let the console follow progress on /api/version: the download takes a
  // while, and the request would otherwise sit open until this process exits under it.
  updates.apply(tag, opts).then(() => {
    console.log(`\n  Updating to ${tag}. FRLcast restarts in its own window in a moment.\n`);
    setTimeout(() => process.exit(0), 1500);
  }, (e) => console.error('[update]', e.message));
  res.json({ ok: true });
});

/*
 * The online link (server/cloud-link.js): keep a hosted event in step with this server so
 * drivers anywhere reach race control through the driver app and an event code. Status is
 * open to the LAN like the rest; signing in and linking only from this machine, because
 * they carry the operator's account.
 */
/*
 * A drift judge's call from their phone (public/judge.html on the LAN address). The key in
 * the link is the only check, the same trust level as the rest of this server: it stops a
 * spectator on the wifi from voting, not a determined attacker on the network.
 */
const judgeHits = new Map();   // judge -> [timestamps], a small brake on a stuck button
app.post('/api/judge', (req, res) => {
  const b = req.body || {};
  const D = race.state.drift || {};
  if (!D.judgeKey || String(b.k || '').toUpperCase() !== D.judgeKey) {
    return res.status(403).json({ ok: false, error: 'This judge link is no longer valid. Ask race control for a new one.' });
  }
  const judges = (D.format && D.format.judges) || 1;
  const j = Math.round(Number(b.j));
  if (!(j >= 1 && j <= judges)) {
    return res.status(400).json({ ok: false, error: `Race control is using ${judges} judges; this link is for judge ${b.j}.` });
  }
  if (!['vote', 'score', 'ping'].includes(b.kind)) return res.status(400).json({ ok: false, error: 'Unknown call' });
  if (b.kind === 'vote' && !['a', 'b', 'omt'].includes(b.vote)) return res.status(400).json({ ok: false, error: 'Unknown vote' });
  const now = Date.now();
  const hits = (judgeHits.get(j) || []).filter((t) => now - t < 10000);
  if (hits.length > 30) return res.status(429).json({ ok: false, error: 'Too many calls. Wait a moment.' });
  hits.push(now);
  judgeHits.set(j, hits);
  applyAction({
    type: 'drift.judge', judge: j - 1, kind: b.kind, vote: b.vote,
    line: b.line, angle: b.angle, style: b.style, total: b.total
  });
  res.json({ ok: true });
});

app.get('/api/cloud/status', (_req, res) => res.json(cloud.status()));

app.post('/api/cloud/login', async (req, res) => {
  if (!fromThisMachine(req)) return res.status(403).json({ ok: false, error: 'Sign in on the machine running FRLcast.' });
  try {
    await cloud.login((req.body || {}).email, (req.body || {}).password);
    res.json({ ok: true, ...cloud.status() });
  } catch (e) {
    res.status(400).json({ ...cloud.status(), ok: false, error: e.message });
  }
});

app.post('/api/cloud/logout', (req, res) => {
  if (!fromThisMachine(req)) return res.status(403).json({ ok: false, error: 'Only on the machine running FRLcast.' });
  cloud.logout();
  res.json({ ok: true, ...cloud.status() });
});

app.get('/api/cloud/events', async (req, res) => {
  if (!fromThisMachine(req)) return res.status(403).json({ ok: false, error: 'Only on the machine running FRLcast.' });
  try { res.json({ ok: true, events: await cloud.events() }); } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

app.post('/api/cloud/link', async (req, res) => {
  if (!fromThisMachine(req)) return res.status(403).json({ ok: false, error: 'Only on the machine running FRLcast.' });
  try {
    res.json({ ok: true, ...(await cloud.link((req.body || {}).code)) });
  } catch (e) {
    res.status(400).json({ ...cloud.status(), ok: false, error: e.message });
  }
});

app.post('/api/cloud/create', async (req, res) => {
  if (!fromThisMachine(req)) return res.status(403).json({ ok: false, error: 'Only on the machine running FRLcast.' });
  try {
    res.json({ ok: true, ...(await cloud.create((req.body || {}).code, (req.body || {}).name)) });
  } catch (e) {
    res.status(400).json({ ...cloud.status(), ok: false, error: e.message });
  }
});

app.post('/api/cloud/unlink', (req, res) => {
  if (!fromThisMachine(req)) return res.status(403).json({ ok: false, error: 'Only on the machine running FRLcast.' });
  cloud.unlink();
  res.json({ ok: true, ...cloud.status() });
});

const server = http.createServer(app);

/*
 * HTTPS runs alongside HTTP rather than replacing it, and both are served by the same
 * app. The capture node needs a secure origin or navigator.mediaDevices does not exist;
 * OBS's embedded browser, meanwhile, refuses a self-signed certificate with no way for
 * anyone to click through, so the overlays must stay reachable over plain HTTP. One
 * server cannot satisfy both, so we run two.
 */
const tls = ensureCert(path.join(ROOT, 'certs'), lanAddresses().map((a) => a.address));
const secure = tls ? https.createServer({ key: tls.key, cert: tls.cert }, app) : null;

// One connection set across both servers: the panel's client list and every broadcast
// read from wss.clients, and a node attached over HTTPS has to appear there too.
const wss = new WebSocketServer({ noServer: true });

function routeUpgrade(req, socket, head) {
  if (new URL(req.url, 'http://x').pathname !== '/ws') { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
}
server.on('upgrade', routeUpgrade);
if (secure) secure.on('upgrade', routeUpgrade);

/** Who is attached right now: the panel shows this so you can see the laptop arrive. */
function clientList() {
  return [...wss.clients]
    .filter((c) => c.readyState === 1)
    .map((c) => ({ id: c.cid, role: c.role, ip: c.ip, since: c.since, page: c.page, embedded: c.embedded }));
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcast(msg, except) {
  const raw = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === 1 && client !== except) client.send(raw);
  }
}

race.subscribe((state) => broadcast({ type: 'state', state }));

let connSeq = 0;

wss.on('connection', (ws, req) => {
  const q = new URL(req.url, 'http://x').searchParams;
  ws.role = q.get('role') || 'client';
  ws.page = q.get('page') || '';
  ws.embedded = ws.page.includes('[embedded]');
  ws.ip = cleanIp(req.socket.remoteAddress);
  ws.cid = `c${++connSeq}`;
  ws.since = Date.now();
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  send(ws, { type: 'state', state: race.state });
  broadcastClients();
  ws.on('close', () => broadcastClients());

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'action') {
      applyAction(msg.action);
      return;
    }
    // low-latency passthrough: live preview frames, detection boxes, tally
    if (msg.type === 'signal') {
      broadcast({ type: 'signal', channel: msg.channel, data: msg.data }, ws);
      return;
    }
    if (msg.type === 'ping') send(ws, { type: 'pong', t: Date.now() });
  });
});

function broadcastClients() {
  // sent as a signal rather than race state: it is diagnostics, not something to persist
  setTimeout(() => broadcast({ type: 'signal', channel: 'clients', data: clientList() }), 20);
}

/**
 * A predicted running order is a function of the clock, so it needs a clock to move.
 * Recompute is otherwise only triggered by an action, which between two crossings can
 * be nothing at all, and a leaderboard that only reorders once a lap is the very
 * problem prediction exists to solve. One tick a second is enough for an order change
 * to look live, and clients that see no visible difference skip the render anyway.
 */
/*
 * The session heartbeat.
 *
 * It used to run only under a green flag, because its one job was to advance the
 * predicted running order. Automatic flags gave it a second one: a yellow lifts when the
 * track has been clear for a few seconds, and "a few seconds have passed" is not an event
 * anybody sends: without a tick while the flag is out, the race would stay yellow until
 * the next lap crossing happened to wake the state up.
 */
setInterval(() => {
  const r = race.state.race;
  if (!r.startedAt) return;
  const racing = ['green', 'yellow', 'red', 'formation'].includes(r.status);
  if (!racing) return;
  if (r.status === 'green' && r.predictOrder === false && r.flagSource === 'operator') return;
  race.emit();
}, 1000);

/**
 * Heartbeat.
 *
 * Pinging alone is not enough: a browser tab that goes away without a clean close:
 * a machine sleeping, WiFi dropping, a crash: leaves a socket the server happily
 * keeps broadcasting to forever. Over an event with a few reconnects that pile of
 * ghosts is what makes the connected-clients list lie. So require a pong, and drop
 * whoever does not answer within one interval.
 */
setInterval(() => {
  let dropped = 0;
  for (const client of wss.clients) {
    if (client.isAlive === false) {
      client.terminate();
      dropped++;
      continue;
    }
    client.isAlive = false;
    if (client.readyState === 1) client.ping();
  }
  if (dropped) broadcastClients();
}, 20000);

// Tell the state where a phone can find us, so the panel can show a driver the address
// to type rather than the one the operator's own browser happens to be using.
{
  const best = lanAddresses().find((a) => a.likely) || lanAddresses()[0];
  if (best) {
    race.apply({
      type: 'net.set',
      lan: `http://${best.address}:${PORT}`,
      tls: secure ? `https://${best.address}:${TLS_PORT}` : ''
    });
  }
}

server.listen(PORT, () => {
  // Look for a newer version shortly after start, then a few times a day.
  setTimeout(() => updates.check(), 5000);
  // Reconnect the online event the operator had linked last time.
  cloud.resume();
  setInterval(() => updates.check(), 6 * 60 * 60 * 1000).unref();
  console.log('');
  console.log(`  FRLcast v${updates.version}`);
  console.log('  ---------------------------------------------');
  console.log(`  Operator panel : http://localhost:${PORT}/`);

  const addresses = lanAddresses();
  if (addresses.length) {
    console.log('');
    console.log('  From another device on your network:');
    for (const a of addresses) {
      const note = a.likely ? '  <-- try this one first' : '';
      console.log(`    http://${a.address}:${PORT}/`.padEnd(34) + `${a.name}${note}`);
    }
    const best = addresses.find((a) => a.likely);
    if (best) {
      console.log('');
      console.log(`  The other device must be on the same ${best.subnet} network.`);
      console.log('  Different IPs are normal and fine: WiFi and Ethernet on one router share a subnet.');
      if (process.platform === 'win32') {
        console.log('  If it cannot connect, allow the port through Windows Firewall (run as admin):');
        console.log(`    netsh advfirewall firewall add rule name="FRL Broadcast" dir=in action=allow protocol=TCP localport=${PORT}`);
      }
    }
  }
  console.log('');
  console.log('  Capture node (open on the machine showing the game):');
  console.log(`    http://localhost:${PORT}/node.html`);
  if (secure) {
    const best = addresses.find((a) => a.likely) || addresses[0];
    console.log('');
    console.log('  From ANOTHER machine the node must be opened over HTTPS -');
    console.log('  browsers hide screen capture entirely on a plain-http address:');
    console.log(`    https://${best ? best.address : 'localhost'}:${TLS_PORT}/node.html`);
    console.log('  The certificate is self-signed, so accept the warning once');
    console.log('  (Advanced -> Proceed). Overlays and panel stay on http.');
  } else {
    console.log('');
    console.log('  NOTE: openssl was not found, so HTTPS is off. The capture node will');
    console.log('  only work on this machine: browsers require a secure origin.');
  }
  console.log('');
  console.log('  OBS browser sources (1920x1080, transparent):');
  for (const o of ['leaderboard', 'tower', 'status', 'lowerthird', 'results', 'gap', 'battle', 'bracket', 'grid', 'h2h', 'standings', 'all']) {
    console.log(`    ${o.padEnd(11)} http://localhost:${PORT}/overlay/${o}.html`);
  }
  console.log('');

  if (secure) {
    secure.listen(TLS_PORT, () => {
      console.log(`  HTTPS ready on ${TLS_PORT} (capture node for other machines)`);
      console.log('');
    });
  }
});
