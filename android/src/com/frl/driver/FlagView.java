package com.frl.driver;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.view.View;

import java.util.ArrayList;
import java.util.List;

/**
 * The floating flag.
 *
 * This is the whole point of the app. The web version had to hand a video to Android and
 * accept whatever window size the system felt like giving back; here the window is ours,
 * so the driver drags the corner and it becomes exactly as small as they want. Nothing in
 * this class imposes a size — it draws to fill whatever it is given, down to a thumbnail.
 */
public class FlagView extends View {

  /** Below this a drag has clearly gone wrong and the window would be unrecoverable. */
  public static final int MIN_PX = 64;

  private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
  private final Paint text = new Paint(Paint.ANTI_ALIAS_FLAG);
  private final Paint grip = new Paint(Paint.ANTI_ALIAS_FLAG);
  private final RectF round = new RectF();

  private String flag = "idle";
  private String who = "";
  private String personal = "";     // a black or blue flag outranks the session's
  private String board = "";        // the pit board strip along the bottom, or ""
  private boolean showSub = true;

  /*
   * A penalty is an announcement, not a state.
   *
   * It takes the whole window for a few seconds and then gives it back to the flag, which
   * is the thing the driver needs continuously. Leaving it up would mean a driver who
   * picked up a five second penalty on lap 2 spends the rest of the race unable to see
   * whether the track is green.
   */
  private String penHead = "";
  private String penReason = "";

