/*
 * "Drivers from anywhere": the console card for the online link (server/cloud-link.js).
 *
 * An online league's drivers are never on the operator's WiFi. Linking this desktop app to
 * an event on the website lets them join with the driver app and the event code from
 * wherever they are, while race control keeps running here with everything the desktop
 * app has. This card signs in to the FRLcast account, picks the event and shows the code.
 *
 * Local console only: a hosted console already is the online event.
 */
import { cloudOptions } from './cloudbus.js';

const t = (en) => (window.FRL_I18N ? window.FRL_I18N.t(en) : en);
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DASHBOARD = 'https://www.frlcast.my.id/dashboard';

let st = null;
let events = null;
let busy = false;
let note = '';
let painted = '';

/* Repaint only when the card really changed: a timer refresh must not wipe a half-typed form. */
function paint(el, html) {
  if (html === painted) return false;
  painted = html;
  el.innerHTML = html;
  return true;
}

async function api(path, body) {
  const res = await fetch(path, body === undefined ? { cache: 'no-store' } : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.ok === false) throw new Error(j.error || `HTTP ${res.status}`);
  return j;
}

async function refresh() {
  try { st = await api('/api/cloud/status'); } catch { st = null; }
  if (st && st.signedIn && !st.linked && !events) {
    try { events = (await api('/api/cloud/events')).events; } catch (e) { events = []; note = e.message; }
  }
  render();
}

function ago(ms) {
  if (!ms) return t('not yet');
  const s = Math.round((Date.now() - ms) / 1000);
  return s < 5 ? t('just now') : `${s}s ${t('ago')}`;
}

