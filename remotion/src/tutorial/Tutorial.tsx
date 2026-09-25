import React from 'react';
import { AbsoluteFill, Easing, Sequence, useCurrentFrame } from 'remotion';
import { ScreenFrame, IntroCard, LowerThird, Caption, Callout, ProgressBar, Outro } from './TutorialKit';
import { ChapterCard, CHAPTER_DUR, SpeedBadge, ApiKeyScene, API_DUR, DriverAppScene, DRIVER_DUR, GoodToKnowScene, GOOD_DUR } from './Scenes';

/*
 * The full-animation tutorial, built as a programme of items:
 *   chapter cards, clips of the screen recording (each with its own speed), and fully
 *   animated chapters that have no footage (timing API, driver app, good to know).
 *
 * Every overlay on the footage (lower-thirds, captions, callouts, camera zooms, the privacy
 * patch) is written in SOURCE seconds, i.e. the time in the raw recording. They are mapped
 * onto the programme automatically, so changing a clip's speed or trim never needs the
 * overlays to be re-timed by hand. Anything that lands in a trimmed-out stretch is dropped.
 */

export type TutorialProps = {
  kicker: string;
  title: string;
  subtitle?: string;
  recordingSrc: string;
  videoSeconds: number;
};

export const FPS = 30;
const INTRO = 90;
const OUTRO = 105;
const sec = (s: number) => Math.round(s * FPS);

type Item =
  | { kind: 'intro' }
  | { kind: 'card'; part: number; title: string; sub: string }
  | { kind: 'clip'; a: number; b: number; rate: number }
  | { kind: 'scene'; id: 'api' | 'driver' | 'good' }
  | { kind: 'outro' };

const PROGRAM: Item[] = [
  { kind: 'intro' },
  { kind: 'card', part: 1, title: 'The website', sub: 'Landing page, your events and the event code' },
  { kind: 'clip', a: 0, b: 42, rate: 3 },
  { kind: 'clip', a: 42, b: 73, rate: 1 },
  { kind: 'clip', a: 73, b: 117, rate: 2 },
  { kind: 'card', part: 2, title: 'The operator console', sub: 'Ten pages that run the whole race night' },
  { kind: 'clip', a: 117, b: 437, rate: 1.25 },
  { kind: 'card', part: 3, title: 'Pages for your audience', sub: 'Public pages, opened with the event code' },
  { kind: 'clip', a: 437, b: 523, rate: 1 },
  { kind: 'card', part: 4, title: 'Live timing on the desktop app', sub: 'A full grid, the race start and the laps coming in' },
  { kind: 'clip', a: 553, b: 591, rate: 2 },
  { kind: 'clip', a: 591, b: 798, rate: 4 },
  { kind: 'card', part: 5, title: 'On air', sub: 'The overlay, the control room and the VOD markers' },
  { kind: 'clip', a: 804, b: 868, rate: 1 },
  { kind: 'clip', a: 868, b: 961, rate: 1.5 },
  { kind: 'card', part: 6, title: 'Set up the timing API', sub: 'Official lap times, straight from the game server' },
  { kind: 'scene', id: 'api' },
  { kind: 'card', part: 7, title: 'The driver app', sub: "Flags and penalties on every driver's phone" },
  { kind: 'scene', id: 'driver' },
  { kind: 'card', part: 8, title: 'Good to know', sub: 'Website or desktop app, OBS, and a race night checklist' },
  { kind: 'scene', id: 'good' },
  { kind: 'outro' },
];

const SCENE_DUR = { api: API_DUR, driver: DRIVER_DUR, good: GOOD_DUR };

const itemDur = (it: Item) =>
  it.kind === 'intro' ? INTRO
  : it.kind === 'outro' ? OUTRO
  : it.kind === 'card' ? CHAPTER_DUR
  : it.kind === 'clip' ? Math.round(((it.b - it.a) / it.rate) * FPS)
  : SCENE_DUR[it.id];

type Placed = Item & { start: number; dur: number };
const PLACED: Placed[] = (() => {
  let t = 0;
  return PROGRAM.map((it) => {
    const p = { ...it, start: t, dur: itemDur(it) } as Placed;
    t += p.dur;
    return p;
  });
})();

export const TOTAL_FRAMES = PLACED.reduce((n, p) => n + p.dur, 0);
export const tutorialDuration = () => TOTAL_FRAMES;

/** Source second in the recording -> programme frame (null if that moment was trimmed out). */
const at = (s: number): number | null => {
  for (const p of PLACED) {
    if (p.kind === 'clip' && s >= p.a && s < p.b) return p.start + Math.round(((s - p.a) / p.rate) * FPS);
  }
  return null;
};

