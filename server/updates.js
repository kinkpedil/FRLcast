import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const REPO = 'kinkpedil/FRLcast';
const ASSET = 'FRLcast-desktop.zip';
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const MIN_FORCED_GAP_MS = 60 * 1000;

/** "1.2.3-beta.4" -> comparable parts; a release sorts above its own betas. */
function parse(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-[a-z]+\.?(\d+))?/i.exec(String(v || ''));
  if (!m) return null;
  return { n: [+m[1], +m[2], +m[3]], pre: m[4] == null ? null : +m[4] };
}

export function compareVersions(a, b) {
  const x = parse(a), y = parse(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x.n[i] !== y.n[i]) return x.n[i] - y.n[i];
  if (x.pre === y.pre) return 0;
  if (x.pre == null) return 1;
  if (y.pre == null) return -1;
  return x.pre - y.pre;
}

/**
 * Knowing about, and installing, new desktop versions.
 *
 * Operators download a zip once and then have no reason to look at GitHub again, so a fix
 * shipped after that simply never reached them. This asks GitHub's release list a few times
 * a day (one small, unauthenticated request, well under the rate limit), and the console
 * shows a banner when something newer is out.
 *
 * Installing is one click, but deliberately narrow:
 *   - only in the packaged download (bundled runtime, no .git). A developer checkout would
 *     have its tracked files overwritten by a zip, so it only gets the banner and a link;
 *   - never while a race is running, because installing restarts the server;
 *   - only the zip attached to this repository's own release, checked against the SHA-256
 *     published next to it before anything is unpacked;
 *   - only from the machine the server runs on (see the route): the server has no auth, and
 *     anyone else on the LAN restarting it mid-event is exactly what this must not allow.
 * The swap itself is scripts/update.ps1, which runs after this process has exited (Windows
 * will not let a running node.exe be replaced), keeps data/, certs/, voices and the logo,
 * backs up data/ first, and starts FRLcast again.
 */
export class Updates {
  constructor(root, { isRacing = () => false } = {}) {
    this.root = root;
    this.isRacing = isRacing;
    this.version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
    this.packaged = fs.existsSync(path.join(root, 'runtime', 'node.exe')) && !fs.existsSync(path.join(root, '.git'));
    this.cfgFile = path.join(root, 'data', 'update.json');
    this.cfg = { channel: 'stable' };
    try { Object.assign(this.cfg, JSON.parse(fs.readFileSync(this.cfgFile, 'utf8'))); } catch { /* first run */ }
    this.releases = [];
    this.checkedAt = 0;
    this.error = '';
    this.checking = null;
    this.job = { state: 'idle' };
  }

  setChannel(channel) {
    this.cfg.channel = channel === 'beta' ? 'beta' : 'stable';
    try {
      fs.mkdirSync(path.dirname(this.cfgFile), { recursive: true });
      fs.writeFileSync(this.cfgFile, JSON.stringify(this.cfg, null, 2));
    } catch (e) { console.error('[update] could not save the channel:', e.message); }
  }

