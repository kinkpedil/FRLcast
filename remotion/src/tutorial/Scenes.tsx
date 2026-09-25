import React from 'react';
import { AbsoluteFill, Easing, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, MONO, SANS } from './TutorialKit';

/*
 * Fully animated scenes for the tutorial: chapter cards, the speed badge used on sped-up
 * footage, and the three explainer chapters that have no screen recording behind them
 * (timing API setup, the driver app, and "good to know").
 *
 * Everything here is drawn, not recorded. The mock UI copies the real console and app wording
 * so what viewers see matches what they will click, and the API key is always shown masked.
 * Frames are at 30fps; each step component uses its own local frame (it sits in a Sequence).
 */

const EASE = Easing.bezier(0.22, 1, 0.36, 1);
const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

export const appear = (frame: number, delay: number, dur = 16) =>
  interpolate(frame, [delay, delay + dur], [0, 1], { ...CLAMP, easing: EASE });

export const typed = (text: string, frame: number, start: number, cps = 16) => {
  const n = Math.floor((Math.max(0, frame - start) * cps) / 30);
  return text.slice(0, Math.min(text.length, n));
};

const lift = (p: number, px = 24) => ({ opacity: p, transform: `translateY(${(1 - p) * px}px)` });

// ---------------------------------------------------------------- shared visual pieces

export const SceneBg: React.FC = () => {
  const f = useCurrentFrame();
  const off = (f * 0.5) % 60;
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg }}>
      <AbsoluteFill
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)',
          backgroundSize: '60px 60px',
          backgroundPosition: `${off}px ${off}px`,
        }}
      />
      <AbsoluteFill style={{ background: 'radial-gradient(1000px 640px at 78% 18%, rgba(0,224,164,0.11), transparent 62%)' }} />
    </AbsoluteFill>
  );
};

type PP = { f: number; x: number; y: number; click?: boolean };

/** An animated mouse pointer that glides between points and ripples on each click. */
export const Pointer: React.FC<{ path: PP[] }> = ({ path }) => {
  const frame = useCurrentFrame();
  if (!path.length) return null;
  let x = path[0].x;
  let y = path[0].y;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    if (frame >= b.f) {
      x = b.x;
      y = b.y;
    } else if (frame >= a.f) {
      const t = EASE((frame - a.f) / Math.max(1, b.f - a.f));
      x = a.x + (b.x - a.x) * t;
      y = a.y + (b.y - a.y) * t;
    }
  }
  const clicks = path.filter((p) => p.click);
  const ripple = clicks.find((c) => frame >= c.f && frame < c.f + 18);
  const pressed = clicks.some((c) => frame >= c.f && frame < c.f + 5);
  const vis = interpolate(frame, [path[0].f - 8, path[0].f], [0, 1], CLAMP);
  return (
    <AbsoluteFill style={{ opacity: vis, pointerEvents: 'none' }}>
      {ripple && (
        <div
          style={{
            position: 'absolute',
            left: x - 30,
            top: y - 30,
            width: 60,
            height: 60,
            borderRadius: 30,
            border: `3px solid ${C.accent}`,
            transform: `scale(${0.4 + ((frame - ripple.f) / 18) * 1.3})`,
            opacity: 1 - (frame - ripple.f) / 18,
          }}
        />
      )}
      <svg
        width={34}
        height={44}
        viewBox="0 0 34 44"
        style={{ position: 'absolute', left: x - 4, top: y - 2, transform: `scale(${pressed ? 0.85 : 1})`, transformOrigin: '4px 2px', filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.5))' }}
      >
        <path d="M4 2 L4 36 L13 28 L19 42 L25 39 L19 26 L31 26 Z" fill="#fff" stroke="#0b0d11" strokeWidth={2.5} strokeLinejoin="round" />
      </svg>
    </AbsoluteFill>
  );
};

/** A tap ripple for touch screens (the phone scenes). */
const Tap: React.FC<{ x: number; y: number; at: number }> = ({ x, y, at }) => {
  const f = useCurrentFrame();
  if (f < at || f > at + 20) return null;
  const t = (f - at) / 20;
  return (
    <div
      style={{
        position: 'absolute',
        left: x - 34,
        top: y - 34,
        width: 68,
        height: 68,
        borderRadius: 34,
        background: 'rgba(255,255,255,0.35)',
        transform: `scale(${0.3 + t})`,
        opacity: 1 - t,
      }}
    />
  );
};

export const Field: React.FC<{
  label: string;
  value?: string;
  placeholder?: string;
  x: number;
  y: number;
  w: number;
  focus?: boolean;
  size?: number;
}> = ({ label, value, placeholder, x, y, w, focus, size = 26 }) => {
  const f = useCurrentFrame();
  const caret = focus && Math.floor(f / 15) % 2 === 0;
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: w, fontFamily: SANS }}>
      <div style={{ fontFamily: MONO, fontSize: 16, letterSpacing: 2, color: C.ink3, textTransform: 'uppercase', marginBottom: 8 }}>{label}</div>
      <div
        style={{
          height: 58,
          borderRadius: 9,
          background: '#0d1015',
          border: `2px solid ${focus ? C.accent : C.line}`,
          boxShadow: focus ? '0 0 0 4px rgba(0,224,164,0.15)' : 'none',
          display: 'flex',
          alignItems: 'center',
          padding: '0 18px',
          fontSize: size,
          color: value ? C.ink : C.ink3,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
        }}
      >
        {value || placeholder || ''}
        {caret && <span style={{ display: 'inline-block', width: 2, height: size + 4, background: C.accent, marginLeft: 3 }} />}
      </div>
    </div>
  );
};

export const Btn: React.FC<{ label: string; x: number; y: number; w: number; h?: number; primary?: boolean; pressedAt?: number; dim?: boolean; size?: number }> = ({
  label,
  x,
  y,
  w,
  h = 56,
  primary,
  pressedAt,
  dim,
  size = 24,
}) => {
  const f = useCurrentFrame();
  const pressed = pressedAt != null && f >= pressedAt && f < pressedAt + 6;
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        borderRadius: 10,
        background: primary ? C.accent : '#1a1e26',
        color: primary ? '#05221b' : C.ink,
        border: primary ? 'none' : `1px solid ${C.line}`,
        fontFamily: SANS,
        fontWeight: 700,
        fontSize: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transform: `scale(${pressed ? 0.94 : 1})`,
        opacity: dim ? 0.45 : 1,
      }}
    >
      {label}
    </div>
  );
};

const Pill: React.FC<{ text: string; live?: boolean; style?: React.CSSProperties }> = ({ text, live, style }) => {
  const f = useCurrentFrame();
  return (
    <div
      style={{
        fontFamily: MONO,
        fontSize: 20,
        letterSpacing: 1,
        whiteSpace: 'nowrap',
        padding: '6px 14px',
        borderRadius: 20,
        background: live ? 'rgba(0,224,164,0.16)' : 'rgba(255,255,255,0.07)',
        color: live ? C.accent : C.ink3,
        boxShadow: live ? `0 0 ${10 + 6 * Math.sin(f / 5)}px rgba(0,224,164,0.45)` : 'none',
        ...style,
      }}
    >
      {text}
    </div>
  );
};

