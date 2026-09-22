// Shared between the operator panel and every overlay page.

export const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

/**
 * A difference rather than a time of day: seconds with three decimals, minutes only when
 * there are minutes. The server formats gaps the same way, and a timing screen that shows
 * "+0.412" in one place and "+00:00.412" in another looks broken even though both are right.
 */
export function fmtGap(ms) {
  if (ms == null || Number.isNaN(ms)) return '--';
  const s = ms / 1000;
  if (s < 60) return s.toFixed(3);
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(3).padStart(6, '0')}`;
}

export function fmtTime(ms, { forceMinutes = false, decimals = 3 } = {}) {
  if (ms == null || Number.isNaN(ms)) return '--:--.---';
  const neg = ms < 0;
  ms = Math.abs(ms);
  const totalSec = ms / 1000;
  const m = Math.floor(totalSec / 60);
  const s = totalSec - m * 60;
  const sStr = s.toFixed(decimals).padStart(decimals ? decimals + 3 : 2, '0');
  const body = m > 0 || forceMinutes ? `${m}:${sStr}` : sStr;
  return (neg ? '-' : '') + body;
}

export function fmtClock(ms) {
  if (ms == null) return '00:00';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function ordinal(n) {
  const s = ['TH', 'ST', 'ND', 'RD'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Live connection to the race server. Auto-reconnects. */
export class Bus {
  constructor(role = 'client') {
    this.role = role;
    // A stable id for this page load. Detection has to run on exactly one machine —
    // two nodes watching the same track would each report the same lap.
    this.clientId = `${role}-${Math.random().toString(36).slice(2, 8)}`;
    this.state = null;
    this.handlers = { state: new Set(), signal: new Set(), open: new Set(), close: new Set() };
    this.queue = [];
    this.connect();
  }

  connect() {
    // Tell the server which page this is. An overlay opened by OBS and an overlay
    // embedded in the panel's own preview look identical otherwise, and the operator
    // needs to be able to tell whether OBS is actually attached.
    const page = encodeURIComponent(location.pathname + (window.top === window.self ? '' : ' [embedded]'));
    this.ws = new WebSocket(`${WS_URL}?role=${this.role}&page=${page}&id=${this.clientId}`);
    this.ws.onopen = () => {
      document.documentElement.classList.remove('disconnected');
      for (const m of this.queue.splice(0)) this.ws.send(m);
      this.handlers.open.forEach((f) => f());
    };
    this.ws.onclose = () => {
      document.documentElement.classList.add('disconnected');
      this.handlers.close.forEach((f) => f());
      clearTimeout(this.retry);
      this.retry = setTimeout(() => this.connect(), 1200);
    };
    this.ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'state') {
        this.state = msg.state;
        this.handlers.state.forEach((f) => f(msg.state));
      } else if (msg.type === 'signal') {
        this.handlers.signal.forEach((f) => f(msg.channel, msg.data));
      }
    };
  }

  on(evt, fn) { this.handlers[evt].add(fn); return () => this.handlers[evt].delete(fn); }

  raw(obj) {
    const s = JSON.stringify(obj);
    if (this.ws && this.ws.readyState === 1) this.ws.send(s);
    else if (this.queue.length < 50) this.queue.push(s);
  }

  action(type, extra = {}) { this.raw({ type: 'action', action: { type, ...extra } }); }
  signal(channel, data) { this.raw({ type: 'signal', channel, data }); }
}

/** Drivers sorted into classification order, using the server-computed position. */
export function classification(state) {
  if (!state) return [];
  return [...state.drivers].sort((a, b) => a.position - b.position);
}

/** Elapsed race time, ticked locally from the server's green-flag timestamp. */
export function raceElapsed(state, now = Date.now()) {
  const r = state?.race;
  if (!r || !r.startedAt) return 0;
  const end = r.finishedAt || r.pausedAt || now;
  return Math.max(0, end - r.startedAt - r.pausedTotal);
}

export function leaderLap(state) {
  if (!state || !state.drivers.length) return 0;
  return Math.max(0, ...state.drivers.map((d) => d.lapsDone));
}

export function fastestLap(state) {
  let best = null;
  for (const d of state?.drivers || []) {
    if (d.bestLap != null && (best == null || d.bestLap < best.bestLap)) best = d;
  }
  return best;
}

export const FLAG_LABEL = {
  idle: 'STANDBY',
  formation: 'FORMATION LAP',
  green: 'RACING',
  yellow: 'YELLOW FLAG',
  safety: 'SAFETY CAR',
  // The abbreviation every broadcast uses, and the only one that fits the pill on one
  // line. Spelled out it wraps and pushes the bar out of shape.
  vsc: 'VSC',
  red: 'RED FLAG',
  finished: 'CHEQUERED FLAG'
};
