import React from 'react';
import { Composition } from 'remotion';
import { Recap } from './Recap';
import { SAMPLE } from './data';
import { Tutorial, tutorialDuration } from './tutorial/Tutorial';

const TUTORIAL_VIDEO_SECONDS = 961.08; // public/lv_0_20260925045413.mp4 (16:01, clean 1080p take)

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* Race recap, rendered from event data. 20s, 1080p. */}
      <Composition
        id="Recap"
        component={Recap}
        durationInFrames={600}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{ data: SAMPLE }}
      />
      {/* Tutorial: intro + the edited screen recording (public/tutorial-edit.mp4) with section
          lower-thirds and a progress bar, then an outro. 1080p/30fps for YouTube. */}
      <Composition
        id="Tutorial"
        component={Tutorial}
        durationInFrames={tutorialDuration(TUTORIAL_VIDEO_SECONDS)}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          kicker: 'Tutorial FRLcast',
          title: 'How to use it',
          subtitle: 'broadcast for FR Legends',
          recordingSrc: 'lv_0_20260925045413.mp4',
          videoSeconds: TUTORIAL_VIDEO_SECONDS,
        }}
      />
    </>
  );
};