  /** Refresh from GitHub when stale (or when forced, at most once a minute). Never throws. */
  async check(force = false) {
    const age = Date.now() - this.checkedAt;
    if (this.checking) return this.checking;
    if (force ? age < MIN_FORCED_GAP_MS : age < CHECK_EVERY_MS) return;
    this.checking = (async () => {
      try {
        const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=20`, {
          headers: { accept: 'application/vnd.github+json', 'user-agent': `FRLcast/${this.version}` },
          signal: AbortSignal.timeout(15000)
        });
        if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
        const list = await res.json();
        this.releases = list.filter((r) => !r.draft && parse(r.tag_name)).map((r) => {
          const zip = (r.assets || []).find((x) => x.name === ASSET);
          const sum = (r.assets || []).find((x) => x.name === `${ASSET}.sha256`);
          return {
            tag: r.tag_name,
            version: r.tag_name.replace(/^v/, ''),
            prerelease: !!r.prerelease,
            notes: r.body || '',
            url: r.html_url,
            publishedAt: r.published_at,
            zip: zip ? { url: zip.browser_download_url, size: zip.size, digest: zip.digest || '' } : null,
            sumUrl: sum ? sum.browser_download_url : ''
          };
        });
        this.error = '';
      } catch (e) {
        // Offline at a venue is normal. Keep whatever was known and say so quietly.
        this.error = e.message;
      } finally {
        this.checkedAt = Date.now();
        this.checking = null;
      }
    })();
    return this.checking;
  }

  /** The newest release this console should be offered, or null when it is up to date. */
  latest() {
    const pool = this.releases.filter((r) => this.cfg.channel === 'beta' || !r.prerelease);
    let best = null;
    for (const r of pool) if (!best || compareVersions(r.version, best.version) > 0) best = r;
    return best && compareVersions(best.version, this.version) > 0 ? best : null;
  }

  status() {
    const l = this.latest();
    return {
      version: this.version,
      packaged: this.packaged,
      channel: this.cfg.channel,
      checkedAt: this.checkedAt || null,
      error: this.error,
      racing: this.isRacing(),
      latest: l && { tag: l.tag, version: l.version, prerelease: l.prerelease, notes: l.notes,
        url: l.url, publishedAt: l.publishedAt, size: l.zip ? l.zip.size : 0, installable: !!l.zip },
      job: this.job
    };
  }

  /**
   * Download, verify and hand over to the updater. Resolves once the updater is running;
   * the caller then exits this process so the files can be replaced.
   */
  /** Everything that can be refused before a byte is downloaded. Returns the release. */
  precheck(tag, { force = false } = {}) {
    if (!this.packaged) throw new Error('This copy runs from source, not the desktop download. Update it with git, or download the new zip.');
    if (['downloading', 'verifying', 'restarting'].includes(this.job.state)) throw new Error('An update is already in progress.');
    if (this.isRacing() && !force) throw new Error('A race is running. Finish it first: updating restarts the server.');
    const rel = this.releases.find((r) => r.tag === tag);
    if (!rel || !rel.zip) throw new Error(`No downloadable ${ASSET} found for ${tag}.`);
    return rel;
  }

  async apply(tag, opts = {}) {
    const rel = this.precheck(tag, opts);

    const dir = path.join(this.root, 'data', 'updates');
    fs.mkdirSync(dir, { recursive: true });
    const zipPath = path.join(dir, `FRLcast-${rel.tag}.zip`);
    this.job = { state: 'downloading', tag, received: 0, total: rel.zip.size || 0 };
    try {
      if (process.env.FRL_UPDATE_ZIP) {
        // Test hook: install a local zip instead of downloading one.
        fs.copyFileSync(process.env.FRL_UPDATE_ZIP, zipPath);
      } else {
        const want = await this.expectedSha(rel);
        await this.download(rel.zip.url, zipPath);
        this.job.state = 'verifying';
        const got = crypto.createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex');
        if (got !== want) {
          fs.rmSync(zipPath, { force: true });
          throw new Error('The download does not match its published checksum, so it was not installed. Try again.');
        }
      }
    } catch (e) {
      this.job = { state: 'error', tag, error: e.message };
      throw e;
    }

    /*
     * Launched through `start` so it gets its own, visible console window that outlives this
     * process. Node's `detached` is not the same thing on Windows: it uses DETACHED_PROCESS,
     * which runs PowerShell with no console at all, so the operator would see nothing and any
     * error prompt would have nowhere to appear. The command line is built by hand because
     * cmd's quoting is not the C runtime's that Node would otherwise apply (/s /c "..." is
     * the same form Node uses for shell: true).
     */
    const q = (s) => `"${String(s).replace(/"/g, '')}"`;
    const ps = [
      'powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', q(path.join(this.root, 'scripts', 'update.ps1')),
      '-Zip', q(zipPath), '-Root', q(this.root), '-WaitPid', process.pid, '-ParentPid', process.ppid,
      '-From', q(this.version), '-To', q(rel.version)
    ].join(' ');
    await new Promise((resolve, reject) => {
      const child = spawn('cmd.exe', ['/d', '/s', '/c', `"start "FRLcast update" ${ps}"`],
        { windowsVerbatimArguments: true, stdio: 'ignore', windowsHide: true });
      child.on('error', reject);
      child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Could not start the updater (cmd exit ${code})`))));
    }).catch((e) => { this.job = { state: 'error', tag, error: e.message }; throw e; });
    this.job = { state: 'restarting', tag };
  }

  async expectedSha(rel) {
    if (rel.sumUrl) {
      const res = await fetch(rel.sumUrl, { signal: AbortSignal.timeout(15000) });
      if (res.ok) {
        const m = /\b([a-f0-9]{64})\b/i.exec(await res.text());
        if (m) return m[1].toLowerCase();
      }
    }
    const d = /^sha256:([a-f0-9]{64})$/i.exec(rel.zip.digest || '');
    if (d) return d[1].toLowerCase();
    throw new Error('This release has no published checksum, so it cannot be installed automatically. Download it from the release page instead.');
  }

  async download(url, file) {
    const res = await fetch(url, { signal: AbortSignal.timeout(15 * 60 * 1000) });
    if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`);
    const total = Number(res.headers.get('content-length')) || this.job.total;
    this.job.total = total;
    const part = `${file}.part`;
    const out = fs.createWriteStream(part);
    try {
      for await (const chunk of res.body) {
        if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
        this.job.received += chunk.length;
      }
      await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())));
    } catch (e) {
      out.destroy();
      fs.rmSync(part, { force: true });
      throw e;
    }
    fs.renameSync(part, file);
  }
}
