// Remotion project config. Only build-time settings live here; the video's own numbers
// (size, fps, duration) are declared on the <Composition> in src/Root.tsx.
import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
