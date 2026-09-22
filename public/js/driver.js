// The driver's phone.
//
// Three things, in order of how much they matter to someone strapped into a race:
//
//   1. the flag, large enough to read at a glance and impossible to mistake
//   2. an alert that reaches them when this page is not the thing on screen
//   3. a window that floats over the game
//
// The third one is where the honest engineering is. A web page cannot draw over another
// Android app — that needs SYSTEM_ALERT_WINDOW and a native APK. What it can do is
// Picture-in-Picture, and a PiP window does float above other apps including a game. PiP
// only accepts video, so the flag is painted to a canvas, the canvas is captured as a
// stream, and the stream is played into a hidden video element which is then handed to
// PiP. That is a real floating window reached through a door the browser actually opens.

import { FLAG_LABEL } from './shared.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const KEY = 'frl.driver.token';
const SHAPE_KEY = 'frl.driver.pipShape';
const TEXT_KEY = 'frl.driver.pipText';

const FLAG_COLOR = {
  idle: '#8e8e93', formation: '#0a84ff', green: '#30d158', yellow: '#ffd60a',
  safety: '#ff9f0a', vsc: '#ffcc00', red: '#ff3b30', finished: '#ffffff'
};
// What the driver is being told to do. The flag name alone is a colour; this is the
// instruction behind it, which is what actually matters at 100kph.
const FLAG_ACTION = {
  idle: 'Wait for the start',
  formation: 'Formation lap — hold position',
  green: 'Racing — go',
  yellow: 'Slow down, no overtaking',
  safety: 'Safety car — slow, no overtaking',
  vsc: 'Virtual safety car — slow, hold the gap',
  red: 'Session stopped — slow down and return to the pits',
  finished: 'Chequered flag — race over'
};

let token = null;
let me = null;
let lastFlag = null;
let lastRadioId = null;
let poll = null;
let swReg = null;

// ---------------------------------------------------------------- sign in

let mode = 'login';   // 'login' | 'register'

function setMode(next) {
  mode = next;
  const reg = mode === 'register';
  $('#signTitle').textContent = reg ? 'Register' : 'Sign in';
  $('#signLede').textContent = reg
    ? 'Pick a number and a password. Race control decides who gets in.'
    : 'Your race control will see your name and let you into the event.';
  $('#fGo').textContent = reg ? 'Register' : 'Sign in';
  $('#fSwap').textContent = reg ? 'Already registered? Sign in' : 'First time here? Register';
  // The name is only asked for when it is being chosen; on the way back in the number
  // identifies the driver and one less field is one less thing to fumble on a phone.
  $('#fNick').closest('.f').hidden = !reg;
  $('#fNick').required = reg;
  $('#fPass').setAttribute('autocomplete', reg ? 'new-password' : 'current-password');
  showError('');
}

function showError(msg) {
  const el = $('#fErr');
  el.textContent = msg || '';
  el.hidden = !msg;
}

$('#fSwap').onclick = () => setMode(mode === 'register' ? 'login' : 'register');

$('#form').onsubmit = async (ev) => {
  ev.preventDefault();
  const nick = $('#fNick').value.trim();
  const num = $('#fNum').value.trim();
  const password = $('#fPass').value;
  $('#fGo').disabled = true;
  try {
    const url = mode === 'register' ? '/api/driver/register' : '/api/driver/login';
    const body = mode === 'register' ? { nick, num, password } : { num, password };
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const out = await res.json().catch(() => ({ ok: false, error: 'Server did not answer' }));
    if (!out.ok) return showError(out.error || 'Could not sign in');
    token = out.token;
    try { localStorage.setItem(KEY, token); } catch { /* private window */ }
    await enterLive();
  } catch {
    showError('Cannot reach race control. Same wifi?');
  } finally {
    $('#fGo').disabled = false;
  }
};

