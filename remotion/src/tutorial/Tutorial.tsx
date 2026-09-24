import React from 'react';
import { AbsoluteFill, Sequence } from 'remotion';
import { ScreenFrame, IntroCard, LowerThird, Caption, Callout, ProgressBar, Outro } from './TutorialKit';

/*
 * Full-animation wrap around the clean screen recording (public/lv_0_20260925045413.mp4,
 * 16:01, silent 1080p). The recording plays full frame with, on top of it:
 *   - a step lower-third at the start of each section,
 *   - a narration caption (the recording has no voiceover, so the captions carry it),
 *   - a callout ring on the left-nav item as each console page opens,
 *   - a progress bar,
 * framed by an intro and an outro. All timings are in seconds within the recording and live in
 * the three arrays below, so re-timing anything is a one-line change.
 *
 * The left-nav sits at x 14..214; each item's centre y (1080p) is listed in NAV.
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
const OUTRO = 90;

const sec = (s: number) => Math.round(s * FPS);

// Left-nav item centre-y in the recording (1920x1080).
const NAV = {
  race: 240, scenes: 280, champ: 320, drivers: 360, drift: 396,
  vision: 436, overlays: 476, layout: 516, obs: 554, help: 592,
};

// Section lower-thirds (numbered chip + label), timed to the recording.
const STEPS: { at: number; dur: number; label: string }[] = [
  { at: 3, dur: 8, label: 'Landing page' },
  { at: 98, dur: 7, label: 'Sign in and open your event' },
  { at: 118, dur: 8, label: 'Operator console: Race control' },
  { at: 168, dur: 6, label: 'Event scenes' },
  { at: 195, dur: 6, label: 'Championship' },
  { at: 212, dur: 6, label: 'Drivers' },
  { at: 242, dur: 6, label: 'Drift battles' },
  { at: 258, dur: 7, label: 'Vision / AI: automatic timing' },
  { at: 275, dur: 6, label: 'Overlays' },
  { at: 332, dur: 7, label: 'Layout & branding' },
  { at: 378, dur: 6, label: 'OBS setup' },
  { at: 408, dur: 6, label: 'Help / manual' },
  { at: 438, dur: 7, label: 'Event hub (public)' },
  { at: 465, dur: 6, label: 'Live timing' },
  { at: 482, dur: 6, label: 'Season stats' },
  { at: 498, dur: 6, label: 'Recap card' },
  { at: 512, dur: 6, label: 'Race report' },
  { at: 555, dur: 8, label: 'Desktop app: live timing demo' },
  { at: 802, dur: 7, label: 'Overlay in OBS' },
  { at: 838, dur: 7, label: 'Multiview / control room' },
  { at: 872, dur: 8, label: 'Highlights for the VOD' },
];

// Narration, shown as captions (there is no voiceover on the recording).
const CAPTIONS: { at: number; dur: number; text: string }[] = [
  { at: 4, dur: 8, text: 'FRLcast, race control for your FR Legends league.' },
  { at: 13, dur: 8, text: 'Live timing, flags and OBS overlays from one console.' },
  { at: 40, dur: 8, text: 'The commentator and fully automatic timing run in the free desktop app.' },
  { at: 98, dur: 9, text: 'Sign in, then open your event to reach the operator console.' },
  { at: 120, dur: 8, text: 'Ten pages, and number keys one to nine jump between them.' },
  { at: 130, dur: 9, text: 'Race control: the flags, the live classification, the event details.' },
  { at: 168, dur: 8, text: 'Event scenes: different overlay looks from one browser source.' },
  { at: 195, dur: 8, text: 'Championship: points you set, standings kept per round.' },
  { at: 213, dur: 8, text: 'Drivers: your roster, tracked by the exact in-game colour.' },
  { at: 243, dur: 7, text: 'Drift battles: bracket, judging and one more time.' },
  { at: 258, dur: 9, text: 'Vision and AI: the official API, the minimap, or manual timing.' },
  { at: 276, dur: 9, text: 'Overlays: turn each widget on or off, plus the spoken commentator.' },
  { at: 333, dur: 9, text: 'Layout: drag every widget, pick a skin, add your league logo.' },
  { at: 379, dur: 9, text: "OBS setup: copy a browser-source URL into OBS and you're on air." },
  { at: 409, dur: 7, text: 'Help: the full manual, in English and Indonesian.' },
  { at: 439, dur: 8, text: 'The public event hub, opened with the event code, no login.' },
  { at: 466, dur: 6, text: 'Live timing on the viewers’ phones.' },
  { at: 483, dur: 7, text: 'Season stats: wins, podiums, best and average finish.' },
  { at: 499, dur: 6, text: 'A recap card to share on social.' },
  { at: 513, dur: 6, text: 'And a printable race report.' },
  { at: 556, dur: 9, text: 'In the desktop app the grid is built and timing runs live.' },
  { at: 640, dur: 9, text: 'Fire the laps and the board sorts itself, with gaps and best laps.' },
  { at: 803, dur: 8, text: 'The same data on the OBS overlay.' },
  { at: 839, dur: 8, text: 'Multiview: every overlay on one control-room screen.' },
  { at: 873, dur: 9, text: 'Highlights for the VOD: every moment timestamped, ready to export.' },
];

// Callout rings on the nav item as each console page opens (no label; the lower-third names it).
const CALLOUTS: { at: number; y: number }[] = [
  { at: 118, y: NAV.race }, { at: 168, y: NAV.scenes }, { at: 195, y: NAV.champ },
  { at: 212, y: NAV.drivers }, { at: 242, y: NAV.drift }, { at: 258, y: NAV.vision },
  { at: 275, y: NAV.overlays }, { at: 332, y: NAV.layout }, { at: 378, y: NAV.obs },
  { at: 408, y: NAV.help },
];

export const tutorialDuration = (videoSeconds: number) => INTRO + sec(videoSeconds) + OUTRO;

export const Tutorial: React.FC<TutorialProps> = ({ kicker, title, subtitle, recordingSrc, videoSeconds }) => {
  const videoFrames = sec(videoSeconds);
  return (
    <AbsoluteFill>
      <Sequence durationInFrames={INTRO}>
        <IntroCard kicker={kicker} title={title} subtitle={subtitle} durationInFrames={INTRO} />
      </Sequence>

      <Sequence from={INTRO} durationInFrames={videoFrames}>
        <AbsoluteFill>
          <ScreenFrame src={recordingSrc} />
          {CALLOUTS.map((c, i) => (
            <Sequence key={`c${i}`} from={sec(c.at)} durationInFrames={sec(3.5)}>
              <Callout x={14} y={c.y - 18} w={200} h={36} />
            </Sequence>
          ))}
          {STEPS.map((s, i) => (
            <Sequence key={`s${i}`} from={sec(s.at)} durationInFrames={sec(s.dur)}>
              <LowerThird step={i + 1} text={s.label} durationInFrames={sec(s.dur)} />
            </Sequence>
          ))}
          {CAPTIONS.map((c, i) => (
            <Sequence key={`p${i}`} from={sec(c.at)} durationInFrames={sec(c.dur)}>
              <Caption text={c.text} />
            </Sequence>
          ))}
          <ProgressBar />
        </AbsoluteFill>
      </Sequence>

      <Sequence from={INTRO + videoFrames} durationInFrames={OUTRO}>
        <Outro line="Thanks for watching" durationInFrames={OUTRO} />
      </Sequence>
    </AbsoluteFill>
  );
};
