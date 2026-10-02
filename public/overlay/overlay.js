import { Bus, fmtTime, fmtGap, fmtClock, classification, raceElapsed, leaderLap, fastestLap, FLAG_LABEL, closestFight } from '../js/shared.js';
import { buildPath, pointAtProgress } from '../js/tracker.js';
import { CloudBus, cloudOptions } from '../js/cloudbus.js';
import { inSession } from '../js/timing.js';
import { pollTally } from '../js/chat.js';
import { designCss, googleFontsUrl, cleanStickers, resolveSrc, rowLimit, widgetTitle, TITLED } from '../js/design.js';

/*
 * Self-update, so OBS never runs stale code again.
 *
 * A Browser Source loads the page once and then never asks the server for anything again:
 * so a fix shipped to the server sits unused until someone reloads the source by hand, which
 * is exactly the trap that kept old overlay code live on stream. This checks a tiny version
 * stamp every 30s; when the deploy behind it changes, the page reloads itself. The stamp is
 * carried on this module's own URL (`overlay.js?v=VER`) and written to /version.txt by the
 * deploy, so the two only differ when a newer build is live. No URL to change, no manual
 * refresh: the source picks up the next deploy on its own within half a minute.
 */
(function autoUpdate() {
  let mine = '';
  try { mine = new URL(import.meta.url).searchParams.get('v') || ''; } catch (e) { /* no query */ }
  if (!mine) return;   // running unversioned (local dev): nothing to compare against
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

const WIDGET_IDS = ['status', 'leaderboard', 'tower', 'lowerthird', 'gap', 'results', 'trackmap', 'battle', 'bracket', 'grid', 'h2h', 'standings', 'ticker', 'fastlap', 'sectors', 'delta', 'radio', 'poll', 'sponsor', 'countdown', 'intro', 'qr', 'pit', 'lights', 'catching', 'rivalry', 'podium', 'reactions', 'racecontrol', 'incidents', 'driftsolo', 'driftq'];
const LABELS = {
  status: 'Status bar', leaderboard: 'Leaderboard', tower: 'Timing tower',
  lowerthird: 'Lower third', gap: 'Gap bar', results: 'Results',
  trackmap: 'Track map', battle: 'Tandem battle', bracket: 'Bracket',
  grid: 'Starting grid', h2h: 'Head to head', standings: 'Standings', ticker: 'Ticker',
  fastlap: 'Fastest lap', sectors: 'Sector times', delta: 'Delta / time attack', radio: 'Team radio', poll: 'Audience poll',
  sponsor: 'Sponsor', countdown: 'Countdown', intro: 'Driver intro', qr: 'QR code',
  pit: 'Pit lane', lights: 'Start lights', catching: 'Catching',
  rivalry: 'Rivalry', podium: 'Podium celebration', reactions: 'Crowd reactions',
  racecontrol: 'Race control', incidents: 'Incidents',
  driftsolo: 'Drift run', driftq: 'Drift qualifying'
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
  // A slightly off-white so the white flag reads as a flag against the panel. dark:false
  // keeps the pill's default dark lettering, since white text on a near-white pill vanishes.
  white: ['#f2f2f7', false],
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
let latestRows = [];        // last classification, for timer-driven cyclers (intro reveal)
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
          <div class="seg seg-lap"><div class="k" id="stLapK">Lap</div><div class="v" id="stLap">--</div></div>
          <div class="seg seg-clock"><div class="k" id="stClockK">Race time</div><div class="v" id="stClock">00:00</div></div>
          <div class="seg seg-fl"><div class="k">Fastest lap</div><div class="v" id="stFl">--:--.---</div></div>
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
          <div class="tw-head"><div class="h-pos">P</div><div class="h-bar"></div><div class="h-logo"></div><div class="h-num">#</div><div class="h-name">Driver</div><div class="sec-h h-sec">Sectors</div><div class="h-last" style="text-align:right">Last</div><div class="h-best" style="text-align:right">Best</div><div class="h-int" style="text-align:right">Int</div></div>
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
        <div class="gd-card" id="gdCard">
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
    driftsolo: `
      <div class="widget" id="driftsolo">
        <div class="card ds-card">
          <div class="ds-head"><span class="ds-tag">QUALIFYING</span><span class="ds-run" id="dsRun">RUN 1</span></div>
          <div class="ds-who"><i id="dsDot"></i><b id="dsName">--</b><span id="dsNum"></span></div>
          <div class="ds-body" id="dsBody"></div>
        </div>
      </div>`,
    driftq: `
      <div class="widget" id="driftq">
        <div class="card">
          <div class="card-head"><span class="tick"></span><span class="title">QUALIFYING</span><span class="sub" id="dqSub">--</span></div>
          <div class="dq" id="dqRows"></div>
        </div>
      </div>`,
    racecontrol: `
      <div class="widget" id="racecontrol">
        <div class="card rc-card">
          <div class="rc-tag"><i></i>RACE CONTROL</div>
          <div class="rc-main">
            <div class="rc-who"><span class="rc-num" id="rcNum"></span><span class="rc-name" id="rcName"></span><span class="rc-vs" id="rcVs"></span></div>
            <div class="rc-what" id="rcWhat"></div>
            <div class="rc-why" id="rcWhy"></div>
          </div>
        </div>
      </div>`,
    incidents: `
      <div class="widget" id="incidents">
        <div class="card inc-card">
          <div class="card-head"><span class="tick"></span><span class="title">UNDER INVESTIGATION</span><span class="sub" id="incSub"></span></div>
          <div class="inc-rows" id="incRows"></div>
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
          <div class="poll-q" id="pollQ">-</div>
          <div class="poll-bars" id="pollBars"></div>
          <div class="poll-foot"><b id="pollTotal">0</b> <span id="pollVotesLbl">votes</span></div>
        </div>
      </div>`,
    sponsor: `
      <div class="widget" id="sponsor">
        <div class="card sponsor-card">
          <span class="sp-k">SPONSOR</span>
          <span class="sp-body" id="spBody">-</span>
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
          <div class="intro-main"><div class="intro-name" id="inName">--</div><div class="intro-team" id="inTeam"></div><div class="intro-stats" id="inStats"></div></div>
          <div class="intro-pts" id="inPts"></div>
        </div>
      </div>`,
    qr: `
      <div class="widget" id="qr">
        <div class="card qr-card">
          <img id="qrImg" alt="QR">
          <div class="qr-cap">SCAN TO FOLLOW &amp; VOTE</div>
        </div>
      </div>`,
    pit: `
      <div class="widget" id="pit">
        <div class="pit-card" id="pitCard"><span class="pit-dot"></span><span class="label" id="pitLabel">PIT OPEN</span></div>
      </div>`,
    lights: `
      <div class="widget" id="lights">
        <div class="lights-gantry" id="lightsGantry">
          <span class="lb" data-i="0"></span><span class="lb" data-i="1"></span><span class="lb" data-i="2"></span><span class="lb" data-i="3"></span><span class="lb" data-i="4"></span>
        </div>
      </div>`,
    catching: `
      <div class="widget" id="catching">
        <div class="card catch-card">
          <div class="catch-tag">CATCHING</div>
          <div class="catch-line"><b id="catchWho">--</b> <span id="catchOn">--</span></div>
          <div class="catch-meta"><span id="catchRate">--</span><span id="catchLaps">--</span></div>
        </div>
      </div>`,
    rivalry: `
      <div class="widget" id="rivalry">
        <div class="card rival-card">
          <div class="rival-tag">CHAMPIONSHIP BATTLE</div>
          <div class="rival-row">
            <div class="rival-side"><span class="rival-pos" id="rvArank">--</span><span class="rival-name" id="rvAname">--</span><span class="rival-pts" id="rvApts">--</span></div>
            <div class="rival-vs">VS</div>
            <div class="rival-side r"><span class="rival-pos" id="rvBrank">--</span><span class="rival-name" id="rvBname">--</span><span class="rival-pts" id="rvBpts">--</span></div>
          </div>
          <div class="rival-note" id="rvNote">--</div>
        </div>
      </div>`,
    podium: `
      <div class="widget" id="podium">
        <div class="podium-wrap">
          <div class="confetti" id="podConfetti"></div>
          <div class="podium-title" id="podTitle">RACE RESULT</div>
          <div class="podium-cols" id="podCols"></div>
        </div>
      </div>`,
    reactions: `
      <div class="widget" id="reactions">
        <div class="react-wrap">
          <div class="react-float" id="reactFloat"></div>
          <div class="react-meter"><div class="react-fill" id="reactFill"></div></div>
          <div class="react-label" id="reactLabel">HYPE</div>
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
      '<div id="hud"><span id="hudName">-</span><span id="hudPos">-</span>' +
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
      // entry was reset: drop every inline placement so the stylesheet default
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
  // at once. Written as a data attribute for the same reason the theme is: one swap.
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
 * The custom design (design.js): one stylesheet appended after overlay.css, so equal
 * specificity wins over the template, plus the Google Fonts it names and the stickers.
 *
 * Checked before the render signature on purpose: a colour or a line of CSS changes
 * nothing the signature looks at, and the editor is only useful if every keystroke shows.
 * The key comparison keeps that cheap: the stylesheet is rebuilt only when it changed.
 */
let designKey = '';
// Stickers are free pictures for the one-source setup (all.html). A page that shows a
// single widget would repeat every sticker in every Browser Source, so they stay off there
// unless the URL asks for them with ?stickers=1.
const stickerPage = /\/all(\.html)?$/.test(location.pathname) || new URLSearchParams(location.search).get('stickers') === '1';

function applyDesign() {
  const o = state.overlay;
  const key = JSON.stringify([o.custom || null, o.assets || null, stickerPage ? (o.stickers || null) : null]);
  if (key === designKey) return;
  designKey = key;

  const { css, google } = designCss(o.custom, o.assets);
  let el = document.getElementById('frlDesign');
  if (!el) {
    el = document.createElement('style');
    el.id = 'frlDesign';
    document.head.appendChild(el);
  }
  // Kept last in <head>: the stylesheet link is added by the page loader after this
  // module starts, so re-append whenever something landed after it.
  if (el !== document.head.lastElementChild) document.head.appendChild(el);
  if (el.textContent !== css) el.textContent = css;
  document.documentElement.dataset.custom = o.custom && o.custom.on ? '1' : '';

  const href = googleFontsUrl(google);
  let link = document.getElementById('frlDesignFonts');
  if (href) {
    if (!link) {
      link = document.createElement('link');
      link.id = 'frlDesignFonts';
      link.rel = 'stylesheet';
      document.head.insertBefore(link, el);
    }
    if (link.getAttribute('href') !== href) link.setAttribute('href', href);
  } else if (link) link.remove();

  if (stickerPage) renderStickers(cleanStickers(o.stickers), o.assets);
  applyTitles(o.custom);
}

function applyTitles(custom) {
  // The leaderboard and tower titles belong to the skin header (it may write a wordmark).
  updateSkinHeader();
  for (const [id] of TITLED) {
    if (id === 'leaderboard' || id === 'tower') continue;
    const el = document.querySelector(`#${id} .card-head .title`);
    if (!el) continue;
    if (el.dataset.orig == null) el.dataset.orig = el.textContent;
    const want = widgetTitle(custom, id) || el.dataset.orig;
    if (el.textContent !== want) el.textContent = want;
  }
}

/** The rows a list widget may show: all of them unless the design studio set a top N. */
function limitRows(rows, key) {
  const n = rowLimit(state.overlay && state.overlay.custom, key);
  return n ? rows.slice(0, n) : rows;
}

function renderStickers(list, assets) {
  // Two layers: behind every widget and in front of them. The stage is positioned, so DOM
  // order is paint order, and neither layer needs a z-index that could fight the widgets.
  for (const front of [false, true]) {
    const id = front ? 'stickersFront' : 'stickersBack';
    let layer = document.getElementById(id);
    const mine = list.filter((x) => x.on && x.front === front);
    if (!mine.length) { if (layer) layer.remove(); continue; }
    if (!layer) {
      layer = document.createElement('div');
      layer.id = id;
      layer.className = 'sticker-layer';
      if (front) stage.after(layer); else stage.before(layer);
    }
    layer.innerHTML = mine.map((x) => {
      const src = resolveSrc(x.src, assets);
      if (!src) return '';
      return `<img class="sticker" alt="" src="${src}" style="left:${x.x}px;top:${x.y}px;width:${x.w}px;opacity:${x.opacity};transform:rotate(${x.rot}deg)">`;
    }).join('');
  }
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
  // CSS animation, so nothing here can interrupt it: see the note in overlay.css.
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
// minute: never for per-cell value changes.
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
 * forced reflow: a row of cells updating no longer costs a layout flush each.
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

/** Staggered entrance for a list of rows: used when a widget is switched on. */
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
    // widget is hidden: there is nothing to see sliding anyway.
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
      c.appendChild(el);      // appendChild on an existing node moves it: this is the reorder
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
   * still shown where it physically is: the badge is what tells the viewer that place
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
  // Knockout qualifying: out of the running (dimmed), and the last car through (the line).
  el.classList.toggle('ko-out', !!d.koOut);
  el.classList.toggle('ko-cut', !!d.koCut);
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
  // Knockout qualifying: out of the running (dimmed), and the last car through (the line).
  el.classList.toggle('ko-out', !!d.koOut);
  el.classList.toggle('ko-cut', !!d.koCut);

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

  setText(document.getElementById('stEvent'), `${state.event.name} · ${state.event.round}`, 'value');

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
  // In endurance, the car may be handed between co-drivers. Show whoever is driving now,
  // with the car/team as the kicker, so the lower third names the person on track.
  const st = state.stints && state.stints[d.id];
  const current = (st && st.length) ? st[st.length - 1].name : null;
  setText(document.getElementById('l3kicker'), current ? `P${d.position} · ${d.name}` : `P${d.position} · ${d.team || state.event.track}`, 'value');
  setText(document.getElementById('l3name'), current || d.name, 'value');

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
      <div class="name">${esc(d.name)}<span style="color:var(--ink-mute);font-weight:500;font-size:13px"> ${esc(d.team || '')}</span>${
        !d.dnf && d.gained ? `<span style="font-weight:700;font-size:12px;margin-left:8px;color:${d.gained > 0 ? '#30d158' : '#ff6a5a'}">${d.gained > 0 ? '▲' : '▼'}${Math.abs(d.gained)}</span>` : ''}</div>
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
 * progress the tracker reports. Cheap to draw: one polyline plus one dot per car.
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

  /*
   * The judges' calls. While the battle runs, a slot only fills to say a judge has called
   * it, never which way: showing the votes as they arrive gives the result away before the
   * last judge has decided. Once it is decided (or sent to One More Time), the calls open
   * one by one, which is the moment the crowd waits for.
   */
  const votes = document.getElementById('btVotes');
  const rv = b.reveal && (b.status === 'decided' || Date.now() - b.reveal.at < 12000) ? b.reveal : null;
  const sig = rv ? `r${rv.at}` : `v${b.votes.map((v) => (v ? 1 : 0)).join('')}${b.status}`;
  if (votes.dataset.sig !== sig) {
    votes.dataset.sig = sig;
    if (rv) {
      const label = (v) => (v === 'a' ? (driver(b.a) || {}).name : v === 'b' ? (driver(b.b) || {}).name : 'OMT') || '';
      votes.innerHTML = rv.votes.map((v, i) =>
        `<span class="bt-call ${v === 'a' ? 'a' : v === 'b' ? 'b' : 'omt'}" style="animation-delay:${i * 0.7}s">${esc(label(v))}</span>`).join('') +
        (rv.outcome === 'omt' ? `<span class="bt-call omt big" style="animation-delay:${rv.votes.length * 0.7}s">ONE MORE TIME</span>` : '');
      votes.classList.add('reveal');
    } else {
      votes.classList.remove('reveal');
      votes.innerHTML = b.votes.map((v) => `<i class="${v ? 'in' : ''}"></i>`).join('');
    }
  }
}

/** The knockout tree, drawn as columns so it reads left to right like a printed draw. */
function renderBracket() {
  const box = document.getElementById('bkBody');
  if (!box) return;
  const D = state.drift || {};
  const rounds = D.bracket || [];
  const sig = JSON.stringify(rounds.map((r) => r.pairs)) + (D.champion || '') + JSON.stringify(D.third || null);
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
          <div class="${p.winner === p.a ? 'w' : ''}"><i style="background:${colour(p.a)}"></i>${esc(name(p.a) || '-')}</div>
          <div class="${p.winner === p.b ? 'w' : ''}"><i style="background:${colour(p.b)}"></i>${esc(name(p.b) || (p.a ? 'BYE' : '-'))}</div>
        </div>`).join('')}
      ${r === rounds[rounds.length - 1] && D.third ? `<h5 style="margin-top:12px">THIRD PLACE</h5>
        <div class="bk-pair">
          <div class="${D.third.winner === D.third.a ? 'w' : ''}"><i style="background:${colour(D.third.a)}"></i>${esc(name(D.third.a) || '-')}</div>
          <div class="${D.third.winner === D.third.b ? 'w' : ''}"><i style="background:${colour(D.third.b)}"></i>${esc(name(D.third.b) || '-')}</div>
        </div>` : ''}
    </div>`).join('');
}

