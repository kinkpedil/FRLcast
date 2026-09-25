import { Bus, fmtTime, fmtClock, classification, raceElapsed, leaderLap, fastestLap, FLAG_LABEL } from './shared.js';
import { CloudPanelBus } from './cloudpanel.js';
import { cloudOptions } from './cloudbus.js';
import { THEMES } from './themes.js';
import { Capture } from './capture.js';
import { VisionEngine, ROI_TYPES, ROI_HELP } from './vision.js';
import { Detector } from './detector.js';
import { SETTING_FIELDS, applyVisionSettings, toInputValue } from './settings.js';
import { Speaker } from './speaker.js';
import { ObsWs } from './obsws.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

/**
 * One word at a time, for text this file assembles rather than writes.
 *
 * The page walker translates whole sentences it finds in the DOM. It cannot help with
 * "12 cars" or "recording · 21 marks", because the number is in the middle and no
 * dictionary can hold every count. Those are built through here instead.
 */
const t = (en) => (window.FRL_I18N ? window.FRL_I18N.t(en) : en);

/*
 * A socket to the broadcast server on this machine, or a hosted event.
 *
 * `?event=NDL3` picks the second. Both take the same actions and hand back the same state,
 * so the two and a half thousand lines below this one do not know which they are talking
 * to, and a league still running the server on a laptop keeps working exactly as it does.
 */
const cloud = cloudOptions();
const bus = cloud ? new CloudPanelBus('panel', cloud) : new Bus('panel');
const capture = new Capture();
const vision = new VisionEngine(capture, bus);
const detector = new Detector();

let state = null;
let selectedRoi = null;
let drawing = null;
let showBoxes = true;
let modelBoxes = [];
let pendingLine = null;   // first click of a two-click timing line

// A capture node on another machine shares a snapshot so this panel can still draw
// regions and timing lines without being the machine that sees the game.
const remotePreview = { img: null, label: '', at: 0 };
let remoteBlobs = [];      // what the node's detector found, in frame coordinates
let remoteTracked = [];
const remoteFresh = () => remotePreview.img && performance.now() - remotePreview.at < 5000;

let connectedClients = [];
let nodeStatus = null;
let nodeStatusAt = 0;
const nodeFresh = () => nodeStatus && performance.now() - nodeStatusAt < 6000;

bus.on('signal', (channel, data) => {
  // The cloud bus has no server to report through, so it says things this way.
  if (channel === 'toast') { toast(data && data.text ? data.text : ''); return; }
  if (channel === 'node-status') {
    nodeStatus = data;
    nodeStatusAt = performance.now();
    renderVisionButton();
    return;
  }
  if (channel === 'clients') {
    connectedClients = Array.isArray(data) ? data : [];
    renderClients();
    return;
  }
  if (channel !== 'node-preview' || !data || !data.url) return;
  remoteBlobs = data.blobs || [];
  remoteTracked = data.tracked || [];
  remoteTracked.unnamed = data.unnamed || 0;
  const img = new Image();
  img.onload = () => {
    remotePreview.img = img;
    remotePreview.at = performance.now();
    // Paint on arrival rather than waiting for an animation frame: this is the
    // operator's only view of the game, and a backgrounded tab has no rAF at all.
    if (!capture.active) drawPreviewBase();
  };
  img.src = data.url;
  remotePreview.label = data.label || 'capture node';
});

const HOTKEYS = ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i'];

// ---------------------------------------------------------------- nav

/*
 * A hosted event has to travel with the URL.
 *
 * The overlay preview and the layout editor load the very same page an OBS source does,
 * and that page decides which world it is in from `?event=`. Without it both frames looked
 * for a broadcast server on this machine, which for a console served from the website is
 * not there, and both came up blank with nothing on screen to say why.
 */
function withEvent(src) {
  if (!cloud) return src;
  const q = new URLSearchParams(location.search);
  const add = new URLSearchParams({ event: cloud.code });
  // Carried over so a console opened with an explicit project keeps pointing at it.
  for (const k of ['sb', 'key']) if (q.get(k)) add.set(k, q.get(k));
  return src + (src.includes('?') ? '&' : '?') + add.toString();
}

/** An iframe with data-src has not booted yet; give it its src the first time it is needed. */
function bootFrame(id) {
  const el = $(id);
  if (el && el.dataset.src) {
    el.src = withEvent(el.dataset.src);
    delete el.dataset.src;
  }
}

let currentPage = 'race';

// Declared up here because the nav handler below can reach loadHelp() long before
// module evaluation gets to the help section.
let HELP = null;
let helpLoading = null;

$$('.navbtn').forEach((btn) => {
  btn.onclick = () => {
    currentPage = btn.dataset.page;
    $$('.navbtn').forEach((b) => b.classList.toggle('on', b === btn));
    $$('.page').forEach((p) => p.classList.toggle('on', p.id === `page-${currentPage}`));

    // The layout editor and the help manual are each a sizeable chunk of work that
    // most sessions never touch, so neither is paid for until it is opened.
    if (currentPage === 'layout') {
      bootFrame('#layoutFrame');
      requestAnimationFrame(fitEditor);
    }
    if (currentPage === 'overlay' && $('#showOverlayPreview').checked) bootFrame('#overlayPreview');
    /*
     * Painted on arrival, not on the next state change.
     *
     * Every other card on this page is either static or redrawn by the render loop, and the
     * render loop only runs when the state moves. With the race idle nothing moves, so
     * opening this page showed the commentary card exactly as it is written in the HTML:
     * the switch unchecked whatever the setting was, the status reading "off", the OBS
     * address still the placeholder. It looked broken, and an operator who concludes that
     * stops pressing it.
     */
    if (currentPage === 'overlay') renderCommentary();
    if (currentPage === 'help') loadHelp();
    if (currentPage === 'drift') renderDrift();
    renderSceneStrip();
    if (currentPage === 'event') renderScenes();
    if (currentPage === 'champ') renderChampionship();
    if (currentPage === 'layout') renderThemes();
    // Same for the sign-in queue: one that arrived while the operator was on another page
    // (an online sign-in comes in at any moment) must be there when they come back.
    if (currentPage === 'race') { renderRegistrations(); renderRaceControl(); }
  };
});

/* ---------------------------------------------------------------- manual control
 * A no-vision operating mode: the operator sets the order (drag or ▲▼) and the laps
 * (add live, or type a lap time) by hand. Built for a machine that cannot run the tracker.
 */
function parseLap(str) {
  str = String(str || '').trim();
  if (!str) return null;
  let m;
  if ((m = str.match(/^(\d+):(\d{1,2})(?:\.(\d{1,3}))?$/))) {
    return (Number(m[1]) * 60 + Number(m[2])) * 1000 + Number((m[3] || '0').padEnd(3, '0'));
  }
  if ((m = str.match(/^(\d+)(?:\.(\d{1,3}))?$/))) {
    return Number(m[1]) * 1000 + Number((m[2] || '0').padEnd(3, '0'));
  }
  return null;
}

const swState = new Map();   // driver id -> stopwatch start epoch, console-side only
function swElapsed(id) { return swState.has(id) ? Date.now() - swState.get(id) : 0; }

function renderManual() {
  const box = $('#manualList');
  if (!box || !state) return;
  const manual = !!state.race.manual;
  if ($('#manualMode') && document.activeElement !== $('#manualMode')) $('#manualMode').checked = manual;

  const rows = classification(state);
  const running = [...swState.keys()].sort().join(',');
  const sig = manual + '|' + running + '|' + rows.map((d) => d.id + d.position + d.lapsDone + (d.lastLap || 0) + (d.retired ? 'r' : d.dnf ? 'x' : '')).join('|');
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;

  if (!manual) { box.innerHTML = '<p class="hint">Turn Manual mode on to arrange the field by hand.</p>'; return; }

  box.innerHTML = `
    <div class="mbar">
      <button class="btn sm" id="mLapAll" title="Add one lap to every running driver">+${t('Lap to all')}</button>
    </div>` + rows.map((d) => {
    const on = swState.has(d.id);
    return `
    <div class="mrow ${d.dnf ? 'is-dnf' : ''}" draggable="true" data-id="${d.id}">
      <span class="mh">⋮⋮</span>
      <input class="mset-pos" type="number" min="1" value="${d.position}" title="${t('Set position')}">
      <span class="mnm"><span class="mcbar" style="background:${d.color}"></span>${esc(d.name)}</span>
      <span class="mlaps">
        <input class="mset-laps" type="number" min="0" value="${d.lapsDone}" title="${t('Set lap count')}"> ${t('laps')}
        · ${d.lastLap != null ? fmtTime(d.lastLap) : '--:--.---'}
      </span>
      <span class="mbtns">
        <button class="btn ghost sm" data-mmove="-1" title="Up">▲</button>
        <button class="btn ghost sm" data-mmove="1" title="Down">▼</button>
        <button class="btn sm ${on ? 'sw-on' : ''}" data-msw="1" title="Stopwatch: start, then stop to record the lap">${on ? '<span class="sw-t">0.0</span> ⏹' : '⏱ Start'}</button>
        <input class="mlt" type="text" placeholder="lap time" style="width:76px">
        <button class="btn sm" data-mlap="1" title="Add lap">+Lap</button>
        <button class="btn ghost sm" data-munlap="1" title="Remove last lap">−</button>
        <button class="btn ghost sm ${d.dnf ? 'danger' : ''}" data-mdnf="1" title="Click to cycle: running, DNF, Retired">${d.retired ? 'RET' : d.dnf ? 'DNF' : 'DNF?'}</button>
      </span>
    </div>`; }).join('');

  const lapAll = box.querySelector('#mLapAll');
  if (lapAll) lapAll.onclick = () => bus.action('manual.lapAll', {});

  box.querySelectorAll('.mrow').forEach((row) => {
    const id = row.dataset.id;
    row.querySelector('[data-mmove="-1"]').onclick = () => bus.action('manual.move', { id, delta: -1 });
    row.querySelector('[data-mmove="1"]').onclick = () => bus.action('manual.move', { id, delta: 1 });
    row.querySelector('[data-munlap]').onclick = () => bus.action('manual.unlap', { id });
    row.querySelector('[data-mdnf]').onclick = () => bus.action('manual.dnf', { id });
    // Set position / lap count directly — commit on Enter or when the field loses focus.
    const posIn = row.querySelector('.mset-pos');
    const commitPos = () => { const v = parseInt(posIn.value, 10); if (v > 0 && posIn.value !== posIn.defaultValue) { bus.action('manual.setPos', { id, pos: v }); posIn.defaultValue = posIn.value; } };
    posIn.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); commitPos(); posIn.blur(); } };
    posIn.onblur = commitPos;
    const lapsIn = row.querySelector('.mset-laps');
    const commitLaps = () => { const v = parseInt(lapsIn.value, 10); if (v >= 0 && lapsIn.value !== lapsIn.defaultValue) { bus.action('manual.setLaps', { id, laps: v }); lapsIn.defaultValue = lapsIn.value; } };
    lapsIn.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); commitLaps(); lapsIn.blur(); } };
    lapsIn.onblur = commitLaps;
    row.querySelector('[data-msw]').onclick = () => {
      if (swState.has(id)) {
        const ms = Date.now() - swState.get(id);
        swState.delete(id);
        bus.action('manual.lap', { id, ms });
      } else {
        swState.set(id, Date.now());
      }
      box.dataset.sig = '';   // force a rebuild so the button flips state
      renderManual();
    };
    row.querySelector('[data-mlap]').onclick = () => {
      const ms = parseLap(row.querySelector('.mlt').value);
      bus.action('manual.lap', ms ? { id, ms } : { id });
      row.querySelector('.mlt').value = '';
    };
    // drag to reorder
    row.addEventListener('dragstart', (e) => { row.classList.add('drag'); e.dataTransfer.setData('text/plain', id); });
    row.addEventListener('dragend', () => row.classList.remove('drag'));
    row.addEventListener('dragover', (e) => e.preventDefault());
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      const from = e.dataTransfer.getData('text/plain');
      if (!from || from === id) return;
      const order = [...box.querySelectorAll('.mrow')].map((r) => r.dataset.id);
      const fi = order.indexOf(from);
      order.splice(fi, 1);
      order.splice(order.indexOf(id), 0, from);
      bus.action('manual.reorder', { order });
    });
  });
}
if ($('#manualMode')) $('#manualMode').onchange = (e) => bus.action('manual.mode', { on: e.target.checked });

// Tick the running stopwatch displays without rebuilding the whole list.
setInterval(() => {
  if (!swState.size) return;
  const box = $('#manualList');
  if (!box) return;
  box.querySelectorAll('.mrow').forEach((row) => {
    const el = row.querySelector('.sw-t');
    if (el && swState.has(row.dataset.id)) el.textContent = (swElapsed(row.dataset.id) / 1000).toFixed(1);
  });
}, 100);

/**
 * The one-click "moment" bar on Race control: every overlay scene as a button, so switching
 * from Racing to Podium to Replay is a single tap instead of a trip to the scenes page. The
 * scenes themselves are still built and named on the Event scenes page.
 */
function renderSceneStrip() {
  const strip = $('#sceneStrip');
  if (!strip || !state) return;
  const o = state.overlay;
  const scenes = o.scenes || [];
  const sig = scenes.map((s) => s.id + s.name).join('|') + '|' + o.activeScene;
  if (strip.dataset.sig !== sig) {
    strip.dataset.sig = sig;
    strip.innerHTML = scenes.map((s) =>
      `<button class="btn sm scene-chip ${s.id === o.activeScene ? 'on' : ''}" data-scenego="${s.id}">${esc(s.name)}</button>`).join('');
    $$('#sceneStrip [data-scenego]').forEach((b) => {
      b.onclick = () => { bus.action('scene.select', { id: b.dataset.scenego }); toast(t('Scene:') + ' ' + b.textContent); };
    });
  }
}

/**
 * Auto-director: a small operator-side automation that flashes the fastest-lap banner when
 * the record falls and brings up the results at the chequered flag. It runs in the console
 * (which, unlike a windowless OBS page, still has working timers) and only ever toggles
 * widgets the operator can toggle by hand, so it is never doing anything hidden.
 */
let autoDirector = false;
try { autoDirector = localStorage.getItem('frl.autodirector') === '1'; } catch (e) {}
const adState = { fastId: null, hideAt: 0, lastStatus: null };

function runDirector() {
  if (!autoDirector || !state) return;
  const now = Date.now();
  const s = state;

  // fastest lap fell to a new holder → flash the banner for 8s
  const fl = (s.drivers || []).filter((d) => d.bestLap != null).sort((a, b) => a.bestLap - b.bestLap)[0];
  if (fl && fl.id !== adState.fastId && s.race.startedAt && s.race.status !== 'finished') {
    adState.fastId = fl.id;
    if (!s.overlay.show.fastlap) bus.action('overlay.update', { patch: { show: { fastlap: true } } });
    adState.hideAt = now + 8000;
  }
  if (adState.hideAt && now > adState.hideAt) {
    adState.hideAt = 0;
    if (state.overlay.show.fastlap) bus.action('overlay.update', { patch: { show: { fastlap: false } } });
  }

  // chequered flag → switch to the Results scene once (fall back to just showing the widget)
  if (s.race.status === 'finished' && adState.lastStatus !== 'finished') {
    const scenes = s.overlay.scenes || [];
    const rs = scenes.find((sc) => sc.id === 'results') || scenes.find((sc) => /result|hasil/i.test(sc.name || ''));
    if (rs && s.overlay.activeScene !== rs.id) bus.action('scene.select', { id: rs.id });
    else if (!rs && !s.overlay.show.results) bus.action('overlay.update', { patch: { show: { results: true } } });
  }
  adState.lastStatus = s.race.status;
}
setInterval(runDirector, 500);

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('on'), 1800);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ---------------------------------------------------------------- race page

$('#btnStart').onclick = () => {
  if (!state?.drivers.length) return toast('Add drivers first');
  bus.action('race.start');
  toast('Green flag');
};
$('#btnReset').onclick = () => {
  if (confirm('Reset the session? All lap times for this session are cleared.')) bus.action('race.reset');
};
if ($('#btnUndo')) $('#btnUndo').onclick = () => { bus.action('history.undo'); toast(t('Undid last action')); };

// Public live-timing link: only meaningful for a hosted event (?event=CODE in the address).
(() => {
  const code = new URLSearchParams(location.search).get('event');
  if (!code || !$('#liveShare')) return;
  const url = `${location.origin}/live?event=${encodeURIComponent(code)}`;
  $('#liveShare').hidden = false;
  $('#liveUrl').value = url;
  if ($('#btnCopyLive')) $('#btnCopyLive').onclick = async () => {
    try { await navigator.clipboard.writeText(url); toast(t('Link copied')); }
    catch (e) { $('#liveUrl').select(); }
  };
  const roomUrl = `${location.origin}/multiview?event=${encodeURIComponent(code)}`;
  if ($('#roomUrl')) $('#roomUrl').value = roomUrl;
  if ($('#btnCopyRoom')) $('#btnCopyRoom').onclick = async () => {
    try { await navigator.clipboard.writeText(roomUrl); toast(t('Link copied')); }
    catch (e) { $('#roomUrl').select(); }
  };
})();
$$('.flagbtn').forEach((b) => { b.onclick = () => bus.action('race.flag', { flag: b.dataset.flag }); });

$('#btnResultCsv').onclick = () => {
  const rows = classification(state);
  const head = 'pos,num,name,team,car,laps,total,best,gap,penalty_s,pit_stops,dnf';
  const body = rows.map((d) => [
    d.position, d.num, d.name, d.team, d.car, d.lapsDone,
    fmtTime(d.totalMs, { forceMinutes: true }),
    d.bestLap != null ? fmtTime(d.bestLap) : '',
    d.gap, d.penaltySec, d.pitStops, d.retired ? 'retired' : d.dnf ? 'dnf' : ''
  ].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
  download(`${state.event.name}-${state.event.round}-result.csv`, [head, ...body].join('\n'));
};

function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.replace(/[^\w.\- ]/g, '_');
  a.click();
  URL.revokeObjectURL(url);
}

bindInput('#evName', (v) => bus.action('event.update', { patch: { name: v } }));
bindInput('#evRound', (v) => bus.action('event.update', { patch: { round: v } }));
bindInput('#evTrack', (v) => bus.action('event.update', { patch: { track: v } }));
bindInput('#evSession', (v) => bus.action('event.update', { patch: { sessionName: v } }));
$('#evType').onchange = (e) => bus.action('event.update', { patch: { sessionType: e.target.value } });
$('#cfgLaps').onchange = (e) => bus.action('race.config', { patch: { totalLaps: Number(e.target.value) } });
if ($('#cfgMins')) $('#cfgMins').onchange = (e) => bus.action('race.config', { patch: { timeLimitSec: Math.max(0, Number(e.target.value) || 0) * 60 } });

// Practice / qualifying run to the clock, not to a lap count: swap Total laps for Session
// minutes, and end the session automatically when the timer runs out.
setInterval(() => {
  if (!state) return;
  const r = state.race, mode = state.event.sessionType || 'race';
  if ((mode === 'qualifying' || mode === 'practice' || mode === 'endurance') && r.status === 'green' && r.startedAt && (r.timeLimitSec || 0) > 0) {
    if (Date.now() - r.startedAt - (r.pausedTotal || 0) >= r.timeLimitSec * 1000) bus.action('race.flag', { flag: 'finished' });
  }
}, 1000);
$('#cfgAccent').oninput = (e) => bus.action('overlay.update', { patch: { accent: e.target.value } });
$('#cfgPredict').onchange = (e) => bus.action('race.config', { patch: { predictOrder: e.target.checked } });

function bindInput(sel, fn) {
  const el = $(sel);
  let timer;
  el.oninput = () => { clearTimeout(timer); timer = setTimeout(() => fn(el.value), 250); };
}

function renderRace() {
  const r = state.race;
  $('#raceStatusPill').textContent = FLAG_LABEL[r.status] || r.status;
  $('#totalLapsSmall').textContent = `/${r.totalLaps}`;
  $('#leaderLapBig').firstChild.nodeValue = String(leaderLap(state));
  const fl = fastestLap(state);
  $('#flBig').textContent = fl ? fmtTime(fl.bestLap) : '--:--.---';
  $('#flWho').textContent = fl ? `${fl.name} · lap ${fl.lapTimes.indexOf(fl.bestLap) + 1}` : '';
  $$('.flagbtn').forEach((b) => b.classList.toggle('on', b.dataset.flag === r.status));

  syncIfIdle('#evName', state.event.name);
  syncIfIdle('#evRound', state.event.round);
  syncIfIdle('#evTrack', state.event.track);
  syncIfIdle('#evSession', state.event.sessionName);
  syncIfIdle('#evType', state.event.sessionType);
  syncIfIdle('#cfgLaps', state.race.totalLaps);
  syncIfIdle('#cfgMins', Math.round((state.race.timeLimitSec || 0) / 60));
  syncIfIdle('#cfgAccent', state.overlay.accent);
  if (document.activeElement !== $('#cfgPredict')) {
    $('#cfgPredict').checked = state.race.predictOrder !== false;
  }
  // Timed sessions (practice, qualifying, endurance) show Session minutes; a lap race shows Total laps.
  const st = state.event.sessionType;
  const timed = st === 'qualifying' || st === 'practice' || st === 'endurance';
  if ($('#cfgLapsField')) $('#cfgLapsField').style.display = timed ? 'none' : '';
  if ($('#cfgMinsField')) $('#cfgMinsField').style.display = timed ? '' : 'none';
  const hint = $('#sessionHint');
  if (hint) {
    if (st === 'practice') { hint.style.display = ''; hint.textContent = t('Practice: a timed session for laps only — it changes nothing.'); }
    else if (st === 'qualifying') { hint.style.display = ''; hint.textContent = t('Qualifying: a timed session; the chequered flag sets the starting grid by best lap.'); }
    else if (st === 'endurance') { hint.style.display = ''; hint.textContent = t('Endurance: a race run to a clock. Positions rank by distance; it ends when the timer runs out and scores the championship.'); }
    else { hint.style.display = 'none'; }
  }

  const log = (state.vision.log || []).map((e) => {
    const d = state.drivers.find((x) => x.id === e.driverId);
    const time = new Date(e.t).toLocaleTimeString();
    return `<div>${time} <b>${esc(e.kind || 'event')}</b> ${esc(d ? d.name : '')} <span class="dim">${esc(e.source || '')}</span></div>`;
  }).join('') || `<div class="dim">${t('No events yet.')}</div>`;
  if ($('#eventLog').dataset.sig !== log) {
    $('#eventLog').dataset.sig = log;
    $('#eventLog').innerHTML = log;
  }

  const rows = classification(state);
  const tableSig = rows.map((d) => [
    d.id, d.position, d.lapsDone, d.lastLap, d.bestLap, d.gap,
    d.pit, d.dnf, d.retired, d.penaltySec, d.name, d.num, d.color
  ].join(',')).join(';') + '|' + state.overlay.focusDriverId;
  if ($('#liveTable').dataset.sig === tableSig) return;
  $('#liveTable').dataset.sig = tableSig;

  $('#liveTable').innerHTML = `
    <tr><th>P</th><th></th><th>Driver</th><th>Laps</th><th>Last</th><th>Best</th><th>Gap</th><th>Actions</th></tr>
    ${rows.map((d, i) => `
      <tr class="${state.overlay.focusDriverId === d.id ? 'focus' : ''}" data-id="${d.id}">
        <td class="cnum">${d.position}</td>
        <td><span class="swatch" style="background:${d.color}"></span></td>
        <td>
          <b>${esc(d.name)}</b> <span class="dim mono">#${esc(d.num)}</span>
          ${i < HOTKEYS.length ? `<span class="hot">${HOTKEYS[i].toUpperCase()}</span>` : ''}
          ${d.pit ? '<span class="hot" style="color:var(--yellow)">PIT</span>' : ''}
          ${d.dnf ? `<span class="hot" style="color:var(--red)">${d.retired ? 'RET' : 'DNF'}</span>` : ''}
          ${d.penaltySec ? `<span class="hot" style="color:var(--red)">+${d.penaltySec}s</span>` : ''}
        </td>
        <td class="mono">${d.lapsDone}</td>
        <td class="mono dim">${d.lastLap != null ? fmtTime(d.lastLap) : '--'}</td>
        <td class="mono dim">${d.bestLap != null ? fmtTime(d.bestLap) : '--'}</td>
        <td class="mono dim">${esc(d.gap)}</td>
        <td>
          <button class="btn sm primary" data-act="lap">+ Lap</button>
          <button class="btn sm" data-act="undo">Undo</button>
          <button class="btn sm" data-act="pit">Pit</button>
          <button class="btn sm" data-act="pen">+5s</button>
          <button class="btn sm" data-act="dnf" title="Cycle: running, DNF, Retired">DNF</button>
          <button class="btn sm" data-act="focus">Focus</button>
        </td>
      </tr>`).join('')}`;

  $('#liveTable').onclick = (ev) => {
    const btn = ev.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.closest('tr').dataset.id;
    const d = state.drivers.find((x) => x.id === id);
    switch (btn.dataset.act) {
      case 'lap': bus.action('lap.record', { driverId: id, source: 'operator', force: true }); break;
      case 'undo': bus.action('lap.undo', { driverId: id }); break;
      case 'pit': bus.action('driver.pitToggle', { driverId: id }); break;
      case 'pen': bus.action('driver.penalty', { driverId: id, seconds: 5 }); break;
      case 'dnf': bus.action('manual.dnf', { id }); break;
      case 'focus': bus.action('overlay.update', { patch: { focusDriverId: id } }); break;
    }
  };

}

