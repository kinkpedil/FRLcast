package com.frl.driver;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import org.json.JSONObject;

/**
 * "Starts in 30 minutes" and "starts in 5 minutes", before race control's countdown runs out.
 *
 * The phone learns the countdown whenever it polls (the app open, or the floating window on)
 * and hands the two moments to AlarmManager, so the reminder arrives even if the app is
 * closed by then. Inexact alarms on purpose: an exact one needs a permission the driver has
 * to grant by hand on Android 12 and later, and a reminder a minute late is still useful.
 * A countdown moved or cleared by race control re-schedules or cancels both.
 */
public class Reminders extends BroadcastReceiver {
  private static final String CHANNEL = "frl-reminder";
  private static final String K_TARGET = "remTarget";
  private static final int[] MINUTES = {30, 5};

  /** Called with the payload's countdown ({ target, label }) or null. */
  static void schedule(Context c, JSONObject countdown, String event) {
    long target = countdown == null ? 0 : countdown.optLong("target", 0);
    boolean on = Api.prefs(c).getBoolean(Api.K_NOTIFY, true);
    long was = Api.prefs(c).getLong(K_TARGET, 0);
    if (!on || target <= System.currentTimeMillis()) {
      if (was != 0) { cancel(c); Api.prefs(c).edit().remove(K_TARGET).apply(); }
      return;
    }
    if (was == target) return;          // already set for this countdown
    AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
    if (am == null) return;
    cancel(c);
    String label = countdown.optString("label", "");
    for (int min : MINUTES) {
      long at = target - min * 60000L;
      if (at <= System.currentTimeMillis() + 15000) continue;
      PendingIntent pi = intent(c, min, label, event);
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
      else am.set(AlarmManager.RTC_WAKEUP, at, pi);
    }
    Api.prefs(c).edit().putLong(K_TARGET, target).apply();
  }

  private static PendingIntent intent(Context c, int min, String label, String event) {
    Intent i = new Intent(c, Reminders.class);
    i.putExtra("min", min);
    i.putExtra("label", label == null ? "" : label);
    i.putExtra("event", event == null ? "" : event);
    return PendingIntent.getBroadcast(c, 7000 + min, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
  }

  private static void cancel(Context c) {
    AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
    if (am == null) return;
    for (int min : MINUTES) am.cancel(intent(c, min, "", ""));
  }

  @Override
  public void onReceive(Context c, Intent i) {
    if (!Api.prefs(c).getBoolean(Api.K_NOTIFY, true)) return;
    int min = i.getIntExtra("min", 5);
    String label = i.getStringExtra("label");
    String event = i.getStringExtra("event");
    String title = "Starts in " + min + " minutes";
    String body = ((event == null || event.isEmpty()) ? "Your race" : event)
        + ((label == null || label.isEmpty()) ? "" : " · " + label)
        + ". Open the app and get ready.";
    post(c, title, body, 7000 + min);
  }

  /** One notification on the reminders channel; also used for race control's messages. */
  static void post(Context c, String title, String body, int id) {
    NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
    if (nm == null) return;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      NotificationChannel ch = new NotificationChannel(CHANNEL, "Reminders and race control", NotificationManager.IMPORTANCE_HIGH);
      ch.setDescription("Session reminders and messages from race control");
      ch.enableVibration(true);
      nm.createNotificationChannel(ch);
    }
    PendingIntent open = PendingIntent.getActivity(c, 0, new Intent(c, MainActivity.class),
        PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
        ? new Notification.Builder(c, CHANNEL) : new Notification.Builder(c);
    nm.notify(id, b.setContentTitle(title)
        .setContentText(body)
        .setStyle(new Notification.BigTextStyle().bigText(body))
        .setSmallIcon(android.R.drawable.ic_popup_reminder)
        .setContentIntent(open)
        .setAutoCancel(true)
        .setPriority(Notification.PRIORITY_HIGH)
        .build());
  }
}
