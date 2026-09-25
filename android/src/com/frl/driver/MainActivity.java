package com.frl.driver;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.InputType;
import android.text.method.PasswordTransformationMethod;
import android.util.TypedValue;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.TextView;

import org.json.JSONObject;

/**
 * Sign in — or sign up — and then get out of the way.
 *
 * Everything a driver does mid-race happens in the floating window; this screen exists to
 * get them an account, to ask Android for the one permission that makes the window
 * possible, and to set its size. It is built in code rather than XML because it is one
 * screen and a layout file would be another thing to keep in step with it.
 */
public class MainActivity extends Activity {

  private EditText fHost, fNick, fNum, fTeam, fPlayerId, fPass, fRadio, fAgainst, fReport;
  private TextView status, hint, formLede, nickLabel, radioLabel;
  private Button go, swap, floatBtn, permBtn, signOut, radioSend, reportSend;
  private LinearLayout sizeRow, settings, form, radioBox, reportBox;
  private CheckBox subBox, boardBox;
  private SeekBar alpha;

  /** The team the server last reported for this driver — team radio only shows with one. */
  private String team = "";
  /** Newest team-radio id already shown here, so a poll does not repeat it. String because
   *  the id is a number on the laptop server and a UUID on the hosted event. */
  private String lastRadioId = null;

  private final Handler ui = new Handler(Looper.getMainLooper());
  private int dp;

  /** Signing in, or creating an account. The same form either way, plus a name. */
  private boolean registering = false;

  /** What race control has decided about this driver: pending, approved or rejected. */
  private String approval = "";
  /** Signed in on race day (a hosted event with the league update): the check-in. */
  private boolean checkedIn = false;

  @Override protected void onCreate(Bundle b) {
    super.onCreate(b);
    dp = (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 1, getResources().getDisplayMetrics());
    setContentView(build());
    getWindow().getDecorView().setBackgroundColor(Color.parseColor("#0b0d11"));

    if (Build.VERSION.SDK_INT >= 33
        && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
      requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
    }
    refresh();
  }

  @Override protected void onResume() {
    super.onResume();
    refresh();                 // coming back from the Settings screen that grants the overlay
    if (signedIn()) pollApproval();
  }

  @Override protected void onPause() {
    super.onPause();
    ui.removeCallbacks(approvalPoll);
  }

  // ---------------------------------------------------------------- the screen

