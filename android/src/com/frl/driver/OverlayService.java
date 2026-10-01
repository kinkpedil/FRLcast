package com.frl.driver;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.PixelFormat;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.Settings;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.Set;

/**
 * The floating window, and the thing that keeps it fed.
 *
 * A foreground service because the driver is going to leave this app immediately: they
 * are here to race, and an activity would be stopped the moment FR Legends came forward.
 * The notification is the price Android charges for staying alive, and it is a fair one.
 */
public class OverlayService extends Service {

  public static final String ACTION_STOP = "com.frl.driver.STOP";
  /** Change the live window's opacity without tearing it down and putting it back up. */
  public static final String ACTION_ALPHA = "com.frl.driver.ALPHA";
  private static final String CHANNEL = "frl-flag";
  // Its own channel, at high importance, so a penalty pushes a heads-up banner over the
  // game instead of sliding quietly into the shade behind the ongoing service notice.
  // Separate also means the driver can silence one without losing the other.
  private static final String CHANNEL_PENALTY = "frl-penalty";
  // Team radio gets its own channel so a driver can silence pit chatter without losing
  // penalties, and vice versa.
  private static final String CHANNEL_RADIO = "frl-radio";
  private static final int NOTE_ID = 42;
  private static final long POLL_MS = 1500;
  /*
   * How long a penalty holds the window.
   *
   * Long enough to read a headline and a reason at a glance between corners, short enough
   * that the flag (the thing that is true continuously) is never hidden for long.
   */
  private static final long PENALTY_MS = 8000;

  private WindowManager wm;
  private FlagView view;
  private WindowManager.LayoutParams lp;

  private HandlerThread net;
  private Handler netHandler;
  private final Handler ui = new Handler(Looper.getMainLooper());

  private String lastFlag = null;
  // The spotter, and what it last said about this driver, so each call is made once when it
  // changes rather than on every poll it stays true.
  private Spotter spot;
  private boolean lastBlack = false, lastBlue = false;
  // What the spotter last said about a drift event: each call once, when it changes.
  private String lastDriftTrack = "", lastDriftResult = "", lastDriftNext = "";
  private String lastDriftScore = "";
  private int lastLights = 0, lastLeft = -1, lastServe = -1;
  private String lastMsg = "";
  // The last team-radio message shown. null means "not seeded yet": the first poll after the
  // window opens records whatever is current without announcing it, so a driver joining
  // mid-race is not hit with a pit call that was sent before they were even looking. Kept as
  // a String because the id is a number on the laptop server and a UUID on the hosted event.
  private String lastRadioId = null;
  private volatile boolean running = false;

  /*
   * Which penalties have already been announced.
   *
   * Keyed by id *and* status, so a finding that starts as an investigation and is later
   * upheld announces twice: those are two different things to be told, and a driver who
   * only heard "under investigation" does not know they are now carrying five seconds.
   *
   * Kept on disk because the phone will kill this service during a long race and the
   * driver must not get the whole afternoon's penalties again when it comes back.
   */
  private static final String K_SEEN = "seenPenalties";
  private Set<String> announced = new HashSet<>();

  /** Hands the window back to the flag once a penalty has had its turn. */
  private final Runnable clearPenalty = () -> { if (view != null) view.clearPenalty(); };

  public static boolean canDraw(Context c) {
    return Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(c);
  }

  @Override public IBinder onBind(Intent i) { return null; }

  @Override public int onStartCommand(Intent intent, int flags, int startId) {
    String action = intent == null ? null : intent.getAction();
    if (ACTION_STOP.equals(action)) {
      stopSelf();
      return START_NOT_STICKY;
    }
    // Opacity is applied to the live view, not by restarting the window. Restarting on every
    // step of the slider drag stops and starts the service dozens of times a second, which
    // Android will not tolerate and the app is killed. This just repaints the view instead.
    if (ACTION_ALPHA.equals(action)) {
      if (running && view != null) {
        int pct = Math.max(25, Api.prefs(this).getInt(Api.K_ALPHA, 100));
        view.setAlpha(pct / 100f);
      } else {
        stopSelf();          // an alpha ping with no window: never start a bare service from it
      }
      return START_STICKY;
    }
    if (running) return START_STICKY;

    // Without the permission the window simply never appears, and a service running
    // invisibly is worse than one that never started.
    if (!canDraw(this)) { stopSelf(); return START_NOT_STICKY; }

    announced = new HashSet<>(Api.prefs(this).getStringSet(K_SEEN, new HashSet<>()));

    startForeground(NOTE_ID, notification());
    spot = new Spotter(this);
    addWindow();
    startPolling();
    running = true;
    return START_STICKY;
  }