const Note: React.FC<{ text: string; x: number; y: number; w: number; at: number; icon?: string }> = ({ text, x, y, w, at, icon = '•' }) => {
  const f = useCurrentFrame();
  const p = appear(f, at, 14);
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        display: 'flex',
        gap: 14,
        alignItems: 'flex-start',
        fontFamily: SANS,
        fontSize: 28,
        lineHeight: 1.35,
        color: C.ink,
        background: 'rgba(18,21,27,0.92)',
        border: `1px solid ${C.line}`,
        borderLeft: `4px solid ${C.accent}`,
        borderRadius: 10,
        padding: '14px 18px',
        ...lift(p, 18),
      }}
    >
      <span style={{ color: C.accent, fontWeight: 800 }}>{icon}</span>
      <span>{text}</span>
    </div>
  );
};

/** Fades a step in and out; children read their own local frame. */
const StepWrap: React.FC<{ dur: number; children: React.ReactNode }> = ({ dur, children }) => {
  const f = useCurrentFrame();
  const inP = appear(f, 0, 14);
  const out = interpolate(f, [dur - 14, dur], [1, 0], CLAMP);
  return <AbsoluteFill style={{ opacity: Math.min(inP, out), transform: `translateY(${(1 - inP) * 24}px)` }}>{children}</AbsoluteFill>;
};

