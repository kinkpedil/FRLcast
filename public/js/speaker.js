/*
 * Saying it out loud.
 *
 * The queue is the whole job. A sentence takes three to five seconds; during a busy lap
 * things happen faster than that, and a commentator who reads every one of them in the
 * order it arrived is describing the race as it was half a minute ago. So lines wait in
 * priority order, they expire, and a red flag cuts off whatever is mid-sentence.
 *
 * The engine underneath is the browser's own speechSynthesis: free, offline, no key, and
 * already present in OBS's browser source. It is not a beautiful voice. Everything above
 * this line — what to say, when, and what to drop — is the part that decides whether it
 * sounds like commentary, and none of it changes if a nicer engine is ever bolted on: see
 * speak() at the bottom, which is the only place that knows what makes the sound.
 */

/*
 * Chrome suspends synthesis in a background tab, and an OBS browser source is always in
 * one, so something has to notice and lift it. How that is done matters: the first version
 * called resume() on a timer whether or not anything was paused, and resume() on an
 * utterance that is already playing restarts the audio pipeline. It came out of the
 * speakers as a stutter every few seconds. It is only ever called now when the engine
 * actually reports itself paused.
 */
const KEEPALIVE_MS = 4000;

/** A breath between lines. Run together they sound like one long sentence read by a robot. */
const GAP_MS = 260;

export class Speaker {

  /**
   * @param {object} opts
   *   lang        preferred voice language, "id-ID" by default
   *   rate        0.5..2, 1.05 sounds like speech rather than dictation
   *   volume      0..1
   *   maxQueue    beyond this, the least urgent waiting line is dropped
   *   say         injectable, so a test can run the queue with no browser at all
   */
  constructor(opts = {}) {
    this.lang = opts.lang || 'id-ID';
    // An exact voice the operator picked, or '' to let the language decide.
    this.voiceName = opts.voiceName || '';
    this.rate = opts.rate ?? 1.05;
    this.pitch = opts.pitch ?? 1;
    this.volume = opts.volume ?? 1;
    this.maxQueue = opts.maxQueue ?? 6;
    this.enabled = opts.enabled ?? true;

    /** { word: "as it should be read" }, for names no engine gets right. */
    this.saying = opts.saying || {};

    this.queue = [];
    this.current = null;
    this.spoken = [];            // recent lines, newest first, for an on-screen caption
    this.onchange = opts.onchange || (() => {});

    // Which engine makes the sound. 'browser' is speechSynthesis (free, offline, robotic in
    // OBS's Chromium); 'piper' posts the text to the local server's /api/tts and plays the
    // wav it returns (a natural neural voice). Piper falls back to the browser voice for any
    // line it cannot fetch, so switching to it can never leave the commentary silent.
    this.engine = opts.engine || 'browser';
    this.ttsUrl = opts.ttsUrl || '/api/tts';
    this._audio = null;              // the currently-playing piper <audio>, so cancel() can stop it

    // The seam. Injected in tests; the real one is at the bottom of this file.
    this._speak = opts.say || null;
    this._now = opts.now || (() => Date.now());
    this.voice = null;
  }

  // ---------------------------------------------------------------- voices

