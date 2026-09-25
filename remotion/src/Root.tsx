import React from 'react';
import { Composition, Still } from 'remotion';
import { Thumbnail } from './tutorial/Thumbnail';
import { Recap } from './Recap';
import { SAMPLE } from './data';
import { Tutorial, tutorialDuration } from './tutorial/Tutorial';

const TUTORIAL_VIDEO_SECONDS = 961.08; // public/lv_0_20260925045413.mp4 (16:01, clean 1080p take)

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* YouTube thumbnail for the tutorial. Render as JPEG: YouTube caps thumbnails at 2 MB. */}
      <Still id="Thumbnail" component={Thumbnail} width={1920} height={1080} />
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
      {/* Tutorial: chapters of the screen recording (trimmed, sped up where it drags, camera
          zooms, callouts, narration captions) plus fully animated chapters for the timing API,
          the driver app and good-to-know. Length comes from the programme in Tutorial.tsx. */}
      <Composition
        id="Tutorial"
        component={Tutorial}
        durationInFrames={tutorialDuration()}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          kicker: 'Tutorial FRLcast',
          title: 'The complete guide',
          subtitle: 'Race control for FR Legends leagues',
          recordingSrc: 'lv_0_20260925045413.mp4',
          videoSeconds: TUTORIAL_VIDEO_SECONDS,
        }}
      />
    </>
  );
};
