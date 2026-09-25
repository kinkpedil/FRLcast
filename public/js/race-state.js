import { labelGaps, fmtGap } from './timing.js';
import { scoreRound as scoreRows, standingsFrom } from './points.js';


/**
 * An id for something that becomes a database row.
 *
 * Drivers and penalties are the two. Everything else this file numbers lives inside the
 * settings blob, where any string will do, but those two are rows with a uuid primary key:
 * a base36 id is rejected outright, and the console would silently fail to record a penalty
 * during a race.
 *
 * randomUUID is in every browser this runs in and in Node 19 up. The fallback is there for
 * an insecure origin, where crypto.randomUUID is not exposed.
 */
function uid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const hex = () => Math.floor(Math.random() * 16).toString(16);
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) =>
    c === 'x' ? hex() : ((Math.random() * 4 | 8).toString(16)));
}

export const PALETTE = [
  '#ff3b30', '#0a84ff', '#30d158', '#ffd60a', '#bf5af2',
  '#ff9f0a', '#64d2ff', '#ff375f', '#5e5ce6', '#66d4cf',
  '#ac8e68', '#a2845e', '#ff6482', '#98989d', '#32ade6', '#e0e0e0'
];

function defaultState() {
  return {
    event: {
      name: 'FR LEGENDS CUP',
      round: 'ROUND 1',
      track: 'EBISU MINAMI',
      sessionType: 'race', // race | qualifying | practice | drift
      sessionName: 'FEATURE RACE'
    },
    race: {
      status: 'idle', // idle | formation | green | yellow | safety | red | finished
      totalLaps: 10,
      startedAt: null,     // epoch ms of green flag
      finishedAt: null,
      pausedAt: null,
      pausedTotal: 0,
      timeLimitSec: 0,     // 0 = lap based
      // Manual mode: no vision, no timing lines — the operator sets the order and the laps
      // by hand. When on, recompute arranges the field by manualOrder instead of by pace.
      manual: false,
      manualOrder: [],     // driver ids, position 1 first, while manual mode is on
      // With one timing point, order can only be confirmed once a lap. Real timing
      // fills the gap the same way: carry each car forward at its own pace and show
      // where it should be now. Marked as predicted so nobody mistakes it for measured.
      predictOrder: true,
      /*
       * The order the cars line up in, as driver ids.
       *
       * Before anyone has completed a lap there is nothing to rank on — every car has
       * zero laps and zero elapsed time — so without this the leaderboard shows whatever
       * order the roster happens to be in, which is not the order on track. The grid is
       * usually built from a qualifying session, but it is just a list, so it can also be
       * set by hand for a reverse grid or a heat draw.
       */
      grid: [],
      /*
       * Race control.
       *
       * Penalties are recorded as decisions with a reason and a moment, not as a number
       * silently added to a driver. A stewarding decision that cannot be shown, explained
       * or reversed is not one anyone will trust, and at a club event the person running
       * race control is also running the stream — they need to see what is outstanding
       * without keeping it in their head.
       *
       * An investigation is deliberately its own state. Announcing UNDER INVESTIGATION and
       * deciding afterwards is how real race control works, and it buys the operator the
       * time they actually need.
       */
      penalties: [],     // { id, driverId, type, seconds, reason, at, status, auto }
      /*
       * Flags, raised by the system where the system can actually see the reason.
       *
       * A stopped car on the racing line is a yellow — that is what a yellow means, and
       * "this car has not moved for four seconds and is not in the pits" is something the
       * tracker already knows. Several at once is an accident, which is a red. The leader
       * completing the distance is a chequered flag. A car about to be lapped is a blue.
       *
       * What the system cannot see is severity, debris, or a marshal's judgement, so it
       * never claims to. And whenever a person sets a flag by hand, the system stops
       * touching it: an operator who overrules the automation must not be overruled back
       * a second later.
       */
      flags: {
        auto: true,
        yellowOnStopped: true,
        /*
         * What a stopped car raises. The detection is identical either way — a car that
         * has not moved and is not in the pits — so this is a preference about response,
         * not a second thing to detect. Series that neutralise with a virtual safety car
         * set it here once and never think about it again.
         */
        stoppedRaises: 'yellow',    // 'yellow' | 'vsc'
        /*
         * Laps a drive-through may go unserved before the driver is black-flagged. A
         * penalty nobody serves is not a penalty, and this is the one escalation that is
         * genuinely computable: the lap it was issued on is recorded, and the current lap
         * count is known. 0 switches it off.
         */
        blackFlagUnserved: 3,
        redStoppedCount: 3,     // cars stopped at once before it becomes a red flag
        greenAfterSec: 5,       // how long the track must be clear before green returns
        blue: true,
        chequered: true
      },
      flagSource: 'auto',       // 'operator' once a human sets one, and then it stays
      clearSince: null,
      rules: {
        // Only three things here can be detected from what the system already measures.
        // Everything else a steward calls is judgement, and pretending otherwise would
        // produce confident nonsense.
        jumpStart: true,
        jumpStartSeconds: 5,
        trackLimits: true,
        trackLimitsAllowed: 3,      // warnings before it becomes a penalty
        trackLimitsSeconds: 5,
        impossibleLap: true,        // a lap far under the field's pace: a cut course
        autoApply: false            // false = raise an investigation, true = apply at once
      }
    },
    drivers: [],
    overlay: {
      show: {
        leaderboard: true,
        tower: true,
        lowerThird: false,
        status: true,
        results: false,
        gap: false,
        trackmap: false,
        battle: false,
        bracket: false,
        grid: false,
        h2h: false,
        standings: false,
        fastlap: false,
        sectors: false,
        delta: false,
        radio: false,
        sponsor: false,
        countdown: false,
        intro: false,
        qr: false,
        ticker: false
      },
      /*
       * Which two cars the head-to-head compares.
       *
       * Auto by default, and auto means the closest fight on track rather than the front
       * two. The battle worth showing is rarely for the lead, and an operator who has to
       * notice it and pick both drivers by hand will miss it — by the time the graphic is
       * up the pass has happened.
       */
      h2h: { mode: 'auto', a: null, b: null },
      /*
       * Scenes, in the sense OBS uses the word: a named set of widgets and where they
       * sit. A practice session, a grid walk and a drift battle want completely
       * different things on screen, and rebuilding the layout by hand between them is
       * not something anyone does while a stream is live.
       *
       * `show` and `layout` above are the *active* scene, mirrored out so every reader —
       * the overlays, the layout editor, the preview — keeps working unchanged. Writes go
       * into the scene and are mirrored back, so the two can never drift apart.
       */
      scenes: [],
      activeScene: 'race',
      transitionMs: 420,
      autoTicker: true,
      accent: '#00e0a4',
      focusDriverId: null,
      ticker: [],
      compact: false,
      // Per-widget placement on the 1920x1080 canvas, edited live in the Layout page.
      // An absent entry means "use the stylesheet default", so a fresh install still
      // looks right before anyone touches the editor.
      layout: {},          // id -> { x, y, w, scale, hidden }
      style: {
        panelOpacity: 0.88,
        radius: 10,
        density: 'normal', // normal | compact
        shadow: true,
        // Lite drops the always-running ambient animations and the drop shadows.
        // Default on: they are the only overlay cost that never stops, and on a weak
        // GPU that matters more than the shimmer does.
        lite: true
      },
      editSelected: null,
      /*
       * League branding.
       *
       * A series has an identity, and a broadcast that cannot show it looks like a test
       * pattern. The logo is a URL rather than the image itself: state is pushed over the
       * socket on every timing update, and a hundred kilobytes of base64 riding along with
       * every lap would swamp the connection it shares with the overlays.
       */
      brand: {
        logoUrl: '',
        name: '',
        showLogo: true,
        // 'beside'    — logo sits next to the flag, both on screen the whole time
        // 'alternate' — the two share one slot and cross-fade between each other
        placement: 'beside',
        rotateSec: 6       // only used by 'alternate': how long each holds the slot
      },
      theme: 'midnight',
      // The broadcast skin: 'classic' is the original look, 'motogp' reshapes the same
      // widgets into the tilted-number tower style. A skin changes shape; a theme changes
      // colour; the two are independent so any combination works.
      skin: 'classic',
      // Full-screen animated wipe played when the scene changes.
      stinger: true,
      // The wordmark shown in the WEC / MotoGP tower header. Free text so a league can put
      // its own series name there; empty falls back to the skin's own default label.
      towerTitle: '',
      // Team-radio card: whose radio, and the quote the operator typed. Shown while the
      // radio widget is toggled on.
      radio: { driverId: '', text: '' },
      // Audience poll: shown on the overlay + the public live page while open. Options are
      // filled from the driver list by the console when the operator opens it.
      poll: { open: false, question: '', options: [] },
      // Closed polls, newest first (capped by the console). A closed poll snapshots its
      // tally + winner here so the recap can name a fan vote / Driver of the Day after the
      // live tally is gone. Rides in the settings JSON, so no schema is needed for it.
      pollHistory: [],
      // Sponsor rotator: a list of { label, logo } the overlay cycles through. The console
      // advances sponsorIndex on a timer (a windowless OBS page cannot run its own).
      sponsors: [],
      sponsorIndex: 0,
      // Pre-show countdown: an absolute target time; the widget shows the time left to it.
      countdown: { target: 0, label: 'STARTS IN' }
    },
    vision: {
      active: false,
      fps: 0,
      lastEvent: null,
      mode: 'idle',
      log: [],
      owner: null,        // clientId currently running detection
      ownerLabel: null,   // human-readable, e.g. "PC (capture node)"
      // Detection behaviour belongs to the event, not to whichever browser happens to
      // be open: the operator tunes it on one device, the capture node runs it on
      // another. Keeping it here is what makes those the same settings.
      settings: {
        targetFps: 10,
        trackingMode: 'color',
        motionThreshold: 26,
        sampleStep: 3,
        colorTolerance: 70,
        minBlobPixels: 6,
        minLapMs: 8000,
        stopSeconds: 4,
        maxMissedMs: 900,
        triggerThreshold: 0.82,
        pathDirection: 1,
        lapFromLines: true,
        lapFromMinimap: false,
        lapFromTrigger: true,
        lapFromOcr: false
      }
    },
    calibration: {
      rois: [],        // {id,type,x,y,w,h,driverId,opts}
      // Timing lines, in frame-normalised coordinates (0..1 of the captured window).
      // kind 'finish' closes a lap; each 'sector' line closes one split. N sector
      // lines therefore produce N+1 sectors, exactly like a real circuit.
      lines: [],       // {id,kind,index,name,a:{x,y},b:{x,y},dir}
      trackPath: [],   // [{x,y}] normalized 0..1 inside the minimap ROI
      // The circuit as the detector worked it out for itself, by watching a car drive a
      // lap. Kept apart from trackPath so a hand-traced path is never overwritten, and
      // so the operator can see what the detector believes the track looks like.
      learnedPath: [],
      minimapRoiId: null,
      sourceSize: { w: 0, h: 0 }
    },
    // Session records, used for purple/green split colouring on the overlays.
    records: {
      bestLap: { ms: null, driverId: null, lap: null },
      bestSectors: []            // index -> { ms, driverId }
    },
    /*
     * Tandem battles — the format FR Legends is actually competed in.
     *
     * Everything else in this file measures a car against a clock. A drift event is not
     * that: drivers qualify on a judged solo run, then meet head to head in a knockout,
     * two runs apiece with the lead swapped between them, and three judges decide who
     * advances. None of it can be derived from the detector, because angle, proximity,
     * line and style are perceptual calls a colour blob cannot express. So the data model
     * here records human decisions and the broadcast state around them; the operator's job
     * is to enter them quickly and have the overlays keep up.
     */
    drift: {
      format: {
        bracketSize: 16,       // 4, 8, 16 or 32; unfilled seats become byes
        judges: 3,
        qualifyingRuns: 2,     // best run counts
        maxOmt: 2              // reruns before a decision has to be forced
      },
      qualifying: [],          // { driverId, runs: [number], best }
      bracket: [],             // rounds: { name, pairs: [{ a, b, winner, omt }] }
      battle: null,            // the one being run right now
      champion: null
    },
    /*
     * Finished sessions, kept so one can feed the next.
     *
     * A race weekend is a chain: practice informs qualifying, qualifying sets the grid,
     * the race produces the result. Holding only the live session throws that away — the
     * operator would have to write the qualifying order on paper and type it back in,
     * which is exactly where a grid gets scrambled. Results are snapshots, not links to
     * the drivers, so editing the roster afterwards cannot rewrite history.
     */
    sessions: [],                // { id, type, name, at, results: [...] }
    /*
     * The championship, which is the thing an event series is actually about.
     *
     * Rounds are stored as scored snapshots, not as links to sessions or drivers. A club
     * series runs over months: rosters are edited, cars change colour, someone is removed
     * and re-added with a new id. None of that may retroactively rewrite what a driver
     * scored in round two, so each round keeps its own copy of who finished where and
     * what it was worth.
     */
    championship: {
      name: 'CHAMPIONSHIP',
      points: {
        // Points for each finishing position, first place first. Anything past the end of
        // the list scores nothing.
        table: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1],
        fastestLap: 1,
        pole: 0,
        // Club series often drop each driver's worst results so one bad night, or one
        // night away, does not decide the title.
        dropWorst: 0
      },
      rounds: []       // { id, name, at, results: [{ driverId, name, num, color, position, points, dnf, fastestLap, pole }] }
    },
    /*
     * Markers for cutting the recording afterwards.
     *
     * Everything worth marking is already detected — an overtake, a fastest lap, a car
     * stopping, a battle decided — and already timestamped. What was missing was somewhere
     * durable to keep it: `feed` is capped at 60 so the overlays stay cheap to render, and
     * an evening's event overruns that within the first race. These are kept in full and
     * expressed relative to the moment recording started, which is the only form an editor
     * can actually use.
     */
    recording: {
      startedAt: null,   // epoch ms of the operator pressing record
      offsetMs: 0,       // nudge, because the two record buttons are never pressed together
      markers: []        // { t, kind, text, driverId, manual }
    },
    /*
     * Drivers who have signed in on their phone and are waiting to be let into the event.
     *
     * Only what the operator needs to decide: a name, a number, when it arrived. The
     * password, its hash and every session token live in server/drivers-auth.js and its
     * own file, because this object is served to the whole network on /api/state and
     * pushed to every overlay. Nothing secret may be one careless field away from that.
     */
    /*
     * Where a phone can reach this server, filled in at boot. The panel shows it to the
     * operator to read out; "localhost" is correct on their PC and useless to a driver.
     */
    /*
     * The spoken commentator.
     *
     * Settings only. What it says is worked out fresh by whichever page is speaking, from
     * the same state every overlay already has, so no commentary ever crosses the wire —
     * three hundred lines an evening in the settings blob would rewrite the blob three
     * hundred times, and every rewrite is a Realtime message to every overlay.
     */
    commentary: {
      on: false,
      // Which voice engine speaks: 'browser' (speechSynthesis, free/offline, robotic in OBS)
      // or 'piper' (the local server's /api/tts neural voice). Piper is local-only and falls
      // back to the browser voice per line, so this is safe to leave on for a hosted event.
      engine: 'browser',
      lang: 'id-ID',
      /*
       * A specific voice by name, or empty for "the best one for the language".
       *
       * A name rather than an index: the list is the machine's, and the machine reading
       * this is not always the machine the operator chose on. A name that is missing there
       * falls back to the language rule instead of picking whatever happens to be third.
       */
      voice: '',
      rate: 1.05,
      volume: 1,
      // calm says only what matters, busy fills the silence with the outlook and the gaps.
      verbosity: 'normal',   // 'calm' | 'normal' | 'busy'
      caption: true,
      saying: {}             // name as written -> name as it should be read
    },
    net: { lan: '', tls: '' },
    registrations: [],           // { id, accountId, nick, num, team, at, status, driverId }
    standings: [],               // championship table, recomputed with the rest
    feed: [],                    // newest-first log of notable race events
    radio: [],                   // newest-first team-radio messages from the driver app
    updatedAt: Date.now()
  };
}

