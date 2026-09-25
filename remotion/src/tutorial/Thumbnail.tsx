import React from 'react';
import { AbsoluteFill, Img, staticFile } from 'remotion';
import { C, MONO, SANS } from './TutorialKit';

/*
 * YouTube thumbnail for the tutorial (1920x1080 still). Big readable title on the left, the
 * real console (a frame from the recording) tilted on the right, with the leaderboard overlay
 * and the driver app's floating flag in front, so the three things the video covers read at a
 * glance even at phone-thumbnail size.
 */

const ROWS: { n: number; name: string; color: string; time: string; tag?: string }[] = [
  { n: 1, name: 'MAV', color: '#bf5af2', time: 'LEADER', tag: 'FL' },
  { n: 2, name: 'REZA', color: '#ff5c7a', time: '+1.204' },
  { n: 3, name: 'BUDI', color: '#4aa3ff', time: '+2.918' },
  { n: 4, name: 'AKI', color: '#ffd60a', time: '+4.330' },
  { n: 5, name: 'CITRA', color: '#38d996', time: '+6.012' },
];

export const Thumbnail: React.FC = () => {
  const shotW = 1260;
  const k = shotW / 1920;
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg, overflow: 'hidden' }}>
      {/* backdrop */}
      <AbsoluteFill
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
        }}
      />
      <AbsoluteFill style={{ background: 'radial-gradient(900px 700px at 72% 45%, rgba(0,224,164,0.28), transparent 65%)' }} />
      <AbsoluteFill style={{ background: 'linear-gradient(90deg, rgba(11,13,17,1) 0%, rgba(11,13,17,0.92) 34%, rgba(11,13,17,0) 58%)', zIndex: 2 }} />

      {/* the real console, tilted */}
      <div
        style={{
          position: 'absolute',
          left: 760,
          top: 150,
          width: shotW,
          height: Math.round(970 * k),
          borderRadius: 18,
          overflow: 'hidden',
          border: `3px solid ${C.accent}`,
          boxShadow: '0 40px 120px rgba(0,0,0,0.75), 0 0 80px rgba(0,224,164,0.35)',
          transform: 'perspective(2200px) rotateY(-16deg) rotateX(5deg) rotateZ(-2deg)',
          transformOrigin: 'left center',
          zIndex: 1,
        }}
      >
        <Img src={staticFile('thumb-console-790.png')} style={{ width: shotW, marginTop: -Math.round(110 * k), display: 'block' }} />
      </div>

      {/* leaderboard overlay card */}
      <div
        style={{
          position: 'absolute',
          left: 760,
          top: 600,
          width: 500,
          borderRadius: 16,
          overflow: 'hidden',
          background: 'rgba(14,17,22,0.97)',
          border: `1px solid ${C.line}`,
          boxShadow: '0 30px 80px rgba(0,0,0,0.8)',
          transform: 'rotate(-3deg)',
          zIndex: 4,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', borderBottom: `1px solid ${C.line}` }}>
          <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 22, letterSpacing: 3, color: C.ink }}>
            <span style={{ display: 'inline-block', width: 6, height: 18, background: C.accent, marginRight: 10, verticalAlign: -2 }} />
            LEADERBOARD
          </span>
          <span style={{ fontFamily: MONO, fontSize: 18, color: C.ink3 }}>LAP 7 / 50</span>
        </div>
        {ROWS.map((r) => (
          <div key={r.n} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '11px 20px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <span style={{ fontFamily: MONO, fontSize: 24, color: C.ink2, width: 22 }}>{r.n}</span>
            <span style={{ width: 6, height: 28, borderRadius: 3, background: r.color }} />
            <span style={{ fontFamily: SANS, fontWeight: 800, fontSize: 28, color: C.ink, flex: 1 }}>
              {r.name}
              {r.tag && <span style={{ marginLeft: 10, fontSize: 16, padding: '2px 8px', borderRadius: 5, background: '#bf5af2', color: '#fff', verticalAlign: 4 }}>{r.tag}</span>}
            </span>
            <span style={{ fontFamily: MONO, fontSize: 24, color: r.n === 1 ? C.accent : C.ink2 }}>{r.time}</span>
          </div>
        ))}
      </div>

      {/* driver phone with the floating flag */}
      <div
        style={{
          position: 'absolute',
          left: 1520,
          top: 430,
          width: 300,
          height: 600,
          borderRadius: 44,
          background: '#1b1f27',
          padding: 12,
          boxShadow: '0 40px 100px rgba(0,0,0,0.8)',
          transform: 'rotate(9deg)',
          zIndex: 5,
        }}
      >
        <div style={{ position: 'relative', width: '100%', height: '100%', borderRadius: 34, overflow: 'hidden', background: 'linear-gradient(180deg, #243447 0%, #3f5870 48%, #2b2f36 49%, #1a1d22 100%)' }}>
          <svg width="100%" height="100%" viewBox="0 0 276 576" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0 }}>
            <polygon points="118,280 158,280 276,576 0,576" fill="#30343b" />
            <rect x={134} y={330} width={6} height={30} fill="#e8e2c9" />
            <rect x={133} y={410} width={9} height={46} fill="#e8e2c9" />
            <rect x={98} y={480} width={80} height={50} rx={9} fill="#d7263d" />
          </svg>
          <div style={{ position: 'absolute', top: 10, left: '50%', width: 80, height: 20, marginLeft: -40, borderRadius: 10, background: '#000' }} />
          <div style={{ position: 'absolute', left: 16, right: 16, top: 70, borderRadius: 16, background: '#1d7bff', padding: '12px 10px 16px', textAlign: 'center', color: '#fff', boxShadow: '0 12px 30px rgba(0,0,0,0.5)' }}>
            <div style={{ fontFamily: MONO, fontSize: 15, opacity: 0.85 }}>Mav #12 · P1</div>
            <div style={{ fontFamily: SANS, fontWeight: 900, fontSize: 30, lineHeight: 1.05, marginTop: 4 }}>UNDER INVESTIGATION</div>
          </div>
        </div>
      </div>

      {/* title */}
      <div style={{ position: 'absolute', left: 96, top: 205, width: 820, zIndex: 6 }}>
        <div style={{ display: 'inline-block', fontFamily: MONO, fontWeight: 700, fontSize: 30, letterSpacing: 6, color: C.accent, border: `3px solid ${C.accent}`, borderRadius: 12, padding: '8px 18px' }}>
          FR LEGENDS
        </div>
        <div style={{ fontFamily: SANS, fontWeight: 900, fontSize: 196, lineHeight: 0.95, color: C.ink, letterSpacing: -6, marginTop: 34, textShadow: '0 10px 40px rgba(0,0,0,0.6)' }}>
          FRL<span style={{ color: C.accent }}>cast</span>
        </div>
        <div
          style={{
            display: 'inline-block',
            marginTop: 30,
            background: C.accent,
            color: '#05221b',
            fontFamily: SANS,
            fontWeight: 900,
            fontSize: 64,
            letterSpacing: 1,
            padding: '12px 26px',
            borderRadius: 14,
            transform: 'rotate(-2deg)',
            boxShadow: '0 16px 40px rgba(0,224,164,0.35)',
          }}
        >
          THE COMPLETE GUIDE
        </div>
        <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: 44, color: C.ink, marginTop: 44, lineHeight: 1.35, textShadow: '0 6px 24px rgba(0,0,0,0.7)' }}>
          Live timing · OBS overlays
          <br />
          Driver app · Timing API
        </div>
      </div>
    </AbsoluteFill>
  );
};
