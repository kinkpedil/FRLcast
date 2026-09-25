/*
 * The console's version line, update banner and "Version and updates" card (Help page).
 *
 * Local console: asks the server (/api/version), which checks GitHub a few times a day. When
 * a newer release is out it shows a banner with what changed, in the operator's language,
 * and, in the packaged desktop app, an Update now button that downloads, verifies and
 * installs it (server/updates.js, scripts/update.ps1). The button is disabled while a race
 * runs, because installing restarts the server.
 *
 * Hosted console: the website is always the newest version, so there is nothing to update;
 * it only shows which version it is (app-version.txt, stamped by site/prepare.sh).
 */
import { cloudOptions } from './cloudbus.js';
import { readNotes, mdToHtml } from './release-notes.js';

const t = (en) => (window.FRL_I18N ? window.FRL_I18N.t(en) : en);
const lang = () => (window.FRL_I18N && window.FRL_I18N.lang) || 'en';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mb = (n) => (n / 1048576).toFixed(0);
const CHANGELOG = 'https://frlcast.my.id/changelog';
const DISMISS = 'frl.update.dismissed';

const hosted = !!cloudOptions();
let st = null;           // last /api/version answer
let open = false;        // "What's new" expanded
let waitingFor = '';     // version we are restarting into
let busyTimer = 0;

function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; } }

