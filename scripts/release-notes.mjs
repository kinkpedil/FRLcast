#!/usr/bin/env node
/*
 * Build the notes for one release, the same text everywhere it is read: the GitHub release
 * page, the update banner inside the desktop console, the /changelog page on the site, and
 * the Discord announcement.
 *
 *   node scripts/release-notes.mjs --tag v0.3.0 [--prev v0.2.0] [--out notes.md]
 *
 * Two sources:
 *   - release/next.md: the hand-written highlights, one section per language. This is the
 *     part a league organiser actually reads, so it is written by a person, not derived.
 *   - the commit subjects since the previous tag, grouped into features / fixes / other.
 *     A conventional prefix (feat:, fix:, docs: ...) decides the group when there is one;
 *     older subjects without one are sorted by their first word.
 *
 * The section headings are fixed ("## Highlights", "## Sorotan", "## Changes · Perubahan",
 * ...) because the console and the changelog page split the notes on them to show the
 * reader's language. Change them here and there together, or not at all.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'kinkpedil/FRLcast';
export const DRAFT = path.join(ROOT, 'release', 'next.md');

export const DRAFT_TEMPLATE = `<!--
  Highlights for the NEXT release, in both languages: a few short lines a league organiser
  cares about, not a commit list (the script adds that). publish-desktop.ps1 puts them at the
  top of the release notes, the in-app update banner and the /changelog page, then empties
  this file in the release commit. Leave both sections empty for a small fix.
-->
## en

## id
`;

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

/** The hand-written highlights, { en, id }, each '' when that section is empty. */
export function readDraft(file = DRAFT) {
  const out = { en: '', id: '' };
  if (!fs.existsSync(file)) return out;
  const text = fs.readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  let cur = null;
  const buf = { en: [], id: [] };
  for (const line of text.split(/\r?\n/)) {
    const h = /^##\s+(en|id)\s*$/i.exec(line);
    if (h) { cur = h[1].toLowerCase(); continue; }
    if (cur) buf[cur].push(line);
  }
  for (const k of ['en', 'id']) out[k] = buf[k].join('\n').trim();
  return out;
}

// Conventional types only: "Timing API: ..." or "README: ..." name an area, not a type.
const TYPED = /^(feat|feature|fix|bugfix|hotfix|docs|chore|refactor|build|ci|style|test|perf|revert)(\([^)]*\))?!?:\s*/i;
const GROUP_OF_TYPE = { feat: 'features', feature: 'features', fix: 'fixes', bugfix: 'fixes', hotfix: 'fixes' };

/** features | fixes | other, and the subject as it should read in the notes. */
export function classify(subject) {
  const m = TYPED.exec(subject);
  if (m) return { group: GROUP_OF_TYPE[m[1].toLowerCase()] || 'other', text: cap(subject.slice(m[0].length)) };
  // Older commits carry no type, so read the first word the way a person would. An area
  // prefix ("Timing API: carry ...") stays in the text but is skipped for the guess.
  const body = subject.replace(/^[^:]{1,40}:\s*/, '');
  const first = (re) => re.test(body) || re.test(subject);
  if (first(/^(fix|fixes|fixed|repair|correct|stop|prevent)\b/i) || /\bfix(es|ed)?\b/i.test(subject)) {
    return { group: 'fixes', text: cap(subject) };
  }
  if (first(/^(add|adds|added|new|introduce|support|show|let|carry|derive)\b/i)) {
    return { group: 'features', text: cap(subject) };
  }
  return { group: 'other', text: cap(subject) };
}

function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

/** Commit subjects since `prev` (all history when there is none), release noise removed. */
export function changes(prev) {
  const range = prev ? `${prev}..HEAD` : 'HEAD';
  const raw = git(['log', range, '--no-merges', '--pretty=format:%s']);
  const groups = { features: [], fixes: [], other: [] };
  for (const s of raw.split('\n')) {
    if (!s || /^(Deploy:|Release v)/.test(s)) continue;
    const { group, text } = classify(s.replace(/\s*\u2014\s*/g, ': '));  // old subjects may carry an em-dash
    groups[group].push(text);
  }
  return groups;
}

export function buildNotes({ tag, prev, draft = readDraft(), groups = changes(prev), zipName = 'FRLcast-desktop.zip' }) {
  const L = [];
  if (draft.en) L.push('## Highlights', '', draft.en, '');
  if (draft.id) L.push('## Sorotan', '', draft.id, '');

  L.push('## Changes · Perubahan', '');
  const titles = { features: 'New features · Fitur baru', fixes: 'Fixes · Perbaikan', other: 'Other · Lainnya' };
  let any = false;
  for (const g of ['features', 'fixes', 'other']) {
    if (!groups[g].length) continue;
    any = true;
    L.push(`### ${titles[g]}`, '', ...groups[g].map((s) => `- ${s}`), '');
  }
  if (!any) L.push('- Maintenance build.', '');

  L.push(
    '## Download',
    '',
    `**${zipName}** below: unzip anywhere and double-click \`start.cmd\`. Nothing to install.`,
    `Unduh **${zipName}** di bawah, ekstrak di mana saja, lalu klik dua kali \`start.cmd\`. Tidak perlu instal apa pun.`,
    '',
    '## Updating · Cara update',
    '',
    'From v0.3.0 on, the console shows a banner when a new version is out and updates itself with one click. Your event data, API key, voices and logo are kept, and a backup of `data` is made first.',
    'Mulai v0.3.0, console menampilkan banner saat ada versi baru dan bisa update sendiri dengan satu klik. Data event, API key, voice, dan logo tetap aman, dan folder `data` di-backup dulu.',
    '',
    '> Do not update in the middle of a race: updating restarts the server. · Jangan update saat race berjalan: update akan me-restart server.',
    ''
  );
  if (prev) L.push(`**Full changelog:** https://github.com/${REPO}/compare/${prev}...${tag}`, '');
  return L.join('\n');
}

// ---------------------------------------------------------------- CLI
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = {};
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) args[a[i].slice(2)] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true;
  if (!args.tag) { console.error('usage: release-notes.mjs --tag vX.Y.Z [--prev vA.B.C] [--zip name] [--out file] [--reset-draft]'); process.exit(2); }
  const notes = buildNotes({ tag: args.tag, prev: args.prev || '', zipName: args.zip || 'FRLcast-desktop.zip' });
  if (args.out) fs.writeFileSync(args.out, notes, 'utf8'); else process.stdout.write(notes);
  if (args['reset-draft']) {
    fs.mkdirSync(path.dirname(DRAFT), { recursive: true });
    fs.writeFileSync(DRAFT, DRAFT_TEMPLATE, 'utf8');
  }
}
