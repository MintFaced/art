/* Film 1 · //Strips (FILMS.md).
 *
 * The street is what gets deconstructed, never the painting: the painting's
 * own colours lift off the signs and shopfronts they were read from, hang on
 * hairlines to where they came from, and drift into the empty fascia as the
 * finished painting resolves in place. Then the home page's size slider,
 * exploded, assembles into the real block and runs 80 to 240.
 */
import React from 'react';
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { S, C, film, beat } from './data';
import { Paper, Beat, Label, Part, Capture, Crop, Laptop, EndCard, at, lerp, f, FPS, GLIDE, INK, GREY, PAPER, MONO, STAGGER } from './ui';

const ID = '01-strips';
const st = S.strip;
const PANEL = { x: 120, y: 228, w: 1680, h: 640 };
type Cam = { x: number; y: number; w: number };
/* The site's framings, in before-photo pixels (data/street.json). */
const { A, B, C0, C1 } = st.cams as Record<'A' | 'B' | 'C0' | 'C1', Cam>;

const mixCam = (a: Cam, b: Cam, p: number): Cam => ({ x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p), w: Math.exp(lerp(Math.log(a.w), Math.log(b.w), p)) });
const camAt = (frame: number): Cam => {
  let c = mixCam(A, B, at(frame, 3.0, 3.6, GLIDE));
  c = mixCam(c, C0, at(frame, 7.3, 1.3, GLIDE));
  const pan = interpolate(frame, [f(8.3), f(12.4)], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return frame >= f(8.3) ? mixCam(C0, C1, pan) : c;
};
const project = (cam: Cam, px: number, py: number) => {
  const k = PANEL.w / cam.w;
  return { x: PANEL.x + (px - cam.x) * k, y: PANEL.y + (py - cam.y) * k };
};

/* The homography that lays the after photo on the before, as CSS. */
const Hm = st.H;
const matrix3d = `matrix3d(${Hm[0][0]},${Hm[1][0]},0,${Hm[2][0]},${Hm[0][1]},${Hm[1][1]},0,${Hm[2][1]},0,0,1,0,${Hm[0][2]},${Hm[1][2]},0,${Hm[2][2]})`;
const fasciaClip = `polygon(${st.fascia.map((p: number[]) => `${p[0]}px ${p[1]}px`).join(', ')})`;

const Street: React.FC = () => {
  const frame = useCurrentFrame();
  const cam = camAt(frame);
  const k = PANEL.w / cam.w;
  const inFascia = at(frame, 4.8, 2.0, GLIDE);
  const whole = at(frame, 7.0, 1.2, GLIDE);
  const out = at(frame, 11.5, 0.6, GLIDE);
  const plane: React.CSSProperties = { position: 'absolute', left: 0, top: 0, width: st.before_size.w, height: st.before_size.h,
    transformOrigin: '0 0', transform: `translate(${-cam.x * k}px, ${-cam.y * k}px) scale(${k})` };
  const afterImg = <Img src={staticFile(st.after)} style={{ position: 'absolute', left: 0, top: 0, width: st.after_size.w, height: st.after_size.h, maxWidth: 'none', transformOrigin: '0 0', transform: matrix3d }} />;
  return (
    <div style={{ position: 'absolute', left: PANEL.x, top: PANEL.y - out * 30, width: PANEL.w, height: PANEL.h, overflow: 'hidden', opacity: 1 - out, background: PAPER }}>
      <div style={plane}>
        <Img src={staticFile(st.before)} style={{ position: 'absolute', left: 0, top: 0, width: st.before_size.w, height: st.before_size.h, maxWidth: 'none' }} />
        {inFascia > 0 ? <div style={{ position: 'absolute', inset: 0, clipPath: fasciaClip, opacity: inFascia }}>{afterImg}</div> : null}
        {whole > 0 ? <div style={{ position: 'absolute', inset: 0, opacity: whole }}>{afterImg}</div> : null}
      </div>
    </div>
  );
};

/* The painting's colours, where they sit on the street. Each hangs above
   its source on a hairline, roughly over it so the lines stay clean, then
   drifts into the fascia wherever the camera has it at that moment. */
const SW = 76;
const camA = camAt(0);
const sources = st.swatches.map((s: any) => ({ ...s, at: project(camA, s.x, s.y) }));
const hangX = (() => {
  const xs = sources.map((s: any) => Math.min(1700, Math.max(200, s.at.x - SW / 2)));
  for (let pass = 0; pass < 6; pass++) for (let i = 1; i < xs.length; i++) if (xs[i] - xs[i - 1] < 190) {
    const push = (190 - (xs[i] - xs[i - 1])) / 2; xs[i - 1] -= push; xs[i] += push;
  }
  return xs;
})();
const Swatches: React.FC = () => {
  const frame = useCurrentFrame();
  const n = sources.length;
  const cam = camAt(frame);
  const leaders = 1 - at(frame, 3.0, 0.45, GLIDE);
  const t = frame / FPS;
  return (
    <>
      {sources.map((s: any, i: number) => {
        const hang = { x: hangX[i], y: 58 + (i % 2) * 26 };
        const u = 0.1 + (0.62 * i) / Math.max(1, n - 1);
        const fx = lerp(st.fascia[0][0], st.fascia[1][0], u);
        const fy = lerp(lerp(st.fascia[0][1], st.fascia[1][1], u), lerp(st.fascia[3][1], st.fascia[2][1], u), 0.5);
        const target = project(cam, fx, fy);
        const p = at(frame, 3.05 + i * STAGGER * 1.4, 2.6);
        const drift = 6 * (1 - p);
        const x = lerp(hang.x, target.x - SW / 2, p) + drift * Math.sin(t * 0.7 + i);
        const y = lerp(hang.y, target.y - SW / 2, p) + drift * Math.cos(t * 0.6 + i * 1.3);
        const fade = 1 - at(frame, 5.2 + i * 0.08, 1.1, GLIDE);
        if (fade <= 0) return null;
        const lift = 1 - p;
        const scale = (1 + 0.035 * lift) * (1 - 0.5 * at(frame, 4.7 + i * 0.08, 1.4));
        return (
          <React.Fragment key={s.hex}>
            {leaders > 0 ? (
              <svg style={{ position: 'absolute', left: 0, top: 0, width: 1920, height: 1080, overflow: 'visible', opacity: leaders }}>
                <line x1={x + SW / 2} y1={y + SW + 32} x2={s.at.x} y2={s.at.y} stroke={PAPER} strokeWidth={4} opacity={0.75} />
                <line x1={x + SW / 2} y1={y + SW + 32} x2={s.at.x} y2={s.at.y} stroke={INK} strokeWidth={1.5} />
                <circle cx={s.at.x} cy={s.at.y} r={9} fill="none" stroke={PAPER} strokeWidth={4} />
                <circle cx={s.at.x} cy={s.at.y} r={9} fill="none" stroke={INK} strokeWidth={1.75} />
              </svg>
            ) : null}
            <div style={{ position: 'absolute', left: x, top: y, width: SW, opacity: fade, transform: `scale(${scale})`, transformOrigin: `${SW / 2}px ${SW / 2}px`,
              filter: `drop-shadow(0 ${14 * lift}px ${22 * lift}px rgba(20,18,15,${0.16 * lift}))` }}>
              <div style={{ width: SW, height: SW, background: s.hex, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.08)' }} />
              <div style={{ fontFamily: MONO, fontSize: 15, letterSpacing: '0.08em', color: GREY, marginTop: 9, opacity: leaders }}>{s.hex}</div>
            </div>
          </React.Fragment>
        );
      })}
    </>
  );
};

/* -------------------------------------------------------------- slider */

const SCALE = 0.6;
const SCREEN = { x: (1920 - 960 * 2 * SCALE) / 2, y: 112, w: 960 * 2 * SCALE, h: 540 * 2 * SCALE };
const home = C.home;
const first = home.frames[0];
const P = first.parts;
const onScreen = (b: { x: number; y: number }) => ({ x: SCREEN.x + b.x * 2 * SCALE, y: SCREEN.y + b.y * 2 * SCALE });
const thumbBox = { x: P.range.x, y: P.range.y + 6, w: 26, h: P.range.h - 12 };
const trackBox = { x: P.range.x + 26, y: P.range.y + 6, w: P.range.w - 26, h: P.range.h - 12 };
const PARTS = [
  { key: 'strip', label: 'Strip', box: P.strip || P.stage, from: { x: 170, y: 250 }, labelAt: { x: 150, y: 210 } },
  { key: 'track', label: 'Track', box: trackBox, from: { x: 1080, y: 150 }, labelAt: { x: 1560, y: 120 } },
  { key: 'thumb', label: 'Thumb', box: thumbBox, from: { x: 980, y: 260 }, labelAt: { x: 900, y: 330 } },
  ...P.ticks.map((t: any, i: number) => ({ key: `tick${i}`, label: i === 0 ? 'Tick' : '', box: t, from: { x: 1040 + i * 230, y: 420 + (i % 2) * 40 }, labelAt: { x: 1000, y: 520 } })),
  { key: 'price', label: 'Price', box: P.price, from: { x: 1120, y: 640 }, labelAt: { x: 1560, y: 760 } },
];

const Slider: React.FC = () => {
  const frame = useCurrentFrame();
  const show = at(frame, 11.7, 0.6, GLIDE);
  if (show <= 0) return null;
  const capIn = at(frame, 13.8, 0.3, GLIDE);
  /* 80 to 240 cm: the real block, one capture per ten centimetres. */
  const run = at(frame, 14.2, 2.4, GLIDE) * (home.frames.length - 1);
  const i0 = Math.floor(run), i1 = Math.min(home.frames.length - 1, i0 + 1), mix = run - i0;
  return (
    <>
      <Laptop x={SCREEN.x} y={SCREEN.y} w={SCREEN.w} h={SCREEN.h} opacity={at(frame, 12.3, 1.0, GLIDE)} />
      {capIn < 1 ? PARTS.map((p, i) => (
        <Part key={p.key} from={p.from} to={onScreen(p.box)} w={p.box.w * 2 * SCALE} h={p.box.h * 2 * SCALE}
          start={12.55 + i * STAGGER} dur={0.85} label={p.label || undefined} labelAt={p.labelAt} labelOut={12.4} opacity={show * (1 - capIn)}>
          <Crop src={first.image} img={{ w: home.w, h: home.h }} box={p.box} scale={SCALE} />
        </Part>
      )) : null}
      {capIn > 0 ? (
        <>
          <Capture src={home.frames[i0].image} x={SCREEN.x} y={SCREEN.y} w={home.w} h={home.h} scale={SCALE} opacity={capIn} />
          {mix > 0 ? <Capture src={home.frames[i1].image} x={SCREEN.x} y={SCREEN.y} w={home.w} h={home.h} scale={SCALE} opacity={capIn * mix} /> : null}
        </>
      ) : null}
    </>
  );
};

export const Film1: React.FC = () => {
  const frame = useCurrentFrame();
  const F = film(ID);
  const b = [0, 1, 2, 3].map((i) => beat(ID, i));
  const corner = at(frame, 8.4, 0.6) * (1 - at(frame, 11.4, 0.5, GLIDE));
  return (
    <Paper>
      <Street />
      <Swatches />
      {corner > 0 ? <Label text={b[2].corner} size={22} color={INK} style={{ position: 'absolute', right: 120, top: 172, opacity: corner }} /> : null}
      <Slider />
      <Beat from={b[0].at} to={b[0].to} text={b[0].type} size={96} y={1006} />
      <Beat from={b[1].at} to={b[1].to} text={b[1].type} y={1006} />
      <Beat from={b[2].at} to={b[2].to} text={b[2].type} y={1006} />
      <Beat from={b[3].at} to={b[3].to} text={b[3].type} y={1006} />
      <EndCard from={F.duration - 3.0} url={F.end} />
    </Paper>
  );
};