function render() {
  const body = $('cloudBody');
  const pill = $('cloudPill');
  const how = $('regCloud');
  if (!body) return;
  if (pill) pill.style.color = '';

  if (how) {
    how.hidden = !(st && st.linked);
    if (st && st.linked) {
      how.innerHTML = `${esc(t('Online: drivers anywhere type the event code'))} <b class="cloudcode-sm">${esc(st.code)}</b> ${esc(t('in the driver app.'))}`;
    }
  }

  if (!st) { paint(body, `<p class="hint">${esc(t('Could not reach the FRLcast server.'))}</p>`); return; }
  if (!st.configured) {
    paint(body, `<p class="hint">${esc(t('This copy has no online project configured, so the online link is not available.'))}</p>`);
    pill.textContent = '';
    return;
  }

  const err = (st.error || note) ? `<p class="hint cloud-err">${esc(st.error || note)}</p>` : '';

  if (!st.signedIn) {
    pill.textContent = t('off');
    if (!paint(body, `
      <p style="margin:0 0 10px">${esc(t('For an online league: drivers join from anywhere with the driver app and an event code, while race control runs here with everything the desktop app has.'))}</p>
      <p class="hint" style="margin:0 0 12px">${esc(t('Sign in with your FRLcast website account (the one for the dashboard). Only a sign-in token is kept on this PC, never your password.'))}</p>
      <form id="cloudLogin" class="cloudform">
        <label class="field"><span>${esc(t('Email'))}</span><input type="email" id="cloudEmail" autocomplete="username" required></label>
        <label class="field"><span>${esc(t('Password'))}</span><input type="password" id="cloudPass" autocomplete="current-password" required></label>
        <button class="btn primary" type="submit" ${busy ? 'disabled' : ''}>${esc(t('Sign in'))}</button>
      </form>${err}`)) return;
    $('cloudLogin').onsubmit = async (e) => {
      e.preventDefault();
      // Read before repainting: the busy state redraws the form and empties it.
      const creds = { email: $('cloudEmail').value, password: $('cloudPass').value };
      busy = true; note = ''; render();
      try {
        await api('/api/cloud/login', creds);
        events = null;
      } catch (x) { note = x.message; }
      busy = false;
      refresh();
    };
    return;
  }

  if (!st.linked) {
    pill.textContent = t('not linked');
    const list = events || [];
    if (!paint(body, `
      <p style="margin:0 0 12px">${esc(t('Signed in as'))} <b>${esc(st.email)}</b>. ${esc(t('Pick the event your drivers will join.'))}</p>
      ${list.length ? `<div class="row" style="gap:8px;margin-bottom:10px">
        <select id="cloudEvent" style="flex:1">${list.map((e) => `<option value="${esc(e.code)}"${e.code === st.code ? ' selected' : ''}>${esc(e.code)}  ${esc(e.name)}${e.round ? ' · ' + esc(e.round) : ''}</option>`).join('')}</select>
        <button class="btn primary" id="cloudLink" ${busy ? 'disabled' : ''}>${esc(t('Link'))}</button>
      </div>` : `<p class="hint">${esc(t('You have no events on the website yet.'))} <a href="${DASHBOARD}" target="_blank" rel="noopener">${esc(t('Create one on the dashboard'))}</a>, ${esc(t('then come back here.'))}</p>`}
      <p class="hint" style="margin:0 0 10px">${esc(t('Linking makes this PC the timing computer for that event: its grid, flags and penalties are replaced by the ones here. Do not also run the web console for it.'))}</p>
      <div class="row" style="gap:8px"><button class="btn ghost sm" id="cloudReload">${esc(t('Refresh list'))}</button>
      <button class="btn ghost sm" id="cloudOut">${esc(t('Sign out'))}</button></div>${err}`)) return;
    const link = $('cloudLink');
    if (link) link.onclick = async () => {
      const code = $('cloudEvent').value;
      busy = true; note = ''; render();
      try { await api('/api/cloud/link', { code }); } catch (x) { note = x.message; }
      busy = false;
      refresh();
    };
    $('cloudReload').onclick = () => { events = null; note = ''; refresh(); };
    $('cloudOut').onclick = async () => { await api('/api/cloud/logout', {}).catch(() => {}); events = null; refresh(); };
    return;
  }

  pill.textContent = st.pending ? `${st.pending} ${t('waiting')}` : t('online');
  pill.style.color = 'var(--accent)';
  if (!paint(body, `
    <div class="cloudlinked">
      <div>
        <div class="clocklabel">${esc(t('Event code'))}</div>
        <div class="cloudcode">${esc(st.code)}</div>
      </div>
      <div class="cloudinfo">
        <b>${esc(st.eventName || '')}</b>
        <span>${esc(t('Drivers type this code in the driver app, from anywhere. Their sign-ins appear on the Race page to accept, and flags, positions and penalties reach their phones.'))}</span>
      </div>
    </div>
    <p class="hint" style="margin:10px 0">${esc(t('Last sent'))}: ${esc(ago(st.lastPushAt))} · ${esc(t('last checked'))}: ${esc(ago(st.lastPullAt))}. ${esc(t('Keep FRLcast running during the event.'))}</p>
    <div class="row" style="gap:8px">
      <button class="btn ghost sm" id="cloudUnlink">${esc(t('Unlink'))}</button>
      <button class="btn ghost sm" id="cloudOut">${esc(t('Sign out'))}</button>
    </div>${err}`)) return;
  $('cloudUnlink').onclick = async () => {
    if (!window.confirm(t('Unlink? Drivers using the event code stop receiving flags until you link again.'))) return;
    await api('/api/cloud/unlink', {}).catch((x) => { note = x.message; });
    events = null;
    refresh();
  };
  $('cloudOut').onclick = async () => {
    if (!window.confirm(t('Sign out and unlink? Drivers using the event code stop receiving flags.'))) return;
    await api('/api/cloud/logout', {}).catch(() => {});
    events = null;
    refresh();
  };
}

if (cloudOptions()) {
  const card = $('cloudCard');
  if (card) card.hidden = true;
} else {
  refresh();
  setInterval(() => { if (!busy && document.visibilityState !== 'hidden') refresh(); }, 5000);
  document.addEventListener('frl:lang', render);
}