/*
 * The qualifying run card: who is on track, the judges' slots filling as they score, then
 * the score and the Line / Angle / Style split (judges averaged) as bars. It holds the
 * result for a while after the last judge scores, timed from when this overlay saw it.
 */
const DS_HOLD_MS = 15000;
let dsSeen = null;    // { key, at }
let dsTimer = null;

function renderDriftSolo() {
  const box = document.getElementById('driftsolo');
  if (!box) return;
  const D = state.drift || {};
  const solo = D.solo;
  const on = state.overlay.show.driftsolo !== false && (state.event.sessionType === 'drift' || forced || editing);
  let visible = false;
  if (on && solo) {
    if (solo.status === 'running') visible = true;
    else {
      const key = `${solo.driverId}|${solo.run}|${solo.total}`;
      if (!dsSeen || dsSeen.key !== key) dsSeen = { key, at: Date.now() };
      const left = DS_HOLD_MS - (Date.now() - dsSeen.at);
      visible = left > 0;
      clearTimeout(dsTimer);
      if (visible) dsTimer = setTimeout(renderDriftSolo, left + 50);
    }
  }
  show('driftsolo', visible || (on && !solo && (forced || editing)));
  if (!solo) return;
  const d = (state.drivers || []).find((x) => x.id === solo.driverId);
  box.style.setProperty('--c', d ? d.color : '#888');
  setText(document.getElementById('dsRun'), `RUN ${solo.run + 1}`, null);
  setText(document.getElementById('dsName'), d ? rowName(d) : '--', null);
  setText(document.getElementById('dsNum'), d ? `#${d.num}` : '', null);
  const body = document.getElementById('dsBody');
  const sig = JSON.stringify([solo.status, solo.scores.map((x) => !!x), solo.total]);
  if (body.dataset.sig === sig) return;
  body.dataset.sig = sig;
  if (solo.status === 'running') {
    body.innerHTML = `<div class="ds-judging"><span>JUDGING</span>${solo.scores.map((x) => `<i class="${x ? 'in' : ''}"></i>`).join('')}</div>`;
    return;
  }
  const F = D.format || {};
  const cats = F.categories || { line: 35, angle: 30, style: 35 };
  const split = solo.scores[0] && solo.scores[0].line != null;
  const avg = (k) => Math.round(solo.scores.reduce((n, x) => n + (x[k] || 0), 0) / solo.scores.length * 10) / 10;
  const q = (D.qualifying || []).filter((e) => e.best != null).sort((a, b) => b.best - a.best);
  const rank = q.findIndex((e) => e.driverId === solo.driverId) + 1;
  body.innerHTML = `<div class="ds-score"><b>${solo.total}</b><span>${rank ? `P${rank} IN QUALIFYING` : 'POINTS'}</span></div>` +
    (split ? `<div class="ds-bars">${['line', 'angle', 'style'].map((k, i) => `
      <div class="ds-bar"><span>${k.toUpperCase()}</span><div><i style="width:${Math.min(100, avg(k) / cats[k] * 100)}%;animation-delay:${0.2 + i * 0.25}s"></i></div><em>${avg(k)}</em></div>`).join('')}</div>` : '');
}

