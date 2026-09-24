import React from 'react';
import { Composition } from 'remotion';
import { Recap } from './Recap';
import { SAMPLE } from './data';

// 20 seconds at 30fps, 1080p. Duration must match the sum of the sequences in Recap.
export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="Recap"
      component={Recap}
      durationInFrames={600}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{ data: SAMPLE }}
    />
  );
};
