import React from 'react';
import { AbsoluteFill, Sequence } from 'remotion';
import { ScreenFrame, IntroCard, LowerThird, ProgressBar, Outro } from './TutorialKit';

/*
 * The tutorial wrap around the edited screen recording (public/tutorial-edit.mp4, 18:52 at
 * 30fps output). An intro card, then the recording plays full frame with a step lower-third at
 * the start of each section, a progress bar throughout, then an outro. Section times (STEPS)
 * are in seconds within the recording; edit them to re-time a label, no other change needed.
 *
 * Callouts (arrow + highlight on a click) are intentionally left out here: on an 18 minute
 * recording each one has to be hand-placed on a specific pixel and frame, so they are a second
 * pass once the section labels are lined up.
 */

export type TutorialProps = {
  kicker: string;
  title: string;
  subtitle?: string;
  recordingSrc: string;
  videoSeconds: number;
};

export const FPS = 30;
const INTRO = 90; // 3s
const OUTRO = 90; // 3s

// Section labels, timed to the edited recording (seconds from its start).
const STEPS: { at: number; dur: number; label: string }[] = [
  { at: 3, dur: 7, label: 'FRLcast, frlcast.my.id' },
  { at: 118, dur: 7, label: 'Konsol: Race control' },
  { at: 178, dur: 6, label: 'Event scenes' },
  { at: 208, dur: 6, label: 'Championship' },
  { at: 238, dur: 6, label: 'Drivers' },
  { at: 256, dur: 7, label: 'Vision / AI (timing otomatis)' },
  { at: 298, dur: 6, label: 'Overlays' },
  { at: 358, dur: 6, label: 'Layout' },
  { at: 388, dur: 6, label: 'OBS setup' },
  { at: 418, dur: 6, label: 'Help / manual' },
  { at: 448, dur: 6, label: 'Event hub (halaman penonton)' },
  { at: 478, dur: 6, label: 'Live timing' },
  { at: 508, dur: 6, label: 'Recap card' },
  { at: 538, dur: 6, label: 'Race report' },
  { at: 568, dur: 8, label: 'Desktop app: demo timing langsung' },
  { at: 812, dur: 7, label: 'Overlay leaderboard di OBS' },
  { at: 850, dur: 7, label: 'Multiview / control room' },
  { at: 888, dur: 8, label: 'Highlights untuk VOD' },
];

export const tutorialDuration = (videoSeconds: number) =>
  INTRO + Math.round(videoSeconds * FPS) + OUTRO;

export const Tutorial: React.FC<TutorialProps> = ({ kicker, title, subtitle, recordingSrc, videoSeconds }) => {
  const videoFrames = Math.round(videoSeconds * FPS);
  return (
    <AbsoluteFill>
      <Sequence durationInFrames={INTRO}>
        <IntroCard kicker={kicker} title={title} subtitle={subtitle} durationInFrames={INTRO} />
      </Sequence>

      <Sequence from={INTRO} durationInFrames={videoFrames}>
        <AbsoluteFill>
          <ScreenFrame src={recordingSrc} />
          {STEPS.map((s, i) => (
            <Sequence key={i} from={Math.round(s.at * FPS)} durationInFrames={Math.round(s.dur * FPS)}>
              <LowerThird step={i + 1} text={s.label} durationInFrames={Math.round(s.dur * FPS)} />
            </Sequence>
          ))}
          <ProgressBar />
        </AbsoluteFill>
      </Sequence>

      <Sequence from={INTRO + videoFrames} durationInFrames={OUTRO}>
        <Outro line="Selamat mencoba FRLcast" durationInFrames={OUTRO} />
      </Sequence>
    </AbsoluteFill>
  );
};