/** The drift qualifying board: best score first, the car on track marked. */
function renderDriftQ() {
  const box = document.getElementById('dqRows');
  if (!box) return;
  const D = state.drift || {};
  const q = (D.qualifying || []).filter((e) => e.best != null).sort((a, b) => b.best - a.best).slice(0, 16);
  const live = D.solo && D.solo.status === 'running' ? D.solo.driverId : null;
  const sig = JSON.stringify(q.map((e) => [e.driverId, e.best])) + live;
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  setText(document.getElementById('dqSub'), `${q.length} SCORED`, null);
  box.innerHTML = q.map((e, i) => {
    const d = (state.drivers || []).find((x) => x.id === e.driverId) || {};
    return `<div class="dq-row ${e.driverId === live ? 'live' : ''}"><span class="p">${i + 1}</span><i style="background:${d.color || '#666'}"></i><b>${esc(d.name || '-')}</b><em>${e.best}</em></div>`;
  }).join('');
}

/**
 * The grid, drawn staggered the way a real one is painted.
 *
 * Two columns offset against each other, because a flat list reads as a leaderboard and
 * the viewer has to work out that it is a starting order instead. The stagger says it
 * without a caption.
 */
/**
 * Full-screen grid reveal: one grid row (two cars) at a time, big, cycling on its own timer,
 * like the pre-race grid walk of a real broadcast. Positions 1 and 2 first, then 3 and 4, etc.
 */