$('#btnOut').onclick = async () => {
  try { await fetch('/api/driver/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) }); } catch { /* going anyway */ }
  try { localStorage.removeItem(KEY); } catch { /* nothing stored */ }
  token = null;
  clearInterval(poll);
  if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
  $('#live').hidden = true;
  $('#signin').hidden = false;
};

// ---------------------------------------------------------------- live

async function enterLive() {
  $('#signin').hidden = true;
  $('#live').hidden = false;
  await refresh();
  clearInterval(poll);
  /*
   * Polled, not pushed. The broadcast socket carries the entire race state several times
   * a second — a roster, a calibration, a penalty record — none of which a phone can use
   * and all of which costs battery and would hand every driver the whole event. This asks
   * a small endpoint for its own driver's slice instead.
   */
  poll = setInterval(refresh, 1500);
}

async function refresh() {
  if (!token) return;
  let out;
  try {
    out = await (await fetch(`/api/driver/me?token=${encodeURIComponent(token)}`)).json();
  } catch {
    return;    // a dropped wifi frame is not worth telling the driver about
  }
  if (!out.ok) {
    try { localStorage.removeItem(KEY); } catch { /* nothing stored */ }
    token = null;
    clearInterval(poll);
    $('#live').hidden = true;
    $('#signin').hidden = false;
    showError('Signed out. Sign in again.');
    return;
  }
  me = out;
  render(out);
}

function render(s) {
  $('#liveWho').textContent = `${s.driver.nick} #${s.driver.num}`;

  const approved = s.status === 'approved';
  $('#pending').hidden = approved;
  $('#stats').hidden = !approved || !s.me;

  const flag = approved ? s.flag : 'idle';
  const color = FLAG_COLOR[flag] || '#8e8e93';
  const label = approved ? (FLAG_LABEL[flag] || '--') : 'WAITING';
  const sub = approved ? (FLAG_ACTION[flag] || '') : 'Race control has not let you in yet';

  const card = $('#flagCard');
  card.style.setProperty('--flag', color);
  // Yellow and white flags need dark text or the label vanishes into its own background.
  card.classList.toggle('dark', ['yellow', 'vsc', 'finished'].includes(flag));
  $('#flagLabel').textContent = label;
  $('#flagSub').textContent = sub;

  if (s.me) {
    $('#sPos').textContent = s.me.position || '--';
    $('#sLap').textContent = s.me.lapsDone ?? '--';
    $('#sLast').textContent = s.me.lastLap ? (s.me.lastLap / 1000).toFixed(3) : '--';
    $('#sBest').textContent = s.me.bestLap ? (s.me.bestLap / 1000).toFixed(3) : '--';
  }

  // Personal flags outrank the session one for the driver holding them.
  const mine = [];
  if (s.me && s.me.blackFlag) mine.push(['black', 'BLACK FLAG — return to the pits, you are out']);
  if (s.me && s.me.blueFlag) mine.push(['blue', 'BLUE FLAG — let the leader through']);
  if (s.me && s.me.penaltyPending) mine.push(['inv', 'UNDER INVESTIGATION']);
  if (s.me && s.me.penaltyServed) mine.push(['pen', `+${s.me.penaltyServed}s PENALTY`]);
  const box = $('#mine');
  const sig = mine.map((m) => m.join()).join('|');
  if (box.dataset.sig !== sig) {
    box.dataset.sig = sig;
    box.innerHTML = mine.map(([k, t]) => `<div class="m ${k}">${t}</div>`).join('');
  }

  if (approved && flag !== lastFlag) {
    if (lastFlag !== null) alertDriver(label, sub, color);
    lastFlag = flag;
  }

  // Team radio: show the input once the driver is on a team; a new message from a teammate
  // pops a banner + an alert, the same way a flag does.
  const tr = $('#teamRadio');
  if (tr) tr.hidden = !s.team;
  if (s.radio && s.radio.id !== lastRadioId) {
    const fromMe = String(s.radio.from || '').toLowerCase() === String((s.driver && s.driver.nick) || '').toLowerCase();
    if (lastRadioId !== null && !fromMe) {
      const m = $('#trMsg');
      if (m) { $('#trFrom').textContent = (s.radio.from || 'TEAM') + ' →'; $('#trBody').textContent = s.radio.text; m.hidden = false; }
      alertDriver('📻 ' + (s.radio.from || 'Team radio'), s.radio.text, '#00a3ff');
    }
    lastRadioId = s.radio.id;
  }

  paint(label, sub, color, s);
}

// ---------------------------------------------------------------- alerts

/**
 * Is there a way to put a message on this phone's screen at all?
 *
 * Android Chrome refuses `new Notification(...)` and demands a service worker; desktop
 * browsers accept either. So the answer is yes if a worker registered, or if the
 * constructor exists to fall back on.
 */
function canAlert() {
  return 'Notification' in window && (!!swReg || typeof Notification === 'function');
}

$('#btnNotify').onclick = async () => {
  if (!window.isSecureContext) return note('Alerts need the https address — see the note below');
  if (!canAlert()) return note('This browser will not show alerts. It still vibrates.');
  const ok = await Notification.requestPermission();
  note(ok === 'granted' ? 'Flag alerts are on' : 'Alerts were blocked in browser settings');
  $('#btnNotify').textContent = ok === 'granted' ? 'Flag alerts on' : 'Turn on flag alerts';
};

// Team radio: send a short message to every teammate on this event.
async function sendRadio() {
  const inp = $('#trText');
  const text = (inp.value || '').trim();
  if (!text || !token) return;
  inp.value = '';
  try {
    await fetch('/api/driver/radio', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, text })
    });
  } catch { /* offline — the poll will resync */ }
}
$('#trSend').onclick = sendRadio;
$('#trText').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sendRadio(); } });