  // ---------------------------------------------------------------- the window

  private void addWindow() {
    wm = (WindowManager) getSystemService(WINDOW_SERVICE);
    SharedPreferences p = Api.prefs(this);
    view = new FlagView(this);
    view.setShowSub(p.getBoolean(Api.K_SUB, true));
    view.setAlpha(p.getInt(Api.K_ALPHA, 100) / 100f);

    int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
        ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        : WindowManager.LayoutParams.TYPE_PHONE;

    // Defaults in dp, not raw pixels: 420px is a comfortable window on a 1080p phone and
    // a postage stamp on a 1440p one.
    float d = getResources().getDisplayMetrics().density;
    lp = new WindowManager.LayoutParams(
        p.getInt(Api.K_W, (int) (150 * d)), p.getInt(Api.K_H, (int) (100 * d)), type,
        // NOT_FOCUSABLE keeps the keyboard and the back button belonging to the game
        // underneath; this window still receives its own touches.
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
        PixelFormat.TRANSLUCENT);
    lp.gravity = Gravity.TOP | Gravity.START;
    lp.x = p.getInt(Api.K_X, (int) (16 * d));
    lp.y = p.getInt(Api.K_Y, (int) (80 * d));

    // A preset (or a saved size from a bigger screen) can put the window's bottom-right
    // corner past the edge of the display. That corner is the resize grip, so once it is
    // off screen the driver cannot shrink the window again by any means. Found by setting
    // the largest preset while the window sat near the right edge.
    fitOnScreen();

    view.setOnTouchListener(new Dragger());
    wm.addView(view, lp);
  }

  /**
   * Move by dragging the body, resize by dragging the corner.
   *
   * There is no minimum imposed beyond a floor that keeps the window findable again, and
   * no maximum at all. That is the entire reason this app exists rather than a web page.
   */
  private class Dragger implements View.OnTouchListener {
    private int startX, startY, startW, startH;
    private float touchX, touchY;
    private boolean resizing;

    @Override public boolean onTouch(View v, MotionEvent e) {
      switch (e.getActionMasked()) {
        case MotionEvent.ACTION_DOWN:
          resizing = view.onGrip(e.getX(), e.getY());
          startX = lp.x; startY = lp.y;
          startW = lp.width; startH = lp.height;
          touchX = e.getRawX(); touchY = e.getRawY();
          return true;

        case MotionEvent.ACTION_MOVE: {
          int dx = (int) (e.getRawX() - touchX);
          int dy = (int) (e.getRawY() - touchY);
          if (resizing) {
            // Capped at the display so the grip cannot be pushed out of reach.
            android.graphics.Point size = new android.graphics.Point();
            wm.getDefaultDisplay().getSize(size);
            lp.width = Math.max(FlagView.MIN_PX, Math.min(startW + dx, size.x - lp.x));
            lp.height = Math.max(FlagView.MIN_PX, Math.min(startH + dy, size.y - lp.y));
          } else {
            lp.x = startX + dx;
            lp.y = startY + dy;
            keepReachable();
          }
          wm.updateViewLayout(view, lp);
          return true;
        }

        case MotionEvent.ACTION_UP:
        case MotionEvent.ACTION_CANCEL:
          // Remembered on release rather than on every frame of the drag: this is a disk
          // write, and a drag produces sixty of them a second.
          Api.prefs(OverlayService.this).edit()
              .putInt(Api.K_W, lp.width).putInt(Api.K_H, lp.height)
              .putInt(Api.K_X, lp.x).putInt(Api.K_Y, lp.y)
              .apply();
          return true;
      }
      return false;
    }
  }

  /**
   * Keep a corner of the window on screen.
   *
   * The only limit on dragging. Without it a window can be pushed entirely past the edge,
   * and since there is nothing left to grab it can never be pulled back: the driver would
   * have to reinstall the app to see their flags again.
   */
  /** Bring the whole window, grip included, inside the display. */
  private void fitOnScreen() {
    android.graphics.Point size = new android.graphics.Point();
    wm.getDefaultDisplay().getSize(size);
    lp.width = Math.max(FlagView.MIN_PX, Math.min(lp.width, size.x));
    lp.height = Math.max(FlagView.MIN_PX, Math.min(lp.height, size.y));
    lp.x = Math.max(0, Math.min(size.x - lp.width, lp.x));
    lp.y = Math.max(0, Math.min(size.y - lp.height, lp.y));
  }