/** Scene frame: chapter title top-left, a step rail on the left, the stage on the right. */
const SceneShell: React.FC<{ part: number; title: string; steps: string[]; bounds: number[]; children: React.ReactNode }> = ({
  part,
  title,
  steps,
  bounds,
  children,
}) => {
  const f = useCurrentFrame();
  const total = bounds[bounds.length - 1];
  const head = appear(f, 0, 18);
  const endFade = interpolate(f, [total - 12, total], [1, 0], CLAMP);
  return (
    <AbsoluteFill style={{ opacity: endFade }}>
      <SceneBg />
      <div style={{ position: 'absolute', left: 80, top: 60, ...lift(head) }}>
        <div style={{ fontFamily: MONO, fontSize: 24, letterSpacing: 6, color: C.accent }}>PART {part}</div>
        <div style={{ fontFamily: SANS, fontSize: 56, fontWeight: 800, color: C.ink, marginTop: 4, letterSpacing: -1 }}>{title}</div>
      </div>
      {steps.map((s, i) => {
        const start = bounds[i];
        const end = bounds[i + 1];
        const active = f >= start && f < end;
        const done = f >= end;
        const p = appear(f, 8 + i * 6, 14);
        const prog = active ? (f - start) / (end - start) : done ? 1 : 0;
        return (
          <div key={i} style={{ position: 'absolute', left: 80, top: 250 + i * 104, width: 540, ...lift(p, 14) }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 24,
                  flex: '0 0 auto',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: MONO,
                  fontWeight: 800,
                  fontSize: 22,
                  background: active ? C.accent : done ? 'rgba(0,224,164,0.16)' : 'rgba(255,255,255,0.06)',
                  color: active ? '#05221b' : done ? C.accent : C.ink3,
                  transform: `scale(${active ? 1.08 : 1})`,
                }}
              >
                {done ? '✓' : i + 1}
              </div>
              <div style={{ fontFamily: SANS, fontSize: 28, fontWeight: active ? 700 : 500, color: active ? C.ink : done ? C.ink2 : C.ink3 }}>{s}</div>
            </div>
            <div style={{ marginLeft: 66, marginTop: 10, height: 4, width: 440, borderRadius: 2, background: 'rgba(255,255,255,0.06)' }}>
              <div style={{ height: 4, width: 440 * prog, borderRadius: 2, background: C.accent, opacity: active ? 1 : 0.5 }} />
            </div>
          </div>
        );
      })}
      {steps.map((_, i) => (
        <Sequence key={`st${i}`} from={bounds[i]} durationInFrames={bounds[i + 1] - bounds[i]}>
          {React.Children.toArray(children)[i]}
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- chapter card + speed badge

export const CHAPTER_DUR = 105;

export const ChapterCard: React.FC<{ part: number; title: string; sub: string }> = ({ part, title, sub }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: f, fps, config: { damping: 200 } });
  const bar = appear(f, 6, 26);
  const out = interpolate(f, [CHAPTER_DUR - 14, CHAPTER_DUR], [1, 0], CLAMP);
  const numX = interpolate(f, [0, CHAPTER_DUR], [60, -20]);
  return (
    <AbsoluteFill style={{ opacity: out }}>
      <SceneBg />
      <div
        style={{
          position: 'absolute',
          right: 60 + numX,
          top: 150,
          fontFamily: SANS,
          fontWeight: 900,
          fontSize: 560,
          lineHeight: 1,
          color: 'transparent',
          WebkitTextStroke: '3px rgba(0,224,164,0.16)',
          letterSpacing: -20,
        }}
      >
        {String(part).padStart(2, '0')}
      </div>
      <AbsoluteFill style={{ justifyContent: 'center', paddingLeft: 140 }}>
        <div style={{ ...lift(s, 40) }}>
          <div style={{ fontFamily: MONO, fontSize: 30, letterSpacing: 10, color: C.accent }}>PART {part}</div>
          <div style={{ height: 6, width: 260 * bar, background: C.accent, borderRadius: 3, margin: '22px 0 26px' }} />
          <div style={{ fontFamily: SANS, fontSize: 108, fontWeight: 800, color: C.ink, letterSpacing: -2, lineHeight: 1.02, maxWidth: 1300 }}>{title}</div>
          <div style={{ fontFamily: SANS, fontSize: 40, color: C.ink2, marginTop: 18, ...lift(appear(f, 12, 18), 16) }}>{sub}</div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const SpeedBadge: React.FC<{ rate: number }> = ({ rate }) => {
  const f = useCurrentFrame();
  const p = appear(f, 0, 12);
  const pulse = 1 + 0.04 * Math.sin(f / 4);
  return (
    <div
      style={{
        position: 'absolute',
        right: 56,
        top: 132,
        padding: '10px 22px',
        borderRadius: 30,
        background: C.accent,
        color: '#05221b',
        fontFamily: MONO,
        fontWeight: 800,
        fontSize: 30,
        letterSpacing: 2,
        boxShadow: '0 10px 30px rgba(0,224,164,0.35)',
        opacity: p,
        transform: `scale(${pulse})`,
      }}
    >
      ▶▶ {rate}x SPEED
    </div>
  );
};

// ---------------------------------------------------------------- Part: timing API setup

export const API_B = [0, 270, 600, 1020, 1380, 1800];
export const API_DUR = API_B[API_B.length - 1];

const KeyIcon: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 64 64">
    <circle cx="22" cy="32" r="14" fill="none" stroke={C.accent} strokeWidth="5" />
    <path d="M36 32 H58 M50 32 V42 M58 32 V40" stroke={C.accent} strokeWidth="5" strokeLinecap="round" fill="none" />
  </svg>
);

const ApiStep1: React.FC = () => {
  const f = useCurrentFrame();
  const shimmer = ((f * 12) % 900) - 150;
  return (
    <StepWrap dur={270}>
      <div style={{ position: 'absolute', left: 720, top: 250, width: 1080, ...lift(appear(f, 0)) }}>
        <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 20, padding: '44px 50px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 26 }}>
            <KeyIcon size={92} />
            <div>
              <div style={{ fontFamily: SANS, fontSize: 46, fontWeight: 800, color: C.ink }}>Your personal API key</div>
              <div style={{ fontFamily: SANS, fontSize: 28, color: C.ink2, marginTop: 6 }}>Issued to partners by the FR Legends developer</div>
            </div>
          </div>
          <div
            style={{
              marginTop: 38,
              position: 'relative',
              overflow: 'hidden',
              borderRadius: 12,
              background: '#0d1015',
              border: `2px solid ${C.line}`,
              padding: '22px 28px',
              fontFamily: MONO,
              fontSize: 44,
              letterSpacing: 10,
              color: C.ink,
              ...lift(appear(f, 22)),
            }}
          >
            •••• •••• •••• ••••
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: shimmer, width: 120, background: 'linear-gradient(90deg, transparent, rgba(0,224,164,0.25), transparent)' }} />
          </div>
          <div style={{ marginTop: 28, fontFamily: SANS, fontSize: 28, color: C.ink2, lineHeight: 1.4, ...lift(appear(f, 50)) }}>
            It unlocks the official lap times for rooms you run, straight from the game server. No capture, no OCR.
          </div>
        </div>
      </div>
      <Note at={90} x={720} y={760} w={1080} icon="!" text="Treat it like a password. Never share it and never show it on stream." />
    </StepWrap>
  );
};

const NAV_ITEMS = ['Race control', 'Event scenes', 'Championship', 'Drivers', 'Drift battles', 'Vision / AI', 'Overlays', 'Layout', 'OBS setup', 'Help'];

const ApiStep2: React.FC = () => {
  const f = useCurrentFrame();
  const clicked = f >= 126;
  const L = 720;
  const T = 220;
  return (
    <StepWrap dur={330}>
      <div style={{ position: 'absolute', left: L, top: T, width: 1080, height: 640, ...lift(appear(f, 0)) }}>
        <div style={{ position: 'absolute', inset: 0, background: '#0e1116', border: `2px solid #2a2f38`, borderRadius: 18, overflow: 'hidden' }}>
          <div style={{ height: 52, background: '#161a21', display: 'flex', alignItems: 'center', padding: '0 18px', gap: 10 }}>
            {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
              <div key={c} style={{ width: 13, height: 13, borderRadius: 7, background: c }} />
            ))}
            <div style={{ marginLeft: 20, flex: 1, height: 32, borderRadius: 8, background: '#0b0d11', color: C.ink2, fontFamily: MONO, fontSize: 18, display: 'flex', alignItems: 'center', padding: '0 14px' }}>
              localhost:4700
            </div>
          </div>
          <div style={{ position: 'absolute', left: 0, top: 52, bottom: 0, width: 230, background: '#0b0d11', borderRight: `1px solid ${C.line}`, paddingTop: 18 }}>
            {NAV_ITEMS.map((n, i) => {
              const on = clicked ? i === 5 : i === 0;
              return (
                <div
                  key={n}
                  style={{
                    height: 44,
                    margin: '0 12px',
                    borderRadius: 8,
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0 12px',
                    fontFamily: SANS,
                    fontSize: 19,
                    fontWeight: on ? 700 : 500,
                    color: on ? C.ink : C.ink3,
                    background: on ? 'rgba(0,224,164,0.10)' : 'transparent',
                    borderLeft: on ? `3px solid ${C.accent}` : '3px solid transparent',
                  }}
                >
                  {n}
                </div>
              );
            })}
          </div>
          <div style={{ position: 'absolute', left: 260, top: 80, right: 30, ...lift(appear(f, 132)) }}>
            <div style={{ fontFamily: SANS, fontSize: 34, fontWeight: 800, color: C.ink }}>Vision / AI</div>
            <div style={{ marginTop: 18, border: `2px solid ${C.accent}`, borderRadius: 14, padding: 22, background: C.panel }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontFamily: MONO, fontSize: 18, letterSpacing: 2, color: C.ink2 }}>LIVE TIMING · OFFICIAL FR LEGENDS API</div>
                <Pill text="off" />
              </div>
              <div style={{ display: 'flex', gap: 16, marginTop: 20 }}>
                {['API key', 'Region', 'Room Key'].map((l) => (
                  <div key={l} style={{ flex: 1, height: 44, borderRadius: 8, background: '#0d1015', border: `1px solid ${C.line}`, color: C.ink3, fontFamily: SANS, fontSize: 18, display: 'flex', alignItems: 'center', padding: '0 12px' }}>
                    {l}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      <Pointer path={[{ f: 40, x: 1500, y: 900 }, { f: 110, x: L + 110, y: T + 52 + 18 + 5 * 44 + 22 }, { f: 120, x: L + 110, y: T + 52 + 18 + 5 * 44 + 22, click: true }, { f: 170, x: L + 700, y: T + 250 }]} />
      <Note at={190} x={720} y={890} w={1080} icon="i" text="Desktop app only: run start.cmd, the console opens at localhost:4700. The key is saved on this computer and never reaches a browser or overlay." />
    </StepWrap>
  );
};

const REGIONS = ['Southeast Asia', 'East Asia', 'Japan West', 'Australia Southeast', 'North Europe', 'West Europe', 'East US', 'West US', 'Brazil South'];

const ApiCard: React.FC<{ x: number; y: number; w: number; h: number; status: string; live?: boolean; short?: boolean; children?: React.ReactNode }> = ({ x, y, w, h, status, live, short, children }) => (
  <div style={{ position: 'absolute', left: x, top: y, width: w, height: h, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 18, padding: '26px 30px 30px' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div style={{ fontFamily: MONO, fontSize: 19, letterSpacing: 2, color: C.ink2, whiteSpace: 'nowrap' }}>{short ? 'LIVE TIMING' : 'LIVE TIMING · OFFICIAL FR LEGENDS API'}</div>
      <Pill text={status} live={live} />
    </div>
    {children}
  </div>
);

const ApiStep3: React.FC = () => {
  const f = useCurrentFrame();
  const saved = f >= 262;
  const keyVal = saved ? '' : '•'.repeat(typed('xxxxxxxxxxxxxxxxxxxxxxxx', f, 62, 15).length);
  const open = f >= 158 && f < 210;
  const X = 700;
  const Y = 220;
  return (
    <StepWrap dur={420}>
      <div style={{ ...lift(appear(f, 0)), position: 'absolute', inset: 0 }}>
        <ApiCard x={X} y={Y} w={1140} h={580} status="off">
          <div style={{ fontFamily: SANS, fontSize: 22, color: C.ink3, marginTop: 12, lineHeight: 1.4 }}>
            Laps come straight from the game server. It runs on this machine only: the API key never leaves it.
          </div>
        </ApiCard>
        <Field label="API key" value={keyVal} placeholder="paste your key" x={X + 30} y={Y + 150} w={520} focus={f >= 56 && f < 262} />
        <Field label="Region" value="Southeast Asia  ▾" x={X + 590} y={Y + 150} w={520} focus={open} />
        <Btn label="Save key" x={X + 30} y={Y + 262} w={170} pressedAt={256} />
        {saved && (
          <div style={{ position: 'absolute', left: X + 220, top: Y + 276, fontFamily: SANS, fontSize: 24, color: C.accent, ...lift(appear(f, 262, 10), 8) }}>
            Key saved on this machine.
          </div>
        )}
        <Field label="Room Key" placeholder="e.g. 8054" x={X + 30} y={Y + 350} w={520} />
        <Btn label="Start live timing" x={X + 30} y={Y + 462} w={260} primary dim />
        <Btn label="Stop" x={X + 310} y={Y + 462} w={120} dim />
        {open && (
          <div style={{ position: 'absolute', left: X + 590, top: Y + 232, width: 520, background: '#12161d', border: `1px solid ${C.line}`, borderRadius: 10, overflow: 'hidden', boxShadow: '0 20px 50px rgba(0,0,0,0.6)', ...lift(appear(f, 158, 8), -10) }}>
            {REGIONS.map((r, i) => (
              <div key={r} style={{ height: 40, padding: '0 18px', display: 'flex', alignItems: 'center', fontFamily: SANS, fontSize: 21, color: i === 0 && f >= 185 ? '#05221b' : C.ink2, background: i === 0 && f >= 185 ? C.accent : 'transparent' }}>
                {r}
              </div>
            ))}
          </div>
        )}
      </div>
      <Pointer
        path={[
          { f: 20, x: 1600, y: 960 },
          { f: 50, x: X + 290, y: Y + 208 },
          { f: 56, x: X + 290, y: Y + 208, click: true },
          { f: 140, x: X + 290, y: Y + 208 },
          { f: 150, x: X + 850, y: Y + 208, click: true },
          { f: 185, x: X + 760, y: Y + 252 },
          { f: 200, x: X + 760, y: Y + 252, click: true },
          { f: 245, x: X + 115, y: Y + 290 },
          { f: 256, x: X + 115, y: Y + 290, click: true },
          { f: 300, x: X + 160, y: Y + 410 },
        ]}
      />
      <Note at={300} x={700} y={900} w={1140} icon="1" text="Paste the key once, pick your region (ours is Southeast Asia), press Save key. It is stored locally and the field clears." />
    </StepWrap>
  );
};

const ApiStep4: React.FC = () => {
  const f = useCurrentFrame();
  const started = f >= 236;
  const note = f < 190 ? '' : f < 236 ? 'Starting…' : 'Live on 203.0.113.24.';
  const arrow = appear(f, 80, 40);
  const rows = [
    ['1', 'Mav', '1:17.040'],
    ['2', 'Reza', '1:17.912'],
    ['3', 'Budi', '1:18.205'],
  ];
  return (
    <StepWrap dur={360}>
      {/* the game's Create Room screen, drawn generically */}
      <div style={{ position: 'absolute', left: 700, top: 230, width: 470, height: 560, borderRadius: 18, overflow: 'hidden', background: 'linear-gradient(160deg, #2a1616, #120d10)', border: '2px solid #3a2020', ...lift(appear(f, 0)) }}>
        <div style={{ padding: '24px 26px', fontFamily: SANS, fontWeight: 900, fontSize: 21, letterSpacing: 2, color: '#ff7a45', whiteSpace: 'nowrap' }}>FR LEGENDS · CREATE ROOM</div>
        <Field label="Room name" value="Kinkpedil Race" x={26} y={90} w={418} size={24} />
        <Field label="Max players" value="12" x={26} y={196} w={418} size={24} />
        <Field label="Room Key" value={typed('8054', f, 30, 8)} x={26} y={302} w={418} size={30} focus={f >= 26 && f < 80} />
        <div style={{ position: 'absolute', left: 26, top: 420, right: 26, fontFamily: SANS, fontSize: 22, color: '#e8c9bd', lineHeight: 1.4 }}>
          The host types a Room Key when creating the room. No Room Key, no live timing.
        </div>
      </div>
      {/* the hand-off arrow */}
      <svg width={1920} height={1080} style={{ position: 'absolute', left: 0, top: 0 }}>
        <path d="M 1150 590 C 1200 590, 1210 440, 1262 440" fill="none" stroke={C.accent} strokeWidth={5} strokeDasharray="330" strokeDashoffset={330 * (1 - arrow)} strokeLinecap="round" />
        <text x={1172} y={665} fill={C.accent} fontFamily={MONO} fontSize={18} opacity={arrow}>
          same key
        </text>
      </svg>
      <div style={{ ...lift(appear(f, 90)), position: 'absolute', inset: 0 }}>
        <ApiCard x={1250} y={230} w={600} h={330} short status={started ? 'live · 12 matched' : 'off'} live={started} />
        <Field label="Room Key" value={typed('8054', f, 124, 8)} x={1280} y={320} w={540} size={30} focus={f >= 118 && f < 186} />
        <Btn label="Start live timing" x={1280} y={430} w={290} primary pressedAt={186} />
        <Btn label="Stop" x={1590} y={430} w={130} />
        <div style={{ position: 'absolute', left: 1282, top: 506, fontFamily: SANS, fontSize: 24, color: started ? C.accent : C.ink2 }}>{note}</div>
        {started &&
          rows.map((r, i) => (
            <div
              key={r[0]}
              style={{
                position: 'absolute',
                left: 1250,
                top: 580 + i * 62,
                width: 600,
                height: 54,
                borderRadius: 10,
                background: C.panel,
                border: `1px solid ${C.line}`,
                display: 'flex',
                alignItems: 'center',
                gap: 22,
                padding: '0 22px',
                fontFamily: SANS,
                fontSize: 24,
                color: C.ink,
                ...lift(appear(f, 250 + i * 12, 12), 12),
              }}
            >
              <span style={{ fontFamily: MONO, color: C.ink3, width: 24 }}>{r[0]}</span>
              <span style={{ flex: 1, fontWeight: 600 }}>{r[1]}</span>
              <span style={{ fontFamily: MONO, color: C.accent }}>{r[2]}</span>
            </div>
          ))}
      </div>
      <Pointer path={[{ f: 150, x: 1700, y: 900 }, { f: 180, x: 1425, y: 458 }, { f: 186, x: 1425, y: 458, click: true }, { f: 240, x: 1560, y: 700 }]} />
      <Note at={290} x={700} y={900} w={1150} icon="2" text="Enter the same Room Key in the console and press Start live timing. Laps start flowing into your leaderboard." />
    </StepWrap>
  );
};

const FlowNode: React.FC<{ x: number; y: number; title: string; sub: string; at: number }> = ({ x, y, title, sub, at }) => {
  const f = useCurrentFrame();
  const p = appear(f, at, 16);
  return (
    <div
      style={{
        position: 'absolute',
        left: x - 130,
        top: y - 70,
        width: 260,
        height: 140,
        borderRadius: 16,
        background: C.panel,
        border: `2px solid ${C.accent}`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        transform: `scale(${0.8 + 0.2 * p})`,
        opacity: p,
      }}
    >
      <div style={{ fontFamily: SANS, fontSize: 28, fontWeight: 800, color: C.ink }}>{title}</div>
      <div style={{ fontFamily: MONO, fontSize: 19, color: C.accent, marginTop: 6 }}>{sub}</div>
    </div>
  );
};

const ApiStep5: React.FC = () => {
  const f = useCurrentFrame();
  const xs = [790, 1090, 1390, 1690];
  const y = 400;
  const labels = ['with your key', 'server IP', 'laps every 1.5 s'];
  return (
    <StepWrap dur={420}>
      <div style={{ position: 'absolute', left: 700, top: 210, fontFamily: SANS, fontSize: 34, fontWeight: 700, color: C.ink, ...lift(appear(f, 0)) }}>
        What happens after you press Start
      </div>
      <svg width={1920} height={1080} style={{ position: 'absolute', left: 0, top: 0 }}>
        {labels.map((l, i) => {
          const d = appear(f, 70 + i * 22, 24);
          const x1 = xs[i] + 130;
          const x2 = xs[i + 1] - 130;
          const dot = f > 130 ? x1 + ((((f - 130) * 4 + i * 30) % (x2 - x1)) as number) : -100;
          return (
            <g key={l}>
              <line x1={x1} y1={y} x2={x1 + (x2 - x1) * d} y2={y} stroke={C.accent} strokeWidth={4} />
              {f > 130 && <circle cx={dot} cy={y} r={7} fill={C.accent} />}
              <text x={(x1 + x2) / 2} y={y + 108} textAnchor="middle" fill={C.accent} fontFamily={MONO} fontSize={18} opacity={d}>
                {l}
              </text>
            </g>
          );
        })}
      </svg>
      <FlowNode x={xs[0]} y={y} title="Desktop app" sub="your computer" at={0} />
      <FlowNode x={xs[1]} y={y} title="Region lookup" sub="SoutheastAsia" at={20} />
      <FlowNode x={xs[2]} y={y} title="Game server" sub="port 56102" at={40} />
      <FlowNode x={xs[3]} y={y} title="Your broadcast" sub="leaderboard + overlays" at={60} />
      <Note at={170} x={700} y={560} w={1150} icon="✓" text="Players are matched by name, so register each driver with the exact name they use in-game." />
      <Note at={230} x={700} y={680} w={1150} icon="✓" text="Player IDs change in every room. FRLcast re-matches the drivers in each new room by itself." />
      <Note at={290} x={700} y={800} w={1150} icon="✓" text="Contest mode ranks by best lap. Manual timing stays available as your fallback." />
    </StepWrap>
  );
};

export const ApiKeyScene: React.FC = () => (
  <SceneShell part={6} title="Set up the official timing API" steps={['Get your API key', 'Open the desktop app', 'Save the key', 'Room Key and Start', 'How it works']} bounds={API_B}>
    <ApiStep1 />
    <ApiStep2 />
    <ApiStep3 />
    <ApiStep4 />
    <ApiStep5 />
  </SceneShell>
);

// ---------------------------------------------------------------- Part: the driver app

export const DRV_B = [0, 300, 630, 930, 1290, 1650];
export const DRIVER_DUR = DRV_B[DRV_B.length - 1];

const Phone: React.FC<{ x: number; y: number; w: number; h: number; landscape?: boolean; children: React.ReactNode; style?: React.CSSProperties }> = ({ x, y, w, h, landscape, children, style }) => (
  <div style={{ position: 'absolute', left: x, top: y, width: w, height: h, borderRadius: 54, background: '#1b1f27', padding: 14, boxShadow: '0 30px 80px rgba(0,0,0,0.55)', ...style }}>
    <div style={{ position: 'relative', width: '100%', height: '100%', borderRadius: 42, overflow: 'hidden', background: '#0b0d11' }}>
      {children}
      {landscape ? (
        <div style={{ position: 'absolute', left: 12, top: '50%', width: 26, height: 110, marginTop: -55, borderRadius: 13, background: '#000' }} />
      ) : (
        <div style={{ position: 'absolute', top: 12, left: '50%', width: 110, height: 26, marginLeft: -55, borderRadius: 13, background: '#000' }} />
      )}
    </div>
  </div>
);

const PX = 760;
const PY = 150;
const PW = 420;
const PH = 840;
const SIDE = 1260;

const AppHeader: React.FC<{ sub: string }> = ({ sub }) => (
  <div style={{ padding: '62px 30px 10px' }}>
    <div style={{ fontFamily: SANS, fontSize: 32, fontWeight: 900, letterSpacing: 2, color: C.ink }}>FRL DRIVER</div>
    <div style={{ fontFamily: MONO, fontSize: 16, letterSpacing: 2, color: C.accent, marginTop: 4 }}>{sub}</div>
  </div>
);

const DrvStep1: React.FC = () => {
  const f = useCurrentFrame();
  const prog = interpolate(f, [30, 130], [0, 1], { ...CLAMP, easing: EASE });
  const done = f >= 136;
  return (
    <StepWrap dur={300}>
      <Phone x={PX} y={PY} w={PW} h={PH}>
        <div style={{ padding: '70px 26px' }}>
          <div style={{ fontFamily: SANS, fontSize: 26, fontWeight: 700, color: C.ink2 }}>Download</div>
          <div style={{ marginTop: 22, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 22, ...lift(appear(f, 6)) }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <svg width={56} height={56} viewBox="0 0 56 56">
                <rect x="8" y="18" width="40" height="30" rx="8" fill="#3ddc84" />
                <circle cx="20" cy="30" r="3" fill="#0b0d11" />
                <circle cx="36" cy="30" r="3" fill="#0b0d11" />
                <path d="M16 18 L10 8 M40 18 L46 8" stroke="#3ddc84" strokeWidth="3" strokeLinecap="round" />
              </svg>
              <div>
                <div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 700, color: C.ink }}>FRLDriver.apk</div>
                <div style={{ fontFamily: SANS, fontSize: 17, color: C.ink3, marginTop: 2 }}>33 KB · Android 7.0 and up</div>
              </div>
            </div>
            <div style={{ marginTop: 20, height: 10, borderRadius: 5, background: 'rgba(255,255,255,0.08)' }}>
              <div style={{ height: 10, width: `${prog * 100}%`, borderRadius: 5, background: C.accent }} />
            </div>
            <div style={{ marginTop: 12, fontFamily: SANS, fontSize: 18, color: done ? C.accent : C.ink3 }}>{done ? '✓ Installed' : `Downloading ${Math.round(prog * 33)} KB`}</div>
          </div>
          {done && (
            <div style={{ marginTop: 50, display: 'flex', flexDirection: 'column', alignItems: 'center', transform: `scale(${spring({ frame: f - 150, fps: 30, config: { damping: 12 } })})` }}>
              <div style={{ width: 110, height: 110, borderRadius: 28, background: 'linear-gradient(145deg, #00e0a4, #0a8f6c)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: SANS, fontWeight: 900, fontSize: 34, color: '#05221b' }}>
                FRL
              </div>
              <div style={{ marginTop: 12, fontFamily: SANS, fontSize: 20, color: C.ink }}>FRL Driver</div>
            </div>
          )}
        </div>
      </Phone>
      <Note at={40} x={SIDE} y={250} w={580} text="One small Android file, about 33 KB." />
      <Note at={80} x={SIDE} y={370} w={580} text="Android 7.0 and up. No store account needed." />
      <Note at={120} x={SIDE} y={490} w={580} text="Download it from the driver app button on frlcast.my.id." />
    </StepWrap>
  );
};

const DrvStep2: React.FC = () => {
  const f = useCurrentFrame();
  const sent = f >= 126;
  const approved = f >= 226;
  return (
    <StepWrap dur={330}>
      <Phone x={PX} y={PY} w={PW} h={PH}>
        <AppHeader sub="REGISTER" />
        <Field label="Racing name" value={typed('Mav', f, 20, 8)} x={26} y={170} w={340} size={24} focus={f >= 14 && f < 46} />
        <Field label="Race number" value={typed('12', f, 50, 8)} x={26} y={276} w={340} size={24} focus={f >= 46 && f < 68} />
        <Field label="Password" value={'•'.repeat(typed('xxxxxx', f, 70, 10).length)} x={26} y={382} w={340} size={24} focus={f >= 68 && f < 110} />
        <Btn label="Register" x={26} y={500} w={340} primary pressedAt={120} />
        <Tap x={196} y={528} at={120} />
        {sent && (
          <div style={{ position: 'absolute', left: 26, top: 580, width: 340, fontFamily: SANS, fontSize: 20, color: C.accent, lineHeight: 1.4, ...lift(appear(f, 126, 10), 8) }}>
            Sent. Race control will let you in.
          </div>
        )}
      </Phone>
      <div style={{ position: 'absolute', left: SIDE, top: 250, width: 580, ...lift(appear(f, 140)) }}>
        <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: '22px 24px' }}>
          <div style={{ fontFamily: MONO, fontSize: 18, letterSpacing: 2, color: C.ink2 }}>CONSOLE · DRIVER SIGN-INS</div>
          <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 16, background: '#0d1015', borderRadius: 12, padding: '14px 16px' }}>
            <div style={{ width: 8, height: 40, borderRadius: 4, background: '#bf5af2' }} />
            <div style={{ flex: 1, fontFamily: SANS, fontSize: 26, fontWeight: 700, color: C.ink }}>
              Mav <span style={{ fontFamily: MONO, color: C.ink3, fontWeight: 400 }}>#12</span>
            </div>
            {approved ? <Pill text="APPROVED" live /> : <div style={{ position: 'relative', width: 120, height: 48 }}><Btn label="Accept" x={0} y={0} w={120} h={48} primary pressedAt={220} size={22} /></div>}
          </div>
          {approved && <div style={{ marginTop: 14, fontFamily: SANS, fontSize: 22, color: C.accent, ...lift(appear(f, 228, 10), 8) }}>Mav is on the grid.</div>}
        </div>
      </div>
      <Pointer path={[{ f: 170, x: 1760, y: 800 }, { f: 212, x: SIDE + 500, y: 338 }, { f: 220, x: SIDE + 500, y: 338, click: true }, { f: 270, x: SIDE + 420, y: 520 }]} />
      <Note at={250} x={SIDE} y={520} w={580} text="Race control decides who gets in: accept the driver and they join the grid." />
    </StepWrap>
  );
};