  private View build() {
    LinearLayout root = new LinearLayout(this);
    root.setOrientation(LinearLayout.VERTICAL);
    root.setPadding(20 * dp, 28 * dp, 20 * dp, 28 * dp);

    root.addView(title("FRL DRIVER"));

    /*
     * The whole form lives in one container.
     *
     * Hiding the fields one at a time left their headings behind — "RACE NUMBER" and
     * "PASSWORD" sat on the signed-in screen with nothing under them. A label belongs to
     * its field, so they leave together.
     */
    form = new LinearLayout(this);
    form.setOrientation(LinearLayout.VERTICAL);
    root.addView(form);

    formLede = new TextView(this);
    formLede.setTextColor(Color.parseColor("#8b9099"));
    formLede.setTextSize(14);
    form.addView(formLede);

    fHost = field("NDL3  or  192.168.1.20:4700", InputType.TYPE_CLASS_TEXT);
    fHost.setText(Api.host(this));
    form.addView(label("EVENT CODE OR SERVER"));
    form.addView(fHost);

    // Only asked for when it is being chosen. On the way back in the number identifies the
    // driver, and one less field is one less thing to fumble with cold hands.
    nickLabel = label("RACING NAME");
    fNick = field("AKI", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS);
    form.addView(nickLabel);
    form.addView(fNick);

    fNum = field("7", InputType.TYPE_CLASS_NUMBER);
    form.addView(label("RACE NUMBER"));
    form.addView(fNum);

    // Shown on both screens, unlike the racing name. A driver who changed teams between
    // rounds has nowhere else to say so, and race control would otherwise be retyping it
    // from a list they keep somewhere off this system entirely.
    fTeam = field("KINKPEDIL RACING", InputType.TYPE_CLASS_TEXT
        | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS);
    fTeam.setText(Api.prefs(this).getString(Api.K_TEAM, ""));
    form.addView(label("TEAM  (optional)"));
    form.addView(fTeam);

    // Shown on both screens like the team, and for the same reason: a driver can set it later
    // by signing in again, and an empty box never clears an ID already on file. This is the FR
    // Legends player ID the timing API matches a car by — names collide, this does not.
    fPlayerId = field("FRL-XXXXXX", InputType.TYPE_CLASS_TEXT);
    fPlayerId.setText(Api.prefs(this).getString(Api.K_GAMEID, ""));
    form.addView(label("FR LEGENDS PLAYER ID  (optional)"));
    form.addView(fPlayerId);

    fPass = field("••••", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
    form.addView(label("PASSWORD"));
    form.addView(fPass);

    go = button("Sign in", 0xFF00E0A4, Color.parseColor("#05070a"));
    go.setOnClickListener(v -> submit());
    form.addView(go);

    swap = button("First time here? Create an account", 0xFF1C2027, Color.WHITE);
    swap.setOnClickListener(v -> setRegistering(!registering));
    form.addView(swap);

    form.addView(fine("A short code like NDL3 means a hosted event — race control gives you "
        + "one, and pasting any link they send works too. An address like 192.168.1.20:4700 "
        + "means race control is on a machine on this network, and your password crosses it "
        + "in the clear, so do not reuse a real one."));

    status = new TextView(this);
    status.setTextColor(Color.WHITE);
    status.setTextSize(15);
    status.setPadding(0, 14 * dp, 0, 6 * dp);
    root.addView(status);

    // Team radio: type a message to the rest of your team. The driver relieving another in an
    // endurance stint types "BOX BOX BOX" here; it lands on every teammate's floating window.
    radioBox = new LinearLayout(this);
    radioBox.setOrientation(LinearLayout.VERTICAL);
    root.addView(radioBox);

    radioLabel = label("TEAM RADIO");
    radioBox.addView(radioLabel);

    LinearLayout radioRow = new LinearLayout(this);
    radioRow.setOrientation(LinearLayout.HORIZONTAL);
    fRadio = field("BOX BOX BOX", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
    LinearLayout.LayoutParams rlp = new LinearLayout.LayoutParams(0,
        ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
    radioRow.addView(fRadio, rlp);
    radioSend = new Button(this);
    radioSend.setText("Send");
    radioSend.setAllCaps(false);
    radioSend.setTextSize(15);
    radioSend.setTextColor(Color.parseColor("#05070a"));
    radioSend.setBackgroundColor(0xFF00A3FF);
    radioSend.setOnClickListener(v -> sendRadio());
    radioRow.addView(radioSend);
    radioBox.addView(radioRow);

    // Report an incident: which car, and what happened. It goes to race control's queue only,
    // not to the other driver and not on air.
    reportBox = new LinearLayout(this);
    reportBox.setOrientation(LinearLayout.VERTICAL);
    root.addView(reportBox);
    reportBox.addView(label("REPORT AN INCIDENT"));
    LinearLayout reportRow = new LinearLayout(this);
    reportRow.setOrientation(LinearLayout.HORIZONTAL);
    fAgainst = field("Car #", InputType.TYPE_CLASS_NUMBER);
    reportRow.addView(fAgainst, new LinearLayout.LayoutParams(78 * dp,
        ViewGroup.LayoutParams.WRAP_CONTENT));
    fReport = field("Pushed me wide at turn 3", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
    reportRow.addView(fReport, new LinearLayout.LayoutParams(0,
        ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
    reportSend = new Button(this);
    reportSend.setText("Report");
    reportSend.setAllCaps(false);
    reportSend.setTextSize(15);
    reportSend.setTextColor(Color.WHITE);
    reportSend.setBackgroundColor(0xFFFF453A);
    reportSend.setOnClickListener(v -> sendReport());
    reportRow.addView(reportSend);
    reportBox.addView(reportRow);
    reportBox.addView(fine("Only race control sees this. They decide what happens: a report is not a penalty."));

    permBtn = button("Allow drawing over other apps", 0xFFFFD60A, Color.parseColor("#05070a"));
    permBtn.setOnClickListener(v -> askOverlay());
    root.addView(permBtn);

    floatBtn = button("Show floating flag", 0xFF00E0A4, Color.parseColor("#05070a"));
    floatBtn.setOnClickListener(v -> toggleFloat());
    root.addView(floatBtn);

    settings = new LinearLayout(this);
    settings.setOrientation(LinearLayout.VERTICAL);
    root.addView(settings);

    settings.addView(label("WINDOW SIZE"));
    sizeRow = new LinearLayout(this);
    sizeRow.setOrientation(LinearLayout.HORIZONTAL);
    // Presets are a shortcut, not the mechanism. The real control is dragging the window's
    // own corner, which goes anywhere between these and beyond them.
    addSize(sizeRow, "Tiny", 72, 52);
    addSize(sizeRow, "Small", 110, 76);
    addSize(sizeRow, "Medium", 150, 100);
    addSize(sizeRow, "Large", 230, 155);
    settings.addView(sizeRow);

    hint = fine("Drag the window to move it. Drag its bottom-right corner to make it any size "
        + "you like — there is no minimum beyond a thumbnail. It stays where you put it.");
    settings.addView(hint);

    settings.addView(label("OPACITY"));
    alpha = new SeekBar(this);
    alpha.setMax(100);
    alpha.setProgress(Api.prefs(this).getInt(Api.K_ALPHA, 100));
    alpha.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
      @Override public void onProgressChanged(SeekBar s, int v, boolean user) {
        if (!user) return;
        int pct = Math.max(25, v);        // fully invisible is a window you cannot find
        Api.prefs(MainActivity.this).edit().putInt(Api.K_ALPHA, pct).apply();
        restartOverlayIfOn();
      }
      @Override public void onStartTrackingTouch(SeekBar s) {}
      @Override public void onStopTrackingTouch(SeekBar s) {}
    });
    settings.addView(alpha);

    subBox = new CheckBox(this);
    subBox.setText("Show the instruction line");
    subBox.setTextColor(Color.WHITE);
    subBox.setChecked(Api.prefs(this).getBoolean(Api.K_SUB, true));
    subBox.setOnCheckedChangeListener((v, on) -> {
      Api.prefs(this).edit().putBoolean(Api.K_SUB, on).apply();
      restartOverlayIfOn();
    });
    settings.addView(subBox);

    boardBox = new CheckBox(this);
    boardBox.setText("Show the pit board (gaps, laps left)");
    boardBox.setTextColor(Color.WHITE);
    boardBox.setChecked(Api.prefs(this).getBoolean(Api.K_BOARD, true));
    boardBox.setOnCheckedChangeListener((v, on) -> {
      Api.prefs(this).edit().putBoolean(Api.K_BOARD, on).apply();
      restartOverlayIfOn();
    });
    settings.addView(boardBox);

    signOut = button("Sign out", 0xFF1C2027, Color.WHITE);
    signOut.setOnClickListener(v -> doSignOut());
    settings.addView(signOut);

    ScrollView sv = new ScrollView(this);
    sv.addView(root, new ViewGroup.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
    return sv;
  }

  private void setRegistering(boolean on) {
    registering = on;
    formLede.setText(on
        ? "Pick a racing name, your number and a password. Race control decides who gets in."
        : "Sign in with the number and password you registered.");
    go.setText(on ? "Create account" : "Sign in");
    swap.setText(on ? "Already have an account? Sign in" : "First time here? Create an account");
    nickLabel.setVisibility(on ? View.VISIBLE : View.GONE);
    fNick.setVisibility(on ? View.VISIBLE : View.GONE);
    status.setText("");
  }

  private void addSize(LinearLayout row, String name, int w, int h) {
    Button b = new Button(this);
    b.setText(name);
    b.setAllCaps(false);
    b.setTextSize(13);
    b.setTextColor(Color.WHITE);
    b.setBackgroundColor(0xFF1C2027);
    LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0,
        ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
    lp.setMargins(2 * dp, 0, 2 * dp, 0);
    b.setOnClickListener(v -> {
      Api.prefs(this).edit().putInt(Api.K_W, w * dp).putInt(Api.K_H, h * dp).apply();
      restartOverlayIfOn();
      toast("Window set to " + name.toLowerCase());
    });
    row.addView(b, lp);
  }

  private TextView title(String s) {
    TextView t = new TextView(this);
    t.setText(s);
    t.setTextColor(Color.WHITE);
    t.setTextSize(24);
    t.setLetterSpacing(0.12f);
    t.setPadding(0, 0, 0, 12 * dp);
    return t;
  }

  private TextView label(String s) {
    TextView t = new TextView(this);
    t.setText(s);
    t.setTextColor(Color.parseColor("#8b9099"));
    t.setTextSize(11);
    t.setLetterSpacing(0.14f);
    t.setPadding(0, 14 * dp, 0, 5 * dp);
    return t;
  }

  private TextView fine(String s) {
    TextView t = new TextView(this);
    t.setText(s);
    t.setTextColor(Color.parseColor("#6b7079"));
    t.setTextSize(12);
    t.setPadding(0, 12 * dp, 0, 0);
    return t;
  }

  private EditText field(String hintText, int type) {
    EditText e = new EditText(this);
    e.setHint(hintText);
    // Order matters: setSingleLine rewrites the input type and drops the password
    // transformation with it, so a field set up the other way round shows the password in
    // clear on screen. It is set explicitly afterwards rather than trusted to the flags.
    e.setSingleLine(true);
    e.setInputType(type);
    if ((type & InputType.TYPE_TEXT_VARIATION_PASSWORD) != 0) {
      e.setTransformationMethod(PasswordTransformationMethod.getInstance());
    }
    e.setTextColor(Color.WHITE);
    e.setHintTextColor(Color.parseColor("#5a606b"));
    e.setTextSize(17);
    return e;
  }

  private Button button(String s, int bg, int fg) {
    Button b = new Button(this);
    b.setText(s);
    b.setAllCaps(false);
    b.setTextSize(16);
    b.setTextColor(fg);
    b.setBackgroundColor(bg);
    LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    lp.setMargins(0, 10 * dp, 0, 0);
    b.setLayoutParams(lp);
    return b;
  }

  private void toast(String s) {
    android.widget.Toast.makeText(this, s, android.widget.Toast.LENGTH_SHORT).show();
  }

  // ---------------------------------------------------------------- state

  private boolean signedIn() { return !Api.token(this).isEmpty(); }

  private void refresh() {
    boolean in = signedIn();
    boolean canDraw = OverlayService.canDraw(this);
    SharedPreferences p = Api.prefs(this);

    form.setVisibility(in ? View.GONE : View.VISIBLE);
    if (!in) {
      setRegistering(registering);
      fTeam.setText(p.getString(Api.K_TEAM, ""));
      fPlayerId.setText(p.getString(Api.K_GAMEID, ""));
    }

    permBtn.setVisibility(in && !canDraw ? View.VISIBLE : View.GONE);
    floatBtn.setVisibility(in && canDraw ? View.VISIBLE : View.GONE);
    settings.setVisibility(in ? View.VISIBLE : View.GONE);
    floatBtn.setText(isOverlayOn() ? "Hide floating flag" : "Show floating flag");

    // Team radio only makes sense once accepted into the event and on a team.
    String myTeam = team.isEmpty() ? p.getString(Api.K_TEAM, "") : team;
    boolean canRadio = in && "approved".equals(approval) && !myTeam.isEmpty();
    radioBox.setVisibility(canRadio ? View.VISIBLE : View.GONE);
    // Reports are for drivers in the event, team or not.
    reportBox.setVisibility(in && "approved".equals(approval) ? View.VISIBLE : View.GONE);

    if (!in) { status.setText(""); return; }

    String team = p.getString(Api.K_TEAM, "");
    StringBuilder sb = new StringBuilder(p.getString(Api.K_NICK, "") + " #" + p.getString(Api.K_NUM, "")
        + (team.isEmpty() ? "" : " · " + team));
    // What race control has decided matters more than being signed in: a driver who has
    // registered but not been accepted gets no flags, and needs to know that is why.
    if ("pending".equals(approval)) {
      sb.append(" — waiting for race control.\nThey can see your name. Flags start once they let you in.");
    } else if ("rejected".equals(approval)) {
      sb.append(" — race control has not accepted this sign-in.\nAsk them, then reopen the app.");
    } else if ("approved".equals(approval)) {
      sb.append(" — you are in the event");
    } else {
      sb.append(" — signed in");
    }
    if (checkedIn) sb.append("\nChecked in for today.");
    if (!canDraw) sb.append("\n\nAndroid still needs permission to draw the window.");
    status.setText(sb.toString());
  }

  private final Runnable approvalPoll = this::pollApproval;

  /**
   * Ask the server what this driver's standing is, and keep asking while it is undecided.
   *
   * Someone who has just registered is sitting on this screen waiting to be let in; making
   * them close and reopen the app to find out would be the wrong answer to the only
   * question they have. It stops when the activity does — from then on the floating window
   * is what carries the event.
   */
  private void pollApproval() {
    final String host = Api.host(this);
    final String token = Api.token(this);
    if (host.isEmpty() || token.isEmpty()) return;
    final Backend backend = Backend.forTarget(host);
    new Thread(() -> {
      String next;
      String teamSeen = "";
      JSONObject radioSeen = null;
      boolean inSeen = false;
      try {
        JSONObject o = backend.state(token);
        if (!o.optBoolean("ok")) {
          ui.post(() -> {
            Api.prefs(this).edit().remove(Api.K_TOKEN).apply();
            approval = "";
            refresh();
          });
          return;
        }
        next = o.optString("status", "");
        teamSeen = o.optString("team", "");
        radioSeen = o.optJSONObject("radio");
        inSeen = o.optBoolean("checkedIn", false);
      } catch (Exception ignored) {
        return;                 // out of range; the next resume will ask again
      }
      final String seen = next;
      final String gotTeam = teamSeen;
      final JSONObject radio = radioSeen;
      final boolean gotIn = inSeen;
      ui.post(() -> {
        boolean teamChanged = !gotTeam.equals(team) || gotIn != checkedIn;
        checkedIn = gotIn;
        if (teamChanged) { team = gotTeam; if (!gotTeam.isEmpty()) Api.prefs(this).edit().putString(Api.K_TEAM, gotTeam).apply(); }
        showIncomingRadio(radio);
        if (!seen.equals(approval) || teamChanged) { approval = seen; refresh(); }
        // Only while the answer can still change. Once accepted there is nothing to watch.
        if ("pending".equals(approval)) {
          ui.removeCallbacks(approvalPoll);
          ui.postDelayed(approvalPoll, 3000);
        }
      });
    }).start();
  }

  private void askOverlay() {
    // Only the user can grant this, in Settings, and Android gives no way to shortcut it.
    startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
        Uri.parse("package:" + getPackageName())));
  }

  private void toggleFloat() {
    Intent i = new Intent(this, OverlayService.class);
    if (isOverlayOn()) {
      i.setAction(OverlayService.ACTION_STOP);
      startService(i);
      Api.prefs(this).edit().putBoolean("on", false).apply();
      floatBtn.setText("Show floating flag");
    } else {
      startForegroundService2(i);
      Api.prefs(this).edit().putBoolean("on", true).apply();
      floatBtn.setText("Hide floating flag");
    }
  }

  private boolean isOverlayOn() { return Api.prefs(this).getBoolean("on", false); }

  private void restartOverlayIfOn() {
    if (!isOverlayOn()) return;
    // The window's size, opacity and layout are fixed when it is added, so a change means
    // taking it down and putting it back up. It is instant and the driver sees a blink.
    Intent stop = new Intent(this, OverlayService.class);
    stop.setAction(OverlayService.ACTION_STOP);
    startService(stop);
    ui.postDelayed(() -> startForegroundService2(new Intent(this, OverlayService.class)), 250);
  }

  private void startForegroundService2(Intent i) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(i);
    else startService(i);
  }

  // ---------------------------------------------------------------- signing in and up

  private void submit() {
    final String typed = fHost.getText().toString();

    /*
     * What was typed, reduced to the one thing that identifies the event.
     *
     * A code stays a code; a link copied out of race control keeps only the code inside it;
     * an address on this network keeps only its host and port. Storing that rather than the
     * raw text means the field says NDL3 next time, and everything downstream — the overlay
     * service included — reads one shape.
     */
    final String code = Target.eventCode(typed);
    final String host = code.isEmpty() ? Api.normaliseHost(typed) : code;
    final String nick = fNick.getText().toString().trim();
    final String num = fNum.getText().toString().trim();
    final String team = fTeam.getText().toString().trim();
    final String gameId = fPlayerId.getText().toString().trim();
    final String pass = fPass.getText().toString();
    final boolean reg = registering;

    // Checked here as well as on the server so a driver with no signal still gets told what
    // is wrong, rather than watching a request time out.
    if (host.isEmpty()) { status.setText("Type your event code, or the server address"); return; }
    // The website address is the thing a new driver has in their hand, and it names no
    // event. Said here rather than after thirty seconds of trying to reach port 4700 on it.
    if (code.isEmpty() && Target.isWebsite(typed)) {
      status.setText("That is the website address, not an event. Type the event code your "
          + "race control gave you — four to twelve letters, like NDL3.");
      return;
    }
    if (num.isEmpty()) { status.setText("Type your race number"); return; }
    if (reg && nick.isEmpty()) { status.setText("Type the name you race under"); return; }
    if (reg && pass.length() < 4) { status.setText("Pick a password of at least 4 characters"); return; }

    go.setEnabled(false);
    status.setText(reg ? "Creating your account…" : "Signing in…");
    new Thread(() -> {
      String message;
      boolean ok = false;
      Backend backend = Backend.forTarget(host);
      try {
        JSONObject o = reg ? backend.register(nick, num, pass, team, gameId)
                           : backend.login(num, pass, team, gameId);
        if (o.optBoolean("ok")) {
          // A hosted event answers with the name and number at the top level; the local
          // server wraps them in a driver object. Take either, fall back to what was typed.
          JSONObject d = o.optJSONObject("driver");
          String gotNick = d != null ? d.optString("nick", nick) : o.optString("nick", nick);
          String gotNum  = d != null ? d.optString("num", num)   : o.optString("num", num);
          // The team as the event now holds it, which is not always what was typed: an
          // empty box leaves the stored one alone, and the answer says which won.
          String gotTeam = d != null ? d.optString("team", team)  : o.optString("team", team);
          // The player ID the event now holds. The laptop server sends none, so it falls back
          // to what was typed; the hosted event echoes the stored one, which wins.
          String gotGameId = d != null ? d.optString("gameId", gameId) : o.optString("gameId", gameId);
          Api.prefs(this).edit()
              .putString(Api.K_HOST, host)
              .putString(Api.K_TOKEN, o.optString("token"))
              .putString(Api.K_NICK, gotNick)
              .putString(Api.K_NUM, gotNum)
              .putString(Api.K_TEAM, gotTeam)
              .putString(Api.K_GAMEID, gotGameId)
              .apply();
          ok = true;
          message = "";
        } else {
          message = o.optString("error", reg ? "Could not create the account" : "Could not sign in");
        }
      } catch (Exception e) {
        message = "Cannot reach " + backend.describe() + ". Are you online?";
      }
      final String msg = message;
      final boolean good = ok;
      ui.post(() -> {
        go.setEnabled(true);
        if (!good) { status.setText(msg); return; }
        // A new account is pending until someone accepts it. Saying so immediately beats
        // showing "signed in" and then no flags.
        approval = reg ? "pending" : "";
        refresh();
        pollApproval();
      });
    }).start();
  }

  // ---------------------------------------------------------------- team radio

  /** Send what is typed to the rest of the team. The floating window carries the reply. */
  private void sendRadio() {
    final String text = fRadio.getText().toString().trim();
    if (text.isEmpty()) return;
    final String host = Api.host(this);
    final String token = Api.token(this);
    if (host.isEmpty() || token.isEmpty()) return;
    radioSend.setEnabled(false);
    new Thread(() -> {
      String msg;
      boolean ok = false;
      try {
        JSONObject o = Backend.forTarget(host).sendRadio(token, text);
        ok = o.optBoolean("ok");
        msg = ok ? "Sent to your team" : o.optString("error", "Could not send");
      } catch (Exception e) {
        msg = "Cannot reach the server";
      }
      final String m = msg;
      final boolean good = ok;
      ui.post(() -> {
        radioSend.setEnabled(true);
        if (good) fRadio.setText("");
        toast(m);
      });
    }).start();
  }

  private void sendReport() {
    final String text = fReport.getText().toString().trim();
    final String against = fAgainst.getText().toString().trim();
    if (text.isEmpty()) { toast("Say what happened"); return; }
    final String host = Api.host(this);
    final String token = Api.token(this);
    if (host.isEmpty() || token.isEmpty()) return;
    reportSend.setEnabled(false);
    new Thread(() -> {
      String msg;
      boolean ok = false;
      try {
        JSONObject o = Backend.forTarget(host).report(token, against, text);
        ok = o.optBoolean("ok");
        msg = ok ? "Sent to race control" : o.optString("error", "Could not send");
      } catch (Exception e) {
        msg = "Cannot reach the server";
      }
      final String m = msg;
      final boolean good = ok;
      ui.post(() -> {
        reportSend.setEnabled(true);
        if (good) { fReport.setText(""); fAgainst.setText(""); }
        toast(m);
      });
    }).start();
  }

  /** A teammate's message, echoed here as a toast. The floating window is the real channel. */
  private void showIncomingRadio(JSONObject r) {
    if (r == null) return;
    String id = r.optString("id", "");
    if (id.isEmpty()) return;
    if (lastRadioId == null) { lastRadioId = id; return; }   // seed, do not replay old chatter
    if (id.equals(lastRadioId)) return;
    lastRadioId = id;
    String from = r.optString("from", "");
    String text = r.optString("text", "");
    if (text.isEmpty()) return;
    String myNick = Api.prefs(this).getString(Api.K_NICK, "");
    if (!myNick.isEmpty() && myNick.equalsIgnoreCase(from)) return;   // my own message
    toast((from.isEmpty() ? "Team" : from) + ": " + text);
  }

  private void doSignOut() {
    final String host = Api.host(this);
    final String token = Api.token(this);
    Intent stop = new Intent(this, OverlayService.class);
    stop.setAction(OverlayService.ACTION_STOP);
    startService(stop);
    ui.removeCallbacks(approvalPoll);
    Api.prefs(this).edit().remove(Api.K_TOKEN).putBoolean("on", false).apply();
    approval = "";
    refresh();
    // Told after the fact: the driver is signed out of this phone either way, and a server
    // that cannot be reached must not be able to keep them logged in.
    new Thread(() -> Backend.forTarget(host).logout(token)).start();
  }
}