// ---------------------------------------------------------------- overlays, in source seconds

// Left-nav item centre-y in the recording (1920x1080).
const NAV = { race: 240, scenes: 280, champ: 320, drivers: 360, drift: 396, vision: 436, overlays: 476, layout: 516, obs: 554, help: 592 };

const STEPS: { at: number; label: string }[] = [
  { at: 2, label: 'Landing page' },
  { at: 76, label: 'Your events and the event code' },
  { at: 118, label: 'Race control' },
  { at: 168, label: 'Event scenes' },
  { at: 195, label: 'Championship' },
  { at: 212, label: 'Drivers' },
  { at: 242, label: 'Drift battles' },
  { at: 258, label: 'Vision / AI' },
  { at: 275, label: 'Overlays' },
  { at: 332, label: 'Layout and branding' },
  { at: 378, label: 'OBS setup' },
  { at: 408, label: 'Help and manual' },
  { at: 438, label: 'Event hub' },
  { at: 465, label: 'Live timing page' },
  { at: 482, label: 'Season stats' },
  { at: 498, label: 'Recap card' },
  { at: 512, label: 'Race report' },
  { at: 554, label: 'Desktop app: the grid is ready' },
  { at: 592, label: 'Race start and live timing' },
  { at: 805, label: 'Leaderboard overlay in OBS' },
  { at: 836, label: 'Multiview control room' },
  { at: 870, label: 'Highlights for the VOD' },
];