const DrvStep3: React.FC = () => {
  const f = useCurrentFrame();
  const inn = f >= 146;
  return (
    <StepWrap dur={300}>
      <Phone x={PX} y={PY} w={PW} h={PH}>
        <AppHeader sub="SIGN IN" />
        <Field label="Server" value={typed('KINK12', f, 20, 10)} x={26} y={170} w={340} size={24} focus={f >= 14 && f < 64} />
        <Field label="Race number" value={typed('12', f, 70, 8)} x={26} y={276} w={340} size={24} focus={f >= 64 && f < 86} />
        <Field label="Password" value={'•'.repeat(typed('xxxxxx', f, 90, 12).length)} x={26} y={382} w={340} size={24} focus={f >= 86 && f < 130} />
        <Btn label="Sign in" x={26} y={500} w={340} primary pressedAt={140} />
        <Tap x={196} y={528} at={140} />
        {inn && (
          <div style={{ position: 'absolute', left: 26, top: 590, width: 340, height: 70, borderRadius: 12, background: 'rgba(0,224,164,0.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONO, fontSize: 22, color: C.accent, ...lift(appear(f, 146, 10), 8) }}>
            ✓ Signed in · KINK12
          </div>
        )}
      </Phone>
      <Note at={30} x={SIDE} y={250} w={580} text="In the Server field, type the event code race control gives you, like KINK12." />
      <Note at={90} x={SIDE} y={390} w={580} text="Not the website address. A link race control sends you works too." />
      <Note at={150} x={SIDE} y={530} w={580} text="Then your race number and your password." />
    </StepWrap>
  );
};

const GameScene: React.FC = () => {
  const f = useCurrentFrame();
  const dash = (f * 9) % 80;
  return (
    <AbsoluteFill style={{ background: 'linear-gradient(180deg, #243447 0%, #3f5870 45%, #2b2f36 46%, #1a1d22 100%)' }}>
      <svg width="100%" height="100%" viewBox="0 0 800 380" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0 }}>
        <polygon points="330,172 470,172 760,380 40,380" fill="#30343b" />
        {[0, 1, 2, 3, 4].map((i) => {
          const t = ((i * 80 + dash) % 400) / 400;
          const yy = 172 + t * t * 208;
          const hh = 6 + t * 26;
          return <rect key={i} x={398 - 2 - t * 5} y={yy} width={4 + t * 10} height={hh} fill="#e8e2c9" opacity={0.85} />;
        })}
        <rect x={352} y={290} width={96} height={52} rx={10} fill="#d7263d" />
        <rect x={364} y={278} width={72} height={24} rx={8} fill="#a81d2f" />
      </svg>
    </AbsoluteFill>
  );
};

