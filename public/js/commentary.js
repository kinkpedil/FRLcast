/*
 * What to say, and when to stop saying it.
 *
 * A commentator that reads out every change is unlistenable within a minute: laps arrive
 * faster than sentences can be spoken, and half of what changes is not worth a word. So
 * this is a filter before it is a writer. It looks at what moved since last time, decides
 * which of those are worth an interruption, and hands back lines already carrying how
 * urgent they are and how long they stay true.
 *
 * Nothing here speaks. Nothing here touches a browser. It is a function from two states to
 * a list of sentences, which is what makes it testable on a desktop — and the sentences are
 * the part most likely to be wrong in a way only reading them reveals.
 *
 * ------------------------------------------------------------------ saying something
 *
 * The first version was thin, and it was thin in a specific way: it announced that a thing
 * had happened without saying anything about it. "CITRA moves up to third" is a caption,
 * not commentary. Who did they pass? By how much? Was it for a podium? All of that was
 * already in the state, and none of it was being used.
 *
 * So a line now gets the surroundings as well as the event — who was overtaken, the gap it
 * happened by, what it changes. Which pool is used depends on which of those are actually
 * known, so a pass whose victim cannot be identified reads properly instead of naming
 * somebody who was never overtaken.
 *
 * ------------------------------------------------------------------ two languages
 *
 * The words follow the voice, not the setting. Ask for Indonesian on a machine that has no
 * Indonesian voice and an English one reads it, and Indonesian words in an English mouth
 * are not accented — they are unintelligible. The overlay resolves which voice it actually
 * got and tells this which language to write in.
 *
 * ------------------------------------------------------------------ why not a language model
 *
 * The numbers come from race-model.js, which runs the race forward from measured pace. A
 * model asked to invent them would invent them. What a model could add is phrasing, and
 * that is the cheap half: an event this size needs a few hundred sentences an evening, and
 * a pool of written ones costs nothing, works with the internet down, and never says
 * something libellous about a driver. The seam is here if it is ever wanted: replace pick()
 * and everything above it stays.
 */

import { fmtGap } from './timing.js';

/** Priorities. Lower interrupts higher. */
export const P_URGENT = 1;   // red flag, chequered flag: say it now, cut off whatever is running
export const P_HIGH = 2;     // lead change, penalty, retirement
export const P_NORMAL = 3;   // overtakes, fastest lap, pit stops
export const P_COLOUR = 4;   // the outlook, gaps, who is in trouble — dropped when busy

/**
 * A stable choice from a pool.
 *
 * Math.random would have two overlays on the same race say different things, and would
 * change the wording of a line between one render and the next. The key already identifies
 * the event uniquely, so hashing it gives variety that holds still.
 */
function pick(pool, key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return pool[Math.abs(h) % pool.length];
}

// ---------------------------------------------------------------- the pools

