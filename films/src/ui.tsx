/* The films' shared parts: the house look, the motion, and the pieces every
 * film is exploded into and assembled from (FILMS.md · Look).
 *
 * The ground, ink and grey are the site's own tokens (mintface.css), not
 * approximations of them: every film hands over to a capture of the real
 * page, and a ground one step off would draw a box round every capture.
 */
import React, { useEffect, useState } from 'react';
import { AbsoluteFill, Easing, Img, continueRender, delayRender, interpolate, staticFile, useCurrentFrame } from 'remotion';

export const PAPER = '#FAF9F6';
export const INK = '#14120F';
export const GREY = '#6E6A62';
export const FAINT = '#A9A49A';
export const RULE = '#E6E2DA';
export const SANS = "'Geist', 'Helvetica Neue', Helvetica, Arial, sans-serif";
export const MONO = "'Geist Mono', ui-monospace, Menlo, monospace";
export const FPS = 60;

/* ------------------------------------------------------------------ time */

export const f = (s: number) => Math.round(s * FPS);
/* Slow, precise, nothing overshoots. Moves of 600 to 900 ms. */
export const SETTLE = Easing.bezier(0.22, 0.61, 0.21, 1);
export const GLIDE = Easing.bezier(0.45, 0, 0.2, 1);
/** 0 → 1 between two times in seconds. */
export const at = (frame: number, from: number, dur: number, ease = SETTLE) =>
  interpolate(frame, [f(from), f(from) + Math.max(1, f(dur))], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Visible 1 inside [from, to], fading over `fade` seconds at each end. */
export const shown = (frame: number, from: number, to: number, fade = 0.35) =>
  Math.min(at(frame, from, fade, GLIDE), 1 - at(frame, to - fade, fade, GLIDE));
/* A part's stagger: 40 to 80 ms apart. */
export const STAGGER = 0.06;

export const nz = (n: number) => Math.floor(Number(n) || 0).toLocaleString('en-NZ');

/* ----------------------------------------------------------------- fonts */

let loading: Promise<void> | null = null;
const loadFonts = () => {
  if (loading) return loading;
  const faces = [
    new FontFace('Geist', `url(${staticFile('fonts/Geist-Variable.woff2')}) format('woff2')`, { weight: '100 900' }),
    new FontFace('Geist Mono', `url(${staticFile('fonts/GeistMono-Variable.woff2')}) format('woff2')`, { weight: '100 900' }),
  ];
  loading = Promise.all(faces.map((x) => x.load())).then((loaded) => { loaded.forEach((x) => document.fonts.add(x)); });
  return loading;
};

/** The paper every film is set on, with the site's fonts loaded first. */
export const Paper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [handle] = useState(() => delayRender('fonts'));
  useEffect(() => { loadFonts().then(() => continueRender(handle)); }, [handle]);
  return <AbsoluteFill style={{ background: PAPER, color: INK, fontFamily: SANS, overflow: 'hidden' }}>{children}</AbsoluteFill>;
};

/* ------------------------------------------------------------------ type */

/** One line per beat. Headline 72 to 96 px, medium. */
export const Headline: React.FC<{ text: string; size?: number; style?: React.CSSProperties }> = ({ text, size = 84, style }) => (
  <div style={{ fontFamily: SANS, fontWeight: 500, fontSize: size, letterSpacing: '-0.025em', lineHeight: 1.04, color: INK, whiteSpace: 'nowrap', ...style }}>{text}</div>
);

/** Labels: mono caps, tracked. */
export const Label: React.FC<{ text: string; size?: number; color?: string; style?: React.CSSProperties }> = ({ text, size = 20, color = GREY, style }) => (
  <div style={{ fontFamily: MONO, fontSize: size, letterSpacing: '0.14em', textTransform: 'uppercase', color, whiteSpace: 'nowrap', ...style }}>{text}</div>
);