function syncIfIdle(sel, value) {
  const el = $(sel);
  if (document.activeElement !== el && String(el.value) !== String(value ?? '')) el.value = value ?? '';
}

// ---------------------------------------------------------------- drivers page

$('#btnAddDriver').onclick = () => bus.action('driver.add', { driver: {} });

$('#btnExport').onclick = () => {
  const csv = ['num,name,team,car,color', ...state.drivers.map((d) =>
    [d.num, d.name, d.team, d.car, d.color].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')
  )].join('\n');
  download('frl-drivers.csv', csv);
};

$('#btnImport').onclick = () => $('#csvInput').click();
$('#csvInput').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = lines[0].toLowerCase().includes('name') ? lines.shift().split(',').map((s) => s.trim().replace(/"/g, '')) : ['num', 'name', 'team', 'car', 'color'];
  for (const line of lines) {
    const cells = parseCsvLine(line);
    const rec = {};
    header.forEach((h, i) => { rec[h] = cells[i]; });
    bus.action('driver.add', { driver: rec });
  }
  toast(`${lines.length} drivers imported`);
  e.target.value = '';
};

function parseCsvLine(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function renderDrivers() {
  $('#driverCount').textContent = `${state.drivers.length} ${t('cars')}`;
  const table = $('#driverTable');

  // Rebuild only when the roster itself changes — otherwise typing in a cell would
  // be wiped by the echo of its own update.
  const sig = state.drivers.map((d) => d.id).join('|');
  if (table.dataset.sig === sig) {
    for (const d of state.drivers) {
      const tr = table.querySelector(`tr[data-id="${d.id}"]`);
      if (!tr) continue;
      tr.querySelector('.swatch').style.background = d.color;
      for (const input of tr.querySelectorAll('input[data-k]')) {
        if (document.activeElement === input) continue;
        const v = d[input.dataset.k] ?? '';
        if (input.value !== String(v)) input.value = v;
      }
    }
    return;
  }
  table.dataset.sig = sig;

  table.innerHTML = `
    <tr><th></th><th>#</th><th>Name</th><th>Team</th><th>Car</th><th>${t('Class')}</th><th>${t('Photo URL')}</th><th>Colour</th><th></th></tr>
    ${state.drivers.map((d) => `
      <tr data-id="${d.id}">
        <td><span class="swatch" style="background:${d.color}"></span></td>
        <td style="width:64px"><input type="text" data-k="num" value="${esc(d.num)}"></td>
        <td><input type="text" data-k="name" value="${esc(d.name)}"></td>
        <td><input type="text" data-k="team" value="${esc(d.team)}"></td>
        <td><input type="text" data-k="car" value="${esc(d.car)}"></td>
        <td style="width:104px"><input type="text" data-k="carClass" value="${esc(d.carClass)}" placeholder="HYPERCAR"></td>
        <td style="width:130px"><input type="text" data-k="photo" value="${esc(d.photo || '')}" placeholder="https://…"></td>
        <td style="width:56px"><input type="color" data-k="color" value="${esc(d.color)}"></td>
        <td><button class="btn sm danger" data-act="rm">Remove</button></td>
      </tr>`).join('')}`;

  $('#driverTable').oninput = (ev) => {
    const input = ev.target.closest('input[data-k]');
    if (!input) return;
    const id = input.closest('tr').dataset.id;
    bus.action('driver.update', { id, patch: { [input.dataset.k]: input.value } });
  };
  $('#driverTable').onclick = (ev) => {
    if (!ev.target.closest('button[data-act=rm]')) return;
    const id = ev.target.closest('tr').dataset.id;
    if (confirm('Remove this driver?')) bus.action('driver.remove', { id });
  };
}

// ---------------------------------------------------------------- vision page

const preview = $('#preview');
const roiLayer = $('#roiLayer');
const pctx = preview.getContext('2d');
const rctx = roiLayer.getContext('2d');

function sizeCanvases() {
  const rect = roiLayer.getBoundingClientRect();
  for (const c of [preview, roiLayer]) {
    if (c.width !== Math.round(rect.width) || c.height !== Math.round(rect.height)) {
      c.width = Math.round(rect.width);
      c.height = Math.round(rect.height);
    }
  }
}
new ResizeObserver(sizeCanvases).observe(roiLayer);

$('#btnCapture').onclick = async () => {
  try {
    const dim = await capture.start({
      fps: vision.targetFps,
      maxWidth: Number($('#setMaxWidth').value) || 0
    });
    bus.action('calibration.set', { patch: { sourceSize: { w: dim.w, h: dim.h } } });
    $('#stageEmpty').style.display = 'none';
    $('#capInfo').textContent = `${dim.w}×${dim.h}`;
    previewOffDrawn = false;
    toast('Capture started');
  } catch (err) {
    toast(`Capture cancelled: ${err.message}`);
  }
};

$('#btnStopCapture').onclick = () => {
  vision.stop();
  capture.stop();
  $('#stageEmpty').style.display = '';
  $('#capInfo').textContent = 'no source';
};

/**
 * Two ways to run: everything on one machine, or capture on the machine showing the
 * game while the operator works on another. Both are first-class, and the operator
 * picks which one this panel is driving rather than having to infer it.
 *
 *   auto  — local capture if this device has one, otherwise the connected node
 *   local — always this device
 *   node  — always the capture node
 */
function captureMode() {
  return $('#captureMode') ? $('#captureMode').value : 'auto';
}

/** Which engine this panel is currently in charge of. */
function activeTarget() {
  const mode = captureMode();
  if (mode === 'local') return 'local';
  if (mode === 'node') return 'node';
  return capture.active ? 'local' : (nodeFresh() ? 'node' : 'local');
}

$('#btnVision').onclick = () => {
  const target = activeTarget();

  if (target === 'local') {
    if (!capture.active) return toast(t('Pick the game window on this device first'));
    if (vision.running) {
      vision.stop();
    } else {
      const v = state && state.vision;
      if (v && v.active && v.owner && v.owner !== bus.clientId) {
        if (!confirm(`Detection is already running on "${v.ownerLabel || v.owner}".\n\nStart here too? Laps would be counted twice.`)) return;
      }
      bus.action('vision.status', { patch: { owner: bus.clientId, ownerLabel: 'operator panel' } });
      vision.start();
    }
    renderVisionButton();
    return;
  }

  // target === 'node'
  if (nodeStatus && nodeFresh()) {
    if (!nodeStatus.hasCapture) {
      return toast(`${nodeStatus.label} has no game window selected yet — pick it once on that machine`);
    }
    bus.signal('node-control', { to: nodeStatus.id, action: nodeStatus.running ? 'stop' : 'start' });
    toast(nodeStatus.running ? `Stopping detection on ${nodeStatus.label}` : `Starting detection on ${nodeStatus.label}`);
    return;
  }

  toast('Tidak ada capture node yang terhubung');
};

/** Reflects whichever engine this button currently controls: local or remote. */
function renderVisionButton() {
  const btn = $('#btnVision');
  if (!btn) return;
  const target = activeTarget();

  // the window picker is only meaningful when this device is the one capturing
  const cap = $('#btnCapture');
  if (cap) {
    cap.disabled = target === 'node';
    cap.title = target === 'node' ? 'Panel sedang mengendalikan capture node' : '';
  }

  if (target === 'local') {
    if (!capture.active) {
      btn.textContent = 'Start AI detection';
      btn.classList.remove('on');
      btn.disabled = true;
      setHint(nodeFresh()
        ? 'Mode <b>This device</b>: pilih window game di perangkat ini. Ada capture node terhubung juga, pilih <b>Capture node</b> kalau mau memakai itu.'
        : t('Pick the game window on this device with') + ' <b>' + t('Select emulator window') + '</b>.');
      return;
    }
    btn.textContent = vision.running ? 'Stop AI detection' : 'Start AI detection';
    btn.classList.toggle('on', vision.running);
    btn.disabled = false;
    setHint('Deteksi berjalan <b>di perangkat ini</b>, memakai window yang kamu bagikan.');
    return;
  }

  if (nodeStatus && nodeFresh()) {
    btn.disabled = false;
    btn.classList.toggle('on', !!nodeStatus.running);
    btn.textContent = nodeStatus.running
      ? `Stop detection on ${nodeStatus.label}`
      : `Start detection on ${nodeStatus.label}`;
    setHint(nodeStatus.hasCapture
      ? `Detection runs on <b>${esc(nodeStatus.label)}</b> — the only machine that can see the game window. This button controls it from here.`
      : `<b>${esc(nodeStatus.label)}</b> is connected but has no game window selected. Do that once on that machine, then start detection from here.`);
    return;
  }

  btn.textContent = 'Start AI detection';
  btn.classList.remove('on');
  btn.disabled = true;
  setHint('Belum ada capture di perangkat ini dan tidak ada capture node terhubung. Bagikan window di sini, atau buka <code>/node.html</code> di mesin yang menampilkan game.');
}

function setHint(html) {
  const el = $('#visionSourceHint');
  if (!el) return;
  el.innerHTML = html;
  el.style.display = html ? '' : 'none';
}

// --- ROI drawing

// Calibration writes happen faster than the server can echo them back, so update the
// local copy optimistically — otherwise two quick clicks both build on stale state.
function setCalibration(patch) {
  Object.assign(state.calibration, patch);
  bus.action('calibration.set', { patch });
}

let previewOffDrawn = false;

/** The picture under the region overlay: the local feed, or a remote node's snapshot. */
function drawPreviewBase() {
  sizeCanvases();
  const W = preview.width, H = preview.height;
  if (!W || !H) return;
  pctx.clearRect(0, 0, W, H);

  if (capture.active) {
    pctx.drawImage(capture.video, 0, 0, W, H);
    return;
  }
  if (!remoteFresh()) {
    if (remotePreview.img) {
      pctx.fillStyle = '#0e1015';
      pctx.fillRect(0, 0, W, H);
      pctx.fillStyle = 'rgba(255,255,255,.45)';
      pctx.font = '600 13px Inter, sans-serif';
      pctx.textAlign = 'center';
      pctx.fillText(`No frames from ${remotePreview.label}`, W / 2, H / 2);
      pctx.font = '500 11px Inter, sans-serif';
      pctx.fillStyle = 'rgba(255,255,255,.28)';
      pctx.fillText('check the capture node window is still running', W / 2, H / 2 + 20);
      pctx.textAlign = 'left';
    }
    return;
  }

  pctx.drawImage(remotePreview.img, 0, 0, W, H);
  pctx.fillStyle = 'rgba(0,0,0,.55)';
  pctx.fillRect(0, 0, 214, 20);
  pctx.fillStyle = 'rgba(255,255,255,.78)';
  pctx.font = '600 11px Inter, sans-serif';
  pctx.fillText(`remote preview — ${remotePreview.label}`, 6, 14);
  $('#stageEmpty').style.display = 'none';
}

function drawPreviewOff() {
  if (previewOffDrawn) return;
  previewOffDrawn = true;
  sizeCanvases();
  pctx.clearRect(0, 0, preview.width, preview.height);
  rctx.clearRect(0, 0, roiLayer.width, roiLayer.height);
  // with no capture running the empty-state card already explains itself
  if (!capture.active) return;
  pctx.fillStyle = '#0e1015';
  pctx.fillRect(0, 0, preview.width, preview.height);
  pctx.fillStyle = 'rgba(255,255,255,.45)';
  pctx.font = '600 13px Inter, sans-serif';
  pctx.textAlign = 'center';
  pctx.fillText('Preview off — detection is still running', preview.width / 2, preview.height / 2);
  pctx.font = '500 11px Inter, sans-serif';
  pctx.fillStyle = 'rgba(255,255,255,.28)';
  pctx.fillText('turn it back on to draw or check regions', preview.width / 2, preview.height / 2 + 20);
  pctx.textAlign = 'left';
}

/** What the capture is actually costing, in numbers the operator can act on. */
/** Is the detector actually finding each car? The question every "it is not working" starts with. */
function renderTracking() {
  const box = $('#trackStats');
  if (!box || !state) return;

  const local = capture.active;
  const rows = state.drivers.slice(0, 12).map((d) => {
    const t = remoteTracked.find((x) => x.id === d.id);
    const seen = local
      ? !!d.trackedAt && Date.now() - d.trackedAt < 2000
      : (t ? t.seen : false);
    const blob = remoteBlobs.find((b) => b.driverId === d.id);
    const prog = Math.round((d.progress || 0) * 100);
    return `<div class="urlrow" style="padding:6px 10px">
      <span class="swatch" style="background:${d.color};height:16px"></span>
      <b style="min-width:110px">${esc(d.name)}</b>
      <span class="pill ${seen ? 'live' : ''}">${seen ? 'seen' : 'not found'}</span>
      <code style="flex:1">${blob ? `${blob.n}px · ` : ''}lap ${prog}%${d.speed ? ` · moving` : ' · still'}</code>
    </div>`;
  }).join('');

  // Distinguish 'the detector saw nothing' from 'it saw movement it could not name'.
  // Those need completely different fixes and used to look identical from here.
  const unnamed = (capture.active ? vision.debug.unnamed : (remoteTracked.unnamed || 0)) | 0;
  const note = unnamed
    ? '<div class="hint" style="margin-top:8px;color:var(--yellow)"><b>' + unnamed + ' gerakan terdeteksi tapi warnanya tidak cocok pembalap mana pun.</b> ' +
      'Ambil ulang warnanya lewat <b>Pick car colour from the image</b>, atau naikkan Colour tolerance.</div>'
    : '';
  const html = (rows || '<div class="hint">No drivers in the roster yet.</div>') + note;
  if (box.dataset.sig !== html) { box.dataset.sig = html; box.innerHTML = html; }
}

function renderPerf() {
  const el = $('#perfStats');
  if (!el || !$('#page-vision').classList.contains('on')) return;

  const s = capture.trackSettings();
  const full = capture.width * capture.height;
  const copied = capture.copiedPixels;
  const saving = full && copied ? (1 - copied / full) * 100 : 0;

  $('#perfPill').textContent = vision.running ? `${vision.fps} fps` : 'idle';
  if (!capture.active) {
    $('#capInfo').textContent = remoteFresh() ? `remote · ${remotePreview.label}` : 'no source';
  }
  const line = [
    s ? `Capture <b>${s.width}×${s.height}</b> @ <b>${Math.round(s.frameRate || 0)}fps</b>` : 'No capture source',
    vision.running ? `Detection <b>${vision.fps}</b> of ${vision.targetFps} fps` : 'Detection idle',
    (state && state.vision.sourceFps != null)
      ? `Frames delivered by the capture <b>${state.vision.sourceFps}/s</b>` +
        (state.vision.sourceFps < 8 ? ' — the source is the bottleneck, not the detector' : '')
      : '',
    // Which estimator is driving the pins, and whether the circuit has been worked out.
    state && state.vision.circuit
      ? `Circuit learned — <b>${state.vision.circuit}</b> segments, tracking cars <b>along the track</b>`
      : (state && state.vision.active
          ? 'Circuit not learned yet — tracking cars on the plane. It is worked out from the first full lap a car drives.'
          : ''),
    copied
      ? `Pixels read per frame <b>${(copied / 1000).toFixed(0)}k</b> of ${(full / 1000).toFixed(0)}k — <b>${saving.toFixed(1)}%</b> of the frame never touched`
      : (state && (state.calibration.rois || []).length
          ? 'Regions are calibrated but detection is not running'
          : 'No regions calibrated yet'),
    `Preview ${previewFps ? previewFps + ' fps' : '<b>off</b>'}`
  ];
  const html = line.join('<br>');
  if (el.dataset.sig !== html) { el.dataset.sig = html; el.innerHTML = html; }
}

/**
 * The race clock.
 *
 * This used to be updated inside the preview loop, which was fine until that loop
 * learned to skip itself when the Vision page is closed — at which point the clock
 * froze on every other page, including the one it lives on. It has nothing to do with
 * the preview, so it gets its own ticker.
 */
function tickClock() {
  const el = $('#raceClock');
  if (!el || !state) return;
  const text = fmtClock(raceElapsed(state));
  if (el.textContent !== text) el.textContent = text;
}

setInterval(tickClock, 200);

// Driven by a timer rather than rAF: a hidden tab has no animation frames at all,
// and the health banner is precisely what should keep working when that happens.
setInterval(() => { renderPerf(); renderHealth(); renderVisionButton(); renderTracking(); }, 500);

function pointerNorm(ev) {
  const r = roiLayer.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)),
    y: Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height))
  };
}

roiLayer.addEventListener('pointerdown', (ev) => {
  const p = pointerNorm(ev);
  const tool = $('#roiTool').value;

  // Sampling the colour straight off the frame beats guessing it in a colour picker:
  // what matters is the pixel value after the game, the encoder and the scaler have
  // all had their say, not the colour the car nominally is.
  if ($('#editMode').value === 'pick') {
    const id = pickDriverId;
    if (!id) return toast('Pilih pembalapnya dulu di bawah gambar');
    const x = Math.round(p.x * preview.width);
    const y = Math.round(p.y * preview.height);
    const px = pctx.getImageData(Math.max(0, x), Math.max(0, y), 1, 1).data;
    if (px[3] === 0) return toast('Tidak ada gambar di titik itu');
    const hex = '#' + [px[0], px[1], px[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
    bus.action('driver.update', { id, patch: { color: hex } });

    // Setting a whole grid is one pick per car, so move to the next one automatically.
    // Re-picking is still just a click on that driver's chip.
    const order = state.drivers;
    const at = order.findIndex((x2) => x2.id === id);
    const next = order[at + 1];
    pickDriverId = next ? next.id : id;
    renderPickChips();
    toast(next
      ? `${order[at].name} → ${hex} · berikutnya ${next.name}`
      : `${order[at].name} → ${hex} · semua pembalap selesai`);
    return;
  }

  // Timing lines are drawn as two clicks rather than a drag: a line needs its two
  // ends placed precisely across the track, which a rubber-band rectangle cannot do.
  if (tool === 'finish' || tool === 'sector') {
    if (!pendingLine) {
      pendingLine = { a: p };
      toast('Now click the other side of the track');
      return;
    }
    const a = pendingLine.a;
    pendingLine = null;
    if (Math.hypot(p.x - a.x, p.y - a.y) < 0.01) return toast('Line too short');
    const existing = (state.calibration.lines || []).filter((l) => l.kind === tool);
    if (tool === 'finish' && existing.length) {
      bus.action('line.remove', { id: existing[0].id });   // only one finish line
    }
    bus.action('line.set', {
      line: {
        id: `l${Date.now().toString(36)}`,
        kind: tool,
        index: tool === 'finish' ? 0 : existing.length + 1,
        name: tool === 'finish' ? 'Finish line' : `Sector ${existing.length + 1}`,
        a, b: p,
        dir: 0,        // 0 = accept both ways until the first crossing teaches it
        learn: true
      }
    });
    toast(tool === 'finish' ? 'Finish line set' : 'Sector line added');
    return;
  }

  if ($('#editMode').value === 'path') {
    const path = [...(state.calibration.trackPath || [])];
    const mm = (state.calibration.rois || []).find((r) => r.type === 'minimap');
    if (!mm) return toast('Draw a minimap region first');
    // store the click in minimap-local coordinates
    path.push({ x: (p.x - mm.x) / mm.w, y: (p.y - mm.y) / mm.h });
    setCalibration({ trackPath: path, minimapRoiId: mm.id });
    return;
  }
  const hit = [...(state.calibration.rois || [])].reverse().find(
    (r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
  );
  if (hit && ev.shiftKey === false && ev.detail === 2) { selectedRoi = hit.id; renderRoiList(); return; }
  drawing = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
  roiLayer.setPointerCapture(ev.pointerId);
});

roiLayer.addEventListener('pointermove', (ev) => {
  if (!drawing) return;
  const p = pointerNorm(ev);
  drawing.x1 = p.x;
  drawing.y1 = p.y;
});

roiLayer.addEventListener('pointerup', () => {
  if (!drawing) return;
  const x = Math.min(drawing.x0, drawing.x1);
  const y = Math.min(drawing.y0, drawing.y1);
  const w = Math.abs(drawing.x1 - drawing.x0);
  const h = Math.abs(drawing.y1 - drawing.y0);
  drawing = null;
  if (w < 0.008 || h < 0.008) return;
  const type = $('#roiTool').value;
  const rois = [...(state.calibration.rois || [])];
  const roi = {
    id: `r${Date.now().toString(36)}`,
    type, x, y, w, h,
    name: `${type} ${rois.filter((r) => r.type === type).length + 1}`,
    driverId: null,
    opts: { scale: 4, invert: false, threshold: 0.55 }
  };
  rois.push(roi);
  selectedRoi = roi.id;
  setCalibration({ rois });
});

$('#btnClearPath').onclick = () => setCalibration({ trackPath: [] });

// Throw away the circuit the detector worked out, so it watches a car draw a new one.
// Needed when the camera angle changes or the first lap was tracked badly: the geometry
// is learned once and then trusted, so a bad one would never correct itself.
$('#btnRelearn').onclick = () => {
  const msg = 'Forget the learned circuit?'
    + '\n\nThe detector will watch a car drive a full lap and work out the shape again.'
    + '\nTiming lines and regions are not touched.';
  if (!confirm(msg)) return;
  setCalibration({ learnedPath: [] });
  toast('Circuit cleared — it will be relearned over the next full lap');
};

// ---------------------------------------------------------------- templates & branding

/*
 * Picking a look, and putting the league's own identity on it.
 *
 * The templates are swatches rather than a dropdown because the choice is visual: a list
 * of ten names tells the operator nothing about what they are choosing between, and this
 * is a decision made once per league by someone looking at the preview beside it.
 */
// The broadcast skin: a shape, chosen separately from the theme's colours.
$$('#skinPick [data-skin]').forEach((b) => {
  b.onclick = () => bus.action('overlay.update', { patch: { skin: b.dataset.skin } });
});
// The WEC skin's header wordmark is operator-set text.
if ($('#wecTitle')) {
  $('#wecTitle').oninput = (e) => bus.action('overlay.update', { patch: { towerTitle: e.target.value } });
}
function renderSkin() {
  if (!state) return;
  const cur = (state.overlay && state.overlay.skin) || 'classic';
  $$('#skinPick [data-skin]').forEach((b) => b.classList.toggle('on', b.dataset.skin === cur));
  // The tower-title field drives the header wordmark on the branded skins (WEC + MotoGP + F1).
  const branded = ['wec', 'motogp', 'f1', 'dtm', 'fe', 'gtwc', 'imsa', 'indycar', 'nascar', 'porsche'].includes(cur);
  if ($('#wecTitleField')) $('#wecTitleField').style.display = branded ? '' : 'none';
  if ($('#wecTitleHint')) $('#wecTitleHint').style.display = branded ? '' : 'none';
  if (branded && $('#wecTitle')) {
    $('#wecTitle').placeholder = cur === 'wec' ? 'WEC' : cur === 'f1' ? 'F1' : cur === 'dtm' ? 'DTM' : cur === 'fe' ? 'RACE' : (cur === 'gtwc' || cur === 'imsa' || cur === 'nascar') ? 'Event name' : 'MOTOGP';
    if (document.activeElement !== $('#wecTitle')) {
      $('#wecTitle').value = (state.overlay && state.overlay.towerTitle) || '';
    }
  }
}

function renderThemes() {
  if (!state || currentPage !== 'layout') return;
  renderSkin();
  renderLooks();
  const cur = state.overlay.theme || 'midnight';

  const grid = $('#themeGrid');
  if (grid && grid.dataset.built !== '1') {
    grid.dataset.built = '1';
    grid.innerHTML = THEMES.map((t) => `
      <button class="themeswatch" data-theme="${t.id}" title="${esc(t.note)}">
        <span class="tsw" data-tsw="${t.id}"><i></i><i></i><i></i></span>
        <b>${esc(t.name)}</b>
      </button>`).join('');
    $$('#themeGrid [data-theme]').forEach((b) => {
      b.onclick = () => {
        const t = THEMES.find((x) => x.id === b.dataset.theme);
        bus.action('overlay.theme', {
          theme: b.dataset.theme,
          accent: t ? t.accent : undefined,
          radius: t ? t.radius : undefined
        });
      };
    });
  }
  $$('#themeGrid [data-theme]').forEach((b) => b.classList.toggle('on', b.dataset.theme === cur));
  const note = $('#themeNote');
  if (note) {
    const t = THEMES.find((x) => x.id === cur);
    note.textContent = t ? t.note : '';
  }

  const b = state.overlay.brand || {};
  const prev = $('#brandPreview');
  if (prev) {
    prev.innerHTML = b.logoUrl ? `<img src="${esc(b.logoUrl)}" alt="">` : 'no logo';
    prev.classList.toggle('has', !!b.logoUrl);
  }
  const nameEl = $('#brandName');
  if (nameEl && document.activeElement !== nameEl) nameEl.value = b.name || '';
  const showEl = $('#brandShow');
  if (showEl && document.activeElement !== showEl) showEl.checked = b.showLogo !== false;
  const pl = $('#brandPlacement');
  if (pl && document.activeElement !== pl) pl.value = b.placement || 'beside';
  const alternate = (b.placement || 'beside') === 'alternate';

  // The timing only means something when the two take turns, so it is hidden rather than
  // left sitting there doing nothing.
  const rotWrap = $('#brandRotateWrap');
  if (rotWrap) rotWrap.style.display = alternate ? '' : 'none';
  const rot = $('#brandRotate');
  if (rot) {
    if (document.activeElement !== rot) rot.value = String(b.rotateSec ?? 6);
    $('#brandRotateVal').textContent = alternate
      ? `${rot.value}s on the flag, then ${rot.value}s on the logo`
      : t('Logo and flag are both on screen the whole time');
  }
}

$('#btnBrandPick').onclick = () => $('#brandFile').click();
$('#brandFile').onchange = async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) return toast('Logo must be under 2MB');
  const dataUrl = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  }).catch(() => null);
  if (!dataUrl) return toast('Could not read that file');
  // Uploaded rather than stored in state: the state goes out over the socket on every
  // timing update, and a logo riding along with it would be sent hundreds of times a race.
  const res = await fetch('/api/brand/logo', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataUrl })
  }).then((r) => r.json()).catch(() => null);
  toast(res && res.ok ? 'Logo updated' : `Upload failed: ${(res && res.error) || 'unknown'}`);
};
$('#btnBrandClear').onclick = async () => {
  if (!confirm('Remove the league logo?')) return;
  await fetch('/api/brand/logo', { method: 'DELETE' }).catch(() => {});
  toast('Logo removed');
};
bindInput('#brandName', (v) => bus.action('brand.update', { patch: { name: v } }));
$('#brandShow').onchange = (e) => bus.action('brand.update', { patch: { showLogo: e.target.checked } });
$('#brandPlacement').onchange = (e) => bus.action('brand.update', { patch: { placement: e.target.value } });
$('#brandRotate').oninput = (e) => {
  $('#brandRotateVal').textContent = `${e.target.value}s on the flag, then ${e.target.value}s on the logo`;
};
$('#brandRotate').onchange = (e) => bus.action('brand.update', { patch: { rotateSec: Number(e.target.value) } });

