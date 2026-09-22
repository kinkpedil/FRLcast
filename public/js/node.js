// Capture node: the stripped-down half of the operator panel.
//
// It exists because of one hard constraint — detection has to run on the machine that
// displays the game, since that is the only machine whose browser can capture the
// window. On a three-device setup that machine is usually also the one running OBS,
// which is exactly where spare CPU is scarcest. So this page does capture and
// detection and nothing else: no classification table, no live preview, no editors.
//
// The operator panel on the second device drives everything else, and can still draw
// regions because this node shares a low-rate preview snapshot over the bus.

import { Bus, fmtTime } from './shared.js';
import { Capture } from './capture.js';
import { VisionEngine } from './vision.js';
import { applyVisionSettings } from './settings.js';

const $ = (sel) => document.querySelector(sel);

const bus = new Bus('node');
const capture = new Capture();
const vision = new VisionEngine(capture, bus);

let state = null;
const label = `${location.hostname === 'localhost' ? 'this machine' : location.hostname} (capture node)`;

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('on'), 2000);
}

// ---------------------------------------------------------------- capture

/*
 * Say up front when this browser cannot capture, rather than letting the operator press
 * a button that can only fail. Over plain http to a LAN address the capture API is not
 * merely restricted, it is absent, so there is nothing to prompt for and nothing to allow.
 */
(function announceIfBlocked() {
  const why = capture.blockedReason;
  if (!why) return;
  $('#blocked').hidden = false;
  $('#blockedWhy').textContent = why.split('\n\n')[0];
  const url = (why.match(/https:\/\/\S+/) || [])[0];
  if (url) {
    const go = $('#blockedGo');
    go.href = url;
    go.textContent = url;
    go.style.display = '';
  }
  $('#btnCapture').disabled = true;
  $('#btnDetect').disabled = true;
})();

$('#btnCapture').onclick = async () => {
  try {
    const dim = await capture.start({ fps: vision.targetFps });
    bus.action('calibration.set', { patch: { sourceSize: { w: dim.w, h: dim.h } } });
    toast(`Capturing ${dim.w}×${dim.h}`);
  } catch (err) {
    toast(`Cancelled: ${err.message}`);
  }
};

$('#btnStop').onclick = () => {
  vision.stop();
  capture.stop();
};

function startDetection({ fromRemote = false } = {}) {
  if (vision.running) return true;
  if (!capture.active) {
    toast('Select the game window first');
    return false;
  }
  // Two nodes detecting the same track would each report every lap.
  const v = state && state.vision;
  if (!fromRemote && v && v.active && v.owner && v.owner !== bus.clientId) {
    if (!confirm(`Detection is already running on "${v.ownerLabel || v.owner}".\n\nStart here anyway? Laps would be counted twice.`)) return false;
  }
  bus.action('vision.status', { patch: { owner: bus.clientId, ownerLabel: label } });
  vision.start();
  return true;
}

$('#btnDetect').onclick = () => {
  if (vision.running) vision.stop();
  else startDetection();
};

// The operator works on the other device, so let the panel drive this node's
// detection rather than making someone walk over to the machine running the game.
bus.on('signal', (channel, data) => {
  if (channel !== 'node-control') return;
  if (data && data.to && data.to !== bus.clientId) return;
  if (data && data.action === 'start') {
    if (!startDetection({ fromRemote: true })) {
      toast('Panel asked to start, but no game window is selected here');
    }
  } else if (data && data.action === 'stop') {
    vision.stop();
  }
});

/** Heartbeat so the panel knows this node exists and what it is able to do. */
setInterval(() => {
  bus.signal('node-status', {
    id: bus.clientId,
    label,
    hasCapture: capture.active,
    running: vision.running,
    fps: vision.fps,
    health: vision.health
  });
}, 2000);

// ---------------------------------------------------------------- preview sharing

// A snapshot every half second is enough to draw regions against, and small enough
// that it never competes with the capture itself.
const PREVIEW_INTERVAL_MS = 500;
let lastShare = 0;

