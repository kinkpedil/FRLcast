import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
  Sequence,
  OffthreadVideo,
  staticFile,
} from 'remotion';

/*
 * The tutorial kit: the pieces that wrap a screen recording into a proper tutorial in the
 * FRLcast look. Each piece is a small component driven by the current frame, so they can be
 * placed on a timeline with <Sequence> at the moments the recording needs them. A screen
 * recording (OBS) goes in <ScreenFrame>; the intro, step labels, callouts, captions and outro
 * sit on top of it.
 */

export const C = {
  bg: '#0b0d11',
  panel: '#12151b',
  line: 'rgba(255,255,255,0.10)',
  ink: '#f2f4f8',
  ink2: 'rgba(242,244,248,0.72)',
  ink3: 'rgba(242,244,248,0.42)',
  accent: '#00e0a4',
};
export const SANS = 'Inter, "Segoe UI", system-ui, Arial, sans-serif';
export const MONO = 'ui-monospace, "SF Mono", Consolas, "Liberation Mono", monospace';

/**
 * The screen recording layer. Pass a file placed in remotion/public (staticFile), or leave it
 * empty to show a placeholder so the kit renders before you have a recording.
 */
export const ScreenFrame: React.FC<{ src?: string | null }> = ({ src }) => {
  if (src) {
    return (
      <AbsoluteFill style={{ backgroundColor: '#000' }}>
        {/* The recording is silent (narration is carried by the captions), and its near-empty
            audio track breaks Remotion's audio-mixing step, so mute it and render video only. */}
        <OffthreadVideo src={staticFile(src)} muted />
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', fontFamily: MONO }}>
      <div
        style={{
          border: `2px dashed ${C.line}`,
          borderRadius: 16,
          width: '86%',
          height: '78%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: C.ink3,
          fontSize: 34,
          letterSpacing: 2,
          textAlign: 'center',
          lineHeight: 1.6,
        }}
      >
        REKAMAN LAYAR OBS DI SINI
        <br />
        (taruh file di remotion/public, lalu set recordingSrc)
      </div>
    </AbsoluteFill>
  );
};

/** Full-screen intro title card. Fades and lifts in, holds, then fades out. */
export const IntroCard: React.FC<{ kicker: string; title: string; subtitle?: string; durationInFrames: number }> = ({
  kicker,
  title,
  subtitle,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const inS = spring({ frame, fps, config: { damping: 200 } });
  const out = interpolate(frame, [durationInFrames - 15, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const opacity = Math.min(inS, out);
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg, justifyContent: 'center', paddingLeft: 140, fontFamily: SANS, opacity }}>
      <div style={{ transform: `translateY(${interpolate(inS, [0, 1], [40, 0])}px)` }}>
        <div style={{ fontFamily: MONO, fontSize: 30, letterSpacing: 8, color: C.accent }}>{kicker.toUpperCase()}</div>
        <div style={{ fontSize: 130, fontWeight: 800, color: C.ink, letterSpacing: -2, lineHeight: 1.03, marginTop: 12 }}>
          {title}
        </div>
        {subtitle && <div style={{ fontSize: 42, color: C.ink2, marginTop: 10 }}>{subtitle}</div>}
      </div>
      <div style={{ position: 'absolute', left: 140, bottom: 70, fontFamily: MONO, fontSize: 24, color: C.ink3 }}>
        FRLcast by kinkpedil12 <span style={{ color: C.accent }}>· frlcast.my.id</span>
      </div>
    </AbsoluteFill>
  );
};

/** Bottom-left step label. Slides in, stays for its whole <Sequence>, slides out at the end. */
export const LowerThird: React.FC<{ step?: string | number; text: string; durationInFrames: number }> = ({
  step,
  text,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const inS = spring({ frame, fps, config: { damping: 200 } });
  const out = spring({ frame: frame - (durationInFrames - 12), fps, config: { damping: 200 } });
  const x = interpolate(inS, [0, 1], [-500, 0]) + interpolate(out, [0, 1], [0, -500]);
  return (
    <div style={{ position: 'absolute', left: 80, bottom: 90, transform: `translateX(${x}px)`, fontFamily: SANS }}>
      <div style={{ display: 'flex', alignItems: 'stretch', borderRadius: 12, overflow: 'hidden', boxShadow: '0 12px 40px rgba(0,0,0,0.5)' }}>
        {step != null && (
          <div style={{ background: C.accent, color: '#05221b', fontFamily: MONO, fontWeight: 800, fontSize: 34, padding: '0 26px', display: 'flex', alignItems: 'center' }}>
            {typeof step === 'number' ? String(step).padStart(2, '0') : step}
          </div>
        )}
        <div style={{ background: C.panel, borderTop: `1px solid ${C.line}`, borderRight: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}`, color: C.ink, fontSize: 40, fontWeight: 600, padding: '18px 30px' }}>
          {text}
        </div>
      </div>
    </div>
  );
};

/** A callout: a highlight ring on a UI element plus a labelled arrow pointing at it. */
export const Callout: React.FC<{
  x: number;
  y: number;
  w?: number;
  h?: number;
  label?: string;
  from?: 'left' | 'right' | 'top' | 'bottom';
}> = ({ x, y, w = 260, h = 90, label, from = 'bottom' }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 18 } });
  const pulse = 1 + 0.04 * Math.sin(frame / 6);
  // label position relative to the highlight box
  const lx = from === 'left' ? x - 40 : from === 'right' ? x + w + 40 : x + w / 2;
  const ly = from === 'top' ? y - 60 : from === 'bottom' ? y + h + 60 : y + h / 2;
  return (
    <AbsoluteFill>
      <svg width={width} height={height} style={{ position: 'absolute', inset: 0 }}>
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          rx={12}
          fill="none"
          stroke={C.accent}
          strokeWidth={4}
          style={{ opacity: s, transformOrigin: `${x + w / 2}px ${y + h / 2}px`, transform: `scale(${pulse})` }}
        />
      </svg>
      {label ? (
        <div
          style={{
            position: 'absolute',
            left: from === 'right' ? lx : lx,
            top: ly,
            transform: `translate(${from === 'left' ? '-100%' : from === 'right' ? '0' : '-50%'}, ${from === 'top' ? '-100%' : '0'})`,
            background: C.accent,
            color: '#05221b',
            fontFamily: SANS,
            fontWeight: 700,
            fontSize: 34,
            padding: '10px 20px',
            borderRadius: 10,
            opacity: s,
            whiteSpace: 'nowrap',
            boxShadow: '0 8px 30px rgba(0,224,164,0.35)',
          }}
        >
          {label}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

/** Bottom-center caption band, for narration text or notes. */
export const Caption: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 200 } });
  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        bottom: 150,
        transform: 'translateX(-50%)',
        opacity: s,
        maxWidth: 1500,
        textAlign: 'center',
        background: 'rgba(10,12,16,0.82)',
        border: `1px solid ${C.line}`,
        color: C.ink,
        fontFamily: SANS,
        fontSize: 40,
        lineHeight: 1.3,
        padding: '16px 30px',
        borderRadius: 12,
      }}
    >
      {text}
    </div>
  );
};

/** Thin progress bar across the bottom, showing how far through the tutorial we are. */
export const ProgressBar: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames, width } = useVideoConfig();
  const p = interpolate(frame, [0, durationInFrames], [0, width], { extrapolateRight: 'clamp' });
  return (
    <div style={{ position: 'absolute', left: 0, bottom: 0, height: 6, width: p, background: C.accent, opacity: 0.9 }} />
  );
};

/** Closing card. */
export const Outro: React.FC<{ line: string; durationInFrames: number }> = ({ line, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 200 } });
  const out = interpolate(frame, [durationInFrames - 12, durationInFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center', fontFamily: SANS, opacity: Math.min(s, out) }}>
      <div style={{ transform: `scale(${interpolate(s, [0, 1], [0.92, 1])})`, textAlign: 'center' }}>
        <div style={{ fontSize: 84, fontWeight: 800, color: C.ink }}>{line}</div>
        <div style={{ fontFamily: MONO, fontSize: 30, color: C.ink3, marginTop: 30, letterSpacing: 2 }}>
          FRLcast by kinkpedil12 <span style={{ color: C.accent }}>· frlcast.my.id</span>
        </div>
      </div>
    </AbsoluteFill>
  );
};

export { Sequence };
