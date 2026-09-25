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
// The Vercel address rather than the custom domain: it answers even when the domain does not.
const SITE = 'https://frl-broadcast.vercel.app';

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

  // The Race page is where the operator lives, so the way to the online link starts there.
  if (how) {
    how.hidden = !(st && st.configured);
    if (st && st.linked) {
      how.innerHTML = `${esc(t('Online: drivers anywhere type the event code'))} <b class="cloudcode-sm">${esc(st.code)}</b> ${esc(t('in the driver app.'))}`;
    } else if (st && st.configured) {
      how.innerHTML = `${esc(t('Online league, drivers at home?'))} <a href="#" id="regCloudGo">${esc(t('Set up the online link'))}</a>`;
      $('regCloudGo').onclick = (e) => { e.preventDefault(); goToCard(); };
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
      </form>
      <p class="hint" style="margin:10px 0 0">${esc(t('No account yet?'))} <a href="${SITE}/login" target="_blank" rel="noopener">${esc(t('Create one on the website'))}</a> ${esc(t('(free, once), then sign in here.'))}</p>${err}`)) return;
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
      <p style="margin:0 0 12px">${esc(t('Signed in as'))} <b>${esc(st.email)}</b>.</p>
      ${list.length ? `<div class="clocklabel" style="margin-bottom:6px">${esc(t('Use an event you already have'))}</div>
      <div class="row" style="gap:8px;margin-bottom:14px">
        <select id="cloudEvent" style="flex:1">${list.map((e) => `<option value="${esc(e.code)}"${e.code === st.code ? ' selected' : ''}>${esc(e.code)}  ${esc(e.name)}${e.round ? ' · ' + esc(e.round) : ''}</option>`).join('')}</select>
        <button class="btn primary" id="cloudLink" ${busy ? 'disabled' : ''}>${esc(t('Link'))}</button>
      </div>` : ''}
      <div class="clocklabel" style="margin-bottom:6px">${esc(list.length ? t('Or make a new one') : t('Make your event'))}</div>
      <form id="cloudNew" class="cloudform" style="margin-bottom:6px">
        <label class="field"><span>${esc(t('Event name'))}</span><input type="text" id="cloudNewName" maxlength="60" placeholder="NUSANTARA DRIFT LEAGUE" required></label>
        <label class="field"><span>${esc(t('Code drivers type'))}</span><input type="text" id="cloudNewCode" maxlength="12" placeholder="NDL3" pattern="[A-Za-z0-9]{4,12}" title="4-12" required style="text-transform:uppercase"></label>
        <button class="btn ${list.length ? '' : 'primary'}" type="submit" ${busy ? 'disabled' : ''}>${esc(t('Create and link'))}</button>
      </form>
      <p class="hint" style="margin:0 0 12px">${esc(t('4 to 12 letters or digits, unique across every league on FRLcast. Avoid O next to 0.'))}</p>
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
    $('cloudNew').onsubmit = async (e) => {
      e.preventDefault();
      const body = { name: $('cloudNewName').value, code: $('cloudNewCode').value };
      busy = true; note = ''; render();
      try { await api('/api/cloud/create', body); } catch (x) { note = x.message; }
      busy = false;
      events = null;
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

/** Open the Drivers page at this card (from the hint on the Race page). */
function goToCard() {
  const btn = document.querySelector('.navbtn[data-page="drivers"]');
  if (btn) btn.click();
  setTimeout(() => { const c = $('cloudCard'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50);
}

if (cloudOptions()) {
  const card = $('cloudCard');
  if (card) card.hidden = true;
} else {
  refresh();
  setInterval(() => { if (!busy && document.visibilityState !== 'hidden') refresh(); }, 5000);
  document.addEventListener('frl:lang', render);
}
