import { Bus, fmtTime, fmtGap, fmtClock, classification, raceElapsed, leaderLap, fastestLap, FLAG_LABEL, closestFight } from '../js/shared.js';
import { buildPath, pointAtProgress } from '../js/tracker.js';
import { CloudBus, cloudOptions } from '../js/cloudbus.js';

/*
 * Self-update, so OBS never runs stale code again.
 *
 * A Browser Source loads the page once and then never asks the server for anything again —
 * so a fix shipped to the server sits unused until someone reloads the source by hand, which
 * is exactly the trap that kept old overlay code live on stream. This checks a tiny version
 * stamp every 30s; when the deploy behind it changes, the page reloads itself. The stamp is
 * carried on this module's own URL (`overlay.js?v=VER`) and written to /version.txt by the
 * deploy, so the two only differ when a newer build is live. No URL to change, no manual
 * refresh — the source picks up the next deploy on its own within half a minute.
 */
(function autoUpdate() {
  let mine = '';
  try { mine = new URL(import.meta.url).searchParams.get('v') || ''; } catch (e) { /* no query */ }
  if (!mine) return;   // running unversioned (local dev) — nothing to compare against
  setInterval(async () => {
    try {
      const r = await fetch('/version.txt', { cache: 'no-store' });
      if (!r.ok) return;
      const live = (await r.text()).trim();
      if (live && live !== mine) location.reload();
    } catch (e) { /* offline; try again next tick */ }
  }, 30000);
})();

const stage = document.querySelector('.stage');
const wanted = (document.body.dataset.widgets || '').split(',').map((s) => s.trim()).filter(Boolean);
const params = new URLSearchParams(location.search);
const forced = params.get('force') === '1';
// ?motion=calm kills the ambient loops (sheen, crawling underline, pulsing ticks)
// while keeping every event-driven animation.
if (params.get('motion') === 'calm') document.documentElement.classList.add('calm');
// ?motion=full overrides the OS "reduce motion" setting, which otherwise freezes
// every ambient loop and makes the overlay look broken.
if (params.get('motion') === 'full') document.documentElement.classList.add('motion-full');
// ?edit=1 turns this page into the layout editor the operator panel embeds.
const editing = params.get('edit') === '1';
if (editing) document.documentElement.classList.add('edit');

const WIDGET_IDS = ['status', 'leaderboard', 'tower', 'lowerthird', 'gap', 'results', 'trackmap', 'battle', 'bracket', 'grid', 'h2h', 'standings', 'ticker', 'fastlap', 'sectors', 'delta', 'radio', 'poll', 'sponsor', 'countdown', 'intro', 'qr'];
const LABELS = {
  status: 'Status bar', leaderboard: 'Leaderboard', tower: 'Timing tower',
  lowerthird: 'Lower third', gap: 'Gap bar', results: 'Results',
  trackmap: 'Track map', battle: 'Tandem battle', bracket: 'Bracket',
  grid: 'Starting grid', h2h: 'Head to head', standings: 'Standings', ticker: 'Ticker',
  fastlap: 'Fastest lap', sectors: 'Sector times', delta: 'Delta / time attack', radio: 'Team radio', poll: 'Audience poll',
  sponsor: 'Sponsor', countdown: 'Countdown', intro: 'Driver intro', qr: 'QR code'
};
const STAGE_W = 1920;
const STAGE_H = 1080;

const FLAG_COLOR = {
  idle: ['#8e8e93', false],
  formation: ['#0a84ff', true],
  green: ['#30d158', false],
  yellow: ['#ffd60a', false],
  safety: ['#ff9f0a', false],
  // Yellow-on-yellow would be indistinguishable from a local yellow at a glance, and the
  // two mean different things to a driver, so the VSC gets its own hue.
  vsc: ['#ffcc00', false],
  red: ['#ff3b30', true],
  finished: ['#ffffff', false]
};

const EASE = 'cubic-bezier(.16,1,.3,1)';

/*
 * A socket to the broadcast server, or a hosted event.
 *
 * `?event=NDL3` picks the second. Both present the same interface, so nothing below this
 * line knows the difference, and a league still running the server on a laptop keeps
 * working exactly as it does today.
 */
const cloud = cloudOptions();
const bus = cloud ? new CloudBus('overlay', cloud) : new Bus('overlay');
let state = null;
let prev = new Map();       // driverId -> snapshot of the last render
let prevFlag = null;
let prevGapMs = null;
let lastClock = '';
let drag = null;            // active layout-editor gesture
const els = {};
const shown = {};           // widget id -> was it visible last render

// ---------------------------------------------------------------- markup

function build() {
  const html = {
    status: `
      <div class="widget" id="status">
        <div class="card status-bar">
          <div class="brand-slot" id="brandSlot">
            <div class="flag-pill" id="flagPill"><span class="flag-dot"></span><span class="label" id="flagText">STANDBY</span></div>
            <div class="brand-logo" id="brandLogo"><img alt="" id="brandImg" hidden><b id="brandName"></b></div>
          </div>
          <div class="seg event"><div class="k">Event</div><div class="v" id="stEvent">--</div></div>
          <div class="seg"><div class="k" id="stLapK">Lap</div><div class="v" id="stLap">--</div></div>
          <div class="seg"><div class="k" id="stClockK">Race time</div><div class="v" id="stClock">00:00</div></div>
          <div class="seg"><div class="k">Fastest lap</div><div class="v" id="stFl">--:--.---</div></div>
        </div>
      </div>`,
    leaderboard: `
      <div class="widget" id="leaderboard">
        <div class="card">
          <div class="card-head"><span class="tick"></span><span class="title">Leaderboard</span><span class="sub" id="lbSub">--</span></div>
          <div id="lbRows"></div>
        </div>
      </div>`,
    tower: `
      <div class="widget" id="tower">
        <div class="card">
          <div class="card-head"><span class="tick"></span><span class="title">Timing</span><span class="sub" id="twSub">--</span></div>
          <div class="tw-head"><div>P</div><div></div><div>Driver</div><div class="sec-h">Sectors</div><div style="text-align:right">Last</div><div style="text-align:right">Best</div><div style="text-align:right">Int</div></div>
          <div id="twRows"></div>
        </div>
      </div>`,
    lowerthird: `
      <div class="widget" id="lowerthird">
        <div class="card l3">
          <div class="accentbar" id="l3bar"></div>
          <div class="body">
            <div class="kicker" id="l3kicker">On track</div>
            <div class="name" id="l3name">--</div>
            <div class="meta" id="l3meta"></div>
          </div>
        </div>
      </div>`,
    gap: `
      <div class="widget" id="gap">
        <div class="card gapbar">
          <div class="heads">
            <div class="l"><span id="gapA">--</span><small id="gapAsub">--</small></div>
            <div class="r"><span id="gapB">--</span><small id="gapBsub">--</small></div>
          </div>
          <div class="gaptrack"><div class="gapfill" id="gapFill"></div></div>
          <div class="gapval" id="gapVal">--</div>
        </div>
      </div>`,
    results: `
      <div class="widget" id="results">
        <div class="card">
          <div class="res-title"><h1 id="resTitle">RACE RESULT</h1><p id="resSub">--</p></div>
          <div id="resRows"></div>
        </div>
      </div>`,
    trackmap: `
      <div class="widget" id="trackmap">
        <div class="card">
          <div class="card-head"><span class="tick"></span><span class="title">Track</span><span class="sub" id="tmSub">--</span></div>
          <div class="tm"><svg id="tmSvg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet"></svg></div>
        </div>
      </div>`,
    battle: `
      <div class="widget" id="battle">
        <div class="card">
          <div class="card-head"><span class="tick"></span><span class="title" id="btRound">BATTLE</span><span class="sub" id="btRun">--</span></div>
          <div class="bt">
            <div class="bt-side" id="btA"><span class="bt-dot"></span><b></b><small></small></div>
            <div class="bt-vs">VS</div>
            <div class="bt-side" id="btB"><span class="bt-dot"></span><b></b><small></small></div>
          </div>
          <div class="bt-votes" id="btVotes"></div>
        </div>
      </div>`,
    bracket: `
      <div class="widget" id="bracket">
        <div class="card">
          <div class="card-head"><span class="tick"></span><span class="title">BRACKET</span><span class="sub" id="bkSub">--</span></div>
          <div class="bk" id="bkBody"></div>
        </div>
      </div>`,
    grid: `
      <div class="widget" id="grid">
        <div class="card">
          <div class="grid-title"><h1>STARTING GRID</h1><p id="gdSub">--</p></div>
          <div class="gd" id="gdRows"></div>
        </div>
      </div>`,
    h2h: `
      <div class="widget" id="h2h">
        <div class="card">
          <div class="card-head"><span class="tick"></span><span class="title">HEAD TO HEAD</span><span class="sub" id="hhSub">--</span></div>
          <div class="hh" id="hhBody"></div>
        </div>
      </div>`,
    standings: `
      <div class="widget" id="standings">
        <div class="card">
          <div class="res-title"><h1 id="stdTitle">CHAMPIONSHIP</h1><p id="stdSub">--</p></div>
          <div id="stdRows"></div>
        </div>
      </div>`,
    ticker: `
      <div class="widget" id="ticker">
        <div class="ticker-bar">
          <div class="ticker-tag">LIVE</div>
          <div class="ticker-track"><div class="ticker-move" id="tickerMove"></div></div>
        </div>
      </div>`,
    fastlap: `
      <div class="widget" id="fastlap">
        <div class="card fastlap-bar">
          <div class="fl-tag">FASTEST LAP</div>
          <div class="fl-name" id="flName">--</div>
          <div class="fl-time" id="flTime">--</div>
        </div>
      </div>`,
    sectors: `
      <div class="widget" id="sectors">
        <div class="card sec-card">
          <div class="sec-head"><span class="sc-name" id="scName">--</span><span class="sc-lap" id="scLap">--</span></div>
          <div class="sec-cells" id="scCells"></div>
        </div>
      </div>`,
    delta: `
      <div class="widget" id="delta">
        <div class="card sec-card">
          <div class="sec-head"><span class="sc-name" id="dtName">--</span><span class="sc-lap" id="dtLap">--</span></div>
          <div class="sec-cells" id="dtCells"></div>
        </div>
      </div>`,
    radio: `
      <div class="widget" id="radio">
        <div class="card radio-card">
          <div class="radio-head">
            <span class="rd-name" id="rdName">--</span>
            <span class="rd-tag">RADIO</span>
            <span class="rd-wave"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>
          </div>
          <div class="radio-quote" id="rdText"></div>
        </div>
      </div>`,
    poll: `
      <div class="widget" id="poll">
        <div class="card poll-card">
          <div class="poll-q" id="pollQ">—</div>
          <div class="poll-bars" id="pollBars"></div>
          <div class="poll-foot"><b id="pollTotal">0</b> <span id="pollVotesLbl">votes</span></div>
        </div>
      </div>`,
    sponsor: `
      <div class="widget" id="sponsor">
        <div class="card sponsor-card">
          <span class="sp-k">SPONSOR</span>
          <span class="sp-body" id="spBody">—</span>
        </div>
      </div>`,
    countdown: `
      <div class="widget" id="countdown">
        <div class="card cd-card">
          <div class="cd-label" id="cdLabel">STARTS IN</div>
          <div class="cd-time" id="cdTime">00:00</div>
        </div>
      </div>`,
    intro: `
      <div class="widget" id="intro">
        <div class="card intro-card">
          <img class="intro-photo" id="inPhoto" alt="" hidden>
          <span class="intro-num" id="inNum">--</span>
          <div class="intro-main"><div class="intro-name" id="inName">--</div><div class="intro-team" id="inTeam"></div></div>
          <div class="intro-pts" id="inPts"></div>
        </div>
      </div>`,
    qr: `
      <div class="widget" id="qr">
        <div class="card qr-card">
          <img id="qrImg" alt="QR">
          <div class="qr-cap">SCAN TO FOLLOW &amp; VOTE</div>
        </div>
      </div>`
  };

  stage.innerHTML = wanted.map((w) => html[w] || '').join('');

  // Move each widget's contents into a .wrap layer. The outer .widget then owns
  // placement only, so the layout editor can drag it without touching the
  // show/hide transition that lives on .wrap.
  for (const el of stage.querySelectorAll('.widget')) {
    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    while (el.firstChild) wrap.appendChild(el.firstChild);
    el.appendChild(wrap);
    el.dataset.label = LABELS[el.id] || el.id;
    if (editing) {
      const rz = document.createElement('div');
      rz.className = 'rz';
      el.appendChild(rz);
    }
  }

  for (const id of WIDGET_IDS) els[id] = document.getElementById(id);

  if (editing) {
    stage.insertAdjacentHTML('beforeend',
      '<div id="guides"></div>' +
      '<div id="hud"><span id="hudName">—</span><span id="hudPos">—</span>' +
      '<span>drag to move · handle to resize · arrows nudge · shift+arrows ×10</span></div>');
  }
}

