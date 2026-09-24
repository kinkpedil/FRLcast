import React from 'react';
import {
  AbsoluteFill,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
  Easing,
} from 'remotion';
import { RecapData, Driver } from './data';

/*
 * A race recap, rendered from event data. The look follows FRLcast's overlays: a near-black
 * panel background, the accent green, a mono typeface for numbers, and a colour bar per driver.
 * The whole thing is four sequences (intro, podium, standings, outro) so the timing of each is
 * obvious and easy to retune.
 */

const C = {
  bg: '#0b0d11',
  panel: '#12151b',
  line: 'rgba(255,255,255,0.08)',
  ink: '#f2f4f8',
  ink2: 'rgba(242,244,248,0.72)',
  ink3: 'rgba(242,244,248,0.42)',
  accent: '#00e0a4',
  gold: '#ffd60a',
  silver: '#cfd6e4',
  bronze: '#d8935b',
};
const SANS = 'Inter, "Segoe UI", system-ui, Arial, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Consolas, "Liberation Mono", monospace';

/** The dark backdrop with a faint sweeping accent line, shown under every sequence. */
const Backdrop: React.FC = () => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const x = interpolate(frame, [0, 600], [-width * 0.3, width * 0.3]);
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(1200px 700px at ${50 + (x / width) * 20}% -10%, rgba(0,224,164,0.10), transparent 60%)`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 90,
          height: 2,
          background: `linear-gradient(90deg, transparent, ${C.accent}, transparent)`,
          opacity: 0.5,
          transform: `translateX(${x}px)`,
        }}
      />
    </AbsoluteFill>
  );
};

/** Bottom-corner brand line, on every scene. Exact wording agreed with the game dev. */
const Brand: React.FC = () => (
  <div
    style={{
      position: 'absolute',
      left: 80,
      bottom: 44,
      fontFamily: MONO,
      fontSize: 24,
      letterSpacing: 2,
      color: C.ink3,
    }}
  >
    FRLcast by kinkpedil12 <span style={{ color: C.accent }}>· frlcast.my.id</span>
  </div>
);

const ColorBar: React.FC<{ color: string; h: number; w?: number }> = ({ color, h, w = 8 }) => (
  <span style={{ display: 'inline-block', width: w, height: h, borderRadius: w / 2, background: color }} />
);

// ---------------------------------------------------------------- intro
const Intro: React.FC<{ data: RecapData }> = ({ data }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const up = (delay: number) => {
    const s = spring({ frame: frame - delay, fps, config: { damping: 200 } });
    return { opacity: s, transform: `translateY(${interpolate(s, [0, 1], [40, 0])}px)` };
  };
  return (
    <AbsoluteFill style={{ justifyContent: 'center', paddingLeft: 120, fontFamily: SANS }}>
      <div style={{ ...up(0), fontFamily: MONO, fontSize: 30, letterSpacing: 8, color: C.accent }}>
        {data.round.toUpperCase()}
      </div>
      <div style={{ ...up(6), fontSize: 150, fontWeight: 800, color: C.ink, letterSpacing: -2, lineHeight: 1.02, marginTop: 10 }}>
        {data.event}
      </div>
      <div style={{ ...up(12), fontSize: 44, color: C.ink2, marginTop: 8 }}>{data.track}</div>
      <div style={{ ...up(20), fontFamily: MONO, fontSize: 26, letterSpacing: 4, color: C.ink3, marginTop: 40 }}>
        RACE RECAP
      </div>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- podium
const PodiumCard: React.FC<{ d: Driver; height: number; delay: number; medal: string }> = ({
  d,
  height,
  delay,
  medal,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 18, mass: 0.8 } });
  const h = interpolate(s, [0, 1], [0, height]);
  return (
    <div style={{ width: 360, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end' }}>
      <div style={{ opacity: s, transform: `translateY(${interpolate(s, [0, 1], [30, 0])}px)`, textAlign: 'center', marginBottom: 18 }}>
        <div style={{ fontFamily: MONO, fontSize: 30, color: medal }}>P{d.pos}</div>
        <div style={{ fontSize: 40, fontWeight: 700, color: C.ink, marginTop: 6 }}>{d.name}</div>
        <div style={{ fontFamily: MONO, fontSize: 24, color: C.ink3, marginTop: 4 }}>
          #{d.num} · {d.best}
        </div>
      </div>
      <div
        style={{
          width: 300,
          height: h,
          background: C.panel,
          borderTop: `4px solid ${d.color}`,
          borderLeft: `1px solid ${C.line}`,
          borderRight: `1px solid ${C.line}`,
          borderRadius: '10px 10px 0 0',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          paddingTop: 18,
        }}
      >
        <span style={{ fontFamily: MONO, fontSize: 120, fontWeight: 800, color: medal, opacity: 0.9 }}>{d.pos}</span>
      </div>
    </div>
  );
};

const Podium: React.FC<{ data: RecapData }> = ({ data }) => {
  const frame = useCurrentFrame();
  const top = data.drivers.slice(0, 3);
  const titleS = spring({ frame, fps: useVideoConfig().fps, config: { damping: 200 } });
  // Standard podium order, tallest in the middle.
  const p1 = top[0];
  const p2 = top[1];
  const p3 = top[2];
  return (
    <AbsoluteFill style={{ fontFamily: SANS }}>
      <div
        style={{
          position: 'absolute',
          top: 90,
          width: '100%',
          textAlign: 'center',
          fontFamily: MONO,
          fontSize: 34,
          letterSpacing: 10,
          color: C.ink3,
          opacity: titleS,
        }}
      >
        PODIUM
      </div>
      <AbsoluteFill style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 40, paddingBottom: 130 }}>
        {p2 && <PodiumCard d={p2} height={300} delay={10} medal={C.silver} />}
        {p1 && <PodiumCard d={p1} height={420} delay={0} medal={C.gold} />}
        {p3 && <PodiumCard d={p3} height={220} delay={20} medal={C.bronze} />}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- standings
const StandingRow: React.FC<{ d: Driver; i: number }> = ({ d, i }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - i * 5, fps, config: { damping: 200 } });
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 24,
        height: 92,
        padding: '0 30px',
        background: C.panel,
        border: `1px solid ${C.line}`,
        borderRadius: 12,
        opacity: s,
        transform: `translateX(${interpolate(s, [0, 1], [-60, 0])}px)`,
      }}
    >
      <span style={{ fontFamily: MONO, fontSize: 40, color: C.ink3, width: 60 }}>{d.pos}</span>
      <ColorBar color={d.color} h={44} />
      <span style={{ fontSize: 40, fontWeight: 600, color: C.ink, flex: 1 }}>
        {d.name}
        <span style={{ fontSize: 26, color: C.ink3, marginLeft: 16 }}>{d.team}</span>
      </span>
      <span style={{ fontFamily: MONO, fontSize: 30, color: C.ink3 }}>{d.best}</span>
      <span style={{ fontFamily: MONO, fontSize: 44, fontWeight: 700, color: C.accent, width: 130, textAlign: 'right' }}>
        {d.points}
      </span>
    </div>
  );
};

const Standings: React.FC<{ data: RecapData }> = ({ data }) => {
  const titleS = spring({ frame: useCurrentFrame(), fps: useVideoConfig().fps, config: { damping: 200 } });
  return (
    <AbsoluteFill style={{ padding: '90px 120px', fontFamily: SANS }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 20, opacity: titleS, marginBottom: 30 }}>
        <span style={{ fontFamily: MONO, fontSize: 34, letterSpacing: 8, color: C.ink3 }}>FINAL STANDINGS</span>
        <span style={{ fontSize: 30, color: C.ink3 }}>{data.event}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {data.drivers.map((d, i) => (
          <StandingRow key={d.num} d={d} i={i} />
        ))}
      </div>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- outro
const Outro: React.FC<{ data: RecapData }> = ({ data }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 200 } });
  const winner = data.drivers[0];
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', fontFamily: SANS, textAlign: 'center' }}>
      <div style={{ opacity: s, transform: `scale(${interpolate(s, [0, 1], [0.9, 1])})` }}>
        <div style={{ fontFamily: MONO, fontSize: 30, letterSpacing: 6, color: C.accent }}>WINNER</div>
        <div style={{ fontSize: 110, fontWeight: 800, color: C.ink, marginTop: 10 }}>{winner?.name}</div>
        <div style={{ fontSize: 40, color: C.ink2, marginTop: 6 }}>
          {data.event} · {data.round}
        </div>
        <div style={{ fontFamily: MONO, fontSize: 30, color: C.ink3, marginTop: 60, letterSpacing: 2 }}>
          FRLcast by kinkpedil12 <span style={{ color: C.accent }}>· frlcast.my.id</span>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- the film
export const Recap: React.FC<{ data: RecapData }> = ({ data }) => {
  return (
    <AbsoluteFill>
      <Backdrop />
      <Sequence durationInFrames={90}>
        <Intro data={data} />
      </Sequence>
      <Sequence from={90} durationInFrames={210}>
        <Podium data={data} />
      </Sequence>
      <Sequence from={300} durationInFrames={210}>
        <Standings data={data} />
      </Sequence>
      <Sequence from={510} durationInFrames={90}>
        <Outro data={data} />
      </Sequence>
      <Sequence durationInFrames={510}>
        <Brand />
      </Sequence>
    </AbsoluteFill>
  );
};