// ---------------------------------------------------------------- championship

/*
 * The table, and the rounds behind it.
 *
 * Standings are computed on the server so every overlay and every device sees the same
 * arithmetic — a championship table that disagrees between the panel and the broadcast is
 * worse than none. This page only displays it and edits the inputs.
 */
function renderChampionship() {
  if (!state || currentPage !== 'champ') return;
  const c = state.championship || { points: {}, rounds: [] };
  const p = c.points || {};

  /*
   * The report's address, next to the table it reports on.
   *
   * It started on the OBS page beside the Browser Sources, which was the wrong shelf: it is
   * not a source, nobody adds it to a scene, and it was found by people looking for
   * something else. Results belong with results.
   */
  const base = location.origin;
  const evq = cloud ? `?event=${encodeURIComponent(cloud.code)}` : '';
  const reportUrl = `${base}/report.html${evq}`;
  $('#obsReport').textContent = reportUrl;
  $('#btnCopyReport').onclick = () => {
    navigator.clipboard.writeText(reportUrl);
    toast('URL copied');
  };
  $('#btnOpenReport').onclick = () => window.open(reportUrl, '_blank', 'noopener');

  const setVal = (id, v) => { const el = $(id); if (el && document.activeElement !== el) el.value = String(v ?? ''); };
  setVal('#champName', c.name);
  setVal('#champTablePts', (p.table || []).join(','));
  setVal('#champFl', p.fastestLap ?? 0);
  setVal('#champPole', p.pole ?? 0);
  setVal('#champDrop', p.dropWorst ?? 0);

  const roundsEl = $('#champRounds');
  if (roundsEl) roundsEl.textContent = `${c.rounds.length} round${c.rounds.length === 1 ? '' : 's'}`;

  // standings
  const box = $('#champTable');
  if (box) {
    const rows = state.standings || [];
    box.innerHTML = rows.length ? `<table class="drivers"><thead><tr>
        <th style="width:34px">#</th><th></th><th>Driver</th>
        <th style="text-align:right">Rounds</th><th style="text-align:right">Points</th>
      </tr></thead><tbody>` + rows.map((r) => `<tr>
        <td class="mono">${r.rank}</td>
        <td style="width:6px"><span class="swatch" style="background:${r.color || '#666'}"></span></td>
        <td>${esc(r.name)}${r.dropped ? ` <span class="hint">(${r.dropped} dropped)</span>` : ''}</td>
        <td class="mono" style="text-align:right">${r.rounds}</td>
        <td class="mono" style="text-align:right;font-weight:700">${r.points}</td>
      </tr>`).join('') + '</tbody></table>'
      : '<p class="hint">No rounds banked yet. Finish a race, then press <b>Bank current result</b>.</p>';
  }

  // rounds
  const rl = $('#roundList');
  if (rl) {
    rl.innerHTML = c.rounds.length ? '<div class="roundlist">' + c.rounds.map((r) => {
      const top = r.results.slice(0, 3).map((x) => `${x.name} (${x.points})`).join(' · ');
      return `<div class="roundrow">
        <div><b>${esc(r.name)}</b><small>${esc(top)}</small></div>
        <span class="row" style="gap:4px">
          <button class="btn ghost" data-rescore="${r.id}">Rescore</button>
          <button class="btn ghost" data-rename="${r.id}">✎</button>
          <button class="btn ghost" data-rmround="${r.id}">✕</button>
        </span>
      </div>`;
    }).join('') + '</div>' : `<p class="hint">${t('No rounds yet.')}</p>`;

    $$('#roundList [data-rescore]').forEach((b) => {
      b.onclick = () => {
        if (!confirm('Rescore this round with the current points table?\n\nIts stored points are replaced.')) return;
        bus.action('championship.rescore', { id: b.dataset.rescore });
      };
    });
    $$('#roundList [data-rename]').forEach((b) => {
      b.onclick = () => {
        const r = c.rounds.find((x) => x.id === b.dataset.rename);
        const name = prompt('Round name:', r ? r.name : '');
        if (name != null && name.trim()) bus.action('championship.renameRound', { id: b.dataset.rename, name: name.trim() });
      };
    });
    $$('#roundList [data-rmround]').forEach((b) => {
      b.onclick = () => { if (confirm('Remove this round from the championship?')) bus.action('championship.removeRound', { id: b.dataset.rmround }); };
    });
  }

  const from = $('#roundFrom');
  const sig = (state.sessions || []).map((x) => x.id).join('|');
  if (from && from.dataset.sig !== sig) {
    from.dataset.sig = sig;
    from.innerHTML = (state.sessions || []).length
      ? (state.sessions || []).map((x) => `<option value="${x.id}">${esc(x.name)} — ${x.results.length} cars</option>`).join('')
      : `<option value="">— ${t('no classified sessions')} —</option>`;
  }
}

$('#btnRoundAdd').onclick = () => {
  const name = prompt('Name this round:', state?.event.round || `Round ${(state?.championship.rounds.length || 0) + 1}`);
  if (name == null) return;
  bus.action('championship.addRound', { name: name.trim() || undefined });
};
$('#btnRoundFromSession').onclick = () => {
  const id = $('#roundFrom').value;
  if (!id) return toast('No classified session to bank');
  bus.action('championship.addRound', { sessionId: id });
};
$('#champName').onchange = (e) => bus.action('championship.config', { patch: { name: e.target.value } });
$('#champTablePts').onchange = (e) => {
  const table = e.target.value.split(',').map((n) => Number(n.trim())).filter((n) => !Number.isNaN(n));
  bus.action('championship.config', { patch: { points: { table } } });
};
$$('[data-preset]').forEach((b) => {
  b.onclick = () => {
    const table = b.dataset.preset.split(',').map(Number);
    bus.action('championship.config', { patch: { points: { table } } });
  };
});
$('#champFl').onchange = (e) => bus.action('championship.config', { patch: { points: { fastestLap: Number(e.target.value) } } });
$('#champPole').onchange = (e) => bus.action('championship.config', { patch: { points: { pole: Number(e.target.value) } } });
$('#champDrop').onchange = (e) => bus.action('championship.config', { patch: { points: { dropWorst: Number(e.target.value) } } });

$('#btnChampCsv').onclick = () => {
  const rows = state?.standings || [];
  if (!rows.length) return toast('Nothing to export yet');
  const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const out = ['Position,Number,Driver,Rounds,Dropped,Points'];
  for (const r of rows) out.push([r.rank, q(r.num), q(r.name), r.rounds, r.dropped, r.points].join(','));
  downloadText('standings.csv', out.join('\n') + '\n');
  toast(`${rows.length} drivers exported`);
};

// ---------------------------------------------------------------- driver sign-ins

/*
 * Who is asking to join, and the operator's decision about each.
 *
 * Nothing here is automatic on purpose. A sign-in is a stranger typing a number into a
 * phone on the same wifi, and a grid that fills itself from that is a grid anybody
 * walking past can join. Accepting is one tap, which is as cheap as it can be while
 * still being a decision someone made.
 */