function renderGridReveal(grid, byId) {
  const box = document.getElementById('gdRows');
  if (!box) return;
  const nPairs = Math.ceil(grid.length / 2);
  if (!nPairs) { box.innerHTML = '<div class="gd-empty">grid not set</div>'; box.dataset.sig = 'empty'; return; }
  const idx = Math.floor(Date.now() / 4800) % nPairs;
  const ids = [grid[idx * 2], grid[idx * 2 + 1]];
  const sig = 'reveal|' + idx + '|' + ids.map((id) => { const d = byId.get(id) || {}; return `${d.name}:${d.num}:${d.color}:${d.photo ? 1 : 0}`; }).join(',');
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  setText(document.getElementById('gdSub'), `ROW ${idx + 1} OF ${nPairs}`, null);
  const cardHtml = (id, pos) => {
    const d = byId.get(id);
    if (!d) return '<div class="gr-card empty"></div>';
    const c = d.color || '#8e8e93';
    const photo = d.photo
      ? `<span class="gr-photo" style="background-image:url('${String(d.photo).replace(/'/g, '%27')}')"></span>`
      : `<span class="gr-photo ph">${esc((d.short || d.name || '').slice(0, 2).toUpperCase())}</span>`;
    return `<div class="gr-card" style="--c:${c}">
      <span class="gr-pos">${pos}</span>
      ${photo}
      <span class="gr-num">#${esc(d.num)}</span>
      <span class="gr-name">${esc(d.name)}</span>
      <span class="gr-team">${esc(d.team || d.car || '')}</span>
    </div>`;
  };
  box.innerHTML = `<div class="gd-reveal" data-k="${idx}">${cardHtml(ids[0], idx * 2 + 1)}${cardHtml(ids[1], idx * 2 + 2)}</div>`;
}

function renderGrid() {
  const box = document.getElementById('gdRows');
  const card = document.getElementById('gdCard');
  if (!box) return;
  const grid = state.race.grid || [];
  const byId = new Map((state.drivers || []).map((d) => [d.id, d]));
  // The style template: F1 (angled dark slots) or WEC (class coloured). Followed by the grid
  // itself so a photo or name edit re-renders the reveal.
  const style = ['reveal', 'f1', 'wec', 'classic'].includes(state.overlay.gridStyle) ? state.overlay.gridStyle : 'f1';
  if (card) card.dataset.style = style;
  const gridEl = document.getElementById('grid');
  if (gridEl) gridEl.classList.toggle('fullscreen', style === 'reveal');
  if (style === 'reveal') return renderGridReveal(grid, byId);
  const sig = style + '|' + grid.map((id) => { const d = byId.get(id) || {}; return `${d.name}:${d.num}:${d.color}:${d.carClass || ''}:${d.photo ? 1 : 0}`; }).join(',');
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;

  setText(document.getElementById('gdSub'), grid.length ? `${grid.length} CARS` : 'NOT SET', 'value');

  if (!grid.length) { box.innerHTML = '<div class="gd-empty">grid not set</div>'; return; }

  const slot = (id, i) => {
    const d = byId.get(id);
    if (!d) return '';
    const cc = style === 'wec' ? (wecClassColor(d.carClass) || null) : null;
    const accent = cc ? cc[0] : (d.color || '#8e8e93');
    const photo = d.photo
      ? `<span class="gd-photo" style="background-image:url('${String(d.photo).replace(/'/g, "%27")}')"></span>`
      : `<span class="gd-photo ph">${esc((d.short || d.name || '').slice(0, 2).toUpperCase())}</span>`;
    return `<div class="gd-slot" style="--c:${accent};--i:${i}">
      <span class="gd-pos">${i + 1}</span>
      ${photo}
      <span class="gd-info">
        <span class="gd-num">${esc(d.num)}</span>
        <span class="gd-name">${esc(d.name)}</span>
        <span class="gd-team">${esc(style === 'wec' ? (d.carClass || d.team || '') : (d.team || d.car || ''))}</span>
      </span>
    </div>`;
  };
  // Two staggered columns, pole top-left, the right column dropped half a slot, like a real
  // starting grid.
  const left = [], right = [];
  grid.forEach((id, i) => (i % 2 ? right : left).push(slot(id, i)));
  box.innerHTML = `<div class="gd-col l">${left.join('')}</div><div class="gd-col r">${right.join('')}</div>`;
}

/**
 * Two cars, compared where the difference actually comes from.
 *
 * A gap on its own says who is ahead and tells the viewer nothing about why. The split
 * times do: one car gains three tenths through the first sector and gives two back in the
 * last, and now the fight has a shape. Everything shown here is already measured: this
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
/*
 * Drivers or teams. "alternate" swaps every ten seconds on the wall clock, so two overlays
 * on two machines swap together; a timer brings the next swap even with no state push.
 */
