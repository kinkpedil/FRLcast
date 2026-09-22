package com.frl.driver;

import java.util.ArrayList;
import java.util.List;

/**
 * Fitting words into a box, with no Android in it.
 *
 * Pulled out of FlagView so it can be run on a desktop against a stub measurer. It is the
 * part most likely to be wrong and the part hardest to eyeball on a phone: the window can
 * be dragged to any shape at all, including ones no one thought to try, and a bug here is
 * a flag the driver cannot read rather than a crash anybody would notice.
 */
public final class TextFit {

  /** How wide a string is at a given size. Paint on a phone, arithmetic in a test. */
  public interface Measurer {
    float width(String text, float size, boolean bold);
  }

  public static final class Block {
    public final float size;
    public final float lineHeight;
    public final List<String> lines;
    Block(float size, float lineHeight, List<String> lines) {
      this.size = size; this.lineHeight = lineHeight; this.lines = lines;
    }
    public float height() { return lines.size() * lineHeight; }
  }

  /** Nothing smaller is worth drawing, and it stops the search from running away. */
  private static final float FLOOR = 8f;

  private TextFit() {}

  /**
   * Greedy word wrap at a fixed size, breaking only at spaces.
   *
   * A single word wider than the box is left long: the caller is measuring the result and
   * will shrink the size, which is the right answer nearly always. Only when there is no
   * size left does hardWrap take over.
   */
  public static List<String> wrap(String s, float maxW, float size, boolean bold, Measurer m) {
    List<String> out = new ArrayList<>();
    if (s == null) return out;
    String line = "";
    for (String word : s.trim().split("\\s+")) {
      if (word.isEmpty()) continue;
      String test = line.isEmpty() ? word : line + " " + word;
      if (!line.isEmpty() && m.width(test, size, bold) > maxW) {
        out.add(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (!line.isEmpty()) out.add(line);
    return out;
  }

  /**
   * The same, but cutting through a word when it cannot fit any other way.
   *
   * Reserved for the last resort. Splitting "CHEQUERED" across two lines looks wrong, and
   * a driver should never see it in a window of a sensible size — but in a sliver the
   * choice is between an ugly break and a flag name running off both edges unread, and the
   * break wins.
   */
  public static List<String> hardWrap(String s, float maxW, float size, boolean bold, Measurer m) {
    List<String> out = new ArrayList<>();
    for (String line : wrap(s, maxW, size, bold, m)) {
      String rest = line;
      // At least one character per line, so a box narrower than a single glyph ends the
      // loop rather than spinning on it.
      while (m.width(rest, size, bold) > maxW && rest.length() > 1) {
        int cut = 1;
        while (cut < rest.length() && m.width(rest.substring(0, cut + 1), size, bold) <= maxW) cut++;
        out.add(rest.substring(0, cut));
        rest = rest.substring(cut);
      }
      if (!rest.isEmpty()) out.add(rest);
    }
    return out;
  }

  /**
   * The largest size at which the wrapped text fits the box.
   *
   * Binary search, not a walk down from the top: this runs on every frame of a resize
   * drag, and a linear scan over a tall window is hundreds of text measurements per frame
   * on a phone that is also running a game.
   *
   * Words are kept whole while any size at all can hold them. Only when the floor size
   * still overflows the width — a window dragged to a sliver — does it fall back to
   * cutting through a word, and then the width is honoured absolutely.
   */
  public static Block fit(String s, float maxW, float maxH, boolean bold, Measurer m) {
    float lo = FLOOR, hi = Math.max(FLOOR + 1, maxH);
    Block best = null;
    for (int i = 0; i < 14 && hi - lo > 0.5f; i++) {
      float mid = (lo + hi) / 2f;
      List<String> lines = wrap(s, maxW, mid, bold, m);
      float lineH = mid * 1.04f;
      if (widest(lines, mid, bold, m) <= maxW && lines.size() * lineH <= maxH) {
        best = new Block(mid, lineH, lines);
        lo = mid;
      } else {
        hi = mid;
      }
    }
    if (best != null) return best;

    List<String> lines = hardWrap(s, maxW, FLOOR, bold, m);
    return new Block(FLOOR, FLOOR * 1.04f, lines);
  }

  private static float widest(List<String> lines, float size, boolean bold, Measurer m) {
    float w = 0;
    for (String l : lines) w = Math.max(w, m.width(l, size, bold));
    return w;
  }
}