  private void keepReachable() {
    android.graphics.Point size = new android.graphics.Point();
    wm.getDefaultDisplay().getSize(size);
    int edge = (int) (36 * getResources().getDisplayMetrics().density);
    lp.x = Math.max(edge - lp.width, Math.min(size.x - edge, lp.x));
    lp.y = Math.max(0, Math.min(size.y - edge, lp.y));
  }

  // ---------------------------------------------------------------- the feed

  private void startPolling() {
    net = new HandlerThread("frl-poll");
    net.start();
    netHandler = new Handler(net.getLooper());
    netHandler.post(poll);
  }

  private final Runnable poll = new Runnable() {
    @Override public void run() {
      String host = Api.host(OverlayService.this);
      String token = Api.token(OverlayService.this);
      if (!host.isEmpty() && !token.isEmpty()) {
        try {
          JSONObject o = Backend.forTarget(host).state(token);
          if (!o.optBoolean("ok")) {
            // The event has ended this session. Nothing the overlay can do about it, and
            // showing a stale flag from here on would be actively dangerous.
            ui.post(() -> stopSelf());
            return;
          }
          ui.post(() -> apply(o));
        } catch (Exception ignored) {
          // Out of range, server restarting, wifi hiccup. Try again in a moment; a driver
          // does not need to be told about a dropped packet.
        }
      }
      if (netHandler != null) netHandler.postDelayed(this, POLL_MS);
    }
  };

  private void apply(JSONObject o) {
    if (view == null) return;
    String flag = o.optString("flag", "idle");
    boolean approved = "approved".equals(o.optString("status"));
    if (!approved) flag = "idle";

    JSONObject me = o.optJSONObject("me");
    JSONObject d = o.optJSONObject("driver");
    String who = "";
    if (d != null) {
      who = d.optString("nick", "") + " #" + d.optString("num", "");
      if (me != null && me.optInt("position") > 0) who += "  ·  P" + me.optInt("position");
    }

    // A flag shown to this driver alone outranks the session's: being told to come in is
    // not something that should sit behind a green.
    String personal = "";
    if (me != null) {
      int lights = me.optInt("lights", 0);
      String opMsg = me.optString("message", "");
      if (me.optBoolean("blackFlag")) personal = "BLACK FLAG: PIT NOW";
      // The start gantry, so the grid sees the same countdown as the gantry and the overlay.
      else if (lights >= 1 && lights <= 5) personal = "GET READY  " + lightDots(lights);
      else if (lights >= 6) personal = "GO  " + lightDots(6);
      // A note race control typed for this driver.
      else if (!opMsg.isEmpty()) personal = opMsg;
      else if (me.optBoolean("blueFlag")) personal = "BLUE FLAG: LET THEM BY";
      else {
        // A drift event: on track first, then the result, then who is up next.
        JSONObject dr = me.optJSONObject("drift");
        if (dr != null) {
          JSONObject bt = dr.optJSONObject("battle");
          JSONObject nx = dr.optJSONObject("upNext");
          if ("battle".equals(dr.optString("onTrack")) && bt != null) {
            personal = "RUN " + bt.optInt("run", 1) + ": YOU " + ("lead".equals(bt.optString("role")) ? "LEAD" : "CHASE")
                + " vs " + bt.optString("opponent");
          } else if ("solo".equals(dr.optString("onTrack"))) {
            personal = "YOUR QUALIFYING RUN";
          } else if (bt != null && !bt.isNull("result") && !bt.optString("result").isEmpty()) {
            personal = "won".equals(bt.optString("result")) ? "YOU BEAT " + bt.optString("opponent") : "OUT: " + bt.optString("opponent") + " WON";
          } else if (nx != null) {
            personal = "UP NEXT: " + nx.optString("round") + " vs " + nx.optString("opponent");
          }
        }
      }
    }

    view.update(flag, who, personal);
    view.setBoard(approved && Api.prefs(this).getBoolean(Api.K_BOARD, true) ? pitBoard(me) : "");

    // After the window has been updated, so a penalty landing on this same poll paints
    // over the flag rather than being painted over by it.
    announcePenalties(o.optJSONArray("penalties"));
    announceRadio(o.optJSONObject("radio"));

    // The spotter's calls about this driver. Nothing is said on the first poll (lastFlag is
    // still null): that one only records where things stand, so opening the window mid-race
    // does not read out everything that is already true.
    boolean seeded = lastFlag != null;
    boolean saidStart = false;
    if (me != null && approved) {
      boolean black = me.optBoolean("blackFlag");
      boolean blue = me.optBoolean("blueFlag");
      String opMsg = me.optString("message", "");
      int lights = me.optInt("lights", 0);
      int left = me.has("lapsLeft") && !me.isNull("lapsLeft") ? me.optInt("lapsLeft", -1) : -1;
      int serve = me.has("serveInLaps") && !me.isNull("serveInLaps") ? me.optInt("serveInLaps", -1) : -1;
      if (seeded && spot != null) {
        if (black && !lastBlack) spot.urgent("Black flag, box now");
        if (lights >= 6 && lastLights < 6) { spot.urgent("Lights out, go go go"); saidStart = true; }
        if (blue && !lastBlue) spot.info("Blue flag, let them by");
        if (!opMsg.isEmpty() && !opMsg.equals(lastMsg)) spot.info("Race control. " + opMsg);
        if (left == 1 && lastLeft != 1) spot.info("Last lap");
        if (serve == 0 && lastServe != 0) spot.urgent("Serve the drive through now");
      }
      lastBlack = black; lastBlue = blue; lastLights = lights;
      lastMsg = opMsg; lastLeft = left; lastServe = serve;
      driftCalls(me.optJSONObject("drift"), seeded);
    }

    if (!flag.equals(lastFlag)) {
      if (lastFlag != null) {
        buzz();
        // Lights out and green land together; the start has already been called.
        if (spot != null && !(saidStart && "green".equals(flag))) spot.urgent(Spotter.flagCall(flag, lastFlag));
      }
      lastFlag = flag;
    }
  }

