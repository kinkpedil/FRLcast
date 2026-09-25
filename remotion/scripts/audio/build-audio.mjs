// Builds the tutorial's soundtrack and muxes it onto the rendered video.
//
//   node scripts/audio/build-audio.mjs [video-in.mp4] [video-out.mp4]
//
// 1. Reads the cue sheet (scripts/audio/cues.ts, bundled with esbuild) so every sound lines up
//    with the same timeline the video was rendered from.
// 2. Synthesises the sound effects in code (whoosh, click, pop, key tick, chime, boom...): no
//    downloaded sound packs, nothing to license.
// 3. Voices every caption and narration line with the local Piper voice. A line that would run
//    into the next one is re-spoken faster (Piper's length_scale) until it fits its slot.
// 4. Adds a soft synthesised ambient music bed that ducks under the voice.
// 5. Mixes everything into one 48 kHz track and muxes it onto the video (video stream copied,
//    so the picture is not re-encoded).
//
// Voice: set VOICE=en_US-hfc_female-medium to switch. Music: MUSIC=0 to drop it, MUSIC_GAIN
// to scale it. Results are cached in .audio/.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..'); // remotion/
const REPO = path.resolve(ROOT, '..');
const CACHE = path.join(ROOT, '.audio');
const VO_DIR = path.join(CACHE, 'vo');
fs.mkdirSync(VO_DIR, { recursive: true });

const VIDEO_IN = path.resolve(ROOT, process.argv[2] || 'out/tutorial-full-animation.mp4');
const VIDEO_OUT = path.resolve(ROOT, process.argv[3] || 'out/tutorial-full-animation-sound.mp4');
const VOICE = process.env.VOICE || 'en_US-ryan-medium';
const PIPER = process.env.FRL_PIPER || path.join(REPO, 'tools/piper/piper.exe');
const MODEL = path.join(process.env.FRL_VOICES || path.join(REPO, 'tools/piper/voices'), `${VOICE}.onnx`);
const SR = 48000;

// ---------------------------------------------------------------- cue sheet

// esbuild's JS API rather than its CLI: no shell, so the space in the project path is harmless
const { buildSync } = await import('esbuild');
buildSync({
  entryPoints: [path.join(HERE, 'cues.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  outfile: path.join(CACHE, 'cues.cjs'),
  logLevel: 'warning',
});
const sheet = JSON.parse(execFileSync(process.execPath, [path.join(CACHE, 'cues.cjs')], { maxBuffer: 64 << 20 }).toString());
const { fps, total, cues } = sheet;
const LEN = Math.ceil((total / fps + 0.5) * SR);
console.log(`cues: ${cues.length} (${total} frames at ${fps} fps, ${(total / fps).toFixed(1)} s)`);

// ---------------------------------------------------------------- sound effects

let seed = 12345;
const noise = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
const buf = (sec) => new Float32Array(Math.ceil(sec * SR));
const norm = (b, peak = 0.9) => {
  let m = 0;
  for (const v of b) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let i = 0; i < b.length; i++) b[i] *= peak / m;
  return b;
};

/** State-variable filter over noise with a time-varying centre frequency. */
function filteredNoise(sec, fc, damp = 0.6, mode = 'band') {
  const out = buf(sec);
  let low = 0;
  let band = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const f = 2 * Math.sin((Math.PI * Math.min(fc(t), SR / 6)) / SR);
    const high = noise() - low - damp * band;
    band += f * high;
    low += f * band;
    out[i] = mode === 'band' ? band : low;
  }
  return out;
}

function whoosh(sec, f0, f1, f2) {
  const b = filteredNoise(sec, (t) => (t < sec / 2 ? f0 + (f1 - f0) * (t / (sec / 2)) : f1 + (f2 - f1) * ((t - sec / 2) / (sec / 2))), 0.5);
  for (let i = 0; i < b.length; i++) b[i] *= Math.pow(Math.sin((Math.PI * i) / b.length), 1.6);
  return norm(b);
}

function tone(b, at, freq, decay, gain = 1, harm = 0.15) {
  const s = Math.floor(at * SR);
  for (let i = s; i < b.length; i++) {
    const t = (i - s) / SR;
    const env = (1 - Math.exp(-t / 0.003)) * Math.exp(-t / decay);
    if (env < 1e-4 && t > 0.05) break;
    b[i] += gain * env * (Math.sin(2 * Math.PI * freq * t) + harm * Math.sin(4 * Math.PI * freq * t));
  }
}