function makeDriver(partial, index) {
  return {
    id: partial.id || uid(),
    num: partial.num ?? String(index + 1),
    name: partial.name || `DRIVER ${index + 1}`,
    short: partial.short || (partial.name || `DRV${index + 1}`).slice(0, 3).toUpperCase(),
    team: partial.team || '',
    color: partial.color || PALETTE[index % PALETTE.length],
    car: partial.car || '',
    // Class / category (e.g. HYPERCAR, LMGT3). Free text; the WEC skin groups the tower by
    // it and re-numbers each group. Empty means "one ungrouped field", which is every other
    // skin's normal behaviour.
    carClass: partial.carClass || '',
    // Optional driver photo (URL). Shown on the intro + lower-third only when set; empty keeps
    // the plain look.
    photo: partial.photo || '',
    // timing
    crossings: [],     // epoch ms of each finish-line crossing
    lapTimes: [],      // ms per completed lap
    bestLap: null,
    lastLap: null,
    lapsDone: 0,
    penaltySec: 0,
    pit: false,
    pitStops: 0,
    // dnf is the umbrella "out of the race" flag every consumer keys off (filters, ranking,
    // results, standings). retired refines it: retired always implies dnf, and only changes
    // the label from DNF to RET. The distinction is editorial (DNF = involuntary, a crash or
    // failure; retired = the driver withdrew on purpose) and matches what we told the timing
    // API author; nothing computational depends on it, so leaving it false is always safe.
    dnf: false,
    retired: false,
    finished: false,
    // derived, filled by recompute()
    position: 0,
    gap: '',
    interval: '',
    totalMs: 0,
    // sector timing
    sectors: [],       // splits completed so far in the current lap (ms)
    lapSectors: [],    // one array of splits per completed lap
    bestSectors: [],   // personal best per sector index (ms)
    sectorStart: null, // ts of the last timing-line crossing
    // drift / vision
    driftScore: 0,
    progress: 0,       // 0..1 within current lap, from vision
    speed: 0,          // px/s along the minimap, from the tracker
    stopped: false,
    trackedAt: null,   // last time the tracker actually saw this car
    livePos: 0,        // lapsDone + progress round the current lap, for ordering
    predicted: false,  // true when that progress is inferred from pace, not measured
    // race control, filled by recompute()
    blueFlag: false,         // about to be lapped by the leader
    blackFlag: false,        // shown the black flag: return to the pits, you are out
    penaltyPending: false,   // an open investigation, shown on the tower
    penaltyServed: 0,        // seconds actually added by decided penalties
    trackLimits: 0           // warnings so far this session
  };
}

/*
 * The seeded scene set. Every widget appears on at least one scene, and within a scene the
 * placements are chosen not to overlap on a 1920x1080 canvas. Rebuilt on demand from the
 * Event scenes page, so an operator who has re-arranged things can get back to a clean set.
 */
function defaultScenes() {
  const keys = Object.keys(defaultState().overlay.show);
  const show = (...on) => { const s = {}; for (const k of keys) s[k] = on.includes(k); return s; };
  const L = (m) => m;   // just readability
  return [
    { id: 'preshow', name: 'Pre-show', show: show('status', 'countdown', 'sponsor', 'qr', 'intro'),
      layout: L({ countdown: { x: 810, y: 360, scale: 1 }, intro: { x: 48, y: 858, scale: 1 },
                  sponsor: { x: 770, y: 1002, scale: 1 }, qr: { x: 1648, y: 812, scale: 1 } }) },
    { id: 'grid', name: 'Starting grid', show: show('status', 'grid', 'sponsor', 'qr'),
      layout: L({ grid: { x: 610, y: 150, scale: 1 }, qr: { x: 1648, y: 150, scale: 1 },
                  sponsor: { x: 770, y: 1002, scale: 1 } }) },
    { id: 'practice', name: 'Practice', show: show('status', 'leaderboard', 'trackmap', 'fastlap', 'ticker'),
      layout: L({ leaderboard: { x: 48, y: 150, scale: 1 }, trackmap: { x: 1420, y: 150, scale: 1 },
                  fastlap: { x: 760, y: 116, scale: 1 } }) },
    { id: 'qualifying', name: 'Qualifying', show: show('status', 'tower', 'leaderboard', 'fastlap', 'sectors', 'delta'),
      layout: L({ leaderboard: { x: 48, y: 150, scale: 1 }, tower: { x: 1312, y: 150, scale: 1 },
                  fastlap: { x: 760, y: 116, scale: 1 }, sectors: { x: 730, y: 900, scale: 1 },
                  delta: { x: 730, y: 730, scale: 1 } }) },
    { id: 'race', name: 'Race', show: show('status', 'leaderboard', 'lowerThird', 'fastlap', 'radio', 'ticker'),
      layout: L({ leaderboard: { x: 48, y: 150, scale: 1 }, lowerthird: { x: 560, y: 878, scale: 1 },
                  fastlap: { x: 760, y: 116, scale: 1 }, radio: { x: 1572, y: 150, scale: 1 } }) },
    { id: 'battles', name: 'Battles & poll', show: show('status', 'h2h', 'gap', 'poll'),
      layout: L({ h2h: { x: 610, y: 176, scale: 1 }, gap: { x: 730, y: 900, scale: 1 },
                  poll: { x: 1500, y: 176, scale: 1 } }) },
    { id: 'drift', name: 'Drift battles', show: show('status', 'battle', 'bracket', 'poll'),
      layout: L({ battle: { x: 560, y: 150, scale: 1 }, bracket: { x: 1312, y: 150, scale: 1 },
                  poll: { x: 48, y: 820, scale: 1 } }) },
    { id: 'results', name: 'Results', show: show('status', 'results', 'standings', 'sponsor', 'qr'),
      layout: L({ results: { x: 48, y: 150, scale: 1 }, standings: { x: 1190, y: 150, scale: 1 },
                  qr: { x: 60, y: 830, scale: 1 }, sponsor: { x: 600, y: 1010, scale: 1 } }) }
  ];
}

// Actions too frequent or too cosmetic to be worth an undo snapshot: they would bury the
// race-control actions (flags, penalties, resets) that undo actually exists for.
const NO_HISTORY = new Set([
  'history.undo', 'driver.progress', 'driver.progressBatch', 'timing.cross', 'lap.record',
  'overlay.layout', 'overlay.layoutApply', 'overlay.layoutRevert', 'overlay.layoutReset',
  'overlay.update', 'overlay.h2h', 'overlay.style', 'overlay.theme', 'overlay.scene',
  'manual.reorder', 'manual.move', 'driver.radio', 'timing.external'
]);

export class RaceState {
  /**
   * @param {?object} store  something with read() and write(state). Null means this state
   *                         is not persisted at all, which is what a test wants and what
   *                         the browser wants before an event has been chosen.
   */
  constructor(store = null) {
    this.state = defaultState();
    this.listeners = new Set();
    this.saveTimer = null;
    this.store = store;
    // Undo stack: a snapshot of the whole state taken before each significant action, so a
    // mis-flag or a wrong penalty is one click to reverse. High-frequency actions (vision
    // progress, lap crossings, overlay edits) are excluded so they never bury the useful ones.
    this.history = [];
    this.load();
  }

  _clone(o) {
    try { return (typeof structuredClone === 'function') ? structuredClone(o) : JSON.parse(JSON.stringify(o)); }
    catch (e) { return JSON.parse(JSON.stringify(o)); }
  }

