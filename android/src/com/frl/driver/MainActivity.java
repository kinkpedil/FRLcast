package com.frl.driver;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.InputType;
import android.text.method.PasswordTransformationMethod;
import android.util.TypedValue;
import android.view.Gravity;
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
 * Sign in, or sign up, and then get out of the way.
 *
 * Everything a driver does mid-race happens in the floating window; this screen exists to
 * get them an account, to ask Android for the one permission that makes the window
 * possible, and to set its size. It is built in code rather than XML because it is one
 * screen and a layout file would be another thing to keep in step with it.
 *
 * The look is a small, deliberate design system, all defined here: one dark ground, cards
 * for each group, rounded fields and buttons, the FRLcast teal used sparingly. The helpers
 * (card, field, filledBtn, ghostBtn, chip) are the whole vocabulary; every screen state is
 * built from them, so the styling lives in one place rather than being sprinkled per view.
 */
public class MainActivity extends Activity {

  // ---------------------------------------------------------------- palette
  private static final int BG      = 0xFF0B0D11;
  private static final int CARD    = 0xFF141922;
  private static final int FIELD   = 0xFF1B212B;
  private static final int BORDER  = 0xFF283039;
  private static final int INK     = 0xFFEEF1F5;
  private static final int MUTE    = 0xFF8C939F;
  private static final int FAINT   = 0xFF5C6470;
  private static final int ACCENT  = 0xFF00E0A4;
  private static final int ACCENT_INK = 0xFF04120D;
  private static final int BLUE    = 0xFF3B9EFF;
  private static final int WARN    = 0xFFFFD60A;
  private static final int DANGER  = 0xFFFF5A4E;

  private EditText fHost, fNick, fNum, fTeam, fPlayerId, fPass, fRadio, fAgainst, fReport, fAppeal;
  private Button appealSend;
  private TextView status, statusName, statusChip, hint, formLede, nickLabel, radioLabel;
  private Button go, swap, floatBtn, permBtn, signOut, radioSend, reportSend;
  private LinearLayout sizeRow, settings, form, radioBox, reportBox, appealBox, statusCard;
  private CheckBox subBox, boardBox, voiceBox;
  private SeekBar alpha;

  /** The team the server last reported for this driver; team radio only shows with one. */
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
    getWindow().getDecorView().setBackgroundColor(BG);

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
    root.setPadding(18 * dp, 22 * dp, 18 * dp, 30 * dp);

    root.addView(header());

    // ---- the sign-in / sign-up form, one card -------------------------------
    form = card();
    addTop(root, form, 20);

    formLede = new TextView(this);
    formLede.setTextColor(MUTE);
    formLede.setTextSize(14);
    formLede.setLineSpacing(2 * dp, 1f);
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

    fTeam = field("KINKPEDIL RACING", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS);
    fTeam.setText(Api.prefs(this).getString(Api.K_TEAM, ""));
    form.addView(label("TEAM  (optional)"));
    form.addView(fTeam);

    fPlayerId = field("FRL-XXXXXX", InputType.TYPE_CLASS_TEXT);
    fPlayerId.setText(Api.prefs(this).getString(Api.K_GAMEID, ""));
    form.addView(label("FR LEGENDS PLAYER ID  (optional)"));
    form.addView(fPlayerId);