vision.onFrame = (debug) => {
  if (!$('#sharePreview').checked || !capture.active) return;
  const now = performance.now();
  if (now - lastShare < PREVIEW_INTERVAL_MS) return;
  lastShare = now;
  const url = capture.dataURL(0.45, 640);
  if (!url) return;

  // Ship what the detector is actually seeing, not just the picture. Without this the
  // operator on the other device has no way to tell "the AI cannot find the car" from
  // "the car is not moving" — which are completely different problems.
  const rois = (state && state.calibration.rois) || [];
  const blobs = (debug && debug.blobs || []).map((b) => {
    const roi = rois.find((r) => r.id === b.roiId);
    if (!roi) return null;
    return {
      driverId: b.driverId,
      color: b.color,
      n: b.n,
      x: roi.x + b.x * roi.w,     // frame-normalised, so the panel can draw it directly
      y: roi.y + b.y * roi.h
    };
  }).filter(Boolean);

  const tracked = (state ? state.drivers : []).map((d) => ({
    id: d.id,
    seen: !!d.trackedAt && Date.now() - d.trackedAt < 2000,
    progress: d.progress,
    speed: d.speed
  }));

  bus.signal('node-preview', {
    from: bus.clientId, label, url, w: capture.width, h: capture.height,
    blobs, tracked, unnamed: (debug && debug.unnamed) || 0
  });
};

// ---------------------------------------------------------------- readout

const lines = [];
vision.onEvent = (e) => {
  const d = state?.drivers.find((x) => x.id === e.driverId);
  let text;
  if (e.type === 'finish' || e.type === 'lap') text = `LAP ${d?.name || ''}`;
  else if (e.type === 'sector') text = `S${e.index ?? ''} ${d?.name || ''}`;
  else if (e.type === 'lapTime') text = `TIME ${d?.name || ''} ${fmtTime(e.ms)}`;
  else if (e.type === 'ocr') text = `OCR ${e.text}`;
  else if (e.type === 'leaderboard') text = `LB ${e.rows.length} rows`;
  else if (e.type === 'ocr-status') text = `OCR ${e.state}`;
  else if (e.type === 'error') text = `ERROR ${e.message}`;
  else text = e.type;
  lines.unshift(`<div>${new Date().toLocaleTimeString()} ${text}</div>`);
  lines.length = Math.min(lines.length, 40);
  $('#log').innerHTML = lines.join('');
  $('#stLast').textContent = text.slice(0, 22);
};

function render() {
  const running = vision.running;
  $('#bigFps').firstChild.nodeValue = running ? String(vision.fps) : '--';
  $('#bigFps').classList.toggle('ok', running && vision.health === 'ok');
  $('#bigFps').classList.toggle('bad', running && vision.health !== 'ok');
  $('#bigMode').textContent = running
    ? `${vision.mode === 'frames' ? 'frame-driven' : 'timer'} · fps`
    : 'idle';

  $('#btnDetect').textContent = running ? 'Stop detection' : 'Start detection';
  $('#btnDetect').classList.toggle('on', running);

  const s = capture.trackSettings();
  $('#stSource').textContent = s ? `${s.width}×${s.height} @ ${Math.round(s.frameRate || 0)}` : 'none';
  $('#stPixels').textContent = capture.copiedPixels ? `${(capture.copiedPixels / 1000).toFixed(0)}k` : '--';

  if (state) {
    const rois = (state.calibration.rois || []).length;
    const ls = (state.calibration.lines || []).length;
    $('#stCal').textContent = `${rois} · ${ls}`;
    $('#stDrivers').textContent = String(state.drivers.filter((d) => !d.dnf).length);
  }
}

setInterval(render, 400);
// A handle for diagnosing a live event from the console: what settings this engine
// actually holds, what the tracker currently sees, what the capture is doing.
window.__frl = { vision, capture, bus, get settings() { return vision.settings; }, get targetFps() { return vision.targetFps; } };

bus.on('state', (s) => {
  state = s;
  // The operator tunes detection from the panel on the other device; this is where
  // those settings actually take effect on the machine that sees the game.
  applyVisionSettings(vision, s.vision && s.vision.settings);
});

// keep the tab awake for the same reason the panel does
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && capture.active) capture.keepAwake();
});