// Narration (the recording is silent, so the captions carry it). Durations are output seconds;
// each line is automatically cut short if the next one would otherwise overlap it.
const CAPTIONS: { at: number; dur: number; text: string }[] = [
  { at: 1, dur: 6.5, text: 'Welcome to FRLcast: race control, live timing and OBS overlays for your FR Legends league.' },
  { at: 22, dur: 6, text: 'Everything runs from the website. The desktop app adds automatic timing and the commentator voice.' },
  { at: 43, dur: 6, text: 'The feature tour: timing, race control, broadcast, championship, drift and tracking.' },
  { at: 50, dur: 7, text: 'Two people use FRLcast: the operator who runs the event, and the drivers on their phones.' },
  { at: 58, dur: 6, text: "The driver app puts every flag on the driver's screen, right over the game." },
  { at: 65, dur: 6, text: 'Open the dashboard and sign in to reach your events.' },
  { at: 74, dur: 6, text: 'Your events: each event is its own room, with its own grid and its own timing.' },
  { at: 87, dur: 6.5, text: 'The short event code is what drivers type into the app, and what the overlays use in their URL.' },
  { at: 101, dur: 7, text: 'Each event has ready-made links for the report and for OBS. Open race control to run it.' },
  { at: 118, dur: 6, text: 'The operator console. Ten pages on the left; number keys 1 to 9 jump between them.' },
  { at: 126, dur: 6, text: 'Race control: start the race and hold the flag, from formation lap to chequered.' },
  { at: 134, dur: 6, text: 'The live classification fills in as cars cross the line: laps, last lap, best lap and gap.' },
  { at: 142, dur: 6, text: 'Event details sit on the right: name, round, track and laps, plus public links for viewers.' },
  { at: 150, dur: 6, text: 'Further down: the penalty desk, and VOD highlight markers recorded while you broadcast.' },
  { at: 158, dur: 6, text: 'Manual control lets you fire laps and move cars by hand when there is no automatic timing.' },
  { at: 168, dur: 6, text: 'Event scenes: several overlay looks from one browser source. Click a scene to put it on air.' },
  { at: 176, dur: 6, text: 'Each scene keeps its own widgets and layout, and every change cross-fades live.' },
  { at: 195, dur: 6.5, text: "Championship: bank each round's result and the standings recompute with your points system." },
  { at: 213, dur: 6.5, text: "Drivers: add your roster or import a CSV. Use each driver's exact in-game name and colour." },
  { at: 222, dur: 6.5, text: 'The minimap tracker follows cars by that colour, and the timing API matches drivers by name.' },
  { at: 242, dur: 6, text: 'Drift battles: judged qualifying seeds the bracket, then battles run with the lead swapped.' },
  { at: 258, dur: 6, text: 'Vision and AI: timing from the official API, from the game minimap, or by hand.' },
  { at: 266, dur: 6.5, text: 'The Live timing card at the top is where the API key goes. Part 6 shows it step by step.' },
  { at: 276, dur: 6, text: 'Overlays: switch each widget on or off. Changes reach OBS in under a frame.' },
  { at: 284, dur: 6, text: 'Leaderboard, timing tower, lower third, fastest lap, sectors, team radio and more.' },
  { at: 300, dur: 6.5, text: 'The spoken commentator lives here too: the browser voice, or the natural Piper voice.' },
  { at: 309, dur: 6, text: 'Piper needs the desktop app. On the website it falls back to the browser voice.' },
  { at: 333, dur: 6, text: 'Layout: drag every widget into place on the 1920 by 1080 canvas, scene by scene.' },
  { at: 341, dur: 6, text: 'Pick a broadcast skin and a colour template, and add your league logo.' },
  { at: 349, dur: 6.5, text: 'Overlay style: accent colour, panel opacity, corner radius, and a lite mode for slower PCs.' },
  { at: 379, dur: 6, text: 'OBS setup: every overlay link, ready to copy into an OBS browser source.' },
  { at: 387, dur: 6, text: 'The all-in-one link carries every widget. The commentator has its own link.' },
  { at: 395, dur: 6.5, text: 'Below: the network address, a remote lap trigger, keyboard shortcuts and OBS WebSocket control.' },
  { at: 409, dur: 6, text: 'Help: the full manual inside the console, in English and Indonesian, with search.' },
  { at: 439, dur: 6.5, text: 'The event hub: one public page per event. Viewers open it with the event code, no login.' },
  { at: 446, dur: 6, text: 'It links to live timing, the race report, the season stats and the recap card.' },
  { at: 466, dur: 6.5, text: "Live timing: the flag, the lap count and the classification, live on viewers' phones." },
  { at: 483, dur: 6.5, text: 'Season stats: rounds, points, wins, podiums and a form guide for every driver.' },
  { at: 499, dur: 6.5, text: 'The recap card makes a result image for social media, in post, story or wide format.' },
  { at: 513, dur: 6.5, text: 'The race report: a clean summary to paste into Discord, or to save as a PDF.' },
  { at: 554, dur: 6, text: 'Now the desktop app: the same console on your own machine, with a full grid of drivers.' },
  { at: 567, dur: 6, text: 'A driver who registered on the phone shows up under Driver sign-ins, ready to accept.' },
  { at: 580, dur: 5, text: 'Start race turns the flag green and starts the clock.' },
  { at: 593, dur: 5, text: 'The race is on. From here it plays at 4x speed.' },
  { at: 614, dur: 6.5, text: 'Laps can come from the timing API, the minimap tracker, the lap hotkeys or the + Lap buttons.' },
  { at: 641, dur: 6, text: 'The first car across sets the fastest lap, and the board sorts itself by position.' },
  { at: 666, dur: 6.5, text: 'Gaps, last lap and best lap update live. Cars not yet across show a lap down.' },
  { at: 693, dur: 6.5, text: 'Each row has quick actions: pit, a 5 second penalty, DNF, and focus for the overlays.' },
  { at: 720, dur: 6, text: 'Focus picks the driver that the lower third, sector and delta widgets follow.' },
  { at: 806, dur: 7, text: 'On air: the leaderboard overlay exactly as OBS shows it, on a transparent background.' },
  { at: 814, dur: 6, text: 'Fastest lap tag, gaps to the leader, and lapped cars at the bottom, all live.' },
  { at: 821, dur: 6, text: 'Add it once as a browser source, and it follows the console by itself.' },
  { at: 837, dur: 7, text: 'Multiview: the programme and every widget on one screen, for a second monitor.' },
  { at: 845, dur: 6, text: 'The scene buttons along the bottom switch what is on air.' },
  { at: 852, dur: 6, text: 'It is the control room view: flag, clock and classification at a glance.' },
  { at: 870, dur: 6, text: 'Back in race control: the penalty desk and the Highlights for the VOD card.' },
  { at: 880, dur: 5, text: 'Press Start markers the moment you hit Record in OBS.' },
  { at: 889, dur: 6.5, text: 'Every overtake, fastest lap, pit stop and penalty is then timestamped against that moment.' },
  { at: 900, dur: 6, text: 'Mark now adds your own marker. Nudge fixes a Record press that was a moment early or late.' },
  { at: 910, dur: 7, text: 'Export YouTube chapters, a marker CSV, subtitles, or a highlight reel for your editor.' },
  { at: 921, dur: 6, text: "Penalties go out with the steward's reason, straight to the driver's phone." },
  { at: 931, dur: 6, text: 'Recent events keeps a running log of everything that happened.' },
];