const SFX = {
  whoosh: () => whoosh(0.7, 250, 3000, 600),
  swoosh: () => whoosh(0.32, 700, 2600, 1300),
  whooshSoft: () => whoosh(0.5, 300, 1400, 500),
  click: () => {
    const b = buf(0.04);
    for (let i = 0; i < b.length; i++) {
      const t = i / SR;
      b[i] = noise() * Math.exp(-t / 0.0025) * 0.8 + Math.sin(2 * Math.PI * 1800 * t) * Math.exp(-t / 0.004) * 0.4 + Math.sin(2 * Math.PI * 150 * t) * Math.exp(-t / 0.012) * 0.5;
    }
    return norm(b);
  },
  tick: () => {
    const b = filteredNoise(0.02, () => 4200, 0.4);
    for (let i = 0; i < b.length; i++) {
      const t = i / SR;
      b[i] = b[i] * Math.exp(-t / 0.0016) + Math.sin(2 * Math.PI * 3000 * t) * Math.exp(-t / 0.002) * 0.25;
    }
    return norm(b);
  },
  pop: () => {
    const b = buf(0.16);
    let ph = 0;
    for (let i = 0; i < b.length; i++) {
      const t = i / SR;
      ph += (2 * Math.PI * (950 - 450 * (t / 0.16))) / SR;
      b[i] = Math.sin(ph) * (1 - Math.exp(-t / 0.002)) * Math.exp(-t / 0.035);
    }
    return norm(b);
  },
  check: () => {
    const b = buf(0.4);
    tone(b, 0, 740, 0.06);
    tone(b, 0.07, 1109, 0.09);
    return norm(b);
  },
  chime: () => {
    const b = buf(1.2);
    [880, 1318.5, 1760].forEach((f, i) => tone(b, i * 0.06, f, 0.35, 1 - i * 0.2));
    return norm(b);
  },
  ding: () => {
    const b = buf(0.9);
    tone(b, 0, 1318.5, 0.25);
    tone(b, 0.13, 1046.5, 0.3);
    return norm(b);
  },
  boom: () => {
    const b = buf(1.5);
    let ph = 0;
    const rumble = filteredNoise(1.5, () => 380, 0.8, 'low');
    for (let i = 0; i < b.length; i++) {
      const t = i / SR;
      ph += (2 * Math.PI * (70 * Math.exp(-t * 1.6) + 38)) / SR;
      b[i] = Math.sin(ph) * Math.exp(-t / 0.5) * (1 - Math.exp(-t / 0.005)) + rumble[i] * Math.exp(-t / 0.15) * 0.5;
    }
    return norm(b);
  },
  ffwd: () => {
    const b = buf(0.38);
    let ph = 0;
    for (let i = 0; i < b.length; i++) {
      const t = i / SR;
      ph += (2 * Math.PI * 400 * Math.pow(4, t / 0.38)) / SR;
      b[i] = Math.sin(ph) * Math.sin((Math.PI * t) / 0.38) * (0.75 + 0.25 * Math.sin(2 * Math.PI * 30 * t));
    }
    return norm(b);
  },
  radio: () => {
    const b = buf(0.4);
    for (let i = 0; i < b.length; i++) {
      const t = i / SR;
      const beep = (t < 0.07 || (t > 0.1 && t < 0.17)) ? Math.sin(2 * Math.PI * 1400 * t) + 0.3 * Math.sin(2 * Math.PI * 4200 * t) : 0;
      b[i] = beep * 0.8;
    }
    const hiss = filteredNoise(0.4, () => 2500, 0.9);
    for (let i = Math.floor(0.2 * SR); i < b.length; i++) b[i] += hiss[i] * 0.25 * Math.exp(-(i / SR - 0.2) / 0.06);
    return norm(b);
  },
};
const sfxCache = {};
const getSfx = (name) => (sfxCache[name] ??= SFX[name]());

// ---------------------------------------------------------------- voice

