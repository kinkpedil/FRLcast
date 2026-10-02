/*
 * The custom broadcast design: everything an operator can change about how the overlay
 * looks beyond picking a skin and a template.
 *
 * Shared by the timing engine (which cleans what gets stored), the overlay (which turns it
 * into one stylesheet) and the console (which edits it), so the three agree on one shape.
 *
 * Layers, from safest to most powerful:
 *   colours   every colour token the widgets are drawn from
 *   fonts     text, numbers and titles: built-in, Google Fonts, or an uploaded font file
 *   panel     a texture or picture behind every panel, border width, the light effects
 *   stickers  uploaded pictures placed anywhere on screen (overlay.stickers)
 *   css       free CSS on top of everything, for whatever the controls do not reach
 *
 * Everything is stored as data and rebuilt into CSS on the overlay, never stored as CSS
 * the engine has to trust: a colour that is not a colour, or a URL that could break out of
 * url(), is dropped by the cleaners below on the way in and again on the way out (a hosted
 * event's settings reach the overlay without passing through the engine).
 */

export const COLOR_KEYS = [
  ['panel', '--panel', 'Panel'],
  ['panelHi', '--panel-hi', 'Panel header'],
  ['ink', '--ink', 'Text'],
  ['inkDim', '--ink-dim', 'Secondary text'],
  ['inkMute', '--ink-mute', 'Faint text'],
  ['line', '--line', 'Lines and borders'],
  ['purple', '--purple', 'Fastest lap'],
  ['gain', '--gain', 'Gained / faster'],
  ['lose', '--lose', 'Lost / slower'],
  ['glow', '--glow', 'Shadow and glow']
];

// Fonts every OBS on Windows already has, plus the two the overlay ships with.
export const SYSTEM_FONTS = [
  'Inter', 'JetBrains Mono', 'Arial', 'Arial Black', 'Bahnschrift', 'Impact', 'Segoe UI',
  'Trebuchet MS', 'Verdana', 'Georgia', 'Times New Roman', 'Courier New', 'Consolas',
  'Lucida Console', 'Comic Sans MS', 'Segoe Print', 'Segoe Script', 'Ink Free'
];

// A curated set from Google Fonts. Loaded on demand by the overlay (it already loads Inter
// from there), so they need the internet on the streaming PC, like the default fonts do.
export const GOOGLE_FONTS = [
  'Anton', 'Audiowide', 'Bangers', 'Barlow Condensed', 'Bebas Neue', 'Black Ops One',
  'Bungee', 'Bungee Shade', 'Chakra Petch', 'Cinzel', 'Creepster', 'Exo 2', 'Faster One',
  'Fredoka', 'Kanit', 'Lobster', 'Monoton', 'Orbitron', 'Oswald', 'Pacifico', 'Patrick Hand',
  'Permanent Marker', 'Press Start 2P', 'Racing Sans One', 'Rajdhani', 'Rubik Glitch',
  'Russo One', 'Saira Condensed', 'Silkscreen', 'Teko', 'Titillium Web', 'VT323'
];

/*
 * Widget structure: the inside of a widget, not just its colours. Columns in any order or
 * hidden, row height and spacing, rows as one list or as separate tiles, how the position
 * and the driver colour are drawn, font sizes, how many rows. Each widget has its own
 * `on`, so a skin's own layout is untouched until the operator takes that widget over.
 */
export const LB_COLS = [['pos', 'Position'], ['bar', 'Colour mark'], ['logo', 'Team badge'], ['num', 'Number'], ['name', 'Name'], ['gap', 'Gap']];
export const TW_COLS = [['pos', 'Position'], ['bar', 'Colour mark'], ['logo', 'Team badge'], ['num', 'Number'], ['name', 'Name'],
  ['sec', 'Sectors'], ['last', 'Last lap'], ['best', 'Best lap'], ['int', 'Interval']];
export const ST_SEGS = [['brand', 'Flag and logo'], ['event', 'Event'], ['lap', 'Lap'], ['clock', 'Race time'], ['fl', 'Fastest lap']];
// Widgets whose title is fixed text, so it can be renamed (the others write their own).
export const TITLED = [['leaderboard', 'Leaderboard'], ['tower', 'Timing'], ['trackmap', 'Track'], ['bracket', 'BRACKET'],
  ['h2h', 'HEAD TO HEAD'], ['standings', 'Championship']];
// Any widget can lose its header or its panel.
export const PANEL_WIDGETS = ['leaderboard', 'tower', 'status', 'lowerthird', 'gap', 'results', 'trackmap', 'battle',
  'bracket', 'h2h', 'standings', 'ticker', 'fastlap', 'sectors', 'delta', 'radio', 'poll', 'sponsor', 'countdown'];