function renderRegistrations() {
  if (!state || currentPage !== 'race') return;
  const list = state.registrations || [];
  const waiting = list.filter((r) => r.status === 'pending');

  const count = $('#regCount');
  if (count) {
    count.textContent = waiting.length
      ? `${waiting.length} ${t('waiting')}`
      : (list.length ? `${list.length} ${t('signed in')}` : t('none waiting'));
    count.style.color = waiting.length ? 'var(--accent)' : '';
  }

  const urlEl = $('#regUrl');
  // The address the driver actually types, not the one this browser happens to be on:
  // "localhost" on the operator's PC is useless on a phone.
  //
  // https wins when it exists. Both addresses serve the same page, but Android only
  // allows flag alerts on a secure origin, so handing out the http one costs the drivers
  // their notifications. The certificate warning is the price, and the note says so.
  const net = state.net || {};
  if (urlEl && (net.tls || net.lan)) {
    urlEl.textContent = `${net.tls || net.lan}/driver.html`;
    const warn = $('#regUrlNote');
    if (warn) warn.hidden = !net.tls;
  }

  const box = $('#regList');
  if (!box) return;
  box.innerHTML = list.length ? '<div class="reglist">' + list.slice(0, 20).map((r) => {
    const when = new Date(r.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `<div class="regrow ${r.status}">
      <div><b>${esc(r.nick)}</b> <span class="rnum">#${esc(r.num)}</span>${r.team ? `<span class="rteam">${esc(r.team)}</span>` : ''}<small>${when}</small></div>
      <span class="row" style="gap:4px">
        ${r.status === 'pending'
          ? `<button class="btn primary" data-acc="${r.id}">Accept</button><button class="btn ghost" data-rej="${r.id}">No</button>`
          : `<span class="pstatus">${r.status}</span><button class="btn ghost" data-regdel="${r.id}">✕</button>`}
      </span>
    </div>`;
  }).join('') + '</div>' : `<p class="hint">${t('Nobody has signed in yet.')}</p>`;

  $$('#regList [data-acc]').forEach((b) => { b.onclick = () => bus.action('registration.approve', { id: b.dataset.acc }); });
  $$('#regList [data-rej]').forEach((b) => { b.onclick = () => bus.action('registration.reject', { id: b.dataset.rej }); });
  $$('#regList [data-regdel]').forEach((b) => {
    b.onclick = () => { if (confirm('Remove this sign-in from the list?')) bus.action('registration.remove', { id: b.dataset.regdel }); };
  });
}

// ---------------------------------------------------------------- race control

/*
 * Stewarding, kept visible.
 *
 * A decision nobody can see, explain or reverse is one nobody will accept. So every
 * penalty carries a reason that goes out on the broadcast, keeps the lap it happened on,
 * and can be dropped — and an open investigation is listed separately, because the thing
 * an operator most needs to know at any moment is what is still undecided.
 */
const PEN_KIND = { time: 'Time', warning: 'Warning', drivethrough: 'Drive through', blackflag: 'Black flag', dq: 'DQ', note: 'Note' };

function renderRaceControl() {
  if (!state || currentPage !== 'race') return;
  const pens = state.race.penalties || [];
  const open = pens.filter((p) => p.status === 'investigating');

  const count = $('#penCount');
  if (count) {
    count.textContent = open.length ? `${open.length} under investigation` : 'nothing open';
    count.style.color = open.length ? '#ffd60a' : '';
  }

  const sel = $('#penDriver');
  const sig = state.drivers.map((d) => d.id + d.name).join('|');
  if (sel && sel.dataset.sig !== sig) {
    sel.dataset.sig = sig;
    const cur = sel.value;
    sel.innerHTML = state.drivers.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('');
    if (cur) sel.value = cur;
  }

  const rules = state.race.rules || {};
  const setChk = (id, v) => { const el = $(id); if (el && document.activeElement !== el) el.checked = !!v; };
  const setNum = (id, v) => { const el = $(id); if (el && document.activeElement !== el) el.value = String(v); };
  const fl = state.race.flags || {};
  setChk('#flAuto', fl.auto);
  setChk('#flYellow', fl.yellowOnStopped !== false);
  setChk('#flBlue', fl.blue !== false);
  setChk('#flCheq', fl.chequered !== false);
  setNum('#flRed', fl.redStoppedCount ?? 3);
  setNum('#flGreen', fl.greenAfterSec ?? 5);
  setNum('#flBlack', fl.blackFlagUnserved ?? 3);
  const raises = $('#flRaises');
  if (raises && document.activeElement !== raises) raises.value = fl.stoppedRaises || 'yellow';

  /*
   * Who is holding the flag, stated plainly. An operator who has taken manual control and
   * forgotten will wonder why the yellow they expected never appeared, and the answer is
   * one line of text away.
   */
  const owner = $('#flagOwner');
  if (owner) {
    const manual = state.race.flagSource === 'operator';
    owner.innerHTML = manual
      ? '<b style="color:#ffd60a">Flag held manually</b> — automatic flags are standing by'
      : t(fl.auto ? 'Flags are automatic — setting one by hand takes control'
                  : 'Automatic flags are off');
  }
  const rel = $('#btnFlagRelease');
  if (rel) rel.disabled = state.race.flagSource !== 'operator';

  /*
   * The logo toggle lives here as well as on the Layout page, because this is the page
   * the operator is actually on while broadcasting. Layout is where branding is set up
   * once; Race control is where it is switched during a session.
   */
  const bt = $('#btnBrandToggle');
  if (bt) {
    const b = state.overlay.brand || {};
    const has = !!(b.logoUrl || b.name);
    const on = has && b.showLogo !== false;
    bt.textContent = t(on ? 'Logo on' : 'Show logo');
    bt.classList.toggle('primary', on);
    bt.disabled = !has;
    bt.title = has
      ? 'Alternate the league logo with the flag in the status bar'
      : 'Add a logo or league name on the Layout page first';
  }

  setChk('#ruJump', rules.jumpStart);
  setChk('#ruLimits', rules.trackLimits);
  setChk('#ruAuto', rules.autoApply);
  setNum('#ruAllowed', rules.trackLimitsAllowed ?? 3);
  setNum('#ruSecs', rules.trackLimitsSeconds ?? 5);

  const name = (id) => (state.drivers.find((d) => d.id === id) || {}).name || '—';
  const box = $('#penList');
  if (!box) return;
  const rows = pens.slice(0, 12);
  box.innerHTML = rows.length ? '<div class="penlist">' + rows.map((p) => `
    <div class="penrow ${p.status}">
      <span class="pdrv">${esc(name(p.driverId))}</span>
      <span class="pkind">${PEN_KIND[p.type] || p.type}${p.type === 'time' && p.seconds ? ` +${p.seconds}s` : ''}</span>
      <span class="preason">${esc(p.reason)}${p.auto ? ' <i>auto</i>' : ''}</span>
      <span class="row" style="gap:4px">
        ${p.status === 'investigating'
          ? `<button class="btn" data-apply="${p.id}">Apply</button><button class="btn ghost" data-drop="${p.id}">No action</button>`
          : p.status === 'applied' && ['drivethrough', 'blackflag'].includes(p.type) && !p.served
            // Only the penalties a driver physically serves get this: a time penalty is
            // added to the result, there is nothing for anyone to carry out.
            ? `<button class="btn" data-serve="${p.id}">Served</button>`
            : `<span class="pstatus">${p.status === 'applied' ? (p.served ? 'served' : 'applied') : 'no action'}</span>`}
        <button class="btn ghost" data-del="${p.id}">✕</button>
      </span>
    </div>`).join('') + '</div>'
    : '<p class="hint">No decisions yet.</p>';

  $$('#penList [data-apply]').forEach((b) => { b.onclick = () => bus.action('penalty.resolve', { id: b.dataset.apply }); });
  $$('#penList [data-drop]').forEach((b) => { b.onclick = () => bus.action('penalty.resolve', { id: b.dataset.drop, drop: true }); });
  $$('#penList [data-serve]').forEach((b) => { b.onclick = () => bus.action('penalty.serve', { id: b.dataset.serve }); });
  $$('#penList [data-del]').forEach((b) => {
    b.onclick = () => { if (confirm('Delete this record entirely?')) bus.action('penalty.remove', { id: b.dataset.del }); };
  });
}

$('#penAdd').onclick = () => {
  const driverId = $('#penDriver').value;
  if (!driverId) return toast('Pick a driver');
  const reason = $('#penReason').value.trim();
  if (!reason) return toast('A penalty needs a reason — it goes out on the broadcast');
  bus.action('penalty.add', {
    driverId,
    kind: $('#penKind').value,
    seconds: Number($('#penSecs').value) || 0,
    reason
  });
  $('#penReason').value = '';
};
$('#btnBrandToggle').onclick = () => {
  const b = state?.overlay.brand || {};
  bus.action('brand.update', { patch: { showLogo: b.showLogo === false } });
};
$('#btnFlagRelease').onclick = () => bus.action('flags.release');
$('#flAuto').onchange = (e) => bus.action('flags.update', { patch: { auto: e.target.checked } });
$('#flYellow').onchange = (e) => bus.action('flags.update', { patch: { yellowOnStopped: e.target.checked } });
$('#flBlue').onchange = (e) => bus.action('flags.update', { patch: { blue: e.target.checked } });
$('#flCheq').onchange = (e) => bus.action('flags.update', { patch: { chequered: e.target.checked } });
$('#flRaises').onchange = (e) => bus.action('flags.update', { patch: { stoppedRaises: e.target.value } });
$('#flBlack').onchange = (e) => bus.action('flags.update', { patch: { blackFlagUnserved: Number(e.target.value) } });
$('#flRed').onchange = (e) => bus.action('flags.update', { patch: { redStoppedCount: Number(e.target.value) } });
$('#flGreen').onchange = (e) => bus.action('flags.update', { patch: { greenAfterSec: Number(e.target.value) } });

$('#ruJump').onchange = (e) => bus.action('rules.update', { patch: { jumpStart: e.target.checked } });
$('#ruLimits').onchange = (e) => bus.action('rules.update', { patch: { trackLimits: e.target.checked } });
$('#ruAuto').onchange = (e) => bus.action('rules.update', { patch: { autoApply: e.target.checked } });
$('#ruAllowed').onchange = (e) => bus.action('rules.update', { patch: { trackLimitsAllowed: Number(e.target.value) } });
$('#ruSecs').onchange = (e) => bus.action('rules.update', { patch: { trackLimitsSeconds: Number(e.target.value) } });

// ---------------------------------------------------------------- VOD markers

/*
 * Turning a night's broadcast into an edit list, while it happens.
 *
 * Nothing here detects anything new. Every moment worth cutting to is already found and
 * already timestamped — the work is only to express those times relative to when the
 * recording started, which is the one form a video editor can act on. Scrolling two hours
 * of footage looking for the overtake you know happened is the job this removes.
 */
const MARK_LABEL = {
  overtake: 'Overtake', fastest: 'Fastest lap', pit: 'Pit stop',
  stopped: 'Stopped on track', sector: 'Sector best', flag: 'Flag',
  battle: 'Battle', note: 'Note'
};

/** mm:ss for short recordings, h:mm:ss once it runs over the hour. */
function stamp(ms) {
  const t = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

function markerRows() {
  const rec = state?.recording;
  if (!rec || !rec.markers.length) return [];
  // The anchor is the operator's click; the nudge corrects for it landing a moment either
  // side of the one in OBS.
  const zero = (rec.startedAt || rec.markers[0].t) + (rec.offsetMs || 0);
  return rec.markers.map((m, i) => ({ ...m, index: i, at: m.t - zero }));
}

function renderMarkers() {
  if (!state || currentPage !== 'race') return;
  const rec = state.recording || { markers: [] };
  const on = !!rec.startedAt;

  const pill = $('#recState');
  if (pill) {
    pill.textContent = on ? `${t('recording')} · ${rec.markers.length} ${t('marks')}` : `${rec.markers.length} ${t('marks')}`;
    pill.style.color = on ? 'var(--accent)' : '';
  }
  const off = $('#recOffset');
  if (off) {
    if (document.activeElement !== off) off.value = String(rec.offsetMs || 0);
    const v = Number(off.value);
    $('#recOffsetVal').textContent = v === 0
      ? 'markers land exactly where the clock says'
      : `markers shifted ${v > 0 ? 'later' : 'earlier'} by ${(Math.abs(v) / 1000).toFixed(2)}s`;
  }

  const box = $('#markerList');
  if (!box) return;
  const rows = markerRows().slice(-14).reverse();
  box.innerHTML = rows.length
    ? '<div class="marklist">' + rows.map((m) => `
        <div class="markrow">
          <span class="mtime">${stamp(m.at)}</span>
          <span class="mkind ${m.manual ? 'manual' : ''}">${MARK_LABEL[m.kind] || m.kind}</span>
          <span class="mtext">${esc(m.text)}</span>
          <button class="btn ghost" data-mark="${m.index}">✕</button>
        </div>`).join('') + '</div>'
    : '<p class="hint">No markers yet.</p>';

  $$('#markerList [data-mark]').forEach((b) => {
    b.onclick = () => bus.action('marker.remove', { index: Number(b.dataset.mark) });
  });
}

/** Hand the operator a file rather than a text box to copy out of. */
function downloadText(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

$('#btnRecStart').onclick = () => {
  if ((state?.recording?.markers || []).length &&
      !confirm('Start a new marker list?\n\nThe markers already gathered are cleared. Export them first if you still need them.')) return;
  bus.action('recording.start');
};
$('#btnRecStop').onclick = () => bus.action('recording.stop');
$('#btnMarkNow').onclick = () => {
  const text = prompt('What happened?', 'Highlight');
  if (text == null) return;
  bus.action('marker.add', { text: text.trim() || 'Highlight' });
};
$('#btnMarkClear').onclick = () => {
  if (!confirm('Delete every marker?')) return;
  bus.action('recording.clear');
};
/*
 * The label updates from the slider itself, not from a full re-render.
 *
 * Rendering writes the stored value back into the slider, so calling it from the
 * slider's own input handler overwrites the value the operator is dragging before the
 * change event can read it. It survived by accident while the slider had focus and
 * failed the moment anything else moved it.
 */
$('#recOffset').oninput = (e) => {
  const v = Number(e.target.value);
  $('#recOffsetVal').textContent = v === 0
    ? 'markers land exactly where the clock says'
    : `markers shifted ${v > 0 ? 'later' : 'earlier'} by ${(Math.abs(v) / 1000).toFixed(2)}s`;
};
$('#recOffset').onchange = (e) => bus.action('recording.offset', { ms: Number(e.target.value) });

$('#btnExpChapters').onclick = () => {
  const rows = markerRows();
  if (!rows.length) return toast('No markers to export');
  /*
   * YouTube's rules, which are strict and silently ignored if broken: the list must start
   * at 0:00, chapters must be in order, and there must be at least three of them. So a
   * title card is prepended rather than hoping the first event lands on zero.
   */
  const lines = ['0:00 ' + (state.event.name || 'Start')];
  for (const m of rows) lines.push(`${stamp(m.at)} ${m.text}`);
  downloadText('chapters.txt', lines.join('\n') + '\n');
  toast(`${rows.length + 1} chapters exported`);
};

$('#btnExpCsv').onclick = () => {
  const rows = markerRows();
  if (!rows.length) return toast('No markers to export');
  const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const out = ['Timecode,Seconds,Type,Description'];
  for (const m of rows) {
    out.push([stamp(m.at), (m.at / 1000).toFixed(2), q(MARK_LABEL[m.kind] || m.kind), q(m.text)].join(','));
  }
  downloadText('markers.csv', out.join('\n') + '\n');
  toast(`${rows.length} markers exported`);
};

/** HH:MM:SS,mmm timecode (SRT uses a comma before the milliseconds). */
function srtTime(ms) {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3600000), m = Math.floor((t % 3600000) / 60000);
  const s = Math.floor((t % 60000) / 1000), mmm = t % 1000;
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(mmm, 3)}`;
}

/*
 * A subtitle track of the highlights: every marker becomes a caption at its timecode, so
 * dropping this one file onto the video labels the whole broadcast. It is the one export an
 * editor can import into any tool (and YouTube), and the only one that annotates the footage
 * itself rather than just listing times.
 */
$('#btnExpSrt').onclick = () => {
  const rows = markerRows().filter((m) => m.at + 3000 > 0);   // drop anything wholly before 0:00
  if (!rows.length) return toast('No markers to export');
  const HOLD = 3000, GAP = 100;   // each caption shows ~3s, but ends before the next one starts
  const out = [];
  rows.forEach((m, i) => {
    const inMs = Math.max(0, m.at);
    let outMs = inMs + HOLD;
    // End before the next caption whenever there is room; only fall back to a short cue when
    // two events nearly coincide (a multi-car incident), so cues do not overlap.
    const next = rows[i + 1];
    if (next) outMs = Math.min(outMs, next.at - GAP);
    if (outMs <= inMs) outMs = inMs + 200;
    const label = MARK_LABEL[m.kind] || m.kind;
    const text = m.text ? `${label}: ${m.text}` : label;
    out.push(String(i + 1), `${srtTime(inMs)} --> ${srtTime(outMs)}`, text, '');
  });
  downloadText('highlights.srt', out.join('\n') + '\n');
  toast(`${rows.length} captions exported`);
};

// Highlight reel: a cut sheet of the best moments only — each becomes a clip with a few
// seconds of lead-in and run-out, ready to drop on a timeline. Crashes and overtakes first.
const REEL_KINDS = new Set(['overtake', 'stopped', 'fastest', 'battle', 'flag']);
const REEL_RANK = { stopped: 0, overtake: 1, battle: 2, fastest: 3, flag: 4, note: 5 };
$('#btnExpReel').onclick = () => {
  const pre = 6000, post = 4000;   // ms of pad around each moment
  const rows = markerRows().filter((m) => m.manual || REEL_KINDS.has(m.kind));
  if (!rows.length) return toast('No highlights to export');
  const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const out = ['#,In,Out,Duration,Type,Description'];
  const sorted = [...rows].sort((a, b) => (REEL_RANK[a.kind] ?? 9) - (REEL_RANK[b.kind] ?? 9) || a.at - b.at);
  sorted.forEach((m, i) => {
    const inMs = Math.max(0, m.at - pre), outMs = m.at + post;
    out.push([i + 1, stamp(inMs), stamp(outMs), ((outMs - inMs) / 1000).toFixed(1) + 's', q(MARK_LABEL[m.kind] || m.kind), q(m.text)].join(','));
  });
  downloadText('highlight-reel.csv', out.join('\n') + '\n');
  toast(`${sorted.length} ${t('highlight clips exported')}`);
};

// ---------------------------------------------------------------- event scenes

/*
 * Scene switching, and the one thing that makes it usable live: clicking a scene puts it
 * on air immediately.
 *
 * There is no preview/program split here. A second stage would be more powerful and much
 * slower to operate, and a one-person broadcast is already doing timing, judging and
 * commentary. What the operator needs at 20:00 on a Saturday is a row of buttons where
 * the one they press is the one the viewer sees.
 */
const WIDGET_LABELS = {
  status: 'Status bar', leaderboard: 'Leaderboard', tower: 'Timing tower',
  lowerThird: 'Lower third', gap: 'Gap bar', results: 'Results',
  trackmap: 'Track map', battle: 'Tandem battle', bracket: 'Bracket',
  grid: 'Starting grid', h2h: 'Head to head', standings: 'Standings'
};

function renderScenes() {
  if (!state) return;
  const o = state.overlay;
  const scenes = o.scenes || [];

  // The name tags update everywhere, always — the heavy list only while it is on screen.
  // Rebuilding the toggles on every state push would also fight the operator's own click.
  const live0 = scenes.find((sc) => sc.id === o.activeScene);
  for (const sel of ['#sceneLiveName', '#layoutScene', '#overlayScene']) {
    const el = $(sel);
    if (el) el.textContent = live0 ? live0.name : '--';
  }
  if (currentPage !== 'event') return;

  const box = $('#sceneList');
  if (box) {
    box.innerHTML = scenes.map((sc, i) => {
      const on = sc.id === o.activeScene;
      const widgets = Object.entries(sc.show || {}).filter(([, v]) => v)
        .map(([k]) => WIDGET_LABELS[k] || k).join(' · ') || 'nothing shown';
      return `<div class="scenerow ${on ? 'live' : ''}" data-scene="${sc.id}">
        <div class="scenemain">
          <b>${esc(sc.name)}</b>
          <small>${esc(widgets)}</small>
        </div>
        <span class="row" style="gap:4px">
          ${on ? `<span class="onair">${t('ON AIR')}</span>` : ''}
          <button class="btn ghost" data-up="${sc.id}" data-to="${i - 1}" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="btn ghost" data-up="${sc.id}" data-to="${i + 1}" ${i === scenes.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="btn ghost" data-ren="${sc.id}">✎</button>
          <button class="btn ghost" data-del="${sc.id}" ${scenes.length <= 1 ? 'disabled' : ''}>✕</button>
        </span>
      </div>`;
    }).join('');

    $$('#sceneList .scenemain').forEach((el) => {
      el.onclick = () => bus.action('scene.select', { id: el.parentElement.dataset.scene });
    });
    $$('#sceneList [data-up]').forEach((b) => {
      b.onclick = () => bus.action('scene.reorder', { id: b.dataset.up, to: Number(b.dataset.to) });
    });
    $$('#sceneList [data-ren]').forEach((b) => {
      b.onclick = () => {
        const sc = scenes.find((x) => x.id === b.dataset.ren);
        const name = prompt('Scene name:', sc ? sc.name : '');
        if (name != null && name.trim()) bus.action('scene.rename', { id: b.dataset.ren, name: name.trim() });
      };
    });
    $$('#sceneList [data-del]').forEach((b) => {
      b.onclick = () => {
        const sc = scenes.find((x) => x.id === b.dataset.del);
        if (!confirm(`Delete the scene "${sc ? sc.name : ''}"?\n\nIts layout is lost. Other scenes are untouched.`)) return;
        bus.action('scene.remove', { id: b.dataset.del });
      };
    });
  }

  const live = live0;

  const wbox = $('#sceneWidgets');
  if (wbox && live) {
    wbox.innerHTML = Object.keys(WIDGET_LABELS).map((k) => `
      <label class="toggle">
        <span>${WIDGET_LABELS[k]}</span>
        <input type="checkbox" data-scenewidget="${k}" ${live.show[k] ? 'checked' : ''}><i class="sw"></i>
      </label>`).join('');
    $$('#sceneWidgets [data-scenewidget]').forEach((el) => {
      el.onchange = () => bus.action('overlay.update', {
        patch: { show: { [el.dataset.scenewidget]: el.checked } }
      });
    });
  }

  const slider = $('#sceneTrans');
  if (slider) {
    const ms = o.transitionMs ?? 420;
    if (document.activeElement !== slider) slider.value = String(ms);
    $('#sceneTransVal').textContent = `${ms} ${t('ms cross-fade when a scene changes')}`;
  }
  if ($('#sceneStinger') && document.activeElement !== $('#sceneStinger')) $('#sceneStinger').checked = o.stinger !== false;
}

$('#btnSceneAdd').onclick = () => {
  const name = prompt('Name the new scene:', 'New scene');
  if (name == null) return;
  bus.action('scene.add', { name: name.trim() || 'New scene' });
};
if ($('#btnSceneRebuild')) $('#btnSceneRebuild').onclick = () => {
  if (confirm(t('Replace all scenes with the clean default set? Your current scene arrangement is lost.'))) {
    bus.action('scene.rebuild');
    toast(t('Scenes rebuilt'));
  }
};
$('#sceneTrans').oninput = (e) => {
  $('#sceneTransVal').textContent =
    `${e.target.value} ${t('ms cross-fade when a scene changes')}`;
};
$('#sceneTrans').onchange = (e) => bus.action('overlay.update', { patch: { transitionMs: Number(e.target.value) } });
if ($('#sceneStinger')) $('#sceneStinger').onchange = (e) => bus.action('overlay.update', { patch: { stinger: e.target.checked } });

// ---------------------------------------------------------------- sessions and grid

/*
 * A weekend is a chain, and this is where one link is joined to the next.
 *
 * The grid is shown as an ordered list with move controls rather than only a "build from
 * qualifying" button, because the format is not always the qualifying order: heats run
 * reversed, penalties drop a car to the back, someone fails scrutineering. An operator
 * who cannot express that ends up not using the grid at all.
 */
function renderSessions() {
  const box = $('#sessionList');
  if (!box || !state) return;
  const list = state.sessions || [];
  if (!list.length) {
    box.innerHTML = '<p class="hint">No classified sessions yet. Press <b>Classify session</b> when one finishes to archive the result.</p>';
    return;
  }
  box.innerHTML = list.map((s) => {
    const top = s.results.slice(0, 3).map((r) => r.name).join(' · ');
    const when = new Date(s.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `<div class="sessrow">
      <div>
        <b>${esc(s.name)}</b>
        <small>${when} · ${s.results.length} cars · ${esc(top)}</small>
      </div>
      <div class="row">
        <button class="btn" data-grid="${s.id}">Grid</button>
        <button class="btn" data-grid="${s.id}" data-reverse="1">Reversed</button>
        <button class="btn ghost" data-del="${s.id}">✕</button>
      </div>
    </div>`;
  }).join('');

  $$('#sessionList [data-grid]').forEach((b) => {
    b.onclick = () => bus.action('grid.fromSession', { id: b.dataset.grid, reverse: !!b.dataset.reverse });
  });
  $$('#sessionList [data-del]').forEach((b) => {
    b.onclick = () => {
      if (!confirm('Delete this archived session?')) return;
      bus.action('session.remove', { id: b.dataset.del });
    };
  });
}

function renderGrid() {
  const box = $('#gridList');
  if (!box || !state) return;
  const grid = state.race.grid || [];
  if (!grid.length) {
    box.innerHTML = '<p class="hint">No grid set — the field will line up in roster order.</p>';
    return;
  }
  const byId = new Map((state.drivers || []).map((d) => [d.id, d]));
  box.innerHTML = '<div class="gridrows">' + grid.map((id, i) => {
    const d = byId.get(id);
    if (!d) return '';
    return `<div class="gridrow">
      <span class="gpos">P${i + 1}</span>
      <span class="swatch" style="background:${d.color}"></span>
      <b>${esc(d.name)}</b>
      <span class="row" style="margin-left:auto;gap:4px">
        <button class="btn ghost" data-up="${i}" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="btn ghost" data-down="${i}" ${i === grid.length - 1 ? 'disabled' : ''}>↓</button>
      </span>
    </div>`;
  }).join('') + '</div>';

  const move = (from, to) => {
    const g = [...grid];
    if (to < 0 || to >= g.length) return;
    const [x] = g.splice(from, 1);
    g.splice(to, 0, x);
    bus.action('grid.set', { grid: g });
  };
  $$('#gridList [data-up]').forEach((b) => { b.onclick = () => move(Number(b.dataset.up), Number(b.dataset.up) - 1); });
  $$('#gridList [data-down]').forEach((b) => { b.onclick = () => move(Number(b.dataset.down), Number(b.dataset.down) + 1); });
}

$('#btnSaveSession').onclick = () => {
  const name = prompt('Name this classification:', state?.event.sessionName || state?.event.sessionType || 'SESSION');
  if (name == null) return;
  bus.action('session.save', { name: name.trim() || 'SESSION' });
};
$('#btnGridCurrent').onclick = () => bus.action('grid.fromCurrent');
$('#btnGridClear').onclick = () => bus.action('grid.clear');
if ($('#btnGridReverse')) $('#btnGridReverse').onclick = () => { bus.action('grid.reverse'); toast(t('Grid reversed')); };
if ($('#btnGridRandom')) $('#btnGridRandom').onclick = () => { if (confirm(t('Shuffle into a random grid?'))) { bus.action('grid.random'); toast(t('Grid randomised')); } };

// ---------------------------------------------------------------- drift battles

/*
 * The operator console for a tandem event.
 *
 * Everything here is a human decision being recorded, not a measurement: judges call the
 * battles, and the only thing this page can do for them is make the call fast to enter
 * and impossible to lose. So the scoring inputs commit as you type, a misclicked vote is
 * one click to undo, and the bracket is always on screen rather than behind a tab — an
 * operator hunting for a button is dead air.
 */
const dfName = (id) => {
  const d = (state?.drivers || []).find((x) => x.id === id);
  return d ? d.name : null;
};
const dfColor = (id) => {
  const d = (state?.drivers || []).find((x) => x.id === id);
  return d ? d.color : '#666';
};

function renderDrift() {
  if (!state || currentPage !== 'drift') return;
  const D = state.drift || { format: {}, qualifying: [], bracket: [] };
  const F = D.format || {};

  const sel = (id, v) => { const el = $(id); if (el && el.value !== String(v)) el.value = String(v); };
  sel('#dfSize', F.bracketSize ?? 16);
  sel('#dfJudges', F.judges ?? 3);
  sel('#dfRuns', F.qualifyingRuns ?? 2);
  sel('#dfOmt', F.maxOmt ?? 2);

  renderDriftQualifying(D);
  renderDriftBattle(D);
  renderDriftBracket(D);
}

function renderDriftQualifying(D) {
  const runs = Math.max(1, D.format.qualifyingRuns || 2);
  const byId = new Map((D.qualifying || []).map((e) => [e.driverId, e]));
  const rows = (state.drivers || []).filter((d) => !d.dnf).map((d) => {
    const e = byId.get(d.id) || { runs: [], best: null };
    const inputs = [];
    for (let i = 0; i < runs; i++) {
      const v = e.runs[i] == null ? '' : e.runs[i];
      inputs.push(`<input class="dfscore" type="number" step="0.1" data-id="${d.id}" data-run="${i}" value="${v}" placeholder="run ${i + 1}">`);
    }
    return `<tr>
      <td style="width:6px"><span class="swatch" style="background:${d.color}"></span></td>
      <td>${esc(d.name)}</td>
      <td style="white-space:nowrap">${inputs.join(' ')}</td>
      <td class="mono" style="text-align:right;width:70px">${e.best == null ? '--' : e.best}</td>
    </tr>`;
  });
  $('#dfQual').innerHTML = rows.length
    ? `<table class="drivers"><tbody>${rows.join('')}</tbody></table>`
    : '<p class="hint">Add drivers on the Drivers page first.</p>';

  $$('#dfQual .dfscore').forEach((inp) => {
    inp.onchange = () => {
      const id = inp.dataset.id;
      const all = $$(`#dfQual .dfscore[data-id="${id}"]`)
        .map((x) => (x.value === '' ? null : Number(x.value)));
      bus.action('drift.qualify', { driverId: id, runs: all });
    };
  });
}

function renderDriftBattle(D) {
  const b = D.battle;
  const head = $('#dfBattleRound');
  const box = $('#dfBattle');
  if (!b) {
    head.textContent = '';
    box.innerHTML = '<p class="hint">Pick a pair in the bracket below to put it on air.</p>';
    return;
  }
  const round = D.bracket[b.round];
  head.textContent = (round ? round.name : '') + (b.omt ? `  ·  OMT ${b.omt}` : '');

  const side = (who) => {
    const id = who === 'a' ? b.a : b.b;
    const leading = b.lead === who && b.status === 'running';
    return `<div class="dfside ${leading ? 'lead' : ''} ${b.winner === id ? 'won' : ''}">
      <span class="swatch" style="background:${dfColor(id)}"></span>
      <b>${esc(dfName(id) || '—')}</b>
      <small>${b.status === 'running' ? (leading ? 'LEAD' : 'CHASE') : (b.winner === id ? 'WINNER' : '')}</small>
    </div>`;
  };

  const judges = [];
  for (let i = 0; i < b.votes.length; i++) {
    const v = b.votes[i];
    judges.push(`<div class="dfjudge">
      <span>Judge ${i + 1}</span>
      <button class="btn ${v === 'a' ? 'primary' : ''}" data-judge="${i}" data-vote="a">${esc((dfName(b.a) || 'A').slice(0, 10))}</button>
      <button class="btn ${v === 'omt' ? 'primary' : ''}" data-judge="${i}" data-vote="omt">OMT</button>
      <button class="btn ${v === 'b' ? 'primary' : ''}" data-judge="${i}" data-vote="b">${esc((dfName(b.b) || 'B').slice(0, 10))}</button>
    </div>`);
  }

  box.innerHTML = `
    <div class="dfbattle">${side('a')}<div class="dfvs">VS</div>${side('b')}</div>
    <div class="row" style="margin:14px 0">
      <button class="btn ${b.run === 1 ? 'primary' : ''}" id="dfRun1">Run 1 — ${esc(dfName(b.a) || 'A')} leads</button>
      <button class="btn ${b.run === 2 ? 'primary' : ''}" id="dfRun2">Run 2 — ${esc(dfName(b.b) || 'B')} leads</button>
      <button class="btn ghost" id="dfClose" style="margin-left:auto">Close</button>
    </div>
    ${b.status === 'running' ? judges.join('') : `<p class="hint">Decided. ${esc(dfName(b.winner) || '')} advances.</p>`}`;

  $('#dfRun1').onclick = () => bus.action('drift.battle.run', { run: 1 });
  $('#dfRun2').onclick = () => bus.action('drift.battle.run', { run: 2 });
  $('#dfClose').onclick = () => bus.action('drift.battle.close');
  $$('#dfBattle .dfjudge .btn').forEach((btn) => {
    btn.onclick = () => bus.action('drift.vote', {
      judge: Number(btn.dataset.judge), vote: btn.dataset.vote
    });
  });
}

function renderDriftBracket(D) {
  const box = $('#dfBracket');
  if (!D.bracket || !D.bracket.length) {
    box.innerHTML = '<p class="hint">Enter qualifying scores, then press Build bracket.</p>';
    return;
  }
  box.innerHTML = '<div class="dfrounds">' + D.bracket.map((r, ri) => `
    <div class="dfround">
      <h4>${esc(r.name)}</h4>
      ${r.pairs.map((p, pi) => {
        const bye = !p.a || !p.b;
        const live = D.battle && D.battle.round === ri && D.battle.pair === pi;
        return `<div class="dfpair ${live ? 'live' : ''} ${p.winner ? 'done' : ''}" data-round="${ri}" data-pair="${pi}">
          <div class="${p.winner === p.a ? 'w' : ''}"><span class="swatch" style="background:${dfColor(p.a)}"></span>${esc(dfName(p.a) || '—')}</div>
          <div class="${p.winner === p.b ? 'w' : ''}"><span class="swatch" style="background:${dfColor(p.b)}"></span>${esc(dfName(p.b) || (bye ? 'BYE' : '—'))}</div>
        </div>`;
      }).join('')}
    </div>`).join('') + '</div>' +
    (D.champion ? `<p class="hint" style="margin-top:12px"><b>${esc(dfName(D.champion) || '')}</b> wins the event.</p>` : '');

  $$('#dfBracket .dfpair').forEach((el) => {
    el.onclick = () => {
      const round = Number(el.dataset.round), pair = Number(el.dataset.pair);
      const p = D.bracket[round].pairs[pair];
      if (!p.a || !p.b) return;                       // a bye has nothing to run
      bus.action('drift.battle.start', { round, pair });
    };
  });
}

$('#dfSize').onchange = (e) => bus.action('drift.config', { patch: { bracketSize: Number(e.target.value) } });
$('#dfJudges').onchange = (e) => bus.action('drift.config', { patch: { judges: Number(e.target.value) } });
$('#dfRuns').onchange = (e) => bus.action('drift.config', { patch: { qualifyingRuns: Number(e.target.value) } });
$('#dfOmt').onchange = (e) => bus.action('drift.config', { patch: { maxOmt: Number(e.target.value) } });
$('#dfBuild').onclick = () => {
  if ((state?.drift?.bracket || []).length &&
      !confirm('Rebuild the bracket?\n\nBattles already decided will be lost.')) return;
  bus.action('drift.bracket');
};
$('#dfReset').onclick = () => {
  if (!confirm('Clear the bracket?\n\nQualifying scores are kept.')) return;
  bus.action('drift.reset');
};