// ---------------------------------------------------------------- layout + style

/** Apply the operator's saved placement. Absent fields fall back to the stylesheet. */
function applyLayout() {
  const L = (state.overlay && state.overlay.layout) || {};
  for (const id of WIDGET_IDS) {
    const el = els[id];
    if (!el) continue;
    if (drag && drag.id === id) continue;   // don't fight an in-progress drag
    const l = L[id];
    el.classList.toggle('layout-hidden', !!(l && l.hidden));
    if (!l) {
      // entry was reset — drop every inline placement so the stylesheet default
      // takes over again instead of the last dragged position sticking around
      el.style.cssText = '';
      continue;
    }
    if (l.x != null) { el.style.left = `${l.x}px`; el.style.right = 'auto'; }
    if (l.y != null) { el.style.top = `${l.y}px`; el.style.bottom = 'auto'; }
    if (l.w) el.style.width = `${l.w}px`;
    if (l.x != null || l.y != null || l.scale != null) {
      el.style.transform = `scale(${l.scale ?? 1})`;
    }
    // hidden means "removed from this layout", which the editor still shows ghosted
    if (!editing) el.style.display = l.hidden ? 'none' : '';
  }
}

function applyStyle() {
  const st = (state.overlay && state.overlay.style) || {};
  const root = document.documentElement;
  // The template is a data attribute so the whole token set swaps in one write, and so
  // nothing has to be recomputed per widget.
  const theme = (state.overlay && state.overlay.theme) || 'midnight';
  if (root.dataset.theme !== theme) root.dataset.theme = theme;
  // The skin reshapes the widgets; it is separate from the theme's colours, so both apply
  // at once. Written as a data attribute for the same reason the theme is — one swap.
  const skin = (state.overlay && state.overlay.skin) || 'classic';
  if (root.dataset.skin !== skin) root.dataset.skin = skin;
  root.style.setProperty('--panel-alpha', String(st.panelOpacity ?? 0.88));
  root.style.setProperty('--radius', `${st.radius ?? 10}px`);
  // Only written when shadows are switched off. Setting it otherwise would be an inline
  // style beating every theme's own shadow, which is how the neon glow and the retro
  // amber bloom silently stopped existing.
  if (st.shadow === false) root.style.setProperty('--shadow', 'none');
  else root.style.removeProperty('--shadow');
  root.classList.toggle('density-compact', st.density === 'compact');
  // ?motion=calm forces it on regardless of what the operator saved
  root.classList.toggle('lite', st.lite !== false || root.classList.contains('calm'));
}

/*
 * The flag and the logo taking turns in one slot.
 *
 * Driven by its own timer rather than by state updates: the alternation has to keep its
 * rhythm whether laps are arriving or nothing has happened for a minute, and tying it to
 * the render loop would make it stutter with the timing feed.
 */
function applyBrand() {
  const b = (state.overlay && state.overlay.brand) || {};
  const slot = document.getElementById('brandSlot');
  if (!slot) return;

  const img = document.getElementById('brandImg');
  const name = document.getElementById('brandName');
  if (img) {
    const url = b.logoUrl || '';
    if (img.getAttribute('src') !== url) {
      if (url) { img.setAttribute('src', url); img.hidden = false; }
      else { img.removeAttribute('src'); img.hidden = true; }
    }
  }
  if (name && name.textContent !== (b.name || '')) name.textContent = b.name || '';

  // Everything else is two class writes. When it alternates, the alternation itself is a
  // CSS animation, so nothing here can interrupt it — see the note in overlay.css.
  const on = !!(b.logoUrl || b.name) && b.showLogo !== false;
  const alternate = on && b.placement === 'alternate';
  slot.classList.toggle('beside', on && !alternate);
  slot.classList.toggle('rotate', alternate);
  const cycle = `${Math.max(2, Number(b.rotateSec) || 6) * 2}s`;
  if (slot.style.getPropertyValue('--brand-cycle') !== cycle) {
    slot.style.setProperty('--brand-cycle', cycle);
  }
}

// ---------------------------------------------------------------- motion helpers

// Transient animation classes are stripped once their animation finishes, so the
// next change can re-trigger them and so a later class never shadows an earlier
// element's `animation` shorthand. Only the rare, pseudo-element driven highlights
// still go through classes; hot per-value motion uses the Web Animations API below.
const TRANSIENT = ['sectick', 'wipe', 'pulse-lap',
                   'sweep-purple', 'sweep-accent', 'sweep-gain', 'sweep-lose'];
document.addEventListener('animationend', (ev) => {
  const el = ev.target;
  if (!el.classList) return;
  for (const c of TRANSIENT) el.classList.remove(c);
}, true);

// `restart` needs a forced reflow to replay a CSS animation. That is a synchronous
// layout, so it is reserved for the handful of highlights that fire a few times a
// minute — never for per-cell value changes.
function restart(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

const VALUE_KF = [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }];
const POP_KF = [{ transform: 'scale(1)' }, { transform: 'scale(1.16)', offset: .35 }, { transform: 'scale(1)' }];

/**
 * Write text only when it changed, and animate it when it does.
 * `anim` is 'value' | 'pop' | null. Both use WAAPI: opacity/transform only, and no
 * forced reflow — a row of cells updating no longer costs a layout flush each.
 */
