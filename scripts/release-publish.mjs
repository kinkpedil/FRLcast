#!/usr/bin/env node
/*
 * Publish one already-built, already-tagged desktop release to GitHub, then announce it.
 *
 *   node scripts/release-publish.mjs --tag v0.3.0 --zip dist/FRLcast-desktop.zip
 *
 * Used by the GitHub Actions release workflow (the normal path) and by
 * publish-desktop.ps1 -Local (the fallback when Actions is down). One code path, so a
 * release made by hand looks exactly like one made by CI.
 *
 * The notes are the annotated tag's message: publish-desktop.ps1 writes them into the tag
 * when it cuts the release, so the tag carries its own changelog and CI needs no other input.
 * This adds the zip's SHA-256 (also uploaded as <zip>.sha256, which the console's updater
 * checks before it installs anything).
 *
 * A tag with a suffix (v0.4.0-beta.1) becomes a pre-release: it never takes the "Latest"
 * badge, so the site's /releases/latest links and the default update channel skip it.
 *
 * Env: GH (path to the gh CLI, default "gh"), GH_TOKEN in CI, and optionally
 * DISCORD_WEBHOOK_URL: when set, a short announcement is posted there. Nothing is posted
 * without it.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const REPO = 'kinkpedil/FRLcast';
const GH = process.env.GH || 'gh';

const args = {};
const a = process.argv.slice(2);
for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) args[a[i].slice(2)] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true;
if (!args.tag || !args.zip) { console.error('usage: release-publish.mjs --tag vX.Y.Z --zip path/to.zip'); process.exit(2); }
const tag = args.tag;
const zip = path.resolve(args.zip);
const pre = tag.includes('-');

const run = (cmd, argv, opts = {}) => execFileSync(cmd, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opts }).trim();

// ---------------------------------------------------------------- notes + checksum
let notes = run('git', ['tag', '-l', '--format=%(contents)', tag]);
if (!notes) throw new Error(`Tag ${tag} has no message. Is it an annotated tag, and was it fetched?`);
// A signed tag would carry its signature in %(contents); the notes stop before it.
notes = notes.replace(/-----BEGIN PGP SIGNATURE-----[\s\S]*$/, '').trim();

const sha = crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
const shaFile = `${zip}.sha256`;
fs.writeFileSync(shaFile, `${sha}  ${path.basename(zip)}\n`);
notes += `\n\n**SHA-256** (${path.basename(zip)}): \`${sha}\`\n`;
const notesFile = path.join(path.dirname(zip), `notes-${tag}.md`);
fs.writeFileSync(notesFile, notes, 'utf8');

// ---------------------------------------------------------------- GitHub release
const title = `FRLcast ${tag}`;
let exists = false;
try { run(GH, ['release', 'view', tag, '--repo', REPO, '--json', 'tagName']); exists = true; } catch { /* not yet */ }

if (exists) {
  // A re-run (workflow_dispatch after a failed build): refresh the files and the notes.
  console.log(`==> ${tag} exists, replacing its files and notes`);
  run(GH, ['release', 'upload', tag, zip, shaFile, '--repo', REPO, '--clobber'], { stdio: 'inherit' });
  run(GH, ['release', 'edit', tag, '--repo', REPO, '--title', title, '--notes-file', notesFile,
    ...(pre ? ['--prerelease'] : ['--latest'])], { stdio: 'inherit' });
} else {
  console.log(`==> creating ${pre ? 'pre-release' : 'release'} ${tag}`);
  run(GH, ['release', 'create', tag, zip, shaFile, '--repo', REPO, '--title', title,
    '--notes-file', notesFile, '--verify-tag', ...(pre ? ['--prerelease'] : ['--latest'])], { stdio: 'inherit' });
}
const url = `https://github.com/${REPO}/releases/tag/${tag}`;
console.log(`Published ${title}: ${url}`);

// ---------------------------------------------------------------- announcement
const hook = process.env.DISCORD_WEBHOOK_URL;
if (hook) {
  // The body of one "## name" section, up to the next "## " heading.
  const section = (name) => {
    const out = [];
    let inside = false;
    for (const line of notes.split(/\r?\n/)) {
      if (line.startsWith('## ')) { inside = line.slice(3).trim() === name; continue; }
      if (inside) out.push(line);
    }
    return out.join('\n').trim();
  };
  const en = section('Highlights');
  const id = section('Sorotan');
  let desc = [en, id && `**Bahasa Indonesia**\n${id}`].filter(Boolean).join('\n\n')
    || 'A new FRLcast desktop version is out. · Versi baru FRLcast desktop sudah rilis.';
  if (desc.length > 3800) desc = desc.slice(0, 3790) + '…';
  const body = {
    username: 'FRLcast',
    embeds: [{
      title: `${title}${pre ? ' (beta)' : ''}`,
      url,
      description: `${desc}\n\n[Download](${url}) · [Changelog](https://frlcast.my.id/changelog)`,
      color: pre ? 0xffd60a : 0x00e0a4,
      footer: { text: 'FRLcast by kinkpedil12' },
      timestamp: new Date().toISOString(),
    }],
  };
  const res = await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  // A failed announcement never fails the release: the release is already out.
  console.log(res.ok ? '==> announced on Discord' : `==> Discord announcement failed: HTTP ${res.status}`);
}