function renderToolHelp() {
  const tool = $('#roiTool').value;
  const h = ROI_HELP[tool] || {};
  $('#helpTitle').textContent = ROI_TYPES[tool]?.label || (tool === 'finish' ? 'Finish line' : tool === 'sector' ? 'Sector line' : tool);
  $('#helpWhat').textContent = h.what || '—';
  $('#helpHow').textContent = h.how || '—';
  $('#helpGives').textContent = h.gives || '—';
}
$('#roiTool').addEventListener('change', () => { pendingLine = null; renderToolHelp(); });
renderToolHelp();

$('#captureMode').value = localStorage.getItem('frl.captureMode') || 'auto';
$('#captureMode').addEventListener('change', (e) => {
  localStorage.setItem('frl.captureMode', e.target.value);
  renderVisionButton();
});

let pickDriverId = null;

$('#editMode').addEventListener('change', () => {
  const picking = $('#editMode').value === 'pick';
  $('#pickBar').style.display = picking ? '' : 'none';
  if (picking && !pickDriverId && state && state.drivers.length) {
    pickDriverId = state.drivers[0].id;
  }
  renderPickChips();
});

/**
 * One chip per driver, directly under the image.
 *
 * This used to be a dropdown further down the page — far enough that the preview was
 * off screen by the time you reached it, which is useless when the whole job is
 * "look at the car, click the car". Chips also show each driver's current colour, so
 * a pick confirms itself.
 */
function renderPickChips() {
  const box = $('#pickChips');
  if (!box || !state) return;
  if (pickDriverId && !state.drivers.some((d) => d.id === pickDriverId)) pickDriverId = null;
  if (!pickDriverId && state.drivers.length) pickDriverId = state.drivers[0].id;

  const sig = state.drivers.map((d) => d.id + d.name + d.color).join('|') + '|' + pickDriverId;
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;

  box.innerHTML = state.drivers.length
    ? state.drivers.map((d) => `
        <button class="pickchip ${d.id === pickDriverId ? 'on' : ''}" data-id="${d.id}">
          <i style="background:${d.color}"></i>${esc(d.name)} <code>${d.color}</code>
        </button>`).join('')
    : '<div class="hint">Belum ada pembalap. Tambahkan dulu di halaman Drivers.</div>';

  box.onclick = (ev) => {
    const chip = ev.target.closest('.pickchip');
    if (!chip) return;
    pickDriverId = chip.dataset.id;
    renderPickChips();
  };
}

function renderLineList() {
  const lines = state.calibration.lines || [];
  $('#lineCount').textContent = String(lines.length);
  $('#lineEmptyHint').style.display = lines.length ? 'none' : '';

  const sig = JSON.stringify(lines);
  if ($('#lineList').dataset.sig === sig) return;
  $('#lineList').dataset.sig = sig;

  const DIR = { 0: 'both ways', 1: 'A → B', '-1': 'B → A' };
  $('#lineList').innerHTML = lines.map((l) => `
    <div class="roiitem" data-id="${l.id}">
      <span class="tk" style="background:${l.kind === 'finish' ? '#ff375f' : '#64d2ff'}"></span>
      <div>
        <div class="nm">${esc(l.name)}</div>
        <div class="ty">${l.kind === 'finish' ? 'closes the lap' : `split ${l.index}`} · ${l.learn ? 'learning direction' : DIR[l.dir] || 'both ways'}</div>
      </div>
      <div class="sp">
        <button class="btn sm" data-act="flip">Flip</button>
        <button class="btn sm danger" data-act="del">×</button>
      </div>
    </div>`).join('');

  $('#lineList').onclick = (ev) => {
    const act = ev.target.closest('[data-act]')?.dataset.act;
    const id = ev.target.closest('.roiitem')?.dataset.id;
    if (!act || !id) return;
    if (act === 'del') return bus.action('line.remove', { id });
    const l = lines.find((x) => x.id === id);
    bus.action('line.set', { line: { id, dir: l.dir === 1 ? -1 : 1, learn: false } });
  };
}

function renderRoiList() {
  const rois = state.calibration.rois || [];
  $('#roiCount').textContent = String(rois.length);
  $('#roiEmptyHint').style.display = rois.length ? 'none' : '';

  const sig = JSON.stringify(rois.map((r) => [r.id, r.name, r.type, r.driverId, !!r.ref])) +
              selectedRoi + state.drivers.map((d) => d.id + d.name).join(',');
  if ($('#roiList').dataset.sig === sig) return;
  $('#roiList').dataset.sig = sig;

  $('#roiList').innerHTML = rois.map((r) => `
    <div class="roiitem ${selectedRoi === r.id ? 'sel' : ''}" data-id="${r.id}">
      <span class="tk" style="background:${ROI_TYPES[r.type]?.color || '#888'}"></span>
      <div>
        <div class="nm">${esc(r.name || ROI_TYPES[r.type]?.label || r.type)}</div>
        <div class="ty">${esc(ROI_TYPES[r.type]?.label || r.type)}${r.driverId ? ` · ${esc(state.drivers.find((d) => d.id === r.driverId)?.name || '')}` : ''}</div>
      </div>
      <div class="sp">
        ${r.type === 'trigger' ? '<button class="btn sm" data-act="ref">Capture ref</button>' : ''}
        <select data-act="assign" class="btn sm" style="padding:4px">
          <option value="">${t('any driver')}</option>
          ${state.drivers.map((d) => `<option value="${d.id}" ${r.driverId === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}
        </select>
        <button class="btn sm danger" data-act="del">×</button>
      </div>
    </div>`).join('');

  $('#roiList').onclick = (ev) => {
    const item = ev.target.closest('.roiitem');
    if (!item) return;
    const id = item.dataset.id;
    const rois = [...state.calibration.rois];
    const roi = rois.find((r) => r.id === id);
    const act = ev.target.closest('[data-act]')?.dataset.act;
    if (act === 'del') {
      setCalibration({ rois: rois.filter((r) => r.id !== id) });
      return;
    }
    if (act === 'ref') {
      const ref = vision.captureReference(roi);
      if (!ref) return toast('Start capture first');
      roi.ref = ref;
      setCalibration({ rois });
      toast('Reference patch stored');
      return;
    }
    selectedRoi = id;
    renderRoiList();
  };

  $('#roiList').onchange = (ev) => {
    const sel = ev.target.closest('select[data-act=assign]');
    if (!sel) return;
    const id = sel.closest('.roiitem').dataset.id;
    const rois = [...state.calibration.rois];
    const roi = rois.find((r) => r.id === id);
    roi.driverId = sel.value || null;
    setCalibration({ rois });
  };
}

// --- engine settings

// Every one of these is shared with the capture node through the server, so tuning
// them here changes what the machine actually watching the game does.
for (const [key, [sel, cast]] of Object.entries(SETTING_FIELDS)) {
  const el = $(sel);
  if (!el) continue;
  el.onchange = () => {
    const value = el.type === 'checkbox' ? el.checked : cast(el.value);
    bus.action('vision.settings', { patch: { [key]: value } });
    if (key === 'targetFps' && capture.active) capture.applyQuality({ fps: value });
  };
}

/** Mirror the shared settings into the inputs and into this device's engine. */
function renderSettings() {
  const shared = state && state.vision && state.vision.settings;
  if (!shared) return;
  applyVisionSettings(vision, shared);
  for (const [key, [sel]] of Object.entries(SETTING_FIELDS)) {
    const el = $(sel);
    if (!el || document.activeElement === el || !(key in shared)) continue;
    if (el.type === 'checkbox') el.checked = !!shared[key];
    else {
      const v = String(toInputValue(key, shared[key]));
      if (el.value !== v) el.value = v;
    }
  }
  renderTrackMode();
}

$('#setShowBoxes').onchange = (e) => { showBoxes = e.target.checked; };

// The motion slider only means anything when a motion mode is selected.
function renderTrackMode() {
  const mode = $('#setTrackMode').value;
  $('#motionOpts').style.display = mode === 'color' ? 'none' : '';
  $('#motionThrVal').textContent = $('#setMotionThr').value;

  // Motion finds movement; identity still comes from the blob's average colour. Park a
  // dozen cars close together and their blobs merge, so that average lands between two
  // entries in the roster and a lap can be credited to the wrong driver. Measured: a
  // 12-car grid loses 4 of 37 timing assertions in pure motion, none in hybrid.
  const cars = state ? state.drivers.filter((d) => !d.dnf).length : 0;
  const risky = mode === 'motion' && cars > 6;
  const warn = $('#motionWarn');
  warn.style.display = risky ? '' : 'none';
  if (risky) {
    warn.innerHTML = `<b>${cars} mobil dengan mode Motion.</b> Deteksi gerak hanya tahu <i>sesuatu bergerak</i>; ` +
      `identitasnya ditebak dari warna rata-rata gumpalan. Mobil yang berdekatan menyatu jadi satu gumpalan, ` +
      `dan lap bisa tercatat ke pembalap yang salah. Pakai <b>Hybrid</b> untuk grid sebanyak ini.`;
  }
}
$('#setTrackMode').addEventListener('change', renderTrackMode);
$('#setMotionThr').addEventListener('input', renderTrackMode);
renderTrackMode();

$('#btnLoadModel').onclick = async () => {
  $('#modelPill').textContent = 'loading…';
  try {
    const info = await detector.load();
    $('#modelPill').textContent = `ready · ${info.labels.length || '?'} classes`;
    $('#modelPill').classList.add('live');
    toast('Model loaded');
  } catch (err) {
    $('#modelPill').textContent = 'failed';
    toast(`Model load failed: ${err.message}`);
  }
};

// --- detection log

const visionLines = [];
vision.onEvent = (e) => {
  const d = state?.drivers.find((x) => x.id === e.driverId);
  let line;
  if (e.type === 'lap') line = `<b>LAP</b> ${esc(d?.name || e.driverId)} via ${esc(e.source)}`;
  else if (e.type === 'ocr') line = `OCR ${esc(e.roiType)} → "${esc(e.text)}" <span class="dim">${Math.round(e.conf)}%</span>`;
  else if (e.type === 'lapTime') line = `TIME ${esc(d?.name || '')} ${fmtTime(e.ms)}`;
  else if (e.type === 'leaderboard') line = `LEADERBOARD ${e.rows.map((r) => `${r.rank || '?'}.${esc(r.name || r.num || '?')}(${r.laps ?? '?'})`).join(' ')} <span class="dim">${Math.round(e.conf || 0)}%</span>`;
  else if (e.type === 'ocr-status') line = `OCR ENGINE ${esc(e.state)} <span class="dim">${esc(e.message || '')}</span>`;
  else if (e.type === 'trigger') line = `TRIGGER ${esc(e.roi)} ${e.score.toFixed(2)}`;
  else line = `${esc(e.type)} ${esc(e.message || '')}`;
  visionLines.unshift(`<div>${new Date().toLocaleTimeString()} ${line}</div>`);
  visionLines.length = Math.min(visionLines.length, 60);
  $('#visionLog').innerHTML = visionLines.join('');
};

// --- preview render loop

// Drawing the game feed into the panel costs real GPU time and shows the operator
// nothing they need once calibration is done, so it is a dial — including "off".
let previewFps = Number(localStorage.getItem('frl.previewFps') ?? 10);
let lastPreviewAt = 0;

$('#setPreview').onchange = (e) => {
  previewFps = Number(e.target.value);
  previewOffDrawn = false;
  localStorage.setItem('frl.previewFps', String(previewFps));
};
$('#setPreview').value = String(previewFps);

$('#setMaxWidth').onchange = async () => {
  const applied = await capture.applyQuality({ maxWidth: Number($('#setMaxWidth').value) || 0 });
  if (applied) toast(`Capture now ${applied.width}x${applied.height} @ ${Math.round(applied.frameRate)}fps`);
};

const PRESETS = {
  low:      { fps: 10, step: 3, maxWidth: 1280, preview: 0 },
  balanced: { fps: 15, step: 2, maxWidth: 1600, preview: 10 },
  smooth:   { fps: 30, step: 2, maxWidth: 1280, preview: 0 },
  quality:  { fps: 24, step: 1, maxWidth: 0,    preview: 30 }
};

async function applyPreset(name, { announce = true } = {}) {
  const p = PRESETS[name];
  if (!p) return;
  const set = (sel, v) => { const el = $(sel); el.value = String(v); el.dispatchEvent(new Event('change')); };
  set('#setFps', p.fps);
  set('#setStep', p.step);
  set('#setMaxWidth', p.maxWidth);
  set('#setPreview', p.preview);
  localStorage.setItem('frl.preset', name);
  markPreset();
  if (capture.active) await capture.applyQuality({ fps: p.fps, maxWidth: p.maxWidth });
  if (announce) toast(`${name} preset applied`);
}

function markPreset() {
  const cur = localStorage.getItem('frl.preset');
  $$('button[data-preset]').forEach((b) => b.classList.toggle('on', b.dataset.preset === cur));
}

$$('button[data-preset]').forEach((btn) => {
  btn.onclick = () => applyPreset(btn.dataset.preset);
});

// A first run — or an install from before presets existed — starts on the low-spec
// profile. It is the setting most likely to make the difference between a broadcast
// that holds up and one that stutters, and everything it costs is recoverable with
// one click on Balanced or Quality.
if (!localStorage.getItem('frl.preset')) applyPreset('low', { announce: false });
markPreset();

async function previewLoop(now = 0) {
  requestAnimationFrame(previewLoop);
  // nothing on this canvas is visible unless the Vision page is open
  if (currentPage !== 'vision') return;

  // A remote snapshot costs one image blit, so it is worth drawing even when the
  // local preview is switched off — that is how the operator calibrates from the
  // second device.
  const useRemote = !capture.active && remoteFresh();
  const fps = capture.active ? previewFps : (useRemote ? 6 : previewFps);
  if (!fps) { drawPreviewOff(); return; }
  if (now - lastPreviewAt < 1000 / fps) return;
  lastPreviewAt = now;
  previewOffDrawn = false;

  drawPreviewBase();
  const W = preview.width, H = preview.height;
  if (capture.active && detector.ready && showBoxes && !detector.busy) {
    detector.detect(capture.fullFrameCanvas()).then((boxes) => { modelBoxes = boxes; }).catch(() => {});
  }

  rctx.clearRect(0, 0, W, H);
  const rois = state?.calibration.rois || [];

  for (const r of rois) {
    const color = ROI_TYPES[r.type]?.color || '#888';
    const x = r.x * W, y = r.y * H, w = r.w * W, h = r.h * H;
    rctx.strokeStyle = color;
    rctx.lineWidth = selectedRoi === r.id ? 2.5 : 1.5;
    rctx.setLineDash(selectedRoi === r.id ? [] : [5, 4]);
    rctx.strokeRect(x, y, w, h);
    rctx.setLineDash([]);
    rctx.fillStyle = color;
    rctx.font = '600 11px Inter, sans-serif';
    rctx.fillText(r.name || ROI_TYPES[r.type]?.label || r.type, x + 3, Math.max(11, y - 4));
    if (r.type === 'trigger') {
      const score = vision.debug.scores[r.id];
      if (score != null) rctx.fillText(score.toFixed(2), x + w - 30, y + h + 12);
    }
  }

  // timing lines, in frame-normalised space, with the direction they count
  for (const l of (state?.calibration.lines || [])) {
    const ax = l.a.x * W, ay = l.a.y * H, bx = l.b.x * W, by = l.b.y * H;
    const color = l.kind === 'finish' ? '#ff375f' : '#64d2ff';
    rctx.strokeStyle = color;
    rctx.lineWidth = 3;
    rctx.beginPath();
    rctx.moveTo(ax, ay);
    rctx.lineTo(bx, by);
    rctx.stroke();

    // end caps
    rctx.fillStyle = color;
    for (const [px, py] of [[ax, ay], [bx, by]]) {
      rctx.beginPath();
      rctx.arc(px, py, 3.5, 0, Math.PI * 2);
      rctx.fill();
    }

    // arrow at the midpoint, perpendicular to the line, showing the counted direction
    if (l.dir) {
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      const len = Math.hypot(bx - ax, by - ay) || 1;
      const nx = (-(by - ay) / len) * l.dir, ny = ((bx - ax) / len) * l.dir;
      rctx.beginPath();
      rctx.moveTo(mx, my);
      rctx.lineTo(mx + nx * 16, my + ny * 16);
      rctx.stroke();
      rctx.beginPath();
      rctx.arc(mx + nx * 16, my + ny * 16, 3, 0, Math.PI * 2);
      rctx.fill();
    }

    rctx.font = '600 11px Inter, sans-serif';
    rctx.fillText(l.name, ax + 5, ay - 6);
  }

  // first click of a line still waiting for its second point
  if (pendingLine) {
    rctx.strokeStyle = '#fff';
    rctx.fillStyle = '#fff';
    rctx.beginPath();
    rctx.arc(pendingLine.a.x * W, pendingLine.a.y * H, 5, 0, Math.PI * 2);
    rctx.fill();
    rctx.font = '600 11px Inter, sans-serif';
    rctx.fillText('click the other side', pendingLine.a.x * W + 8, pendingLine.a.y * H - 6);
  }

  // racing line, drawn in minimap-local space
  const mm = rois.find((r) => r.type === 'minimap');
  const cal = state?.calibration || {};
  const path = (cal.trackPath && cal.trackPath.length) ? cal.trackPath : (cal.learnedPath || []);
  if (mm && path.length) {
    rctx.strokeStyle = 'rgba(0,224,164,.9)';
    rctx.lineWidth = 2;
    rctx.beginPath();
    path.forEach((p, i) => {
      const px = (mm.x + p.x * mm.w) * W;
      const py = (mm.y + p.y * mm.h) * H;
      i ? rctx.lineTo(px, py) : rctx.moveTo(px, py);
    });
    rctx.stroke();
    path.forEach((p, i) => {
      const px = (mm.x + p.x * mm.w) * W;
      const py = (mm.y + p.y * mm.h) * H;
      rctx.fillStyle = i === 0 ? '#fff' : 'rgba(0,224,164,.9)';
      rctx.beginPath();
      rctx.arc(px, py, i === 0 ? 4 : 2.5, 0, Math.PI * 2);
      rctx.fill();
    });
  }

  // what the remote node's detector found — same dots the node itself would draw
  if (!capture.active) {
    for (const b of remoteBlobs) {
      rctx.fillStyle = b.color;
      rctx.beginPath();
      rctx.arc(b.x * W, b.y * H, 6, 0, Math.PI * 2);
      rctx.fill();
      rctx.strokeStyle = '#fff';
      rctx.lineWidth = 2;
      rctx.stroke();
      rctx.fillStyle = 'rgba(255,255,255,.8)';
      rctx.font = '600 10px Inter, sans-serif';
      rctx.fillText(`${b.n}px`, b.x * W + 9, b.y * H + 3);
    }
  }

  // detected car dots
  for (const b of vision.debug.blobs) {
    const roi = rois.find((r) => r.id === b.roiId);
    if (!roi) continue;
    const px = (roi.x + b.x * roi.w) * W;
    const py = (roi.y + b.y * roi.h) * H;
    rctx.fillStyle = b.color;
    rctx.beginPath();
    rctx.arc(px, py, 5, 0, Math.PI * 2);
    rctx.fill();
    rctx.strokeStyle = '#fff';
    rctx.lineWidth = 1.5;
    rctx.stroke();
  }

  // ONNX model boxes
  if (showBoxes) {
    rctx.lineWidth = 2;
    rctx.font = '600 11px Inter, sans-serif';
    for (const b of modelBoxes) {
      rctx.strokeStyle = '#30d158';
      rctx.strokeRect(b.x * W, b.y * H, b.w * W, b.h * H);
      rctx.fillStyle = '#30d158';
      rctx.fillText(`${b.label} ${(b.score * 100) | 0}%`, b.x * W + 2, b.y * H - 3);
    }
  }

  if (drawing) {
    rctx.strokeStyle = '#fff';
    rctx.setLineDash([4, 3]);
    rctx.strokeRect(
      Math.min(drawing.x0, drawing.x1) * W,
      Math.min(drawing.y0, drawing.y1) * H,
      Math.abs(drawing.x1 - drawing.x0) * W,
      Math.abs(drawing.y1 - drawing.y0) * H
    );
    rctx.setLineDash([]);
  }

  $('#visionPill').textContent = vision.running
    ? `${vision.mode === 'frames' ? 'frame-driven' : 'timer'} · ${vision.fps} fps`
    : 'idle';
  $('#visionPill').classList.toggle('live', vision.running && vision.health === 'ok');
  renderHealth();
}

/**
 * A backgrounded tab gets its timers clamped, which quietly starves detection.
 * Rather than let that happen silently mid-broadcast, say so loudly.
 */
function renderHealth() {
  const bar = $('#visionWarn');
  if (!vision.running) { bar.hidden = true; return; }

  const target = vision.targetFps;
  if (vision.health === 'ok') { bar.hidden = true; return; }

  bar.hidden = false;
  bar.classList.toggle('bad', vision.fps < target * 0.35);
  bar.innerHTML = document.hidden || vision.health === 'throttled'
    ? `<span class="dotwarn"></span>Detection is being throttled — this tab is in the background and running at <b>${vision.fps} fps</b> of ${target}. Keep the operator panel visible on a second monitor while you stream.`
    : `<span class="dotwarn"></span>Detection is running slowly: <b>${vision.fps} fps</b> of ${target}. Lower Detection FPS, or set Pixel sampling to <b>Every 2nd</b>.`;
}

// keep the warning honest the moment the operator tabs away and back
document.addEventListener('visibilitychange', renderHealth);

// ---------------------------------------------------------------- overlay page

$$('input[data-show]').forEach((el) => {
  el.onchange = () => bus.action('overlay.update', { patch: { show: { [el.dataset.show]: el.checked } } });
});

// Running the overlay a second time inside the panel is genuinely expensive, so it is
// opt-in and it is torn down again when switched off rather than merely hidden.
$('#showOverlayPreview').onchange = (e) => {
  const frame = $('#overlayPreview');
  localStorage.setItem('frl.overlayPreview', e.target.checked ? '1' : '0');
  if (e.target.checked) {
    frame.style.display = '';
    bootFrame('#overlayPreview');
  } else {
    frame.style.display = 'none';
    frame.removeAttribute('src');
    frame.dataset.src = '/overlay/all.html';
  }
};
$('#showOverlayPreview').checked = localStorage.getItem('frl.overlayPreview') === '1';
if ($('#showOverlayPreview').checked) $('#overlayPreview').style.display = '';

$('#btnDemoAnim').onclick = () => {
  bus.signal('overlay-demo', {});
  toast('Rehearsal sent to overlays');
};

// ---------------------------------------------------------------- spoken commentary

/*
 * The controls, not the commentator.
 *
 * The voice lives on its own overlay page — one Browser Source, one voice. This panel only
 * writes the settings it reads, which is why the commentary itself never travels: every
 * page that could speak already has the race, and works the sentences out from it.
 */
const com = (patch) => bus.action('commentary.config', { patch });

// Set a <select>/<input> value by selector. `set` proper lives inside refresh(); the Piper
// helpers below run at module scope where it is out of reach, so they use this.
const setVal = (sel, v) => { const el = $(sel); if (el) el.value = v; };

$('#comOn').onchange = (e) => com({ on: e.target.checked });
$('#comCaption').onchange = (e) => com({ caption: e.target.checked });
$('#comVerbosity').onchange = (e) => com({ verbosity: e.target.value });
$('#comLang').onchange = (e) => {
  com({ lang: e.target.value });
  if (state && state.commentary && state.commentary.engine === 'piper') fillCatVoices();
};
$('#comVoice').onchange = (e) => com({ voice: e.target.value });

// Engine + Piper voice. The `voice` field is shared: it means a browser voice name under the
// browser engine, and a Piper voice id under Piper, so switching engine also sends the voice
// that belongs to the newly-chosen engine.
if ($('#comEngine')) $('#comEngine').onchange = (e) => {
  const engine = e.target.value;
  const voice = engine === 'piper'
    ? (($('#comPiperVoice') && $('#comPiperVoice').value) || '')
    : (($('#comVoice') && $('#comVoice').value) || '');
  com({ engine, voice });
};
if ($('#comPiperVoice')) $('#comPiperVoice').onchange = (e) => com({ engine: 'piper', voice: e.target.value });

// The Piper voice list is the local server's, fetched once. If Piper is not set up the note
// says how to add it; the commentary keeps working on the browser voice until then.
let piperLoaded = false;
async function loadPiperVoices() {
  if (piperLoaded) return;
  piperLoaded = true;
  const sel = $('#comPiperVoice');
  const note = $('#comPiperNote');
  if (!sel) return;
  try {
    const d = await (await fetch('/api/tts/voices')).json();
    if (d && d.ok && Array.isArray(d.voices) && d.voices.length) {
      sel.innerHTML = d.voices.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
      setVal('#comPiperVoice', (state && state.commentary && state.commentary.voice) || '');
      if (note) note.style.display = 'none';
    } else {
      sel.innerHTML = '<option value="">(none installed)</option>';
      if (note) {
        note.style.display = '';
        note.innerHTML = 'Piper is not set up on this machine. Put the piper binary and a '
          + 'voice under <code>tools/piper/</code> (or set <code>FRL_PIPER</code> / '
          + '<code>FRL_VOICES</code>). Until then commentary uses the browser voice.';
      }
    }
  } catch (e) {
    piperLoaded = false;   // transient (server not up yet); a later refresh retries
  }
}

// The full installable catalog (~177 voices, every language), fetched once. The Voice-language
// dropdown filters it; installing downloads just the chosen voice into tools/piper/voices.
let catalogLoaded = false;
let catalogVoices = [];

// Browser speechSynthesis only has usable voices for these; Piper's languages come from the
// catalog. So the Voice-language list depends on the engine.
const BROWSER_LANGS = [['id-ID', 'Indonesian'], ['en-US', 'English']];

function fillLangs() {
  const sel = $('#comLang');
  if (!sel) return;
  const piper = state && state.commentary && state.commentary.engine === 'piper';
  const cur = (state && state.commentary && state.commentary.lang) || 'id-ID';
  let opts = BROWSER_LANGS;
  if (piper && catalogVoices.length) {
    const seen = new Map();
    for (const v of catalogVoices) if (v.code && !seen.has(v.code)) seen.set(v.code, v.lang || v.code);
    opts = [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }
  sel.innerHTML = opts.map(([code, label]) => `<option value="${esc(code)}">${esc(label)}</option>`).join('');
  if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
}

// The install picker, narrowed to the language chosen above.
function fillCatVoices() {
  const sel = $('#comCatVoice');
  if (!sel) return;
  const langCode = ($('#comLang') && $('#comLang').value) || '';
  const list = catalogVoices
    .filter((v) => !langCode || v.code === langCode)
    .sort((a, b) => a.key.localeCompare(b.key));
  sel.innerHTML = list.length
    ? list.map((v) => `<option value="${esc(v.key)}">${esc(v.key)} (${esc(v.quality)}${v.speakers > 1 ? ', multi' : ''})${v.installed ? ' ✓' : ''}</option>`).join('')
    : '<option value="">No voices for this language</option>';
}

async function loadCatalog() {
  if (catalogLoaded) return;
  const note = $('#comInstallNote');
  try {
    const d = await (await fetch('/api/tts/catalog')).json();
    if (!d.ok || !Array.isArray(d.voices)) throw new Error(d.error || 'no catalog');
    catalogVoices = d.voices;
    catalogLoaded = true;
    fillLangs();
    fillCatVoices();
    if (note) note.textContent = `${d.voices.length} voices across ${new Set(d.voices.map((v) => v.code)).size} languages — pick a language above, then a voice.`;
  } catch (e) {
    if (note) note.textContent = 'Voice catalog unavailable. Piper runs on the LOCAL console only — open http://localhost:4700, not the hosted site.';
  }
}

if ($('#btnComInstall')) $('#btnComInstall').onclick = async () => {
  const note = $('#comInstallNote');
  const key = ($('#comCatVoice') && $('#comCatVoice').value) || '';
  if (!key) { if (note) note.textContent = 'Pick a language, then a voice, before installing.'; return; }
  if (note) note.textContent = `Installing ${key}… downloads ~20–75 MB, give it a moment.`;
  try {
    const d = await (await fetch('/api/tts/install', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key })
    })).json();
    if (!d.ok) throw new Error(d.error || 'failed');
    piperLoaded = false; await loadPiperVoices();
    catalogLoaded = false; await loadCatalog();       // refresh the ✓ marks first
    setVal('#comPiperVoice', key);
    com({ engine: 'piper', voice: key });
    if (note) note.textContent = `Installed ${key} — set as the commentary voice.`;   // last, so it stays
  } catch (e) {
    if (note) note.textContent = `Install failed: ${e.message}. Piper install works only on the local console at http://localhost:4700.`;
  }
};

