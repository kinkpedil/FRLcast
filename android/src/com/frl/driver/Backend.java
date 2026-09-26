package com.frl.driver;

import android.content.Context;

import org.json.JSONObject;

/**
 * Where the driver's phone gets its flags from.
 *
 * There are two, and both have to work at once for now. The league runs today against a
 * broadcast server on somebody's laptop; the hosted version keeps the same event in
 * Postgres and is reached through Supabase. Until the operator console has moved across,
 * shipping an app that could only talk to the new one would be shipping an app that does
 * nothing.
 *
 * Which one is decided by what the driver typed. An address has a dot or a colon in it;
 * an event code does not, and a link copied out of the operator's dashboard carries one in
 * its query string. That is the whole test, and it means a driver never has to be told
 * which kind of league they are in.
 */
public interface Backend {

  /** Both backends answer in the same shape, so nothing above here has to care which. */
  JSONObject register(String nick, String num, String password, String team, String gameId)
      throws Exception;

  /**
   * Signing in carries the team and player ID too, because those are the details that change
   * between rounds. An empty value means "leave whatever you have"; it never clears one.
   */
  JSONObject login(String num, String password, String team, String gameId) throws Exception;

  void logout(String token);

  /**
   * This driver's slice of the event.
   *
   * `ok` false with an error of "Signed out" means the token is finished, whichever
   * backend said it. A dropped connection throws instead: those are different things and
   * the caller treats them differently.
   */
  JSONObject state(String token) throws Exception;

  /**
   * Send a team-radio message. Every driver on the same team sees it on their next poll;
   * nobody on another team does. Only the laptop server carries this — a hosted event has
   * no radio endpoint yet, so the cloud backend answers a plain "not supported".
   */
  JSONObject sendRadio(String token, String text) throws Exception;

  /**
   * Report an incident to race control: the other car's number (may be empty) and what
   * happened. It lands in the steward's queue; it is never a penalty by itself.
   */
  JSONObject report(String token, String againstNum, String text) throws Exception;

  /** For the one error message a driver ever sees about connectivity. */
  String describe();

  // ---------------------------------------------------------------- choosing

  static Backend of(Context c) {
    return forTarget(Api.host(c));
  }

  static Backend forTarget(String target) {
    String code = Target.eventCode(target);
    return code.isEmpty() ? new Lan(Target.host(target)) : new Cloud(code);
  }

  // ---------------------------------------------------------------- the laptop

  /** The broadcast server on the operator's own machine. */
  final class Lan implements Backend {
    private final String host;

    Lan(String host) { this.host = host; }

    private String url(String path) { return "http://" + host + path; }

    @Override public JSONObject register(String nick, String num, String password, String team,
        String gameId) throws Exception {
      // gameId is sent for forward-compatibility. The laptop server predates the field and
      // ignores an unknown key; a newer one can pick it up without changing this app.
      return Api.post(url("/api/driver/register"), new JSONObject()
          .put("nick", nick).put("num", num).put("password", password)
          .put("team", team).put("gameId", gameId));
    }

    @Override public JSONObject login(String num, String password, String team, String gameId)
        throws Exception {
      return Api.post(url("/api/driver/login"), new JSONObject()
          .put("num", num).put("password", password).put("team", team).put("gameId", gameId));
    }

    @Override public void logout(String token) {
      try { Api.post(url("/api/driver/logout"), new JSONObject().put("token", token)); }
      catch (Exception ignored) { /* the token expires on its own */ }
    }

    @Override public JSONObject state(String token) throws Exception {
      JSONObject o = Api.get(url("/api/driver/me?token=" + token));
      // The hosted side says this in the body; this one says it in the status line. Same
      // fact, and the caller should not have to know the difference.
      if (o.optInt("httpStatus") == 401) {
        return new JSONObject().put("ok", false).put("error", "Signed out");
      }
      return o;
    }

    @Override public JSONObject sendRadio(String token, String text) throws Exception {
      return Api.post(url("/api/driver/radio"), new JSONObject().put("token", token).put("text", text));
    }

    @Override public JSONObject report(String token, String againstNum, String text) throws Exception {
      return Api.post(url("/api/driver/report"), new JSONObject()
          .put("token", token).put("against", againstNum).put("text", text));
    }

    @Override public String describe() { return host; }
  }

  // ---------------------------------------------------------------- the hosted event

  /**
   * Supabase, reached by event code.
   *
   * Everything goes through the four database functions rather than through the tables:
   * the driver's password hash and token live in a table no API key can read at all, and
   * those functions are the only door into it.
   */
  final class Cloud implements Backend {
    private final String code;

    Cloud(String code) { this.code = code; }

    private JSONObject rpc(String fn, JSONObject args) throws Exception {
      if (!Config.configured()) {
        return new JSONObject().put("ok", false)
            .put("error", "This app was built without a Supabase project");
      }
      JSONObject o = Api.postWithHeaders(
          Config.SUPABASE_URL + "/rest/v1/rpc/" + fn, args,
          "apikey", Config.SUPABASE_ANON_KEY,
          "Authorization", "Bearer " + Config.SUPABASE_ANON_KEY);
      // PostgREST answers a missing function or a bad key with its own error shape, which
      // has no `ok` in it. Anything without one did not reach our function.
      if (!o.has("ok")) {
        return new JSONObject().put("ok", false)
            .put("error", o.optString("message", "The event server refused that"));
      }
      return o;
    }

    @Override public JSONObject register(String nick, String num, String password, String team,
        String gameId) throws Exception {
      return rpc("driver_register", new JSONObject()
          .put("p_code", code).put("p_nick", nick).put("p_num", num)
          .put("p_password", password).put("p_team", team).put("p_game_id", gameId));
    }

    @Override public JSONObject login(String num, String password, String team, String gameId)
        throws Exception {
      return rpc("driver_login", new JSONObject()
          .put("p_code", code).put("p_num", num).put("p_password", password)
          .put("p_team", team).put("p_game_id", gameId));
    }

    @Override public void logout(String token) {
      try { rpc("driver_logout", new JSONObject().put("p_token", token)); }
      catch (Exception ignored) { /* the token expires on its own */ }
    }

    @Override public JSONObject state(String token) throws Exception {
      return rpc("driver_state", new JSONObject().put("p_token", token));
    }

    @Override public JSONObject sendRadio(String token, String text) throws Exception {
      return rpc("driver_radio", new JSONObject().put("p_token", token).put("p_text", text));
    }

    @Override public JSONObject report(String token, String againstNum, String text) throws Exception {
      JSONObject o = rpc("driver_report", new JSONObject()
          .put("p_token", token).put("p_against", againstNum).put("p_text", text));
      // An event on a project that has not had the league migration yet has no such function.
      // Say what the driver can do about it, not what PostgREST said.
      String err = o.optString("error", "").toLowerCase();
      if (!o.optBoolean("ok") && (err.contains("driver_report") || err.contains("function"))) {
        return new JSONObject().put("ok", false)
            .put("error", "This event cannot take reports yet. Tell race control directly.");
      }
      return o;
    }

    @Override public String describe() { return "event " + code; }
  }
}
