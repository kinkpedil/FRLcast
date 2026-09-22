package com.frl.driver;

/**
 * Reading what the driver typed into one field.
 *
 * A short code means a hosted event; anything that looks like an address means race control
 * is on a machine on this network. Getting it wrong sends somebody to the wrong place and
 * tells them their password is wrong, so the rule lives here on its own, with no Android in
 * it, and is tested on a desktop.
 */
public final class Target {

  private Target() {}

  /**
   * True when this is an event code rather than an address.
   *
   * A dot, a colon or a slash means an address: no event code contains one. What is left
   * has to be plain letters and digits and short enough to be typed on a phone at a track.
   */
  public static boolean isEventCode(String typed) {
    String t = typed == null ? "" : typed.trim();
    if (t.isEmpty()) return false;
    if (t.indexOf('.') >= 0 || t.indexOf(':') >= 0 || t.indexOf('/') >= 0) return false;
    // The one hostname with no dot and no colon in it. Without this line somebody typing
    // it would be sent looking for a hosted event called LOCALHOST.
    if (t.equalsIgnoreCase("localhost")) return false;
    if (t.length() < 4 || t.length() > 12) return false;
    for (int i = 0; i < t.length(); i++) {
      char c = t.charAt(i);
      boolean plain = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
      if (!plain) return false;
    }
    return true;
  }

  /** The code as the database stores it. */
  public static String code(String typed) {
    return typed == null ? "" : typed.trim().toUpperCase();
  }

  /**
   * The event this text points at, or "" when it points at no event.
   *
   * A driver who has just downloaded the app from the website has the website's address in
   * their hand, and pasting it here is the obvious thing to try. It used to be read as a
   * machine on the local network, so the app went looking for a broadcast server on
   * frl-broadcast.vercel.app:4700 and reported that it could not be reached.
   *
   * Any link the operator can copy — the OBS overlay URL, the console's own address —
   * carries `event=CODE`, so a paste of one of those now works. The bare website address
   * carries nothing that names an event, and no amount of guessing will fix that; see
   * isWebsite below for what the driver is told instead.
   */
  public static String eventCode(String typed) {
    if (isEventCode(typed)) return code(typed);

    String t = typed == null ? "" : typed.trim();
    int at = t.toLowerCase().indexOf("event=");
    if (at < 0) return "";

    StringBuilder found = new StringBuilder();
    for (int i = at + 6; i < t.length(); i++) {
      char c = t.charAt(i);
      boolean plain = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
      if (!plain) break;
      found.append(c);
    }
    return isEventCode(found.toString()) ? code(found.toString()) : "";
  }

  /**
   * True when this is a website on the internet rather than a machine on this network.
   *
   * Only ever asked once eventCode has come back empty, and only to choose the wording of
   * the refusal: sending somebody to look for a broadcast server on a public domain wastes
   * a timeout and then tells them the wrong thing.
   *
   * A port means somebody typed an address deliberately, an IP is an IP, and .local is a
   * name only this network knows. What is left — a dotted name with no port — is the web.
   */
  public static boolean isWebsite(String typed) {
    String h = typed == null ? "" : typed.trim();
    h = h.replaceAll("^[a-zA-Z]+://", "");
    h = h.replaceAll("[/?#].*$", "");
    if (h.isEmpty()) return false;
    if (h.contains(":")) return false;
    if (!h.contains(".")) return false;
    if (h.toLowerCase().endsWith(".local")) return false;
    // An IPv4 address is digits and dots and nothing else.
    boolean numeric = true;
    for (int i = 0; i < h.length(); i++) {
      char c = h.charAt(i);
      if (!((c >= '0' && c <= '9') || c == '.')) { numeric = false; break; }
    }
    return !numeric;
  }

  /**
   * What a person would type, turned into something openable.
   *
   * A bare hostname gets the broadcast server's own port, because nobody types 4700 and
   * a driver who omits it should still arrive.
   */
  public static String host(String typed) {
    String h = typed == null ? "" : typed.trim();
    h = h.replaceAll("^https?://", "");
    h = h.replaceAll("/.*$", "");
    if (h.isEmpty()) return "";
    if (!h.contains(":")) h = h + ":4700";
    return h;
  }
}
