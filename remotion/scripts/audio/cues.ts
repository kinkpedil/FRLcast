/*
 * Builds the audio cue sheet for the tutorial: every voice line and sound effect, with the
 * programme frame it starts on. Picture timings come from AUDIO_TIMELINE (the same data the
 * video renders from); the animated chapters' events are listed here in local frames that
 * mirror the clicks, typing and pop-ins in src/tutorial/Scenes.tsx.
 *
 * Bundled with esbuild and run by build-audio.mjs, which prints the JSON this returns.
 */
import { AUDIO_TIMELINE as T } from '../../src/tutorial/Tutorial';
import { API_B, DRV_B, GTK_B } from '../../src/tutorial/Scenes';

export type Cue =
  | { frame: number; type: 'vo'; text: string }
  | { frame: number; type: 'sfx'; name: string; gain: number };

const cues: Cue[] = [];
const vo = (frame: number, text: string) => cues.push({ frame: Math.round(frame), type: 'vo', text });
const sfx = (frame: number, name: string, gain = 0.4) => cues.push({ frame: Math.round(frame), type: 'sfx', name, gain });

/** One key tick per character, at the same rate typed() reveals them. */
const typing = (start: number, chars: number, cps: number, gain = 0.18) => {
  for (let i = 0; i < chars; i++) sfx(start + (i * 30) / cps, 'tick', gain);
};

const NUM = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

// ---------------------------------------------------------------- footage + cards

for (const it of T.items) {
  if (it.kind === 'intro') {
    sfx(it.start, 'boom', 0.6);
    sfx(it.start + 10, 'chime', 0.3);
    vo(it.start + 16, 'FRLcast. The complete guide.');
  }
  if (it.kind === 'card') {
    sfx(it.start, 'whoosh', 0.45);
    vo(it.start + 10, `Part ${NUM[it.part ?? 0]}. ${it.title}.`);
  }
  if (it.kind === 'clip' && (it.rate ?? 1) >= 2) sfx(it.start + 2, 'ffwd', 0.28);
  if (it.kind === 'outro') {
    sfx(it.start, 'boom', 0.5);
    sfx(it.start + 8, 'chime', 0.3);
    vo(it.start + 12, 'Thanks for watching. FRLcast, by kinkpedil12.');
  }
}

for (const c of T.captions) vo(c.from + 2, c.text);
for (const f of T.steps) sfx(f, 'swoosh', 0.22);
for (const f of T.callouts) sfx(f, 'pop', 0.32);
for (const f of T.zooms) sfx(f, 'whooshSoft', 0.14);

// ---------------------------------------------------------------- animated chapters

const sceneStart = (id: string) => {
  const s = T.items.find((i) => i.kind === 'scene' && i.id === id);
  if (!s) throw new Error(`scene ${id} not in the programme`);
  return s.start;
};

/** Step-change swooshes for a scene with the given step bounds. */
const steps = (base: number, bounds: number[]) => bounds.slice(0, -1).forEach((b) => sfx(base + b, 'swoosh', 0.25));

// Part 6 · timing API
{
  const s = sceneStart('api');
  steps(s, API_B);
  const [, b2, b3, b4, b5] = API_B;
  vo(s + 6, 'First, get your personal API key from the FR Legends developer. Treat it like a password, and never show it on stream.');
  sfx(s + 22, 'pop', 0.25);
  sfx(s + 90, 'pop', 0.25);
  // step 2
  vo(s + b2 + 8, 'The timing API works in the desktop app. Run start.cmd, the console opens on your own computer, then go to Vision and AI.');
  sfx(s + b2 + 120, 'click', 0.5);
  sfx(s + b2 + 132, 'pop', 0.25);
  sfx(s + b2 + 190, 'pop', 0.25);
  // step 3
  vo(s + b3 + 8, 'In the Live timing card, paste your key and choose your region. Ours is Southeast Asia.');
  sfx(s + b3 + 56, 'click', 0.5);
  typing(s + b3 + 62, 24, 15);
  sfx(s + b3 + 150, 'click', 0.5);
  sfx(s + b3 + 200, 'click', 0.5);
  sfx(s + b3 + 256, 'click', 0.5);
  sfx(s + b3 + 262, 'chime', 0.3);
  vo(s + b3 + 268, 'Press Save key. It stays on this machine only.');
  sfx(s + b3 + 300, 'pop', 0.25);
  // step 4
  vo(s + b4 + 8, "The host sets a Room Key on the game's Create Room screen. No Room Key, no live timing.");
  typing(s + b4 + 30, 4, 8);
  sfx(s + b4 + 80, 'swoosh', 0.25);
  sfx(s + b4 + 90, 'pop', 0.25);
  typing(s + b4 + 124, 4, 8);
  sfx(s + b4 + 186, 'click', 0.5);
  vo(s + b4 + 200, 'Enter the same Room Key in the console, and press Start live timing.');
  sfx(s + b4 + 236, 'chime', 0.35);
  [250, 262, 274].forEach((f) => sfx(s + b4 + f, 'pop', 0.22));
  // step 5
  vo(s + b5 + 8, 'The desktop app looks up the game server for your region, and pulls the laps every one and a half seconds.');
  [0, 20, 40, 60].forEach((f) => sfx(s + b5 + f, 'pop', 0.22));
  vo(s + b5 + 200, 'Players are matched by name, so register each driver with their in-game name.');
  [170, 230, 290].forEach((f) => sfx(s + b5 + f, 'pop', 0.22));
}