  load() {
    try {
      const disk = this.store ? this.store.read() : null;
      if (disk) {
        // Merge section by section: a state file written by an older build is missing
        // whole keys, and a shallow spread would let those gaps win over the defaults.
        const base = defaultState();
        this.state = { ...base, ...disk };
        this.state.event = { ...base.event, ...(disk.event || {}) };
        this.state.race = { ...base.race, ...(disk.race || {}) };
        this.state.overlay = { ...base.overlay, ...(disk.overlay || {}) };
        this.state.overlay.show = { ...base.overlay.show, ...(disk.overlay?.show || {}) };
        this.state.overlay.style = { ...base.overlay.style, ...(disk.overlay?.style || {}) };
        // Same reason as show and style: the overlay spread above is shallow, so a state
        // file written before a brand field existed would drop that field's default.
        this.state.overlay.brand = { ...base.overlay.brand, ...(disk.overlay?.brand || {}) };
        this.state.calibration = { ...base.calibration, ...(disk.calibration || {}) };
        this.state.vision.settings = { ...base.vision.settings, ...(disk.vision?.settings || {}) };
        this.state.records = { ...base.records, ...(disk.records || {}) };

        /*
         * The other four sections that are objects rather than arrays.
         *
         * Without these a state written before one of them existed, or a snapshot handed
         * in from a hosted event that only carries what it has, replaces the whole section
         * with a partial one. `championship` was the live example: no `points` key, and the
         * standings calculation reads `champ.points.dropWorst` on the next recompute.
         */
        this.state.drift = { ...base.drift, ...(disk.drift || {}) };
        this.state.championship = { ...base.championship, ...(disk.championship || {}) };
        this.state.championship.points = {
          ...base.championship.points, ...(disk.championship?.points || {})
        };
        this.state.recording = { ...base.recording, ...(disk.recording || {}) };
        this.state.commentary = { ...base.commentary, ...(disk.commentary || {}) };
        this.state.commentary.saying = { ...(disk.commentary?.saying || {}) };
        this.state.net = { ...base.net, ...(disk.net || {}) };
        this.state.drivers = (disk.drivers || []).map((d) => ({ ...makeDriver(d, 0), ...d }));
        // never resume a live clock after a restart
        if (this.state.race.status === 'green') this.state.race.status = 'red';
        this.state.vision = defaultState().vision;
      }
      this.state.radio = [];   // radio is live pit chatter, not race history — never reload stale
      this.ensureScenes();
    } catch (err) {
      console.error('[state] load failed, using defaults:', err.message);
    }
  }

  /**
   * The clock, as one overridable call.
   *
   * Ordering depends on how long ago each car was last seen, and a test that drives that
   * by hand while the code reads the wall clock is not testing anything: the ages come
   * out negative and every branch that matters is skipped. Injecting time here is the
   * difference between a repeatable measurement and a number that looks like one.
   */
  now() { return Date.now(); }

  save() {
    // debounced, but never starved: vision keeps calling this several times a second
    const now = Date.now();
    if (!this.lastSaveAt) this.lastSaveAt = now;
    if (now - this.lastSaveAt < 5000) clearTimeout(this.saveTimer);
    else return this.writeNow();
    this.saveTimer = setTimeout(() => this.writeNow(), 400);
  }

  writeNow() {
    this.lastSaveAt = Date.now();
    clearTimeout(this.saveTimer);
    if (!this.store) return;
    try {
      this.store.write(this.state);
    } catch (err) {
      console.error('[state] save failed:', err.message);
    }
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    this.state.updatedAt = Date.now();
    this.recompute();
    const snapshot = this.state;
    for (const fn of this.listeners) fn(snapshot);
    this.save();
  }

  driver(id) {
    return this.state.drivers.find((d) => d.id === id) || null;
  }

  // ---------- timing math ----------

  raceClock(now = Date.now()) {
    const r = this.state.race;
    if (!r.startedAt) return 0;
    const end = r.finishedAt || r.pausedAt || now;
    return Math.max(0, end - r.startedAt - r.pausedTotal);
  }