function note(msg) {
  const el = $('#floatNote');
  const was = el.textContent;
  el.textContent = msg;
  setTimeout(() => { el.textContent = was; }, 2600);
}

/**
 * Reach the driver when this page is not what they are looking at.
 *
 * Vibration first: it is the only one that works with the screen off and the phone in a
 * pocket, and it needs no permission. The notification is the part that says what
 * changed, and on Android it has to go through the service worker — the Notification
 * constructor is blocked there.
 */
function alertDriver(label, sub, color) {
  try { navigator.vibrate?.([120, 60, 120]); } catch { /* not supported */ }
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const body = sub || '';
  const opts = { body, tag: 'frl-flag', renotify: true, silent: false };
  if (swReg && swReg.showNotification) {
    swReg.showNotification(label, opts).catch(() => {});
    return;
  }
  // No worker: desktop browsers still allow the constructor, Android throws. Either way
  // a failed alert must not take the flag card down with it.
  try { new Notification(label, opts); } catch { /* vibration already did its job */ }
}

// ---------------------------------------------------------------- floating window

const canvas = $('#pipCanvas');
const ctx = canvas.getContext('2d');
const video = $('#pipVideo');
let stream = null;

/*
 * How much of the floating window this page actually controls.
 *
 * Not the pixel size. Android owns the window and hands it a width of its own choosing,
 * then derives the height from the aspect ratio of the video it was given. The video's
 * own resolution does not enter into it — an earlier version of this file offered a
 * small/medium/large control built on that assumption and it did nothing at all on a
 * phone, which is exactly what testing on one showed.
 *
 * So there are two honest levers, and they are these:
 *
 *   shape — the aspect ratio, which Android does obey. Because width is roughly fixed and
 *           height follows the ratio, a taller shape is a physically bigger window. That
 *           is the closest thing to a size control that exists here.
 *   text  — how large the lettering is drawn inside whatever window we are given. Nothing
 *           to do with the OS, entirely ours, and the thing that decides whether the flag
 *           can be read at a glance.
 */
/*
 * One axis, not two.
 *
 * Shape and size were offered separately and that was a fiction: Android picks the
 * window's width itself and derives the height from the aspect ratio, so on a phone the
 * two are the same knob. A flatter ratio is a shorter — smaller — window; a taller ratio
 * is a bigger one. Listed smallest first, which is the order they appear in.
 *
 * Android refuses a ratio outside roughly 1:2.39 .. 2.39:1 and will not open the window
 * at all, so both ends stay inside that with room to spare.
 */