/** A beat's line, set bottom left, rising in and out with its beat. */
export const Beat: React.FC<{ from: number; to: number; text: string; label?: string; x?: number; y?: number; size?: number; hold?: boolean }>
  = ({ from, to, text, label, x = 120, y = 930, size = 84, hold }) => {
    const frame = useCurrentFrame();
    if (!text && !label) return null;
    /* The first beat is already on frame 0: the poster has to read. */
    const inP = from <= 0 ? 1 : at(frame, from, 0.7);
    const outP = hold ? 0 : at(frame, to - 0.45, 0.45, GLIDE);
    const o = Math.min(inP, 1 - outP);
    const dy = (1 - inP) * 18 - outP * 10;
    return (
      <div style={{ position: 'absolute', left: x, top: y, transform: `translateY(${dy - size}px)`, opacity: o }}>
        {text ? <Headline text={text} size={size} /> : null}
        {label ? <Label text={label} size={24} style={{ marginTop: text ? 22 : 0 }} /> : null}
      </div>
    );
  };

/* --------------------------------------------------------------- shapes */

/** Pointy-top hexagon, as the site draws every collector. */
export const HEX = '50,0 93.3,25 93.3,75 50,100 6.7,75 6.7,25';
const hexClip = 'polygon(50% 0%, 93.3% 25%, 93.3% 75%, 50% 100%, 6.7% 75%, 6.7% 25%)';

export const Hex: React.FC<{ src: string | null; size: number; edge?: number; style?: React.CSSProperties; edgeColor?: string; draw?: number }>
  = ({ src, size, edge = 0, style, edgeColor = INK, draw = 1 }) => (
    <div style={{ position: 'absolute', width: size, height: size, ...style }}>
      {src
        ? <Img src={staticFile(src)} style={{ width: size, height: size, objectFit: 'cover', clipPath: hexClip, display: 'block' }} />
        : <div style={{ width: size, height: size, clipPath: hexClip, background: PAPER }} />}
      <svg viewBox="0 0 100 100" style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        <polygon points={HEX} pathLength={100} fill="none" stroke={src ? edgeColor : FAINT}
          strokeWidth={src ? (edge * 100) / size : (1.6 * 100) / size} strokeDasharray={100} strokeDashoffset={100 - 100 * (src ? draw : 1)}
          opacity={src && !edge ? 0 : 1} />
      </svg>
    </div>
  );

/* ------------------------------------------------------------ exploded */

export type XY = { x: number; y: number };

/**
 * One part of an exploded illustration. It floats at `from` with a lift (a
 * shadow and a touch of scale), and eases to `to`, flat, where the real page
 * has it. The label hangs off it on a hairline until it starts to move.
 */
export const Part: React.FC<{
  from: XY; to: XY; w: number; h: number; start: number; dur?: number; lift?: number;
  label?: string; labelAt?: XY; labelOut?: number; children: React.ReactNode; opacity?: number; style?: React.CSSProperties;
  drift?: number;
}> = ({ from, to, w, h, start, dur = 0.8, lift = 1, label, labelAt, labelOut, children, opacity = 1, style, drift = 0 }) => {
  const frame = useCurrentFrame();
  const p = at(frame, start, dur);
  /* While it hangs, it breathes: a slow drift, never a bounce. */
  const t = frame / FPS;
  const dx = drift * Math.sin(t * 0.7 + from.x * 0.01) * (1 - p);
  const dy = drift * Math.cos(t * 0.6 + from.y * 0.013) * (1 - p);
  const x = lerp(from.x, to.x, p) + dx;
  const y = lerp(from.y, to.y, p) + dy;
  const l = lift * (1 - p);
  const s = 1 + 0.035 * l;
  const shadow = l > 0.01 ? `drop-shadow(0 ${(14 * l).toFixed(1)}px ${(22 * l).toFixed(1)}px rgba(20,18,15,${(0.16 * l).toFixed(3)}))` : 'none';
  const lo = label ? 1 - at(frame, labelOut ?? start - 0.25, 0.3, GLIDE) : 0;
  return (
    <>
      {label && labelAt && lo > 0 ? <Leader from={{ x: x + w / 2, y: y + h / 2 }} to={labelAt} label={label} opacity={lo * opacity} /> : null}
      <div style={{ position: 'absolute', left: x, top: y, width: w, height: h, transform: `scale(${s})`, transformOrigin: 'center',
        filter: shadow, opacity, ...style }}>{children}</div>
    </>
  );
};