// Rings on UI the viewer should look at. Nav items have no label (the lower-third names them).
const CALLOUTS: { at: number; x: number; y: number; w: number; h: number; label?: string; from?: 'left' | 'right' | 'top' | 'bottom' }[] = [
  { at: 80, x: 396, y: 638, w: 142, h: 54, label: 'Create a new event', from: 'right' },
  { at: 88, x: 1408, y: 744, w: 110, h: 46, label: 'Event code', from: 'left' },
  { at: 106, x: 396, y: 834, w: 178, h: 52, label: 'Open race control', from: 'right' },
  ...(
    [
      [118, NAV.race], [168, NAV.scenes], [195, NAV.champ], [212, NAV.drivers], [242, NAV.drift],
      [258, NAV.vision], [275, NAV.overlays], [332, NAV.layout], [378, NAV.obs], [408, NAV.help],
    ] as [number, number][]
  ).map(([t, y]) => ({ at: t, x: 14, y: y - 18, w: 200, h: 36 })),
  { at: 807, x: 56, y: 256, w: 434, h: 708, label: 'Leaderboard widget', from: 'right' },
  { at: 881, x: 1100, y: 568, w: 140, h: 46, label: 'Start markers', from: 'bottom' },
  { at: 905, x: 1538, y: 520, w: 150, h: 32, label: 'Recording', from: 'top' },
  { at: 912, x: 1100, y: 724, w: 568, h: 48, label: 'Four export formats', from: 'bottom' },
  { at: 922, x: 1174, y: 200, w: 82, h: 50, label: 'Issue a penalty', from: 'left' },
];

// Camera zooms toward what the caption is talking about. dur is in output seconds.
const ZOOMS: { at: number; dur: number; s: number; x: number; y: number }[] = [
  { at: 1, dur: 5, s: 1.2, x: 560, y: 420 },
  { at: 76, dur: 5, s: 1.25, x: 950, y: 520 },
  { at: 126, dur: 5.5, s: 1.4, x: 650, y: 420 },
  { at: 150, dur: 5.5, s: 1.35, x: 1395, y: 600 },
  { at: 173, dur: 5.5, s: 1.35, x: 660, y: 560 },
  { at: 200, dur: 5, s: 1.35, x: 760, y: 420 },
  { at: 217, dur: 5, s: 1.4, x: 700, y: 300 },
  { at: 246, dur: 5, s: 1.3, x: 960, y: 420 },
  { at: 262, dur: 5.5, s: 1.45, x: 975, y: 330 },
  { at: 281, dur: 5, s: 1.35, x: 660, y: 560 },
  { at: 337, dur: 5, s: 1.3, x: 960, y: 450 },
  { at: 383, dur: 5, s: 1.35, x: 960, y: 420 },
  { at: 413, dur: 5, s: 1.3, x: 960, y: 450 },
  { at: 441, dur: 5, s: 1.4, x: 960, y: 330 },
  { at: 468, dur: 5, s: 1.4, x: 960, y: 340 },
  { at: 485, dur: 5, s: 1.4, x: 960, y: 360 },
  { at: 501, dur: 5, s: 1.3, x: 960, y: 480 },
  { at: 514, dur: 5, s: 1.4, x: 960, y: 300 },
  { at: 596, dur: 5, s: 1.35, x: 640, y: 760 },
  { at: 660, dur: 6, s: 1.35, x: 640, y: 760 },
  { at: 730, dur: 6, s: 1.35, x: 640, y: 760 },
  { at: 810, dur: 6, s: 1.35, x: 300, y: 610 },
  { at: 872, dur: 5, s: 1.45, x: 1395, y: 650 },
  { at: 913, dur: 5, s: 1.4, x: 1395, y: 760 },
];

// The account email shows on the dashboard: cover it.
const PRIVACY = { from: 70, to: 118, x: 1236, y: 122, w: 212, h: 40 };

// ---------------------------------------------------------------- rendering

const EASE = Easing.bezier(0.45, 0, 0.55, 1);