const PIP_SHAPES = {
  bar:    { ratio: 2.20 },   // a thin strip: the least of the game covered
  wide:   { ratio: 1.60 },
  square: { ratio: 1.00 },
  tall:   { ratio: 0.70 },
  max:    { ratio: 0.50 }    // the largest window Android will give without complaint
};

/*
 * Text sizes — how much of the window's height the flag name is allowed to claim.
 *
 * The first version of this capped the font size instead and barely changed anything: a
 * flag name set on one line is limited by how wide the window is long before any height
 * cap bites, so "RED FLAG" came out the same size at every setting. Measured across the
 * shapes it moved 84px to 85px. The cap was not the constraint; the width of the phrase
 * was.
 *
 * Breaking the name across lines is what makes it adjustable. Then the limit is the
 * longest single word, which is far narrower, and the height budget below is what
 * actually decides the size.
 *
 * `sub` drops the instruction line at the largest setting on purpose: the two compete for
 * the same space, and a driver glancing down mid-corner needs the word, not the sentence.
 * The full wording is always on the page itself.
 */
const PIP_TEXT = {
  s: { block: 0.34, sub: true },
  m: { block: 0.48, sub: true },
  l: { block: 0.78, sub: false }
};

// Fixed, and nothing to do with the window's size on screen — this is only how many
// pixels the letters are drawn with, so they stay sharp when Android scales the window.
const PIP_LONG = 640;

let pipShape = 'wide';
let pipText = 'm';
// paint() is normally driven by the poll; a settings change has to redraw without one.
let lastPaint = { label: 'WAITING', sub: '', color: '#8e8e93', s: null };

function sizeCanvas() {
  const { ratio } = PIP_SHAPES[pipShape] || PIP_SHAPES.wide;
  if (ratio >= 1) { canvas.width = PIP_LONG; canvas.height = Math.round(PIP_LONG / ratio); }
  else { canvas.height = PIP_LONG; canvas.width = Math.round(PIP_LONG * ratio); }
}

/** Largest font at which `text` still fits `maxWidth`, never bigger than `cap`. */
function fitFont(text, weight, maxWidth, cap) {
  let px = cap;
  ctx.font = `${weight} ${px}px Inter, system-ui, sans-serif`;
  while (px > 10 && ctx.measureText(text).width > maxWidth) {
    px -= 2;
    ctx.font = `${weight} ${px}px Inter, system-ui, sans-serif`;
  }
  return px;
}