  /**
   * The spotter's calls for a drift event: going out on a qualifying run, each run of a
   * battle (lead or chase), the battle's result, the score of a run, and being up next.
   * Each is said once, when it changes; nothing on the first poll.
   */
  private void driftCalls(JSONObject dr, boolean seeded) {
    String track = "", result = "", next = "", score = "";
    String trackCall = null, resultCall = null, nextCall = null, scoreCall = null;
    if (dr != null) {
      JSONObject bt = dr.optJSONObject("battle");
      if ("solo".equals(dr.optString("onTrack"))) { track = "solo"; trackCall = "Your qualifying run. Go."; }
      else if ("battle".equals(dr.optString("onTrack")) && bt != null) {
        track = "battle" + bt.optInt("run") + bt.optString("role") + bt.optInt("omt");
        trackCall = (bt.optInt("omt") > 0 ? "One more time. " : "") + "Run " + (bt.optInt("run") == 2 ? "two" : "one")
            + ", you " + ("lead".equals(bt.optString("role")) ? "lead" : "chase") + ".";
      }
      if (bt != null && !bt.isNull("result") && !bt.optString("result").isEmpty()) {
        result = bt.optString("result") + bt.optString("opponent");
        resultCall = "won".equals(bt.optString("result")) ? "You win the battle." : "Battle lost.";
      }
      if (dr.optBoolean("champion")) { result = "champion"; resultCall = "You win the event!"; }
      JSONObject nx = dr.optJSONObject("upNext");
      if (nx != null) { next = nx.optString("round") + nx.optString("opponent"); nextCall = "You're up next, against " + nx.optString("opponent") + "."; }
      if (!dr.isNull("lastScore") && dr.has("lastScore")) {
        score = String.valueOf(dr.optDouble("lastScore"));
        scoreCall = "Score " + score.replace(".0", "") + ".";
      }
    }
    if (seeded && spot != null) {
      if (!track.isEmpty() && !track.equals(lastDriftTrack)) spot.urgent(trackCall);
      if (!result.isEmpty() && !result.equals(lastDriftResult)) spot.urgent(resultCall);
      if (!score.isEmpty() && !score.equals(lastDriftScore)) spot.info(scoreCall);
      if (!next.isEmpty() && !next.equals(lastDriftNext) && track.isEmpty()) spot.info(nextCall);
    }
    lastDriftTrack = track; lastDriftResult = result; lastDriftNext = next; lastDriftScore = score;
  }