/** How a line should sound, as opposed to how it reads on screen. */
function speak(text) {
  return text
    .replace(/frlcast\.my\.id/gi, 'F R L cast dot my dot I D')
    .replace(/kinkpedil12/gi, 'kink pedil twelve')
    .replace(/FRLcast/g, 'F R L cast')
    .replace(/\bFR Legends\b/g, 'F R Legends')
    .replace(/\bKINK12\b/g, 'kink twelve')
    .replace(/start\.cmd/g, 'start dot C M D')
    .replace(/1920 by 1080/g, 'nineteen twenty by ten eighty')
    .replace(/\+ Lap/g, 'plus lap')
    .replace(/(\d)x\b/g, '$1 times')
    .replace(/\bOBS\b/g, 'O B S')
    .replace(/\bVOD\b/g, 'V O D')
    .replace(/\bAPI\b/g, 'A P I')
    .replace(/\bAI\b/g, 'A I')
    .replace(/\bDNF\b/g, 'D N F')
    .replace(/\bCSV\b/g, 'C S V')
    .replace(/\bURL\b/g, 'U R L')
    .replace(/\bPDF\b/g, 'P D F')
    .replace(/\bPCs\b/g, 'P Cs')
    .replace(/Multiview/g, 'Multi view')
    .replace(/all-in-one/g, 'all in one')
    .replace(/in-game/g, 'in game')
    .replace(/ready-made/g, 'ready made')
    .replace(/[“”]/g, '');
}

function readWav(file) {
  const d = fs.readFileSync(file);
  let off = 12;
  let rate = 22050;
  let ch = 1;
  let data = null;
  while (off + 8 <= d.length) {
    const id = d.toString('ascii', off, off + 4);
    const size = d.readUInt32LE(off + 4);
    if (id === 'fmt ') {
      ch = d.readUInt16LE(off + 10);
      rate = d.readUInt32LE(off + 12);
    } else if (id === 'data') {
      data = d.subarray(off + 8, off + 8 + size);
    }
    off += 8 + size + (size % 2);
  }
  const n = Math.floor(data.length / 2 / ch);
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) mono[i] = data.readInt16LE(i * 2 * ch) / 32768;
  // linear resample to SR
  const outLen = Math.floor((n * SR) / rate);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const x = (i * rate) / SR;
    const i0 = Math.floor(x);
    const fr = x - i0;
    out[i] = (mono[i0] ?? 0) * (1 - fr) + (mono[i0 + 1] ?? 0) * fr;
  }
  return out;
}

function tts(text, scale) {
  const key = createHash('sha1').update(`${VOICE}|${scale.toFixed(3)}|${text}`).digest('hex').slice(0, 16);
  const file = path.join(VO_DIR, `${key}.wav`);
  if (!fs.existsSync(file)) {
    const r = spawnSync(PIPER, ['-m', MODEL, '-f', file, '-q', '--length_scale', scale.toFixed(3)], { input: speak(text), windowsHide: true });
    if (r.status !== 0 || !fs.existsSync(file)) throw new Error(`piper failed for: ${text}\n${r.stderr}`);
  }
  // trim leading/trailing silence so a line starts on its frame
  const w = readWav(file);
  let a = 0;
  let b = w.length - 1;
  while (a < b && Math.abs(w[a]) < 0.01) a++;
  while (b > a && Math.abs(w[b]) < 0.01) b--;
  return norm(w.subarray(Math.max(0, a - 240), Math.min(w.length, b + 2400)).slice(), 0.85);
}

const voCues = cues.filter((c) => c.type === 'vo');
const voiced = [];
let squeezed = 0;
let overlaps = 0;
for (let i = 0; i < voCues.length; i++) {
  const c = voCues[i];
  const start = c.frame / fps;
  const next = voCues[i + 1] ? voCues[i + 1].frame / fps : total / fps;
  const room = next - start - 0.12;
  let scale = 1;
  let clip = tts(c.text, scale);
  for (let tries = 0; tries < 3 && clip.length / SR > room && scale > 0.72; tries++) {
    scale = Math.max(0.72, scale * (room / (clip.length / SR)) * 0.97);
    clip = tts(c.text, scale);
  }
  if (scale < 1) squeezed++;
  if (clip.length / SR > room) overlaps++;
  voiced.push({ start, end: start + clip.length / SR, clip });
  process.stdout.write(`\rvoice ${i + 1}/${voCues.length}`);
}
console.log(`\nvoice lines: ${voiced.length}, sped up to fit: ${squeezed}, still overlapping: ${overlaps}`);

// ---------------------------------------------------------------- mix

const mix = new Float32Array(LEN);
const add = (clip, startSec, gain) => {
  const s = Math.floor(startSec * SR);
  for (let i = 0; i < clip.length && s + i < LEN; i++) mix[s + i] += clip[i] * gain;
};
for (const v of voiced) add(v.clip, v.start, 1);

