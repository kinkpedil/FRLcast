import React from 'react';
import { AbsoluteFill, Sequence } from 'remotion';
import {
  ScreenFrame,
  IntroCard,
  LowerThird,
  Callout,
  Caption,
  ProgressBar,
  Outro,
} from './TutorialKit';

/*
 * A demo tutorial segment, assembled from the kit. It shows how a real module is built: an
 * intro card, then the screen recording with step lower-thirds, callouts and a caption layered
 * on top at the right frames, then an outro. Replace recordingSrc with your OBS capture (a file
 * in remotion/public) and edit STEPS/CALLOUTS to match the naskah in docs/TUTORIAL-SCRIPT.md.
 *
 * Frame math is at 30fps. The screen section runs from frame 90 to 540 (15s); the numbers below
 * are relative to that section via <Sequence from=...>.
 */

export type TutorialProps = {
  kicker: string;
  title: string;
  subtitle?: string;
  recordingSrc?: string | null;
};

const INTRO = 90; // frames
const BODY = 450; // frames of screen time
const OUTRO = 60; // frames

// Lower-thirds shown during the screen section (frames relative to the body start).
const STEPS: { from: number; duration: number; step: number; label: string }[] = [
  { from: 0, duration: 120, step: 1, label: 'Buka frlcast.my.id, lalu Login' },
  { from: 130, duration: 150, step: 2, label: 'Buat event, salin kode event' },
  { from: 290, duration: 150, step: 3, label: 'Buka konsol operator' },
];

// Callouts that point at a spot on the recording (x,y,w,h in 1920x1080 space).
const CALLOUTS: { from: number; duration: number; x: number; y: number; w: number; h: number; label: string; dir: 'top' | 'bottom' | 'left' | 'right' }[] = [
  { from: 40, duration: 80, x: 1500, y: 120, w: 300, h: 90, label: 'Tombol Login', dir: 'bottom' },
  { from: 300, duration: 120, x: 120, y: 160, w: 320, h: 520, label: 'Menu 10 halaman', dir: 'right' },
];

export const Tutorial: React.FC<TutorialProps> = ({ kicker, title, subtitle, recordingSrc }) => {
  return (
    <AbsoluteFill>
      {/* Intro */}
      <Sequence durationInFrames={INTRO}>
        <IntroCard kicker={kicker} title={title} subtitle={subtitle} durationInFrames={INTRO} />
      </Sequence>

      {/* Screen recording + overlays */}
      <Sequence from={INTRO} durationInFrames={BODY}>
        <AbsoluteFill>
          <ScreenFrame src={recordingSrc ?? null} />
          {STEPS.map((s, i) => (
            <Sequence key={`s${i}`} from={s.from} durationInFrames={s.duration}>
              <LowerThird step={s.step} text={s.label} durationInFrames={s.duration} />
            </Sequence>
          ))}
          {CALLOUTS.map((c, i) => (
            <Sequence key={`c${i}`} from={c.from} durationInFrames={c.duration}>
              <Callout x={c.x} y={c.y} w={c.w} h={c.h} label={c.label} from={c.dir} />
            </Sequence>
          ))}
          <Sequence from={150} durationInFrames={110}>
            <Caption text="Kode event ini dipakai konsol, overlay, dan halaman penonton." />
          </Sequence>
          <ProgressBar />
        </AbsoluteFill>
      </Sequence>

      {/* Outro */}
      <Sequence from={INTRO + BODY} durationInFrames={OUTRO}>
        <Outro line="Selamat mencoba FRLcast" durationInFrames={OUTRO} />
      </Sequence>
    </AbsoluteFill>
  );
};

export const TUTORIAL_DURATION = INTRO + BODY + OUTRO; // 600 frames = 20s at 30fps
