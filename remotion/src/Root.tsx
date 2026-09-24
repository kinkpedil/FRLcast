import React from 'react';
import { Composition } from 'remotion';
import { Recap } from './Recap';
import { SAMPLE } from './data';
import { Tutorial, TUTORIAL_DURATION } from './tutorial/Tutorial';

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
      {/* Tutorial kit demo: intro + screen recording slot + step lower-thirds + callouts + outro.
          16:9 for YouTube. Set recordingSrc to an OBS capture in remotion/public to use it. */}
      <Composition
        id="Tutorial"
        component={Tutorial}
        durationInFrames={TUTORIAL_DURATION}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          kicker: 'Tutorial FRLcast',
          title: 'Membuat event pertama',
          subtitle: 'Bagian 1: mode hosted',
          recordingSrc: null,
        }}
      />
    </>
  );
};