const DrvStep4: React.FC = () => {
  const f = useCurrentFrame();
  const landscape = interpolate(f, [96, 130], [0, 1], { ...CLAMP, easing: EASE });
  const permOn = f >= 58;
  const flag = f < 180 ? 'GREEN' : f < 222 ? 'YELLOW' : 'UNDER INVESTIGATION';
  const flagBg = f < 180 ? '#16a34a' : f < 222 ? '#eab308' : '#1d7bff';
  const flagFg = f >= 180 && f < 222 ? '#1a1400' : '#fff';
  const size = interpolate(f, [280, 320], [1, 0.62], { ...CLAMP, easing: EASE });
  const banner = appear(f, 226, 12);
  return (
    <StepWrap dur={360}>
      <div style={{ opacity: 1 - landscape }}>
        <Phone x={PX} y={PY} w={PW} h={PH}>
          <AppHeader sub="SIGNED IN · KINK12" />
          <Btn label="Show floating flag" x={26} y={180} w={340} primary pressedAt={18} />
          <Tap x={196} y={208} at={18} />
          {f >= 24 && f < 96 && (
            <AbsoluteFill style={{ background: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', opacity: appear(f, 24, 8) }}>
              <div style={{ width: 330, background: '#20242c', borderRadius: 20, padding: 24 }}>
                <div style={{ fontFamily: SANS, fontSize: 22, fontWeight: 700, color: C.ink, lineHeight: 1.3 }}>Display over other apps</div>
                <div style={{ fontFamily: SANS, fontSize: 17, color: C.ink2, marginTop: 10, lineHeight: 1.4 }}>Allow FRL Driver to draw on top of other apps.</div>
                <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontFamily: SANS, fontSize: 19, color: C.ink }}>Allow</span>
                  <div style={{ width: 62, height: 34, borderRadius: 17, background: permOn ? C.accent : '#555', position: 'relative' }}>
                    <div style={{ position: 'absolute', top: 4, left: permOn ? 32 : 4, width: 26, height: 26, borderRadius: 13, background: '#fff' }} />
                  </div>
                </div>
              </div>
            </AbsoluteFill>
          )}
          <Tap x={296} y={455} at={54} />
        </Phone>
      </div>
      <div style={{ opacity: landscape, transform: `scale(${0.85 + 0.15 * landscape})` }}>
        <Phone x={620} y={300} w={880} h={440} landscape>
          <GameScene />
          <div
            style={{
              position: 'absolute',
              left: 56,
              top: 120,
              width: 320,
              transformOrigin: 'top left',
              transform: `scale(${size})`,
              borderRadius: 16,
              background: flagBg,
              color: flagFg,
              padding: '12px 16px 16px',
              boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{ fontFamily: MONO, fontSize: 15, opacity: 0.85, textAlign: 'center' }}>Mav #12 · P12</div>
            <div style={{ fontFamily: SANS, fontWeight: 900, fontSize: flag.length > 10 ? 30 : 46, lineHeight: 1.05, textAlign: 'center', marginTop: 4 }}>{flag}</div>
          </div>
          <div
            style={{
              position: 'absolute',
              left: 180,
              right: 180,
              top: -80 + 96 * banner,
              borderRadius: 16,
              background: '#1f232b',
              padding: '10px 18px',
              boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{ fontFamily: SANS, fontWeight: 800, fontSize: 17, color: C.ink }}>UNDER INVESTIGATION · DRIVE THROUGH</div>
            <div style={{ fontFamily: SANS, fontSize: 16, color: C.ink2, marginTop: 2 }}>Leaving the track and gaining an advantage</div>
          </div>
        </Phone>
      </div>
      <Note at={30} x={SIDE} y={170} w={580} text="Android asks once to let the app draw over other apps." />
      {f >= 130 && <Note at={140} x={1540} y={300} w={330} text="Flags land in about a second." />}
      {f >= 220 && <Note at={232} x={1540} y={450} w={330} text="Penalties come with the steward's reason." />}
      {f >= 276 && <Note at={286} x={1540} y={620} w={330} text="Drag it anywhere, resize it down to a thumbnail." />}
    </StepWrap>
  );
};

const DrvStep5: React.FC = () => {
  const f = useCurrentFrame();
  const fly = interpolate(f, [76, 118], [0, 1], { ...CLAMP, easing: EASE });
  const bx = 960 + (1500 - 960) * fly;
  const by = 700 + (430 - 700) * fly - Math.sin(fly * Math.PI) * 160;
  const countdown = interpolate(f, [130, 340], [1, 0], CLAMP);
  return (
    <StepWrap dur={360}>
      <Phone x={PX} y={PY} w={PW} h={PH}>
        <AppHeader sub="TEAM RADIO" />
        <Field label="Your call" value={typed('BOX BOX', f, 20, 10)} x={26} y={200} w={340} size={30} focus={f >= 14 && f < 70} />
        <Btn label="Send" x={26} y={316} w={340} primary pressedAt={70} />
        <Tap x={196} y={344} at={70} />
      </Phone>
      {f >= 76 && f < 120 && (
        <div style={{ position: 'absolute', left: bx - 70, top: by - 26, padding: '10px 18px', borderRadius: 22, background: C.accent, color: '#05221b', fontFamily: SANS, fontWeight: 800, fontSize: 24 }}>BOX BOX</div>
      )}
      <div style={{ position: 'absolute', left: 1290, top: 300, width: 560, ...lift(appear(f, 112, 14)) }}>
        <div style={{ fontFamily: MONO, fontSize: 17, letterSpacing: 2, color: C.ink3, marginBottom: 10 }}>ON THE BROADCAST</div>
        <div style={{ background: 'rgba(18,21,27,0.95)', border: `1px solid ${C.line}`, borderRadius: 16, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 20px' }}>
            <div style={{ width: 8, height: 36, borderRadius: 4, background: '#bf5af2' }} />
            <div style={{ fontFamily: SANS, fontWeight: 800, fontSize: 26, color: C.ink, flex: 1 }}>Mav #12</div>
            <div style={{ fontFamily: MONO, fontSize: 18, padding: '4px 10px', borderRadius: 6, background: C.accent, color: '#05221b' }}>RADIO</div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', height: 30 }}>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} style={{ width: 5, borderRadius: 3, background: C.accent, height: 8 + 18 * Math.abs(Math.sin(f / 4 + i)) }} />
              ))}
            </div>
          </div>
          <div style={{ padding: '4px 20px 20px', fontFamily: SANS, fontWeight: 900, fontSize: 52, color: C.ink }}>“BOX BOX”</div>
          <div style={{ height: 6, width: `${countdown * 100}%`, background: C.accent }} />
        </div>
      </div>
      <Note at={150} x={1290} y={560} w={560} text="It reaches every teammate's floating window." />
      <Note at={190} x={1290} y={670} w={560} text="It shows on the broadcast and is read aloud." />
      <Note at={230} x={1290} y={780} w={560} text="It clears itself after 10 to 20 seconds." />
    </StepWrap>
  );
};

export const DriverAppScene: React.FC = () => (
  <SceneShell part={7} title="The driver app" steps={['Install the app', 'Register once', 'Sign in to the event', 'Floating flag', 'Team radio']} bounds={DRV_B}>
    <DrvStep1 />
    <DrvStep2 />
    <DrvStep3 />
    <DrvStep4 />
    <DrvStep5 />
  </SceneShell>
);

// ---------------------------------------------------------------- Part: good to know

export const GTK_B = [0, 450, 900, 1350];
export const GOOD_DUR = GTK_B[GTK_B.length - 1];

const Row: React.FC<{ text: string; at: number; plus?: boolean }> = ({ text, at, plus }) => {
  const f = useCurrentFrame();
  const p = appear(f, at, 14);
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginTop: 20, fontFamily: SANS, fontSize: 26, lineHeight: 1.35, color: C.ink, ...lift(p, 14) }}>
      <span style={{ color: C.accent, fontWeight: 900, width: 26, flex: '0 0 auto' }}>{plus ? '+' : '✓'}</span>
      <span>{text}</span>
    </div>
  );
};

