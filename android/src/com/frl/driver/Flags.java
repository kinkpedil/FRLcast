package com.frl.driver;

import android.graphics.Color;

/**
 * The flags, in the same words the broadcast overlay uses.
 *
 * Kept identical to the web page on purpose: a driver who has seen "Slow down, no
 * overtaking" on the phone should read exactly that, and race control should not have to
 * remember that the app words things differently.
 */
public final class Flags {

  private Flags() {}

  /**
   * The penalty colour, which is deliberately not the red flag's.
   *
   * A red flag means the session has stopped and everyone slows down. A penalty means one
   * driver has been given something. Painting them the same red asks a driver at speed to
   * tell two unrelated orders apart by reading — so this is a deeper crimson, dark enough
   * to be obviously a different thing when the two are seen minutes apart.
   *
   * Red flag is #ff3b30. This must never be set to that.
   */
  public static final int PENALTY = Color.parseColor("#b3001b");

  public static int color(String flag) {
    if (flag == null) return Color.parseColor("#8e8e93");
    switch (flag) {
      case "formation": return Color.parseColor("#0a84ff");
      case "green":     return Color.parseColor("#30d158");
      case "yellow":    return Color.parseColor("#ffd60a");
      case "safety":    return Color.parseColor("#ff9f0a");
      case "vsc":       return Color.parseColor("#ffcc00");
      case "red":       return Color.parseColor("#ff3b30");
      case "finished":  return Color.parseColor("#ffffff");
      default:          return Color.parseColor("#8e8e93");
    }
  }

  public static String label(String flag) {
    if (flag == null) return "WAITING";
    switch (flag) {
      case "formation": return "FORMATION LAP";
      case "green":     return "GREEN FLAG";
      case "yellow":    return "YELLOW FLAG";
      case "safety":    return "SAFETY CAR";
      case "vsc":       return "VSC";
      case "red":       return "RED FLAG";
      case "finished":  return "CHEQUERED FLAG";
      case "idle":      return "STANDBY";
      default:          return flag.toUpperCase();
    }
  }

  /** What the driver is being told to do. The colour is the alert; this is the order. */
  public static String action(String flag) {
    if (flag == null) return "";
    switch (flag) {
      case "idle":      return "Wait for the start";
      case "formation": return "Formation lap — hold position";
      case "green":     return "Racing — go";
      case "yellow":    return "Slow down, no overtaking";
      case "safety":    return "Safety car — slow, no overtaking";
      case "vsc":       return "Virtual safety car — slow, hold the gap";
      case "red":       return "Session stopped — slow down and return to the pits";
      case "finished":  return "Chequered flag — race over";
      default:          return "";
    }
  }

  /** Yellow and white need dark lettering or the word disappears into its own flag. */
  public static boolean isPale(String flag) {
    return "yellow".equals(flag) || "vsc".equals(flag) || "finished".equals(flag);
  }
}