const Clip: React.FC<{ a: number; b: number; rate: number; src: string }> = ({ a, b, rate, src }) => {
  const f = useCurrentFrame();
  const t = a + (f / FPS) * rate; // current source second

  // camera
  let s = 1;
  let ox = 960;
  let oy = 540;
  let dx = 0;
  let dy = 0;
  const z = ZOOMS.find((q) => t >= q.at && t < q.at + q.dur * rate);
  if (z) {
    const u = (t - z.at) / rate;
    const ramp = 0.8;
    const p = EASE(Math.max(0, Math.min(1, u / ramp, (z.dur - u) / ramp)));
    s = 1 + (z.s - 1) * p;
    ox = z.x;
    oy = z.y;
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    dx = clamp((960 - ox) * p * 0.55, 1920 - (ox + (1920 - ox) * s), -(ox * (1 - s)));
    dy = clamp((540 - oy) * p * 0.55, 1080 - (oy + (1080 - oy) * s), -(oy * (1 - s)));
  }

  const localAt = (src2: number) => Math.round(((src2 - a) / rate) * FPS);
  const mine = CALLOUTS.filter((c) => c.at >= a && c.at < b);
  const showPrivacy = t >= PRIVACY.from && t < PRIVACY.to;

  return (
    <AbsoluteFill style={{ overflow: 'hidden', backgroundColor: '#000' }}>
      <AbsoluteFill style={{ transform: `translate(${dx}px, ${dy}px) scale(${s})`, transformOrigin: `${ox}px ${oy}px` }}>
        <ScreenFrame src={src} startFrom={sec(a)} endAt={sec(b)} playbackRate={rate} />
        {showPrivacy && (
          <div
            style={{
              position: 'absolute',
              left: PRIVACY.x,
              top: PRIVACY.y,
              width: PRIVACY.w,
              height: PRIVACY.h,
              borderRadius: 8,
              background: 'rgba(11,13,17,0.9)',
              backdropFilter: 'blur(12px)',
            }}
          />
        )}
        {mine.map((c, i) => (
          <Sequence key={i} from={localAt(c.at)} durationInFrames={sec(3.6)}>
            <Callout x={c.x} y={c.y} w={c.w} h={c.h} label={c.label} from={c.from} />
          </Sequence>
        ))}
      </AbsoluteFill>
      {rate >= 2 && <SpeedBadge rate={rate} />}
    </AbsoluteFill>
  );
};

/** Captions mapped onto the programme, each trimmed so it never overlaps the next. */
const CAPTION_TRACK = (() => {
  const mapped = CAPTIONS.map((c) => ({ ...c, f: at(c.at) }))
    .filter((c): c is typeof c & { f: number } => c.f != null)
    .sort((x, y) => x.f - y.f);
  return mapped.map((c, i) => {
    const next = mapped[i + 1];
    const want = sec(c.dur);
    const room = next ? next.f - c.f - 4 : want;
    return { text: c.text, from: c.f, dur: Math.max(30, Math.min(want, room)) };
  });
})();

const STEP_TRACK = STEPS.map((s, i) => ({ ...s, n: i + 1, f: at(s.at) })).filter((s) => s.f != null) as { at: number; label: string; n: number; f: number }[];

export const Tutorial: React.FC<TutorialProps> = ({ kicker, title, subtitle, recordingSrc }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {PLACED.map((p, i) => (
        <Sequence key={i} from={p.start} durationInFrames={p.dur}>
          {p.kind === 'intro' && <IntroCard kicker={kicker} title={title} subtitle={subtitle} durationInFrames={p.dur} />}
          {p.kind === 'card' && <ChapterCard part={p.part} title={p.title} sub={p.sub} />}
          {p.kind === 'clip' && <Clip a={p.a} b={p.b} rate={p.rate} src={recordingSrc} />}
          {p.kind === 'scene' && p.id === 'api' && <ApiKeyScene />}
          {p.kind === 'scene' && p.id === 'driver' && <DriverAppScene />}
          {p.kind === 'scene' && p.id === 'good' && <GoodToKnowScene />}
          {p.kind === 'outro' && <Outro line="Thanks for watching" durationInFrames={p.dur} />}
        </Sequence>
      ))}

      {STEP_TRACK.map((s) => (
        <Sequence key={`s${s.n}`} from={s.f} durationInFrames={sec(5)}>
          <LowerThird step={s.n} text={s.label} durationInFrames={sec(5)} />
        </Sequence>
      ))}

      {CAPTION_TRACK.map((c, i) => (
        <Sequence key={`c${i}`} from={c.from} durationInFrames={c.dur}>
          <Caption text={c.text} durationInFrames={c.dur} />
        </Sequence>
      ))}

      <ProgressBar />
    </AbsoluteFill>
  );
};

// Handy for picking still frames: programme frame of a source second.
export const programmeFrame = at;
export const itemStarts = PLACED.map((p) => ({ kind: p.kind, start: p.start, dur: p.dur }));