const ID = {
  green: [
    'Bendera hijau. Balapan dimulai.',
    'Hijau, hijau, hijau. Kita mulai.',
    'Lampu padam, bendera hijau, dan mereka berangkat.',
    'Bendera hijau melambai. {laps} lap di depan mereka.',
    'Dan kita jalan. {leader} memimpin dari barisan depan.'
  ],
  restart: [
    'Hijau lagi. Balapan jalan kembali.',
    'Trek bersih, bendera hijau, silakan menyerang.',
    'Restart. {leader} yang memimpin, dan sekarang boleh diserang.',
    'Kuning dicabut. Balapan hidup lagi.'
  ],
  yellow: [
    'Bendera kuning. Turunkan kecepatan, dilarang menyalip.',
    'Kuning di trek. Tidak ada yang boleh menyalip sampai bersih.',
    'Kuning. Semua tahan posisi.',
    'Bendera kuning keluar. Ada sesuatu di trek, dan posisi dibekukan.'
  ],
  red: [
    'Bendera merah. Balapan dihentikan.',
    'Merah. Semua berhenti, ada sesuatu yang serius di trek.',
    'Bendera merah. Balapan berhenti di lap {lap}.'
  ],
  safety: [
    'Safety car keluar. Barisan menutup.',
    'Safety car di trek, jarak semuanya hilang.',
    'Safety car. Keunggulan {leader} habis sudah.'
  ],
  vsc: [
    'Virtual safety car. Semua tahan kecepatan.',
    'VSC aktif. Jaga delta, jangan menyalip.'
  ],
  formation: [
    'Lap formasi. Panaskan ban dan ambil posisi.',
    'Mereka berangkat untuk lap formasi.'
  ],
  finished: [
    'Bendera kotak. {leader} menang.',
    'Kotak-kotak, dan {leader} yang mengambilnya.',
    'Bendera kotak. Kemenangan untuk {leader}.',
    'Selesai. {leader} menang, {second} kedua, {third} ketiga.'
  ],
  finishedPlain: [
    'Bendera kotak. Balapan selesai.',
    'Kotak-kotak. Itu akhir balapannya.'
  ],
  fastest: [
    '{short} mencatat lap tercepat, {time}.',
    'Lap tercepat baru untuk {short}. {time}.',
    '{short} memperbaiki catatan tercepat, {time}.',
    '{time} untuk {short}. Tercepat balapan ini sejauh ini.',
    'Dan itu lap tercepat. {short}, {time}.'
  ],
  fastestMargin: [
    '{short} mencatat lap tercepat, {time}. Unggul {margin} dari siapa pun.',
    'Lap tercepat untuk {short}, {time}, {margin} lebih cepat dari yang terdekat.',
    '{time} dari {short}. Tidak ada yang mendekati, {margin} jaraknya.'
  ],
  lead: [
    '{who} memimpin balapan sekarang.',
    'Pimpinan berganti. {short} yang di depan.',
    '{short} mengambil alih pimpinan.',
    'Pimpinan pindah ke {short} di lap {lap}.'
  ],
  leadFrom: [
    '{short} merebut pimpinan dari {victim}.',
    'Dan {short} lewat. {victim} kehilangan pimpinan di lap {lap}.',
    'Pimpinan berpindah: {short} menyalip {victim}.',
    '{victim} kalah di lap {lap}. {short} yang memimpin sekarang.'
  ],
  overtake: [
    '{short} lewat, naik ke {pos}.',
    'Salip bersih dari {short}, sekarang {pos}.',
    '{short} dapat satu posisi, kini {pos}.',
    '{pos} sekarang milik {short}.'
  ],
  overtakeOn: [
    '{short} menyalip {victim} untuk {pos}.',
    '{victim} tidak bisa menahan. {short} lewat, ambil {pos}.',
    'Ada pergerakan: {short} melewati {victim}, naik ke {pos}.',
    '{short} melewati {victim} di lap {lap}. {pos}.',
    'Dan itu selesai. {short} sudah di depan {victim}, {pos}.'
  ],
  overtakePodium: [
    '{short} menyalip {victim} untuk {pos}. Itu posisi podium.',
    'Podium berpindah. {short} lewat {victim}, sekarang {pos}.',
    '{short} merebut podium dari {victim}.'
  ],
  lost: [
    '{short} kehilangan posisi, turun ke {pos}.',
    '{short} melebar dan turun ke {pos}.',
    'Turun dua tempat, {short} sekarang {pos}.'
  ],
  penalty: [
    '{who}, {headline}. Alasannya, {reason}.',
    'Race control memutuskan: {headline} untuk {short}. Alasannya, {reason}.',
    '{short} kena {headline}. {reason}.',
    'Keputusan steward. {short}, {headline}, karena {reason}.'
  ],
  penaltyCost: [
    '{who}, {headline}. Alasannya, {reason}. Itu mahal dari {pos}.',
    'Race control menjatuhkan {headline} untuk {short}. {reason}. Dan {short} sedang di {pos}.',
    '{headline} untuk {short}, karena {reason}. Ini bisa mengubah podium.'
  ],
  investigating: [
    'Insiden yang melibatkan {short} sedang diselidiki.',
    'Race control menyelidiki {short}. Belum ada keputusan.',
    'Ada yang sedang dilihat steward. {short}, lap {lap}.'
  ],
  dnf: [
    '{who} keluar dari balapan.',
    '{short} berhenti. Balapannya selesai di sini.',
    'Dan {short} keluar, dari {pos}.',
    '{short} tidak melanjutkan. Selesai di lap {lap}.'
  ],
  pitIn: [
    '{short} masuk pit dari {pos}.',
    '{short} belok ke pit lane.',
    'Pit stop untuk {short}, lap {lap}.'
  ],
  pitOut: [
    '{short} keluar pit, kembali ke trek di {pos}.',
    '{short} sudah di trek lagi setelah pit.'
  ],
  battle: [
    'Jaraknya tinggal {gap} antara {a} dan {b}.',
    '{b} menempel {a}, cuma {gap}.',
    'Duel di {pos}: {a} ditekan {b}, selisih {gap}.',
    '{gap} memisahkan {a} dan {b}. Ini akan selesai sebentar lagi.'
  ],
  battlePodium: [
    'Duel untuk podium. {a} dan {b}, {gap}.',
    '{pos} sedang diperebutkan. {b} cuma {gap} di belakang {a}.'
  ],
  battleLead: [
    'Duel untuk pimpinan. {b} tinggal {gap} dari {a}.',
    '{b} sudah di ekor {a}. {gap} memperebutkan pimpinan.'
  ],
  closing: [
    '{b} mengejar {a}, {closing} lebih cepat lap terakhir.',
    'Jarak {a} ke {b} terus menipis, tinggal {gap}.',
    '{b} memakan {closing} di lap itu. {a} harus menjawab.'
  ],
  fading: [
    'Pace {short} turun beberapa lap terakhir.',
    '{short} tidak lagi secepat tadi. Ada yang tidak beres.',
    'Ada masalah di {short}. Lapnya melambat sejak beberapa lap lalu.'
  ],
  blue: [
    'Bendera biru untuk {short}. Yang memimpin datang.',
    '{short} akan dilewati pemimpin balapan.'
  ],
  lapsLeft: [
    'Tersisa {n} lap.',
    '{n} lap lagi, {leader} memimpin.',
    'Masuk {n} lap terakhir.'
  ],
  lapsLeftGap: [
    '{n} lap lagi, dan {leader} unggul {gap}.',
    'Tersisa {n} lap. Keunggulan {leader}, {gap}.'
  ],
  finalLap: [
    'Lap terakhir.',
    'Ini lap penentu.',
    'Lap terakhir, dan {leader} yang memimpin.'
  ],
  winStrong: [
    'Dari pace mereka, {short} hampir pasti menang. {pct} persen dari simulasi.',
    '{short} tinggal menyelesaikan. Peluang menang {pct} persen.',
    'Simulasi memberi {short} {pct} persen. Ini tinggal dibawa pulang.'
  ],
  winFavoured: [
    '{short} paling diunggulkan, sekitar {pct} persen.',
    'Peluang terbesar ada di {short}, {pct} persen, dari {second} di {pct2} persen.',
    'Kalau pace ini bertahan, {short} yang menang. {pct} persen.'
  ],
  winOpen: [
    'Masih terbuka. {short} unggul tipis, {pct} persen.',
    'Belum ada yang aman. {short} baru {pct} persen, {second} {pct2} persen.',
    'Ini belum selesai. {short} {pct} persen, dan {second} tepat di belakangnya.'
  ],
  podium: [
    'Untuk podium: {names} yang paling mungkin.',
    'Tiga besar sementara mengarah ke {names}.'
  ],
  podiumFight: [
    '{short} masih hidup untuk podium, {pct} persen.',
    'Podium belum aman. {short} punya {pct} persen.'
  ],
  thin: [
    'Baru beberapa lap, jadi angkanya belum bisa dipercaya.',
    'Datanya masih tipis untuk memprediksi apa pun.'
  ],
  driftLead: [
    '{short} memimpin dengan {score} poin.',
    'Skor tertinggi sementara {short}, {score} poin.'
  ],
  driftBattle: [
    'Battle berikutnya: {a} melawan {b}.',
    '{a} dan {b} turun berhadapan.'
  ]
};