/** A hairline from a part to its small mono label. */
export const Leader: React.FC<{ from: XY; to: XY; label: string; opacity?: number; dot?: boolean }> = ({ from, to, label, opacity = 1, dot = true }) => {
  const left = to.x < from.x;
  return (
    <>
      <svg style={{ position: 'absolute', left: 0, top: 0, width: 1920, height: 1080, overflow: 'visible', opacity }}>
        <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={GREY} strokeWidth={1.25} />
        {dot ? <circle cx={from.x} cy={from.y} r={3.5} fill={INK} /> : null}
      </svg>
      <Label text={label} size={18} color={INK} style={{ position: 'absolute', left: left ? undefined : to.x + 10, right: left ? 1920 - to.x + 10 : undefined, top: to.y - 12, opacity }} />
    </>
  );
};

/* --------------------------------------------------------------- frames */

/** A capture of the real page, placed by its top left at a scale. */
export const Capture: React.FC<{ src: string; x: number; y: number; w: number; h: number; scale: number; opacity?: number; style?: React.CSSProperties }>
  = ({ src, x, y, w, h, scale, opacity = 1, style }) => (
    <Img src={staticFile(src)} style={{ position: 'absolute', left: x, top: y, width: w * 2 * scale, height: h * 2 * scale, opacity, ...style }} />
  );

/** A generic laptop, drawn in house: a thin screen outline and a base. */
export const Laptop: React.FC<{ x: number; y: number; w: number; h: number; opacity?: number }> = ({ x, y, w, h, opacity = 1 }) => {
  const b = 18;
  return (
    <svg style={{ position: 'absolute', left: 0, top: 0, width: 1920, height: 1080, overflow: 'visible', opacity }}>
      <rect x={x - b} y={y - b} width={w + 2 * b} height={h + 2 * b + 6} rx={22} fill="none" stroke={INK} strokeWidth={2} />
      <path d={`M ${x - b - 120} ${y + h + b + 18} H ${x + w + b + 120} q 0 14 -26 18 H ${x - b - 94} q -26 -4 -26 -18 Z`} fill="none" stroke={INK} strokeWidth={2} />
      <line x1={x + w / 2 - 70} y1={y + h + b + 18} x2={x + w / 2 + 70} y2={y + h + b + 18} stroke={PAPER} strokeWidth={3} />
      <path d={`M ${x + w / 2 - 70} ${y + h + b + 18} q 0 8 10 8 H ${x + w / 2 + 60} q 10 0 10 -8`} fill="none" stroke={INK} strokeWidth={2} />
    </svg>
  );
};

/** The last two seconds: the URL in mono and the small MintFace mark. */
export const EndCard: React.FC<{ from: number; url: string; top?: number; children?: React.ReactNode }> = ({ from, url, top = 470, children }) => {
  const frame = useCurrentFrame();
  const o = at(frame, from, 0.45, GLIDE);
  if (o <= 0) return null;
  return (
    <AbsoluteFill style={{ background: PAPER, opacity: o, alignItems: 'center', justifyContent: 'center' }}>
      {children}
      <div style={{ position: 'absolute', top, width: '100%', textAlign: 'center', fontFamily: MONO, fontSize: 44, letterSpacing: '0.04em', color: INK }}>{url}</div>
      <Img src={staticFile('brand/MintFace-Logo-Black.png')} style={{ position: 'absolute', top: top + 102, left: 960 - 92, width: 184, height: 'auto' }} />
    </AbsoluteFill>
  );
};

