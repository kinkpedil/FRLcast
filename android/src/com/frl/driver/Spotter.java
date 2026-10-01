package com.frl.driver;

import android.content.Context;
import android.media.AudioAttributes;
import android.os.Build;
import android.speech.tts.TextToSpeech;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * The spotter: the phone says the call out loud.
 *
 * A driver mid-corner cannot read the floating window, however big it is drawn. A real
 * spotter's job is to put the important thing in the driver's ear the moment it happens,
 * so this does the same with the phone's own text-to-speech: no server, no download, and it
 * works on a hosted event and a laptop one alike because it speaks what the poll already
 * carries.
 *
 * Short, fixed phrases on purpose. A call has to be understood at speed over engine noise,
 * so it says "Yellow flag" rather than a sentence about one. Only a message somebody typed
 * (race control's note, a teammate's radio, a penalty reason) is read as written.
 *
 * Calls that change the race (a flag, a penalty) flush whatever is still being said; the
 * rest queue behind it. Off when the driver turns it off, checked on every call, so the
 * switch works at once without restarting the window.
 */
final class Spotter {
  private final Context ctx;
  private TextToSpeech tts;
  private boolean ready = false;
  // Calls made before the engine finished starting, said as soon as it is ready.
  private final List<String> early = new ArrayList<>();

  Spotter(Context ctx) { this.ctx = ctx.getApplicationContext(); }

  static boolean enabled(Context c) { return Api.prefs(c).getBoolean(Api.K_VOICE, true); }

  /** Something that changes the race: said now, cutting off anything older. */
  void urgent(String text) { say(text, true); }

  /** Information: waits its turn behind whatever is being said. */
  void info(String text) { say(text, false); }

  private void say(String text, boolean flush) {
    if (text == null || text.trim().isEmpty() || !enabled(ctx)) return;
    if (tts == null) start();
    if (!ready) {
      if (flush) early.clear();
      early.add(text);
      return;
    }
    tts.speak(text, flush ? TextToSpeech.QUEUE_FLUSH : TextToSpeech.QUEUE_ADD, null,
        "frl" + System.nanoTime());
  }

  private void start() {
    tts = new TextToSpeech(ctx, status -> {
      if (status != TextToSpeech.SUCCESS || tts == null) return;
      // The calls are written in English, so they are spoken in English whatever the
      // phone's language is; an Indonesian voice reading "Safety car" is harder to catch.
      int r = tts.setLanguage(Locale.US);
      if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) tts.setLanguage(Locale.ENGLISH);
      tts.setSpeechRate(1.1f);
      if (Build.VERSION.SDK_INT >= 21) {
        // Game audio, not a ringtone: it follows the media volume the game is played at.
        tts.setAudioAttributes(new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build());
      }
      ready = true;
      for (String s : early) tts.speak(s, TextToSpeech.QUEUE_ADD, null, "frl" + System.nanoTime());
      early.clear();
    });
  }

  void shutdown() {
    ready = false;
    early.clear();
    if (tts != null) {
      try { tts.stop(); tts.shutdown(); } catch (Exception ignored) { /* already gone */ }
      tts = null;
    }
  }

  // ---------------------------------------------------------------- the phrases

  /** The call for a session flag, or null for one not worth saying (idle). */
  static String flagCall(String flag, String previous) {
    switch (flag) {
      case "formation": return "Formation lap";
      case "green":
        // From a safety car or a red the race is restarting, not continuing.
        return ("safety".equals(previous) || "vsc".equals(previous) || "red".equals(previous)
            || "yellow".equals(previous)) ? "Green flag, track clear" : "Green flag, go go go";
      case "yellow":    return "Yellow flag";
      case "safety":    return "Safety car, safety car";
      case "vsc":       return "Virtual safety car";
      case "white":     return "White flag";
      case "red":       return "Red flag, slow down";
      case "finished":  return "Chequered flag";
      default:          return null;
    }
  }

  /** A penalty as a spoken line: what it is, then why. */
  static String penaltyCall(String type, int seconds, String status, String reason) {
    String what;
    if ("investigating".equals(status)) what = "Under investigation";
    else switch (type) {
      case "time":         what = (seconds > 0 ? seconds + " second " : "") + "time penalty"; break;
      case "drivethrough": what = "Drive through penalty"; break;
      case "warning":      what = "Warning from race control"; break;
      case "blackflag":    what = "Black flag"; break;
      case "dq":           what = "Disqualified"; break;
      default:             what = "Penalty";
    }
    return reason == null || reason.isEmpty() ? what : what + ". " + reason;
  }
}