const EN = {
  green: [
    'Green flag. We are racing.',
    'Green, green, green. And they are away.',
    'Lights out, green flag, the race is on.',
    'The green flag is out. {laps} laps ahead of them.',
    'And we are underway. {leader} leads them off the line.'
  ],
  restart: [
    'Green again. We are racing.',
    'The track is clear, green flag, and they can attack.',
    'Restart. {leader} leads, and is under threat from here.',
    'The yellow is lifted. This race is alive again.'
  ],
  yellow: [
    'Yellow flag. Slow down, no overtaking.',
    'Yellow on track. Nobody passes until it is clear.',
    'Yellow. Everybody holds position.',
    'Yellow flag out. Something on track, and positions are frozen.'
  ],
  red: [
    'Red flag. The race is stopped.',
    'Red. Everybody stops, something serious out there.',
    'Red flag. The race halts on lap {lap}.'
  ],
  safety: [
    'Safety car is out. The field closes up.',
    'Safety car on track, and every gap is gone.',
    'Safety car. The lead {leader} built has just evaporated.'
  ],
  vsc: [
    'Virtual safety car. Everybody off the throttle.',
    'V S C. Hold the delta, no overtaking.'
  ],
  formation: [
    'Formation lap. Heat the tyres and take your slot.',
    'Away they go for the formation lap.'
  ],
  finished: [
    'Chequered flag. {leader} wins.',
    'And that is the chequered flag. {leader} takes it.',
    'Chequered flag, and the win goes to {leader}.',
    'It is over. {leader} wins, {second} second, {third} third.'
  ],
  finishedPlain: [
    'Chequered flag. The race is over.',
    'And that is the end of it.'
  ],
  fastest: [
    '{short} sets the fastest lap, {time}.',
    'A new fastest lap for {short}. {time}.',
    '{short} goes quickest, {time}.',
    '{time} for {short}. The fastest of the race so far.',
    'And that is the fastest lap. {short}, {time}.'
  ],
  fastestMargin: [
    '{short} sets the fastest lap, {time}, {margin} clear of anybody else.',
    'Fastest lap to {short}, {time}, and that is {margin} quicker than the next.',
    '{time} from {short}. Nobody is close, {margin} back.'
  ],
  lead: [
    '{who} leads this race.',
    'The lead changes. {short} is in front.',
    '{short} takes the lead.',
    'The lead goes to {short} on lap {lap}.'
  ],
  leadFrom: [
    '{short} takes the lead from {victim}.',
    'And {short} is through. {victim} loses the lead on lap {lap}.',
    'The lead changes hands: {short} passes {victim}.',
    '{victim} loses it on lap {lap}. {short} leads this race.'
  ],
  overtake: [
    '{short} is through, up to {pos}.',
    'A clean pass from {short}, now {pos}.',
    '{short} gains a place, into {pos}.',
    '{pos} now belongs to {short}.'
  ],
  overtakeOn: [
    '{short} goes past {victim} for {pos}.',
    '{victim} cannot hold on. {short} is through into {pos}.',
    'There is a move: {short} passes {victim}, up to {pos}.',
    '{short} takes {victim} on lap {lap}. That is {pos}.',
    'And it is done. {short} is ahead of {victim}, into {pos}.'
  ],
  overtakePodium: [
    '{short} takes {victim} for {pos}. That is a podium place.',
    'The podium changes. {short} is past {victim}, now {pos}.',
    '{short} takes a podium place off {victim}.'
  ],
  lost: [
    '{short} loses a place, down to {pos}.',
    '{short} runs wide and drops to {pos}.',
    'Two places gone, {short} is now {pos}.'
  ],
  penalty: [
    '{who}, {headline}. The reason, {reason}.',
    'Race control has decided: {headline} for {short}. The reason, {reason}.',
    '{short} takes {headline}. {reason}.',
    'A stewards decision. {short}, {headline}, for {reason}.'
  ],
  penaltyCost: [
    '{who}, {headline}. The reason, {reason}. That is expensive from {pos}.',
    'Race control hands {short} {headline}. {reason}. And {short} is running {pos}.',
    '{headline} for {short}, for {reason}. That could change the podium.'
  ],
  investigating: [
    'An incident involving {short} is under investigation.',
    'Race control is looking at {short}. No decision yet.',
    'The stewards have something to look at. {short}, lap {lap}.'
  ],
  dnf: [
    '{who} is out of the race.',
    '{short} stops. That is the end of their race.',
    'And {short} is out, from {pos}.',
    '{short} will not continue. Done on lap {lap}.'
  ],
  pitIn: [
    '{short} comes in from {pos}.',
    '{short} turns into the pit lane.',
    'A stop for {short}, lap {lap}.'
  ],
  pitOut: [
    '{short} is out of the pits, rejoining in {pos}.',
    '{short} is back on track after the stop.'
  ],
  battle: [
    'There is only {gap} between {a} and {b}.',
    '{b} is right on {a}, just {gap}.',
    'A fight for {pos}: {a} under pressure from {b}, {gap} between them.',
    '{gap} separates {a} and {b}. This will not last long.'
  ],
  battlePodium: [
    'A fight for the podium. {a} and {b}, {gap} apart.',
    '{pos} is being contested. {b} is only {gap} behind {a}.'
  ],
  battleLead: [
    'A fight for the lead. {b} is {gap} from {a}.',
    '{b} is on the tail of {a}. {gap} between them, for the lead.'
  ],
  closing: [
    '{b} is closing on {a}, {closing} quicker last lap.',
    'The gap from {a} to {b} keeps shrinking, {gap} now.',
    '{b} took {closing} out of that lap. {a} needs an answer.'
  ],
  fading: [
    'The pace of {short} has dropped over the last few laps.',
    '{short} is not as quick as they were. Something is wrong.',
    'There is a problem at {short}. The lap times have gone away.'
  ],
  blue: [
    'Blue flags for {short}. The leader is coming.',
    '{short} is about to be lapped.'
  ],
  lapsLeft: [
    '{n} laps to go.',
    '{n} to go, and {leader} leads.',
    'Into the last {n} laps.'
  ],
  lapsLeftGap: [
    '{n} to go, and {leader} is {gap} clear.',
    '{n} laps left. {leader} leads by {gap}.'
  ],
  finalLap: [
    'Last lap.',
    'This is the lap that decides it.',
    'Last lap, and {leader} leads.'
  ],
  winStrong: [
    'On this pace {short} has it. {pct} percent in the simulation.',
    '{short} only has to finish. Win chance, {pct} percent.',
    'The simulation gives {short} {pct} percent. This is theirs to bring home.'
  ],
  winFavoured: [
    '{short} is the favourite, around {pct} percent.',
    'The best chance is with {short}, {pct} percent, from {second} on {pct2}.',
    'If this pace holds, {short} wins it. {pct} percent.'
  ],
  winOpen: [
    'This is still open. {short} leads it on {pct} percent.',
    'Nobody is safe. {short} on {pct} percent, {second} on {pct2}.',
    'This is not decided. {short} {pct} percent, and {second} right behind.'
  ],
  podium: [
    'For the podium: {names} are the likely three.',
    'The top three is heading towards {names}.'
  ],
  podiumFight: [
    '{short} is still alive for a podium, {pct} percent.',
    'The podium is not settled. {short} has {pct} percent.'
  ],
  thin: [
    'It is early, so those numbers are not worth much yet.',
    'Too few laps to predict anything with confidence.'
  ],
  driftLead: [
    '{short} leads on {score} points.',
    'The top score so far is {short}, {score} points.'
  ],
  driftBattle: [
    'The next battle: {a} against {b}.',
    '{a} and {b} go head to head.'
  ]
};