  /**
   * One line of numbers for the bottom of the window: "P3/12  ▲+0.700  ▼+1.204  5 LEFT".
   * Both servers answer with the same shape, except that the laptop sends each gap as the
   * text its leaderboard shows and the hosted event sends milliseconds; either is read.
   */
  static String pitBoard(JSONObject me) {
    if (me == null) return "";
    StringBuilder b = new StringBuilder();
    // The place-and-gaps half only means something once the car has a position. Before that
    // (on the grid, or unclassified) the pit state still matters, so it is not gated on it.
    if (me.optInt("position") > 0) {
      b.append("P").append(me.optInt("position"));
      int cars = me.optInt("cars", 0);
      if (cars > 0) b.append('/').append(cars);
      String up = gapText(me.optJSONObject("ahead"));
      String down = gapText(me.optJSONObject("behind"));
      if (!up.isEmpty()) b.append("  \u25B2").append(up);
      if (!down.isEmpty()) b.append("  \u25BC").append(down);
      if (!me.isNull("lapsLeft") && me.has("lapsLeft")) {
        int left = me.optInt("lapsLeft", -1);
        if (left == 1) b.append("  LAST LAP");
        else if (left > 1) b.append("  ").append(left).append(" LEFT");
      }
      // Endurance is timed, not lap counted: show the time remaining instead of laps left.
      if (!me.isNull("timeLeftMs") && me.has("timeLeftMs")) {
        long ms = me.optLong("timeLeftMs", -1);
        if (ms >= 0) {
          long s = ms / 1000;
          b.append(String.format(java.util.Locale.US, "  %d:%02d LEFT", s / 60, s % 60));
        }
      }
      // A drive-through waiting to be served, and how many laps before it becomes a black flag.
      if (me.has("serveInLaps") && !me.isNull("serveInLaps")) {
        int sl = me.optInt("serveInLaps", -1);
        if (sl == 0) b.append("  SERVE DT NOW");
        else if (sl > 0) b.append("  SERVE DT: ").append(sl).append(sl == 1 ? " LAP" : " LAPS");
      }
    }
    // Pit lane state, both ways and always, so the driver can read whether the pits are open.
    if (me.has("pitOpen")) {
      if (b.length() > 0) b.append("  ");
      b.append(me.optBoolean("pitOpen", true) ? "PIT OPEN" : "PIT CLOSED");
    }
    // A drift event: the qualifying place and best score instead of gaps.
    JSONObject drq = me.optJSONObject("drift");
    if (drq != null && drq.optInt("qualiRank", 0) > 0) {
      if (b.length() > 0) b.append("  ");
      b.append("QUALI P").append(drq.optInt("qualiRank")).append(" ").append(drq.optString("qualiBest"));
    }
    // Licence points, when the league uses them: the count (this session after the plus),
    // or the ban the driver is serving.
    JSONObject lic = me.optJSONObject("licence");
    if (lic != null) {
      if (b.length() > 0) b.append("  ");
      if (lic.optBoolean("banned")) b.append("RACE BAN");
      else {
        b.append("LIC ").append(lic.optInt("points"));
        if (lic.optInt("pending") > 0) b.append("+").append(lic.optInt("pending"));
        b.append("/").append(lic.optInt("threshold", 12));
      }
    }
    return b.toString();
  }

  /** Start-light strip: n red lights lit (1..5), or all green at lights-out (6). */
  static String lightDots(int n) {
    if (n >= 6) return "🟢🟢🟢🟢🟢";
    StringBuilder b = new StringBuilder();
    for (int i = 0; i < 5; i++) b.append(i < n ? "🔴" : "⚫");
    return b.toString();
  }

  static String gapText(JSONObject car) {
    if (car == null) return "";
    if (car.optBoolean("dnf")) return "";
    String g = car.optString("gap", "");
    if (!g.isEmpty() && !"--".equals(g) && !"DNF".equals(g)) return g.startsWith("+") ? g : "+" + g;
    int laps = car.optInt("gapLaps", 0);
    if (laps > 0) return "+" + laps + "L";
    if (car.has("gapMs") && !car.isNull("gapMs")) {
      long ms = Math.abs(car.optLong("gapMs"));
      return String.format(java.util.Locale.US, "+%d.%03d", ms / 1000, ms % 1000);
    }
    return "";
  }