// ---------------------------------------------------------------- background music
//
// A soft ambient bed, synthesised here like the effects: pad chords (Am F C G, 96 BPM, two
// bars each), a gentle bass, a thin arpeggio that drops out every fourth pass so the loop
// breathes, and a very soft kick. It ducks under the voice with a smooth envelope.
// MUSIC=0 turns it off, MUSIC_GAIN scales it (default 1).

const TAB = new Float32Array(4096);
for (let i = 0; i < TAB.length; i++) TAB[i] = Math.sin((2 * Math.PI * i) / TAB.length);
const osc = (ph) => TAB[(ph * TAB.length) & (TAB.length - 1)];

function music(len) {
  const m = new Float32Array(len);
  const BPM = 96;
  const beat = 60 / BPM;
  const chordLen = beat * 8; // two bars
  const CHORDS = [
    { root: 110.0, notes: [220.0, 261.63, 329.63, 440.0] }, // Am
    { root: 87.31, notes: [174.61, 220.0, 261.63, 349.23] }, // F
    { root: 130.81, notes: [196.0, 261.63, 329.63, 392.0] }, // C
    { root: 98.0, notes: [196.0, 246.94, 293.66, 392.0] }, // G
  ];
  const secs = len / SR;
  const nChords = Math.ceil(secs / chordLen) + 1;
  for (let c = 0; c < nChords; c++) {
    const ch = CHORDS[c % 4];
    const t0 = c * chordLen;
    const s0 = Math.floor(t0 * SR);
    // pad: two detuned voices per note, soft attack, overlapping release into the next chord
    const padEnd = Math.min(len, Math.floor((t0 + chordLen + 1.4) * SR));
    ch.notes.forEach((f, ni) => {
      const g = ni === 3 ? 0.45 : 1;
      for (const det of [0.9975, 1.0025]) {
        let ph = Math.random();
        const inc = (f * det) / SR;
        for (let i = s0; i < padEnd; i++) {
          const t = (i - s0) / SR;
          const env = Math.min(1, t / 1.1) * (t > chordLen ? Math.max(0, 1 - (t - chordLen) / 1.4) : 1);
          ph += inc;
          const p = ph - Math.floor(ph);
          m[i] += 0.07 * g * env * (osc(p) + 0.3 * osc((p * 2) % 1) + 0.12 * osc((p * 3) % 1));
        }
      }
    });
    // bass: a soft pluck on beats 1 and 3 of each bar
    for (let b = 0; b < 8; b += 2) {
      const bs = Math.floor((t0 + b * beat) * SR);
      let ph = 0;
      for (let i = bs; i < Math.min(len, bs + Math.floor(1.3 * SR)); i++) {
        const t = (i - bs) / SR;
        ph += ch.root / SR;
        m[i] += 0.22 * (1 - Math.exp(-t / 0.01)) * Math.exp(-t / 0.55) * (osc(ph % 1) + 0.25 * osc((ph * 2) % 1));
      }
    }
    // kick, very soft, beats 1 and 3
    for (let b = 0; b < 8; b += 2) {
      const ks = Math.floor((t0 + b * beat) * SR);
      let ph = 0;
      for (let i = ks; i < Math.min(len, ks + Math.floor(0.25 * SR)); i++) {
        const t = (i - ks) / SR;
        ph += (48 + 70 * Math.exp(-t * 28)) / SR;
        m[i] += 0.16 * Math.exp(-t / 0.08) * osc(ph % 1);
      }
    }
    // arpeggio in eighths, an octave up; rests on every fourth pass of the loop and at the start
    const pass = Math.floor(c / 4);
    if (c >= 4 && pass % 4 !== 3) {
      const order = [0, 1, 2, 3, 2, 1, 2, 3, 0, 1, 2, 3, 2, 1, 3, 2];
      order.forEach((ni, k) => {
        const as = Math.floor((t0 + (k * beat) / 2) * SR);
        const f = ch.notes[ni] * 2;
        let ph = 0;
        for (let i = as; i < Math.min(len, as + Math.floor(0.6 * SR)); i++) {
          const t = (i - as) / SR;
          ph += f / SR;
          m[i] += 0.05 * (1 - Math.exp(-t / 0.004)) * Math.exp(-t / 0.2) * (osc(ph % 1) + 0.2 * osc((ph * 2) % 1));
        }
      });
    }
  }
  norm(m, 0.9);
  // fade in over 2 s, out over the last 3.5 s of the programme
  const endS = Math.floor((total / fps) * SR);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    let g = Math.min(1, t / 2);
    if (i > endS - 3.5 * SR) g *= Math.max(0, (endS - i) / (3.5 * SR));
    m[i] *= g;
  }
  return m;
}