const STD_SWAP_MS = 10000;
let stdTimer = 0;
function renderStandings() {
  const box = document.getElementById('stdRows');
  if (!box) return;
  const champ = state.championship || {};
  const teamsAll = state.teamStandings || [];
  const mode = state.overlay.standingsMode || 'drivers';
  clearTimeout(stdTimer);
  let teams = mode === 'teams' && teamsAll.length > 0;
  if (mode === 'alternate' && teamsAll.length) {
    teams = Math.floor(Date.now() / STD_SWAP_MS) % 2 === 1;
    stdTimer = setTimeout(renderStandings, STD_SWAP_MS - (Date.now() % STD_SWAP_MS) + 30);
  }
  if (teams) return renderTeamStandings(box, teamsAll.slice(0, 12), champ);
  const rows = (state.standings || []).slice(0, 12);
  const sig = 'd' + JSON.stringify(rows.map((r) => [r.rank, r.name, r.points, r.rounds])) + (champ.name || '');
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

function renderTeamStandings(box, rows, champ) {
  const sig = 't' + JSON.stringify(rows.map((r) => [r.rank, r.team, r.points])) + (champ.name || '');
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  setText(document.getElementById('stdTitle'), `${champ.name || 'CHAMPIONSHIP'} · TEAMS`, null);
  setText(document.getElementById('stdSub'),
    (champ.rounds || []).length ? `TEAMS · AFTER ${(champ.rounds || []).length} ROUNDS` : 'NO ROUNDS YET', 'value');
  const lead = (rows[0] && rows[0].points) || 0;
  box.innerHTML = rows.map((r) => `
    <div class="std-row std-team ${r.rank === 1 ? 'p1' : ''}">
      <span class="std-pos">${r.rank}</span>
      <span class="std-bar" style="background:${esc(r.color || '#666')}"></span>
      <span class="std-name">${esc(r.team)}<small>${esc((r.drivers || []).join(' · '))}</small></span>
      <span class="std-gap">${r.rank === 1 ? '' : `-${lead - r.points}`}</span>
      <span class="std-pts">${r.points}</span>
    </div>`).join('');
}

/**
 * The line under the tower title.
 *
 * A running race shows "LAP x OF y" the way a broadcast does; anything else falls back to
 * the session name. Used by both skins (it is just better text) and it is what the
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
  // Practice and qualifying run to a clock, not a lap count: every skin shows the time
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
  // A title renamed in the design studio wins over both the skin's and the standard one.
  const ownLb = widgetTitle(state.overlay.custom, 'leaderboard');
  const ownTw = widgetTitle(state.overlay.custom, 'tower');
  if (lbT) lbT.textContent = ownLb || (branded ? title : 'Leaderboard');
  if (twT) twT.textContent = ownTw || (branded ? title : 'Timing');
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

/*
 * The race-control banner: every steward decision goes on air for a few seconds.
 *
 * It reads the event feed rather than the penalty list, because the feed is what records
 * the moment a decision was made (issued, upheld, dropped, served, a licence ban) and it
 * reaches a hosted overlay the same way it reaches a local one, with no new column.
 *
 * The hold is timed from when this overlay first saw the entry, not from the entry's own
 * stamp: the stamp is the server's clock and the streaming PC's clock can be a few seconds
 * off, which would cut the banner short or hold it too long. An entry older than a minute
 * when first seen (an OBS source reloaded mid-race) is history, and is not replayed.
 */
const RC_HOLD_MS = 9000;
const rcSeen = new Map();      // feed key -> local time first seen
let rcTimer = null;

function rcCurrent() {
  const now = Date.now();
  for (const f of (state.feed || []).slice(0, 12)) {
    if (f.kind !== 'penalty' || !f.text) continue;
    const key = `${f.t}|${f.text}`;
    if (!rcSeen.has(key)) rcSeen.set(key, Math.abs(now - (f.t || 0)) < 60000 ? now : 0);
    const seen = rcSeen.get(key);
    // The newest penalty entry decides: an older one never comes back over a newer one.
    return seen && now - seen < RC_HOLD_MS ? { f, left: RC_HOLD_MS - (now - seen) } : null;
  }
  return null;
}

function renderRaceControl() {
  const box = document.getElementById('racecontrol');
  if (!box) return;
  const on = state.overlay.show.racecontrol !== false;
  let cur = on ? rcCurrent() : null;
  // In the layout editor (and a rehearsal) the banner shows a sample so it can be placed.
  if (!cur && on && (forced || editing)) {
    const d = (state.drivers || [])[0] || { name: 'DRIVER', num: '1', id: '' };
    cur = { f: { text: `${d.name} · +5s PENALTY: Track limits`, driverId: d.id }, left: 0 };
  }
  show('racecontrol', !!cur);
  clearTimeout(rcTimer);
  if (!cur) return;
  if (cur.left > 0) rcTimer = setTimeout(renderRaceControl, cur.left + 50);

  const d = (state.drivers || []).find((x) => x.id === cur.f.driverId) || null;
  const text = String(cur.f.text);
  const cut = text.indexOf(' · ');
  const rest = cut > -1 ? text.slice(cut + 3) : text;
  const colon = rest.indexOf(': ');
  const what = colon > -1 ? rest.slice(0, colon) : rest;
  const why = colon > -1 ? rest.slice(colon + 2) : '';
  const tone = /INVESTIGATION/.test(what) ? 'inv' : /NO FURTHER ACTION|SERVED/.test(what) ? 'ok' : 'pen';
  box.dataset.tone = tone;
  box.style.setProperty('--c', (d && d.color) || '#ff453a');
  setText(document.getElementById('rcNum'), d ? String(d.num) : '', null);
  setText(document.getElementById('rcName'), d ? rowName(d) : (cut > -1 ? text.slice(0, cut) : ''), null);
  setText(document.getElementById('rcWhat'), what, null);
  setText(document.getElementById('rcWhy'), why, null);
  document.getElementById('rcWhy').hidden = !why;
  // The other car and the corner, from the penalty record behind this line.
  const p = penaltyFor(cur.f);
  const o = p && p.other ? (state.drivers || []).find((x) => x.id === p.other) : null;
  const vs = [o ? `vs ${o.num ? '#' + o.num + ' ' : ''}${rowName(o)}` : '', p && p.where ? p.where : ''].filter(Boolean).join(' · ');
  setText(document.getElementById('rcVs'), vs, null);
  document.getElementById('rcVs').hidden = !vs;
}

/*
 * The penalty a feed line is about. The local engine tags the line with its id; a hosted
 * event's feed rows cannot carry one, so there it is the driver's newest record from
 * before the line.
 */
function penaltyFor(f) {
  const pens = (state.race && state.race.penalties) || [];
  if (f.penId) return pens.find((p) => p.id === f.penId) || null;
  if (!f.driverId) return null;
  return pens.filter((p) => p.driverId === f.driverId && (p.at || 0) <= (f.t || Date.now()) + 5000)
    .sort((a, b) => (b.at || 0) - (a.at || 0))[0] || null;
}

/*
 * Incidents under investigation: every open case of this session, held on screen until the
 * stewards decide it, then the decision for a few seconds. The banner above announces a
 * decision once; this is the list a viewer can read while the case is still open.
 */
const INC_HOLD_MS = 12000;
let incTimer = 0;
function renderIncidents() {
  const box = document.getElementById('incidents');
  const rowsEl = document.getElementById('incRows');
  if (!box || !rowsEl) return;
  clearTimeout(incTimer);
  const on = state.overlay.show.incidents !== false;
  const now = Date.now();
  const byId = new Map((state.drivers || []).map((d) => [d.id, d]));
  let list = on ? ((state.race && state.race.penalties) || []).filter((p) => inSession(p, state.race) && (
    p.status === 'investigating' || (p.decidedAt && now - p.decidedAt < INC_HOLD_MS && p.status !== 'investigating')
  )) : [];
  if (!list.length && on && (forced || editing)) {
    const [a, b] = state.drivers || [];
    list = a ? [{ id: 'sample', driverId: a.id, other: b ? b.id : null, where: 'T3', lap: 4, reason: 'Causing a collision', status: 'investigating' }] : [];
  }
  show('incidents', list.length > 0);
  if (!list.length) return;
  const soonest = list.filter((p) => p.decidedAt).map((p) => INC_HOLD_MS - (now - p.decidedAt)).sort((x, y) => x - y)[0];
  if (soonest > 0) incTimer = setTimeout(renderIncidents, soonest + 60);

  const open = list.filter((p) => p.status === 'investigating').length;
  setText(document.getElementById('incSub'), open ? `${open} OPEN` : 'DECIDED', null);
  const car = (d) => (d ? `<span class="inc-car" style="--c:${esc(d.color || '#888')}"><b>${d.num ? '#' + esc(String(d.num)) : ''}</b>${esc(rowName(d))}</span>` : '');
  const outcome = (p) => p.status === 'dropped' ? '<span class="inc-out ok">NO FURTHER ACTION</span>'
    : p.status === 'applied' ? `<span class="inc-out pen">${esc(penaltyLabel(p))}</span>` : '';
  rowsEl.innerHTML = list.slice(0, 5).map((p) => {
    const d = byId.get(p.driverId);
    const o = p.other ? byId.get(p.other) : null;
    const meta = [p.where, p.lap ? `LAP ${p.lap}` : '', p.reason].filter(Boolean).map((x) => esc(String(x))).join(' · ');
    return `<div class="inc-row ${p.status}"><div class="inc-cars">${car(d)}${o ? '<span class="inc-vs">VS</span>' + car(o) : ''}${outcome(p)}</div><div class="inc-meta">${meta}</div></div>`;
  }).join('');
}

function penaltyLabel(p) {
  if (p.type === 'time') return `+${p.seconds || 0}S PENALTY`;
  return ({ warning: 'WARNING', drivethrough: 'DRIVE THROUGH', blackflag: 'BLACK FLAG', dq: 'DISQUALIFIED', note: 'NOTED' })[p.type] || 'PENALTY';
}

/** The fastest-lap banner: whoever holds the best lap, in their team colour. */
function renderFastLap() {
  const fl = fastestLap(state);
  const nameEl = document.getElementById('flName');
  const timeEl = document.getElementById('flTime');
  const box = document.getElementById('fastlap');
  if (!nameEl || !timeEl || !box) return;
  if (!fl || fl.bestLap == null) {
    setText(nameEl, '-', null);
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
 * good it is (session best (purple), personal best (green) or simply set (yellow)) the way
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
  if (!d) { nameEl.textContent = '-'; if (lapEl) lapEl.textContent = ''; cells.innerHTML = ''; return; }
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

/** Pit lane open / closed, both ways so it is never a blank. */
function renderPit() {
  const card = document.getElementById('pitCard');
  const label = document.getElementById('pitLabel');
  if (!card || !label) return;
  const closed = state.race.pitOpen === false;
  if (card.dataset.closed === String(closed)) return;
  card.dataset.closed = String(closed);
  card.classList.toggle('closed', closed);
  label.textContent = closed ? 'PIT CLOSED' : 'PIT OPEN';
  restart(card, 'wipe');
}

/** Start-light gantry: n red lights (1..5), all green at lights-out (6). */
function renderLights() {
  const g = document.getElementById('lightsGantry');
  if (!g) return;
  const n = state.race.lights || 0;
  if (g.dataset.n === String(n)) return;
  g.dataset.n = String(n);
  const go = n >= 6;
  g.classList.toggle('go', go);
  for (const b of g.querySelectorAll('.lb')) {
    b.classList.toggle('red', !go && n > Number(b.dataset.i));
  }
}

/**
 * The most compelling catch to put on screen: the focus driver's if they are catching
 * someone, otherwise the most imminent catch on track (fewest laps to arrive).
 */
function pickCatch(rows) {
  const focus = rows.find((d) => d.id === state.overlay.focusDriverId);
  if (focus && focus.catch) return focus.catch;
  let best = null;
  for (const d of rows) {
    if (!d.catch) continue;
    if (!best || d.catch.laps < best.laps || (d.catch.laps === best.laps && d.catch.gapMs < best.gapMs)) best = d.catch;
  }
  return best;
}

function renderCatching(c) {
  const sig = `${c.num}>${c.onNum}|${c.perLapMs}|${c.laps}`;
  const box = document.getElementById('catching');
  if (!box || box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  setText(document.getElementById('catchWho'), c.name, 'value');
  setText(document.getElementById('catchOn'), `on ${c.onName}`, null);
  // A signed value in seconds per lap, using the minus sign, never an em-dash.
  setText(document.getElementById('catchRate'), `−${(c.perLapMs / 1000).toFixed(2)}s/lap`, null);
  setText(document.getElementById('catchLaps'), c.laps === 1 ? 'next lap' : `~${c.laps} laps`, null);
}

/** Head-to-head record between two drivers across the season's scored rounds. */
function seasonH2H(aId, bId) {
  let a = 0, b = 0;
  for (const round of (state.championship && state.championship.rounds) || []) {
    const ra = (round.results || []).find((r) => r.driverId === aId);
    const rb = (round.results || []).find((r) => r.driverId === bId);
    if (!ra || !rb) continue;
    const pa = ra.dnf ? 999 : ra.position, pb = rb.dnf ? 999 : rb.position;
    if (pa < pb) a++; else if (pb < pa) b++;
  }
  return { a, b };
}

/** The tightest championship battle: the adjacent standings pair closest on points. */
function pickRivalry() {
  const s = (state.standings || []).filter((r) => r.rounds > 0);
  if (s.length < 2) return null;
  let best = null;
  for (let i = 0; i < s.length - 1; i++) {
    const gap = s[i].points - s[i + 1].points;
    if (!best || gap < best.gap) best = { a: s[i], b: s[i + 1], gap };
  }
  return best;
}

function renderRivalry(r) {
  const h = seasonH2H(r.a.driverId, r.b.driverId);
  const sig = `${r.a.driverId}|${r.b.driverId}|${r.gap}|${h.a}-${h.b}`;
  const box = document.getElementById('rivalry');
  if (!box || box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  setText(document.getElementById('rvArank'), `P${r.a.rank}`, null);
  setText(document.getElementById('rvAname'), r.a.name, 'value');
  setText(document.getElementById('rvApts'), `${r.a.points} PTS`, null);
  setText(document.getElementById('rvBrank'), `P${r.b.rank}`, null);
  setText(document.getElementById('rvBname'), r.b.name, 'value');
  setText(document.getElementById('rvBpts'), `${r.b.points} PTS`, null);
  box.style.setProperty('--ca', r.a.color || '#00e0a4');
  box.style.setProperty('--cb', r.b.color || '#ff6a5a');
  const gapTxt = r.gap === 0 ? 'level on points' : `${r.gap} point${r.gap === 1 ? '' : 's'} apart`;
  const h2h = (h.a || h.b) ? ` · head to head ${h.a}–${h.b} this season` : '';
  setText(document.getElementById('rvNote'), gapTxt + h2h, null);
}

function renderPodium(rows) {
  const top = rows.filter((d) => !d.dnf).slice(0, 3);
  const sig = top.map((d) => d.id + d.position).join('|');
  const cols = document.getElementById('podCols');
  if (!cols || cols.dataset.sig === sig) return;
  cols.dataset.sig = sig;
  setText(document.getElementById('podTitle'), `${state.event.name || 'RACE'} · RESULT`, null);
  // Visual order 2, 1, 3 so the winner's column stands in the middle and tallest.
  const order = [top[1], top[0], top[2]].filter(Boolean);
  cols.innerHTML = order.map((d) => {
    const place = d.position;
    return `<div class="pod-col p${place}" style="--c:${d.color || '#888'}">
      <div class="pod-medal">${place === 1 ? '🥇' : place === 2 ? '🥈' : '🥉'}</div>
      ${d.photo ? `<img class="pod-photo" src="${String(d.photo).replace(/"/g, '&quot;')}" alt="">` : '<div class="pod-photo ph"></div>'}
      <div class="pod-name">${esc(d.name)}</div>
      <div class="pod-team">${esc(d.team || '')}</div>
      <div class="pod-block">P${place}</div>
    </div>`;
  }).join('');
  const cf = document.getElementById('podConfetti');
  if (cf && !cf.childElementCount) {
    cf.innerHTML = Array.from({ length: 60 }, (_, i) =>
      `<i style="left:${(i * 100 / 60).toFixed(1)}%;--d:${(Math.random() * 2.5 + 1).toFixed(2)}s;--dl:${(Math.random() * 2).toFixed(2)}s;--h:${Math.floor(Math.random() * 360)}"></i>`).join('');
  }
}

// ---------------------------------------------------------------- crowd reactions
const REACT_EMOJI = ['🔥', '👏', '😮', '😬', '❤️'];
let reactWindow = [];   // recent reaction timestamps for the hype meter
let reactMax = 8;       // rolling peak, so the meter is relative to this event's own high
let reactSeen = new Set();

async function pollReactions() {
  if (!bus.sb || !bus.event || !bus.event.id) return;
  try {
    const since = new Date(Date.now() - 15000).toISOString();
    const { data } = await bus.sb.from('reactions').select('id,emoji,created_at')
      .eq('event_id', bus.event.id).gte('created_at', since).order('created_at', { ascending: true });
    const rows = data || [];
    reactWindow = rows.map((r) => Date.parse(r.created_at));
    for (const r of rows) {
      if (reactSeen.has(r.id)) continue;
      reactSeen.add(r.id);
      floatEmoji(r.emoji);
    }
    if (reactSeen.size > 500) reactSeen = new Set(rows.map((r) => r.id));
  } catch (e) { /* hosted-only; quietly do nothing on a local event */ }
}

function floatEmoji(emoji) {
  const box = document.getElementById('reactFloat');
  if (!box) return;
  const el = document.createElement('span');
  el.textContent = emoji || '🔥';
  el.className = 'react-emoji';
  el.style.left = `${Math.random() * 80 + 5}%`;
  el.style.setProperty('--rd', `${(Math.random() * 1.5 + 2).toFixed(2)}s`);
  box.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function renderReactions() {
  const now = Date.now();
  const recent = reactWindow.filter((t) => now - t < 8000).length;
  reactMax = Math.max(reactMax * 0.99, recent, 8);
  const fill = Math.max(0, Math.min(1, recent / reactMax));
  const bar = document.getElementById('reactFill');
  if (bar) bar.style.width = `${(fill * 100).toFixed(0)}%`;
  const label = document.getElementById('reactLabel');
  if (label) label.textContent = recent > reactMax * 0.75 ? 'CROWD GOING WILD' : 'HYPE';
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

/** The driver intro card: the focus driver (or leader) big: number, name, team, points. */
/** Season record for a driver from the standings counts, for the intro and rivalry cards. */
function seasonStats(id) {
  const s = (state.standings || []).find((r) => r.driverId === id);
  if (!s) return null;
  const c = s.counts || {};
  let best = null;
  for (const k in c) { const p = +k; if (best == null || p < best) best = p; }
  return { wins: c[1] || 0, podiums: (c[1] || 0) + (c[2] || 0) + (c[3] || 0), best, points: s.points, rank: s.rank, rounds: s.rounds };
}

function renderIntro(rows) {
  const focus = state.overlay.focusDriverId;
  let d = focus && (rows || []).find((r) => r.id === focus);
  // No focus: walk the grid one driver at a time, so the widget becomes a grid reveal.
  if (!d) {
    const grid = (rows || []).slice().sort((a, b) => {
      const g = state.race.grid || []; const ia = g.indexOf(a.id), ib = g.indexOf(b.id);
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.position - b.position;
    });
    if (grid.length) d = grid[Math.floor(Date.now() / 4500) % grid.length];
  }
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
  const statsEl = document.getElementById('inStats');
  if (statsEl) {
    const st = seasonStats(d.id);
    statsEl.textContent = st && st.rounds ? `${st.wins} WIN${st.wins === 1 ? '' : 'S'} · ${st.podiums} PODIUM${st.podiums === 1 ? '' : 'S'}${st.best ? ` · BEST P${st.best}` : ''}` : '';
  }
  const photo = document.getElementById('inPhoto');
  if (photo) {
    if (d.photo) { if (photo.getAttribute('src') !== d.photo) photo.setAttribute('src', d.photo); photo.hidden = false; }
    else { photo.hidden = true; photo.removeAttribute('src'); }
  }
  // A reveal wipe each time the card turns to a new driver, so the grid reveal reads as a
  // sequence of cards rather than text quietly swapping.
  if (box.dataset.who !== d.id) { box.dataset.who = d.id; restart(box, 'intro-in'); }
}

/** The audience-poll card: the question and a live bar per option, from the vote tally. */
function renderPoll() {
  const p = (state.overlay && state.overlay.poll) || {};
  const q = document.getElementById('pollQ');
  const bars = document.getElementById('pollBars');
  const totEl = document.getElementById('pollTotal');
  if (!q || !bars) return;
  q.textContent = p.question || 'WHO WINS?';
  // the website's votes and the stream chat's, together
  const tally = pollTally(state);
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
 * (state.overlay.radio). The driver app is the live one: a real "BOX BOX BOX" from the
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
  // JS timer, because an OBS browser source freezes timers: a JS countdown never fired and the
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
  // Super GT classes: the number box takes the class colour
  GT500: ['#e6e6e6', '#9a9a9a'], GT300: ['#ff7a00', '#a85f00']
};
function wecClassColor(name) { return WEC_CLASS_COLORS[(name || '').toUpperCase().replace(/\s+/g, '')] || null; }

/** Rows grouped by class in first-appearance order; position order kept inside each group. */
function wecGroup(rows) {
  const order = [], map = new Map();
  for (const d of rows) {
    const c = (d.carClass || '').trim() || '-';
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
  const single = groups.length === 1 && groups[0].cls === '-';
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
  // Every widget switch, whole: listing them one by one left a dozen out, and switching one of
  // those on alone (the standings from a chat command, the ticker) never reached the screen.
  let sig = `${JSON.stringify(o.show)}|${JSON.stringify(o.layout)}|${JSON.stringify(o.style)}|${o.theme}|${o.skin}|${o.gridStyle || ''}|${o.standingsMode || ''}|${JSON.stringify(state.teamStandings || [])}|${o.towerTitle || ''}|${o.nonce || 0}|${o.editSelected}|` +
            `${r.status}|${r.pitOpen === false ? 'C' : 'O'}|${r.lights || 0}|${o.show.pit}${o.show.lights}${o.show.catching}${o.show.rivalry}${o.show.podium}${o.show.reactions}|${r.totalLaps}|${o.accent}|${o.focusDriverId}|` +
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
            `${(state.standings || []).map((r) => r.driverId + r.points).join(',')}|` +
            `${JSON.stringify(state.stints || {})}`;
  for (const d of rows) {
    sig += `
${d.id}|${d.position}|${d.lapsDone}|${d.lastLap}|${d.bestLap}|${d.totalMs}` +
           `|${d.gap}|${d.interval}|${d.pit}|${d.dnf}|${d.retired}|${d.num}|${d.name}|${d.short}|${d.team}|${d.car}|${d.color}|${d.carClass}|${d.classPos}|${d.gained}|${d.catch ? d.catch.laps + '_' + d.catch.perLapMs : ''}|${d.photo}` +
           `|${(d.sectors || []).join('.')}|${(d.bestSectors || []).join('.')}|${d.stopped}` +
           // Position round the lap moves constantly, so it is only part of the
           // signature for the widgets that actually draw it. The head to head does:
           // its gap and its closing arrow come from exactly this number, and leaving
           // it out froze the widget on whatever it showed first.
           `|${(state.overlay.show.trackmap || state.overlay.show.h2h) ? Math.round((d.livePos || 0) * 400) : 0}` +
           `|${d.penaltyPending ? 1 : 0}|${d.penaltyServed || 0}|${d.blueFlag ? 1 : 0}|${d.blackFlag ? 1 : 0}|${d.koOut || 0}${d.koCut ? 'c' : ''}`;
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
  // jsonb) has nothing to draw from: skip the frame and keep the last good render rather than
  // throwing halfway. The next complete state (a realtime update that carried settings, or the
  // reconcile poll) renders normally.
  if (!state.overlay || !state.overlay.show) return;
  applyDesign();

  const rows = classification(state);
  latestRows = rows;
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
  renderRaceControl();
  renderIncidents();
  renderDriftSolo();
  show('driftq', vis.driftq && (state.drift?.qualifying || []).some((e) => e.best != null));
  if (shown.driftq) renderDriftQ();
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
  show('pit', vis.pit);
  if (shown.pit) renderPit();
  show('lights', vis.lights);
  if (shown.lights) renderLights();
  const catcher = pickCatch(rows);
  show('catching', vis.catching && !!catcher);
  if (shown.catching && catcher) renderCatching(catcher);
  const rival = pickRivalry();
  show('rivalry', vis.rivalry && !!rival);
  if (shown.rivalry && rival) renderRivalry(rival);
  const finished = state.race.status === 'finished';
  show('podium', vis.podium && finished);
  if (shown.podium && finished) renderPodium(rows);
  show('reactions', vis.reactions && !!bus.sb);
  if (shown.reactions) renderReactions();
  // A hidden widget still cost a full row diff on every state push. Nothing about it
  // is on screen, so skip the DOM entirely until it is shown again.
  // Class grouping (banners + per-class numbering) is shared by WEC and IMSA.
  const wec = ['wec', 'imsa', 'supergt'].includes(state.overlay.skin || 'classic');

  updateSkinHeader();

  if (els.leaderboard && shown.leaderboard) {
    lists.lb ||= new KeyedList(document.getElementById('lbRows'), { create: createLbRow, update: updateLbRow, enterDir: -1 });
    if (wec) {
      const groups = wecGroup(rows);
      lists.lb.render(limitRows(wecSort(rows), 'lb'), true);
      applyClassBanners('lbRows', groups);
    } else {
      lists.lb.render(limitRows(rows, 'lb'), true);
    }
    setText(document.getElementById('lbSub'), headerLine(rows), 'value');
    applyGapSeparator(rows);
  }

  if (els.tower && shown.tower) {
    lists.tw ||= new KeyedList(document.getElementById('twRows'), { create: createTwRow, update: updateTwRow, enterDir: 1 });
    if (wec) {
      const groups = wecGroup(rows);
      lists.tw.render(limitRows(wecSort(rows), 'tw'), true);
      applyClassBanners('twRows', groups);
    } else {
      lists.tw.render(limitRows(rows, 'tw'), true);
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
  // Feed lines written by an older build used a long dash as the separator; a state saved
  // before the update still holds them until the next reset, so they are evened out here.
  return (state.feed || []).slice(0, 8).map((e) => e.text).filter(Boolean)
    .map((text) => String(text).replace(/\s*\u2014\s*/g, ' · '));
}

// local clock tick so the race time is smooth without server spam
/**
 * The race clock, on a timer rather than an animation frame.
 *
 * It is derived from the green-flag timestamp, not accumulated, so it needs no frame
 * loop to stay correct, and a frame loop is exactly what stops when the browser
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
  // The intro card cycles through the grid on its own timer when no driver is in focus.
  if (shown.intro && !state.overlay.focusDriverId) renderIntro(latestRows);
  // The full-screen grid reveal advances to the next row on its own timer.
  if (shown.grid && state.overlay.gridStyle === 'reveal') renderGrid();
  // The hype meter decays each tick even when no new reactions arrive.
  if (shown.reactions) renderReactions();
}

// Poll the crowd reactions a couple of times a second while the widget is up (hosted only).
setInterval(() => { if (shown.reactions) pollReactions(); }, 1500);

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
 * own produces a scramble: panels sliding past each other in different directions:
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
 * The intro / outro bumper: a full-screen branded takeover the operator plays on demand.
 * Bigger than the scene stinger, it holds for a few seconds and dismisses itself. Keyed on
 * the timestamp so replaying the same kind twice still plays the animation.
 */
let bumperEl = null, lastBumperAt = 0, bumperTimer = null;
function playBumper(s) {
  const b = s.overlay && s.overlay.bumper;
  const stage = document.querySelector('.stage');
  if (!stage) return;
  if (!b || !b.at) { lastBumperAt = 0; return; }
  if (b.at === lastBumperAt) return;
  lastBumperAt = b.at;
  if (!bumperEl) {
    bumperEl = document.createElement('div');
    bumperEl.className = 'bumper';
    bumperEl.innerHTML = '<div class="bumper-bg"></div><div class="bumper-body">' +
      '<div class="bumper-logo" id="bumperLogo"></div>' +
      '<div class="bumper-kicker" id="bumperKick"></div>' +
      '<div class="bumper-title" id="bumperTitle"></div>' +
      '<div class="bumper-sub" id="bumperSub"></div></div>';
    stage.appendChild(bumperEl);
  }
  const o = s.overlay || {}, ev = s.event || {};
  bumperEl.style.setProperty('--sting', o.accent || '#00e0a4');
  const brand = o.brand || {};
  const logo = document.getElementById('bumperLogo');
  if (logo) logo.innerHTML = brand.logo
    ? `<img src="${String(brand.logo).replace(/"/g, '&quot;')}" alt="">`
    : `<b>${esc(brand.name || ev.name || 'FRLcast')}</b>`;
  const outro = b.kind === 'outro';
  setText(document.getElementById('bumperKick'), outro ? 'THAT IS ALL FROM US' : [ev.round, ev.track].filter(Boolean).join(' · '), null);
  setText(document.getElementById('bumperTitle'), outro ? 'THANKS FOR WATCHING' : (ev.name || 'RACE'), null);
  setText(document.getElementById('bumperSub'), outro ? (brand.name || '') : (ev.sessionName || ''), null);
  bumperEl.classList.remove('play', 'outro');
  if (outro) bumperEl.classList.add('outro');
  void bumperEl.offsetWidth;
  bumperEl.classList.add('play');
  clearTimeout(bumperTimer);
  bumperTimer = setTimeout(() => bumperEl && bumperEl.classList.remove('play'), 6000);
}

/*
 * Coalesce renders to one per frame.
 *
 * Vision pushes a driver's progress several times a second, and each push arrives as a
 * fresh state. Rendering synchronously on every one means a full KeyedList diff: with the
 * layout flush its position animation needs: many times a second, even when nothing on
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
   * OBS browser source renders windowless: the page counts as hidden, and a hidden page's
   * timers are frozen. The scheduled render never fired, so a flag or a layout change did
   * not reach the stream until the source was refreshed by hand. Correctness first: the
   * render is immediate. Its cost is kept down instead by the signature guard inside
   * renderInner(), which skips a frame that would draw the same thing.
   */
  state = s;
  render();
}

bus.on('state', (s) => {
  if (s.overlay) playBumper(s);
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