/** Greedy word wrap at whatever font is currently set on the context. */
function wrapWords(words, maxWidth) {
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (line && ctx.measureText(test).width > maxWidth) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Set the flag name as large as it will go inside a box.
 *
 * Both limits are real: every line has to fit the width, and the stack of them has to fit
 * the height. Shrinking re-wraps at each step rather than keeping the first wrap, because
 * a smaller font can fit more words per line and that changes how many lines there are.
 */
function fitBlock(text, maxWidth, maxHeight) {
  const words = String(text || '').split(' ').filter(Boolean);
  let px = Math.max(12, Math.round(maxHeight));
  for (;;) {
    ctx.font = `700 ${px}px Inter, system-ui, sans-serif`;
    const lines = wrapWords(words, maxWidth);
    const lineH = Math.round(px * 1.04);
    const widest = lines.reduce((m, l) => Math.max(m, ctx.measureText(l).width), 0);
    if ((widest <= maxWidth && lines.length * lineH <= maxHeight) || px <= 12) {
      return { px, lines, lineH };
    }
    px -= 2;
  }
}

/** The flag, drawn big enough to read in a window the size of a matchbox. */
function paint(label, sub, color, s) {
  lastPaint = { label, sub, color, s };
  const W = canvas.width, H = canvas.height;
  // Tighter margins when the flag name has the window to itself: the padding is there to
  // keep two competing blocks of text apart, and with one block it is just lost width.
  const pad = Math.round(W * ((PIP_TEXT[pipText] || PIP_TEXT.m).sub ? 0.07 : 0.045));

  ctx.fillStyle = color;
  ctx.fillRect(0, 0, W, H);

  const dark = ['#ffd60a', '#ffcc00', '#ffffff'].includes(color);
  ctx.fillStyle = dark ? '#05070a' : '#ffffff';
  ctx.textAlign = 'center';

  /*
   * Everything is measured before anything is drawn.
   *
   * An earlier arrangement placed the flag name first, at a fixed fraction of the height,
   * and then put the instruction wherever was left. On a wide window that left nothing:
   * the name landed low enough that the first instruction line was already past the
   * bottom edge and the whole sentence was silently dropped. Nothing looked broken — the
   * text was simply not there.
   *
   * So the space is divided up front: the driver's line takes the top, and the name and
   * the instruction share what remains as one block that is centred in it.
   */
  const size = PIP_TEXT[pipText] || PIP_TEXT.m;
  const maxW = W - pad * 2;

  const who = s ? `${s.driver.nick} #${s.driver.num}` : '';
  const pos = s && s.me && s.me.position ? `  ·  P${s.me.position}` : '';
  const topSize = fitFont(who + pos, 600, maxW, Math.max(11, Math.round(H * 0.075)));
  const top = pad + topSize;
  const avail = H - top - Math.round(pad * 0.6);

  // The name is wrapped, so a two-word flag is not held down to the width of both words
  // at once — that is what makes the text setting able to change anything at all. When
  // the instruction is shown the name is also kept to part of the space so there is
  // somewhere for it to go.
  let name = fitBlock(label, maxW, Math.min(H * size.block, size.sub ? avail * 0.6 : avail));
  let nameH = name.lines.length * name.lineH;

  let subLines = [], subSize = 0, subLineH = 0;
  if (size.sub) {
    subSize = Math.max(11, Math.round(name.px * 0.3));
    subLineH = Math.round(subSize * 1.24);
    ctx.font = `500 ${subSize}px Inter, system-ui, sans-serif`;
    subLines = wrapWords(String(sub || '').split(' ').filter(Boolean), maxW);

    // It fits whole or it does not appear. A sentence cut off after three words reads as
    // an instruction the driver has missed the end of, which is worse than no sentence at
    // all — and in the shortest window that is what "as much as fits" produced. When it
    // will not fit, the space goes back to the flag name, which is the message anyway.
    const room = Math.max(0, Math.floor((avail - nameH - subSize * 0.5) / subLineH));
    if (subLines.length > room) {
      subLines = [];
      name = fitBlock(label, maxW, Math.min(H * size.block, avail));
      nameH = name.lines.length * name.lineH;
    }
  }

  const gap = subLines.length ? Math.round(subSize * 0.5) : 0;
  const groupH = nameH + gap + subLines.length * subLineH;
  const blockTop = top + Math.round((avail - groupH) / 2);

  ctx.font = `700 ${name.px}px Inter, system-ui, sans-serif`;
  name.lines.forEach((l, i) => {
    ctx.fillText(l, W / 2, blockTop + name.px * 0.82 + i * name.lineH);
  });

  if (subLines.length) {
    ctx.font = `500 ${subSize}px Inter, system-ui, sans-serif`;
    ctx.globalAlpha = 0.82;
    const subTop = blockTop + nameH + gap;
    subLines.forEach((l, i) => {
      ctx.fillText(l, W / 2, subTop + subSize * 0.82 + i * subLineH);
    });
  }

  ctx.globalAlpha = 0.62;
  ctx.font = `600 ${topSize}px Inter, system-ui, sans-serif`;
  ctx.fillText(who + pos, W / 2, pad + topSize);
  ctx.globalAlpha = 1;
}

/**
 * Wait until the video is actually carrying a frame of the current canvas.
 *
 * Android reads the window's aspect ratio from the video it is handed, and a capture at
 * 4fps has produced nothing at the moment it is handed over: `video.videoWidth` is zero,
 * or still the previous size, and the shape request is read off that. The window then
 * opens at whatever default the phone likes, which looks exactly like the shape setting
 * doing nothing.
 *
 * Painting once forces the canvas to produce a frame rather than waiting up to a quarter
 * of a second for the next scheduled one. The timeout is a floor, not a guess: nothing
 * here may hang, because the caller is spending a user gesture that expires.
 */
function firstFrame() {
  const { label, sub, color, s } = lastPaint;
  paint(label, sub, color, s);
  return new Promise((done) => {
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(() => done());
    setTimeout(done, 350);
  });
}

/**
 * Take a new shape or size into use.
 *
 * Resizing the canvas clears it and changes the resolution the capture produces, and an
 * already-open PiP window keeps the aspect ratio it was opened with. So when one is open
 * it has to be closed and reopened. That reopen spends the user activation from the tap
 * that got us here, which is why nothing slow is awaited on the way to it.
 */
async function applyPipPrefs({ redrawOnly = false } = {}) {
  const wasFloating = !redrawOnly && document.pictureInPictureElement === video;
  if (!redrawOnly) sizeCanvas();
  const { label, sub, color, s } = lastPaint;
  paint(label, sub, color, s);

  if (redrawOnly) return;
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = canvas.captureStream(4);
    video.srcObject = stream;
  }
  await firstFrame();
  if (!wasFloating) return;
  try {
    await document.exitPictureInPicture();
    await video.play();
    await video.requestPictureInPicture();
  } catch {
    // Chrome can refuse the reopen if it decides the tap no longer counts as a gesture.
    // Saying so beats leaving the driver looking at a window that closed itself; the
    // button label has already corrected itself through the leave event.
    note('Size saved — tap to open the window again');
  }
}

