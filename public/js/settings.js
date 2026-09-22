// Detection settings, shared across devices.
//
// These used to live in each browser's localStorage. That quietly broke the two-device
// setup: the operator tunes colour tolerance and tracking mode on the laptop, while the
// machine actually looking at the game is the capture node — which never heard about
// any of it and kept running the defaults.
//
// They belong to the event, not to a browser, so they live in server state now. What
// stays local is genuinely per-device: preview frame rate, capture resolution cap, and
// which capture source that particular panel is driving.

/** field -> [input selector, cast from the input, lives on the engine not settings] */
export const SETTING_FIELDS = {
  targetFps:        ['#setFps', Number, true],
  trackingMode:     ['#setTrackMode', (v) => v, false],
  motionThreshold:  ['#setMotionThr', Number, false],
  sampleStep:       ['#setStep', Number, false],
  colorTolerance:   ['#setTol', Number, false],
  minBlobPixels:    ['#setBlob', Number, false],
  minLapMs:         ['#setMinLap', (v) => Number(v) * 1000, false],
  stopSeconds:      ['#setStopped', Number, false],
  maxMissedMs:      ['#setMissed', Number, false],
  triggerThreshold: ['#setTrig', Number, false],
  pathDirection:    ['#setDir', Number, false],
  lapFromLines:     ['#setLapLines', null, false],
  lapFromMinimap:   ['#setLapMinimap', null, false],
  lapFromTrigger:   ['#setLapTrigger', null, false],
  lapFromOcr:       ['#setLapOcr', null, false]
};

/** Push shared settings into a running engine. Returns true when anything changed. */
export function applyVisionSettings(vision, settings) {
  if (!settings) return false;
  let changed = false;

  for (const [key, [, , onEngine]] of Object.entries(SETTING_FIELDS)) {
    if (!(key in settings)) continue;
    const value = settings[key];
    if (onEngine) {
      if (vision[key] !== value) { vision[key] = value; changed = true; }
    } else if (vision.settings[key] !== value) {
      vision.settings[key] = value;
      changed = true;
    }
  }

  if (changed && typeof vision.pushWorkerConfig === 'function') vision.pushWorkerConfig();
  return changed;
}

/** The value to show in an input, in the units that input uses. */
export function toInputValue(key, value) {
  if (key === 'minLapMs') return value / 1000;
  return value;
}