const GtkStep1: React.FC = () => {
  const f = useCurrentFrame();
  const col = (x: number, title: string, sub: string, at: number, rows: { t: string; plus?: boolean }[]) => (
    <div style={{ position: 'absolute', left: x, top: 220, width: 555, minHeight: 600, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 18, padding: '28px 30px', ...lift(appear(f, at)) }}>
      <div style={{ fontFamily: SANS, fontSize: 36, fontWeight: 800, color: C.ink }}>{title}</div>
      <div style={{ fontFamily: MONO, fontSize: 19, color: C.accent, marginTop: 4 }}>{sub}</div>
      {rows.map((r, i) => (
        <Row key={r.t} text={r.t} plus={r.plus} at={at + 24 + i * 22} />
      ))}
    </div>
  );
  return (
    <StepWrap dur={450}>
      {col(700, 'Website', 'frlcast.my.id', 0, [
        { t: 'Your events and the event code' },
        { t: 'The operator console: flags, penalties, scenes' },
        { t: 'Overlay links for OBS' },
        { t: 'Audience pages: hub, live, stats, recap, report' },
        { t: 'Driver app sign-in and the audience poll' },
      ])}
      {col(1285, 'Desktop app', 'free download', 90, [
        { t: 'The same console, on your own computer' },
        { t: 'Automatic timing: official API or minimap vision', plus: true },
        { t: 'Grid edits: add drivers, DNF, Retired', plus: true },
        { t: 'The natural Piper commentary voice', plus: true },
        { t: 'Unzip and run start.cmd, nothing to install' },
      ])}
      <Note at={290} x={700} y={860} w={1140} icon="→" text="Start on the website. Switch to the desktop app when you want timing fully automatic." />
    </StepWrap>
  );
};