const LINES = { id: ID, en: EN };

function fill(template, vars) {
  const text = template.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ''));
  // Several lines open with a slot, and a penalty headline or a gap starts lower case:
  // "a 5 second penalty for BUDI" is a sentence that begins mid-word when read aloud, and
  // looks worse in the caption.
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const PEN_WORDS = {
  id: { time: 'penalti waktu', warning: 'peringatan', drivethrough: 'drive through',
        blackflag: 'bendera hitam', dq: 'diskualifikasi', note: 'catatan' },
  en: { time: 'a time penalty', warning: 'a warning', drivethrough: 'a drive through',
        blackflag: 'the black flag', dq: 'disqualification', note: 'a note' }
};

function penHeadline(p, lang) {
  if (p.type === 'time') {
    return lang === 'id' ? `penalti ${p.seconds} detik` : `a ${p.seconds} second penalty`;
  }
  return PEN_WORDS[lang][p.type] || (lang === 'id' ? 'sebuah keputusan' : 'a decision');
}

/** Places, because "up to 3" is not how anybody says it out loud. */
const ORD_EN = ['', 'the lead', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh',
                'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
function place(n, lang) {
  if (lang === 'id') return `posisi ${n}`;
  return ORD_EN[n] || `P ${n}`;
}

// ---------------------------------------------------------------- the commentator

export class Commentary {

  /**
   * @param {object} opts
   *   lang  'id' or 'en'. Set from the voice that was actually resolved, not from the
   *         operator's preference: see the note at the top of this file.
   */
  constructor({ lang = 'id' } = {}) {
    this.lang = LINES[lang] ? lang : 'en';
    this.seen = new Set();          // dedupe keys already said
    this.prev = null;               // last state seen
    this.prevOutlook = null;
    this.lastColourAt = 0;
    this.started = false;
    this.primed = false;            // has the first state been absorbed silently
    this.ended = false;             // the chequered flag has been shown
  }

  /**
   * Switch language without forgetting the race.
   *
   * The voice list arrives after the first states do, so the overlay usually learns which
   * language it is really speaking a second or two in. Resetting there would replay the
   * race from the beginning; only the pool changes.
   */
  setLang(lang) {
    if (LINES[lang] && lang !== this.lang) this.lang = lang;
  }

  /** Forget everything. A new session is a new race, and last race's leader is not news. */
  reset() {
    this.seen.clear();
    this.prev = null;
    this.prevOutlook = null;
    this.lastColourAt = 0;
    this.started = false;
    this.primed = false;
    this.ended = false;
  }

  /** Names as they are said, not as they are printed. "#7" is read badly by every engine. */
  who(d) {
    if (!d) return '';
    return this.lang === 'id' ? `${d.name}, nomor ${d.num}` : `${d.name}, number ${d.num}`;
  }

  /**
   * @param {?string} channel  a subject only one line may hold at a time. A second flag
   *                           announcement replaces the first rather than queueing behind
   *                           it, because by then the first one is not what is happening.
   */
  say(out, key, priority, pool, vars, staleMs, channel = null) {
    if (this.seen.has(key)) return;
    const bank = LINES[this.lang];
    if (!bank[pool]) return;
    this.seen.add(key);
    out.push({
      key, priority, kind: pool, channel,
      text: fill(pick(bank[pool], key), vars),
      staleMs
    });
  }

  /**
   * Everything worth saying about the difference between last time and now.
   *
   * @param {object} state    the broadcast state
   * @param {object} outlook  from race-model.outlook(), or null in a session it cannot model
   * @param {number} now      epoch ms, injected so a test does not depend on the clock
   * @returns {Array} lines, most urgent first
   */
  update(state, outlook, now = Date.now()) {
    const out = [];
    const race = state.race || {};

    /*
     * The first state is absorbed in silence.
     *
     * A Browser Source added to OBS halfway through a session arrives holding the whole
     * race: every penalty already given, whoever is leading, the flag. Announcing all of
     * that as though it had just happened is what it did the first time it was run against
     * a real server — it opened by reading out a penalty from the previous race. So the
     * first update only records where things stand, and commentary begins with the next
     * thing that actually changes.
     */
    if (!this.primed) {
      this.primed = true;
      this.started = ['green', 'yellow', 'safety', 'vsc', 'formation'].includes(race.status);
      this.ended = race.status === 'finished';
      for (const p of race.penalties || []) {
        this.seen.add(`pen:${p.id}`);
        this.seen.add(`inv:${p.id}`);
      }
      this.prev = snapshot(state);
      return out;
    }

    /*
     * After the chequered flag, nothing.
     *
     * Positions keep settling for several seconds after a race ends — a car still on track
     * crosses the line, the classification reshuffles — and the first version of this
     * called two lead changes and an overtake after it had already announced the finish.
     * Nobody commentates a pass that happened after the flag.
     */
    if (this.ended && race.status === 'finished') { this.prev = snapshot(state); return out; }
    if (race.status !== 'finished') this.ended = false;

    const lang = this.lang;
    const secs = (ms) => {
      const t = fmtGap(ms);
      return lang === 'id' ? `${t.replace('.', ',')} detik` : `${t} seconds`;
    };
    const drivers = (state.drivers || []).slice().sort((a, b) => a.position - b.position);
    const byId = new Map(drivers.map((d) => [d.id, d]));
    const prev = this.prev;
    const lap = Math.max(0, ...drivers.map((d) => d.lapsDone || 0));
    const drift = (state.event || {}).sessionType === 'drift';
    const nameOf = (d) => (d ? d.name : '');
    const running = drivers.filter((d) => !d.dnf);
    const leader = running.find((d) => d.position === 1) || running[0] || null;
    const second = running[1] || null;
    const leadGap = leader && second && second.totalMs != null && leader.totalMs != null
      ? second.totalMs - leader.totalMs : null;

    // ---------------------------------------------------------------- flags
    if (!prev || prev.race.status !== race.status) {
      const key = `flag:${race.status}:${race.startedAt || 0}:${lap}`;
      // "Racing again" only after something stopped it. Written the other way round at
      // first — anything that was not idle — and a race started straight after the previous
      // one had finished was announced as a restart.
      const restart = race.status === 'green' && prev
        && ['yellow', 'safety', 'vsc', 'red'].includes(prev.race.status);
      let pool = race.status === 'green' ? (restart ? 'restart' : 'green') : race.status;
      // The chequered flag is the one moment a name belongs in it. With no leader to name —
      // an empty grid, a session abandoned — it falls back to the plain wording rather than
      // announcing that nobody has won.
      if (race.status === 'finished') pool = leader ? 'finished' : 'finishedPlain';

      if (LINES[lang][pool]) {
        const urgent = ['red', 'finished', 'safety'].includes(race.status);
        // Ten seconds, not twenty: a flag nobody has managed to announce within ten is a
        // flag the viewer has already seen change on the timing tower.
        this.say(out, key, urgent ? P_URGENT : P_HIGH, pool, {
          leader: nameOf(leader), second: nameOf(running[1]), third: nameOf(running[2]),
          laps: race.totalLaps || 0, lap
        }, urgent ? 30000 : 10000, 'flag');
      }
      if (race.status === 'green') this.started = true;
      if (race.status === 'finished') this.ended = true;
    }

    // Nothing else is worth saying before the race has actually gone green: positions on a
    // grid are not overtakes, and a fastest lap in a warm-up is not news.
    if (!this.started && race.status !== 'finished') { this.prev = snapshot(state); return out; }

    // ---------------------------------------------------------------- drift
    if (drift) {
      const top = drivers[0];
      if (top) {
        this.say(out, `dlead:${top.id}:${top.driftScore}`, P_NORMAL, 'driftLead',
          { short: nameOf(top), score: top.driftScore }, 30000, 'driftlead');
      }
      const b = (state.drift || {}).battle;
      if (b && b.a && b.b) {
        this.say(out, `dbattle:${b.a}:${b.b}`, P_HIGH, 'driftBattle',
          { a: nameOf(byId.get(b.a)), b: nameOf(byId.get(b.b)) }, 30000);
      }
      this.prev = snapshot(state);
      return out.sort((a, z) => a.priority - z.priority);
    }

    // ---------------------------------------------------------------- retirements and pits
    for (const d of drivers) {
      const was = prev && prev.drivers.get(d.id);
      if (!was) continue;
      const vars = { who: this.who(d), short: d.name, pos: place(was.position, lang), lap };
      if (d.dnf && !was.dnf) this.say(out, `dnf:${d.id}`, P_HIGH, 'dnf', vars, 45000);
      if (d.pit && !was.pit) {
        this.say(out, `pitin:${d.id}:${lap}`, P_NORMAL, 'pitIn', vars, 15000);
      }
      if (!d.pit && was.pit) {
        this.say(out, `pitout:${d.id}:${lap}`, P_NORMAL, 'pitOut',
          { ...vars, pos: place(d.position, lang) }, 15000);
      }
      if (d.blueFlag && !was.blueFlag) {
        this.say(out, `blue:${d.id}:${lap}`, P_COLOUR, 'blue', vars, 12000);
      }
    }

    // ---------------------------------------------------------------- penalties
    for (const p of race.penalties || []) {
      const d = byId.get(p.driverId);
      if (!d) continue;
      if (p.status === 'applied') {
        // A penalty for the driver in fourth is a fact. A penalty for the driver leading is
        // the story of the race, and the sentence should know the difference.
        const costly = d.position <= 3;
        this.say(out, `pen:${p.id}`, P_HIGH, costly ? 'penaltyCost' : 'penalty', {
          who: this.who(d), short: d.name, headline: penHeadline(p, lang),
          reason: p.reason || (lang === 'id' ? 'sebuah insiden' : 'an incident'),
          pos: place(d.position, lang)
        }, 60000);
      } else if (p.status === 'investigating') {
        this.say(out, `inv:${p.id}`, P_NORMAL, 'investigating',
          { short: d.name, lap: p.lap ?? lap }, 40000);
      }
    }

    // ---------------------------------------------------------------- the lead
    if (leader && (!prev || prev.leaderId !== leader.id)) {
      // Who lost it. Naming them is most of the difference between a caption and a call.
      const victim = prev && prev.leaderId ? byId.get(prev.leaderId) : null;
      const usable = victim && !victim.dnf && !victim.pit;
      this.say(out, `lead:${leader.id}:${lap}`, P_HIGH, usable ? 'leadFrom' : 'lead', {
        who: this.who(leader), short: leader.name, victim: nameOf(victim), lap
      }, 20000, 'lead');
    }

    // ---------------------------------------------------------------- places changing
    if (prev) {
      for (const d of drivers) {
        const was = prev.drivers.get(d.id);
        if (!was || d.dnf || d.pit || was.pit) continue;

        if (d.position < was.position && d.position !== 1) {
          /*
           * Who was passed.
           *
           * The car that was ahead of this one and is now behind it. Anything else is a
           * coincidence of the classification — a retirement in front, a pit stop — and
           * naming somebody who was not overtaken is worse than naming nobody, so the pool
           * changes rather than the sentence guessing.
           */
          const victim = drivers.find((x) => {
            const w = prev.drivers.get(x.id);
            return w && x.id !== d.id && w.position < was.position
              && x.position > d.position && !x.dnf && !x.pit && !w.pit;
          });
          const podium = d.position <= 3;
          const pool = victim ? (podium ? 'overtakePodium' : 'overtakeOn') : 'overtake';
          this.say(out, `up:${d.id}:${d.position}:${lap}`, P_NORMAL, pool, {
            short: d.name, victim: nameOf(victim), pos: place(d.position, lang), lap
          }, 15000);
        } else if (d.position > was.position && d.position - was.position >= 2) {
          // One place lost is usually the other half of an overtake already announced.
          this.say(out, `down:${d.id}:${d.position}:${lap}`, P_COLOUR, 'lost',
            { short: d.name, pos: place(d.position, lang) }, 12000);
        }
      }
    }

    // ---------------------------------------------------------------- fastest lap
    const byBest = drivers.filter((d) => d.bestLap != null).sort((a, b) => a.bestLap - b.bestLap);
    const quickest = byBest[0];
    if (quickest) {
      const margin = byBest[1] ? byBest[1].bestLap - quickest.bestLap : null;
      // Only worth calling a margin when there is one. Three thousandths is not a gap, it is
      // two drivers doing the same lap time.
      const wide = margin != null && margin > 300;
      this.say(out, `fl:${quickest.id}:${quickest.bestLap}`, P_NORMAL,
        wide ? 'fastestMargin' : 'fastest', {
          who: this.who(quickest), short: quickest.name,
          time: fmtGap(quickest.bestLap).replace('.', lang === 'id' ? ',' : '.'),
          margin: margin != null ? secs(margin) : ''
        }, 20000);
    }

    // ---------------------------------------------------------------- how long is left
    if (outlook && outlook.lapsLeft != null && race.status !== 'finished') {
      const n = outlook.lapsLeft;
      const vars = { n, leader: nameOf(leader), gap: leadGap != null ? secs(leadGap) : '' };
      if (n === 1) {
        this.say(out, `left:1:${race.startedAt}`, P_HIGH, 'finalLap', vars, 15000, 'left');
      } else if ([3, 5, 10].includes(n)) {
        const pool = leadGap != null && leadGap > 400 ? 'lapsLeftGap' : 'lapsLeft';
        this.say(out, `left:${n}:${race.startedAt}`, P_COLOUR, pool, vars, 15000, 'left');
      }
    }

    // ---------------------------------------------------------------- battles
    for (let i = 1; i < drivers.length; i++) {
      const b = drivers[i], a = drivers[i - 1];
      if (b.dnf || a.dnf || b.pit || a.pit) continue;
      const gap = (b.totalMs || 0) - (a.totalMs || 0);
      if (gap > 0 && gap < 700) {
        // What the fight is for changes what is worth saying about it.
        const pool = a.position === 1 ? 'battleLead' : a.position <= 3 ? 'battlePodium' : 'battle';
        this.say(out, `battle:${a.id}:${b.id}:${Math.floor(lap / 2)}`, P_NORMAL, pool, {
          a: a.name, b: b.name, gap: secs(gap), pos: place(a.position, lang)
        }, 12000);
      }
    }

    // ---------------------------------------------------------------- trouble
    for (const r of (outlook && outlook.risks) || []) {
      const d = r.driver;
      if (!d) continue;
      if (r.kind === 'fading') {
        this.say(out, `fade:${d.id}:${Math.floor(lap / 3)}`, P_COLOUR, 'fading',
          { short: d.name }, 20000);
      }
      if (r.kind === 'closing') {
        const on = byId.get(r.on);
        this.say(out, `close:${d.id}:${r.on}:${lap}`, P_COLOUR, 'closing', {
          a: nameOf(on), b: d.name, closing: secs(r.closing), gap: secs(r.gap)
        }, 12000);
      }
    }

    // ---------------------------------------------------------------- the outlook
    //
    // Said on a timer rather than on a change, because the probabilities move every lap and
    // a commentator who reads out every movement of them is a commentator nobody listens to.
    if (outlook && outlook.drivers.length && race.status === 'green'
        && now - this.lastColourAt > 75000) {
      this.lastColourAt = now;
      const top = outlook.drivers[0];
      const runnerUp = outlook.drivers[1];
      const d = byId.get(top.id);
      const pct = Math.round(top.win * 100);
      const stamp = Math.floor(now / 75000);

      if (outlook.confidence === 'thin') {
        this.say(out, `thin:${stamp}`, P_COLOUR, 'thin', {}, 20000, 'outlook');
      } else {
        const pool = top.win >= 0.75 ? 'winStrong' : top.win >= 0.4 ? 'winFavoured' : 'winOpen';
        this.say(out, `win:${stamp}`, P_COLOUR, pool, {
          short: nameOf(d), pct,
          second: runnerUp ? nameOf(byId.get(runnerUp.id)) : '',
          pct2: runnerUp ? Math.round(runnerUp.win * 100) : ''
        }, 30000, 'outlook');

        // The podium is only worth a sentence while it is undecided.
        const contenders = outlook.drivers.filter((x) => x.podium > 0.12).slice(0, 4);
        if (contenders.length > 3) {
          this.say(out, `pod:${stamp}`, P_COLOUR, 'podium', {
            names: contenders.slice(0, 3).map((x) => nameOf(byId.get(x.id))).join(', ')
          }, 30000);
        } else if (contenders.length) {
          const edge = contenders[contenders.length - 1];
          this.say(out, `podfight:${stamp}`, P_COLOUR, 'podiumFight', {
            short: nameOf(byId.get(edge.id)), pct: Math.round(edge.podium * 100)
          }, 30000);
        }
      }
    }

    this.prev = snapshot(state);
    this.prevOutlook = outlook;
    return out.sort((a, z) => a.priority - z.priority);
  }
}

/** Only what the next comparison needs. Holding the whole state would keep every lap alive. */
function snapshot(state) {
  const drivers = new Map();
  for (const d of state.drivers || []) {
    drivers.set(d.id, {
      position: d.position, dnf: d.dnf, pit: d.pit, blueFlag: d.blueFlag,
      lapsDone: d.lapsDone, totalMs: d.totalMs
    });
  }
  const leader = (state.drivers || []).find((d) => d.position === 1 && !d.dnf);
  return {
    race: { status: state.race.status, startedAt: state.race.startedAt },
    drivers,
    leaderId: leader ? leader.id : null
  };
}