  /**
   * Pick a voice, once the browser admits it has any.
   *
   * getVoices() is empty on the first call in Chrome and fills in later, which is why this
   * is a promise and not a property. Indonesian is not installed by default on Windows; if
   * it is missing, an English voice reading Indonesian is worse than useless, so that is
   * reported rather than papered over.
   */
  async chooseVoice(synth = globalThis.speechSynthesis) {
    if (!synth) return { ok: false, error: 'This browser has no speech engine' };

    const load = () => new Promise((resolve) => {
      const got = synth.getVoices();
      if (got.length) return resolve(got);
      const t = setTimeout(() => resolve(synth.getVoices()), 1500);
      synth.onvoiceschanged = () => { clearTimeout(t); resolve(synth.getVoices()); };
    });

    const voices = await load();
    if (!voices.length) return { ok: false, error: 'No voices installed' };

    /*
     * A named voice wins, when the machine has it.
     *
     * The operator picks from the list their console can see, and the page that does the
     * speaking may be on the streaming machine instead — a different set of voices, and
     * sometimes none of the same ones. Saying so is better than silently reading the race
     * in a voice nobody chose.
     */
    if (this.voiceName) {
      const exact = voices.find((v) => v.name === this.voiceName);
      if (exact) {
        this.voice = exact;
        return { ok: true, voice: exact.name, voices, picked: true };
      }
    }

    const want = this.lang.toLowerCase();
    const base = want.split('-')[0];
    this.voice = voices.find((v) => v.lang.toLowerCase() === want)
      || voices.find((v) => v.lang.toLowerCase().startsWith(base))
      || null;

    if (this.voiceName && this.voice) {
      return {
        ok: true, voice: this.voice.name, voices, missing: this.voiceName,
        error: `"${this.voiceName}" is not installed on this machine. Using `
             + `${this.voice.name} instead.`
      };
    }

    if (!this.voice) {
      this.voice = voices.find((v) => v.default) || voices[0];
      return {
        ok: false, voice: this.voice.name, voices,
        error: `No ${this.lang} voice is installed. Windows: Settings, Time and language, `
             + `Speech, Manage voices. Until then it will be read by ${this.voice.name}, `
             + 'which will mispronounce most of it.'
      };
    }
    return { ok: true, voice: this.voice.name, voices };
  }

  /**
   * The language actually coming out of the speakers.
   *
   * Not the same as the setting. Ask for Indonesian on a machine that has no Indonesian
   * voice and an English one reads it; the sentences should then be English too, rather
   * than Indonesian words in an English mouth, which is unintelligible.
   */
  spokenLang() {
    const lang = this.voice ? this.voice.lang : this.lang;
    return String(lang || 'en').slice(0, 2).toLowerCase();
  }

  // ---------------------------------------------------------------- the queue

  /**
   * Offer lines. Which ones are actually spoken is decided here, not by the caller.
   *
   * @param {Array} lines  { key, text, priority, staleMs }
   */
  offer(lines) {
    if (!this.enabled) return;
    const now = this._now();

    for (const line of lines) {
      if (this.queue.some((q) => q.key === line.key)) continue;
      if (this.current && this.current.key === line.key) continue;

      const item = { ...line, at: now, deadline: now + (line.staleMs || 20000) };

      /*
       * A newer line on the same subject replaces the older one outright.
       *
       * Found by running a race: the flag went yellow, then green, then chequered inside
       * twenty seconds, and each announcement takes four to speak. The queue read them in
       * priority order, so the chequered flag cut in first and the green flag was announced
       * after the race had ended — "the track is clear, go and attack" over a finished
       * race. Expiry alone could not fix it, because the green line was still well within
       * its own lifetime. What made it wrong was not its age but that the flag had changed.
       */
      if (item.channel) {
        this.queue = this.queue.filter((q) => q.channel !== item.channel);
        if (this.current && this.current.channel === item.channel
            && item.priority <= this.current.priority) {
          this.cancel();
        }
      }

      // Something urgent does not wait behind three gap updates. It cuts in, and everything
      // that was not itself urgent is dropped: by the time this has been said, it is history.
      if (item.priority <= 1) {
        this.queue = this.queue.filter((q) => q.priority <= 1);
        this.queue.unshift(item);
        this.cancel();
      } else {
        this.queue.push(item);
      }
    }

    this.trim();
    this.pump();
  }

  /** Sort by urgency then by age, and throw away what will not fit. */
  trim() {
    const now = this._now();
    this.queue = this.queue
      .filter((q) => q.deadline > now)
      .sort((a, b) => a.priority - b.priority || a.at - b.at);
    if (this.queue.length > this.maxQueue) this.queue.length = this.maxQueue;
  }

  /** Start the next line, if nothing is talking. */
  pump() {
    if (!this.enabled || this.current) return;
    this.trim();
    const next = this.queue.shift();
    if (!next) return;

    this.current = next;
    this.spoken.unshift({ ...next, spokenAt: this._now() });
    this.spoken.length = Math.min(this.spoken.length, 12);
    this.onchange(this);

    const done = () => {
      this.current = null;
      this.onchange(this);
      // Straight on to the next: a pause between lines is what makes it sound like a
      // machine reading a list rather than somebody talking.
      this.pump();
    };

    try {
      const speak = this._speak || defaultSpeak(this);
      speak(this.pronounce(next.text), done);
    } catch (err) {
      console.warn('[speaker]', err.message || err);
      done();
    }
  }