// ---------------------------------------------------------------- official timing API
// The poller lives on the server (the API key must never reach a browser); the console just
// stores the key, starts against a Room Key, and polls status. Local-only, like all timing.
if ($('#btnTmSave')) $('#btnTmSave').onclick = async () => {
  const note = $('#tmKeyNote');
  const key = ($('#tmApiKey') && $('#tmApiKey').value) || '';
  const region = ($('#tmRegion') && $('#tmRegion').value) || 'SoutheastAsia';
  try {
    const d = await (await fetch('/api/timing/config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, region })
    })).json();
    if ($('#tmApiKey')) $('#tmApiKey').value = '';    // don't leave the key on screen
    if (note) note.textContent = d.hasKey ? 'Key saved on this machine.' : 'Key cleared.';
  } catch (e) {
    if (note) note.textContent = 'Save failed — this needs the local console (http://localhost:4700).';
  }
};
if ($('#btnTmStart')) $('#btnTmStart').onclick = async () => {
  const note = $('#tmNote');
  const roomKey = ($('#tmRoomKey') && $('#tmRoomKey').value) || '';
  if (!roomKey) { if (note) note.textContent = 'Enter the Room Key first.'; return; }
  if (note) note.textContent = 'Starting…';
  try {
    const d = await (await fetch('/api/timing/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roomKey })
    })).json();
    if (note) note.textContent = d.ok ? `Live on ${d.ip}.` : `Could not start: ${d.error || ''}`;
  } catch (e) {
    if (note) note.textContent = 'Start failed — this needs the local console.';
  }
};
if ($('#btnTmStop')) $('#btnTmStop').onclick = async () => {
  try { await fetch('/api/timing/stop', { method: 'POST' }); } catch (e) { /* ignore */ }
  const note = $('#tmNote'); if (note) note.textContent = 'Stopped.';
};

// Reflect what the poller is doing. Cheap local poll; on the hosted site there is no such
// endpoint, so it just reads "local server only".
async function refreshTimingStatus() {
  const st = $('#tmApiStatus');
  if (!st) return;
  try {
    const d = await (await fetch('/api/timing/status')).json();
    setVal('#tmRegion', d.region || 'SoutheastAsia');
    if ($('#tmRoomKey') && document.activeElement !== $('#tmRoomKey') && !$('#tmRoomKey').value && d.roomKey) {
      $('#tmRoomKey').value = d.roomKey;
    }
    const kn = $('#tmKeyNote');
    if (kn && !kn.textContent) kn.textContent = d.hasKey ? 'A key is saved on this machine.' : 'No key saved yet.';
    if (d.running) {
      st.textContent = `live · ${d.matched} matched${d.error ? ' · ' + d.error : ''}`;
      st.style.color = d.error ? 'var(--yellow)' : 'var(--accent)';
    } else {
      st.textContent = 'off';
      st.style.color = '';
    }
  } catch (e) {
    st.textContent = 'local server only';
    st.style.color = '';
  }
}
setInterval(refreshTimingStatus, 3000);
refreshTimingStatus();

/*
 * A sample, through the same code that will read the race.
 *
 * Not a hardcoded utterance: the operator is choosing between voices that differ mostly in
 * how they handle a driver's name, and a test that skipped the pronunciation table would be
 * testing the wrong thing. So this is a real Speaker with the real settings, given one line.
 */
$('#btnComTest').onclick = async () => {
  const c = (state && state.commentary) || {};
  const note = $('#comTestNote');
  // Test whichever engine is actually selected. The old version always used the browser
  // voice, so testing a Piper voice failed with a "no voice installed" error even when a
  // Piper voice was installed and chosen.
  const engine = ($('#comEngine') && $('#comEngine').value) || c.engine || 'browser';
  const lang = ($('#comLang') && $('#comLang').value) || c.lang || 'id-ID';
  const lead = state && state.drivers && state.drivers[0];
  const name = lead ? lead.name : 'AKI';
  const num = lead ? lead.num : '7';
  const lineFor = (isId) => (isId
    ? `Bendera hijau. ${name}, nomor ${num}, memimpin dari barisan depan.`
    : `Green flag. ${name}, number ${num}, leads them off the line.`);

  if (engine === 'piper') {
    const voice = ($('#comPiperVoice') && $('#comPiperVoice').value) || '';
    if (!voice) { note.textContent = 'Pick or install a Piper voice first.'; return; }
    const test = new Speaker({
      engine: 'piper', voiceName: voice, lang,
      rate: c.rate ?? 1.05, volume: c.volume ?? 1, saying: c.saying || {}
    });
    note.textContent = `piper: ${voice}`;
    // Piper voices are per language, so the test line follows the language setting.
    test.offer([{ key: 'test' + Date.now(), text: lineFor(String(lang).slice(0, 2).toLowerCase() === 'id'), priority: 1, staleMs: 15000 }]);
    return;
  }

  // Browser engine: the sentence follows whichever voice actually resolved.
  const test = new Speaker({
    lang, voiceName: $('#comVoice').value,
    rate: c.rate ?? 1.05, volume: c.volume ?? 1, saying: c.saying || {}
  });
  const report = await test.chooseVoice();
  if (!report.ok) { note.textContent = report.error; return; }
  note.textContent = `${report.voice}${report.missing ? ' (fell back)' : ''}`;
  test.offer([{ key: 'test' + Date.now(), text: lineFor(test.spokenLang() === 'id'), priority: 1, staleMs: 15000 }]);
};
$('#comRate').oninput = (e) => { $('#comRateVal').textContent = Number(e.target.value).toFixed(2); };
$('#comRate').onchange = (e) => com({ rate: Number(e.target.value) });
$('#comVol').oninput = (e) => { $('#comVolVal').textContent = Math.round(e.target.value * 100) + '%'; };
$('#comVol').onchange = (e) => com({ volume: Number(e.target.value) });

$('#btnComSaying').onclick = () => {
  // One per line, "written = spoken". A table would be tidier and slower to fill in with
  // twelve drivers to get through before a race.
  const saying = {};
  for (const line of $('#comSaying').value.split('\n')) {
    const at = line.indexOf('=');
    if (at < 1) continue;
    const from = line.slice(0, at).trim();
    const to = line.slice(at + 1).trim();
    if (from && to) saying[from] = to;
  }
  com({ saying });
  toast('Pronunciations saved');
};

$('#btnCopyCom').onclick = () => {
  navigator.clipboard.writeText($('#comUrl').textContent);
  toast('URL copied');
};

function renderCommentary() {
  if (!state || currentPage !== 'overlay') return;
  const c = state.commentary || {};

  const set = (sel, v) => { const el = $(sel); if (el && document.activeElement !== el) el.value = v; };
  const chk = (sel, v) => { const el = $(sel); if (el && document.activeElement !== el) el.checked = !!v; };

  chk('#comOn', c.on);
  chk('#comCaption', c.caption !== false);
  set('#comVerbosity', c.verbosity || 'normal');

  // Engine, then the language list (its options depend on the engine and the catalog).
  set('#comEngine', c.engine || 'browser');
  const piperOn = (c.engine || 'browser') === 'piper';
  loadPiperVoices();
  if (piperOn) loadCatalog();
  fillLangs();                       // rebuilds #comLang options and reselects c.lang
  if ($('#comPiperRow')) $('#comPiperRow').style.display = piperOn ? '' : 'none';
  if ($('#comPiperInstallRow')) $('#comPiperInstallRow').style.display = piperOn ? '' : 'none';
  if ($('#comVoiceRow')) $('#comVoiceRow').style.display = piperOn ? 'none' : '';
  if (piperOn) set('#comPiperVoice', c.voice || '');

  // The list is rebuilt only when it actually changed. Rewriting a <select> on every render
  // would close it under the operator's finger every time the race state moved.
  const vsel = $('#comVoice');
  const voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  const sig = voices.map((v) => v.name).join('|');
  if (vsel && vsel.dataset.sig !== sig) {
    vsel.dataset.sig = sig;
    vsel.innerHTML = '<option value="">Best one for the language</option>'
      + voices.map((v) => `<option value="${esc(v.name)}">${esc(v.name)}</option>`).join('');
  }
  set('#comVoice', c.voice || '');
  set('#comRate', c.rate ?? 1.05);
  set('#comVol', c.volume ?? 1);
  $('#comRateVal').textContent = Number(c.rate ?? 1.05).toFixed(2);
  $('#comVolVal').textContent = Math.round((c.volume ?? 1) * 100) + '%';

  const status = $('#comStatus');
  status.textContent = c.on ? `on · ${c.verbosity || 'normal'}` : 'off';
  status.style.color = c.on ? 'var(--accent)' : '';

  const box = $('#comSaying');
  if (document.activeElement !== box) {
    box.value = Object.entries(c.saying || {}).map(([k, v]) => `${k} = ${v}`).join('\n');
  }

  // The address to paste, which is the site's own on a hosted event and this machine's
  // otherwise — the same rule the OBS page follows.
  const q = cloud ? `?event=${encodeURIComponent(cloud.code)}` : '';
  $('#comUrl').textContent = `${location.origin}/overlay/commentary.html${q}`;

  /*
   * The one thing that stops it working, checked here rather than left to be discovered.
   *
   * Indonesian is not installed with Windows. Without it the engine reads Indonesian text
   * with an English voice, which is not a slightly worse accent — it is unintelligible.
   * This panel can see the same voice list the overlay will get, so it says so in advance.
   */
  const note = $('#comVoiceNote');
  if (!window.speechSynthesis) {
    note.innerHTML = '<b>This browser has no speech engine.</b> The commentary overlay will '
      + 'stay silent. Chrome, Edge and the OBS browser source all have one.';
    return;
  }
  if (!voices.length) { note.textContent = 'Looking for installed voices…'; return; }

  // Named voice, or the language rule. Same order the overlay resolves in.
  const named = c.voice ? voices.find((v) => v.name === c.voice) : null;
  if (c.voice && !named) {
    note.innerHTML = `<b>${esc(c.voice)} is no longer on this machine.</b> The overlay will `
      + 'fall back to the best voice it has for the language. Pick another above.';
    return;
  }
  if (named) {
    note.innerHTML = `Speaking as <b>${esc(named.name)}</b> (${esc(named.lang)}), and writing `
      + `in ${named.lang.toLowerCase().startsWith('id') ? 'Indonesian' : 'English'} to match.`;
    return;
  }

  const want = (c.lang || 'id-ID').toLowerCase();
  const found = voices.find((v) => v.lang.toLowerCase().startsWith(want.split('-')[0]));
  const fallback = voices.find((v) => v.default) || voices[0];
  note.innerHTML = found
    ? `Voice: <b>${esc(found.name)}</b>. The overlay in OBS picks from its own list, which on `
      + 'the same machine is this one.'
    // The words follow the voice, so this is not broken — it is a different language than
    // the one asked for. Saying "it will be nonsense" was true before that, and false now.
    : `<b>No ${esc(c.lang || 'id-ID')} voice is installed on this machine</b>, so the `
      + `commentary will be spoken <b>and written</b> in English, by ${esc(fallback.name)}. `
      + 'To get the language you asked for: Windows Settings, Time and language, Speech, '
      + 'Manage voices, add it there, then restart the browser and OBS.';
}

// getVoices() is empty on the first call in Chrome and fills in a moment later.
if (window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = () => renderCommentary();
}

$('#focusSelect').onchange = (e) => bus.action('overlay.update', { patch: { focusDriverId: e.target.value || null } });
$('#autoTicker').onchange = (e) => bus.action('overlay.update', { patch: { autoTicker: e.target.checked } });

$('#btnTicker').onclick = () => {
  const lines = $('#tickerText').value.split('\n').map((s) => s.trim()).filter(Boolean);
  bus.action('overlay.update', { patch: { ticker: lines } });
  toast('Ticker updated');
};
$('#btnTickerClear').onclick = () => {
  $('#tickerText').value = '';
  bus.action('overlay.update', { patch: { ticker: [] } });
};
$('#btnTickerAuto').onclick = () => {
  const rows = classification(state);
  const fl = fastestLap(state);
  const lines = [
    `${state.event.name} — ${state.event.round} — ${state.event.track}`,
    ...rows.slice(0, 5).map((d) => `P${d.position} ${d.name} ${d.gap}`),
    fl ? `FASTEST LAP ${fl.name} ${fmtTime(fl.bestLap)}` : ''
  ].filter(Boolean);
  $('#tickerText').value = lines.join('\n');
  bus.action('overlay.update', { patch: { ticker: lines } });
};

function renderOverlayPage() {
  $$('input[data-show]').forEach((el) => { el.checked = !!state.overlay.show[el.dataset.show]; });
  if (document.activeElement !== $('#autoTicker')) $('#autoTicker').checked = state.overlay.autoTicker !== false;
  const sel = $('#focusSelect');
  const cur = state.overlay.focusDriverId || '';
  const sig = state.drivers.map((d) => d.id + d.name).join('|');
  if (sel.dataset.sig !== sig) {
    sel.dataset.sig = sig;
    sel.innerHTML = `<option value="">— ${t('none')} —</option>` +
      state.drivers.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('');
  }
  if (sel.value !== cur) sel.value = cur;

  // Head to head: the two driver pickers only matter in manual mode, so they are dimmed
  // rather than hidden — an operator switching to manual should already see where to look.
  const h = state.overlay.h2h || { mode: 'auto' };
  if (document.activeElement !== $('#hhMode')) $('#hhMode').value = h.mode || 'auto';
  for (const [id, val] of [['#hhA', h.a], ['#hhB', h.b]]) {
    const el = $(id);
    if (el.dataset.sig !== sig) {
      el.dataset.sig = sig;
      el.innerHTML = `<option value="">— ${t('none')} —</option>` +
        state.drivers.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('');
    }
    if (document.activeElement !== el) el.value = val || '';
    el.disabled = (h.mode || 'auto') !== 'manual';
  }

  // Team radio: driver picker + the quote to show on the card.
  const radio = state.overlay.radio || {};
  const rsel = $('#radioDriver');
  if (rsel) {
    if (rsel.dataset.sig !== sig) {
      rsel.dataset.sig = sig;
      rsel.innerHTML = `<option value="">— ${t('none')} —</option>` +
        state.drivers.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('');
    }
    if (document.activeElement !== rsel) rsel.value = radio.driverId || '';
  }
  if ($('#radioText') && document.activeElement !== $('#radioText')) $('#radioText').value = radio.text || '';

  // Audience poll status.
  const poll = state.overlay.poll || {};
  if ($('#pollQuestion') && document.activeElement !== $('#pollQuestion') && !$('#pollQuestion').value) {
    $('#pollQuestion').value = poll.question || '';
  }
  if ($('#pollStatus')) {
    const total = (state.votes && state.votes.total) || 0;
    $('#pollStatus').textContent = poll.open ? `${t('OPEN')} · ${total} ${t('votes')}` : t('closed');
  }
  if ($('#pollResult')) {
    const last = ((state.overlay && state.overlay.pollHistory) || [])[0];
    $('#pollResult').textContent = last && last.winner
      ? `${t('Last poll')}: ${last.question ? last.question + ' — ' : ''}${last.winner.label} (${last.total} ${t('votes')})`
      : '';
  }

  // Sponsors + countdown fields.
  if ($('#sponsorList') && document.activeElement !== $('#sponsorList') && !$('#sponsorList').value) {
    $('#sponsorList').value = (state.overlay.sponsors || []).map((s) => s.logo ? `${s.label} | ${s.logo}` : s.label).join('\n');
  }
  if ($('#cdLabelIn') && document.activeElement !== $('#cdLabelIn') && !$('#cdLabelIn').value) {
    $('#cdLabelIn').value = (state.overlay.countdown && state.overlay.countdown.label) || '';
  }
}

$('#hhMode').onchange = (e) => bus.action('overlay.h2h', { patch: { mode: e.target.value } });
$('#hhA').onchange = (e) => bus.action('overlay.h2h', { patch: { a: e.target.value || null } });
$('#hhB').onchange = (e) => bus.action('overlay.h2h', { patch: { b: e.target.value || null } });

// Team radio: merge either field into overlay.radio, keeping the other.
function pushRadio() {
  const cur = (state.overlay && state.overlay.radio) || {};
  bus.action('overlay.update', { patch: { radio: {
    driverId: $('#radioDriver') ? $('#radioDriver').value : cur.driverId || '',
    text: $('#radioText') ? $('#radioText').value : cur.text || ''
  } } });
}
if ($('#radioDriver')) $('#radioDriver').onchange = pushRadio;
if ($('#radioText')) $('#radioText').oninput = pushRadio;

if ($('#autoDirector')) {
  $('#autoDirector').checked = autoDirector;
  $('#autoDirector').onchange = (e) => {
    autoDirector = e.target.checked;
    try { localStorage.setItem('frl.autodirector', autoDirector ? '1' : '0'); } catch (err) {}
    adState.fastId = null; adState.hideAt = 0;
    toast(autoDirector ? t('Auto-director on') : t('Auto-director off'));
  };
}

// Audience poll.
//
// Options can be typed by hand (one per line, "Label | #color"), filled from a preset, or
// left blank to fall back to every driver. A custom option's id is a slug of its label so a
// re-vote maps to the same bar; a driver option keeps the driver id. Closing snapshots the
// tally and winner into pollHistory so the recap can name it after the live tally is gone.
const POLL_PALETTE = ['#00e0a4', '#00a3ff', '#ffd60a', '#ff5c7a', '#b98bff', '#ff9f43', '#4dd4ac', '#f76d6d'];