  recompute() {
    const { drivers, race, event } = this.state;

    for (const d of drivers) {
      d.lapsDone = d.crossings.length;
      d.lapTimes = [];
      for (let i = 0; i < d.crossings.length; i++) {
        const prev = i === 0 ? race.startedAt : d.crossings[i - 1];
        if (prev == null) continue;
        d.lapTimes.push(d.crossings[i] - prev);
      }
      // A crossing can carry a timestamp fractionally before the green flag — the
      // detector interpolates between frames, and the operator may hit Start a moment
      // after the cars are already rolling. That yields a negative lap time, and a
      // single one used to poison bestLap, the session record and the overlay for the
      // rest of the race. Only real durations count.
      const valid = d.lapTimes.filter((ms) => ms > 0);
      d.lastLap = valid.length ? valid[valid.length - 1] : null;
      d.bestLap = valid.length ? Math.min(...valid) : null;
      const base = d.crossings.length && race.startedAt
        ? d.crossings[d.crossings.length - 1] - race.startedAt
        : 0;
      // Only penalties actually handed down count. An investigation still open must not
      // move anyone on the timing screen — that is the whole point of announcing one.
      const served = (race.penalties || [])
        .filter((p) => p.driverId === d.id && p.status === 'applied' && p.type === 'time')
        .reduce((n, p) => n + (p.seconds || 0), 0);
      d.penaltyPending = (race.penalties || [])
        .some((p) => p.driverId === d.id && p.status === 'investigating');
      // Derived, not stored: a black flag is a standing instruction that lasts exactly as
      // long as the decision behind it, so it is read from the decisions every time.
      d.blackFlag = (race.penalties || [])
        .some((p) => p.driverId === d.id && p.status === 'applied' &&
                     (p.type === 'blackflag' || p.type === 'dq') && !p.served);
      d.penaltyServed = served;
      d.totalMs = base + (d.penaltySec + served) * 1000;
    }

    // How far round the lap each car should be by now, from its own recent pace.
    // Vision-derived progress, when there is any, always wins: it is measured.
    const now = this.now();
    const racing = race.status === 'green' && race.startedAt;
    for (const d of drivers) {
      // Last lap, not best: prediction should follow the pace the car is running now,
      // not the pace it managed once. Using the best lap makes every car look faster
      // than it is and the order flickers as reality fails to keep up.
      const pace = (d.lastLap > 0 && d.lastLap) || (d.bestLap > 0 && d.bestLap) || null;
      const from = d.crossings[d.crossings.length - 1] ?? race.startedAt;
      if (!racing || !pace || !from || d.dnf || d.finished) {
        d.predicted = false;
        d.livePos = d.lapsDone + (d.progress || 0);
        continue;
      }
      /*
       * A measurement plus however far the car must have travelled since it was taken.
       *
       * The obvious version of this — trust the measurement for a few seconds, then
       * switch to a pace estimate — has two discontinuities, and a race is decided in
       * the gaps between them. While the measurement is held, the car's position is
       * frozen although time is passing, so a car that is briefly unseen is passed by
       * one that is not; when the hold expires, the estimate jumps from the frozen
       * value to a pace-based one computed from the start of the lap, which is several
       * percent of a lap away because a car crawls through a hairpin and flies down the
       * straight while the estimate is linear in time. Both jumps reverse a second
       * later. Measured on two cars half a second apart: 14 order changes and 14
       * phantom overtakes in a minute, each firing a green sweep on one row and a red
       * on the other.
       *
       * Extrapolating from the last measurement removes both. At the instant of the
       * measurement the estimate equals it exactly, and from there it advances at the
       * car's own pace — so losing sight of a car changes nothing about its reported
       * position, only how confident that position is.
       */
      const age = d.trackedAt ? now - d.trackedAt : Infinity;
      const usable = age < 3000 && d.progress > 0 && d.trackedAt >= from;
      if (usable) {
        const drift = age / pace;
        // cap just under a full lap: a car cannot gain a lap without crossing the line
        d.livePos = d.lapsDone + Math.min(0.995, d.progress + drift);
        // Only call it predicted once the extrapolation is doing real work; a reading
        // one frame old is a measurement, and marking it inferred would put a tilde
        // against every car on the timing tower for ever.
        d.predicted = race.predictOrder !== false && drift > 0.004;
      } else {
        /*
         * No live measurement of where this car is (no camera, or its reading is stale).
         *
         * With a single timing line — a finish line and nothing else — there is genuinely no
         * way to know where a car is between crossings, and guessing from its lap pace only
         * reshuffles the order by lap time, which is not track position at all. So do not
         * guess: the car sits at the lap it has completed, and its place only moves when it
         * actually crosses the line. Same-lap cars then fall through to crossing order below.
         * A pace guess is used only when the operator has explicitly asked to predict the
         * order (predictOrder), for setups that want it.
         */
        if (race.predictOrder === true) {
          const guess = Math.min(0.995, (now - from) / pace);
          d.predicted = guess > 0;
          d.livePos = d.lapsDone + (d.predicted ? guess : 0);
        } else {
          d.predicted = false;
          d.livePos = d.lapsDone + (d.progress || 0);
        }
      }
    }

    const isQuali = event.sessionType === 'qualifying' || event.sessionType === 'practice';
    const isDrift = event.sessionType === 'drift';

    /*
     * Where each car starts. Infinity for anyone not on the grid, so a late entry lines
     * up behind the field rather than jumping to the front on a zero.
     */
    const grid = race.grid || [];
    const gridAt = (d) => {
      const i = grid.indexOf(d.id);
      return i < 0 ? Infinity : i;
    };
    // Before the flag there is nothing to measure, so the grid is the order — not the
    // roster, and not whatever the detector happens to see on the dummy grid.
    const preRace = !isDrift && !isQuali && grid.length &&
      (race.status === 'idle' || race.status === 'formation');

    const ranked = [...drivers].sort((a, b) => {
      if (a.dnf !== b.dnf) return a.dnf ? 1 : -1;
      if (isDrift) return b.driftScore - a.driftScore;
      if (preRace) {
        const g = gridAt(a) - gridAt(b);
        if (g !== 0) return g;
      }
      if (isQuali) {
        if (a.bestLap == null && b.bestLap == null) return 0;
        if (a.bestLap == null) return 1;
        if (b.bestLap == null) return -1;
        return a.bestLap - b.bestLap;
      }
      /*
       * Once the flag is out, the classification is the result — and a time penalty is
       * part of the result, not part of the race. While the cars are running they are
       * ranked where they physically are: a driver carrying five seconds is still ahead
       * on the road, and showing them demoted before the end would be wrong on the
       * broadcast and wrong in the pit lane. The tower carries a pending-penalty badge so
       * nobody mistakes the live order for the final one.
       */
      if (race.status === 'finished' && a.totalMs !== b.totalMs) return a.totalMs - b.totalMs;

      // Same lap count: whoever is further round it is ahead. That is the only way an
      // overtake between two timing points can show up at all.
      if (a.lapsDone === b.lapsDone) {
        const d = (b.livePos || 0) - (a.livePos || 0);
        if (Math.abs(d) > 1e-6) return d;
        if (a.totalMs !== b.totalMs) return a.totalMs - b.totalMs;
        // still level: the grid is the last word, so the order never wobbles on a tie
        return gridAt(a) - gridAt(b);
      }
      if (a.lapsDone !== b.lapsDone) return b.lapsDone - a.lapsDone;
      if (a.totalMs !== b.totalMs) return a.totalMs - b.totalMs;
      return gridAt(a) - gridAt(b);
    });

    /*
     * Hold the order still until a change is worth believing.
     *
     * Two cars nose to tail are ranked by values that are not measured the same way:
     * one car may have been seen this frame while the other was last seen a second ago
     * and has been extrapolated since. Those two quantities disagree by a few percent
     * of a lap and the disagreement changes sign as each car is seen and lost, so the
     * pair trade places again and again without either of them overtaking anything.
     * Nothing about the estimate removes this — a measurement and an extrapolation are
     * genuinely not comparable at that precision — so the order itself is what has to
     * be damped.
     *
     * Only pairs involving an extrapolated position are held, and only while they are
     * closer together than the margin. Two cars both being seen right now are ranked on
     * what the detector actually reports, and a real overtake opens a gap far wider
     * than this margin within a second of happening.
     */
    /*
     * Not before the flag.
     *
     * The damping exists because a measured position and an extrapolated one are not
     * comparable at close quarters. On the grid nothing is being measured at all — every
     * car has zero laps and zero elapsed time — so every pair is inside the margin and
     * the order would freeze at whatever it happened to be first, ignoring the grid
     * entirely. There is nothing to damp until the cars are running.
     */
    /*
     * Nor after it. The damping exists to stop a live estimate flickering; the final
     * classification is arithmetic on finished laps and served penalties, with nothing
     * uncertain left in it. Holding the previous order there would keep a penalised car
     * ahead of the driver it was penalised for.
     */
    if (this.prevPos && !isQuali && !isDrift && !preRace && race.status !== 'finished') {
      const MARGIN = 0.08;                       // fractions of a lap
      const prev = this.prevPos;
      /*
       * Staleness, not the predicted flag, is what makes two positions incomparable.
       *
       * A car has no pace to extrapolate from until it has completed a lap, so on the
       * opening lap nothing is ever marked predicted — the last reading simply sits
       * there, frozen, while the clock runs. That is the worst case for ordering and it
       * was the one the flag left unguarded: every flicker measured in the reproduction
       * happened on lap one.
       */
      const stale = (d) => !d.trackedAt || (now - d.trackedAt) > 250;
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < ranked.length - 1; i++) {
          const a = ranked[i], b = ranked[i + 1];
          if (a.lapsDone !== b.lapsDone || a.dnf !== b.dnf) continue;
          if (!a.predicted && !b.predicted && !stale(a) && !stale(b)) continue;
          const pa = prev.get(a.id), pb = prev.get(b.id);
          if (pa == null || pb == null || pb >= pa) continue;   // b was not ahead
          if (Math.abs((a.livePos || 0) - (b.livePos || 0)) >= MARGIN) continue;
          ranked[i] = b;
          ranked[i + 1] = a;
        }
      }
    }

    // Manual mode: on a low-spec machine with no vision, the operator owns the order. When
    // it is on, the computed ranking above is discarded and the field is arranged by the
    // operator's manualOrder list instead (anyone not in it sinks to the back, keeping their
    // computed order among themselves).
    if (race.manual && Array.isArray(race.manualOrder) && race.manualOrder.length) {
      const idx = new Map(race.manualOrder.map((id, i) => [id, i]));
      ranked.sort((a, b) => (idx.has(a.id) ? idx.get(a.id) : 1e9) - (idx.has(b.id) ? idx.get(b.id) : 1e9));
    }

    /*
     * External timing feed. An authoritative snapshot of rank, lap count and best lap, coming
     * either from OCR of the in-game leaderboard or, later, from FR Legends' official Tournament
     * Timing API. When one is present and fresh it owns the classification: the field is ordered
     * by the feed's rank, and each driver's laps and best lap are taken from the feed rather than
     * derived from crossings. Drivers the feed does not mention keep their computed order behind.
     */
    const ext = race.ext;
    const extActive = ext && race.extAt && (now - race.extAt) < 15000 && Object.keys(ext).length > 0;
    const extRace = extActive && race.extMode === 'race';
    // Gaps measured at the line by the feed (race mode only). Cleared otherwise, so a stale
    // value can never outlive the feed that produced it.
    for (const d of drivers) d.extLine = null;
    if (extActive) {
      for (const d of drivers) {
        const e = ext[d.id];
        if (!e) { d.extRank = null; continue; }
        if (extRace) {
          d.extLine = { gapMs: e.gapMs, gapLaps: e.gapLaps, intMs: e.intMs, intLaps: e.intLaps };
          if (e.totalMs != null) d.totalMs = e.totalMs;
        }
        if (e.laps != null) d.lapsDone = e.laps;
        if (e.bestMs != null && e.bestMs > 0) d.bestLap = e.bestMs;
        if (e.lastMs != null && e.lastMs > 0) d.lastLap = e.lastMs;
        // Sector splits from the feed: the last lap's splits for the tower, the per-sector
        // personal bests for green, and the session best per sector for purple. Applying the
        // same values every tick is harmless: the bests are minima and the display just
        // reflects the last lap.
        if (Array.isArray(e.sectors)) d.sectors = e.sectors;
        if (Array.isArray(e.bestSectors)) {
          d.bestSectors = e.bestSectors;
          for (let i = 0; i < e.bestSectors.length; i++) {
            const ms = e.bestSectors[i];
            if (!(ms > 0)) continue;
            const rec = this.state.records.bestSectors[i];
            if (!rec || ms < rec.ms) this.state.records.bestSectors[i] = { ms, driverId: d.id };
          }
        }
        d.extRank = e.rank;
      }
      ranked.sort((a, b) => ((a.extRank ?? 1e9) - (b.extRank ?? 1e9)));
    }

    // Shared with the hosted event rather than written twice: see public/js/timing.js.
    // A best-lap feed (qualifying, practice, the in-game board) is labelled best-lap style,
    // like qualifying. A race-mode feed brings its own gaps, measured at the line.
    labelGaps(ranked, { drift: isDrift, quali: isQuali || (extActive && !extRace) });
    const leader = ranked[0];

    // Overtakes: compare against the previous classification and log real swaps only
    // (a driver retiring or being added shifts everyone, which is not an overtake).
    if (this.prevPos && race.status === 'green') {
      for (const d of ranked) {
        const before = this.prevPos.get(d.id);
        if (before == null || before <= d.position || d.dnf) continue;
        const passed = ranked.find((x) => this.prevPos.get(x.id) === d.position && x.position === before);
        if (passed) this.pushFeed('overtake', `${d.name} PASSES ${passed.name} FOR P${d.position}`, d.id);
      }
    }
    this.prevPos = new Map(ranked.map((d) => [d.id, d.position]));

    this.autoFlags(race, drivers, leader, isQuali, isDrift);

    /*
     * The table is computed here, once, and shipped with the state. Working it out
     * separately in the panel and in the overlay would eventually produce two different
     * answers, and a championship table that disagrees with itself on screen is worse
     * than not showing one.
     */
    this.state.standings = this.standings();
  }

  /**
   * Raise and clear flags from what the tracker can see.
   *
   * Deliberately narrow. Three situations are unambiguous in the data — a car stopped
   * away from the pits, several stopped at once, and the leader reaching the distance —
   * and each maps onto exactly one flag. Everything else a real race director calls
   * needs eyes on the incident, so it stays a button.
   */
  autoFlags(race, drivers, leader, isQuali, isDrift) {
    const now = this.now();
    const rules = race.flags || {};

    // chequered: the one flag that is pure arithmetic
    if (rules.chequered !== false && race.status === 'green' && !isQuali && !isDrift &&
        race.totalLaps > 0 && leader && leader.lapsDone >= race.totalLaps) {
      race.status = 'finished';
      race.finishedAt = now;
      race.flagSource = 'auto';
      for (const d of drivers) if (d.lapsDone >= race.totalLaps) d.finished = true;
      this.pushFeed('flag', 'CHEQUERED FLAG');
      return;
    }

    /*
     * Blue flags are per car, not per session, so they are computed even when the
     * session flag is doing nothing. A car within a tenth of a lap of being lapped is
     * being caught; the exact threshold matters less than being consistent about it.
     */
    if (rules.blue !== false && leader && race.status === 'green') {
      for (const d of drivers) {
        d.blueFlag = d !== leader && !d.dnf && !d.finished &&
          (leader.livePos || 0) - (d.livePos || 0) >= 0.9;
      }
    } else {
      for (const d of drivers) d.blueFlag = false;
    }

    /*
     * A drive-through nobody serves.
     *
     * This is the one escalation the system can work out for itself: the lap a penalty
     * was issued on is recorded, the current lap count is known, and "still not served
     * three laps later" is arithmetic rather than judgement. Everything else that earns a
     * black flag — ignoring marshals, dangerous driving — needs a person watching.
     */
    const unservedLaps = Math.max(0, rules.blackFlagUnserved || 0);
    if (unservedLaps && race.status !== 'finished') {
      for (const p of race.penalties || []) {
        if (p.status !== 'applied' || p.served || p.type !== 'drivethrough') continue;
        if (p.escalated) continue;
        const d = this.driver(p.driverId);
        if (!d || d.dnf || d.finished) continue;
        if (d.lapsDone - (p.lap || 0) < unservedLaps) continue;
        p.escalated = true;
        this.apply({
          type: 'penalty.add', driverId: d.id, kind: 'blackflag',
          reason: `Drive-through not served in ${unservedLaps} laps`, auto: true
        });
      }
    }

    if (!rules.auto || isQuali || isDrift) return;
    // A person has taken control of the flag. Leave it alone until they hand it back.
    if (race.flagSource === 'operator') return;
    if (!['green', 'yellow', 'vsc', 'red'].includes(race.status)) return;

    const stopped = drivers.filter((d) => d.stopped && !d.pit && !d.dnf && !d.finished);
    const neutral = rules.stoppedRaises === 'vsc' ? 'vsc' : 'yellow';
    const want = stopped.length >= Math.max(2, rules.redStoppedCount || 3) ? 'red'
      : (stopped.length >= 1 && rules.yellowOnStopped !== false) ? neutral
      : 'green';

    if (want !== 'green') {
      race.clearSince = null;
      if (race.status === want) return;
      // never drop a red back to a neutralisation on its own: an incident that warranted
      // stopping the race is over when a person says it is
      if (race.status === 'red' && want !== 'red') return;
      race.status = want;
      race.flagSource = 'auto';
      const who = stopped.map((d) => d.name).join(', ');
      this.pushFeed('flag', want === 'red'
        ? `RED FLAG — ${stopped.length} CARS STOPPED`
        : `${want === 'vsc' ? 'VIRTUAL SAFETY CAR' : 'YELLOW FLAG'} — ${who} STOPPED ON TRACK`);
      return;
    }

    if (race.status === 'green') { race.clearSince = null; return; }
    /*
     * Hold before going back to green. The track being clear for one update is not the
     * same as the incident being over — a car can register as moving for a moment while
     * it is being recovered — and a flag that flickers is worse than one that lingers.
     */
    if (!race.clearSince) { race.clearSince = now; return; }
    if (now - race.clearSince < Math.max(1, rules.greenAfterSec || 5) * 1000) return;
    race.status = 'green';
    race.flagSource = 'auto';
    race.clearSince = null;
    this.pushFeed('flag', 'TRACK CLEAR — GREEN FLAG');
  }

  /** Newest-first log of things worth putting on screen or in the ticker. */
  // ---------- championship ----------

  /**
   * Score one classification into round results.
   *
   * Points are frozen at the moment the round is added, not recomputed from the current
   * scoring table. Changing the table halfway through a season and silently rewriting
   * every past round is how a championship loses its credibility; if the table really
   * must change, the operator rescores the round deliberately.
   */
  scoreRound(rows) {
    return scoreRows(rows, this.state.championship.points);
  }

  /**
   * The table, from every round scored so far.
   *
   * Ties are broken by countback — most wins, then most seconds, and so on — which is how
   * every real series settles them. Total points alone would leave two drivers level with
   * nothing to separate them, and a championship that ends in a shrug is worse than one
   * decided by a rule nobody likes.
   */
  standings() {
    const champ = this.state.championship;
    return standingsFrom(champ.rounds, champ.points);
  }

  // ---------- scenes ----------

  /**
   * The scenes an event actually runs through, created once and then owned by the
   * operator.
   *
   * Seeded rather than hardcoded: after the first run these are ordinary data, so a
   * scene can be renamed, reordered or deleted like anything else. The race scene
   * inherits whatever layout already existed, because an operator who has spent an
   * evening positioning widgets should not lose that to an upgrade.
   */
  ensureScenes() {
    const o = this.state.overlay;
    if (Array.isArray(o.scenes) && o.scenes.length) {
      if (!o.scenes.some((sc) => sc.id === o.activeScene)) o.activeScene = o.scenes[0].id;
      this.syncScene();
      return;
    }
    o.scenes = defaultScenes();
    if (!o.scenes.some((sc) => sc.id === o.activeScene)) o.activeScene = 'race';
    this.syncScene();
  }

  scene(id = this.state.overlay.activeScene) {
    return (this.state.overlay.scenes || []).find((sc) => sc.id === id) || null;
  }

  /** Mirror the active scene out to the fields every reader already uses. */
  syncScene() {
    const o = this.state.overlay;
    const sc = this.scene();
    if (!sc) return;
    o.show = { ...defaultState().overlay.show, ...(sc.show || {}) };
    o.layout = { ...(sc.layout || {}) };
  }

  // ---------- tandem battles ----------

  /**
   * Seed positions in bracket order, so the top two qualifiers can only meet in the
   * final. Built by repeatedly reflecting the previous round: [1,2] becomes [1,4,2,3],
   * then [1,8,4,5,2,7,3,6]. Consecutive pairs are the first-round matches.
   */
  static seedOrder(size) {
    let arr = [1, 2];
    while (arr.length < size) {
      const total = arr.length * 2 + 1;
      const next = [];
      for (const s of arr) next.push(s, total - s);
      arr = next;
    }
    return arr;
  }

  static roundName(pairs) {
    if (pairs === 1) return 'FINAL';
    if (pairs === 2) return 'SEMI FINAL';
    if (pairs === 4) return 'GREAT 8';
    if (pairs === 8) return 'TOP 16';
    if (pairs === 16) return 'TOP 32';
    return `ROUND OF ${pairs * 2}`;
  }

  /** Order the qualifying board: best run first, unscored drivers last. */
  qualifyingOrder() {
    const q = this.state.drift.qualifying;
    return [...q]
      .filter((e) => this.driver(e.driverId))
      .sort((a, b) => (b.best ?? -1) - (a.best ?? -1));
  }

  /**
   * Lay out the knockout from the qualifying board.
   *
   * Seats beyond the number of qualified drivers are byes rather than an error: a local
   * event rarely fills a 16-car bracket exactly, and making the operator pad the entry
   * list with ghosts would be worse than advancing the seeded driver automatically.
   */
  buildBracket() {
    const d = this.state.drift;
    const size = [4, 8, 16, 32].includes(d.format.bracketSize) ? d.format.bracketSize : 16;
    const seeded = this.qualifyingOrder().slice(0, size);
    if (seeded.length < 2) return false;

    const order = RaceState.seedOrder(size);
    const pairs = [];
    for (let i = 0; i < order.length; i += 2) {
      const a = seeded[order[i] - 1];
      const b = seeded[order[i + 1] - 1];
      pairs.push({
        a: a ? a.driverId : null,
        b: b ? b.driverId : null,
        // a lone entrant walks the round rather than waiting for an opponent
        winner: a && !b ? a.driverId : (b && !a ? b.driverId : null),
        omt: 0
      });
    }

    d.bracket = [{ name: RaceState.roundName(pairs.length), pairs }];
    d.battle = null;
    d.champion = null;
    this.growBracket();
    this.pushFeed('battle', `BRACKET SET — ${d.bracket[0].name}`);
    return true;
  }

  /** Add the next round once the current one is decided, or crown the winner. */
  growBracket() {
    const d = this.state.drift;
    while (d.bracket.length) {
      const last = d.bracket[d.bracket.length - 1];
      if (last.pairs.some((p) => !p.winner)) return;
      if (last.pairs.length === 1) {
        const champ = last.pairs[0].winner;
        if (champ && d.champion !== champ) {
          d.champion = champ;
          const w = this.driver(champ);
          if (w) this.pushFeed('battle', `${w.name} WINS THE EVENT`, champ);
        }
        return;
      }
      const pairs = [];
      for (let i = 0; i < last.pairs.length; i += 2) {
        const a = last.pairs[i].winner;
        const b = last.pairs[i + 1] ? last.pairs[i + 1].winner : null;
        pairs.push({ a, b, winner: a && !b ? a : (b && !a ? b : null), omt: 0 });
      }
      d.bracket.push({ name: RaceState.roundName(pairs.length), pairs });
    }
  }

  /**
   * Turn the judges' votes into a result.
   *
   * A majority decides. Anything else — a tie, or the judges themselves calling it too
   * close — is One More Time, which is the honest answer and the one the crowd wants.
   * After maxOmt reruns a decision has to be forced, because an event cannot loop.
   */
  decideBattle() {
    const d = this.state.drift;
    const b = d.battle;
    if (!b) return false;

    const votes = b.votes.filter((v) => v);
    if (votes.length < d.format.judges) return false;

    const count = (who) => votes.filter((v) => v === who).length;
    const need = Math.floor(d.format.judges / 2) + 1;
    let winner = null;
    if (count('a') >= need) winner = b.a;
    else if (count('b') >= need) winner = b.b;

    const pair = d.bracket[b.round] && d.bracket[b.round].pairs[b.pair];
    if (!pair) return false;

    if (!winner) {
      if (pair.omt >= d.format.maxOmt) {
        // forced: whoever has more votes, and the leader on qualifying if still level
        const qa = this.qualifyingOrder().findIndex((e) => e.driverId === b.a);
        const qb = this.qualifyingOrder().findIndex((e) => e.driverId === b.b);
        winner = count('a') > count('b') ? b.a
          : count('b') > count('a') ? b.b
          : (qa >= 0 && (qb < 0 || qa < qb)) ? b.a : b.b;
      } else {
        pair.omt += 1;
        b.omt = pair.omt;
        b.votes = new Array(d.format.judges).fill(null);
        b.run = 1;
        b.lead = 'a';
        b.status = 'running';
        const A = this.driver(b.a), B = this.driver(b.b);
        this.pushFeed('battle', `ONE MORE TIME — ${A ? A.name : '?'} vs ${B ? B.name : '?'}`);
        return true;
      }
    }

    pair.winner = winner;
    b.status = 'decided';
    b.winner = winner;
    const w = this.driver(winner);
    const l = this.driver(winner === b.a ? b.b : b.a);
    if (w) this.pushFeed('battle', `${w.name} BEATS ${l ? l.name : '?'}`, winner);
    this.growBracket();
    return true;
  }

  /** How a decision reads on the timing screen and in the feed. */
  /**
   * What the penalty is, without why.
   *
   * Split out from penaltyText so a driver's phone can put this in a notification title
   * and the reason in the body without inventing its own wording. Two places describing
   * the same penalty differently is how a driver ends up arguing with a steward about
   * what they were actually given.
   */
  penaltyHeadline(p) {
    if (p.type === 'time') return `+${p.seconds}s PENALTY`;
    if (p.type === 'blackflag') return 'BLACK FLAG';
    if (p.type === 'drivethrough') return 'DRIVE THROUGH';
    if (p.type === 'dq') return 'DISQUALIFIED';
    if (p.type === 'warning') return 'WARNING';
    return 'NOTE';
  }

  penaltyText(p) {
    if (p.type === 'note') return p.reason;
    return `${this.penaltyHeadline(p)} — ${p.reason}`;
  }

  pushFeed(kind, text, driverId = null) {
    const t = Date.now();
    this.state.feed = [{ t, kind, text, driverId }, ...(this.state.feed || [])].slice(0, 60);
    /*
     * The same event, kept uncapped while recording. Hooking it here rather than at each
     * call site means every kind of event that already announces itself becomes a marker
     * for free, including ones added later.
     */
    const rec = this.state.recording;
    if (rec && rec.startedAt && t >= rec.startedAt) {
      rec.markers.push({ t, kind, text, driverId, manual: false });
      if (rec.markers.length > 4000) rec.markers.splice(0, rec.markers.length - 4000);
    }
  }

  /** Record a split and promote it to a personal / session best where it applies. */
  noteSector(d, index, ms) {
    if (!(ms > 0)) return;
    const pb = d.bestSectors[index];
    if (pb == null || ms < pb) d.bestSectors[index] = ms;

    const rec = this.state.records.bestSectors[index];
    if (!rec || ms < rec.ms) {
      this.state.records.bestSectors[index] = { ms, driverId: d.id };
      this.pushFeed('sector', `${d.name} — FASTEST S${index + 1} ${fmtGap(ms)}`, d.id);
    }
  }

  noteLap(d, at) {
    const prev = d.crossings[d.crossings.length - 2] ?? this.state.race.startedAt;
    const lapMs = at - prev;
    const rec = this.state.records.bestLap;
    if (lapMs > 0 && (rec.ms == null || lapMs < rec.ms)) {
      this.state.records.bestLap = { ms: lapMs, driverId: d.id, lap: d.crossings.length };
      this.pushFeed('fastest', `${d.name} — FASTEST LAP ${fmtGap(lapMs)}`, d.id);
    }
  }

  // ---------- actions ----------

  apply(action) {
    const a = action || {};
    const s = this.state;
    const now = Date.now();

    // Snapshot before mutating, for undoable actions. Popped again if the action turns out
    // to be unknown (the default branch), so an unrecognised type leaves no phantom step.
    const tracked = a.type && !NO_HISTORY.has(a.type);
    if (tracked) {
      this.history.push(this._clone(s));
      if (this.history.length > 25) this.history.shift();
    }

    switch (a.type) {
      case 'history.undo': {
        const prev = this.history.pop();
        if (!prev) return false;   // nothing to undo — no emit, no-op
        this.state = prev;
        break;
      }

      case 'event.update':
        Object.assign(s.event, a.patch || {});
        // Practice and qualifying run to a clock. Give them a sensible default length the
        // moment they are chosen, so the tower shows a real countdown instead of counting
        // up from zero with no target. The operator can still change it.
        if (a.patch && ['practice', 'qualifying', 'endurance'].includes(a.patch.sessionType)
            && !(s.race.timeLimitSec > 0)) {
          s.race.timeLimitSec = a.patch.sessionType === 'endurance' ? 3600 : 900;
        }
        break;

      case 'race.config':
        Object.assign(s.race, pick(a.patch || {}, ['totalLaps', 'timeLimitSec', 'predictOrder']));
        break;

      case 'race.start':
        s.race.startedAt = a.at || now;
        s.race.finishedAt = null;
        s.race.pausedAt = null;
        s.race.pausedTotal = 0;
        s.race.status = 'green';
        // A new session hands the flag back to the automation: whatever the operator
        // overruled last time was about the last race.
        s.race.flagSource = 'auto';
        s.race.clearSince = null;
        for (const d of s.drivers) resetDriverTiming(d, s.race.startedAt);
        s.records = { bestLap: { ms: null, driverId: null, lap: null }, bestSectors: [] };
        s.feed = [];
        // Clearing it on the scene, not on the mirror: the mirror is rebuilt from the
        // scene on the next sync, so a write there would be silently undone.
        {
          const sc = this.scene();
          if (sc) sc.show.results = false;
          this.syncScene();
        }
        this.pushFeed('flag', 'GREEN FLAG — RACE START');
        break;

      case 'race.flag': { // green | yellow | safety | red | formation | finished
        const flag = a.flag;
        if (flag === 'red' && s.race.status === 'green') {
          s.race.pausedAt = now;
        } else if (s.race.status === 'red' && flag === 'green' && s.race.pausedAt) {
          s.race.pausedTotal += now - s.race.pausedAt;
          s.race.pausedAt = null;
        }
        s.race.status = flag;
        // A human has taken the flag. From here the automation stops interfering until
        // it is handed back, because being overruled by software one second after making
        // a call is the fastest way to stop trusting it.
        s.race.flagSource = 'operator';
        s.race.clearSince = null;
        if (flag === 'finished') {
          s.race.finishedAt = now;
          // Qualifying decides the grid: on the chequered flag the grid is set to the
          // best-lap order, so the race that follows lines up by it.
          if ((s.event.sessionType || 'race') === 'qualifying') {
            s.race.grid = [...s.drivers].sort((a, b) => {
              if (a.bestLap == null && b.bestLap == null) return 0;
              if (a.bestLap == null) return 1;
              if (b.bestLap == null) return -1;
              return a.bestLap - b.bestLap;
            }).map((d) => d.id);
          }
        }
        break;
      }

      case 'race.reset':
        s.race.startedAt = null;
        s.race.finishedAt = null;
        s.race.pausedAt = null;
        s.race.pausedTotal = 0;
        s.race.status = 'idle';
        for (const d of s.drivers) resetDriverTiming(d, null);
        s.records = { bestLap: { ms: null, driverId: null, lap: null }, bestSectors: [] };
        s.feed = [];
        break;

      case 'driver.add':
        s.drivers.push(makeDriver(a.driver || {}, s.drivers.length));
        break;

      case 'driver.update': {
        const d = this.driver(a.id);
        if (d) {
          Object.assign(d, pick(a.patch || {}, [
            'num', 'name', 'short', 'team', 'color', 'car', 'carClass', 'photo',
            'pit', 'dnf', 'retired', 'penaltySec', 'driftScore', 'progress'
          ]));
          // Keep the invariant: retired implies out, and clearing out clears retired.
          if (d.retired) d.dnf = true;
          if (!d.dnf) d.retired = false;
        }
        break;
      }

      case 'driver.progressBatch': {
        // vision pushes every tracked car's lap progress at a low rate, in one message
        for (const [id, progress] of Object.entries(a.map || {})) {
          const d = this.driver(id);
          if (d) d.progress = progress;
        }
        break;
      }

      case 'driver.remove':
        s.drivers = s.drivers.filter((d) => d.id !== a.id);
        break;

      case 'driver.reorder': {
        const order = a.ids || [];
        s.drivers.sort((x, y) => order.indexOf(x.id) - order.indexOf(y.id));
        break;
      }

      // ---------- manual mode: order and laps set by hand, for a no-vision setup ----------
      case 'manual.mode': {
        s.race.manual = !!a.on;
        if (s.race.manual && (!s.race.manualOrder || !s.race.manualOrder.length)) {
          // seed from whatever order is on screen right now, so turning it on changes nothing
          s.race.manualOrder = [...s.drivers].sort((x, y) => (x.position || 99) - (y.position || 99)).map((d) => d.id);
        }
        break;
      }

      case 'manual.reorder': {   // full order from a drag, position 1 first
        if (Array.isArray(a.order)) s.race.manualOrder = a.order.filter((id) => this.driver(id));
        break;
      }

      case 'manual.move': {      // nudge one driver up (-1) or down (+1)
        const ord = s.race.manualOrder || (s.race.manualOrder = [...s.drivers].map((d) => d.id));
        const i = ord.indexOf(a.id);
        const j = i + (a.delta || 0);
        if (i >= 0 && j >= 0 && j < ord.length) { const t = ord[i]; ord[i] = ord[j]; ord[j] = t; }
        break;
      }

      case 'manual.lap': {       // add a lap; an explicit ms sets the lap time, else it's live
        const d = this.driver(a.id);
        if (!d) break;
        if (!s.race.startedAt) s.race.startedAt = now;   // a manual session still needs a clock origin
        const prev = d.crossings[d.crossings.length - 1] ?? s.race.startedAt;
        const ms = Number(a.ms) > 0 ? Number(a.ms) : null;
        d.crossings.push(ms ? prev + ms : now);
        break;
      }

      case 'manual.unlap': {     // remove this driver's last lap
        const d = this.driver(a.id);
        if (d && d.crossings.length) d.crossings.pop();
        break;
      }

      case 'manual.setLaps': {   // set a driver's completed-lap count directly to N
        const d = this.driver(a.id);
        if (!d) break;
        const target = Math.max(0, Math.floor(Number(a.laps) || 0));
        if (!s.race.startedAt && target > 0) s.race.startedAt = now;
        const cur = d.crossings.length;
        if (target > cur) {
          // Pad with crossings spaced by this driver's own recent pace, so lap times stay
          // sensible; the count is what matters, the spacing is a best guess.
          const lap = (d.lastLap > 0 && d.lastLap) || (d.bestLap > 0 && d.bestLap) || 90000;
          let tprev = cur ? d.crossings[cur - 1] : s.race.startedAt;
          for (let i = cur; i < target; i++) { tprev += lap; d.crossings.push(tprev); }
        } else if (target < cur) {
          d.crossings.length = target;   // trim extra laps
        }
        break;
      }

      case 'manual.setPos': {    // jump a driver to a given position (1-based) in the manual order
        if (!s.race.manual) break;
        const ord = s.race.manualOrder || (s.race.manualOrder = [...s.drivers].map((d) => d.id));
        const i = ord.indexOf(a.id);
        if (i < 0) break;
        const to = Math.max(0, Math.min(ord.length - 1, (Math.floor(Number(a.pos) || 1) - 1)));
        ord.splice(i, 1);
        ord.splice(to, 0, a.id);
        break;
      }

      case 'manual.lapAll': {    // add one lap to every running driver at once
        if (!s.race.startedAt) s.race.startedAt = now;
        for (const d of s.drivers) {
          if (d.dnf || d.finished) continue;
          d.crossings.push(now);
        }
        break;
      }

      case 'manual.dnf': {
        // With no `on`, one control cycles the three states: running -> DNF -> Retired ->
        // running. `on` still forces a plain DNF on/off, so older callers keep working.
        const d = this.driver(a.id);
        if (d) {
          if (a.on !== undefined) { d.dnf = !!a.on; if (!d.dnf) d.retired = false; }
          else if (!d.dnf) { d.dnf = true; d.retired = false; }   // running -> DNF
          else if (!d.retired) { d.retired = true; }              // DNF -> Retired
          else { d.dnf = false; d.retired = false; }              // Retired -> running
        }
        break;
      }

      case 'timing.external': {
        // An authoritative standings snapshot from an outside source (OCR of the in-game
        // leaderboard, or the official timing API). rows: [{driverId, rank, laps, bestMs, lastMs}].
        // recompute() reads race.ext while it is fresh and lets it own the order.
        const rows = Array.isArray(a.rows) ? a.rows : [];
        const num = (v) => (v == null ? null : Number(v));
        // 'race' when the feed ordered the field by laps and line crossings (the timing API
        // during a race session); 'best' for a best-lap board (qualifying, practice, OCR).
        s.race.extMode = a.mode === 'race' ? 'race' : 'best';
        s.race.ext = {};
        for (const r of rows) {
          if (!r || !r.driverId) continue;
          s.race.ext[r.driverId] = {
            rank: Number(r.rank) || null,
            laps: num(r.laps),
            bestMs: num(r.bestMs),
            lastMs: num(r.lastMs),
            sectors: Array.isArray(r.sectors) ? r.sectors.map(Number) : null,
            bestSectors: Array.isArray(r.bestSectors) ? r.bestSectors.map(Number) : null,
            totalMs: num(r.totalMs),
            gapMs: num(r.gapMs), gapLaps: Number(r.gapLaps) || 0,
            intMs: num(r.intMs), intLaps: Number(r.intLaps) || 0
          };
        }
        s.race.extAt = now;
        break;
      }

      case 'lap.record':   // operator hotkey / REST hook — same path as a detected crossing
        return this.apply({ ...a, type: 'timing.cross', kind: 'finish', minLapMs: a.minLapMs ?? 4000 });

      case 'timing.cross': {
        // One entry point for every timing line the vision engine sees. The server
        // owns ordering and debouncing so a noisy detector can never corrupt timing.
        const d = this.driver(a.driverId);
        if (!d || !s.race.startedAt || s.race.status === 'idle') break;
        const at = a.at || now;
        const sectorLines = (s.calibration.lines || []).filter((l) => l.kind === 'sector').length;
        const totalSectors = sectorLines + 1;
        const from = d.sectorStart ?? d.crossings[d.crossings.length - 1] ?? s.race.startedAt;
        const minSplit = a.minSplitMs ?? 1500;

        if (a.kind === 'sector') {
          // sector lines are 1-based and must be crossed in order; anything else is noise
          if (a.index !== d.sectors.length + 1) break;
          if (at - from < minSplit) break;
          d.sectors.push(at - from);
          d.sectorStart = at;
          this.noteSector(d, d.sectors.length - 1, d.sectors[d.sectors.length - 1]);
          s.vision.lastEvent = { type: 'sector', driverId: d.id, index: a.index, at, source: a.source };
          break;
        }

        // finish line
        const lastLap = d.crossings[d.crossings.length - 1] ?? s.race.startedAt;
        if (at - lastLap < (a.minLapMs ?? 8000) && !a.force) break;
        if (at - from < minSplit && !a.force) break;

        const complete = totalSectors === 1 || d.sectors.length === totalSectors - 1;
        d.sectors.push(at - from);
        if (complete) {
          d.lapSectors.push([...d.sectors]);
          this.noteSector(d, d.sectors.length - 1, d.sectors[d.sectors.length - 1]);
        }
        d.sectors = [];
        d.sectorStart = at;
        d.crossings.push(at);
        this.noteLap(d, at);
        s.vision.lastEvent = { type: 'lap', driverId: d.id, lap: d.crossings.length, at, source: a.source };
        break;
      }

      case 'driver.tracked': {
        // low-rate telemetry from the tracker: position, speed, stopped, in-pit
        for (const [id, t] of Object.entries(a.map || {})) {
          const d = this.driver(id);
          if (!d) continue;
          if (t.progress != null) d.progress = t.progress;
          if (t.speed != null) d.speed = t.speed;
          if (t.trackedAt != null) d.trackedAt = t.trackedAt;
          if (t.stopped != null && t.stopped !== d.stopped) {
            d.stopped = t.stopped;
            if (t.stopped) this.pushFeed('stopped', `${d.name} STOPPED ON TRACK`, d.id);
          }
          if (t.pit != null && t.pit !== d.pit) {
            d.pit = t.pit;
            if (t.pit) { d.pitStops += 1; this.pushFeed('pit', `${d.name} PITS`, d.id); }
          }
        }
        break;
      }

      case 'line.set': {
        const lines = [...(s.calibration.lines || [])];
        const i = lines.findIndex((l) => l.id === a.line.id);
        if (i >= 0) lines[i] = { ...lines[i], ...a.line };
        else lines.push(a.line);
        s.calibration.lines = reindexLines(lines);
        break;
      }

      case 'line.remove':
        s.calibration.lines = reindexLines((s.calibration.lines || []).filter((l) => l.id !== a.id));
        break;

      case 'feed.push':
        this.pushFeed(a.kind || 'info', a.text || '', a.driverId);
        break;

      case 'driver.radio': {   // a driver messaged their team from the phone app
        const text = String(a.text || '').trim().slice(0, 120);
        if (!text) break;
        const msg = { id: a.id || now, at: a.at || now, team: a.team || '', from: a.from || '', num: a.num || '', text };
        s.radio = [msg, ...(s.radio || [])].slice(0, 24);
        break;
      }

      case 'lap.undo': {
        const d = this.driver(a.driverId);
        if (d) d.crossings.pop();
        break;
      }

      case 'lap.setTime': { // manual correction of one lap time
        const d = this.driver(a.driverId);
        if (!d || !s.race.startedAt) break;
        const idx = a.lapIndex;
        if (idx < 0 || idx >= d.crossings.length) break;
        const prev = idx === 0 ? s.race.startedAt : d.crossings[idx - 1];
        const delta = (prev + a.ms) - d.crossings[idx];
        for (let i = idx; i < d.crossings.length; i++) d.crossings[i] += delta;
        break;
      }

      case 'driver.pitToggle': {
        const d = this.driver(a.driverId);
        if (!d) break;
        d.pit = !d.pit;
        if (d.pit) d.pitStops += 1;
        break;
      }

      case 'driver.penalty': {
        const d = this.driver(a.driverId);
        if (d) d.penaltySec = Math.max(0, d.penaltySec + (a.seconds || 0));
        break;
      }

      /*
       * Widget visibility and placement belong to a scene, not to the overlay as a
       * whole. Every write below lands in the active scene and is then mirrored out, so
       * the layout editor and the overlays keep reading the same two fields they always
       * did while each scene quietly keeps its own arrangement.
       */
      case 'overlay.update': {
        const sc = this.scene(a.scene);
        if (a.patch && a.patch.show && sc) Object.assign(sc.show, a.patch.show);
        Object.assign(s.overlay, pick(a.patch || {}, [
          'accent', 'focusDriverId', 'ticker', 'compact', 'editSelected', 'autoTicker', 'transitionMs', 'skin', 'nonce', 'towerTitle', 'radio', 'poll', 'pollHistory', 'sponsors', 'sponsorIndex', 'countdown', 'stinger'
        ]));
        this.syncScene();
        break;
      }

      /*
       * The commentator's settings, and only its settings.
       *
       * Its own action rather than a corner of overlay.update, because that one is scoped
       * to a scene: a league with a qualifying scene and a race scene wants one voice, not
       * one per scene, and hiding it in there would have made it per-scene by accident.
       */
      case 'commentary.config': {
        // A state that predates this feature has no block to patch. Seen for real: the
        // broadcast server was still running the build from before it existed, and the
        // first thing an operator does is press the switch.
        if (!s.commentary) s.commentary = defaultState().commentary;
        const c = s.commentary;
        const patch = a.patch || {};
        if (patch.on !== undefined) c.on = !!patch.on;
        if (patch.caption !== undefined) c.caption = !!patch.caption;
        if (patch.engine && ['browser', 'piper'].includes(patch.engine)) c.engine = patch.engine;
        if (patch.lang) c.lang = String(patch.lang).slice(0, 12);
        if (patch.voice !== undefined) c.voice = String(patch.voice || '').slice(0, 80);
        const hold = (v, lo, hi, fallback) => {
          const n = Number(v);
          return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
        };
        if (patch.rate !== undefined) c.rate = hold(patch.rate, 0.5, 2, c.rate);
        if (patch.volume !== undefined) c.volume = hold(patch.volume, 0, 1, c.volume);
        if (patch.verbosity && ['calm', 'normal', 'busy'].includes(patch.verbosity)) {
          c.verbosity = patch.verbosity;
        }
        if (patch.saying && typeof patch.saying === 'object') {
          // Replaced whole rather than merged: an operator deleting a row means they want
          // it gone, and a merge has no way to say that.
          const out = {};
          for (const [k, v] of Object.entries(patch.saying).slice(0, 60)) {
            const name = String(k).trim().slice(0, 40);
            const said = String(v || '').trim().slice(0, 60);
            if (name && said) out[name] = said;
          }
          c.saying = out;
        }
        break;
      }

      case 'overlay.layout': {   // move / resize / scale one widget — LIVE (straight to OBS)
        const sc = this.scene(a.scene);
        if (!sc) break;
        if (!sc.layout) sc.layout = {};
        const cur = sc.layout[a.id] || {};
        sc.layout[a.id] = { ...cur, ...pick(a.patch || {}, ['x', 'y', 'w', 'scale', 'hidden']) };
        this.syncScene();
        break;
      }

      case 'overlay.layoutApply': {   // force every overlay (incl. windowless OBS) to redraw
        s.overlay.nonce = Date.now();
        this.syncScene();
        break;
      }

      case 'overlay.layoutReset': {
        const sc = this.scene(a.scene);
        if (!sc) break;
        if (a.id) delete sc.layout[a.id];
        else sc.layout = {};
        this.syncScene();
        break;
      }

      // ---------- scenes ----------

      case 'scene.select':
        if (this.scene(a.id)) {
          s.overlay.activeScene = a.id;
          this.syncScene();
        }
        break;

      case 'scene.rebuild':   // replace every scene with the clean seeded set
        s.overlay.scenes = defaultScenes();
        if (!s.overlay.scenes.some((sc) => sc.id === s.overlay.activeScene)) s.overlay.activeScene = 'race';
        this.syncScene();
        break;

      case 'scene.add': {
        const from = this.scene(a.copyFrom) || this.scene();
        const id = `sc${now.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
        s.overlay.scenes.push({
          id,
          name: a.name || 'New scene',
          // copying the current scene is nearly always what is wanted: a new scene is
          // usually a variation, and starting from an empty screen means rebuilding it
          show: { ...(from ? from.show : defaultState().overlay.show) },
          layout: { ...(from ? from.layout : {}) }
        });
        s.overlay.activeScene = id;
        this.syncScene();
        break;
      }

      case 'scene.rename': {
        const sc = this.scene(a.id);
        if (sc && a.name) sc.name = String(a.name).slice(0, 40);
        break;
      }

      case 'scene.remove': {
        if ((s.overlay.scenes || []).length <= 1) break;   // never leave nothing on air
        s.overlay.scenes = s.overlay.scenes.filter((sc) => sc.id !== a.id);
        if (!this.scene(s.overlay.activeScene)) s.overlay.activeScene = s.overlay.scenes[0].id;
        this.syncScene();
        break;
      }

      case 'scene.reorder': {
        const list = s.overlay.scenes;
        const from = list.findIndex((sc) => sc.id === a.id);
        const to = Number(a.to);
        if (from < 0 || !(to >= 0 && to < list.length)) break;
        const [x] = list.splice(from, 1);
        list.splice(to, 0, x);
        break;
      }

      case 'overlay.h2h':
        Object.assign(s.overlay.h2h, pick(a.patch || {}, ['mode', 'a', 'b']));
        break;

      case 'brand.update':
        Object.assign(s.overlay.brand, pick(a.patch || {}, [
          'logoUrl', 'name', 'showLogo', 'placement', 'rotateSec'
        ]));
        break;

      case 'overlay.theme':
        s.overlay.theme = String(a.theme || 'midnight').slice(0, 32);
        // The theme carries an accent; adopting it makes switching feel like one decision
        // rather than two. The operator can still override it afterwards.
        if (a.accent) s.overlay.accent = String(a.accent).slice(0, 32);
        if (a.radius != null) s.overlay.style.radius = Math.max(0, Math.min(40, Number(a.radius) || 0));
        break;

      case 'overlay.style':
        Object.assign(s.overlay.style, pick(a.patch || {}, ['panelOpacity', 'radius', 'density', 'shadow', 'lite']));
        break;

      case 'vision.settings':
        Object.assign(s.vision.settings, a.patch || {});
        break;

      case 'vision.status':
        Object.assign(s.vision, pick(a.patch || {}, [
          'active', 'fps', 'mode', 'health', 'hidden', 'pixels', 'sourceFps', 'owner', 'ownerLabel',
          'estimator', 'circuit'
        ]));
        if (a.patch && a.patch.active === false) { s.vision.owner = null; s.vision.ownerLabel = null; }
        break;

      case 'vision.log':
        s.vision.log = [{ t: now, ...a.entry }, ...s.vision.log].slice(0, 40);
        break;

      case 'calibration.set':
        Object.assign(s.calibration, a.patch || {});
        break;

      // ---------- driver sign-in ----------

      case 'net.set':
        s.net.lan = String(a.lan || '').slice(0, 80);
        // Both addresses, because they are not interchangeable: a driver's phone only
        // gets flag alerts on the https one, and the operator has to be able to hand out
        // the right one.
        if (a.tls !== undefined) s.net.tls = String(a.tls || '').slice(0, 80);
        break;

      case 'registration.add': {
        // One row per account: signing in again from a new phone must not queue a second
        // request for the operator to wade through.
        const existing = s.registrations.find((r) => r.accountId === a.accountId);
        if (existing) {
          existing.nick = a.nick;
          existing.num = a.num;
          // Blank means "leave it as it is". Only a team actually typed replaces one.
          if (a.team) existing.team = String(a.team).slice(0, 30);
          existing.at = now;
          if (existing.status === 'rejected') existing.status = 'pending';
          break;
        }
        s.registrations.unshift({
          id: `g${now.toString(36)}${Math.random().toString(36).slice(2, 5)}`,
          accountId: a.accountId,
          nick: String(a.nick || '').slice(0, 24),
          num: String(a.num || '').slice(0, 4),
          team: String(a.team || '').slice(0, 30),
          at: now,
          status: 'pending',
          driverId: null
        });
        s.registrations = s.registrations.slice(0, 100);
        this.pushFeed('flag', `${a.nick} #${a.num} SIGNED IN`);
        break;
      }

      case 'registration.approve': {
        const r = s.registrations.find((x) => x.id === a.id);
        if (!r || r.status === 'approved') break;
        /*
         * Approving joins the sign-in to a car on the grid. An existing driver with that
         * number is adopted rather than duplicated — the operator has usually already
         * built the roster, and a second "#7" appearing beside the first is worse than
         * useless on a timing screen.
         */
        let d = s.drivers.find((x) => String(x.num) === String(r.num));
        if (!d) {
          s.drivers.push(makeDriver({ num: r.num, name: r.nick, team: r.team }, s.drivers.length));
          d = s.drivers[s.drivers.length - 1];
        } else if (a.rename !== false) {
          d.name = r.nick;
        }
        // The team the driver typed on their phone, put on the car by accepting them. A
        // driver who left the box empty must not wipe a team the operator typed in.
        if (r.team) d.team = r.team;
        // Which account is driving this car. Nothing here reads it — a driver's phone
        // finds itself through the sign-in row, not through the car — but the database
        // carries the same link, and a row that only one of the two paths fills in is a
        // row nobody can trust later.
        d.accountId = r.accountId || d.accountId || null;
        r.status = 'approved';
        r.driverId = d.id;
        this.pushFeed('flag', `${r.nick} #${r.num} ACCEPTED`);
        break;
      }

      case 'registration.reject': {
        const r = s.registrations.find((x) => x.id === a.id);
        if (r) { r.status = 'rejected'; r.driverId = null; }
        break;
      }

      case 'registration.remove':
        s.registrations = s.registrations.filter((x) => x.id !== a.id);
        break;

      /*
       * The queue, as the database has it.
       *
       * On a hosted event the sign-ins are not created here: a phone calls
       * driver_register and a row appears. This is how that row reaches the console.
       * It carries the whole list, because a partial one cannot say what was deleted.
       *
       * Rows the console is mid-way through writing are held back by the caller rather
       * than filtered here, so this stays a plain replacement and the decision about
       * what is in flight lives with the thing that knows.
       */
      case 'registration.sync': {
        if (!Array.isArray(a.rows)) break;
        const keep = new Map(s.registrations.map((r) => [r.id, r]));
        s.registrations = a.rows.map((row) => {
          const was = keep.get(row.id) || {};
          return {
            id: row.id,
            accountId: row.accountId ?? was.accountId ?? null,
            nick: row.nick ?? was.nick ?? '',
            num: row.num ?? was.num ?? '',
            team: row.team ?? was.team ?? '',
            at: row.at ?? was.at ?? now,
            status: row.status ?? was.status ?? 'pending',
            driverId: row.driverId ?? was.driverId ?? null
          };
        });
        break;
      }

      // ---------- championship ----------

      case 'championship.config':
        if (a.patch && a.patch.name != null) s.championship.name = String(a.patch.name).slice(0, 60);
        if (a.patch && a.patch.points) {
          Object.assign(s.championship.points, pick(a.patch.points, [
            'table', 'fastestLap', 'pole', 'dropWorst'
          ]));
          const t = s.championship.points.table;
          s.championship.points.table = (Array.isArray(t) ? t : [])
            .map((n) => Math.max(0, Number(n) || 0)).slice(0, 40);
        }
        break;

      case 'championship.addRound': {
        // Either a session already archived, or whatever is on the timing screen now.
        const from = a.sessionId
          ? (s.sessions || []).find((x) => x.id === a.sessionId)
          : null;
        const rows = from
          ? from.results
          : [...s.drivers].sort((x, y) => x.position - y.position).map((d) => ({
              driverId: d.id, name: d.name, num: d.num, color: d.color,
              position: d.position, dnf: !!d.dnf, retired: !!d.retired
            }));
        if (!rows.length) break;

        // The fastest lap bonus is only meaningful against the session it was set in.
        const fl = from ? null : this.state.records.bestLap.driverId;
        const marked = rows.map((r) => ({ ...r, fastestLap: fl ? r.driverId === fl : !!r.fastestLap }));

        s.championship.rounds.push({
          id: `r${now.toString(36)}${Math.random().toString(36).slice(2, 5)}`,
          name: a.name || (from ? from.name : s.event.round) || `Round ${s.championship.rounds.length + 1}`,
          at: from ? from.at : now,
          results: this.scoreRound(marked)
        });
        this.pushFeed('flag', `${(a.name || s.event.round || 'ROUND').toUpperCase()} ADDED TO THE CHAMPIONSHIP`);
        break;
      }

      case 'championship.rescore': {
        // Deliberate, and one round at a time: see the note on scoreRound.
        const round = s.championship.rounds.find((x) => x.id === a.id);
        if (round) round.results = this.scoreRound(round.results);
        break;
      }

      case 'championship.removeRound':
        s.championship.rounds = s.championship.rounds.filter((x) => x.id !== a.id);
        break;

      case 'championship.renameRound': {
        const round = s.championship.rounds.find((x) => x.id === a.id);
        if (round && a.name) round.name = String(a.name).slice(0, 40);
        break;
      }

      // ---------- race control ----------

      case 'penalty.add': {
        const d = this.driver(a.driverId);
        if (!d) break;
        const auto = !!a.auto;
        const rules = s.race.rules;
        /*
         * An automatic finding opens an investigation unless the operator has asked for
         * decisions to be immediate. Software that hands down penalties on its own, from
         * a colour blob it might have mistracked, would be wrong in public — and a wrong
         * penalty is far more damaging to an event than a late one.
         */
        const status = a.status || (auto && !rules.autoApply ? 'investigating' : 'applied');
        const p = {
          id: uid(),
          driverId: a.driverId,
          // `kind`, not `type`: the action's own discriminator is `type`, and naming the
          // penalty class the same thing overwrote it — the whole action stopped being
          // recognised and failed silently.
          type: a.kind || 'time',           // time | warning | drivethrough | dq | note
          seconds: Number(a.seconds) || 0,
          reason: String(a.reason || '').slice(0, 120) || 'Incident',
          at: a.at || now,
          lap: d.lapsDone,
          status,
          auto
        };
        s.race.penalties.unshift(p);
        s.race.penalties = s.race.penalties.slice(0, 200);
        if (p.type === 'dq' && status === 'applied') d.dnf = true;
        this.pushFeed('penalty', status === 'investigating'
          ? `${d.name} — UNDER INVESTIGATION: ${p.reason}`
          : `${d.name} — ${this.penaltyText(p)}`, d.id);
        break;
      }

      case 'penalty.resolve': {
        const p = (s.race.penalties || []).find((x) => x.id === a.id);
        if (!p || p.status !== 'investigating') break;
        const d = this.driver(p.driverId);
        if (a.drop) {
          p.status = 'dropped';
          if (d) this.pushFeed('penalty', `${d.name} — NO FURTHER ACTION`, d.id);
          break;
        }
        p.status = 'applied';
        if (a.kind) p.type = a.kind;
        if (a.seconds != null) p.seconds = Number(a.seconds) || 0;
        if (p.type === 'dq' && d) d.dnf = true;
        if (d) this.pushFeed('penalty', `${d.name} — ${this.penaltyText(p)}`, d.id);
        break;
      }

      /*
       * Marking a penalty served.
       *
       * Without this there is no difference between a drive-through the driver took and
       * one they ignored, and the second is the only reason to escalate. The operator
       * clicks it as the car comes through the pit lane.
       */
      case 'penalty.serve': {
        const p = (s.race.penalties || []).find((x) => x.id === a.id);
        if (!p || p.status !== 'applied') break;
        p.served = true;
        p.servedAt = now;
        const d = this.driver(p.driverId);
        if (d) this.pushFeed('penalty', `${d.name} — PENALTY SERVED`, d.id);
        break;
      }

      case 'penalty.remove':
        s.race.penalties = (s.race.penalties || []).filter((x) => x.id !== a.id);
        break;

      case 'flags.update':
        Object.assign(s.race.flags, pick(a.patch || {}, [
          'auto', 'yellowOnStopped', 'stoppedRaises', 'redStoppedCount', 'greenAfterSec',
          'blue', 'chequered', 'blackFlagUnserved'
        ]));
        break;

      // Give the flag back to the automation without changing what is currently flying.
      case 'flags.release':
        s.race.flagSource = 'auto';
        s.race.clearSince = null;
        break;

      case 'rules.update':
        Object.assign(s.race.rules, pick(a.patch || {}, [
          'jumpStart', 'jumpStartSeconds', 'trackLimits', 'trackLimitsAllowed',
          'trackLimitsSeconds', 'impossibleLap', 'autoApply'
        ]));
        break;

      /*
       * A track-limits warning, counted rather than punished.
       *
       * Real regulations allow a number of them before anything happens, because the
       * boundary is never as sharp as the rulebook pretends and one wheel over on one lap
       * is not the offence. Only the count crossing the line raises a penalty.
       */
      case 'trackLimit.note': {
        const d = this.driver(a.driverId);
        if (!d || !s.race.rules.trackLimits) break;
        d.trackLimits = (d.trackLimits || 0) + 1;
        const allowed = Math.max(0, s.race.rules.trackLimitsAllowed);
        if (d.trackLimits <= allowed) {
          this.pushFeed('penalty', `${d.name} — TRACK LIMITS ${d.trackLimits}/${allowed}`, d.id);
          break;
        }
        d.trackLimits = 0;
        this.apply({
          type: 'penalty.add', driverId: d.id, kind: 'time',
          seconds: s.race.rules.trackLimitsSeconds,
          reason: `Track limits, ${allowed + 1} strikes`, auto: true
        });
        break;
      }

      // ---------- VOD markers ----------

      case 'recording.start':
        // Announced before the anchor is set, so the announcement does not become a
        // marker of its own. A chapter at 0:00 reading "RECORDING STARTED" is noise in
        // every list it lands in.
        this.pushFeed('flag', 'RECORDING STARTED');
        s.recording.startedAt = a.at || now;
        s.recording.offsetMs = 0;
        if (a.clear !== false) s.recording.markers = [];
        break;

      case 'recording.stop':
        // The markers stay: they are the whole point, and the operator exports them after
        // the event, not during it.
        s.recording.startedAt = null;
        break;

      case 'recording.offset':
        s.recording.offsetMs = Math.max(-600000, Math.min(600000, Number(a.ms) || 0));
        break;

      case 'recording.clear':
        s.recording.markers = [];
        break;

      case 'marker.add': {
        if (!s.recording.startedAt) break;
        s.recording.markers.push({
          t: a.at || now,
          kind: a.kind || 'note',
          text: String(a.text || 'MARK').slice(0, 120),
          driverId: a.driverId || null,
          manual: true
        });
        break;
      }

      case 'marker.remove':
        s.recording.markers = s.recording.markers.filter((m, i) => i !== Number(a.index));
        break;

      // ---------- sessions and the starting grid ----------

      case 'session.save': {
        const rows = [...s.drivers].sort((x, y) => x.position - y.position);
        if (!rows.length) break;
        /*
         * A snapshot, not a reference. Rebuilding the grid from live driver records
         * would let a name change or a colour edit after the session silently rewrite
         * what happened in it, and a deleted driver would tear a hole in the results.
         */
        s.sessions.unshift({
          id: `s${now.toString(36)}${Math.random().toString(36).slice(2, 5)}`,
          type: a.sessionType || s.event.sessionType,
          name: a.name || s.event.sessionName || s.event.sessionType,
          at: now,
          results: rows.map((d, i) => ({
            driverId: d.id,
            position: i + 1,
            num: d.num,
            name: d.name,
            color: d.color,
            bestLap: d.bestLap,
            lapsDone: d.lapsDone,
            totalMs: d.totalMs,
            dnf: !!d.dnf,
            retired: !!d.retired
          }))
        });
        s.sessions = s.sessions.slice(0, 20);
        this.pushFeed('flag', `${(a.name || s.event.sessionName || 'SESSION').toUpperCase()} CLASSIFIED`);
        break;
      }

      case 'session.remove':
        s.sessions = (s.sessions || []).filter((x) => x.id !== a.id);
        break;

      case 'grid.set':
        // only ids that are still on the roster, so a removed driver cannot hold a slot
        s.race.grid = (a.grid || []).filter((id) => s.drivers.some((d) => d.id === id));
        break;

      case 'grid.fromSession': {
        const sess = (s.sessions || []).find((x) => x.id === a.id);
        if (!sess) break;
        let order = sess.results.filter((r) => s.drivers.some((d) => d.id === r.driverId));
        // A reversed grid is a common format for a second heat, and doing it by hand is
        // where the order gets typed in wrong.
        if (a.reverse) order = [...order].reverse();
        s.race.grid = order.map((r) => r.driverId);
        // anyone who was not in that session still has to start somewhere
        for (const d of s.drivers) if (!s.race.grid.includes(d.id)) s.race.grid.push(d.id);
        this.pushFeed('flag', `GRID SET FROM ${sess.name.toUpperCase()}${a.reverse ? ' (REVERSED)' : ''}`);
        break;
      }

      case 'grid.fromCurrent':
        s.race.grid = [...s.drivers].sort((x, y) => x.position - y.position).map((d) => d.id);
        break;

      case 'grid.clear':
        s.race.grid = [];
        break;

      case 'grid.reverse': {   // flip the whole grid (or reverse only the top N if given)
        const base = (s.race.grid && s.race.grid.length)
          ? [...s.race.grid]
          : [...s.drivers].sort((x, y) => x.position - y.position).map((d) => d.id);
        const n = Number(a.top) > 0 ? Math.min(Number(a.top), base.length) : base.length;
        const head = base.slice(0, n).reverse();
        s.race.grid = head.concat(base.slice(n));
        break;
      }

      case 'grid.random': {     // shuffle the field into a random grid
        const ids = [...s.drivers].map((d) => d.id);
        for (let i = ids.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          const t = ids[i]; ids[i] = ids[j]; ids[j] = t;
        }
        s.race.grid = ids;
        break;
      }

      // ---------- tandem battles ----------

      case 'drift.config':
        Object.assign(s.drift.format, pick(a.patch || {}, [
          'bracketSize', 'judges', 'qualifyingRuns', 'maxOmt'
        ]));
        if (s.drift.battle) {
          // keep the vote slots matching the judge count so a mid-event change is safe
          const v = s.drift.battle.votes;
          v.length = s.drift.format.judges;
          for (let i = 0; i < v.length; i++) if (v[i] === undefined) v[i] = null;
        }
        break;

      case 'drift.qualify': {
        const d = this.driver(a.driverId);
        if (!d) break;
        let entry = s.drift.qualifying.find((e) => e.driverId === a.driverId);
        if (!entry) {
          entry = { driverId: a.driverId, runs: [], best: null };
          s.drift.qualifying.push(entry);
        }
        if (a.runs) entry.runs = a.runs.map((n) => (n == null ? null : Number(n)));
        else if (a.score != null) entry.runs.push(Number(a.score));
        entry.runs = entry.runs.slice(0, Math.max(1, s.drift.format.qualifyingRuns));
        const scored = entry.runs.filter((n) => typeof n === 'number' && !Number.isNaN(n));
        entry.best = scored.length ? Math.max(...scored) : null;
        break;
      }

      case 'drift.bracket':
        this.buildBracket();
        break;

      case 'drift.battle.start': {
        const round = s.drift.bracket[a.round];
        const pair = round && round.pairs[a.pair];
        if (!pair || !pair.a || !pair.b) break;
        s.drift.battle = {
          round: a.round, pair: a.pair, a: pair.a, b: pair.b,
          lead: 'a', run: 1, omt: pair.omt || 0,
          votes: new Array(s.drift.format.judges).fill(null),
          status: 'running', winner: null
        };
        const A = this.driver(pair.a), B = this.driver(pair.b);
        this.pushFeed('battle', `${round.name} — ${A ? A.name : '?'} vs ${B ? B.name : '?'}`);
        break;
      }

      case 'drift.battle.run': {
        const b = s.drift.battle;
        if (!b || b.status !== 'running') break;
        // run 2 swaps the lead: both drivers must lead once before anyone is judged
        b.run = Math.max(1, Math.min(2, Number(a.run) || b.run + 1));
        b.lead = b.run === 1 ? 'a' : 'b';
        break;
      }

      case 'drift.vote': {
        const b = s.drift.battle;
        if (!b || b.status !== 'running') break;
        const i = Number(a.judge);
        if (!(i >= 0 && i < b.votes.length)) break;
        // clicking the same call again clears it, so a misclick is one click to undo
        b.votes[i] = b.votes[i] === a.vote ? null : a.vote;
        if (a.autoDecide !== false) this.decideBattle();
        break;
      }

      case 'drift.battle.decide':
        this.decideBattle();
        break;

      case 'drift.battle.close':
        s.drift.battle = null;
        break;

      case 'drift.reset':
        s.drift.bracket = [];
        s.drift.battle = null;
        s.drift.champion = null;
        if (a.clearQualifying) s.drift.qualifying = [];
        break;

      case 'state.replace':
        this.state = { ...defaultState(), ...(a.state || {}) };
        break;

      default:
        if (tracked) this.history.pop();   // unknown action: drop the snapshot we took
        return false;
    }

    this.emit();
    return true;
  }
}

/** Sector lines are renumbered 1..N so a deletion never leaves a gap in the order. */
function reindexLines(lines) {
  const finish = lines.filter((l) => l.kind === 'finish');
  const sectors = lines.filter((l) => l.kind === 'sector')
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((l, i) => ({ ...l, index: i + 1, name: l.name || `Sector ${i + 1}` }));
  return [...finish.map((l) => ({ ...l, index: 0, name: l.name || 'Finish line' })), ...sectors];
}

function resetDriverTiming(d, startedAt) {
  d.crossings = [];
  d.lapSectors = [];
  d.sectors = [];
  d.bestSectors = [];
  d.sectorStart = startedAt;
  d.penaltySec = 0;
  d.pitStops = 0;
  d.pit = false;
  d.dnf = false;
  d.retired = false;
  d.finished = false;
  d.driftScore = 0;
  d.progress = 0;
  d.speed = 0;
  d.stopped = false;
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (k in obj) out[k] = obj[k];
  return out;
}