function markSegments() {
  $$('#segShape button').forEach((b) => b.classList.toggle('on', b.dataset.shape === pipShape));
  $$('#segText button').forEach((b) => b.classList.toggle('on', b.dataset.text === pipText));
}

$$('#segShape button').forEach((b) => {
  b.onclick = () => {
    pipShape = b.dataset.shape;
    try { localStorage.setItem(SHAPE_KEY, pipShape); } catch { /* private window */ }
    markSegments();
    applyPipPrefs();
  };
});
$$('#segText button').forEach((b) => {
  b.onclick = () => {
    pipText = b.dataset.text;
    try { localStorage.setItem(TEXT_KEY, pipText); } catch { /* private window */ }
    markSegments();
    // Only the drawing changes, so there is no need to disturb a window that is already
    // open — the next frame of the capture carries the new size across on its own.
    applyPipPrefs({ redrawOnly: true });
  };
});

$('#btnFloat').onclick = async () => {
  if (!document.pictureInPictureEnabled) {
    return note('This browser cannot float a window. Chrome on Android can.');
  }
  try {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
      return;
    }
    if (!stream) {
      // Four frames a second. The flag is a state, not a moving picture, and a slower
      // stream is a slower battery drain on a phone that is also running the game.
      stream = canvas.captureStream(4);
      video.srcObject = stream;
    }
    await video.play();
    // Not optional: without a frame in hand the window opens at the wrong shape.
    await firstFrame();
    await video.requestPictureInPicture();
  } catch (err) {
    note(`Could not open it: ${err.message}`);
  }
};

/*
 * What size did Android actually give us?
 *
 * Everything above is a request. The phone decides, and this page has been guessing at
 * what it decided — badly, twice. `document.pictureInPictureWindow` is the browser's own
 * answer, and it updates as the window is dragged, so it is shown on the page rather than
 * assumed. If a setting turns out to change nothing on a given phone, this is the line
 * that says so instead of leaving it to be discovered mid-race.
 */
function showWindowSize() {
  const el = $('#pipReal');
  const w = document.pictureInPictureWindow;
  if (!w || !w.width) { el.hidden = true; return; }
  const asked = (PIP_SHAPES[pipShape] || PIP_SHAPES.square).ratio;
  const got = w.width / w.height;
  const honoured = Math.abs(got - asked) / asked < 0.12;
  el.hidden = false;
  el.textContent = honoured
    ? `Window: ${w.width}×${w.height}`
    : `Window: ${w.width}×${w.height} — this phone ignored the shape (asked ${asked.toFixed(2)}, got ${got.toFixed(2)})`;
  el.classList.toggle('warn', !honoured);
}