// Part 7 · driver app
{
  const s = sceneStart('driver');
  steps(s, DRV_B);
  const [, b2, b3, b4, b5] = DRV_B;
  vo(s + 6, "Drivers install a tiny Android app. It's about 33 kilobytes, and no store account is needed.");
  sfx(s + 6, 'pop', 0.22);
  sfx(s + 136, 'chime', 0.3);
  sfx(s + 150, 'pop', 0.3);
  [40, 80, 120].forEach((f) => sfx(s + f, 'pop', 0.2));
  // step 2
  vo(s + b2 + 6, 'They register once, with a racing name, a number, and a password.');
  typing(s + b2 + 20, 3, 8);
  typing(s + b2 + 50, 2, 8);
  typing(s + b2 + 70, 6, 10);
  sfx(s + b2 + 120, 'click', 0.45);
  sfx(s + b2 + 140, 'pop', 0.25);
  vo(s + b2 + 150, 'Race control decides who gets in. Accept them, and they join the grid.');
  sfx(s + b2 + 220, 'click', 0.5);
  sfx(s + b2 + 226, 'chime', 0.3);
  // step 3
  vo(s + b3 + 8, 'To sign in, drivers type the event code in the Server field, then their number and password.');
  typing(s + b3 + 20, 6, 10);
  typing(s + b3 + 70, 2, 8);
  typing(s + b3 + 90, 6, 12);
  sfx(s + b3 + 140, 'click', 0.45);
  sfx(s + b3 + 146, 'chime', 0.3);
  // step 4
  vo(s + b4 + 8, 'Android asks once for permission to draw over other apps.');
  sfx(s + b4 + 18, 'click', 0.45);
  sfx(s + b4 + 24, 'pop', 0.22);
  sfx(s + b4 + 54, 'click', 0.45);
  sfx(s + b4 + 96, 'whoosh', 0.3);
  vo(s + b4 + 134, "Then the flag floats right over the game. It lands in about a second, and penalties come with the steward's reason.");
  sfx(s + b4 + 180, 'ding', 0.35);
  sfx(s + b4 + 222, 'ding', 0.4);
  sfx(s + b4 + 280, 'whooshSoft', 0.2);
  // step 5
  vo(s + b5 + 8, 'Team radio. A driver types a call, like box box. It shows on the broadcast, is read aloud, and clears itself after a few seconds.');
  typing(s + b5 + 20, 7, 10);
  sfx(s + b5 + 70, 'click', 0.45);
  sfx(s + b5 + 76, 'swoosh', 0.3);
  sfx(s + b5 + 112, 'radio', 0.35);
}

// Part 8 · good to know
{
  const s = sceneStart('good');
  steps(s, GTK_B);
  const [, b2, b3] = GTK_B;
  vo(s + 10, 'The website runs your events, the console, the overlays and the audience pages. The free desktop app adds automatic timing, grid edits, and the natural commentator voice.');
  [0, 1, 2, 3, 4].forEach((i) => sfx(s + 24 + i * 22, 'pop', 0.16));
  [0, 1, 2, 3, 4].forEach((i) => sfx(s + 114 + i * 22, 'pop', 0.16));
  // step 2
  vo(s + b2 + 8, 'To put the overlay in OBS, copy the all-in-one link, add a Browser source, paste it, and set it to 1920 by 1080.');
  sfx(s + b2 + 40, 'click', 0.5);
  sfx(s + b2 + 46, 'chime', 0.22);
  sfx(s + b2 + 90, 'click', 0.5);
  sfx(s + b2 + 96, 'pop', 0.2);
  sfx(s + b2 + 126, 'click', 0.5);
  sfx(s + b2 + 136, 'pop', 0.25);
  typing(s + b2 + 176, 4, 30);
  typing(s + b2 + 192, 4, 30);
  sfx(s + b2 + 226, 'click', 0.5);
  sfx(s + b2 + 240, 'chime', 0.3);
  vo(s + b2 + 262, 'One source carries every widget, and scenes switch inside it.');
  // step 3
  vo(s + b3 + 8, 'Before you go live: give every driver a unique name that matches the game, use one console tab only, press Start markers when you hit record, and keep manual timing as your fallback.');
  [0, 1, 2, 3, 4].forEach((i) => {
    sfx(s + b3 + 20 + i * 62, 'pop', 0.2);
    sfx(s + b3 + 44 + i * 62, 'check', 0.28);
  });
}

cues.sort((a, b) => a.frame - b.frame);

export const OUTPUT = { fps: T.fps, total: T.total, cues };
console.log(JSON.stringify(OUTPUT));