  /**
   * Tell the driver about anything they have not been told about yet.
   *
   * The list arrives newest first; it is walked backwards so that if several land at once
   * they arrive in the order they were given, which is the order they have to be read in.
   */
  private void announcePenalties(JSONArray pens) {
    if (pens == null) return;
    boolean changed = false;
    for (int i = pens.length() - 1; i >= 0; i--) {
      JSONObject p = pens.optJSONObject(i);
      if (p == null) continue;
      String key = p.optString("id") + ":" + p.optString("status");
      if (key.startsWith(":") || announced.contains(key)) continue;

      announced.add(key);
      changed = true;
      // A first run must not dump the whole race into the driver's shade. The set is
      // seeded silently and only what arrives afterwards is announced.
      if (lastFlag != null) announce(p);
    }
    if (changed) {
      if (announced.size() > 200) announced = new HashSet<>(announced);   // bounded by the API's 20
      Api.prefs(this).edit().putStringSet(K_SEEN, new HashSet<>(announced)).apply();
    }
  }

  /**
   * The penalty as a notification: what it is in the title, why in the body.
   *
   * Both halves come from the server so that the phone, the tower and the steward's own
   * screen are quoting the same sentence. BigTextStyle because a reason is written by a
   * person under time pressure and is regularly longer than one line, and a reason the
   * driver cannot read in full is a reason to argue about it later.
   */
  private void announce(JSONObject p) {
    String headline = p.optString("headline", "PENALTY");
    String reason = p.optString("reason", "");
    boolean open = "investigating".equals(p.optString("status"));

    /*
     * The window takes it first, then the shade.
     *
     * A driver mid-corner is looking at the floating window, not at a banner that slides
     * down over the game. The notification is what they find afterwards; the window is
     * what reaches them now.
     */
    if (view != null) {
      view.showPenalty(open ? "UNDER INVESTIGATION" : headline, reason);
      // Restarted, not stacked: a second penalty arriving at six seconds gets its own
      // full turn rather than inheriting the two the first one had left.
      ui.removeCallbacks(clearPenalty);
      ui.postDelayed(clearPenalty, PENALTY_MS);
    }
    notifyPenalty(p);
    if (spot != null) {
      spot.urgent(Spotter.penaltyCall(p.optString("type", ""), p.optInt("seconds", 0),
          p.optString("status", ""), reason));
    }
  }

  private void notifyPenalty(JSONObject p) {
    String headline = p.optString("headline", "PENALTY");
    String reason = p.optString("reason", "");
    boolean investigating = "investigating".equals(p.optString("status"));
    String title = investigating ? "UNDER INVESTIGATION" : headline;
    if (investigating && !headline.isEmpty()) title = title + " · " + headline;

    NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
    if (nm == null) return;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      NotificationChannel ch = new NotificationChannel(
          CHANNEL_PENALTY, "Penalties", NotificationManager.IMPORTANCE_HIGH);
      ch.setDescription("Penalties and investigations from race control");
      ch.enableVibration(true);
      nm.createNotificationChannel(ch);
    }

    PendingIntent open = PendingIntent.getActivity(
        this, 0, new Intent(this, MainActivity.class),
        PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

    Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
        ? new Notification.Builder(this, CHANNEL_PENALTY)
        : new Notification.Builder(this);
    Notification n = b
        .setContentTitle(title)
        .setContentText(reason)
        .setStyle(new Notification.BigTextStyle().bigText(reason))
        .setSmallIcon(android.R.drawable.stat_notify_error)
        .setContentIntent(open)
        .setAutoCancel(true)
        .setPriority(Notification.PRIORITY_HIGH)
        .build();

    // One id per penalty, so a second one does not quietly replace the first.
    nm.notify(("pen" + p.optString("id")).hashCode(), n);
    buzzPenalty();
  }