async function load(refresh = false) {
  if (hosted) {
    let v = '';
    try { v = (await (await fetch('/app-version.txt', { cache: 'no-store' })).text()).trim(); } catch { /* older deploy */ }
    st = { version: /^\d+\.\d+\.\d+/.test(v) ? v : '', hosted: true };
    render();
    return;
  }
  try {
    const res = await fetch(`/api/version${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    st = await res.json();
  } catch {
    st = st || null;
  }
  render();
}

function renderVersion() {
  const v = st && st.version ? `v${st.version}` : '';
  const side = $('appVersion');
  if (side) {
    side.innerHTML = `<a href="#" id="appVersionLink">FRLcast ${esc(v)}${st && st.hosted ? ' <span class="webtag">web</span>' : ''}</a>`
      + (st && st.latest ? ` <span class="newdot" title="${esc(t('Update available'))}"></span>` : '');
    $('appVersionLink').onclick = (e) => {
      e.preventDefault();
      const btn = document.querySelector('.navbtn[data-page="help"]');
      if (btn) btn.click();
      setTimeout(() => { const c = $('aboutCard'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50);
    };
  }
  const about = $('aboutVer');
  if (about) about.textContent = `FRLcast ${v}`.trim();
}

function renderAbout() {
  const state = $('aboutState');
  if (!state) return;
  const beta = $('betaToggle');
  const check = $('btnCheckUpdate');
  const betaWrap = $('betaWrap');
  if (st && st.hosted) {
    state.textContent = t('The website always runs the newest version. The desktop app tells you itself when it has an update.');
    if (check) check.hidden = true;
    if (betaWrap) betaWrap.hidden = true;
    return;
  }
  if (!st) { state.textContent = t('Could not reach the FRLcast server.'); return; }
  if (beta) beta.checked = st.channel === 'beta';
  if (st.latest) {
    state.textContent = `${t('A newer version is available:')} v${st.latest.version}.`;
  } else if (st.error) {
    state.textContent = t('Could not check for updates (offline?).');
  } else {
    state.textContent = t('This is the newest version.');
  }
  if (!st.packaged) {
    state.textContent += ' ' + t('This copy runs from source, so it updates with git rather than by itself.');
  }
}

function renderBar() {
  const bar = $('updateBar');
  if (!bar) return;
  const l = st && st.latest;
  const job = (st && st.job) || { state: 'idle' };
  const busy = ['downloading', 'verifying', 'restarting'].includes(job.state) || waitingFor;
  if (!l && !busy) { bar.hidden = true; return; }
  if (l && !busy && store(DISMISS) === l.version && job.state !== 'error') { bar.hidden = true; return; }
  bar.hidden = false;

  if (busy) {
    let msg = t('Installing the update and restarting. This window reloads by itself.');
    if (job.state === 'downloading') {
      msg = job.total
        ? `${t('Downloading the update:')} ${mb(job.received)} / ${mb(job.total)} MB`
        : `${t('Downloading the update:')} ${mb(job.received)} MB`;
    } else if (job.state === 'verifying') {
      msg = t('Checking the download...');
    }
    const pct = job.total ? Math.min(100, Math.round((job.received / job.total) * 100)) : 0;
    bar.innerHTML = `<div class="ub-row"><span class="dotwarn"></span><b>${esc(msg)}</b></div>`
      + (job.state === 'downloading' && job.total ? `<div class="ub-prog"><i style="width:${pct}%"></i></div>` : '');
    return;
  }

  const notes = readNotes(l.notes, lang());
  const body = notes.highlights || notes.changes;
  const tagBeta = l.prerelease ? ` <span class="ub-beta">BETA</span>` : '';
  const canInstall = st.packaged && l.installable;
  const racing = !!st.racing;
  bar.innerHTML = `
    <div class="ub-row">
      <span class="ub-ic">&#8593;</span>
      <div class="ub-text"><b>${esc(t('FRLcast'))} v${esc(l.version)}${tagBeta} ${esc(t('is available.'))}</b>
        <span>${esc(t('You have'))} v${esc(st.version)}.</span></div>
      <div class="ub-actions">
        ${body ? `<button class="btn sm ghost" id="ubMore">${esc(open ? t('Hide') : t("What's new"))}</button>` : ''}
        ${canInstall ? `<button class="btn sm primary" id="ubInstall" ${racing ? 'disabled' : ''}>${esc(t('Update now'))}</button>` : ''}
        <a class="btn sm${canInstall ? ' ghost' : ' primary'}" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(t('Download'))}</a>
        <button class="btn sm ghost" id="ubLater" title="${esc(t('Hide until the next version'))}">${esc(t('Later'))}</button>
      </div>
    </div>
    ${racing && canInstall ? `<div class="ub-note">${esc(t('A race is running. Finish it first: updating restarts the server.'))}</div>` : ''}
    ${job.state === 'error' ? `<div class="ub-note bad">${esc(t('The update did not finish:'))} ${esc(job.error || '')}</div>` : ''}
    ${open && body ? `<div class="ub-notes">${mdToHtml(body)}<p><a href="${CHANGELOG}" target="_blank" rel="noopener">${esc(t('Full changelog'))}</a></p></div>` : ''}`;

  const more = $('ubMore');
  if (more) more.onclick = () => { open = !open; renderBar(); };
  $('ubLater').onclick = () => { store(DISMISS, l.version); renderBar(); };
  const inst = $('ubInstall');
  if (inst) inst.onclick = () => install(l);
}

async function install(l) {
  const ok = window.confirm(`${t('Update to')} v${l.version} ${t('now?')}\n\n${t('FRLcast restarts (about a minute). Your event, drivers, API key, voices and logo are kept, and your data is backed up first.')}`);
  if (!ok) return;
  try {
    const res = await fetch('/api/update/apply', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tag: l.tag })
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok) throw new Error(j.error || `HTTP ${res.status}`);
    waitingFor = l.version;
    follow();
  } catch (e) {
    window.alert(`${t('The update did not finish:')} ${e.message}`);
  }
}

/* Follow the download, then wait for the new server to answer with the new version. */
function follow() {
  clearTimeout(busyTimer);
  busyTimer = setTimeout(async () => {
    try {
      const res = await fetch('/api/version', { cache: 'no-store' });
      if (res.ok) {
        const j = await res.json();
        if (j.version === waitingFor) { location.reload(); return; }
        st = j;
        if (j.job && j.job.state === 'error') { waitingFor = ''; render(); return; }
      }
    } catch { /* the server is restarting: expected */ }
    if (st) st.job = st.job && st.job.state !== 'idle' ? st.job : { state: 'restarting' };
    render();
    follow();
  }, 1500);
}

function render() {
  renderVersion();
  renderAbout();
  renderBar();
}

function wire() {
  const check = $('btnCheckUpdate');
  if (check) check.onclick = async () => {
    check.disabled = true;
    await load(true);
    check.disabled = false;
    if (st && st.latest) store(DISMISS, '');
  };
  const beta = $('betaToggle');
  if (beta) beta.onchange = async () => {
    try {
      const res = await fetch('/api/update/channel', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ channel: beta.checked ? 'beta' : 'stable' })
      });
      st = await res.json();
    } catch { /* keep the old state */ }
    render();
  };
}

wire();
load();
// Ask the local server every minute: it answers from its cache (GitHub is only asked every
// few hours), and it keeps the race-running lock on the Update button current.
if (!hosted) setInterval(() => { if (!waitingFor) load(); }, 60 * 1000);
document.addEventListener('frl:lang', render);