/*
 * The label follows the window rather than the tap that asked for it.
 *
 * Changing shape while floating closes the window and opens a new one, so a label written
 * by hand at the call site ends up describing a state that lasted a few milliseconds. The
 * browser tells us what actually happened; listen to that instead.
 */
video.addEventListener('enterpictureinpicture', (ev) => {
  $('#btnFloat').textContent = 'Close floating window';
  // The window is only measurable once it exists, and it keeps changing size while the
  // driver drags it, so follow it rather than sampling once.
  const win = ev.pictureInPictureWindow || document.pictureInPictureWindow;
  if (win) win.addEventListener('resize', showWindowSize);
  showWindowSize();
});
video.addEventListener('leavepictureinpicture', () => {
  $('#btnFloat').textContent = 'Open floating window';
  $('#pipReal').hidden = true;
});

/**
 * Show the way to the secure address, but only when there is one. A button that leads to
 * a port nothing is listening on is worse than no button, so the port is asked for rather
 * than assumed, and the notice stays hidden if the server has no certificate.
 */
async function offerSecure() {
  let net;
  try { net = await (await fetch('/api/net')).json(); } catch { return; }
  if (!net || !net.tlsPort) return;
  const url = `https://${location.hostname}:${net.tlsPort}${location.pathname}`;
  const link = $('#secLink');
  link.href = url;
  link.textContent = `Open ${url.replace(/^https:\/\//, '')}`;
  $('#secNote').hidden = false;
}

// ---------------------------------------------------------------- boot

(async function boot() {
  setMode('login');

  // Restore the shape and size this driver chose last time before the first paint, so the
  // canvas is never briefly the wrong shape.
  try {
    const sh = localStorage.getItem(SHAPE_KEY);
    const tx = localStorage.getItem(TEXT_KEY);
    if (sh && PIP_SHAPES[sh]) pipShape = sh;
    if (tx && PIP_TEXT[tx]) pipText = tx;
  } catch { /* private window: the defaults are fine */ }
  sizeCanvas();
  markSegments();
  paint('WAITING', '', '#8e8e93', null);

  /*
   * Over plain http on a phone there is no service worker and no Notification API —
   * Android blocks both outside a secure context, and localhost does not count as one
   * from another device. Vibration and the floating window are unaffected, so the page
   * still does its job; what it must not do is leave a button that quietly never works.
   * The server runs https on a second port for exactly this, so point at it.
   */
  if (!window.isSecureContext) {
    $('#btnNotify').textContent = 'Flag alerts need https';
    await offerSecure();
  } else {
    if ('serviceWorker' in navigator) {
      // Swallowing this failure is what made an earlier version lie: the button still
      // said alerts were available and nothing ever arrived. Registration can fail for
      // reasons outside the page — an embedded browser with workers disabled, a locked
      // down profile — so record it and let the button say what is actually true.
      try { swReg = await navigator.serviceWorker.register('/driver-sw.js'); } catch { swReg = null; }
    }
    if (!canAlert()) {
      $('#btnNotify').textContent = 'Alerts unavailable here';
      $('#btnNotify').disabled = true;
      $('#floatNote').textContent =
        'This browser will not show flag alerts. The phone still vibrates on a flag change, '
        + 'and the floating window keeps working.';
    } else if (Notification.permission === 'granted') {
      $('#btnNotify').textContent = 'Flag alerts on';
    }
  }
  if (!document.pictureInPictureEnabled) {
    $('#btnFloat').disabled = true;
    $('#floatNote').textContent =
      'This browser cannot float a window over other apps. Chrome on Android can.';
  }

  try { token = localStorage.getItem(KEY); } catch { token = null; }
  if (token) await enterLive();
})();
