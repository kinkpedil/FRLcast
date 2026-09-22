package com.frl.driver;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Everything this app knows about the race server.
 *
 * Deliberately thin — the endpoints already exist and are already used by the web page, so
 * there is nothing to design here. What matters is that it never blocks the main thread and
 * that a dropped wifi frame is an ordinary event rather than an error the driver has to
 * read about mid-corner.
 */
public final class Api {

  private Api() {}

  public static final String PREFS = "frl";
  // Either an address on the local network or an event code. Backend decides which by
  // looking at it, so nothing else has to keep a second setting in step with this one.
  public static final String K_HOST = "host";
  public static final String K_TOKEN = "token";
  public static final String K_NICK = "nick";
  public static final String K_NUM = "num";
  public static final String K_TEAM = "team";
  // FR Legends player ID. The stable key the timing API joins a driver by; captured here so
  // race control does not have to type it. Empty when the driver leaves it blank or the app
  // predates the field — every path downstream treats '' as "unknown", never an error.
  public static final String K_GAMEID = "gameId";

  // Overlay geometry, remembered so a driver sets it once and never again.
  public static final String K_W = "ovW";
  public static final String K_H = "ovH";
  public static final String K_X = "ovX";
  public static final String K_Y = "ovY";
  public static final String K_ALPHA = "ovAlpha";
  public static final String K_SUB = "ovSub";      // show the instruction line

  public static SharedPreferences prefs(Context c) {
    return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
  }

  public static String host(Context c) {
    return prefs(c).getString(K_HOST, "");
  }

  public static String token(Context c) {
    return prefs(c).getString(K_TOKEN, "");
  }

  /** Kept as a thin name for the rule that now lives in Target. */
  public static String normaliseHost(String raw) {
    return Target.host(raw);
  }


  public static JSONObject post(String url, JSONObject body) throws Exception {
    return postWithHeaders(url, body);
  }

  /**
   * The same POST with extra headers, which is all Supabase needs on top: an API key and a
   * bearer token. Pairs, so a caller reads as key then value rather than as a map literal.
   */
  public static JSONObject postWithHeaders(String url, JSONObject body, String... headers)
      throws Exception {
    HttpURLConnection c = open(url);
    c.setRequestMethod("POST");
    c.setDoOutput(true);
    c.setRequestProperty("Content-Type", "application/json");
    for (int i = 0; i + 1 < headers.length; i += 2) {
      c.setRequestProperty(headers[i], headers[i + 1]);
    }
    byte[] out = body.toString().getBytes("UTF-8");
    c.setFixedLengthStreamingMode(out.length);
    try (OutputStream os = c.getOutputStream()) { os.write(out); }
    return read(c);
  }

  public static JSONObject get(String url) throws Exception {
    HttpURLConnection c = open(url);
    c.setRequestMethod("GET");
    return read(c);
  }

  private static HttpURLConnection open(String url) throws Exception {
    HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
    // Short. A phone that has wandered out of wifi range should fail and be retried on the
    // next poll, not hold a thread open for half a minute.
    c.setConnectTimeout(4000);
    c.setReadTimeout(4000);
    c.setUseCaches(false);
    return c;
  }

  /**
   * The body, whatever the status was.
   *
   * A 401 from /api/driver/me is not a transport failure — it is the server saying this
   * token is finished, and the app needs to read that answer rather than treat it as a
   * broken connection. So the error stream is parsed exactly like the normal one.
   */
  private static JSONObject read(HttpURLConnection c) throws Exception {
    int code = c.getResponseCode();
    InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
    String text = "";
    if (in != null) {
      ByteArrayOutputStream buf = new ByteArrayOutputStream();
      byte[] chunk = new byte[4096];
      int n;
      while ((n = in.read(chunk)) > 0) buf.write(chunk, 0, n);
      text = buf.toString("UTF-8");
      in.close();
    }
    c.disconnect();
    JSONObject o;
    try {
      o = new JSONObject(text);
    } catch (Exception e) {
      o = new JSONObject();
      o.put("ok", false);
      o.put("error", "Server sent something unreadable");
    }
    o.put("httpStatus", code);
    return o;
  }
}