  public FlagView(Context c) {
    super(c);
    text.setTextAlign(Paint.Align.CENTER);
    text.setTypeface(Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD));
  }

  public void setShowSub(boolean on) { showSub = on; invalidate(); }

  public void update(String flag, String who, String personal) {
    this.flag = flag;
    this.who = who == null ? "" : who;
    this.personal = personal == null ? "" : personal;
    invalidate();
  }

  public String flag() { return flag; }

  /** The pit board line: place, gap to the car ahead and behind, laps left. "" hides it. */
  public void setBoard(String line) {
    String next = line == null ? "" : line;
    if (next.equals(board)) return;
    board = next;
    invalidate();
  }

  /** Take the window for a moment to announce a penalty. */
  public void showPenalty(String head, String reason) {
    penHead = head == null ? "" : head;
    penReason = reason == null ? "" : reason;
    invalidate();
  }

  /** Give it back to the flag. */
  public void clearPenalty() {
    penHead = "";
    penReason = "";
    invalidate();
  }

  /** True when the touch landed on the resize corner rather than the body. */
  public boolean onGrip(float x, float y) {
    float g = gripSize();
    return x >= getWidth() - g && y >= getHeight() - g;
  }

  private float gripSize() {
    // Big enough for a thumb, but never so big it swallows a small window.
    return Math.max(18f, Math.min(46f, Math.min(getWidth(), getHeight()) * 0.28f));
  }

  @Override protected void onDraw(Canvas cv) {
    final int w = getWidth(), h = getHeight();
    if (w <= 0 || h <= 0) return;

    final boolean penalty = !penHead.isEmpty();
    final boolean black = !penalty && personal.startsWith("BLACK");
    final int bg = penalty ? Flags.PENALTY : (black ? Color.WHITE : Flags.color(flag));
    final boolean pale = !penalty && (black || Flags.isPale(flag));
    final int ink = pale ? Color.parseColor("#05070a") : Color.WHITE;

    fill.setColor(bg);
    round.set(0, 0, w, h);
    float radius = Math.min(w, h) * 0.12f;
    cv.drawRoundRect(round, radius, radius, fill);

    text.setColor(ink);
    final float pad = Math.max(4f, Math.min(w, h) * 0.07f);
    final float maxW = w - pad * 2;

    // A window can be dragged down to a chip the size of a coin. At that point the flag's
    // colour is the entire message and any lettering would be noise, so the drawing stops
    // here rather than rendering something unreadable.
    if (Math.min(w, h) < 46) return;

    String head = penalty ? penHead : (personal.isEmpty() ? Flags.label(flag) : personal);
    // The reason is shown for a penalty even when the driver has turned the instruction
    // line off: that setting is about the standing flag being repetitive, and a penalty
    // without its reason is the half of the message worth arguing about.
    String body = penalty ? penReason : (personal.isEmpty() ? Flags.action(flag) : "");

    // How the space is divided. Measure first, draw second — laying the name out against a
    // fixed fraction and then squeezing the rest in is what made the web version silently
    // drop its instruction line on short windows.
    float topH = 0;
    boolean drawWho = !who.isEmpty() && h >= 130;
    if (drawWho) topH = Math.max(9f, Math.min(h * 0.11f, 26f));

    // The pit board takes a strip at the bottom, only when the window is big enough to keep
    // the flag itself readable above it. The flag always wins the space.
    float botH = 0;
    boolean drawBoard = !board.isEmpty() && !penalty && h >= 120 && w >= 140;
    if (drawBoard) botH = Math.max(10f, Math.min(h * 0.14f, 30f));

    float avail = h - topH - botH - pad;
    boolean wantSub = (showSub || penalty) && !body.isEmpty() && avail > 70;

    TextFit.Block name = TextFit.fit(head, maxW, wantSub ? avail * 0.6f : avail, true, paintM);

    List<String> subLines = new ArrayList<>();
    float subPx = 0, subLineH = 0;
    if (wantSub) {
      subPx = Math.max(9f, name.size * 0.3f);
      subLineH = subPx * 1.24f;
      subLines = TextFit.wrap(body, maxW, subPx, false, paintM);
      // Whole or not at all. Half a sentence reads as an instruction the driver has missed
      // the end of, and they cannot tell what is gone.
      int room = (int) Math.floor((avail - name.height() - subPx * 0.5f) / subLineH);
      if (subLines.size() > room) {
        subLines = new ArrayList<>();
        name = TextFit.fit(head, maxW, avail, true, paintM);
      }
    }

    float gap = subLines.isEmpty() ? 0 : subPx * 0.5f;
    float groupH = name.height() + gap + subLines.size() * subLineH;
    float top = topH + (avail - groupH) / 2f;

    text.setTextSize(name.size);
    text.setFakeBoldText(true);
    for (int i = 0; i < name.lines.size(); i++) {
      cv.drawText(name.lines.get(i), w / 2f, top + name.size * 0.82f + i * name.lineHeight, text);
    }

    if (!subLines.isEmpty()) {
      text.setTextSize(subPx);
      text.setFakeBoldText(false);
      text.setAlpha(210);
      float sTop = top + name.height() + gap;
      for (int i = 0; i < subLines.size(); i++) {
        cv.drawText(subLines.get(i), w / 2f, sTop + subPx * 0.82f + i * subLineH, text);
      }
      text.setAlpha(255);
    }

    if (drawWho) {
      text.setTextSize(topH * 0.78f);
      text.setFakeBoldText(true);
      text.setAlpha(160);
      cv.drawText(who, w / 2f, pad * 0.4f + topH * 0.78f, text);
      text.setAlpha(255);
    }

    if (drawBoard) {
      float size = botH * 0.7f;
      text.setFakeBoldText(true);
      text.setTextSize(size);
      // Shrink to fit rather than cut: every part of the line is a number the driver wants.
      float need = text.measureText(board);
      float room = w - pad * 2 - gripSize();
      if (need > room && need > 0) { size = size * room / need; text.setTextSize(size); }
      text.setAlpha(235);
      cv.drawText(board, (w - gripSize() * 0.5f) / 2f, h - botH * 0.3f, text);
      text.setAlpha(255);
    }

    // The corner the driver pulls. Three strokes, the universal shorthand, drawn in the ink
    // colour so it is visible on every flag.
    float g = gripSize();
    grip.setColor(ink);
    grip.setAlpha(120);
    grip.setStrokeWidth(Math.max(1.5f, g * 0.07f));
    grip.setStrokeCap(Paint.Cap.ROUND);
    for (int i = 1; i <= 3; i++) {
      float o = g * (i / 4f);
      cv.drawLine(w - pad * 0.5f - o, h - pad * 0.5f, w - pad * 0.5f, h - pad * 0.5f - o, grip);
    }
  }

  /**
   * TextFit measuring through the real Paint.
   *
   * Setting the size and weight before measuring is the whole job — Paint carries that
   * state, and a measurement taken at the wrong size is silently wrong rather than an
   * error.
   */
  private final TextFit.Measurer paintM = (str, size, bold) -> {
    text.setTextSize(size);
    text.setFakeBoldText(bold);
    return text.measureText(str);
  };
}