    fPass = field("password", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
    form.addView(label("PASSWORD"));
    form.addView(fPass);

    go = filledBtn("Sign in", ACCENT, ACCENT_INK);
    go.setOnClickListener(v -> submit());
    addTop(form, go, 18);

    swap = ghostBtn("First time here? Create an account", INK);
    swap.setOnClickListener(v -> setRegistering(!registering));
    addTop(form, swap, 10);

    form.addView(fine("A short code like NDL3 means a hosted event: race control gives you "
        + "one, and pasting any link they send works too. An address like 192.168.1.20:4700 "
        + "means race control is on a machine on this network, and your password crosses it "
        + "in the clear, so do not reuse a real one."));

    // ---- status card, shown once signed in ----------------------------------
    statusCard = card();
    addTop(root, statusCard, 20);
    LinearLayout statusRow = new LinearLayout(this);
    statusRow.setOrientation(LinearLayout.HORIZONTAL);
    statusRow.setGravity(Gravity.CENTER_VERTICAL);
    statusName = new TextView(this);
    statusName.setTextColor(INK);
    statusName.setTextSize(18);
    statusName.setTypeface(Typeface.DEFAULT_BOLD);
    statusRow.addView(statusName, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
    statusChip = chip("", ACCENT);
    statusRow.addView(statusChip);
    statusCard.addView(statusRow);
    status = new TextView(this);
    status.setTextColor(MUTE);
    status.setTextSize(13.5f);
    status.setLineSpacing(3 * dp, 1f);
    LinearLayout.LayoutParams slp = new LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    slp.topMargin = 10 * dp;
    statusCard.addView(status, slp);

    // ---- team radio ---------------------------------------------------------
    radioBox = card();
    addTop(root, radioBox, 14);
    radioLabel = sectionTitle("TEAM RADIO");
    radioBox.addView(radioLabel);
    LinearLayout radioRow = row();
    fRadio = field("BOX BOX BOX", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
    radioRow.addView(fRadio, grow());
    radioSend = sendBtn("Send", BLUE, ACCENT_INK);
    radioSend.setOnClickListener(v -> sendRadio());
    radioRow.addView(radioSend, sendLp());
    radioBox.addView(radioRow);

    // ---- report an incident -------------------------------------------------
    reportBox = card();
    addTop(root, reportBox, 14);
    reportBox.addView(sectionTitle("REPORT AN INCIDENT"));
    LinearLayout reportRow = row();
    fAgainst = field("#", InputType.TYPE_CLASS_NUMBER);
    reportRow.addView(fAgainst, new LinearLayout.LayoutParams(64 * dp, 48 * dp));
    fReport = field("Pushed me wide at turn 3", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
    LinearLayout.LayoutParams frlp = grow();
    frlp.leftMargin = 8 * dp;
    reportRow.addView(fReport, frlp);
    reportSend = sendBtn("Send", FIELD, INK);
    reportSend.setOnClickListener(v -> sendReport());
    reportRow.addView(reportSend, sendLp());
    reportBox.addView(reportRow);
    reportBox.addView(fine("Only race control sees this. They decide what happens: a report is not a penalty."));

    // ---- appeal a penalty ---------------------------------------------------
    appealBox = card();
    addTop(root, appealBox, 14);
    appealBox.addView(sectionTitle("APPEAL A PENALTY"));
    LinearLayout appealRow = row();
    fAppeal = field("Why you are appealing", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
    appealRow.addView(fAppeal, grow());
    appealSend = sendBtn("Appeal", DANGER, Color.WHITE);
    appealSend.setOnClickListener(v -> sendAppeal());
    appealRow.addView(appealSend, sendLp());
    appealBox.addView(appealRow);
    appealBox.addView(fine("Appeals your most recent penalty. The stewards decide; an overturned penalty is removed."));

    // ---- the floating window ------------------------------------------------
    permBtn = filledBtn("Allow drawing over other apps", WARN, ACCENT_INK);
    permBtn.setOnClickListener(v -> askOverlay());
    addTop(root, permBtn, 14);

    floatBtn = filledBtn("Show floating flag", ACCENT, ACCENT_INK);
    floatBtn.setOnClickListener(v -> toggleFloat());
    addTop(root, floatBtn, 14);

    // ---- window settings ----------------------------------------------------
    settings = card();
    addTop(root, settings, 14);

    settings.addView(sectionTitle("WINDOW SIZE"));
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
        + "you like, down to a thumbnail. It stays where you put it.");
    settings.addView(hint);

    TextView opLabel = label("OPACITY");
    settings.addView(opLabel);
    alpha = new SeekBar(this);
    alpha.setMax(100);
    alpha.setProgress(Api.prefs(this).getInt(Api.K_ALPHA, 100));
    alpha.setProgressTintList(ColorStateList.valueOf(ACCENT));
    alpha.setThumbTintList(ColorStateList.valueOf(ACCENT));
    alpha.setProgressBackgroundTintList(ColorStateList.valueOf(BORDER));
    alpha.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
      @Override public void onProgressChanged(SeekBar s, int v, boolean user) {
        if (!user) return;
        int pct = Math.max(25, v);        // fully invisible is a window you cannot find
        Api.prefs(MainActivity.this).edit().putInt(Api.K_ALPHA, pct).apply();
        // Applied live to the running window: a restart per slider step stops and starts the
        // service dozens of times a second and Android kills the app for it.
        if (isOverlayOn()) {
          Intent i = new Intent(MainActivity.this, OverlayService.class);
          i.setAction(OverlayService.ACTION_ALPHA);
          startService(i);
        }
      }
      @Override public void onStartTrackingTouch(SeekBar s) {}
      @Override public void onStopTrackingTouch(SeekBar s) {}
    });
    settings.addView(alpha);

    subBox = check("Show the instruction line", Api.prefs(this).getBoolean(Api.K_SUB, true));
    subBox.setOnCheckedChangeListener((v, on) -> {
      Api.prefs(this).edit().putBoolean(Api.K_SUB, on).apply();
      restartOverlayIfOn();
    });
    settings.addView(subBox);

    boardBox = check("Show the pit board (gaps, laps left)", Api.prefs(this).getBoolean(Api.K_BOARD, true));
    boardBox.setOnCheckedChangeListener((v, on) -> {
      Api.prefs(this).edit().putBoolean(Api.K_BOARD, on).apply();
      restartOverlayIfOn();
    });
    settings.addView(boardBox);

    // Read on every call, so switching it needs no restart of the window.
    voiceBox = check("Voice spotter: say flags, penalties and radio out loud", Api.prefs(this).getBoolean(Api.K_VOICE, true));
    voiceBox.setOnCheckedChangeListener((v, on) -> Api.prefs(this).edit().putBoolean(Api.K_VOICE, on).apply());
    settings.addView(voiceBox);

    CheckBox notifyBox = check("Reminders before the session and race control's messages as notifications", Api.prefs(this).getBoolean(Api.K_NOTIFY, true));
    notifyBox.setOnCheckedChangeListener((v, on) -> {
      Api.prefs(this).edit().putBoolean(Api.K_NOTIFY, on).apply();
      // switching it off also removes reminders already waiting
      if (!on) Reminders.schedule(this, null, "");
    });
    settings.addView(notifyBox);

    signOut = ghostBtn("Sign out", DANGER);
    signOut.setOnClickListener(v -> doSignOut());
    addTop(root, signOut, 14);

    ScrollView sv = new ScrollView(this);
    sv.setBackgroundColor(BG);
    sv.setClipToPadding(false);
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

  // ---------------------------------------------------------------- design system

  /** A rounded surface: fill, an optional 1px-ish border, and a corner radius in dp. */
  private GradientDrawable round(int fill, int stroke, float radiusDp) {
    GradientDrawable g = new GradientDrawable();
    g.setShape(GradientDrawable.RECTANGLE);
    g.setColor(fill);
    g.setCornerRadius(radiusDp * dp);
    if (stroke != 0) g.setStroke(Math.max(1, (int) (1.2f * dp)), stroke);
    return g;
  }

  /** The FRLcast wordmark with its icon tile. */
  private View header() {
    LinearLayout h = new LinearLayout(this);
    h.setOrientation(LinearLayout.HORIZONTAL);
    h.setGravity(Gravity.CENTER_VERTICAL);

    TextView mark = new TextView(this);
    mark.setText("F");
    mark.setTextColor(ACCENT_INK);
    mark.setTextSize(23);
    mark.setTypeface(Typeface.DEFAULT_BOLD);
    mark.setGravity(Gravity.CENTER);
    mark.setBackground(round(ACCENT, 0, 13));
    h.addView(mark, new LinearLayout.LayoutParams(44 * dp, 44 * dp));

    LinearLayout col = new LinearLayout(this);
    col.setOrientation(LinearLayout.VERTICAL);
    TextView name = new TextView(this);
    name.setText("FRLcast");
    name.setTextColor(INK);
    name.setTextSize(21);
    name.setTypeface(Typeface.DEFAULT_BOLD);
    col.addView(name);
    TextView sub = new TextView(this);
    sub.setText("DRIVER");
    sub.setTextColor(ACCENT);
    sub.setTextSize(10.5f);
    sub.setLetterSpacing(0.28f);
    sub.setTypeface(Typeface.DEFAULT_BOLD);
    col.addView(sub);
    LinearLayout.LayoutParams clp = new LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    clp.leftMargin = 12 * dp;
    h.addView(col, clp);
    return h;
  }

  /** A grouping card: rounded surface, hairline border, generous inner padding. */
  private LinearLayout card() {
    LinearLayout c = new LinearLayout(this);
    c.setOrientation(LinearLayout.VERTICAL);
    c.setBackground(round(CARD, BORDER, 18));
    c.setPadding(16 * dp, 16 * dp, 16 * dp, 16 * dp);
    return c;
  }

  /** Add a block to the root column with a top margin. */
  private void addTop(LinearLayout parent, View v, int topDp) {
    LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    lp.topMargin = topDp * dp;
    parent.addView(v, lp);
  }

  private LinearLayout row() {
    LinearLayout r = new LinearLayout(this);
    r.setOrientation(LinearLayout.HORIZONTAL);
    r.setGravity(Gravity.CENTER_VERTICAL);
    return r;
  }

  private LinearLayout.LayoutParams grow() {
    return new LinearLayout.LayoutParams(0, 48 * dp, 1f);
  }

  private LinearLayout.LayoutParams sendLp() {
    LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.WRAP_CONTENT, 48 * dp);
    lp.leftMargin = 8 * dp;
    return lp;
  }

  /** The big card heading. */
  private TextView sectionTitle(String s) {
    TextView t = new TextView(this);
    t.setText(s);
    t.setTextColor(MUTE);
    t.setTextSize(11.5f);
    t.setLetterSpacing(0.16f);
    t.setTypeface(Typeface.DEFAULT_BOLD);
    t.setPadding(0, 0, 0, 11 * dp);
    return t;
  }

  /** A field label. */
  private TextView label(String s) {
    TextView t = new TextView(this);
    t.setText(s);
    t.setTextColor(MUTE);
    t.setTextSize(11);
    t.setLetterSpacing(0.1f);
    t.setTypeface(Typeface.DEFAULT_BOLD);
    t.setPadding(2 * dp, 15 * dp, 0, 7 * dp);
    return t;
  }

  private TextView fine(String s) {
    TextView t = new TextView(this);
    t.setText(s);
    t.setTextColor(FAINT);
    t.setTextSize(12);
    t.setLineSpacing(2 * dp, 1f);
    LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    lp.topMargin = 12 * dp;
    t.setLayoutParams(lp);
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
    e.setBackground(round(FIELD, BORDER, 12));
    e.setGravity(Gravity.CENTER_VERTICAL);
    e.setMinHeight(48 * dp);
    e.setPadding(14 * dp, 0, 14 * dp, 0);
    e.setTextColor(INK);
    e.setHintTextColor(FAINT);
    e.setTextSize(16);
    return e;
  }

  private Button baseBtn(String s, int fg, float size) {
    Button b = new Button(this);
    b.setText(s);
    b.setAllCaps(false);
    b.setTextSize(size);
    b.setTextColor(fg);
    b.setTypeface(Typeface.DEFAULT_BOLD);
    b.setStateListAnimator(null);            // drop the default elevation shadow
    b.setElevation(0);
    return b;
  }

  /** A solid, tappable button with a ripple over its rounded fill. */
  private Button filledBtn(String s, int bg, int fg) {
    Button b = baseBtn(s, fg, 15.5f);
    b.setBackground(new RippleDrawable(ColorStateList.valueOf(0x33000000), round(bg, 0, 14), null));
    b.setPadding(0, 15 * dp, 0, 15 * dp);
    return b;
  }

  /** An outlined button: transparent fill, hairline border, ink or accent text. */
  private Button ghostBtn(String s, int textColor) {
    Button b = baseBtn(s, textColor, 15f);
    b.setBackground(new RippleDrawable(ColorStateList.valueOf(0x22FFFFFF), round(0x00000000, BORDER, 14), null));
    b.setPadding(0, 14 * dp, 0, 14 * dp);
    return b;
  }

  /** The small button that sits beside a field in a row. */
  private Button sendBtn(String s, int bg, int fg) {
    Button b = baseBtn(s, fg, 14.5f);
    int stroke = bg == FIELD ? BORDER : 0;
    b.setBackground(new RippleDrawable(ColorStateList.valueOf(0x22FFFFFF), round(bg, stroke, 12), null));
    b.setPadding(18 * dp, 0, 18 * dp, 0);
    return b;
  }

  /** A rounded status pill: coloured text on a faint tint of the same colour. */
  private TextView chip(String text, int color) {
    TextView t = new TextView(this);
    t.setText(text);
    t.setTextColor(color);
    t.setTextSize(11);
    t.setLetterSpacing(0.1f);
    t.setTypeface(Typeface.DEFAULT_BOLD);
    t.setPadding(11 * dp, 5 * dp, 11 * dp, 5 * dp);
    t.setBackground(round((color & 0x00FFFFFF) | 0x26000000, 0, 100));
    return t;
  }

  private void setChip(String text, int color) {
    if (text.isEmpty()) { statusChip.setVisibility(View.GONE); return; }
    statusChip.setVisibility(View.VISIBLE);
    statusChip.setText(text);
    statusChip.setTextColor(color);
    statusChip.setBackground(round((color & 0x00FFFFFF) | 0x26000000, 0, 100));
  }

  private CheckBox check(String s, boolean on) {
    CheckBox c = new CheckBox(this);
    c.setText(s);
    c.setTextColor(INK);
    c.setTextSize(14);
    c.setChecked(on);
    c.setButtonTintList(ColorStateList.valueOf(ACCENT));
    LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    lp.topMargin = 10 * dp;
    lp.leftMargin = -2 * dp;
    c.setLayoutParams(lp);
    return c;
  }

  private void addSize(LinearLayout rowV, String name, int w, int h) {
    Button b = baseBtn(name, INK, 13f);
    b.setBackground(new RippleDrawable(ColorStateList.valueOf(0x22FFFFFF), round(FIELD, BORDER, 11), null));
    b.setPadding(0, 11 * dp, 0, 11 * dp);
    LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
    lp.setMargins(3 * dp, 0, 3 * dp, 0);
    b.setOnClickListener(v -> {
      Api.prefs(this).edit().putInt(Api.K_W, w * dp).putInt(Api.K_H, h * dp).apply();
      restartOverlayIfOn();
      toast("Window set to " + name.toLowerCase());
    });
    rowV.addView(b, lp);
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

    statusCard.setVisibility(in ? View.VISIBLE : View.GONE);
    permBtn.setVisibility(in && !canDraw ? View.VISIBLE : View.GONE);
    floatBtn.setVisibility(in && canDraw ? View.VISIBLE : View.GONE);
    settings.setVisibility(in ? View.VISIBLE : View.GONE);
    floatBtn.setText(isOverlayOn() ? "Hide floating flag" : "Show floating flag");

    // Team radio only makes sense once accepted into the event and on a team.
    String myTeam = team.isEmpty() ? p.getString(Api.K_TEAM, "") : team;
    boolean approved = "approved".equals(approval);
    boolean canRadio = in && approved && !myTeam.isEmpty();
    radioBox.setVisibility(canRadio ? View.VISIBLE : View.GONE);
    // Reports and appeals are for drivers in the event, team or not.
    reportBox.setVisibility(in && approved ? View.VISIBLE : View.GONE);
    appealBox.setVisibility(in && approved ? View.VISIBLE : View.GONE);

    if (!in) { status.setText(""); return; }

    String storedTeam = p.getString(Api.K_TEAM, "");
    statusName.setText(p.getString(Api.K_NICK, "") + "  #" + p.getString(Api.K_NUM, "")
        + (storedTeam.isEmpty() ? "" : "  ·  " + storedTeam));

    // What race control has decided matters more than being signed in: a driver who has
    // registered but not been accepted gets no flags, and needs to know that is why.
    String detail;
    if ("pending".equals(approval)) {
      setChip("PENDING", WARN);
      detail = "Waiting for race control. They can see your name; flags start once they let you in.";
    } else if ("rejected".equals(approval)) {
      setChip("NOT IN", DANGER);
      detail = "Race control has not accepted this sign-in. Ask them, then reopen the app.";
    } else if (approved) {
      setChip("IN THE EVENT", ACCENT);
      detail = checkedIn ? "You are in the event and checked in for today." : "You are in the event.";
    } else {
      setChip("SIGNED IN", MUTE);
      detail = "Signed in.";
    }
    if (!canDraw) detail += "\nAndroid still needs permission to draw the window.";
    status.setText(detail);
  }

  private final Runnable approvalPoll = this::pollApproval;

  /**
   * Ask the server what this driver's standing is, and keep asking while it is undecided.
   *
   * Someone who has just registered is sitting on this screen waiting to be let in; making
   * them close and reopen the app to find out would be the wrong answer to the only
   * question they have. It stops when the activity does: from then on the floating window
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
        JSONObject ev = o.optJSONObject("event");
        Reminders.schedule(this, o.optJSONObject("countdown"), ev == null ? "" : ev.optString("name", ""));
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
     * raw text means the field says NDL3 next time, and everything downstream, the overlay
     * service included, reads one shape.
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
          + "race control gave you: four to twelve letters, like NDL3.");
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
          String gotTeam = d != null ? d.optString("team", team)  : o.optString("team", team);
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

  private void sendAppeal() {
    final String reason = fAppeal.getText().toString().trim();
    if (reason.isEmpty()) { toast("Say why you are appealing"); return; }
    final String host = Api.host(this);
    final String token = Api.token(this);
    if (host.isEmpty() || token.isEmpty()) return;
    appealSend.setEnabled(false);
    new Thread(() -> {
      String msg;
      boolean ok = false;
      try {
        JSONObject o = Backend.forTarget(host).appeal(token, reason);
        ok = o.optBoolean("ok");
        msg = ok ? "Appeal sent to the stewards" : o.optString("error", "Could not send");
      } catch (Exception e) {
        msg = "Cannot reach the server";
      }
      final String m = msg;
      final boolean good = ok;
      ui.post(() -> {
        appealSend.setEnabled(true);
        if (good) fAppeal.setText("");
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