if (process.env.MUSIC !== '0') {
  const bed = music(LEN);
  // ducking envelope, computed per 10 ms block: 1 in the gaps, 0.45 under the voice,
  // attack 0.15 s / release 0.6 s so it never pumps
  const BLOCK = SR / 100;
  const nb = Math.ceil(LEN / BLOCK);
  const target = new Float32Array(nb).fill(1);
  for (const v of voiced) {
    for (let b = Math.floor((v.start - 0.1) * 100); b < Math.ceil((v.end + 0.2) * 100) && b < nb; b++) if (b >= 0) target[b] = 0.45;
  }
  const duck = new Float32Array(nb);
  let g = 1;
  for (let b = 0; b < nb; b++) {
    const k = target[b] < g ? 1 - Math.exp(-0.01 / 0.15) : 1 - Math.exp(-0.01 / 0.6);
    g += (target[b] - g) * k;
    duck[b] = g;
  }
  const level = 0.2 * Number(process.env.MUSIC_GAIN || 1);
  for (let i = 0; i < LEN; i++) mix[i] += bed[i] * level * duck[Math.floor(i / BLOCK)];
  console.log(`music: ambient bed at ${(20 * Math.log10(level)).toFixed(1)} dB, ducked to ${(20 * Math.log10(level * 0.45)).toFixed(1)} dB under the voice`);
}

// sound effects dip a little under the voice so the narration always reads first
const voiceAt = (sec) => voiced.some((v) => sec >= v.start && sec < v.end);
for (const c of cues) {
  if (c.type !== 'sfx') continue;
  const sec = c.frame / fps;
  add(getSfx(c.name), sec, c.gain * (voiceAt(sec) ? 0.75 : 1));
}

// soft-knee limiter above -1 dBFS-ish
let clipped = 0;
for (let i = 0; i < LEN; i++) {
  const x = mix[i];
  const ax = Math.abs(x);
  if (ax > 0.9) {
    mix[i] = Math.sign(x) * (0.9 + 0.09 * Math.tanh((ax - 0.9) / 0.09));
    clipped++;
  }
}

const wavPath = path.join(CACHE, 'mix.wav');
const out = Buffer.alloc(44 + LEN * 4);
out.write('RIFF', 0);
out.writeUInt32LE(36 + LEN * 4, 4);
out.write('WAVEfmt ', 8);
out.writeUInt32LE(16, 16);
out.writeUInt16LE(1, 20);
out.writeUInt16LE(2, 22);
out.writeUInt32LE(SR, 24);
out.writeUInt32LE(SR * 4, 28);
out.writeUInt16LE(4, 32);
out.writeUInt16LE(16, 34);
out.write('data', 36);
out.writeUInt32LE(LEN * 4, 40);
for (let i = 0; i < LEN; i++) {
  const s = Math.max(-32768, Math.min(32767, Math.round(mix[i] * 32767)));
  out.writeInt16LE(s, 44 + i * 4);
  out.writeInt16LE(s, 46 + i * 4);
}
fs.writeFileSync(wavPath, out);
console.log(`mix: ${(LEN / SR).toFixed(1)} s, limiter touched ${clipped} samples -> ${path.relative(ROOT, wavPath)}`);

// ---------------------------------------------------------------- mux

if (!fs.existsSync(VIDEO_IN)) {
  console.log(`no video at ${VIDEO_IN}; mix written, skipping mux`);
  process.exit(0);
}
const r = spawnSync(
  'npx',
  ['remotion', 'ffmpeg', '-y', '-i', path.relative(ROOT, VIDEO_IN), '-i', path.relative(ROOT, wavPath), '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', path.relative(ROOT, VIDEO_OUT)],
  { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'], shell: process.platform === 'win32' },
);
if (r.status !== 0) {
  console.error(r.stderr?.toString().slice(-2000));
  process.exit(1);
}
console.log(`done: ${path.relative(ROOT, VIDEO_OUT)}`);