  /**
   * A team-radio message from a teammate: the incoming driver typing "BOX BOX BOX" to the
   * one on track. It reaches the window the same way a penalty does: over the flag for a few
   * seconds, then gone. The driver's own messages come back on the poll too and are skipped,
   * and the first poll after the window opens only seeds the id so nothing stale is replayed.
   */
  private void announceRadio(JSONObject r) {
    if (r == null) return;
    String id = r.optString("id", "");
    if (id.isEmpty()) return;
    if (lastRadioId == null) { lastRadioId = id; return; }   // seed silently on first sight
    if (id.equals(lastRadioId)) return;
    lastRadioId = id;

    String from = r.optString("from", "");
    String text = r.optString("text", "");
    if (text.isEmpty()) return;
    // Not my own message echoed back to me.
    String myNick = Api.prefs(this).getString(Api.K_NICK, "");
    if (!myNick.isEmpty() && myNick.equalsIgnoreCase(from)) return;

    if (view != null) {
      // Big line is the message, small line is who sent it: the driver mid-corner needs the
      // instruction first and the name second.
      view.showPenalty(text, from.isEmpty() ? "TEAM RADIO" : ("📻 " + from));
      ui.removeCallbacks(clearPenalty);
      ui.postDelayed(clearPenalty, PENALTY_MS);
    }
    notifyRadio(from, text);
    buzzPenalty();
    if (spot != null) spot.info("Radio" + (from.isEmpty() ? "" : ", " + from) + ". " + text);
  }

  private void notifyRadio(String from, String text) {
    NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
    if (nm == null) return;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      NotificationChannel ch = new NotificationChannel(
          CHANNEL_RADIO, "Team radio", NotificationManager.IMPORTANCE_HIGH);
      ch.setDescription("Messages from your team");
      ch.enableVibration(true);
      nm.createNotificationChannel(ch);
    }
    PendingIntent open = PendingIntent.getActivity(
        this, 0, new Intent(this, MainActivity.class),
        PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
        ? new Notification.Builder(this, CHANNEL_RADIO)
        : new Notification.Builder(this);
    Notification n = b
        .setContentTitle(from.isEmpty() ? "Team radio" : ("📻 " + from))
        .setContentText(text)
        .setStyle(new Notification.BigTextStyle().bigText(text))
        .setSmallIcon(android.R.drawable.ic_menu_call)
        .setContentIntent(open)
        .setAutoCancel(true)
        .setPriority(Notification.PRIORITY_HIGH)
        .build();
    nm.notify("radio".hashCode(), n);
  }

  /** Longer and doubled, so it is not mistaken for an ordinary flag change. */
  private void buzzPenalty() {
    try {
      Vibrator v = (Vibrator) getSystemService(VIBRATOR_SERVICE);
      if (v == null || !v.hasVibrator()) return;
      long[] pattern = {0, 250, 120, 250, 120, 250};
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        v.vibrate(VibrationEffect.createWaveform(pattern, -1));
      } else {
        v.vibrate(pattern, -1);
      }
    } catch (Exception ignored) { /* some phones have no motor */ }
  }

  private void buzz() {
    try {
      Vibrator v = (Vibrator) getSystemService(VIBRATOR_SERVICE);
      if (v == null || !v.hasVibrator()) return;
      long[] pattern = {0, 120, 60, 120};
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        v.vibrate(VibrationEffect.createWaveform(pattern, -1));
      } else {
        v.vibrate(pattern, -1);
      }
    } catch (Exception ignored) { /* some phones have no motor */ }
  }

  // ---------------------------------------------------------------- housekeeping

  private Notification notification() {
    NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      NotificationChannel ch = new NotificationChannel(
          CHANNEL, "Race flags", NotificationManager.IMPORTANCE_LOW);
      ch.setDescription("Keeps the floating flag alive while you race");
      ch.setShowBadge(false);
      nm.createNotificationChannel(ch);
    }
    PendingIntent open = PendingIntent.getActivity(
        this, 0, new Intent(this, MainActivity.class),
        PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

    Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
        ? new Notification.Builder(this, CHANNEL)
        : new Notification.Builder(this);
    return b.setContentTitle("FRL Driver")
        .setContentText("Floating flag is on")
        .setSmallIcon(android.R.drawable.ic_menu_compass)
        .setContentIntent(open)
        .setOngoing(true)
        .build();
  }

  @Override public void onDestroy() {
    running = false;
    if (spot != null) { spot.shutdown(); spot = null; }
    ui.removeCallbacks(clearPenalty);
    if (netHandler != null) { netHandler.removeCallbacksAndMessages(null); netHandler = null; }
    if (net != null) { net.quitSafely(); net = null; }
    if (view != null && wm != null) {
      try { wm.removeView(view); } catch (Exception ignored) { /* already gone */ }
    }
    view = null;
    super.onDestroy();
  }
}