  /**
   * Names, as they should be read.
   *
   * Every engine mangles a racing name eventually, and there is no rule that fixes it: the
   * operator types what it should sound like, once, and it applies everywhere the name is
   * spoken. Longest first, so "Kinkpedil Racing" wins over "Kinkpedil".
   */
  pronounce(text) {
    const keys = Object.keys(this.saying).sort((a, b) => b.length - a.length);
    let out = text;
    for (const k of keys) {
      if (!k.trim()) continue;
      const safe = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(new RegExp(safe, 'gi'), this.saying[k]);
    }
    return out;
  }

  cancel() {
    const synth = globalThis.speechSynthesis;
    if (synth) { try { synth.cancel(); } catch { /* nothing to cancel */ } }
    if (this._audio) {
      try { this._audio.onended = this._audio.onerror = null; this._audio.pause(); } catch { /* already stopped */ }
      this._audio = null;
    }
    this.current = null;
  }

  /** Stop, and forget what was waiting. A restart is not the moment to catch up. */
  silence() {
    this.queue = [];
    this.cancel();
    this.onchange(this);
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (!on) this.silence(); else this.pump();
  }
}

/**
 * The one place that makes a sound.
 *
 * Kept apart so the queue above can be tested with no browser, and so a different engine is
 * a replacement for this and nothing else. It dispatches on the speaker's engine: Piper when
 * asked for, the browser otherwise, and Piper falls back to the browser per line on failure.
 */
function defaultSpeak(speaker) {
  const browser = browserSpeak(speaker);
  return (text, done) => {
    if (speaker.engine === 'piper') return piperSpeak(speaker, text, done, browser);
    return browser(text, done);
  };
}

/**
 * Piper: post the line to the local server, play the wav it returns.
 *
 * Any failure — no server, Piper not set up, a hosted event with no /api/tts at all — falls
 * back to the browser voice for this one line, so choosing Piper never risks silence.
 */
function piperSpeak(speaker, text, done, fallback) {
  let settled = false;
  const finish = () => { if (settled) return; settled = true; setTimeout(done, GAP_MS); };
  fetch(speaker.ttsUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice: speaker.voiceName || '' })
  })
    .then((r) => { if (!r.ok) throw new Error(`tts ${r.status}`); return r.blob(); })
    .then((blob) => {
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.volume = speaker.volume;
      speaker._audio = audio;
      const end = () => { URL.revokeObjectURL(url); if (speaker._audio === audio) speaker._audio = null; finish(); };
      audio.onended = end;
      audio.onerror = end;
      audio.play().catch(end);
    })
    .catch(() => { if (!settled) { settled = true; fallback(text, done); } });
}

/** The browser's own speechSynthesis. */
function browserSpeak(speaker) {
  return (text, done) => {
    const synth = globalThis.speechSynthesis;
    if (!synth) { done(); return; }

    const u = new SpeechSynthesisUtterance(text);
    if (speaker.voice) u.voice = speaker.voice;
    u.lang = speaker.voice ? speaker.voice.lang : speaker.lang;
    u.rate = speaker.rate;
    u.pitch = speaker.pitch;
    u.volume = speaker.volume;

    let finished = false;
    let tick = null;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearInterval(tick);
      setTimeout(done, GAP_MS);
    };

    u.onend = finish;
    // An engine that errors and never calls onend would stop the commentary for the rest of
    // the evening, which is the one failure worth guarding against here.
    u.onerror = finish;

    /*
     * The watchdog, started only once the engine says it has begun.
     *
     * Two things it must not do. It must not resume an utterance that is playing, which is
     * what made the voice stutter. And it must not read `speaking` before the engine has
     * started, because it is false in the moment between speak() and the first audio and
     * this would call the line finished before a word came out.
     */
    u.onstart = () => {
      clearInterval(tick);
      tick = setInterval(() => {
        if (!synth.speaking) return finish();
        if (synth.paused) { try { synth.resume(); } catch { /* no pause on this engine */ } }
      }, KEEPALIVE_MS);
    };

    // A last resort. If onstart never arrives the engine has swallowed the line, and the
    // commentary must not stop for the rest of the evening because of it.
    setTimeout(() => { if (!finished && !synth.speaking) finish(); }, 2500);

    synth.speak(u);
  };
}