const ROWS_DEFAULT = {
  on: false, style: 'list', rowH: 44, rowGap: 0, maxRows: 0, head: true, title: '',
  posStyle: 'plain', mark: 'bar', leader: false, zebra: false,
  fPos: 17, fName: 16, fNum: 14, align: 'left', tags: true
};
export const LB_DEFAULT = { ...ROWS_DEFAULT, team: true,
  cols: LB_COLS.map(([k]) => ({ k, on: k !== 'logo' })) };
export const TW_DEFAULT = { ...ROWS_DEFAULT, rowH: 42, fPos: 15, fName: 15, colHead: true,
  cols: TW_COLS.map(([k]) => ({ k, on: k !== 'logo' && k !== 'num' })) };
export const ST_DEFAULT = { on: false, height: 62, segs: ST_SEGS.map(([k]) => ({ k, on: true })) };

export const DESIGN_DEFAULT = {
  on: false,
  colors: {},
  fontSans: '',
  fontMono: '',
  fontTitle: '',
  fonts: [],           // extra Google Fonts that only the custom CSS uses
  transform: '',       // '' | 'uppercase' | 'lowercase'
  italic: false,
  border: -1,          // panel border width in px; -1 keeps the template's
  panelImg: '',        // an asset id or an https URL
  panelFit: 'cover',   // 'cover' | 'tile' | 'contain'
  sheen: true,         // the light sweep across panels
  crawl: true,         // the line that runs along panel headers
  css: '',
  preset: '',
  // lb = leaderboard, tw = timing tower, st = status bar, cm = per widget header/title/panel
  widgets: { lb: LB_DEFAULT, tw: TW_DEFAULT, st: ST_DEFAULT, cm: {} }
};

export const CSS_MAX = 60000;
export const ASSET_MAX = 80;
export const STICKER_MAX = 40;

