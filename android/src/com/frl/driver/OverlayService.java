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
 * A foreground service because the driver is going to leave this app immediately — they
 * are here to race — and an activity would be stopped the moment FR Legends came forward.
 * The notification is the price Android charges for staying alive, and it is a fair one.
 */
public class OverlayService extends Service {

  public static final String ACTION_STOP = "com.frl.driver.STOP";
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
   * that the flag — the thing that is true continuously — is never hidden for long.
   */
  private static final long PENALTY_MS = 8000;

  private WindowManager wm;
  private FlagView view;
  private WindowManager.LayoutParams lp;

  private HandlerThread net;
  private Handler netHandler;
  private final Handler ui = new Handler(Looper.getMainLooper());

  private String lastFlag = null;
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
   * upheld announces twice — those are two different things to be told, and a driver who
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
    if (intent != null && ACTION_STOP.equals(intent.getAction())) {
      stopSelf();
      return START_NOT_STICKY;
    }
    if (running) return START_STICKY;

    // Without the permission the window simply never appears, and a service running
    // invisibly is worse than one that never started.
    if (!canDraw(this)) { stopSelf(); return START_NOT_STICKY; }

    announced = new HashSet<>(Api.prefs(this).getStringSet(K_SEEN, new HashSet<>()));

    startForeground(NOTE_ID, notification());
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

    // A preset — or a saved size from a bigger screen — can put the window's bottom-right
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
   * and since there is nothing left to grab it can never be pulled back — the driver would
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

    // A flag shown to this driver alone outranks the session's — being told to come in is
    // not something that should sit behind a green.
    String personal = "";
    if (me != null) {
      if (me.optBoolean("blackFlag")) personal = "BLACK FLAG — PIT NOW";
      else if (me.optBoolean("blueFlag")) personal = "BLUE FLAG — LET THEM BY";
    }

    view.update(flag, who, personal);

    // After the window has been updated, so a penalty landing on this same poll paints
    // over the flag rather than being painted over by it.
    announcePenalties(o.optJSONArray("penalties"));
    announceRadio(o.optJSONObject("radio"));

    if (!flag.equals(lastFlag)) {
      if (lastFlag != null) buzz();
      lastFlag = flag;
    }
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
   * person under time pressure and is regularly longer than one line — and a reason the
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
   * A team-radio message from a teammate — the incoming driver typing "BOX BOX BOX" to the
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
      // Big line is the message, small line is who sent it — the driver mid-corner needs the
      // instruction first and the name second.
      view.showPenalty(text, from.isEmpty() ? "TEAM RADIO" : ("📻 " + from));
      ui.removeCallbacks(clearPenalty);
      ui.postDelayed(clearPenalty, PENALTY_MS);
    }
    notifyRadio(from, text);
    buzzPenalty();
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