function setText(el, value, anim = 'value') {
  const v = String(value ?? '');
  if (!el || el.textContent === v) return false;
  el.textContent = v;
  if (anim === 'value') el.animate(VALUE_KF, { duration: 300, easing: EASE });
  else if (anim === 'pop') el.animate(POP_KF, { duration: 420, easing: EASE });
  return true;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** Staggered entrance for a list of rows — used when a widget is switched on. */
function replayEnter(container, dir = -1) {
  if (!container) return;
  [...container.children].forEach((row, i) => {
    row.animate(
      [
        { opacity: 0, transform: `translateX(${dir * 30}px)` },
        { opacity: 1, transform: 'none' }
      ],
      { duration: 460, delay: 60 + i * 45, easing: EASE, fill: 'backwards' }
    );
  });
}

/**
 * Keyed list with FLIP reordering: rows are reused across renders so position
 * changes animate as an actual slide instead of a repaint.
 */
class KeyedList {
  constructor(container, { create, update, enterDir = -1 }) {
    this.container = container;
    this.create = create;
    this.update = update;
    this.enterDir = enterDir;
    this.nodes = new Map();
  }

  render(items, animate = true) {
    const c = this.container;
    if (!c) return;

    // FIRST: where is every existing row right now.
    // getBoundingClientRect forces a layout flush, so it is skipped whenever the
    // widget is hidden — there is nothing to see sliding anyway.
    const first = new Map();
    if (animate) {
      for (const [id, el] of this.nodes) {
        if (!el.classList.contains('leaving')) first.set(id, el.getBoundingClientRect().top);
      }
    }

    const seen = new Set();
    const fresh = [];

    for (const item of items) {
      seen.add(item.id);
      let el = this.nodes.get(item.id);
      if (!el) {
        el = this.create(item);
        this.nodes.set(item.id, el);
        fresh.push(el);
      }
      this.update(el, item, prev.get(item.id));
      c.appendChild(el);      // appendChild on an existing node moves it — this is the reorder
    }

    // rows for drivers that vanished from the classification
    for (const [id, el] of this.nodes) {
      if (seen.has(id) || el.classList.contains('leaving')) continue;
      el.classList.add('leaving');
      this.nodes.delete(id);
      el.animate(
        [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${this.enterDir * 40}px)` }],
        { duration: 320, easing: EASE }
      ).finished.then(() => el.remove()).catch(() => el.remove());
    }

    // LAST + INVERT + PLAY
    if (animate) for (const [id, el] of this.nodes) {
      const before = first.get(id);
      if (before == null) continue;
      const after = el.getBoundingClientRect().top;
      const dy = before - after;
      if (Math.abs(dy) < 0.5) continue;
      el.animate(
        [{ transform: `translateY(${dy}px)` }, { transform: 'none' }],
        { duration: 560, easing: EASE }
      );
    }

    // new rows fade in from the side
    if (animate) fresh.forEach((el, i) => {
      el.animate(
        [{ opacity: 0, transform: `translateX(${this.enterDir * 26}px)` }, { opacity: 1, transform: 'none' }],
        { duration: 420, delay: i * 40, easing: EASE, fill: 'backwards' }
      );
    });
  }
}

// ---------------------------------------------------------------- row builders

function tagsHTML(d, isFl, isPb) {
  /*
   * INV and the served-penalty badge exist so the live order is never mistaken for the
   * result. A car under investigation, or carrying five seconds it has not yet paid, is
   * still shown where it physically is — the badge is what tells the viewer that place
   * may not survive the flag.
   */
  // Black first: it outranks everything else a row can say about a driver.
  return `${d.blackFlag ? '<span class="tag black">BLACK</span>' : ''}` +
         `${d.blueFlag ? '<span class="tag blue">BLUE</span>' : ''}` +
         `${d.penaltyPending ? '<span class="tag inv">INV</span>' : ''}` +
         `${d.penaltyServed ? `<span class="tag pen">+${d.penaltyServed}s</span>` : ''}` +
         `${d.pit ? '<span class="tag pit">PIT</span>' : ''}` +
         `${isFl ? '<span class="tag fl">FL</span>' : isPb ? '<span class="tag pb">PB</span>' : ''}`;
}

function applyTags(el, d, isFl, isPb) {
  const sig = `${d.blackFlag ? 'K' : ''}${d.blueFlag ? 'B' : ''}${d.penaltyPending ? 'i' : ''}${d.penaltyServed || 0}${d.pit ? 'p' : ''}${isFl ? 'f' : ''}${isPb ? 'b' : ''}`;
  if (el.dataset.sig === sig) return;
  el.dataset.sig = sig;
  el.innerHTML = tagsHTML(d, isFl, isPb);
}

/** The little ▲2 / ▼1 marker that rides next to the position number. */
function showDelta(el, moved) {
  const delta = el.querySelector('.delta');
  if (!delta) return;
  delta.textContent = `${moved > 0 ? '▲' : '▼'}${Math.abs(moved)}`;
  delta.classList.remove('up', 'down');
  void delta.offsetWidth;
  delta.classList.add(moved > 0 ? 'up' : 'down');
}

/**
 * Split pips, coloured the way a timing screen does it:
 *   purple = fastest anyone has run this sector, green = the driver's own best,
 *   yellow = neither, dim = not set yet this lap.
 */
function sectorClasses(d) {
  // Sector count comes from the calibrated sector lines when vision is driving, but also from
  // the data itself: the timing API delivers N splits with no lines drawn, so fall back to the
  // length of what we actually have (this driver's splits, its bests, or the session records).
  const lineSectors = (state.calibration?.lines || []).filter((l) => l.kind === 'sector').length + 1;
  const dataSectors = Math.max((d.sectors || []).length, (d.bestSectors || []).length, (state.records?.bestSectors || []).length);
  const nSectors = Math.max(1, lineSectors, dataSectors);
  const live = d.sectors || [];
  const lastLap = (d.lapSectors || [])[(d.lapSectors || []).length - 1] || [];
  const records = state.records?.bestSectors || [];
  const out = [];
  for (let i = 0; i < nSectors; i++) {
    const ms = live[i] ?? lastLap[i] ?? null;
    if (ms == null) { out.push(''); continue; }
    const rec = records[i];
    if (rec && rec.ms === ms && rec.driverId === d.id) out.push('best');
    else if ((d.bestSectors || [])[i] === ms) out.push('pb');
    else out.push('set');
  }
  return out;
}

function applySectors(box, d) {
  if (!box) return;
  const cls = sectorClasses(d);
  const sig = cls.join(',');
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  box.innerHTML = cls.map((c) => `<i class="${c}"></i>`).join('');
}

/** Shared per-row event motion: lap completed, position moved, new best lap. */
function applyRowEvents(el, d, was, bestCell) {
  if (!was) return;

  if (d.lapsDone > was.lapsDone) restart(el, 'pulse-lap');

  if (was.position && d.position !== was.position) {
    const moved = was.position - d.position;        // positive = gained places
    restart(el, moved > 0 ? 'sweep-gain' : 'sweep-lose');
    showDelta(el, moved);
  }

  if (bestCell && d.bestLap != null && (was.bestLap == null || d.bestLap < was.bestLap)) {
    restart(bestCell, 'sweep-purple');
  }
}

function createLbRow(d) {
  const el = document.createElement('div');
  el.className = 'lb-row';
  el.dataset.id = d.id;
  el.innerHTML = `
    <div class="pos"><span class="posnum"></span><span class="delta"></span></div>
    <div class="bar"></div>
    <div class="logo"><span></span></div>
    <div class="num"></div>
    <div class="name"><span class="nm"></span><span class="tags"></span><small></small></div>
    <div class="gap"></div>`;
  return el;
}

/** True when a fill is light enough that white text on it would not read. */
function isLightColor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  // perceived luminance (Rec. 601)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62;
}

/** The F1 tower reads the 3-letter code, not the full surname; every other skin uses the name. */
function rowName(d) {
  const skin = state.overlay.skin;
  return (skin === 'f1' || skin === 'dtm') ? (d.short || d.name || '').toUpperCase() : d.name;
}

/** Short team/manufacturer badge for the WEC-skin colour box: a code, not a logo file. */
function teamBadge(d) {
  if (d.short && d.short.trim()) return d.short.trim().toUpperCase().slice(0, 4);
  const t = (d.team || '').trim();
  if (t) {
    const words = t.split(/\s+/);
    return (words.length > 1 ? words.map((w) => w[0]).join('') : t.slice(0, 3)).toUpperCase().slice(0, 4);
  }
  return d.num || '';
}

function updateLbRow(el, d, was) {
  const fl = fastestLap(state);
  const isFl = !!fl && fl.id === d.id && d.bestLap != null;
  const isPb = d.lastLap != null && d.bestLap != null && d.lastLap === d.bestLap && d.lapsDone > 1;

  el.style.setProperty('--c', d.color);
  el.classList.toggle('dnf', !!d.dnf);
  el.classList.toggle('p1', d.position === 1);
  el.classList.toggle('focus', state.overlay.focusDriverId === d.id);

  setText(el.querySelector('.posnum'), d.position, 'pop');
  setText(el.querySelector('.num'), d.num, null);
  setText(el.querySelector('.logo span'), teamBadge(d), null);
  el.querySelector('.logo').classList.toggle('on-light', isLightColor(d.color));
  setText(el.querySelector('.nm'), rowName(d), null);
  setText(el.querySelector('.name small'), d.team || d.car || '', null);
  applyTags(el.querySelector('.tags'), d, isFl, isPb);

  const gapEl = el.querySelector('.gap');
  gapEl.classList.toggle('leader', d.position === 1);
  // A tilde says this place is inferred from pace, not measured at a timing point.
  setText(gapEl, d.predicted && d.position > 1 ? '~' + d.gap : d.gap, 'value');

  applyRowEvents(el, d, was, null);
  if (was && isPb && d.lastLap !== was.lastLap) restart(el.querySelector('.gap'), 'sweep-accent');
}

function createTwRow(d) {
  const el = document.createElement('div');
  el.className = 'tw-row';
  el.dataset.id = d.id;
  el.innerHTML = `
    <div class="pos"><span class="posnum"></span><span class="delta"></span></div>
    <div class="bar"></div>
    <div class="logo"><span></span></div>
    <div class="num"></div>
    <div class="name"><span class="nm"></span><span class="tags"></span></div>
    <div class="sec"><i></i><i></i><i></i></div>
    <div class="t last"></div>
    <div class="t best"></div>
    <div class="t int"></div>`;
  return el;
}

function updateTwRow(el, d, was) {
  const fl = fastestLap(state);
  const isFl = !!fl && fl.id === d.id && d.bestLap != null;
  const isPb = d.lastLap != null && d.bestLap != null && d.lastLap === d.bestLap && d.lapsDone > 1;

  el.style.setProperty('--c', d.color);
  el.classList.toggle('dnf', !!d.dnf);
  el.classList.toggle('p1', d.position === 1);

  setText(el.querySelector('.posnum'), d.position, 'pop');
  setText(el.querySelector('.logo span'), teamBadge(d), null);
  el.querySelector('.logo').classList.toggle('on-light', isLightColor(d.color));
  setText(el.querySelector('.num'), d.num, null);
  setText(el.querySelector('.nm'), rowName(d), null);
  applyTags(el.querySelector('.tags'), d, isFl, isPb);

  applySectors(el.querySelector('.sec'), d);

  const lastCell = el.querySelector('.t.last');
  const bestCell = el.querySelector('.t.best');
  lastCell.classList.toggle('strong', isPb);
  setText(lastCell, d.lastLap != null ? fmtTime(d.lastLap) : '--:--.---', 'value');
  setText(bestCell, d.bestLap != null ? fmtTime(d.bestLap) : '--:--.---', null);
  setText(el.querySelector('.t.int'), d.interval || '', 'value');

  applyRowEvents(el, d, was, bestCell);
}

const lists = {};

// ---------------------------------------------------------------- widgets

function show(id, on) {
  const el = els[id];
  if (!el) return;
  const visible = !!on || forced;
  const changed = shown[id] !== visible;
  shown[id] = visible;
  el.classList.toggle('on', visible);
  if (changed && visible) {
    if (id === 'leaderboard') replayEnter(document.getElementById('lbRows'), -1);
    if (id === 'tower') replayEnter(document.getElementById('twRows'), 1);
  }
}

function renderStatus(rows) {
  const [color, dark] = FLAG_COLOR[state.race.status] || FLAG_COLOR.idle;
  const pill = document.getElementById('flagPill');
  pill.style.setProperty('--flag', color);
  pill.classList.toggle('dark', dark);
  document.getElementById('flagText').textContent = FLAG_LABEL[state.race.status] || '--';
  if (prevFlag !== null && prevFlag !== state.race.status) restart(pill, 'wipe');
  prevFlag = state.race.status;

  setText(document.getElementById('stEvent'), `${state.event.name} — ${state.event.round}`, 'value');

  const lapSeg = (document.getElementById('stLap') || {}).closest ? document.getElementById('stLap').closest('.seg') : null;
  const clockK = document.getElementById('stClockK');
  const timed = isTimedSession();
  if (timed) {
    // practice / qualifying: no lap counter, and the time seg counts DOWN to the end
    if (lapSeg) lapSeg.style.display = 'none';
    if (clockK) clockK.textContent = 'Time left';
  } else {
    if (lapSeg) lapSeg.style.display = '';
    if (clockK) clockK.textContent = 'Race time';
    const ll = leaderLap(state);
    const lapText = state.race.totalLaps > 0
      ? `${Math.min(ll + (state.race.status === 'green' ? 1 : 0), state.race.totalLaps)} / ${state.race.totalLaps}`
      : String(ll);
    setText(document.getElementById('stLap'), lapText, 'pop');
  }
  const clockEl = document.getElementById('stClock');
  if (clockEl) setText(clockEl, timed && (state.race.timeLimitSec || 0) > 0 ? fmtClock(sessionRemaining()) : fmtClock(raceElapsed(state)), 'value');

  const fl = fastestLap(state);
  const flEl = document.getElementById('stFl');
  if (setText(flEl, fl ? fmtTime(fl.bestLap) : '--:--.---', 'value') && fl) restart(flEl, 'sweep-purple');
}

function renderLowerThird(rows) {
  const d = rows.find((x) => x.id === state.overlay.focusDriverId) || rows[0];
  if (!d) return;
  const bar = document.getElementById('l3bar');
  bar.style.background = d.color;
  bar.style.setProperty('--c', d.color);
  setText(document.getElementById('l3kicker'), `P${d.position} · ${d.team || state.event.track}`, 'value');
  setText(document.getElementById('l3name'), d.name, 'value');

  const meta = document.getElementById('l3meta');
  const html = [
    `CAR <b>${esc(d.car || d.num)}</b>`,
    `LAP <b>${d.lapsDone}</b>`,
    `BEST <b>${d.bestLap != null ? fmtTime(d.bestLap) : '--'}</b>`,
    `LAST <b>${d.lastLap != null ? fmtTime(d.lastLap) : '--'}</b>`
  ].join('');
  if (meta.dataset.sig !== html) {
    meta.dataset.sig = html;
    meta.innerHTML = html;
    restart(meta, 'value');
  }
}

function renderGap(rows) {
  const focus = rows.find((x) => x.id === state.overlay.focusDriverId) || rows[1] || rows[0];
  const ahead = focus ? rows.find((x) => x.position === focus.position - 1) : null;
  if (!focus || !ahead) return;

  setText(document.getElementById('gapA'), ahead.name, 'value');
  setText(document.getElementById('gapAsub'), `P${ahead.position}`, null);
  setText(document.getElementById('gapB'), focus.name, 'value');
  setText(document.getElementById('gapBsub'), `P${focus.position}`, null);

  const deltaMs = Math.max(0, focus.totalMs - ahead.totalMs);
  const valEl = document.getElementById('gapVal');
  setText(valEl, `+${(deltaMs / 1000).toFixed(3)}s`, 'value');

  // colour the number by whether the gap is shrinking or growing
  valEl.classList.remove('closing', 'opening');
  if (prevGapMs != null && Math.abs(deltaMs - prevGapMs) > 5) {
    valEl.classList.add(deltaMs < prevGapMs ? 'closing' : 'opening');
  }
  prevGapMs = deltaMs;

  const fill = document.getElementById('gapFill');
  fill.style.width = `${Math.max(4, 100 - Math.min(100, deltaMs / 50))}%`;
  fill.style.background = focus.color;
}

function renderResults(rows) {
  setText(document.getElementById('resTitle'), `${state.event.sessionName || 'RACE'} RESULT`, null);
  setText(document.getElementById('resSub'), `${state.event.name} · ${state.event.round} · ${state.event.track}`, null);
  const html = rows.map((d, i) => `
    <div class="res-row" style="--c:${d.color};--i:${i}">
      <div class="pos">P${d.position}</div>
      <div class="bar"></div>
      <div class="num">${esc(d.num)}</div>
      <div class="name">${esc(d.name)}<span style="color:var(--ink-mute);font-weight:500;font-size:13px"> ${esc(d.team || '')}</span></div>
      <div class="t">${d.dnf ? (d.retired ? 'RET' : 'DNF') : d.position === 1 ? fmtTime(d.totalMs, { forceMinutes: true }) : esc(d.gap)}</div>
      <div class="t">${d.bestLap != null ? fmtTime(d.bestLap) : '--'}</div>
    </div>`).join('');
  const box = document.getElementById('resRows');
  if (box.dataset.sig !== html) {
    box.dataset.sig = html;
    box.innerHTML = html;
  }
}

/**
 * Live circuit map: the racing line the operator drew, with every car placed by the
 * progress the tracker reports. Cheap to draw — one polyline plus one dot per car.
 */
let tmPathSig = '';

function renderTrackMap(rows) {
  const svg = document.getElementById('tmSvg');
  if (!svg) return;
  // A hand-traced path wins, but the detector's own learned circuit means the map can
  // draw itself on a track nobody has traced.
  const cal = state.calibration || {};
  const pts = (cal.trackPath && cal.trackPath.length) ? cal.trackPath : (cal.learnedPath || []);
  if (pts.length < 2) {
    if (tmPathSig !== 'empty') {
      tmPathSig = 'empty';
      svg.innerHTML = '<text x="50" y="52" text-anchor="middle" fill="rgba(255,255,255,.35)" font-size="7" font-family="Inter,sans-serif">draw a racing line</text>';
    }
    return;
  }

  // fit whatever shape was drawn into the viewBox, keeping its aspect ratio
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const p of pts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const pad = 8;
  const fit = (p) => ({
    x: pad + ((p.x - minX) / span) * (100 - pad * 2),
    y: pad + ((p.y - minY) / span) * (100 - pad * 2)
  });

  const sig = JSON.stringify(pts);
  if (tmPathSig !== sig) {
    tmPathSig = sig;
    const d = pts.map(fit).map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
    svg.innerHTML =
      `<path d="${d}" fill="none" stroke="rgba(255,255,255,.16)" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<path d="${d}" fill="none" stroke="rgba(255,255,255,.5)" stroke-width="1" stroke-dasharray="2 3"/>` +
      `<g id="tmCars"></g>`;
  }

  const path = buildPath(pts);
  const cars = document.getElementById('tmCars');
  if (!cars || !path) return;
  cars.innerHTML = rows.filter((d) => !d.dnf).map((d) => {
    const p = fit(pointAtProgress(path, d.progress || 0));
    const lead = d.position === 1;
    return `<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="${lead ? 3.4 : 2.8}" fill="${d.color}" stroke="${d.stopped ? '#ff453a' : '#05070a'}" stroke-width="${d.stopped ? 1.4 : 0.9}"/>`;
  }).join('');

  const sub = document.getElementById('tmSub');
  if (sub) sub.textContent = `${rows.filter((d) => !d.dnf).length} ON TRACK`;
}

/**
 * The battle on air: who is leading, which run, and how the judges have called it.
 *
 * Votes are shown as they land rather than only at the end. A tandem crowd argues about
 * the decision while it is being made, and a scoreboard that stays blank until the result
 * appears throws away the most interesting twenty seconds of the battle.
 */
function renderBattle() {
  const b = state.drift && state.drift.battle;
  const wrap = els.battle;
  if (!wrap) return;
  wrap.classList.toggle('empty', !b);
  if (!b) {
    setText(document.getElementById('btRound'), 'BATTLE', null);
    setText(document.getElementById('btRun'), '--', null);
    document.getElementById('btVotes').innerHTML = '';
    for (const k of ['A', 'B']) {
      const el = document.getElementById('bt' + k);
      el.querySelector('b').textContent = '--';
      el.querySelector('small').textContent = '';
    }
    return;
  }

  const round = (state.drift.bracket || [])[b.round];
  setText(document.getElementById('btRound'), round ? round.name : 'BATTLE', null);
  setText(document.getElementById('btRun'),
    b.status === 'decided' ? 'RESULT' : `RUN ${b.run}${b.omt ? ` · OMT ${b.omt}` : ''}`, 'value');

  const driver = (id) => (state.drivers || []).find((d) => d.id === id);
  for (const [k, who] of [['A', 'a'], ['B', 'b']]) {
    const d = driver(who === 'a' ? b.a : b.b);
    const el = document.getElementById('bt' + k);
    el.style.setProperty('--c', d ? d.color : '#666');
    el.classList.toggle('lead', b.status === 'running' && b.lead === who);
    el.classList.toggle('won', b.status === 'decided' && b.winner === (who === 'a' ? b.a : b.b));
    setText(el.querySelector('b'), d ? d.name : '--', null);
    setText(el.querySelector('small'),
      b.status === 'decided'
        ? (b.winner === (who === 'a' ? b.a : b.b) ? 'WINNER' : '')
        : (b.lead === who ? 'LEAD' : 'CHASE'),
      null);
  }

  const votes = document.getElementById('btVotes');
  const sig = JSON.stringify(b.votes) + b.status;
  if (votes.dataset.sig !== sig) {
    votes.dataset.sig = sig;
    votes.innerHTML = b.votes.map((v) => {
      const cls = v === 'a' ? 'a' : v === 'b' ? 'b' : v === 'omt' ? 'omt' : '';
      return `<i class="${cls}"></i>`;
    }).join('');
  }
}

/** The knockout tree, drawn as columns so it reads left to right like a printed draw. */
function renderBracket() {
  const box = document.getElementById('bkBody');
  if (!box) return;
  const D = state.drift || {};
  const rounds = D.bracket || [];
  const sig = JSON.stringify(rounds.map((r) => r.pairs)) + (D.champion || '');
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;

  if (!rounds.length) {
    box.innerHTML = '<div class="bk-empty">no bracket yet</div>';
    setText(document.getElementById('bkSub'), '--', null);
    return;
  }
  setText(document.getElementById('bkSub'), rounds[rounds.length - 1].name, 'value');

  const name = (id) => {
    const d = (state.drivers || []).find((x) => x.id === id);
    return d ? d.name : null;
  };
  const colour = (id) => {
    const d = (state.drivers || []).find((x) => x.id === id);
    return d ? d.color : 'rgba(255,255,255,.2)';
  };

  box.innerHTML = rounds.map((r) => `
    <div class="bk-col">
      <h5>${esc(r.name)}</h5>
      ${r.pairs.map((p) => `
        <div class="bk-pair">
          <div class="${p.winner === p.a ? 'w' : ''}"><i style="background:${colour(p.a)}"></i>${esc(name(p.a) || '—')}</div>
          <div class="${p.winner === p.b ? 'w' : ''}"><i style="background:${colour(p.b)}"></i>${esc(name(p.b) || (p.a ? 'BYE' : '—'))}</div>
        </div>`).join('')}
    </div>`).join('');
}

/**
 * The grid, drawn staggered the way a real one is painted.
 *
 * Two columns offset against each other, because a flat list reads as a leaderboard and
 * the viewer has to work out that it is a starting order instead. The stagger says it
 * without a caption.
 */
function renderGrid() {
  const box = document.getElementById('gdRows');
  if (!box) return;
  const grid = state.race.grid || [];
  const byId = new Map((state.drivers || []).map((d) => [d.id, d]));
  const sig = grid.join(',') + '|' + grid.map((id) => (byId.get(id) || {}).name).join(',');
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;

  setText(document.getElementById('gdSub'),
    grid.length ? `${grid.length} CARS` : 'NOT SET', 'value');

  if (!grid.length) {
    box.innerHTML = '<div class="gd-empty">grid not set</div>';
    return;
  }
  box.innerHTML = grid.map((id, i) => {
    const d = byId.get(id);
    if (!d) return '';
    return `<div class="gd-slot ${i % 2 ? 'right' : 'left'}">
      <span class="gd-pos">${i + 1}</span>
      <span class="gd-bar" style="background:${d.color}"></span>
      <span class="gd-num">${esc(d.num)}</span>
      <span class="gd-name">${esc(d.name)}</span>
    </div>`;
  }).join('');
}

/**
 * Two cars, compared where the difference actually comes from.
 *
 * A gap on its own says who is ahead and tells the viewer nothing about why. The split
 * times do: one car gains three tenths through the first sector and gives two back in the
 * last, and now the fight has a shape. Everything shown here is already measured — this
 * widget does no detection of its own, it only puts two columns of existing numbers next
 * to each other.
 */
let hhSeen = new Map();      // pair key -> last gap, for the closing / opening arrow

function pickPair(rows) {
  const cfg = (state.overlay && state.overlay.h2h) || { mode: 'auto' };
  const live = rows.filter((d) => !d.dnf);
  if (cfg.mode === 'manual') {
    const a = live.find((d) => d.id === cfg.a);
    const b = live.find((d) => d.id === cfg.b);
    return a && b && a !== b ? [a, b] : null;
  }
  // The closest fight, not the front of the field (shared with the console's auto-director).
  const f = closestFight(live);
  return f ? [f.a, f.b] : null;
}

function renderH2H(rows) {
  const box = document.getElementById('hhBody');
  if (!box) return;
  const pair = pickPair(rows);

  if (!pair) {
    if (box.dataset.sig !== 'none') {
      box.dataset.sig = 'none';
      box.innerHTML = '<div class="hh-empty">no battle to show</div>';
      setText(document.getElementById('hhSub'), '--', null);
    }
    return;
  }

  const [a, b] = pair;
  const pace = (b.lastLap > 0 && b.lastLap) || (a.lastLap > 0 && a.lastLap) || 0;
  const gapMs = Math.abs((a.livePos || 0) - (b.livePos || 0)) * pace;

  // Closing or opening, from where the gap was a moment ago. A tenth either way is noise
  // on a live estimate, so the arrow only appears once the change is real.
  const key = a.id + '|' + b.id;
  const prev = hhSeen.get(key);
  let trend = '';
  if (prev != null && Math.abs(gapMs - prev) > 100) trend = gapMs < prev ? 'closing' : 'opening';
  hhSeen.set(key, gapMs);
  if (hhSeen.size > 40) hhSeen = new Map([[key, gapMs]]);

  const lineSectors = (state.calibration?.lines || []).filter((l) => l.kind === 'sector').length + 1;
  const dataSectors = Math.max((a.bestSectors || []).length, (b.bestSectors || []).length, (state.records?.bestSectors || []).length);
  const nSectors = Math.max(1, lineSectors, dataSectors);
  const cell = (ms) => (ms == null ? '--' : fmtGap(ms));
  const rowsHtml = [];

  for (let i = 0; i < nSectors; i++) {
    const av = (a.bestSectors || [])[i];
    const bv = (b.bestSectors || [])[i];
    const aWin = av != null && bv != null && av < bv;
    const bWin = av != null && bv != null && bv < av;
    const delta = av != null && bv != null ? Math.abs(av - bv) : null;
    rowsHtml.push(`<div class="hh-row">
      <span class="hh-v ${aWin ? 'win' : ''}">${cell(av)}</span>
      <span class="hh-k">S${i + 1}<i>${delta == null ? '' : '+' + fmtGap(delta)}</i></span>
      <span class="hh-v ${bWin ? 'win' : ''}">${cell(bv)}</span>
    </div>`);
  }

  const lapRow = (label, av, bv) => {
    const aWin = av != null && bv != null && av < bv;
    const bWin = av != null && bv != null && bv < av;
    return `<div class="hh-row strong">
      <span class="hh-v ${aWin ? 'win' : ''}">${av == null ? '--' : fmtTime(av)}</span>
      <span class="hh-k">${label}</span>
      <span class="hh-v ${bWin ? 'win' : ''}">${bv == null ? '--' : fmtTime(bv)}</span>
    </div>`;
  };

  const head = (d, side) => `<div class="hh-name ${side}">
      <span class="hh-dot" style="background:${d.color}"></span>
      <span class="hh-num">${esc(d.num)}</span>
      <b>${esc(d.name)}</b>
    </div>`;

  const html =
    `<div class="hh-head">${head(a, 'l')}
       <div class="hh-gap"><b>${gapMs ? '+' + fmtGap(gapMs) : '--'}</b><i class="${trend}">${trend === 'closing' ? '▼ CLOSING' : trend === 'opening' ? '▲ OPENING' : ''}</i></div>
       ${head(b, 'r')}</div>` +
    rowsHtml.join('') +
    lapRow('LAST', a.lastLap, b.lastLap) +
    lapRow('BEST', a.bestLap, b.bestLap);

  const sig = html;
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  box.innerHTML = html;
  setText(document.getElementById('hhSub'), `P${a.position} v P${b.position}`, 'value');
}

/**
 * The championship table.
 *
 * Points are the number viewers actually track across a season, so they are the loud
 * element; the round count sits quietly beside them as the context for why one driver has
 * more. Ranks come from the server so the broadcast and the operator's screen can never
 * disagree about who is leading the title.
 */
function renderStandings() {
  const box = document.getElementById('stdRows');
  if (!box) return;
  const rows = (state.standings || []).slice(0, 12);
  const champ = state.championship || {};
  const sig = JSON.stringify(rows.map((r) => [r.rank, r.name, r.points, r.rounds])) + (champ.name || '');
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;

  setText(document.getElementById('stdTitle'), champ.name || 'CHAMPIONSHIP', null);
  setText(document.getElementById('stdSub'),
    (champ.rounds || []).length ? `AFTER ${(champ.rounds || []).length} ROUNDS` : 'NO ROUNDS YET', 'value');

  if (!rows.length) {
    box.innerHTML = '<div class="std-empty">no rounds scored yet</div>';
    return;
  }
  const lead = rows[0].points || 0;
  box.innerHTML = rows.map((r) => `
    <div class="std-row ${r.rank === 1 ? 'p1' : ''}">
      <span class="std-pos">${r.rank}</span>
      <span class="std-bar" style="background:${r.color || '#666'}"></span>
      <span class="std-name">${esc(r.name)}</span>
      <span class="std-gap">${r.rank === 1 ? '' : `-${lead - r.points}`}</span>
      <span class="std-pts">${r.points}</span>
    </div>`).join('');
}

/**
 * The line under the tower title.
 *
 * A running race shows "LAP x OF y" the way a broadcast does; anything else falls back to
 * the session name. Used by both skins — it is just better text — and it is what the
 * MotoGP header renders large.
 */
function isTimedSession() {
  const m = state.event.sessionType || 'race';
  // Practice + qualifying + endurance all run to a clock (countdown), not a lap count.
  return m === 'qualifying' || m === 'practice' || m === 'endurance';
}
function sessionRemaining() {
  const r = state.race;
  return Math.max(0, (r.timeLimitSec || 0) * 1000 - raceElapsed(state));
}

function headerLine() {
  const r = state.race, mode = (state.event.sessionType || 'race'), skin = state.overlay.skin || 'classic';
  if (skin === 'wec') return wecClock();
  // Practice and qualifying run to a clock, not a lap count — every skin shows the time
  // remaining in the session (or the session name until a limit is set).
  if (isTimedSession()) {
    if ((r.timeLimitSec || 0) > 0) return fmtClock(sessionRemaining());
    return state.event.sessionName || mode.toUpperCase();
  }
  if (mode === 'race' && r.startedAt && r.totalLaps > 0) {
    return `LAP ${Math.min(leaderLap(state) + 1, r.totalLaps)} OF ${r.totalLaps}`;
  }
  return state.event.sessionName || mode.toUpperCase();
}

function wecClock() {
  const r = state.race;
  const limit = (r.timeLimitSec || 0) * 1000;
  if (limit > 0) return fmtClock(Math.max(0, limit - raceElapsed(state)));
  return fmtClock(raceElapsed(state));
}

/** The header wordmark (operator-set on branded skins) and the MotoGP session-progress bar. */
function skinDefaultTitle(skin) { return skin === 'wec' ? 'WEC' : skin === 'motogp' ? 'MOTOGP' : skin === 'f1' ? 'F1' : skin === 'dtm' ? 'DTM' : skin === 'imsa' ? 'IMSA' : skin === 'gtwc' ? 'GTWC' : skin === 'indycar' ? 'INDYCAR' : skin === 'nascar' ? 'NASCAR' : skin === 'porsche' ? 'PORSCHE' : ''; }
function updateSkinHeader() {
  if (!state) return;
  const skin = state.overlay.skin || 'classic';
  const custom = (state.overlay.towerTitle || '').trim();
  const branded = ['wec', 'motogp', 'f1', 'dtm', 'fe', 'gtwc', 'imsa', 'indycar', 'nascar', 'porsche'].includes(skin);
  // Formula E titles the panel with the session (RACE / QUALIFYING …); GTWC with the event
  // name (e.g. SUZUKA 1000KM). A custom title always wins.
  const feTitle = () => custom || (state.event.sessionName || (state.event.sessionType || 'race').toUpperCase());
  const lbT = document.querySelector('#leaderboard .card-head .title');
  const twT = document.querySelector('#tower .card-head .title');
  const title = (skin === 'fe' || skin === 'porsche') ? feTitle()
    : (skin === 'gtwc' || skin === 'imsa' || skin === 'nascar') ? (custom || state.event.name || skinDefaultTitle(skin))
    : (custom || skinDefaultTitle(skin));
  if (lbT) lbT.textContent = branded ? title : 'Leaderboard';
  if (twT) twT.textContent = branded ? title : 'Timing';
  // Session progress (0..1) drives the MotoGP qualifying-style bar under the wordmark; with
  // no time limit it is full, so the bar simply reads as the accent line.
  const lim = (state.race.timeLimitSec || 0) * 1000;
  let prog = 1;
  if (lim > 0) prog = Math.min(1, raceElapsed(state) / lim);
  else if (state.race.totalLaps > 0) prog = Math.min(1, leaderLap(state) / state.race.totalLaps);
  for (const h of [document.querySelector('#leaderboard .card-head'), document.querySelector('#tower .card-head')]) {
    if (h) h.style.setProperty('--prog', prog);
  }
}

/** The fastest-lap banner: whoever holds the best lap, in their team colour. */
function renderFastLap() {
  const fl = fastestLap(state);
  const nameEl = document.getElementById('flName');
  const timeEl = document.getElementById('flTime');
  const box = document.getElementById('fastlap');
  if (!nameEl || !timeEl || !box) return;
  if (!fl || fl.bestLap == null) {
    setText(nameEl, '—', null);
    setText(timeEl, '--:--.---', null);
    box.style.setProperty('--c', '#b026ff');
    return;
  }
  setText(nameEl, fl.name, null);
  setText(timeEl, fmtTime(fl.bestLap), 'value');
  box.style.setProperty('--c', fl.color || '#b026ff');
}

/**
 * The sector-times card for the focus driver (or the leader): each sector coloured by how
 * good it is — session best (purple), personal best (green) or simply set (yellow) — the way
 * the F1 timing graphic breaks a lap down.
 */
function renderSectors(rows) {
  const box = document.getElementById('sectors');
  const nameEl = document.getElementById('scName');
  const lapEl = document.getElementById('scLap');
  const cells = document.getElementById('scCells');
  if (!box || !nameEl || !cells) return;
  const focus = state.overlay.focusDriverId;
  const d = (focus && rows.find((r) => r.id === focus)) || rows[0];
  if (!d) { nameEl.textContent = '—'; if (lapEl) lapEl.textContent = ''; cells.innerHTML = ''; return; }
  box.style.setProperty('--c', d.color || '#888');
  setText(nameEl, rowName(d), null);
  const lastLap = (d.lapSectors || [])[(d.lapSectors || []).length - 1] || d.sectors || [];
  const cls = sectorClasses(d);
  const n = Math.max(cls.length, lastLap.length, 3);
  let html = '';
  for (let i = 0; i < n; i++) {
    const ms = lastLap[i] ?? (d.sectors || [])[i] ?? null;
    html += `<div class="sc-cell ${cls[i] || ''}"><span class="sc-lab">S${i + 1}</span>` +
            `<span class="sc-t">${ms != null ? fmtTime(ms) : '--.---'}</span></div>`;
  }
  cells.innerHTML = html;
  if (lapEl) setText(lapEl, d.lastLap != null ? fmtTime(d.lastLap) : '--:--.---', 'value');
}

/**
 * The time-attack delta card: the focus driver's last lap against their own best, overall
 * and per sector. Green means they improved that split, red means they lost time. This is
 * the natural read for Contest mode, where the race is each driver chasing their best lap.
 */
function renderDelta(rows) {
  const box = document.getElementById('delta');
  const nameEl = document.getElementById('dtName');
  const lapEl = document.getElementById('dtLap');
  const cells = document.getElementById('dtCells');
  if (!box || !cells) return;
  const focus = state.overlay.focusDriverId;
  const d = (focus && rows.find((r) => r.id === focus)) || rows[0];
  if (!d) { if (nameEl) nameEl.textContent = '--'; if (lapEl) lapEl.textContent = ''; cells.innerHTML = ''; return; }
  box.style.setProperty('--c', d.color || '#888');
  setText(nameEl, rowName(d), null);

  const green = '#38d996';
  const red = '#ff5c7a';
  const dim = 'var(--ink-mute, #8b9099)';
  const signed = (ms) => (ms <= 0 ? '−' : '+') + fmtGap(Math.abs(ms));

  // Header: last lap, and its delta to the driver's own best lap.
  if (lapEl) {
    if (d.lastLap == null) { setText(lapEl, '--:--.---', 'value'); }
    else if (d.bestLap == null || d.lastLap === d.bestLap) { setText(lapEl, fmtTime(d.lastLap), 'value'); }
    else {
      const dl = d.lastLap - d.bestLap;
      lapEl.innerHTML = `${fmtTime(d.lastLap)} <b style="color:${dl < 0 ? green : red}">${signed(dl)}</b>`;
    }
  }

  // Per sector: the last lap's split against the driver's best split for that sector.
  // Prefer the last completed lap's splits (local path resets d.sectors to [] after a lap);
  // fall back to the in-progress sectors, which is what the external API feed populates.
  const live = (d.lapSectors || [])[(d.lapSectors || []).length - 1] || d.sectors || [];
  const pb = d.bestSectors || [];
  const n = Math.max(live.length, pb.length, 3);
  let html = '';
  for (let i = 0; i < n; i++) {
    const cur = live[i];
    const best = pb[i];
    let inner;
    if (cur == null) inner = `<span class="sc-t" style="color:${dim}">--.---</span>`;
    else if (best == null) inner = `<span class="sc-t">${fmtTime(cur)}</span>`;
    else inner = `<span class="sc-t" style="color:${(cur - best) <= 0 ? green : red}">${signed(cur - best)}</span>`;
    html += `<div class="sc-cell"><span class="sc-lab">S${i + 1}</span>${inner}</div>`;
  }
  cells.innerHTML = html;
}

/** A QR code linking to the public live page, so viewers can follow + vote from their seat. */
function renderQR() {
  const img = document.getElementById('qrImg');
  if (!img) return;
  const code = params.get('event');
  if (!code) { img.removeAttribute('src'); return; }
  const url = `${location.origin}/live?event=${encodeURIComponent(code)}`;
  const src = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=0&data=${encodeURIComponent(url)}`;
  if (img.getAttribute('src') !== src) img.setAttribute('src', src);
}

/** The sponsor rotator: shows one sponsor at a time; the console advances the index. */
function renderSponsor() {
  const el = document.getElementById('spBody');
  if (!el) return;
  const list = state.overlay.sponsors || [];
  if (!list.length) { el.textContent = ''; return; }
  const item = list[(state.overlay.sponsorIndex || 0) % list.length] || {};
  if (item.logo) {
    el.innerHTML = `<img src="${String(item.logo).replace(/"/g, '&quot;')}" alt="${String(item.label || '').replace(/"/g, '&quot;')}">`;
  } else {
    el.textContent = item.label || '';
  }
}

/** The pre-show countdown: time left to the target moment, or 00:00 once it passes. */
function renderCountdown() {
  const t = document.getElementById('cdTime');
  const l = document.getElementById('cdLabel');
  if (!t) return;
  const cd = state.overlay.countdown || {};
  if (l) l.textContent = cd.label || 'STARTS IN';
  const rem = Math.max(0, (cd.target || 0) - Date.now());
  t.textContent = fmtClock(rem);
}

/** The driver intro card: the focus driver (or leader) big — number, name, team, points. */
function renderIntro(rows) {
  const focus = state.overlay.focusDriverId;
  const d = (focus && (rows || []).find((r) => r.id === focus)) || (rows || [])[0];
  const numEl = document.getElementById('inNum');
  const nameEl = document.getElementById('inName');
  const teamEl = document.getElementById('inTeam');
  const ptsEl = document.getElementById('inPts');
  const box = document.getElementById('intro');
  if (!numEl || !nameEl || !box) return;
  if (!d) { numEl.textContent = '--'; nameEl.textContent = '--'; if (teamEl) teamEl.textContent = ''; if (ptsEl) ptsEl.textContent = ''; return; }
  box.style.setProperty('--c', d.color || '#888');
  numEl.textContent = d.num || '';
  nameEl.textContent = d.name || '';
  if (teamEl) teamEl.textContent = d.team || d.car || '';
  const row = (state.standings || []).find((s) => s.driverId === d.id);
  if (ptsEl) ptsEl.textContent = row ? `${row.points} PTS` : '';
  const photo = document.getElementById('inPhoto');
  if (photo) {
    if (d.photo) { if (photo.getAttribute('src') !== d.photo) photo.setAttribute('src', d.photo); photo.hidden = false; }
    else { photo.hidden = true; photo.removeAttribute('src'); }
  }
}

/** The audience-poll card: the question and a live bar per option, from the vote tally. */
function renderPoll() {
  const p = (state.overlay && state.overlay.poll) || {};
  const q = document.getElementById('pollQ');
  const bars = document.getElementById('pollBars');
  const totEl = document.getElementById('pollTotal');
  if (!q || !bars) return;
  q.textContent = p.question || 'WHO WINS?';
  const tally = state.votes || { counts: {}, total: 0 };
  const counts = tally.counts || {};
  const total = tally.total || 0;
  if (totEl) totEl.textContent = total;
  const opts = p.options || [];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // winning option gets its bar brightened
  let topN = 0;
  for (const o of opts) topN = Math.max(topN, counts[o.id] || 0);
  bars.innerHTML = opts.map((o) => {
    const n = counts[o.id] || 0;
    const pct = total ? Math.round((n / total) * 100) : 0;
    const lead = n > 0 && n === topN;
    return `<div class="poll-row ${lead ? 'lead' : ''}"><span class="pr-l">${esc(o.label)}</span>` +
           `<span class="pr-bar"><i style="width:${pct}%;background:${o.color || '#888'}"></i></span>` +
           `<span class="pr-p">${pct}%</span></div>`;
  }).join('');
}

// Which driver-radio message the card is currently timing, and when this overlay first saw
// it (its own clock), so the on-screen window is immune to a skewed streaming-PC clock.
let radioSeenId = null;
let radioSeenAt = 0;

/**
 * The team-radio card. Two sources feed it, newest wins: a message a driver typed in the
 * phone app (state.radio, fresh for ~25s) or a quote the operator typed on the panel
 * (state.overlay.radio). The driver app is the live one — a real "BOX BOX BOX" from the
 * cockpit goes straight to air without the operator retyping it.
 */
function renderRadio() {
  const box = document.getElementById('radio');
  const nameEl = document.getElementById('rdName');
  const txt = document.getElementById('rdText');
  if (!box || !nameEl || !txt) return;

  const live = (state.radio || [])[0];
  // On screen at least 10s, longer for a long message (capped 20s), so it can be read.
  const holdMs = live && live.text ? Math.min(20000, Math.max(10000, live.text.length * 90 + 3000)) : 0;

  // A brand-new driver message: paint it and start the CSS auto-hide. The hide is CSS, not a
  // JS timer, because an OBS browser source freezes timers — a JS countdown never fired and the
  // card never left. The animation runs there regardless, fading the card after holdMs, so it
  // does not depend on another render ever arriving.
  if (live && live.text && live.id !== radioSeenId) {
    radioSeenId = live.id;
    radioSeenAt = Date.now();
    const d = state.drivers.find((x) => String(x.num) === String(live.num)) ||
              state.drivers.find((x) => (x.name || '').toUpperCase() === (live.from || '').toUpperCase());
    box.style.setProperty('--c', (d && d.color) || '#ff8000');
    setText(nameEl, live.from || live.team || 'TEAM', null);
    txt.textContent = `“${live.text}”`;
    box.style.animation = 'none';
    void box.offsetWidth;                      // reflow so the animation restarts for this message
    box.style.animation = `radioAutoHide ${holdMs}ms linear forwards`;
    return;
  }

  // Same driver message still current (not yet expired): leave it and its running fade alone.
  if (live && live.text && live.id === radioSeenId && (Date.now() - radioSeenAt < holdMs)) return;

  // No fresh driver message. An operator quote, if any, takes the card (and cancels the fade);
  // otherwise the card is left faded/empty by the animation above.
  const r = state.overlay.radio || {};
  if (r.text) {
    box.style.animation = '';
    const d = state.drivers.find((x) => x.id === r.driverId);
    box.style.setProperty('--c', (d && d.color) || '#ff8000');
    setText(nameEl, d ? (d.name || d.short || 'RADIO') : 'TEAM', null);
    txt.textContent = `“${r.text}”`;
  } else {
    txt.textContent = '';
  }
}

// ---------------------------------------------------------------- WEC class grouping

const WEC_CLASS_COLORS = {
  HYPERCAR: ['#e2001a', '#8a0511'], LMH: ['#e2001a', '#8a0511'], LMDH: ['#e2001a', '#8a0511'],
  LMP2: ['#0a3fb0', '#062a78'], LMP1: ['#0a3fb0', '#062a78'],
  LMGT3: ['#1fa82c', '#0c801b'], GT3: ['#1fa82c', '#0c801b'],
  LMGTE: ['#f08a00', '#a85f00'], GTE: ['#f08a00', '#a85f00'], GTAM: ['#f08a00', '#a85f00'],
  // IMSA classes
  GTP: ['#5b6470', '#2e343d'], GTDPRO: ['#e2001a', '#8a0511'], GTD: ['#1fa82c', '#0c801b'],
  LMP3: ['#0a3fb0', '#062a78'],
  // Super GT classes — the number box takes the class colour
  GT500: ['#e6e6e6', '#9a9a9a'], GT300: ['#ff7a00', '#a85f00']
};
function wecClassColor(name) { return WEC_CLASS_COLORS[(name || '').toUpperCase().replace(/\s+/g, '')] || null; }

/** Rows grouped by class in first-appearance order; position order kept inside each group. */
function wecGroup(rows) {
  const order = [], map = new Map();
  for (const d of rows) {
    const c = (d.carClass || '').trim() || '—';
    if (!map.has(c)) { map.set(c, []); order.push(c); }
    map.get(c).push(d);
  }
  return order.map((c) => ({ cls: c, rows: map.get(c) }));
}
function wecSort(rows) { return wecGroup(rows).flatMap((g) => g.rows); }

/**
 * Drop a class banner before each group and re-number the rows within their class. Cosmetic,
 * torn down and rebuilt each render like the GAP separator, and only for the WEC skin.
 */
function applyClassBanners(boxId, groups) {
  const box = document.getElementById(boxId);
  if (!box) return;
  box.querySelectorAll('.lb-classbanner').forEach((n) => n.remove());
  const single = groups.length === 1 && groups[0].cls === '—';
  for (const g of groups) {
    const col = wecClassColor(g.cls);
    g.rows.forEach((d, i) => {
      const row = box.querySelector(`[data-id="${d.id}"]`);
      if (!row) return;
      const pn = row.querySelector('.posnum');
      if (pn) pn.textContent = i + 1;
      // per-row class colour, used by the IMSA skin's number box
      row.style.setProperty('--cc', col ? col[0] : '#5b6470');
    });
    if (single) continue;
    const first = box.querySelector(`[data-id="${g.rows[0].id}"]`);
    if (!first) continue;
    const ban = Object.assign(document.createElement('div'), { className: 'lb-classbanner' });
    if (col) { ban.style.setProperty('--cb1', col[0]); ban.style.setProperty('--cb2', col[1]); }
    ban.textContent = g.cls;
    box.insertBefore(ban, first);
  }
}

/**
 * The "GAP x.xxx" divider a timing tower drops between the leading group and the rest.
 *
 * Managed by hand rather than through KeyedList, which only knows driver rows. It is a
 * MotoGP-skin flourish and race-only: it looks for the first real break in the top of the
 * order and marks it. Purely cosmetic, so it is torn down and rebuilt each render and never
 * touches the timing.
 */
function applyGapSeparator(rows) {
  const box = document.getElementById('lbRows');
  if (!box) return;
  const old = box.querySelector('.lb-gap');
  const motogp = document.documentElement.dataset.skin === 'motogp';
  const racing = (state.event.sessionType || 'race') === 'race' && state.race.startedAt;

  // Where the front group ends: the first interval over the threshold inside the top six,
  // between two cars on the same lap and neither predicted (a made-up gap is not a gap).
  let at = -1, val = '';
  if (motogp && racing) {
    for (let i = 1; i < Math.min(rows.length, 6); i++) {
      const a = rows[i - 1], b = rows[i];
      if (a.dnf || b.dnf || a.predicted || b.predicted) continue;
      if (a.totalMs == null || b.totalMs == null || b.lapsDone !== a.lapsDone) continue;
      const d = b.totalMs - a.totalMs;
      if (d > 900) { at = i; val = fmtGap(d); break; }
    }
  }

  if (at < 0) { if (old) old.remove(); return; }

  const before = box.children[at];      // the row that starts the second group
  if (!before) { if (old) old.remove(); return; }
  const sep = old || Object.assign(document.createElement('div'), { className: 'lb-gap' });
  sep.innerHTML = `<span class="lg-k">GAP</span><span class="lg-v">${val}</span>`;
  if (sep.nextSibling !== before || sep.parentNode !== box) box.insertBefore(sep, before);
}

/** The flag worth putting across the screen, or null when the race is just green. */
// ---------------------------------------------------------------- main render

/**
 * Everything the overlays actually draw, as one string. Vision pushes driver
 * `progress` several times a second and that changes nothing on screen, so without
 * this guard every overlay would rebuild and re-measure for no reason.
 */
function renderSignature(rows) {
  const o = state.overlay, e = state.event, r = state.race;
  let sig = `${JSON.stringify(o.layout)}|${JSON.stringify(o.style)}|${o.theme}|${o.skin}|${o.towerTitle || ''}|${o.nonce || 0}|${o.editSelected}|` +
            `${r.status}|${r.totalLaps}|${o.accent}|${o.focusDriverId}|` +
            `${o.show.leaderboard}${o.show.tower}${o.show.status}${o.show.lowerThird}${o.show.gap}${o.show.results}${o.show.fastlap}${o.show.sectors}${o.show.delta}${o.show.radio}|${JSON.stringify(o.radio||{})}|${(state.radio && state.radio[0] && state.radio[0].id) || 0}|${JSON.stringify(o.poll||{})}|${JSON.stringify(state.votes||{})}|${o.show.sponsor}${o.show.countdown}${o.show.intro}${o.show.qr}|${JSON.stringify(o.sponsors||[])}|${o.sponsorIndex}|${JSON.stringify(o.countdown||{})}|` +
            `${e.name}|${e.round}|${e.track}|${e.sessionType}|${e.sessionName}|${(o.ticker || []).join('~')}|` +
            `${o.autoTicker}|${(state.feed || [])[0]?.t || 0}|${JSON.stringify(state.records?.bestSectors || [])}|` +
            `${(state.calibration?.lines || []).length}|${state.overlay.show.trackmap ? ((state.calibration?.trackPath || []).length + (state.calibration?.learnedPath || []).length) : 0}|` +
            // battles are all state and no motion, so the whole thing is the signature
            `${JSON.stringify(state.drift?.battle || null)}|${(state.drift?.bracket || []).length}|` +
            `${JSON.stringify((state.drift?.bracket || []).map((r) => r.pairs.map((p) => p.winner)))}|${state.drift?.champion || ''}|` +
            `${(state.race.grid || []).join(',')}|` +
            `${JSON.stringify(state.overlay.h2h || null)}|` +
            `${state.overlay.theme}|${JSON.stringify(state.overlay.brand || null)}|` +
            `${(state.standings || []).map((r) => r.driverId + r.points).join(',')}`;
  for (const d of rows) {
    sig += `
${d.id}|${d.position}|${d.lapsDone}|${d.lastLap}|${d.bestLap}|${d.totalMs}` +
           `|${d.gap}|${d.interval}|${d.pit}|${d.dnf}|${d.retired}|${d.num}|${d.name}|${d.short}|${d.team}|${d.car}|${d.color}|${d.carClass}|${d.photo}` +
           `|${(d.sectors || []).join('.')}|${(d.bestSectors || []).join('.')}|${d.stopped}` +
           // Position round the lap moves constantly, so it is only part of the
           // signature for the widgets that actually draw it. The head to head does:
           // its gap and its closing arrow come from exactly this number, and leaving
           // it out froze the widget on whatever it showed first.
           `|${(state.overlay.show.trackmap || state.overlay.show.h2h) ? Math.round((d.livePos || 0) * 400) : 0}` +
           `|${d.penaltyPending ? 1 : 0}|${d.penaltyServed || 0}|${d.blueFlag ? 1 : 0}|${d.blackFlag ? 1 : 0}`;
  }
  return sig;
}

let lastSignature = null;

function render() {
  try { renderInner(); }
  catch (err) {
    // A render must never leave the overlay half-drawn. If anything throws, the signature
    // guard would otherwise remember the failed frame and skip the retry, freezing the
    // broadcast on a blank. So the guard is reset and the error surfaced, and the next
    // state push renders again from scratch.
    lastSignature = null;
    console.error('[overlay] render failed:', err && err.message || err);
  }
}

function renderInner() {
  if (!state) return;
  // A state that arrived without its overlay config (realtime can drop the oversized settings
  // jsonb) has nothing to draw from — skip the frame and keep the last good render rather than
  // throwing halfway. The next complete state (a realtime update that carried settings, or the
  // reconcile poll) renders normally.
  if (!state.overlay || !state.overlay.show) return;

  const rows = classification(state);
  const sig = renderSignature(rows);
  if (sig === lastSignature) return;
  lastSignature = sig;

  document.documentElement.style.setProperty('--accent', state.overlay.accent || '#00e0a4');
  applyStyle();
  applyBrand();
  applyLayout();
  if (editing) syncSelection();

  const vis = state.overlay.show;

  show('status', vis.status);
  show('leaderboard', vis.leaderboard);
  show('tower', vis.tower);
  show('lowerthird', vis.lowerThird);
  show('gap', vis.gap);
  show('results', vis.results);
  show('trackmap', vis.trackmap);
  show('battle', vis.battle);
  show('bracket', vis.bracket);
  show('grid', vis.grid);
  show('h2h', vis.h2h);
  show('standings', vis.standings);
  show('ticker', vis.ticker && tickerItems().length > 0);
  show('fastlap', vis.fastlap);
  if (shown.fastlap) renderFastLap();
  show('sectors', vis.sectors);
  if (shown.sectors) renderSectors(rows);
  show('delta', vis.delta);
  if (shown.delta) renderDelta(rows);
  show('radio', vis.radio);
  if (shown.radio) renderRadio();
  show('poll', vis.poll && !!(state.overlay.poll && state.overlay.poll.open));
  if (shown.poll) renderPoll();
  show('sponsor', vis.sponsor && (state.overlay.sponsors || []).length > 0);
  if (shown.sponsor) renderSponsor();
  show('countdown', vis.countdown);
  if (shown.countdown) renderCountdown();
  show('intro', vis.intro);
  if (shown.intro) renderIntro(rows);
  show('qr', vis.qr);
  if (shown.qr) renderQR();
  // A hidden widget still cost a full row diff on every state push. Nothing about it
  // is on screen, so skip the DOM entirely until it is shown again.
  // Class grouping (banners + per-class numbering) is shared by WEC and IMSA.
  const wec = ['wec', 'imsa', 'supergt'].includes(state.overlay.skin || 'classic');

  updateSkinHeader();

  if (els.leaderboard && shown.leaderboard) {
    lists.lb ||= new KeyedList(document.getElementById('lbRows'), { create: createLbRow, update: updateLbRow, enterDir: -1 });
    if (wec) {
      const groups = wecGroup(rows);
      lists.lb.render(wecSort(rows), true);
      applyClassBanners('lbRows', groups);
    } else {
      lists.lb.render(rows, true);
    }
    setText(document.getElementById('lbSub'), headerLine(rows), 'value');
    applyGapSeparator(rows);
  }

  if (els.tower && shown.tower) {
    lists.tw ||= new KeyedList(document.getElementById('twRows'), { create: createTwRow, update: updateTwRow, enterDir: 1 });
    if (wec) {
      const groups = wecGroup(rows);
      lists.tw.render(wecSort(rows), true);
      applyClassBanners('twRows', groups);
    } else {
      lists.tw.render(rows, true);
    }
    setText(document.getElementById('twSub'), headerLine(rows) || `${rows.length} CARS`, null);
  }

  if (els.status && shown.status) renderStatus(rows);
  if (els.lowerthird && shown.lowerthird) renderLowerThird(rows);
  if (els.gap && shown.gap) renderGap(rows);
  if (els.results && shown.results) renderResults(rows);
  if (els.trackmap && shown.trackmap) renderTrackMap(rows);
  if (els.battle && shown.battle) renderBattle();
  if (els.bracket && shown.bracket) renderBracket();
  if (els.grid && shown.grid) renderGrid();
  if (els.h2h && shown.h2h) renderH2H(rows);
  if (els.standings && shown.standings) renderStandings();

  if (els.ticker) {
    const items = tickerItems();
    const move = document.getElementById('tickerMove');
    const next = items.map((t) => `<span>${esc(t)}</span>`).join('');
    if (move.dataset.sig !== next) { move.dataset.sig = next; move.innerHTML = next + next; }
  }

  // snapshot for the next diff
  prev = new Map(rows.map((d) => [d.id, {
    position: d.position, lapsDone: d.lapsDone, bestLap: d.bestLap, lastLap: d.lastLap
  }]));
}

/** Manual ticker text wins; otherwise the race writes its own from the event feed. */
function tickerItems() {
  const manual = (state.overlay.ticker || []).filter(Boolean);
  if (manual.length) return manual;
  if (!state.overlay.autoTicker) return [];
  return (state.feed || []).slice(0, 8).map((e) => e.text).filter(Boolean);
}

// local clock tick so the race time is smooth without server spam
/**
 * The race clock, on a timer rather than an animation frame.
 *
 * It is derived from the green-flag timestamp, not accumulated, so it needs no frame
 * loop to stay correct — and a frame loop is exactly what stops when the browser
 * source is not being rendered. A quarter-second timer keeps a seconds display honest
 * for a fraction of the cost.
 */
function tick() {
  if (!state) return;
  const timed = isTimedSession() && (state.race.timeLimitSec || 0) > 0 && state.race.status !== 'finished';
  // The status clock counts up in a race, down in practice / qualifying.
  const el = document.getElementById('stClock');
  if (el) {
    const now = timed ? fmtClock(sessionRemaining()) : fmtClock(raceElapsed(state));
    if (now !== lastClock) { lastClock = now; el.textContent = now; restart(el, 'sectick'); }
  }
  // Tower / leaderboard header also ticks the session countdown each second.
  if (timed) {
    const lb = document.getElementById('lbSub');
    if (lb && shown.leaderboard) lb.textContent = headerLine();
    const tw = document.getElementById('twSub');
    if (tw && shown.tower) tw.textContent = headerLine();
  }
}

/**
 * Rehearsal: replay every animation on demand without touching race state, so the
 * operator can check the look before going live (and confirm motion is working at
 * all when the race is sitting idle).
 */
function playDemo() {
  lastSignature = null;
  for (const el of stage.querySelectorAll('.widget.on')) {
    el.classList.remove('on');
    void el.offsetWidth;
    el.classList.add('on');
  }
  replayEnter(document.getElementById('lbRows'), -1);
  replayEnter(document.getElementById('twRows'), 1);

  setTimeout(() => {
    const pill = document.getElementById('flagPill');
    if (pill) restart(pill, 'wipe');

    for (const box of [document.getElementById('lbRows'), document.getElementById('twRows')]) {
      if (!box) continue;
      const rows = [...box.children];

      rows.forEach((row, i) => {
        setTimeout(() => {
          const pos = row.querySelector('.posnum');
          if (pos) pos.animate(POP_KF, { duration: 420, easing: EASE });
          if (i === 0) {
            restart(row, 'pulse-lap');
          } else if (i % 2) {
            restart(row, 'sweep-gain');
            showDelta(row, 1);
          } else {
            restart(row, 'sweep-lose');
            showDelta(row, -1);
          }
          const best = row.querySelector('.t.best');
          if (best && i === 1) restart(best, 'sweep-purple');
        }, i * 130);
      });

      // fake a position swap between P2 and P3 that puts itself back
      if (rows.length >= 3) {
        const h = rows[1].offsetHeight;
        const swap = (el, dy) => el.animate(
          [{ transform: 'none' }, { transform: `translateY(${dy}px)`, offset: .35 },
           { transform: `translateY(${dy}px)`, offset: .7 }, { transform: 'none' }],
          { duration: 2000, easing: EASE }
        );
        setTimeout(() => { swap(rows[1], h); swap(rows[2], -h); }, 420);
      }
    }
  }, 640);
}

// ---------------------------------------------------------------- layout editor

const SNAP = 8;

function selectedId() { return state && state.overlay.editSelected; }

function syncSelection() {
  const id = selectedId();
  for (const w of WIDGET_IDS) {
    if (els[w]) els[w].classList.toggle('sel', w === id);
  }
  const hud = document.getElementById('hudName');
  if (hud) hud.textContent = id ? (LABELS[id] || id) : 'nothing selected';
}

function hudPos(x, y, w) {
  const el = document.getElementById('hudPos');
  if (el) el.textContent = `x ${Math.round(x)}  y ${Math.round(y)}${w ? `  w ${Math.round(w)}` : ''}`;
}

/** Edges of every other widget, so widgets align to each other and not just the frame. */
function snapTargets(exceptId) {
  const xs = [0, STAGE_W / 2, STAGE_W, 48, STAGE_W - 48];
  const ys = [0, STAGE_H / 2, STAGE_H, 48, STAGE_H - 48];
  for (const id of WIDGET_IDS) {
    if (id === exceptId || !els[id]) continue;
    const r = els[id].getBoundingClientRect();
    xs.push(r.left, r.right, r.left + r.width / 2);
    ys.push(r.top, r.bottom, r.top + r.height / 2);
  }
  return { xs, ys };
}

/** Snap one axis. `edges` are the moving element's candidate edges in stage px. */
function snapAxis(edges, targets) {
  let best = null;
  for (const edge of edges) {
    for (const t of targets) {
      const d = t - edge;
      if (Math.abs(d) <= SNAP && (!best || Math.abs(d) < Math.abs(best.delta))) {
        best = { delta: d, line: t };
      }
    }
  }
  return best;
}

function drawGuides(lines) {
  const box = document.getElementById('guides');
  if (!box) return;
  box.innerHTML = lines.map((l) =>
    l.axis === 'v' ? `<div class="g v" style="left:${l.at}px"></div>`
                   : `<div class="g h" style="top:${l.at}px"></div>`).join('');
}

/** Current placement of a widget, measured from the DOM if it has never been saved. */
function layoutOf(id) {
  const l = (state.overlay.layout || {})[id];
  if (l && l.x != null && l.y != null) return { ...l };
  const r = els[id].getBoundingClientRect();
  return { x: Math.round(r.left), y: Math.round(r.top), w: 0, scale: 1 };
}

// The layout editor is embedded in the operator console as an iframe. On a hosted event
// the console writes state through an authenticated, per-scene RaceState + store; if this
// iframe wrote layout straight to Supabase too there would be two writers with different
// shapes, and the console's next write would clobber the drag back to nothing. So when
// embedded, editor actions are handed to the parent console, which is the single writer.
const embedded = editing && window.parent && window.parent !== window;
function editorAction(type, extra) {
  if (embedded) {
    try { window.parent.postMessage({ __frlEditor: true, type, extra }, location.origin); return; }
    catch (e) { /* fall through to a direct write */ }
  }
  bus.action(type, extra);
}

function commit(id, patch) {
  const clean = {};
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) clean[k] = v;
  editorAction('overlay.layout', { id, patch: clean });
}

function initEditor() {
  let sendAt = 0;

  stage.addEventListener('pointerdown', (ev) => {
    const el = ev.target.closest('.widget');
    if (!el) {
      editorAction('overlay.update', { patch: { editSelected: null } });
      return;
    }
    ev.preventDefault();
    editorAction('overlay.update', { patch: { editSelected: el.id } });

    const rect = el.getBoundingClientRect();
    const base = layoutOf(el.id);

    drag = {
      id: el.id,
      el,
      resizing: ev.target.classList.contains('rz'),
      startX: ev.clientX,
      startY: ev.clientY,
      originX: base.x,
      originY: base.y,
      originW: rect.width,
      scale: base.scale ?? 1,
      cur: { ...base }
    };
    el.classList.add('dragging');
    el.setPointerCapture(ev.pointerId);
  });

  stage.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    const dx = ev.clientX - drag.startX;
    const dy = ev.clientY - drag.startY;
    const rect = drag.el.getBoundingClientRect();
    const lines = [];

    if (drag.resizing) {
      // width is stored unscaled; the handle moves in scaled pixels
      const w = Math.max(160, Math.round((drag.originW + dx) / (drag.scale || 1)));
      drag.cur.w = w;
      drag.el.style.width = `${w}px`;
      hudPos(drag.cur.x, drag.cur.y, w);
    } else {
      let x = drag.originX + dx;
      let y = drag.originY + dy;

      if (!ev.altKey) {   // hold alt to bypass snapping
        const t = snapTargets(drag.id);
        const sx = snapAxis([x, x + rect.width / 2, x + rect.width], t.xs);
        const sy = snapAxis([y, y + rect.height / 2, y + rect.height], t.ys);
        if (sx) { x += sx.delta; lines.push({ axis: 'v', at: sx.line }); }
        if (sy) { y += sy.delta; lines.push({ axis: 'h', at: sy.line }); }
      }

      x = Math.round(Math.max(-200, Math.min(STAGE_W - 40, x)));
      y = Math.round(Math.max(-120, Math.min(STAGE_H - 30, y)));
      drag.cur.x = x;
      drag.cur.y = y;
      drag.el.style.left = `${x}px`;
      drag.el.style.top = `${y}px`;
      drag.el.style.right = 'auto';
      drag.el.style.bottom = 'auto';
      drag.el.style.transform = `scale(${drag.scale})`;
      hudPos(x, y, drag.cur.w);
    }

    drawGuides(lines);

    // stream sparsely so the panel's number fields follow without flooding the bus
    const now = performance.now();
    if (now - sendAt > 120) {
      sendAt = now;
      commit(drag.id, drag.resizing ? { w: drag.cur.w } : { x: drag.cur.x, y: drag.cur.y });
    }
  });

  const endDrag = () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    d.el.classList.remove('dragging');
    commit(d.id, { x: d.cur.x, y: d.cur.y, w: d.cur.w || undefined, scale: d.scale });
    drawGuides([]);
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  window.addEventListener('keydown', (ev) => {
    const id = selectedId();
    if (!id || !els[id]) return;
    const step = ev.shiftKey ? 10 : 1;
    const l = layoutOf(id);
    if (ev.key === 'ArrowLeft') l.x -= step;
    else if (ev.key === 'ArrowRight') l.x += step;
    else if (ev.key === 'ArrowUp') l.y -= step;
    else if (ev.key === 'ArrowDown') l.y += step;
    else return;
    ev.preventDefault();
    commit(id, { x: l.x, y: l.y });
  });
}

build();
if (editing) initEditor();
bus.on('signal', (channel) => { if (channel === 'overlay-demo') playDemo(); });
/*
 * Scene changes get a transition, everything else does not.
 *
 * A scene swap moves and hides several widgets at once. Letting each one animate on its
 * own produces a scramble — panels sliding past each other in different directions —
 * which reads as a glitch rather than a cut. Fading the whole stage through the swap
 * turns it into one deliberate move, the way a vision mixer would.
 *
 * The new state is applied only after the fade has covered the screen, so the rearrange
 * itself is never visible. Live timing keeps arriving during the fade and is simply drawn
 * when the stage comes back.
 */
let liveScene = null;
let sceneTimer = null;

/**
 * The scene-change stinger: a full-screen wipe in the accent colour with the series wordmark.
 * Driven by a CSS animation (not a timer) so it runs even in a windowless OBS source. Torn
 * down on animationend.
 */
let stingerEl = null;
function playStinger(s) {
  const stage = document.querySelector('.stage');
  if (!stage) return;
  if (!stingerEl) {
    stingerEl = document.createElement('div');
    stingerEl.className = 'stinger';
    stingerEl.innerHTML = '<div class="stinger-panel"></div><div class="stinger-word"></div>';
    stage.appendChild(stingerEl);
    stingerEl.addEventListener('animationend', (e) => { if (e.target === stingerEl) stingerEl.classList.remove('play'); });
  }
  const o = s.overlay || {};
  stingerEl.style.setProperty('--sting', o.accent || '#00e0a4');
  const word = (o.towerTitle || '').trim() || (s.event && s.event.name) || '';
  stingerEl.querySelector('.stinger-word').textContent = word;
  stingerEl.classList.remove('play');
  void stingerEl.offsetWidth;   // restart the animation
  stingerEl.classList.add('play');
}

/*
 * Coalesce renders to one per frame.
 *
 * Vision pushes a driver's progress several times a second, and each push arrives as a
 * fresh state. Rendering synchronously on every one means a full KeyedList diff — with the
 * layout flush its position animation needs — many times a second, even when nothing on
 * screen has meaningfully moved. On a machine already running the game, OBS's encoder and
 * the detector, that is the difference between instant and laggy.
 *
 * So the newest state is kept and a single render is scheduled on the next animation frame.
 * Several states collapsing into one frame is exactly the point, and nothing is lost: the
 * frame always draws the latest data.
 */
function applyState(s) {
  /*
   * Render synchronously on every state push.
   *
   * A timer-based throttle was tried here to cut the cost of frequent vision pushes, but an
   * OBS browser source renders windowless — the page counts as hidden, and a hidden page's
   * timers are frozen. The scheduled render never fired, so a flag or a layout change did
   * not reach the stream until the source was refreshed by hand. Correctness first: the
   * render is immediate. Its cost is kept down instead by the signature guard inside
   * renderInner(), which skips a frame that would draw the same thing.
   */
  state = s;
  render();
}

bus.on('state', (s) => {
  const scene = s.overlay && s.overlay.activeScene;
  const stageEl = document.querySelector('.stage');
  // A real scene change only: a state that arrived without overlay settings (realtime drops
  // the oversized jsonb on a flag change) reports no scene, and swapping "to nothing" must
  // never fire the stinger or a scene wipe. Ignore a falsy scene entirely.
  const changed = scene && liveScene !== null && scene !== liveScene;
  if (scene) liveScene = scene;

  if (!changed || !stageEl || editing) { applyState(s); return; }

  if (s.overlay.stinger !== false) playStinger(s);

  const half = Math.max(80, Math.min(1200, (s.overlay.transitionMs || 420))) / 2;
  stageEl.classList.add('scene-swap');
  clearTimeout(sceneTimer);
  sceneTimer = setTimeout(() => {
    // force a full rebuild: the signature guard would otherwise skip a swap that only
    // changed placement, and the new scene would arrive with the old layout
    lastSignature = null;
    applyState(state);
    stageEl.classList.remove('scene-swap');
  }, half);

  state = s;   // keep the newest data even while covered
});
setInterval(tick, 250);
tick();