const COLOR_RE = /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*[0-9.%\s,/]+\)|hsla?\(\s*[0-9.%\s,/deg]+\)|transparent)$/;
const FONT_RE = /^[A-Za-z0-9 ]{1,40}$/;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
// Only our own uploads or https, and nothing that could close a url("...") or a rule.
const URL_RE = /^(\/brand\/[A-Za-z0-9._/?=&-]{1,200}|https:\/\/[A-Za-z0-9._~:/?#@!$&*+,;=%-]{1,400})$/;

const num = (v, lo, hi, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
};
export const safeColor = (c) => (typeof c === 'string' && COLOR_RE.test(c.trim()) ? c.trim() : '');
export const safeUrl = (u) => (typeof u === 'string' && URL_RE.test(u.trim()) ? u.trim() : '');
const safeFont = (f) => {
  if (typeof f !== 'string') return '';
  const s = f.trim();
  if (s.startsWith('asset:')) return ID_RE.test(s.slice(6)) ? s : '';
  return FONT_RE.test(s) ? s : '';
};

/** A short id from a file name, unique among the ids already taken. */
export function assetId(name, taken) {
  const base = String(name || 'asset').toLowerCase().replace(/\.[a-z0-9]+$/, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'asset';
  let id = /^[a-z0-9]/.test(base) ? base : 'a-' + base;
  for (let i = 2; taken.has(id); i++) id = `${base.slice(0, 28)}-${i}`;
  return id;
}

function cleanCols(list, catalogue, dflt) {
  const keys = catalogue.map(([k]) => k);
  const out = [];
  for (const c of Array.isArray(list) ? list : []) {
    if (c && keys.includes(c.k) && !out.some((x) => x.k === c.k)) out.push({ k: c.k, on: !!c.on });
  }
  // A column the saved list does not know (added in a later version) joins at its default.
  for (const c of dflt) if (!out.some((x) => x.k === c.k)) out.push({ ...c });
  return out;
}

function cleanRows(w, dflt, catalogue) {
  const src = w && typeof w === 'object' ? w : {};
  const pickOf = (v, list, d) => (list.includes(v) ? v : d);
  const out = {
    on: !!src.on,
    cols: cleanCols(src.cols, catalogue, dflt.cols),
    style: pickOf(src.style, ['list', 'tiles'], 'list'),
    rowH: Math.round(num(src.rowH, 20, 120, dflt.rowH)),
    rowGap: Math.round(num(src.rowGap, 0, 40, 0)),
    maxRows: Math.round(num(src.maxRows, 0, 60, 0)),
    head: src.head !== false,
    title: typeof src.title === 'string' ? src.title.slice(0, 40) : '',
    posStyle: pickOf(src.posStyle, ['plain', 'box', 'circle', 'none'], 'plain'),
    mark: pickOf(src.mark, ['bar', 'edge', 'tint', 'none'], 'bar'),
    leader: !!src.leader,
    zebra: !!src.zebra,
    fPos: Math.round(num(src.fPos, 8, 60, dflt.fPos)),
    fName: Math.round(num(src.fName, 8, 60, dflt.fName)),
    fNum: Math.round(num(src.fNum, 8, 60, dflt.fNum)),
    align: pickOf(src.align, ['left', 'center', 'right'], 'left'),
    tags: src.tags !== false
  };
  if ('team' in dflt) out.team = src.team !== false;
  if ('colHead' in dflt) out.colHead = src.colHead !== false;
  return out;
}

function cleanWidgets(w) {
  const src = w && typeof w === 'object' ? w : {};
  const st = src.st && typeof src.st === 'object' ? src.st : {};
  const cm = {};
  for (const id of PANEL_WIDGETS) {
    const c = src.cm && src.cm[id];
    if (!c || typeof c !== 'object') continue;
    const e = {
      head: c.head !== false,
      bare: !!c.bare,
      title: typeof c.title === 'string' ? c.title.slice(0, 40) : ''
    };
    if (!e.head || e.bare || e.title) cm[id] = e;
  }
  return {
    lb: cleanRows(src.lb, LB_DEFAULT, LB_COLS),
    tw: cleanRows(src.tw, TW_DEFAULT, TW_COLS),
    st: { on: !!st.on, height: Math.round(num(st.height, 30, 140, 62)), segs: cleanCols(st.segs, ST_SEGS, ST_DEFAULT.segs) },
    cm
  };
}

/** The rows a widget may show (0 = all), for the overlay's row lists. */
export function rowLimit(custom, key) {
  if (!custom || !custom.on || !custom.widgets || !custom.widgets[key] || !custom.widgets[key].on) return 0;
  const n = Number(custom.widgets[key].maxRows);
  return Number.isFinite(n) && n > 0 ? Math.min(60, Math.floor(n)) : 0;
}

/** A renamed widget title, or '' to keep the widget's own. */
export function widgetTitle(custom, id) {
  if (!custom || !custom.on || !custom.widgets) return '';
  const w = custom.widgets;
  const fromRows = id === 'leaderboard' ? w.lb : id === 'tower' ? w.tw : null;
  if (fromRows && fromRows.on && typeof fromRows.title === 'string' && fromRows.title) return fromRows.title.slice(0, 40);
  const c = w.cm && w.cm[id];
  return c && typeof c.title === 'string' ? c.title.slice(0, 40) : '';
}

export function cleanDesign(d) {
  const src = d && typeof d === 'object' ? d : {};
  const colors = {};
  for (const [k] of COLOR_KEYS) {
    const c = safeColor(src.colors && src.colors[k]);
    if (c) colors[k] = c;
  }
  const img = typeof src.panelImg === 'string' && ID_RE.test(src.panelImg) ? src.panelImg : safeUrl(src.panelImg);
  return {
    on: !!src.on,
    colors,
    fontSans: safeFont(src.fontSans),
    fontMono: safeFont(src.fontMono),
    fontTitle: safeFont(src.fontTitle),
    fonts: (Array.isArray(src.fonts) ? src.fonts : []).map(safeFont).filter((f) => f && !f.startsWith('asset:')).slice(0, 8),
    transform: ['uppercase', 'lowercase'].includes(src.transform) ? src.transform : '',
    italic: !!src.italic,
    border: Math.round(num(src.border, -1, 16, -1)),
    panelImg: img,
    panelFit: ['cover', 'tile', 'contain'].includes(src.panelFit) ? src.panelFit : 'cover',
    sheen: src.sheen !== false,
    crawl: src.crawl !== false,
    css: typeof src.css === 'string' ? src.css.slice(0, CSS_MAX) : '',
    preset: typeof src.preset === 'string' ? src.preset.slice(0, 32) : '',
    widgets: cleanWidgets(src.widgets)
  };
}

export function cleanAssets(list) {
  const out = [];
  const seen = new Set();
  for (const a of Array.isArray(list) ? list : []) {
    if (!a || typeof a.id !== 'string' || !ID_RE.test(a.id) || seen.has(a.id)) continue;
    const url = safeUrl(a.url);
    if (!url) continue;
    seen.add(a.id);
    out.push({
      id: a.id,
      name: String(a.name || a.id).slice(0, 60),
      kind: a.kind === 'font' ? 'font' : 'image',
      url
    });
    if (out.length >= ASSET_MAX) break;
  }
  return out;
}

export function cleanStickers(list) {
  const out = [];
  for (const s of Array.isArray(list) ? list : []) {
    if (!s) continue;
    const src = typeof s.src === 'string' && ID_RE.test(s.src) ? s.src : safeUrl(s.src);
    if (!src) continue;
    out.push({
      id: typeof s.id === 'string' && /^[a-z0-9]{1,16}$/.test(s.id) ? s.id : Math.random().toString(36).slice(2, 10),
      src,
      x: Math.round(num(s.x, -1920, 3840, 100)),
      y: Math.round(num(s.y, -1080, 2160, 100)),
      w: Math.round(num(s.w, 8, 3840, 240)),
      rot: Math.round(num(s.rot, -360, 360, 0)),
      opacity: num(s.opacity, 0, 1, 1),
      on: s.on !== false,
      front: s.front !== false
    });
    if (out.length >= STICKER_MAX) break;
  }
  return out;
}

/** An asset id (or a plain URL) to the URL it points at. */
export function resolveSrc(src, assets) {
  if (!src) return '';
  const a = (assets || []).find((x) => x.id === src);
  return a ? a.url : safeUrl(src);
}

/** A hex panel colour as rgba() that still follows the panel opacity slider. */
function panelRgba(c) {
  const m = /^#([0-9a-f]{3,8})$/i.exec(c);
  if (!m || ![3, 4, 6, 8].includes(m[1].length)) return c;
  let h = m[1];
  if (h.length <= 4) h = h.split('').map((x) => x + x).join('');
  const n = (i) => parseInt(h.slice(i, i + 2), 16);
  const a = h.length === 8 ? n(6) / 255 : 1;
  return `rgba(${n(0)}, ${n(2)}, ${n(4)}, calc(var(--panel-alpha) * ${a.toFixed(3)}))`;
}

const fontStack = (f, fallback) => {
  if (!f) return '';
  const fam = f.startsWith('asset:') ? f.slice(6) : f;
  return `"${fam}", ${fallback}`;
};

/**
 * The whole custom design as one stylesheet, plus the Google Fonts it needs.
 * Assets are always declared (so free CSS can use them even with the design off); the
 * rest only while the design is on, so switching it off returns the template untouched.
 */
export function designCss(custom, assetList) {
  const d = cleanDesign(custom);
  const assets = cleanAssets(assetList);
  const parts = [];

  for (const a of assets) {
    if (a.kind === 'font') parts.push(`@font-face{font-family:"${a.id}";src:url("${a.url}");font-display:swap}`);
  }
  const vars = assets.filter((a) => a.kind === 'image').map((a) => `--asset-${a.id}:url("${a.url}");`).join('');
  if (vars) parts.push(`:root{${vars}}`);

  const google = new Set();
  if (!d.on) return { css: parts.join('\n'), google: [] };

  const R = 'html:root[data-theme][data-skin]';
  const tokens = [];
  for (const [k, v] of COLOR_KEYS) {
    const c = d.colors[k];
    if (!c) continue;
    if (k === 'panel') {
      // The panel keeps following the opacity slider. Built as rgba() rather than with
      // color-mix(), which the Chromium inside older OBS builds does not have.
      tokens.push(`--panel:${panelRgba(c)};`);
    } else if (k === 'glow') {
      tokens.push(`--glow:${c};--shadow:0 18px 44px ${c};`);
    } else {
      tokens.push(`${v}:${c};`);
    }
  }
  // Anything that is neither installed nor uploaded is fetched from Google Fonts.
  for (const f of [d.fontSans, d.fontMono, d.fontTitle, ...d.fonts]) {
    if (f && !f.startsWith('asset:') && !SYSTEM_FONTS.includes(f)) google.add(f);
  }
  if (d.fontSans) tokens.push(`--sans:${fontStack(d.fontSans, 'system-ui, sans-serif')};`);
  if (d.fontMono) tokens.push(`--mono:${fontStack(d.fontMono, 'ui-monospace, monospace')};`);
  if (tokens.length) parts.push(`${R}{${tokens.join('')}}`);

  if (d.fontTitle) {
    parts.push(`.card-head .title,.res-title h1,.grid-title h1,#stdTitle,.ticker-tag,.stinger-word{font-family:${fontStack(d.fontTitle, 'var(--sans)')}}`);
  }
  if (d.transform) parts.push(`.stage{text-transform:${d.transform}}`);
  if (d.italic) parts.push(`.stage{font-style:italic}`);
  if (d.border >= 0) parts.push(`.card,.ticker-bar{border-width:${d.border}px;border-style:solid;border-color:var(--line)}`);

  const img = resolveSrc(d.panelImg, assets);
  if (img) {
    const size = d.panelFit === 'tile' ? 'auto' : d.panelFit;
    const rep = d.panelFit === 'tile' ? 'repeat' : 'no-repeat';
    // The panel colour is laid over the picture, so the opacity slider decides how much of
    // the picture shows through and the text stays readable.
    parts.push(`.card,.ticker-bar{background-image:linear-gradient(var(--panel),var(--panel)),url("${img}");`
      + `background-size:auto,${size};background-repeat:no-repeat,${rep};background-position:center,center;background-color:transparent}`);
  }
  parts.push(...widgetCss(d.widgets));
  if (!d.sheen) parts.push('.card::after{display:none}');
  if (!d.crawl) parts.push('.card-head::after{display:none}');
  if (d.css) parts.push(`/* custom CSS */\n${d.css}`);
  return { css: parts.join('\n'), google: [...google] };
}

/*
 * The widget structure as CSS. Rules are scoped under the widget's id, which outranks every
 * skin rule, and only exist for a widget the operator switched to its own layout.
 */
const LB_W = { pos: (w) => `${Math.max(26, Math.round(w.fPos * 1.9))}px`, bar: () => '6px', logo: () => '38px',
  num: (w) => `${Math.max(28, Math.round(w.fNum * 2.8))}px`, name: () => 'minmax(0,1fr)', gap: () => 'auto' };
const TW_W = { pos: (w) => `${Math.max(28, Math.round(w.fPos * 2))}px`, bar: () => '8px', logo: () => '38px',
  num: (w) => `${Math.max(28, Math.round(w.fNum * 2.8))}px`, name: () => 'minmax(0,1fr)', sec: () => '56px',
  last: (w) => `${Math.round(w.fNum * 6.4)}px`, best: (w) => `${Math.round(w.fNum * 6.4)}px`, int: (w) => `${Math.round(w.fNum * 5)}px` };
const TW_HEAD = { pos: 'h-pos', bar: 'h-bar', logo: 'h-logo', num: 'h-num', name: 'h-name', sec: 'h-sec', last: 'h-last', best: 'h-best', int: 'h-int' };

function rowsCss(id, row, w, widths, isTower) {
  const W = `html[data-custom="1"] #${id}`;
  const R = `${W} .${row}`;
  const out = [];
  // The colour mark is a column only in "bar" style; the other styles draw it on the row.
  const cols = w.cols.filter((c) => c.on && !(c.k === 'bar' && w.mark !== 'bar'));
  const tmpl = cols.map((c) => widths[c.k](w)).join(' ') || '1fr';
  out.push(`${R}{grid-template-columns:${tmpl};height:${w.rowH}px;min-height:${w.rowH}px}`);
  if (isTower) out.push(`${W} .tw-head{grid-template-columns:${tmpl}}`);
  w.cols.forEach((c) => {
    const shown = cols.includes(c);
    const sel = `${R} > .${c.k === 'sec' ? 'sec' : c.k === 'last' ? 't.last' : c.k === 'best' ? 't.best' : c.k === 'int' ? 't.int' : c.k}`;
    if (shown) {
      out.push(`${sel}{order:${cols.indexOf(c)};display:${c.k === 'logo' ? 'grid' : 'block'}}`);
      if (isTower) out.push(`${W} .tw-head > .${TW_HEAD[c.k]}{order:${cols.indexOf(c)};display:block}`);
    } else {
      // The mark drawn on the row (edge, tint) still needs its cell; only the column goes.
      if (!(c.k === 'bar' && w.mark !== 'bar')) out.push(`${sel}{display:none}`);
      if (isTower) out.push(`${W} .tw-head > .${TW_HEAD[c.k]}{display:none}`);
    }
  });
  if (isTower) {
    // The sectors cell is a flex strip, the times read from the right.
    out.push(`${R} > .sec{display:${cols.some((c) => c.k === 'sec') ? 'flex' : 'none'}}`);
    if (!w.colHead) out.push(`${W} .tw-head{display:none}`);
    else out.push(`${W} .tw-head{display:grid}`);
  }
  // A team badge the classic look never showed: give it a shape of its own.
  out.push(`${R} > .logo{place-items:center;height:${Math.round(w.rowH * 0.6)}px;border-radius:5px;background:var(--c);color:#fff;font:700 ${Math.max(9, w.fNum - 3)}px var(--mono)}`);
  out.push(`${R} > .logo.on-light{color:#05070a}`);

  out.push(`${R} .pos{font-size:${w.fPos}px}`);
  out.push(`${R} .name{font-size:${w.fName}px;text-align:${w.align}}`);
  out.push(`${R} .num,${R} .gap,${R} .t{font-size:${w.fNum}px}`);
  if (!w.tags) out.push(`${R} .tags{display:none}`);
  if (w.team === false) out.push(`${R} .name small{display:none}`);
  if (!w.head) out.push(`${W} .card-head{display:none}`);

  // Any position style but plain replaces the skin's own box around the number.
  if (w.posStyle !== 'plain') out.push(`${R} .pos{background:none;box-shadow:none;border:0}`);
  if (w.posStyle === 'none') out.push(`${R} .posnum{visibility:hidden}`);
  if (w.posStyle === 'box' || w.posStyle === 'circle') {
    out.push(`${R} .posnum{display:inline-grid;place-items:center;min-width:1.7em;height:1.7em;padding:0 .25em;line-height:1;`
      + `background:var(--accent);color:#05070a;border-radius:${w.posStyle === 'circle' ? '999px' : '4px'}}`);
  }
  if (w.mark === 'edge') out.push(`${R}{box-shadow:inset 5px 0 0 var(--c)}`, `${R} > .bar{display:none}`);
  if (w.mark === 'none') out.push(`${R} > .bar{display:none}`);
  if (w.mark === 'tint') {
    // The colour bar itself becomes the row's backdrop: absolutely placed, so it leaves the
    // grid, and under the text thanks to the row's own stacking context.
    out.push(`${R} > .bar{display:block;position:absolute;inset:0;width:auto;height:auto;border-radius:0;opacity:.3;z-index:-1}`);
  }
  if (w.zebra) out.push(`${R}:nth-child(even){background-color:rgba(255,255,255,.06)}`);
  if (w.leader) out.push(`${R}.p1{background-color:rgba(255,255,255,.1);box-shadow:inset 0 0 0 2px var(--accent)}`);

  if (w.style === 'tiles') {
    // Rows as separate panels: the card itself disappears, each row and the header carry
    // the panel look instead.
    out.push(`${W} .card{background:transparent;border-color:transparent;box-shadow:none;overflow:visible}`);
    out.push(`${W} .card::after{display:none}`);
    out.push(`${R},${W} .card-head${isTower ? `,${W} .tw-head` : ''}{background-color:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);margin-bottom:${Math.max(2, w.rowGap)}px}`);
    out.push(`${R}:last-child{border-bottom:1px solid var(--line)}`);
  } else if (w.rowGap > 0) {
    out.push(`${R}{margin-bottom:${w.rowGap}px}`);
  }
  return out;
}

function widgetCss(w) {
  const out = [];
  if (w.lb.on) out.push(...rowsCss('leaderboard', 'lb-row', w.lb, LB_W, false));
  if (w.tw.on) out.push(...rowsCss('tower', 'tw-row', w.tw, TW_W, true));
  if (w.st.on) {
    const S = 'html[data-custom="1"] #status .status-bar';
    const cls = { brand: '.brand-slot', event: '.seg.event', lap: '.seg-lap', clock: '.seg-clock', fl: '.seg-fl' };
    const shown = w.st.segs.filter((c) => c.on);
    out.push(`${S}{height:${w.st.height}px}`);
    w.st.segs.forEach((c) => {
      out.push(c.on ? `${S} > ${cls[c.k]}{order:${shown.indexOf(c)};display:flex}` : `${S} > ${cls[c.k]}{display:none}`);
    });
    const last = shown[shown.length - 1];
    if (last) out.push(`${S} > .seg{border-right:1px solid var(--line)}`, `${S} > ${cls[last.k]}{border-right:0}`);
  }
  for (const [id, c] of Object.entries(w.cm)) {
    const W = `html[data-custom="1"] #${id}`;
    if (!c.head) out.push(`${W} .card-head{display:none}`);
    if (c.bare) out.push(`${W} .card,${W} .ticker-bar{background:transparent;border-color:transparent;box-shadow:none}`, `${W} .card::after{display:none}`);
  }
  return out;
}

/** The Google Fonts stylesheet URL for a set of families, or '' for none. */
export function googleFontsUrl(families) {
  if (!families || !families.length) return '';
  const q = families.slice().sort().map((f) => 'family=' + f.replace(/ /g, '+')).join('&');
  return `https://fonts.googleapis.com/css2?${q}&display=swap`;
}

/*
 * Ready-made designs, deliberately far from the minimal default: a starting point to be
 * changed, not a finished brand. Each one is a template, an accent and a design; applying
 * one switches to the Classic skin, because that is the shape their CSS is written for.
 */
export const PRESETS = [
  {
    id: 'comic', name: 'Comic book', note: 'Halftone yellow, ink outlines, a page torn from a comic.',
    theme: 'paper', accent: '#e8112d', radius: 0,
    design: {
      colors: { panel: '#ffe600', panelHi: '#ffffff', ink: '#111111', inkDim: '#2b2b2b', inkMute: '#555555', line: '#111111', glow: '#111111' },
      fontSans: 'Bangers', fontMono: 'Bangers', fontTitle: 'Bangers', border: 4, sheen: false, crawl: false,
      css: `.card{box-shadow:7px 7px 0 #111;transform:rotate(-.6deg);background-image:radial-gradient(rgba(0,0,0,.14) 1.4px,transparent 1.6px);background-size:9px 9px}
.card-head{background:#e8112d;color:#fff;border-bottom:4px solid #111}
.card-head .title{font-size:24px;letter-spacing:.06em;text-shadow:2px 2px 0 #111}
.card-head .tick{display:none}
.lb-row,.tw-row{border-bottom:2px solid #111;letter-spacing:.04em}
.lb-row .name,.tw-row .name{font-size:20px}
.lb-row .pos,.tw-row .pos{font-size:22px}
.lb-row.p1{background:#fff}`
    }
  },
  {
    id: 'vapor', name: 'Vaporwave', note: 'Pink and cyan sunset, chrome type, a grid to the horizon.',
    theme: 'neon', accent: '#01cdfe', radius: 14,
    design: {
      colors: { panel: '#2a0b45', panelHi: '#ff71ce', ink: '#fdf6ff', inkDim: '#f3c6ff', inkMute: '#b892d6', line: '#ff71ce', purple: '#b967ff', gain: '#05ffa1', lose: '#ff3f8e', glow: '#ff71ce' },
      fontSans: 'Audiowide', fontMono: 'VT323', fontTitle: 'Monoton', italic: true,
      css: `.card{background-image:linear-gradient(180deg,rgba(255,113,206,.28),rgba(1,205,254,.18)),repeating-linear-gradient(0deg,rgba(1,205,254,.18) 0 1px,transparent 1px 22px),repeating-linear-gradient(90deg,rgba(1,205,254,.18) 0 1px,transparent 1px 22px)}
.card-head{background:linear-gradient(90deg,#ff71ce,#b967ff,#01cdfe)}
.card-head .title{font-size:22px;color:#fff;text-shadow:0 0 12px #fff}
.lb-row .gap,.tw-row .gap{font-size:20px}
.lb-row .pos{font-size:20px;color:#01cdfe;text-shadow:0 0 8px #01cdfe}`
    }
  },
  {
    id: 'arcade', name: '8-bit arcade', note: 'Black screen, pixel font, hard shadows. Insert coin.',
    theme: 'carbon', accent: '#39ff14', radius: 0,
    design: {
      colors: { panel: '#000000', panelHi: '#1a1a1a', ink: '#ffffff', inkDim: '#c8c8c8', inkMute: '#8a8a8a', line: '#39ff14', purple: '#ff2bd1', gain: '#39ff14', lose: '#ff3131', glow: '#39ff14' },
      fontSans: 'Press Start 2P', fontMono: 'Press Start 2P', fontTitle: 'Press Start 2P', transform: 'uppercase', border: 4, sheen: false, crawl: false,
      css: `.card{box-shadow:6px 6px 0 var(--accent)}
.card-head .title{font-size:13px;color:var(--accent)}
.lb-row .name,.tw-row .name{font-size:11px;letter-spacing:0}
.lb-row .pos,.tw-row .pos{font-size:13px}
.lb-row .gap,.tw-row .gap,.lb-row .num{font-size:10px}
.lb-row.p1 .posnum{animation:blink8 1s steps(2) infinite}
@keyframes blink8{50%{opacity:0}}`
    }
  },
  {
    id: 'brutal', name: 'Brutalist', note: 'White slabs, black type, thick rules. No decoration at all.',
    theme: 'paper', accent: '#ff3b00', radius: 0,
    design: {
      colors: { panel: '#ffffff', panelHi: '#000000', ink: '#000000', inkDim: '#222222', inkMute: '#555555', line: '#000000', glow: 'transparent' },
      fontSans: 'Arial Black', fontMono: 'Courier New', fontTitle: 'Arial Black', transform: 'uppercase', border: 3, sheen: false, crawl: false,
      css: `.card{box-shadow:none}
.card-head{background:#000;color:#fff}
.card-head .tick{background:var(--accent);box-shadow:none;animation:none;width:14px;height:14px;border-radius:0}
.lb-row,.tw-row{border-bottom:3px solid #000}
.lb-row .gap,.tw-row .gap{font-weight:700}`
    }
  },
  {
    id: 'sketch', name: 'Sketchbook', note: 'Marker on paper, wobbly rows, a hand-drawn race report.',
    theme: 'paper', accent: '#1f5fd6', radius: 4,
    design: {
      colors: { panel: '#fbf7ea', panelHi: '#fff8d6', ink: '#1d1d1d', inkDim: '#3d3d3d', inkMute: '#777777', line: '#1d1d1d', glow: 'rgba(0,0,0,.25)' },
      fontSans: 'Patrick Hand', fontMono: 'Patrick Hand', fontTitle: 'Permanent Marker', border: 2, sheen: false, crawl: false,
      css: `.card{border-style:dashed;background-image:repeating-linear-gradient(0deg,rgba(31,95,214,.13) 0 1px,transparent 1px 30px)}
.card-head .title{font-size:24px;letter-spacing:.02em;text-transform:none}
.lb-row:nth-child(odd),.tw-row:nth-child(odd){transform:rotate(-.5deg)}
.lb-row:nth-child(even),.tw-row:nth-child(even){transform:rotate(.4deg)}
.lb-row .name,.tw-row .name{font-size:21px}
.lb-row .pos,.tw-row .pos{font-size:22px;color:var(--accent)}`
    }
  },
  {
    id: 'glitch', name: 'Glitch', note: 'Split colour channels and a twitch now and then. Unstable on purpose.',
    theme: 'midnight', accent: '#00fff0', radius: 2,
    design: {
      colors: { panel: '#07070c', panelHi: '#12121c', ink: '#f2f2ff', inkDim: '#b4b4d0', inkMute: '#6e6e8c', line: '#ff0050', purple: '#c400ff', gain: '#00fff0', lose: '#ff0050', glow: '#ff0050' },
      fontSans: 'Chakra Petch', fontMono: 'VT323', fontTitle: 'Rubik Glitch',
      css: `.card-head .title{font-size:20px;text-shadow:2px 0 #ff0050,-2px 0 #00fff0;animation:gl 3.2s steps(1) infinite}
.lb-row .name,.tw-row .name{text-shadow:1px 0 rgba(255,0,80,.8),-1px 0 rgba(0,255,240,.8)}
.lb-row .gap,.tw-row .gap{font-size:19px}
.card{animation:glc 7s steps(1) infinite}
@keyframes gl{0%,92%{transform:none}93%{transform:translate(3px,-1px)}95%{transform:translate(-3px,1px)}97%{transform:none}}
@keyframes glc{0%,96%{clip-path:none}97%{clip-path:inset(12% 0 64% 0)}98%{clip-path:inset(58% 0 8% 0)}99%{clip-path:none}}`
    }
  },
  {
    id: 'terminal', name: 'Terminal', note: 'Green phosphor and scanlines. Timing straight from the mainframe.',
    theme: 'retro', accent: '#33ff66', radius: 0,
    design: {
      colors: { panel: '#020a03', panelHi: '#051a08', ink: '#33ff66', inkDim: '#22c94d', inkMute: '#178a35', line: '#1f7a37', purple: '#b6ff6a', gain: '#33ff66', lose: '#ff5555', glow: 'rgba(51,255,102,.35)' },
      fontSans: 'VT323', fontMono: 'VT323', fontTitle: 'VT323', transform: 'uppercase', sheen: false,
      css: `.card{text-shadow:0 0 6px rgba(51,255,102,.7)}
.card::before{content:'';position:absolute;inset:0;pointer-events:none;z-index:3;background:repeating-linear-gradient(0deg,rgba(0,0,0,.28) 0 2px,transparent 2px 4px)}
.card-head .title{font-size:24px}
.card-head .title::before{content:'> '}
.lb-row .name,.tw-row .name{font-size:22px}
.lb-row .gap,.tw-row .gap,.lb-row .pos{font-size:22px}`
    }
  },
  {
    id: 'livery', name: 'Race livery', note: 'Slanted rows and hazard stripes, painted like a race car.',
    theme: 'carbon', accent: '#ffcc00', radius: 0,
    design: {
      colors: { panel: '#111111', panelHi: '#1c1c1c', ink: '#ffffff', inkDim: '#d0d0d0', inkMute: '#8c8c8c', line: '#ffcc00', glow: 'rgba(0,0,0,.6)' },
      fontSans: 'Chakra Petch', fontMono: 'Saira Condensed', fontTitle: 'Racing Sans One', italic: true,
      css: `.card-head{background:repeating-linear-gradient(-45deg,var(--accent) 0 14px,#111 14px 28px)}
.card-head .title{background:#111;padding:2px 12px;font-size:20px;color:var(--accent);transform:skewX(-12deg)}
.card-head .tick{display:none}
.lb-row,.tw-row{transform:skewX(-10deg);margin:3px 8px;background:rgba(255,255,255,.04);border-left:4px solid var(--c)}
.lb-row > *,.tw-row > *{transform:skewX(10deg)}
.lb-row .gap,.tw-row .gap{font-size:18px}`
    }
  },
  {
    id: 'kawaii', name: 'Kawaii', note: 'Pastel pink, bubbly corners and a soft bounce. Absurdly cute.',
    theme: 'paper', accent: '#ff5fa2', radius: 24,
    design: {
      colors: { panel: '#ffe1ef', panelHi: '#fff5fa', ink: '#5a1846', inkDim: '#86406f', inkMute: '#b77fa3', line: '#ffb3d4', purple: '#9b5cff', gain: '#18b77b', lose: '#ff4f6d', glow: 'rgba(255,95,162,.35)' },
      fontSans: 'Fredoka', fontMono: 'Fredoka', fontTitle: 'Fredoka', border: 3, crawl: false,
      css: `.card{background-image:radial-gradient(circle at 12px 12px,rgba(255,255,255,.7) 3px,transparent 4px);background-size:28px 28px}
.card-head .title{font-size:20px;letter-spacing:.04em}
.card-head .title::after{content:' \\2661'}
.lb-row .posnum,.tw-row .posnum{display:inline-block;background:var(--accent);color:#fff;border-radius:999px;min-width:28px}
.lb-row.p1 .posnum{animation:boing 1.6s ease-in-out infinite}
@keyframes boing{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}`
    }
  }
];