function pollOptionsFromText(txt) {
  return txt.split('\n').map((s) => s.trim()).filter(Boolean).map((ln, i) => {
    const [label, color] = ln.split('|').map((s) => s.trim());
    const slug = String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return { id: 'o-' + (slug || i), label, color: (color && /^#/.test(color)) ? color : POLL_PALETTE[i % POLL_PALETTE.length] };
  });
}

function driverPollOptions() {
  return (state.drivers || []).map((d) => ({ id: d.id, label: d.name, color: d.color }));
}

// Presets fill the editor (question + options text); the operator still presses Open.
function setPollEditor(question, lines) {
  if (question != null && $('#pollQuestion')) $('#pollQuestion').value = question;
  if ($('#pollOptions')) $('#pollOptions').value = lines.join('\n');
}
if ($('#btnPollPreAll')) $('#btnPollPreAll').onclick = () => {
  if ($('#pollQuestion') && !$('#pollQuestion').value.trim()) $('#pollQuestion').value = 'Driver of the Day';
  if ($('#pollOptions')) $('#pollOptions').value = (state.drivers || []).map((d) => d.color ? `${d.name} | ${d.color}` : d.name).join('\n');
};
if ($('#btnPollPreTop')) $('#btnPollPreTop').onclick = () => {
  const top = classification(state).slice(0, 3);
  setPollEditor($('#pollQuestion') && $('#pollQuestion').value.trim() ? null : 'Who wins?',
    top.map((d) => d.color ? `${d.name} | ${d.color}` : d.name));
};
if ($('#btnPollPreYN')) $('#btnPollPreYN').onclick = () => setPollEditor(null, ['Yes', 'No']);

if ($('#btnPollOpen')) $('#btnPollOpen').onclick = () => {
  const txt = ($('#pollOptions') && $('#pollOptions').value.trim()) || '';
  const options = txt ? pollOptionsFromText(txt) : driverPollOptions();
  if (!options.length) return toast(t('Add at least one option, or add drivers first'));
  const question = ($('#pollQuestion') && $('#pollQuestion').value) || 'Who wins?';
  bus.action('overlay.update', { patch: { poll: { open: true, question, options } } });
  toast(t('Poll opened'));
};
if ($('#btnPollClose')) $('#btnPollClose').onclick = () => {
  const p = (state.overlay && state.overlay.poll) || {};
  const tally = state.votes || { counts: {}, total: 0 };
  const counts = tally.counts || {};
  const total = tally.total || 0;
  // Snapshot the result before the live tally is gone; winner is null when nobody voted.
  let winner = null, max = 0;
  const snap = (p.options || []).map((o) => {
    const n = counts[o.id] || 0;
    if (n > max) { max = n; winner = { id: o.id, label: o.label }; }
    return { id: o.id, label: o.label, count: n };
  });
  const entry = { question: p.question || '', at: Date.now(), total, options: snap, winner: total ? winner : null };
  const hist = [entry, ...((state.overlay && state.overlay.pollHistory) || [])].slice(0, 20);
  bus.action('overlay.update', { patch: { poll: { ...p, open: false }, pollHistory: hist } });
  toast(entry.winner ? `${t('Poll closed')} — ${entry.winner.label} (${Math.round(max / total * 100)}%)` : t('Poll closed'));
};

// Sponsors: one per line, "Label | logoURL" (URL optional).
if ($('#sponsorList')) $('#sponsorList').onchange = (e) => {
  const list = e.target.value.split('\n').map((ln) => ln.trim()).filter(Boolean).map((ln) => {
    const [label, logo] = ln.split('|').map((s) => s.trim());
    return logo ? { label, logo } : { label };
  });
  bus.action('overlay.update', { patch: { sponsors: list, sponsorIndex: 0 } });
};
if ($('#btnCdStart')) $('#btnCdStart').onclick = () => {
  const min = Number($('#cdMin') && $('#cdMin').value) || 0;
  const label = ($('#cdLabelIn') && $('#cdLabelIn').value) || 'STARTS IN';
  bus.action('overlay.update', { patch: { countdown: { target: Date.now() + min * 60000, label } } });
  toast(t('Countdown set'));
};
if ($('#btnCdClear')) $('#btnCdClear').onclick = () => {
  bus.action('overlay.update', { patch: { countdown: { target: 0, label: ($('#cdLabelIn') && $('#cdLabelIn').value) || 'STARTS IN' } } });
};

// Sponsor rotation + countdown tick run in the console because a windowless OBS page has no
// working timers; each advances shared overlay state, which reaches OBS on the push.
let sponsorAt = 0;
setInterval(() => {
  if (!state || !state.overlay.show.sponsor) return;
  const list = state.overlay.sponsors || [];
  if (list.length < 2) return;
  if (Date.now() - sponsorAt < 6000) return;
  sponsorAt = Date.now();
  bus.action('overlay.update', { patch: { sponsorIndex: ((state.overlay.sponsorIndex || 0) + 1) % list.length } });
}, 1000);
setInterval(() => {
  if (!state || !state.overlay.show.countdown) return;
  const cd = state.overlay.countdown || {};
  if (!cd.target || cd.target <= Date.now()) return;
  bus.action('overlay.update', { patch: { nonce: Date.now() } });   // force the widget to re-tick
}, 1000);


// ---------------------------------------------------------------- layout page

const LAYOUT_LABELS = {
  status: 'Status bar', leaderboard: 'Leaderboard', tower: 'Timing tower',
  lowerthird: 'Lower third', gap: 'Gap bar', results: 'Results',
  trackmap: 'Track map', battle: 'Tandem battle', bracket: 'Bracket',
  grid: 'Starting grid', h2h: 'Head to head', standings: 'Standings', ticker: 'Ticker', fastlap: 'Fastest lap', sectors: 'Sector times', delta: 'Delta / time attack', radio: 'Team radio', poll: 'Audience poll', sponsor: 'Sponsor', countdown: 'Countdown', intro: 'Driver intro', qr: 'QR code'
};

// Force every overlay to redraw the current layout. Changes already reach OBS live; this
// Dragging a widget already reaches every overlay live. This button bumps a render nonce
// so even a Browser Source that somehow skipped an update repaints the current layout.
if ($('#btnApplyLayout')) {
  $('#btnApplyLayout').onclick = () => {
    bus.action('overlay.layoutApply', {});
    toast(t('Layout pushed to overlays'));
  };
}

const editorWrap = $('#editorWrap');
const layoutFrame = $('#layoutFrame');

// The embedded layout editor (overlay.js in edit mode) hands its drag/resize/select actions
// up to here rather than writing them itself, so there is a single writer to the state. On a
// hosted event this is what stops the console's own writes from clobbering a drag back to
// nothing; on the local server it routes to the same bus the direct path used.
window.addEventListener('message', (ev) => {
  if (ev.origin !== location.origin) return;
  if (ev.source !== layoutFrame.contentWindow) return;
  const d = ev.data;
  if (!d || d.__frlEditor !== true || typeof d.type !== 'string') return;
  bus.action(d.type, d.extra || {});
});

// The iframe renders at a true 1920x1080 and is scaled down to fit; pointer
// coordinates inside it stay in canvas pixels, so drag maths needs no correction.
// A ResizeObserver alone is not enough here: the page starts display:none, which
// Chrome skips entirely, so the fit is also recomputed whenever the page renders.
function fitEditor() {
  const w = editorWrap.clientWidth;
  if (w > 0) editorWrap.style.setProperty('--s', String(w / 1920));
}
const editorObserver = new ResizeObserver(fitEditor);
editorObserver.observe(editorWrap);
window.addEventListener('resize', fitEditor);

/** Live geometry of a widget, read straight out of the editor iframe. */
function frameRect(id) {
  const doc = layoutFrame.contentDocument;
  const el = doc && doc.getElementById(id);
  return el ? el.getBoundingClientRect() : null;
}

function layoutPatch(patch) {
  const id = state.overlay.editSelected;
  if (id) bus.action('overlay.layout', { id, patch });
}

for (const [sel, key, cast] of [
  ['#lyX', 'x', Number], ['#lyY', 'y', Number], ['#lyW', 'w', Number],
  ['#lyS', 'scale', (v) => Number(v) / 100]
]) {
  $(sel).onchange = (e) => layoutPatch({ [key]: cast(e.target.value) });
}

$('#lyShown').onchange = (e) => layoutPatch({ hidden: !e.target.checked });

$('#btnResetOne').onclick = () => {
  const id = state.overlay.editSelected;
  if (id) bus.action('overlay.layoutReset', { id });
};

$('#btnResetLayout').onclick = () => {
  if (confirm('Reset every widget back to its default position?')) bus.action('overlay.layoutReset', {});
};

$$('button[data-align]').forEach((btn) => {
  btn.onclick = () => {
    const id = state.overlay.editSelected;
    const r = id && frameRect(id);
    if (!r) return;
    const SAFE = 48;
    switch (btn.dataset.align) {
      case 'left': layoutPatch({ x: SAFE }); break;
      case 'right': layoutPatch({ x: Math.round(1920 - SAFE - r.width) }); break;
      case 'hcenter': layoutPatch({ x: Math.round((1920 - r.width) / 2) }); break;
      case 'top': layoutPatch({ y: SAFE }); break;
      case 'bottom': layoutPatch({ y: Math.round(1080 - SAFE - r.height) }); break;
      case 'vcenter': layoutPatch({ y: Math.round((1080 - r.height) / 2) }); break;
    }
  };
});

$('#btnBackdrop').onclick = () => {
  if (!capture.active) return toast('Start capture on the Vision page first');
  capture.grab();
  const url = capture.dataURL(0.7, 1280);
  editorWrap.style.backgroundImage = `url(${url})`;
  editorWrap.classList.add('has-backdrop');
  toast('Backdrop captured');
};
$('#btnClearBackdrop').onclick = () => {
  editorWrap.style.backgroundImage = '';
  editorWrap.classList.remove('has-backdrop');
};

const styleBinds = [
  ['#stAccent', 'accent', (v) => v, 'overlay'],
  ['#stDensity', 'density', (v) => v, 'style'],
  ['#stOpacity', 'panelOpacity', (v) => Number(v) / 100, 'style'],
  ['#stRadius', 'radius', Number, 'style'],
  ['#stShadow', 'shadow', null, 'style'],
  ['#stLite', 'lite', null, 'style']
];

for (const [sel, key, cast, target] of styleBinds) {
  const el = $(sel);
  const fire = () => {
    const value = el.type === 'checkbox' ? el.checked : cast(el.value);
    if (target === 'overlay') bus.action('overlay.update', { patch: { [key]: value } });
    else bus.action('overlay.style', { patch: { [key]: value } });
  };
  el.oninput = el.type === 'range' || el.type === 'color' ? fire : null;
  el.onchange = fire;
}

/** Widget element id -> the key it uses in a scene's `show` map. */
const SHOW_KEY = { lowerthird: 'lowerThird' };

function renderLayoutPage() {
  fitEditor();

  /*
   * A selection can outlive the scene it was made in: pick the timing tower in Race,
   * switch to Drift, and the properties panel would still be offering to move a widget
   * that is not on screen. Dropping the selection is the honest answer — there is nothing
   * there to adjust.
   */
  let id = state.overlay.editSelected;
  if (id) {
    const key = SHOW_KEY[id] || id;
    if (!(state.overlay.show || {})[key]) {
      id = null;
      bus.action('overlay.update', { patch: { editSelected: null } });
    }
  }
  const l = (state.overlay.layout || {})[id] || {};

  $('#selName').textContent = id ? (LAYOUT_LABELS[id] || id) : 'none';
  $('#selEmpty').style.display = id ? 'none' : '';
  $('#selFields').style.display = id ? '' : 'none';

  /*
   * A click-to-select list of the widgets on this scene.
   *
   * Selecting on the canvas works, but a widget is a small target and every click nudges
   * it. Picking a name here selects it cleanly, so the size and scale fields below can be
   * used without hunting for the resize handle.
   */
  const pick = $('#widgetPick');
  if (pick) {
    const shownIds = Object.keys(LAYOUT_LABELS).filter((w) =>
      (state.overlay.show || {})[SHOW_KEY[w] || w]);
    const sig = shownIds.join(',') + '|' + id;
    if (pick.dataset.sig !== sig) {
      pick.dataset.sig = sig;
      pick.innerHTML = shownIds.map((w) =>
        `<button class="wp ${w === id ? 'on' : ''}" data-wpick="${w}">${LAYOUT_LABELS[w]}</button>`).join('')
        || '<span class="hint">No widgets shown on this scene.</span>';
      $$('#widgetPick [data-wpick]').forEach((b) => {
        b.onclick = () => bus.action('overlay.update', { patch: { editSelected: b.dataset.wpick } });
      });
    }
  }

  if (id) {
    const r = frameRect(id);
    syncIfIdle('#lyX', Math.round(l.x ?? (r ? r.left : 0)));
    syncIfIdle('#lyY', Math.round(l.y ?? (r ? r.top : 0)));
    syncIfIdle('#lyW', Math.round(l.w ?? 0));
    syncIfIdle('#lyS', Math.round((l.scale ?? 1) * 100));
    if (document.activeElement !== $('#lyShown')) $('#lyShown').checked = !l.hidden;
  }

  const st = state.overlay.style || {};
  syncIfIdle('#stAccent', state.overlay.accent);
  syncIfIdle('#stDensity', st.density || 'normal');
  syncIfIdle('#stOpacity', Math.round((st.panelOpacity ?? 0.88) * 100));
  syncIfIdle('#stRadius', st.radius ?? 10);
  if (document.activeElement !== $('#stShadow')) $('#stShadow').checked = st.shadow !== false;
  if (document.activeElement !== $('#stLite')) $('#stLite').checked = st.lite !== false;
  $('#stOpacityVal').textContent = `${Math.round((st.panelOpacity ?? 0.88) * 100)}%`;
  $('#stRadiusVal').textContent = `${st.radius ?? 10}px`;
}


// ---------------------------------------------------------------- help page

/** The manual is data; this turns one block into markup. */
function helpBlock(b) {
  switch (b.type) {
    case 'h': return `<h4>${b.text}</h4>`;
    case 'p': return `<p>${b.text}</p>`;
    case 'note': return `<div class="helpnote">${b.text}</div>`;
    case 'warn': return `<div class="helpwarn">${b.text}</div>`;
    case 'list': return `<ul>${b.items.map((i) => `<li>${i}</li>`).join('')}</ul>`;
    case 'steps': return `<ol>${b.items.map((i) => `<li>${i}</li>`).join('')}</ol>`;
    case 'table':
      return `<table><tr>${b.head.map((h) => `<th>${h}</th>`).join('')}</tr>` +
             b.rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('') +
             `</table>`;
    default: return '';
  }
}

/** Plain text of a section, for the search filter. */
function helpText(section) {
  const strip = (h) => String(h).replace(/<[^>]+>/g, ' ');
  return [section.title, ...section.blocks.flatMap((b) =>
    [b.text, ...(b.items || []), ...(b.head || []), ...(b.rows || []).flat()]
  )].filter(Boolean).map(strip).join(' ').toLowerCase();
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlight(html, query) {
  if (!query) return html;
  // only touch text outside tags, so markup and attributes stay intact
  return html.replace(/>([^<]+)</g, (m, text) => {
    const re = new RegExp(`(${escapeRegex(query)})`, 'gi');
    return '>' + text.replace(re, '<mark>$1</mark>') + '<';
  });
}

function renderHelp(query = '') {
  if (!HELP) return;
  const q = query.trim().toLowerCase();
  const matches = q ? HELP.filter((s) => helpText(s).includes(q)) : HELP;

  $('#helpToc').innerHTML = matches.map((s) =>
    `<a href="#help-${s.id}" data-id="${s.id}">${s.title}</a>`).join('');

  $('#helpBody').innerHTML = matches.map((s) => `
    <section class="helpsec" id="help-${s.id}">
      <h3>${s.title}</h3>
      <div class="card"><div class="body">
        ${highlight(s.blocks.map(helpBlock).join(''), q)}
      </div></div>
    </section>`).join('');

  $('#helpNoResult').style.display = matches.length ? 'none' : '';

  $('#helpToc').onclick = (ev) => {
    const a = ev.target.closest('a');
    if (!a) return;
    ev.preventDefault();
    document.getElementById(`help-${a.dataset.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    $$('#helpToc a').forEach((x) => x.classList.toggle('on', x === a));
  };
}


/*
 * The manual is a big chunk of text; fetch and parse it the first time it is opened.
 *
 * It carries its own translations rather than going through the dictionary: paragraph-long
 * keys are unreadable and a table row is not a sentence. The Help page is marked
 * data-i18n-skip for the same reason, so nothing else touches it.
 */
let helpModule = null;

function loadHelp() {
  if (HELP) return Promise.resolve();
  if (!helpLoading) {
    $('#helpBody').innerHTML = `<div class="hint">${t('Loading the manual…')}</div>`;
    helpLoading = import('./help.js').then((m) => {
      helpModule = m;
      HELP = m.help(window.FRL_I18N ? window.FRL_I18N.lang : 'en');
      renderHelp($('#helpSearch').value);
    });
  }
  return helpLoading;
}

// The manual is rebuilt in the other language rather than translated in place.
document.addEventListener('frl:lang', () => {
  if (!helpModule) return;
  HELP = helpModule.help(window.FRL_I18N.lang);
  renderHelp($('#helpSearch').value);
});

$('#helpSearch').oninput = (e) => { if (HELP) renderHelp(e.target.value); };


// ---------------------------------------------------------------- network page


/** Hoisted, because a clients signal can land before module evaluation finishes. */
function roleLabel(role) {
  return {
    panel: 'Operator panel',
    node: 'Capture node',
    overlay: 'Overlay (OBS or preview)',
    client: 'Other client'
  }[role] || esc(role);
}

function renderClients() {
  const box = $('#netClients');
  if (!box) return;
  if (!connectedClients.length) {
    box.innerHTML = '<div class="hint">Nothing connected yet.</div>';
    return;
  }
  const html = connectedClients.map((c) => `
    <div class="urlrow">
      <b>${roleLabel(c.role)}</b>
      <code>${esc(c.ip || '')}</code>
      <span class="pill live">live</span>
    </div>`).join('');
  if (box.dataset.sig !== html) { box.dataset.sig = html; box.innerHTML = html; }
}

async function renderNetwork() {
  const box = $('#netAddresses');
  if (!box) return;
  let net;
  try {
    net = await (await fetch('/api/net')).json();
  } catch {
    box.innerHTML = '<div class="hint">Could not read the server’s addresses.</div>';
    return;
  }

  const best = net.addresses.find((a) => a.likely);
  $('#netSubnet').textContent = best ? best.subnet : 'no LAN address';

  box.innerHTML = net.addresses.map((a) => `
    <div class="urlrow">
      <b>${a.likely ? 'Use this' : esc(a.name)}</b>
      <code>http://${a.address}:${net.port}/</code>
      <button class="btn sm" data-url="http://${a.address}:${net.port}/">Copy</button>
    </div>`).join('') || '<div class="hint">No network adapters found.</div>';

  box.onclick = (ev) => {
    const btn = ev.target.closest('button[data-url]');
    if (!btn) return;
    navigator.clipboard.writeText(btn.dataset.url);
    toast('URL copied');
  };

  if (!best) {
    $('#netFirewall').innerHTML = 'No usable LAN address. Connect this machine to your router by cable or WiFi.';
    return;
  }

  // Scope the rule to this machine's own subnet and the private profile rather than
  // opening the port to every network it will ever join. Same result at the event,
  // far less exposure on someone else's WiFi later.
  const cidr = `${best.subnet.replace(/\.x$/, '.0')}/24`;

  // Two forms on purpose. Windows 11's "Terminal (Admin)" opens PowerShell, and
  // PowerShell strips the quotes out of netsh's name="..." argument, so that command
  // fails there in a way that is easy to miss. The cmdlet has no such trap.
  const ps = `New-NetFirewallRule -DisplayName "FRL Broadcast ${net.port}" -Direction Inbound -Protocol TCP -LocalPort ${net.port} -Action Allow -Profile Private -RemoteAddress ${cidr}`;
  const cmd = `netsh advfirewall firewall add rule name="FRL Broadcast ${net.port}" dir=in action=allow protocol=TCP localport=${net.port} profile=private remoteip=${cidr}`;

  $('#netFirewall').innerHTML =
    `The other device must be on the same <b>${best.subnet}</b> network — check its IP starts the same way. ` +
    `If it does and the page still will not load, Windows Firewall is blocking the port: Windows denies inbound ` +
    `connections by default, and a server started from a terminal never raises the usual prompt.<br><br>` +
    `<b>1. Open a terminal as Administrator on this machine</b> (Win+X → Terminal (Admin)).<br><br>` +
    `<b>2. PowerShell</b> — this is what Terminal (Admin) opens:<br>` +
    `<code id="fwPs">${esc(ps)}</code> <button class="btn sm" id="btnCopyPs" style="margin-left:6px">Copy</button><br><br>` +
    `<b>or Command Prompt</b> — the netsh form only works in cmd.exe, PowerShell eats its quotes:<br>` +
    `<code id="fwCmd">${esc(cmd)}</code> <button class="btn sm" id="btnCopyFw" style="margin-left:6px">Copy</button><br><br>` +
    `<b>3. Verify</b> — in any terminal, <code>Get-NetFirewallRule -DisplayName "FRL Broadcast ${net.port}"</code> should print the rule.<br>` +
    `<b>4. Test</b> — from the other device open <code>http://${best.address}:${net.port}/api/ping</code>, or run ` +
    `<code>Test-NetConnection ${best.address} -Port ${net.port}</code> there.`;

  $('#btnCopyPs').onclick = () => { navigator.clipboard.writeText(ps); toast('PowerShell command copied'); };
  $('#btnCopyFw').onclick = () => { navigator.clipboard.writeText(cmd); toast('netsh command copied'); };
}

// ---------------------------------------------------------------- obs page

function renderObs() {
  /*
   * The addresses to hand to OBS.
   *
   * Both halves used to be wrong on a hosted event. The origin is right either way — the
   * console is served from wherever it is served from — but a hosted overlay also needs
   * the event code, and without it OBS would have loaded a page hunting for a broadcast
   * server on the streaming machine.
   */
  const base = location.origin;
  const q = cloud ? `?event=${encodeURIComponent(cloud.code)}` : '';
  const list = [
    ['All-in-one', 'all'],
    ['Leaderboard', 'leaderboard'],
    ['Timing tower', 'tower'],
    ['Status bar', 'status'],
    ['Lower third', 'lowerthird'],
    ['Gap bar', 'gap'],
    ['Results', 'results'],
    ['Track map', 'trackmap']
  ];
  $('#obsUrls').innerHTML = list.map(([label, file]) => `
    <div class="urlrow">
      <b>${label}</b>
      <code>${base}/overlay/${file}.html${q}</code>
      <button class="btn sm" data-url="${base}/overlay/${file}.html${q}">Copy</button>
    </div>`).join('');
  $('#obsUrls').onclick = (ev) => {
    const btn = ev.target.closest('button[data-url]');
    if (!btn) return;
    navigator.clipboard.writeText(btn.dataset.url);
    toast('URL copied');
  };
  $('#obsCommentary').textContent = `${base}/overlay/commentary.html${q}`;
  $('#btnCopyCommentary').onclick = () => {
    navigator.clipboard.writeText(`${base}/overlay/commentary.html${q}`);
    toast('URL copied');
  };

  $('#obsMain').textContent = `${base}/overlay/all.html${q}`;
  $('#btnCopyMain').onclick = () => {
    navigator.clipboard.writeText(`${base}/overlay/all.html${q}`);
    toast('URL copied');
  };

  // The rest of this page is the broadcast server's: its addresses, who is connected to
  // it, the machine acting as a capture node and its HTTP lap trigger. hostedMode() has
  // already replaced those cards with an explanation, so there is nothing left to fill in.
  if (cloud) return;

  $('#lapEndpoint').textContent = `${base}/api/lap/<driverId>`;
  renderNetwork();
  renderClients();
  $('#obsNode').textContent = `${base}/node.html`;
  $('#btnCopyNode').onclick = () => {
    navigator.clipboard.writeText(`${base}/node.html`);
    toast('URL copied');
  };
}

// ---------------------------------------------------------------- hosted mode

/*
 * What a hosted event cannot do, said out loud.
 *
 * Three features here are the broadcast server's, not the state's: a second machine acting
 * as the capture source, the lap trigger over HTTP, and the list of who is connected. All
 * three travelled on the socket, and a hosted event has no socket. They used to be silent
 * no-ops — the button acknowledged the click and nothing happened anywhere — which is the
 * worst of the three possible behaviours, so each card now says what it is waiting for.
 */
function hostedMode() {
  if (!cloud) return;

  const note = (id, html) => {
    const card = $(id);
    if (!card) return;
    const body = card.querySelector('.body');
    if (body) body.innerHTML = `<p class="hint" style="margin:0">${html}</p>`;
  };

  note('#cardNode',
    'Capture from a second machine still needs the broadcast server. The handshake between '
    + 'the two runs over its socket, and a hosted event has none, so run capture in this tab '
    + 'on the machine showing the game.');
  note('#cardLap',
    'The HTTP lap trigger belongs to the broadcast server. On a hosted event, record laps '
    + 'from the Drivers page or from detection in this tab.');
  const net = $('#cardNetwork');
  if (net) net.hidden = true;

  const demo = $('#btnDemoAnim');
  if (demo) {
    demo.disabled = true;
    demo.title = 'The rehearsal trigger goes through the broadcast server, which a hosted '
      + 'event does not have.';
  }

  const how = $('#regHow');
  if (how) {
    how.innerHTML = 'Drivers type <code>' + esc(cloud.code) + '</code> into the driver app, '
      + 'then sign in with their race number and password.';
  }
  const warn = $('#regUrlNote');
  if (warn) warn.hidden = true;
}
hostedMode();

// ---------------------------------------------------------------- hotkeys

document.addEventListener('keydown', (ev) => {
  // Ctrl/Cmd+Z is caught before the input guard so it works from anywhere in the console.
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z' && !ev.shiftKey) {
    ev.preventDefault();
    bus.action('history.undo');
    toast(t('Undid last action'));
    return;
  }
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
  const key = ev.key.toLowerCase();

  if (key === ' ') {
    ev.preventDefault();
    if (!state.race.startedAt) bus.action('race.start');
    else bus.action('race.flag', { flag: state.race.status === 'green' ? 'yellow' : 'green' });
    return;
  }
  if (/^[1-9]$/.test(key)) {
    $$('.navbtn')[Number(key) - 1]?.click();
    return;
  }
  // M drops a marker without leaving whatever page you are on: the moment worth marking
  // does not wait for you to navigate.
  if (key === 'm') {
    ev.preventDefault();
    if (!state?.recording?.startedAt) return toast('Press Start markers first');
    bus.action('marker.add', { text: 'Highlight' });
    toast('Marked');
    return;
  }
  const idx = HOTKEYS.indexOf(key);
  if (idx >= 0) {
    const d = classification(state)[idx];
    if (d) {
      bus.action('lap.record', { driverId: d.id, source: 'hotkey', force: true });
      toast(`Lap: ${d.name}`);
    }
  }
});

// ---------------------------------------------------------------- boot

// A handle for diagnosing a live event from the console: what settings this engine
// actually holds, what the tracker currently sees, what the capture is doing.
window.__frl = { vision, capture, bus, get settings() { return vision.settings; }, get targetFps() { return vision.targetFps; } };

bus.on('state', (s) => {
  const first = !state;
  state = s;
  document.documentElement.style.setProperty('--accent', s.overlay.accent || '#00e0a4');
  renderRace();
  renderDrivers();
  tickClock();
  renderSettings();
  vision.pushWorkerConfig();
  renderRoiList();
  renderLineList();
  renderPickChips();
  renderOverlayPage();
  renderLayoutPage();
  renderDrift();
  renderScenes();
  renderSceneStrip();
  renderManual();
  renderMarkers();
  renderRaceControl();
  renderRegistrations();
  renderCommentary();
  renderChampionship();
  renderThemes();
  renderSessions();
  renderGrid();
  if (first) {
    renderObs();
    $('#tickerText').value = (s.overlay.ticker || []).join('\n');
  }
});

/*
 * Redraw when the language changes.
 *
 * The page walker translates sentences it finds in the DOM, but anything this file builds
 * from a count and a phrase — "12 cars", "recording · 21 marks" — goes through t() as it is
 * written, and the walker must not touch it. So those have to be rewritten rather than
 * patched, and with an idle race there is no state push to do it.
 */
document.addEventListener('frl:lang', () => {
  if (!state) return;
  renderRace();
  renderDrivers();
  renderSettings();
  renderRoiList();
  renderLineList();
  renderOverlayPage();
  renderLayoutPage();
  renderDrift();
  renderScenes();
  renderMarkers();
  renderRaceControl();
  renderRegistrations();
  renderCommentary();
  renderChampionship();
  renderThemes();
  renderSessions();
  renderGrid();
  renderObs();
});

requestAnimationFrame(previewLoop);

/* ============================================================ custom hotkeys
 * Bindable keyboard shortcuts. Every control here can be driven by a key the operator
 * chooses; a Stream Deck's "Hotkey" action sends that same keystroke to this tab, so a
 * Stream Deck button works with no plugin and no server. Bindings live in localStorage.
 */
(() => {
  const HK_ACTIONS = [
    { id: 'race.start', label: 'Start race', run: () => bus.action('race.start') },
    { id: 'flag.green', label: 'Flag: Green', run: () => bus.action('race.flag', { flag: 'green' }) },
    { id: 'flag.yellow', label: 'Flag: Yellow', run: () => bus.action('race.flag', { flag: 'yellow' }) },
    { id: 'flag.safety', label: 'Flag: Safety car', run: () => bus.action('race.flag', { flag: 'safety' }) },
    { id: 'flag.vsc', label: 'Flag: VSC', run: () => bus.action('race.flag', { flag: 'vsc' }) },
    { id: 'flag.red', label: 'Flag: Red', run: () => bus.action('race.flag', { flag: 'red' }) },
    { id: 'flag.finished', label: 'Flag: Chequered', run: () => bus.action('race.flag', { flag: 'finished' }) },
    { id: 'flag.formation', label: 'Flag: Formation', run: () => bus.action('race.flag', { flag: 'formation' }) },
    { id: 'undo', label: 'Undo', run: () => bus.action('history.undo') },
    { id: 'marker', label: 'Mark highlight', run: () => bus.action('marker.add', { text: 'Highlight' }) },
    { id: 'scene.next', label: 'Next scene', run: () => cycleScene(1) },
    { id: 'scene.prev', label: 'Previous scene', run: () => cycleScene(-1) },
    { id: 'toggle.leaderboard', label: 'Toggle leaderboard', run: () => toggleShow('leaderboard') },
    { id: 'toggle.tower', label: 'Toggle timing tower', run: () => toggleShow('tower') },
    { id: 'toggle.fastlap', label: 'Toggle fastest-lap banner', run: () => toggleShow('fastlap') },
    { id: 'toggle.sectors', label: 'Toggle sector times', run: () => toggleShow('sectors') },
    { id: 'toggle.radio', label: 'Toggle team radio', run: () => toggleShow('radio') },
    { id: 'toggle.results', label: 'Toggle results screen', run: () => toggleShow('results') }
  ];
  const HK_DEFAULTS = {
    'flag.green': 'shift+g', 'flag.yellow': 'shift+y', 'flag.safety': 'shift+s',
    'flag.vsc': 'shift+v', 'flag.red': 'shift+r', 'flag.finished': 'shift+c',
    'flag.formation': 'shift+o', 'race.start': 'shift+enter', 'undo': 'shift+z',
    'marker': 'shift+m', 'scene.next': 'shift+arrowright', 'scene.prev': 'shift+arrowleft'
  };

  function toggleShow(key) {
    if (!state) return;
    bus.action('overlay.update', { patch: { show: { [key]: !state.overlay.show[key] } } });
  }
  function cycleScene(dir) {
    if (!state) return;
    const sc = state.overlay.scenes || [];
    if (!sc.length) return;
    const i = Math.max(0, sc.findIndex((s) => s.id === state.overlay.activeScene));
    const next = sc[(i + dir + sc.length) % sc.length];
    bus.action('scene.select', { id: next.id });
  }

  let binds = { ...HK_DEFAULTS };
  try { const saved = JSON.parse(localStorage.getItem('frl.hotkeys') || 'null'); if (saved) binds = saved; } catch (e) {}
  function save() { try { localStorage.setItem('frl.hotkeys', JSON.stringify(binds)); } catch (e) {} }

  function combo(ev) {
    const k = ev.key.toLowerCase();
    if (['control', 'alt', 'shift', 'meta'].includes(k)) return null;
    const p = [];
    if (ev.ctrlKey) p.push('ctrl');
    if (ev.altKey) p.push('alt');
    if (ev.shiftKey) p.push('shift');
    if (ev.metaKey) p.push('meta');
    p.push(k === ' ' ? 'space' : k);
    return p.join('+');
  }
  const pretty = (c) => !c ? '—' : c.replace(/\+/g, ' + ').replace(/\barrowright\b/, '→').replace(/\barrowleft\b/, '←').toUpperCase();

  let capturing = null;   // action id awaiting a keypress

  function render() {
    const box = $('#kbList');
    if (!box) return;
    box.innerHTML = HK_ACTIONS.map((a) =>
      `<div class="kbrow"><span class="kbl">${a.label}</span>` +
      `<kbd class="kbkey">${pretty(binds[a.id])}</kbd>` +
      `<button class="btn sm" data-kbset="${a.id}">${capturing === a.id ? 'Press key…' : 'Set'}</button>` +
      `<button class="btn sm ghost" data-kbclr="${a.id}">✕</button></div>`).join('');
    box.querySelectorAll('[data-kbset]').forEach((b) => {
      b.onclick = () => { capturing = b.dataset.kbset; render(); };
    });
    box.querySelectorAll('[data-kbclr]').forEach((b) => {
      b.onclick = () => { delete binds[b.dataset.kbclr]; save(); render(); };
    });
  }
  if ($('#btnKbReset')) $('#btnKbReset').onclick = () => { binds = { ...HK_DEFAULTS }; save(); render(); toast(t('Shortcuts reset')); };

  // Capture takes priority; otherwise a matching binding runs its action.
  window.addEventListener('keydown', (ev) => {
    if (capturing) {
      const c = combo(ev);
      if (!c) return;               // waiting past a bare modifier
      ev.preventDefault();
      ev.stopImmediatePropagation();
      // a key already used by another action is moved, not duplicated
      for (const k of Object.keys(binds)) if (binds[k] === c) delete binds[k];
      binds[capturing] = c;
      capturing = null;
      save(); render();
      return;
    }
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
    const c = combo(ev);
    if (!c) return;
    const hit = HK_ACTIONS.find((a) => binds[a.id] === c);
    if (hit) {
      // stop the built-in lap / nav / flag handlers from also firing on this same key
      ev.preventDefault();
      ev.stopImmediatePropagation();
      hit.run();
    }
  }, true);

  render();
  document.addEventListener('frl:lang', render);
  // repaint the list when the OBS page is opened (labels/keys are static, but the first
  // paint needs the DOM present)
  $$('.navbtn').forEach((b) => { if (b.dataset.page === 'obs') b.addEventListener('click', () => setTimeout(render, 0)); });
})();

/* ============================================================ OBS WebSocket control
 * Cut OBS scenes on a flag and save a replay clip on a marker, driven from the console.
 * Settings are per-browser (localStorage); the connection is opened on demand.
 */
(() => {
  const obs = new ObsWs();
  let cfg = { addr: 'ws://localhost:4455', pass: '', autoCut: false, clipOnMark: false, autoClip: false, green: '', caution: '' };
  try { const s = JSON.parse(localStorage.getItem('frl.obs') || 'null'); if (s) cfg = { ...cfg, ...s }; } catch (e) {}
  const saveCfg = () => { try { localStorage.setItem('frl.obs', JSON.stringify(cfg)); } catch (e) {} };

  const status = (msg, ok) => { const el = $('#obsStatus'); if (el) el.textContent = msg; const dot = $('#obsDot'); if (dot) dot.className = 'conndot ' + (ok ? 'on' : 'off'); };

  function fillScenes(names) {
    for (const [sel, key] of [['#obsSceneGreen', 'green'], ['#obsSceneCaution', 'caution']]) {
      const el = $(sel); if (!el) continue;
      el.innerHTML = '<option value="">— none —</option>' + names.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
      el.value = cfg[key] || '';
    }
  }

  async function connect() {
    cfg.addr = ($('#obsAddr') && $('#obsAddr').value) || cfg.addr;
    cfg.pass = ($('#obsPass') && $('#obsPass').value) || '';
    saveCfg();
    status('Connecting…', false);
    try {
      await obs.connect(cfg.addr, cfg.pass);
      status('Connected', true);
      if ($('#obsMap')) $('#obsMap').hidden = false;
      try { fillScenes(await obs.scenes()); } catch (e) {}
    } catch (err) {
      status(err.message || 'Failed', false);
    }
  }
  obs.on('close', () => status('Disconnected', false));

  if ($('#btnObsConnect')) $('#btnObsConnect').onclick = connect;
  if ($('#btnObsDisconnect')) $('#btnObsDisconnect').onclick = () => { obs.close(); status('Disconnected', false); };
  if ($('#btnObsClip')) $('#btnObsClip').onclick = async () => {
    try { await obs.saveReplay(); toast(t('Clip saved')); }
    catch (e) { toast(e.message || 'Replay buffer off?'); }
  };
  if ($('#obsAutoCut')) $('#obsAutoCut').onchange = (e) => { cfg.autoCut = e.target.checked; saveCfg(); };
  if ($('#obsClipOnMark')) $('#obsClipOnMark').onchange = (e) => { cfg.clipOnMark = e.target.checked; saveCfg(); };
  if ($('#obsAutoClip')) $('#obsAutoClip').onchange = (e) => { cfg.autoClip = e.target.checked; saveCfg(); };
  if ($('#obsSceneGreen')) $('#obsSceneGreen').onchange = (e) => { cfg.green = e.target.value; saveCfg(); };
  if ($('#obsSceneCaution')) $('#obsSceneCaution').onchange = (e) => { cfg.caution = e.target.value; saveCfg(); };

  // Reflect saved settings into the fields once the page exists.
  const paint = () => {
    if ($('#obsAddr') && !$('#obsAddr').value) $('#obsAddr').value = cfg.addr;
    if ($('#obsPass') && !$('#obsPass').value && cfg.pass) $('#obsPass').value = cfg.pass;
    if ($('#obsAutoCut')) $('#obsAutoCut').checked = cfg.autoCut;
    if ($('#obsClipOnMark')) $('#obsClipOnMark').checked = cfg.clipOnMark;
    if ($('#obsAutoClip')) $('#obsAutoClip').checked = cfg.autoClip;
  };
  paint();
  $$('.navbtn').forEach((b) => { if (b.dataset.page === 'obs') b.addEventListener('click', () => setTimeout(paint, 0)); });

  // React to flags and markers as the state moves.
  let lastFlag = null, lastMarks = null, lastFeedT = null, lastFastId = null;
  bus.on('state', (s) => {
    if (!obs.connected) {
      lastFlag = s.race.status;
      lastMarks = (s.recording && s.recording.markers || []).length;
      lastFeedT = (s.feed && s.feed[0] && s.feed[0].t) || 0;
      const f0 = fastestLap(s); lastFastId = f0 && f0.id;
      return;
    }
    if (cfg.autoCut && s.race.status !== lastFlag && lastFlag !== null) {
      const caution = ['yellow', 'safety', 'vsc', 'red', 'formation'].includes(s.race.status);
      const scene = caution ? cfg.caution : (s.race.status === 'green' ? cfg.green : '');
      if (scene) obs.setScene(scene).catch(() => {});
    }
    lastFlag = s.race.status;
    const marks = (s.recording && s.recording.markers || []).length;
    if (cfg.clipOnMark && lastMarks !== null && marks > lastMarks) obs.saveReplay().catch(() => {});
    lastMarks = marks;

    // Auto-clip key moments: a new overtake / stopped-car feed line, or a new fastest lap.
    if (cfg.autoClip) {
      const top = s.feed && s.feed[0];
      if (top && lastFeedT !== null && top.t !== lastFeedT && ['overtake', 'stopped', 'retire'].includes(top.kind)) {
        obs.saveReplay().catch(() => {});
      }
      const f = fastestLap(s);
      if (f && f.id !== lastFastId && lastFastId !== null && s.race.status !== 'finished') obs.saveReplay().catch(() => {});
      lastFastId = f && f.id;
    }
    lastFeedT = (s.feed && s.feed[0] && s.feed[0].t) || lastFeedT;
  });
})();

/* ============================================================ Discord webhook
 * Optional: post the result and (optionally) each flag to a league Discord channel. The
 * webhook URL lives only in this browser. Discord webhooks accept a cross-origin POST, so
 * no server is needed.
 */
(() => {
  let dc = { url: '', onFinish: false, onFlag: false, recapAuto: false };
  try { const s = JSON.parse(localStorage.getItem('frl.discord') || 'null'); if (s) dc = { ...dc, ...s }; } catch (e) {}
  const save = () => { try { localStorage.setItem('frl.discord', JSON.stringify(dc)); } catch (e) {} };
  const dstat = (m) => { const el = $('#dcStatus'); if (el) el.textContent = m; };

  async function post(payload) {
    if (!dc.url) return;
    try {
      const r = await fetch(dc.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      dstat(r.ok ? t('Sent') : 'HTTP ' + r.status);
    } catch (e) { dstat(t('Failed — check the URL')); }
  }

  const FLAG_EMOJI = { green: '🟢', yellow: '🟡', safety: '🚨', vsc: '🟨', red: '🔴', formation: '🚦', finished: '🏁', idle: '⚪' };

  function resultEmbed(s) {
    const rows = classification(s).slice(0, 12);
    const lines = rows.map((d, i) => `**${d.dnf ? (d.retired ? 'RET' : 'DNF') : (i + 1)}.** ${d.name}${d.team ? ' _(' + d.team + ')_' : ''} — ${d.lapsDone} ${t('laps')}`);
    return { embeds: [{
      title: `🏁 ${s.event.name || 'Race'}${s.event.round ? ' · ' + s.event.round : ''} — ${t('Result')}`,
      description: lines.join('\n') || '—',
      color: 0x00e0a4,
      footer: { text: s.event.track || 'FRL Broadcast' }
    }] };
  }

  // An auto-written race recap: winner, podium, fastest lap, positions gained, DNFs. No LLM —
  // it reads the final classification and the event feed and writes the sentences from them.
  function buildRecap(s) {
    const rows = classification(s);
    if (!rows.length) return { text: t('No result yet.'), embed: null };
    const win = rows[0], p2 = rows[1];
    const fl = fastestLap(s);
    const gained = {};
    for (const f of (s.feed || [])) if (f.kind === 'overtake' && f.driverId) gained[f.driverId] = (gained[f.driverId] || 0) + 1;
    let mover = null, moverN = 0;
    for (const d of rows) { const n = gained[d.id] || 0; if (n > moverN) { moverN = n; mover = d; } }
    const dnf = rows.filter((d) => d.dnf).length;
    const ev = s.event;
    const L = [];
    L.push(`🏁 ${ev.name || 'Race'}${ev.round ? ' · ' + ev.round : ''}${ev.track ? ' — ' + ev.track : ''}`);
    L.push(`${win.name}${win.team ? ' (' + win.team + ')' : ''} ${t('wins')}${p2 ? ' ' + t('ahead of') + ' ' + p2.name : ''}.`);
    L.push(t('Podium') + ': ' + rows.slice(0, 3).map((d, i) => `${i + 1}. ${d.name}`).join(' · '));
    if (fl && fl.bestLap != null) L.push(t('Fastest lap') + `: ${fl.name} — ${fmtTime(fl.bestLap)}.`);
    if (mover && moverN > 0) L.push(t('Most places gained') + `: ${mover.name} (+${moverN}).`);
    if (dnf) L.push(`${dnf} DNF.`);
    const lastPoll = ((s.overlay && s.overlay.pollHistory) || [])[0];
    if (lastPoll && lastPoll.winner && lastPoll.total) {
      L.push(`${t('Fan vote')}${lastPoll.question ? ' (' + lastPoll.question + ')' : ''}: ${lastPoll.winner.label} (${lastPoll.total} ${t('votes')}).`);
    }
    return { text: L.join('\n'), embed: { embeds: [{ title: L[0], description: L.slice(1).join('\n'), color: 0x00e0a4, footer: { text: 'FRL Broadcast' } }] } };
  }

  if ($('#btnRecapBuild')) $('#btnRecapBuild').onclick = () => { if ($('#recapText')) $('#recapText').value = buildRecap(state).text; };
  if ($('#btnRecapPost')) $('#btnRecapPost').onclick = () => { if (!dc.url) return dstat(t('Paste a webhook URL first')); dstat(t('Sending…')); post(buildRecap(state).embed); };
  if ($('#btnRecapCopy')) $('#btnRecapCopy').onclick = async () => { try { await navigator.clipboard.writeText(buildRecap(state).text); dstat(t('Copied')); } catch (e) { if ($('#recapText')) { $('#recapText').value = buildRecap(state).text; $('#recapText').select(); } } };
  if ($('#dcRecapAuto')) $('#dcRecapAuto').onchange = (e) => { dc.recapAuto = e.target.checked; save(); };

  if ($('#dcUrl')) $('#dcUrl').onchange = (e) => { dc.url = e.target.value.trim(); save(); };
  if ($('#dcOnFinish')) $('#dcOnFinish').onchange = (e) => { dc.onFinish = e.target.checked; save(); };
  if ($('#dcOnFlag')) $('#dcOnFlag').onchange = (e) => { dc.onFlag = e.target.checked; save(); };
  if ($('#btnDcTest')) $('#btnDcTest').onclick = () => { if (!dc.url) return dstat(t('Paste a webhook URL first')); dstat(t('Sending…')); post({ content: '✅ FRL Broadcast ' + t('connected to this channel.') }); };

  const paint = () => {
    if ($('#dcUrl') && !$('#dcUrl').value && dc.url) $('#dcUrl').value = dc.url;
    if ($('#dcOnFinish')) $('#dcOnFinish').checked = dc.onFinish;
    if ($('#dcOnFlag')) $('#dcOnFlag').checked = dc.onFlag;
    if ($('#dcRecapAuto')) $('#dcRecapAuto').checked = dc.recapAuto;
  };
  paint();
  $$('.navbtn').forEach((b) => { if (b.dataset.page === 'obs') b.addEventListener('click', () => setTimeout(paint, 0)); });

  let last = null;
  bus.on('state', (s) => {
    if (last !== null && s.race.status !== last && s.race.status === 'finished') {
      // fill the recap box on the console the moment the race ends, ready to post/copy
      if ($('#recapText')) $('#recapText').value = buildRecap(s).text;
    }
    if (!dc.url) { last = s.race.status; return; }
    if (last !== null && s.race.status !== last) {
      if (s.race.status === 'finished') {
        if (dc.recapAuto) post(buildRecap(s).embed);
        else if (dc.onFinish) post(resultEmbed(s));
      } else if (dc.onFlag) post({ content: `${FLAG_EMOJI[s.race.status] || ''} **${(FLAG_LABEL[s.race.status] || s.race.status).toUpperCase()}**` });
    }
    last = s.race.status;
  });
})();

/* ============================================================ saved looks (skin studio)
 * Save the current skin + theme + accent + style as a named preset and reapply it in one
 * click. Presets live in this browser's localStorage — a per-operator wardrobe of looks.
 */
(() => {
  const load = () => { try { return JSON.parse(localStorage.getItem('frl.looks') || '[]'); } catch (e) { return []; } };
  const save = (arr) => { try { localStorage.setItem('frl.looks', JSON.stringify(arr)); } catch (e) {} };

  window.renderLooks = function renderLooks() {
    const box = document.getElementById('lookList');
    if (!box) return;
    const looks = load();
    box.innerHTML = looks.length
      ? looks.map((l, i) => `<button class="wp" data-look="${i}" title="Apply">${esc(l.name)} <span data-lookdel="${i}" style="opacity:.6;margin-left:4px">✕</span></button>`).join('')
      : '<span class="hint">No saved looks yet.</span>';
    box.querySelectorAll('[data-look]').forEach((b) => {
      b.onclick = (ev) => {
        if (ev.target.dataset.lookdel != null) { const a = load(); a.splice(Number(ev.target.dataset.lookdel), 1); save(a); renderLooks(); return; }
        const l = load()[Number(b.dataset.look)];
        if (!l) return;
        bus.action('overlay.update', { patch: { skin: l.skin || 'classic', accent: l.accent } });
        if (l.theme) bus.action('overlay.theme', { theme: l.theme });
        if (l.style) bus.action('overlay.style', { patch: l.style });
        toast(t('Look applied') + ': ' + l.name);
      };
    });
  };

  if ($('#btnLookSave')) $('#btnLookSave').onclick = () => {
    const name = ($('#lookName') && $('#lookName').value || '').trim();
    if (!name) return toast(t('Name the preset first'));
    if (!state) return;
    const o = state.overlay;
    const arr = load().filter((l) => l.name !== name);
    arr.push({ name, skin: o.skin || 'classic', theme: o.theme || 'midnight', accent: o.accent, style: { ...(o.style || {}) } });
    save(arr);
    if ($('#lookName')) $('#lookName').value = '';
    renderLooks();
    toast(t('Look saved') + ': ' + name);
  };
})();