/** A colour as a flat tile: the house square, with its hex beneath it. */
export const Tile: React.FC<{ hex: string; size: number; showHex?: boolean; style?: React.CSSProperties }> = ({ hex, size, showHex, style }) => (
  <div style={{ position: 'absolute', width: size, ...style }}>
    <div style={{ width: size, height: size, background: hex, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.08)' }} />
    {showHex ? <Label text={hex} size={16} color={GREY} style={{ marginTop: 10, letterSpacing: '0.08em' }} /> : null}
  </div>
);

/**
 * A region of a capture, cut out as a part. Floating crops of the real page
 * reassemble into exactly the pixels they hand over to.
 * @param img  the capture's size in CSS px; box is in the same units
 */
export const Crop: React.FC<{ src: string; img: { w: number; h: number }; box: { x: number; y: number; w: number; h: number }; scale: number; pad?: number }>
  = ({ src, img, box, scale, pad = 0 }) => {
    const k = 2 * scale;
    const b = { x: box.x - pad, y: box.y - pad, w: box.w + 2 * pad, h: box.h + 2 * pad };
    return (
      <div style={{ position: 'absolute', left: 0, top: 0, width: b.w * k, height: b.h * k, overflow: 'hidden', background: PAPER }}>
        <Img src={staticFile(src)} style={{ position: 'absolute', left: -b.x * k, top: -b.y * k, width: img.w * k, height: img.h * k, maxWidth: 'none' }} />
      </div>
    );
  };

/**
 * A value through keyframes: [[seconds, value], ...], eased between each
 * pair. Values are numbers or flat objects of numbers.
 */
export function keys<T extends number | Record<string, number>>(frame: number, ks: [number, T][], ease = SETTLE): T {
  const t = frame / FPS;
  if (t <= ks[0][0]) return ks[0][1];
  for (let i = 1; i < ks.length; i++) {
    const [t1, v1] = ks[i];
    const [t0, v0] = ks[i - 1];
    if (t <= t1) {
      const p = ease(Math.max(0, Math.min(1, (t - t0) / Math.max(1e-6, t1 - t0))));
      if (typeof v0 === 'number') return (v0 + ((v1 as number) - v0) * p) as T;
      const out: Record<string, number> = {};
      for (const k of Object.keys(v0)) out[k] = (v0 as any)[k] + ((v1 as any)[k] - (v0 as any)[k]) * p;
      return out as T;
    }
  }
  return ks[ks.length - 1][1];
}

/** A stable pseudo-random number in [0, 1) for an index: the scatter is the
 *  same on every render. */
export const rnd = (i: number, salt = 1) => { const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453; return x - Math.floor(x); };

/** A card capture placed at (x, y) and scale: CSS box → screen. */
export const placer = (x: number, y: number, scale: number) => (b: { x: number; y: number; w?: number; h?: number }) =>
  ({ x: x + b.x * 2 * scale, y: y + b.y * 2 * scale, w: (b.w || 0) * 2 * scale, h: (b.h || 0) * 2 * scale });

/** Paper rising behind a beat's line where the page runs under it. */
export const Veil: React.FC<{ from: number; to: number; top?: number }> = ({ from, to, top = 800 }) => {
  const frame = useCurrentFrame();
  const o = Math.min(at(frame, from, 0.5, GLIDE), 1 - at(frame, to - 0.4, 0.4, GLIDE));
  if (o <= 0) return null;
  return <div style={{ position: 'absolute', left: 0, right: 0, top, bottom: 0, opacity: o,
    background: `linear-gradient(to bottom, rgba(250,249,246,0) 0%, ${PAPER} 42%, ${PAPER} 100%)` }} />;
};