const GtkStep2: React.FC = () => {
  const f = useCurrentFrame();
  const copied = f >= 46;
  const menu = f >= 96 && f < 136;
  const dialog = f >= 136 && f < 236;
  const shown = f >= 240;
  const url = 'https://www.frlcast.my.id/overlay/all.html?event=KINK12';
  return (
    <StepWrap dur={450}>
      <div style={{ position: 'absolute', left: 700, top: 210, width: 1140, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: '18px 22px', display: 'flex', alignItems: 'center', gap: 18, ...lift(appear(f, 0)) }}>
        <div style={{ fontFamily: MONO, fontSize: 18, color: C.ink3, letterSpacing: 2 }}>ALL-IN-ONE</div>
        <div style={{ flex: 1, fontFamily: MONO, fontSize: 20, color: C.ink2, whiteSpace: 'nowrap', overflow: 'hidden' }}>{url}</div>
        <div style={{ position: 'relative', width: 120, height: 46 }}>
          <Btn label={copied ? 'Copied' : 'Copy'} x={0} y={0} w={120} h={46} primary={copied} pressedAt={40} size={20} />
        </div>
      </div>
      {/* a simplified OBS window */}
      <div style={{ position: 'absolute', left: 700, top: 320, width: 1140, height: 620, background: '#1d1f24', border: '2px solid #2d3038', borderRadius: 14, overflow: 'hidden', ...lift(appear(f, 20)) }}>
        <div style={{ height: 40, background: '#26282f', display: 'flex', alignItems: 'center', padding: '0 16px', fontFamily: SANS, fontSize: 18, color: '#c9ccd4' }}>OBS Studio</div>
        <div style={{ position: 'absolute', left: 20, top: 56, right: 20, height: 380, background: '#000', borderRadius: 6, overflow: 'hidden' }}>
          {shown && (
            <div style={{ position: 'absolute', left: 24, top: 24, width: 230, ...lift(appear(f, 240, 14), 16) }}>
              {['Mav', 'Reza', 'Budi', 'Aki', 'Citra'].map((n, i) => (
                <div key={n} style={{ height: 40, marginBottom: 4, background: 'rgba(18,21,27,0.9)', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px', fontFamily: SANS, fontSize: 18, color: '#fff' }}>
                  <span style={{ fontFamily: MONO, color: C.ink3 }}>{i + 1}</span>
                  <span style={{ width: 4, height: 22, background: ['#bf5af2', '#ff5c7a', '#4aa3ff', '#ffd60a', '#38d996'][i] }} />
                  {n}
                </div>
              ))}
            </div>
          )}
          {!shown && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONO, fontSize: 20, color: '#555' }}>Program</div>}
        </div>
        <div style={{ position: 'absolute', left: 20, bottom: 20, width: 520, height: 140, background: '#26282f', borderRadius: 8, padding: 14 }}>
          <div style={{ fontFamily: SANS, fontSize: 18, color: '#c9ccd4' }}>Sources</div>
          {shown && <div style={{ marginTop: 10, fontFamily: SANS, fontSize: 18, color: '#fff' }}>🌐 FRLcast overlay</div>}
          <div style={{ position: 'absolute', left: 14, bottom: 12, width: 34, height: 30, borderRadius: 6, background: '#3a3d46', color: '#fff', fontSize: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</div>
        </div>
        {menu && (
          <div style={{ position: 'absolute', left: 70, top: 380, width: 260, background: '#2d3038', borderRadius: 8, padding: 6 }}>
            {['Browser', 'Display Capture', 'Game Capture', 'Image', 'Text'].map((m, i) => (
              <div key={m} style={{ height: 36, padding: '0 12px', display: 'flex', alignItems: 'center', fontFamily: SANS, fontSize: 19, borderRadius: 6, color: '#fff', background: i === 0 && f >= 118 ? '#4a6cf7' : 'transparent' }}>
                {m}
              </div>
            ))}
          </div>
        )}
      </div>
      {dialog && (
        <div style={{ position: 'absolute', left: 860, top: 330, width: 820, background: '#26282f', border: '2px solid #3a3d46', borderRadius: 14, padding: '22px 26px', boxShadow: '0 30px 80px rgba(0,0,0,0.6)', ...lift(appear(f, 136, 10), -12) }}>
          <div style={{ fontFamily: SANS, fontSize: 22, color: '#fff', fontWeight: 700 }}>Properties for “FRLcast overlay”</div>
          <div style={{ position: 'relative', height: 340 }}>
            <Field label="URL" value={f >= 150 ? url : ''} x={0} y={20} w={760} size={18} focus={f >= 146 && f < 170} />
            <Field label="Width" value={f >= 176 ? '1920' : ''} x={0} y={130} w={360} size={22} focus={f >= 170 && f < 190} />
            <Field label="Height" value={f >= 192 ? '1080' : ''} x={400} y={130} w={360} size={22} focus={f >= 186 && f < 206} />
            <Btn label="OK" x={640} y={250} w={120} h={50} primary pressedAt={226} />
          </div>
        </div>
      )}
      <Pointer
        path={[
          { f: 10, x: 1500, y: 700 },
          { f: 34, x: 1758, y: 251 },
          { f: 40, x: 1758, y: 251, click: true },
          { f: 80, x: 751, y: 893 },
          { f: 90, x: 751, y: 893, click: true },
          { f: 118, x: 880, y: 724 },
          { f: 126, x: 880, y: 724, click: true },
          { f: 196, x: 1300, y: 560 },
          { f: 216, x: 1586, y: 657 },
          { f: 226, x: 1586, y: 657, click: true },
          { f: 270, x: 1500, y: 980 },
        ]}
      />
      {f >= 250 && (
        <>
          <Note at={260} x={1290} y={400} w={530} text="One browser source carries every widget." />
          <Note at={300} x={1290} y={510} w={530} text="Scenes switch inside it, no extra sources." />
          <Note at={340} x={1290} y={620} w={530} text="The commentator has its own link on the same page." />
        </>
      )}
    </StepWrap>
  );
};

const GtkStep3: React.FC = () => {
  const f = useCurrentFrame();
  const items = [
    'Give each driver a unique name that matches their in-game name.',
    'Open the console in one tab only: it is the timing computer.',
    'Press Start markers the moment you hit Record in OBS.',
    'Manual fallback: keys Q to I fire laps for drivers 1 to 8, Space starts the race.',
    'Share the event hub link so viewers can follow along.',
  ];
  return (
    <StepWrap dur={450}>
      <div style={{ position: 'absolute', left: 700, top: 210, fontFamily: SANS, fontSize: 40, fontWeight: 800, color: C.ink, ...lift(appear(f, 0)) }}>Race night checklist</div>
      {items.map((t, i) => {
        const at = 20 + i * 62;
        const p = appear(f, at, 14);
        const tick = appear(f, at + 24, 12);
        return (
          <div
            key={t}
            style={{
              position: 'absolute',
              left: 700,
              top: 300 + i * 120,
              width: 1140,
              display: 'flex',
              alignItems: 'center',
              gap: 22,
              background: C.panel,
              border: `1px solid ${C.line}`,
              borderRadius: 14,
              padding: '20px 24px',
              ...lift(p, 16),
            }}
          >
            <div style={{ width: 44, height: 44, borderRadius: 10, flex: '0 0 auto', border: `3px solid ${C.accent}`, background: tick > 0.5 ? C.accent : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#05221b', fontWeight: 900, fontSize: 28, transform: `scale(${0.8 + 0.2 * tick})` }}>
              {tick > 0.5 ? '✓' : ''}
            </div>
            <div style={{ fontFamily: SANS, fontSize: 28, color: C.ink, lineHeight: 1.35 }}>{t}</div>
          </div>
        );
      })}
    </StepWrap>
  );
};

export const GoodToKnowScene: React.FC = () => (
  <SceneShell part={8} title="Good to know" steps={['Website or desktop app?', 'Add the overlay to OBS', 'Race night checklist']} bounds={GTK_B}>
    <GtkStep1 />
    <GtkStep2 />
    <GtkStep3 />
  </SceneShell>
);
