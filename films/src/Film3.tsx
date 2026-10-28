/* Film 3 · The collectors (FILMS.md).
 *
 * A hundred real faces, scattered; then rank order by TAO, rows forming top
 * down into the real register. The top four, one at a time: face, name, TAO,
 * and what each has held longest. Then a face held down on the register
 * itself, turning into what they have kept, as the register does it.
 */
import React from 'react';
import { Img, staticFile, useCurrentFrame } from 'remotion';
import { S, C, SCRIPT, film, beat } from './data';
import { Paper, Beat, Label, Hex, Capture, Crop, EndCard, Veil, at, lerp, f, FPS, GLIDE, SETTLE, INK, GREY, PAPER, MONO, SANS, nz, rnd } from './ui';

const ID = '03-collectors';
const reg = C.register;
const regImg = { w: reg.w, h: reg.h };
const top = S.top;
const FEAT = top.slice(0, SCRIPT.featured_count);

/* Where each rank's face sits in the register capture (CSS px), extrapolated
   down the page past the rows the capture measured. */
const rows = reg.rows;
const pitch = rows.length > 1 ? (rows[rows.length - 1].face.y - rows[0].face.y) / (rows.length - 1) : 52;
const faceBox = (rank: number) => {
  const r = rows[rank - 1];
  if (r && r.face) return r.face;
  const last = rows[rows.length - 1].face;
  return { x: last.x, y: last.y + (rank - rows.length) * pitch, w: last.w, h: last.h };
};
const K = 2; /* the capture is 960 CSS px at DPR 2: 1:1 with the film */

/* Loose depth across the frame, clear of the title's corner. */
const scatter = (i: number) => {
  const z = 0.55 + rnd(i, 3) * 0.95;
  for (let k = 0; k < 12; k++) {
    const x = 60 + rnd(i, 1 + k * 7) * 1720, y = 40 + rnd(i, 2 + k * 7) * 900;
    if (!(x < 980 && y > 790)) return { x, y, z };
  }
  return { x: 1100 + rnd(i, 99) * 600, y: 100 + rnd(i, 98) * 600, z };
};
const byDepth = top.map((c: any, i: number) => ({ c, i, s: scatter(i) })).sort((a: any, b: any) => a.s.z - b.s.z);

const Faces: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const toRegister = at(frame, 9.0, 0.5, GLIDE);
  return (
    <>
      {byDepth.map(({ c, i, s }: any) => {
        const go = 4.1 + Math.min(i, 30) * 0.045 + (i > 30 ? 0.3 : 0);
        const p = at(frame, go, 1.1);
        const box = faceBox(c.rank);
        const size0 = 46 * s.z * 1.5;
        const x0 = s.x + 22 * Math.sin(t * 0.25 + i), y0 = s.y + 16 * Math.cos(t * 0.21 + i * 0.7);
        const x = lerp(x0, box.x * K, p), y = lerp(y0, box.y * K, p);
        const size = lerp(size0, box.w * K, p);
        if (y > 1200 && p >= 1) return null;
        /* Depth: further ones are smaller and fainter, never blurred. */
        const o = lerp(0.35 + 0.65 * Math.min(1, s.z), 1, p) * (1 - toRegister);
        return <Hex key={c.address} src={c.face} size={size} style={{ left: x, top: y, opacity: o }} />;
      })}
    </>
  );
};

/* Numbers and names, fading in beside their faces as each row forms. */
const RowWords: React.FC = () => {
  const frame = useCurrentFrame();
  const capIn = at(frame, 8.4, 0.5, GLIDE);
  if (frame < f(4.6) || capIn >= 1) return null;
  return (
    <>
      {rows.map((r: any, i: number) => {
        const p = at(frame, 4.9 + i * 0.12, 0.6);
        const parts = [r.pos, r.nameBox, r.works, r.unique, r.tao].filter(Boolean);
        return parts.map((b: any, j: number) => (
          <div key={`${i}-${j}`} style={{ position: 'absolute', left: b.x * K, top: b.y * K + (1 - p) * 10, opacity: p * (1 - capIn) }}>
            <Crop src={reg.image} img={regImg} box={b} scale={1} />
          </div>
        ));
      })}
    </>
  );
};

/* The register, then the top four one at a time, then the hold. */
const Register: React.FC = () => {
  const frame = useCurrentFrame();
  const inP = at(frame, 8.4, 0.5, GLIDE);
  const away = at(frame, 9.0, 0.5, GLIDE) * (1 - at(frame, 13.9, 0.4, GLIDE));
  /* For the hold: in close on the first row. */
  const zoom = at(frame, 13.9, 0.9);
  const row = rows[SCRIPT.hold_rank - 1];
  const ox = row.face.x * K + row.face.w, oy = row.face.y * K + row.face.h;
  const s = lerp(1, 1.9, zoom);
  const holdIn = at(frame, 15.3, 0.45, GLIDE);
  const outline = at(frame, 14.75, 0.55, GLIDE) * (1 - holdIn);
  if (inP <= 0) return null;
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: inP * (1 - away), transformOrigin: `${ox}px ${oy}px`, transform: `scale(${s})` }}>
      <Capture src={reg.image4 || reg.image} x={0} y={0} w={reg.w} h={reg.h} scale={1} />
      {holdIn > 0 ? <Capture src={reg.hold.image4 || reg.hold.image} x={0} y={0} w={reg.w} h={reg.h} scale={1} opacity={holdIn} /> : null}
      {/* the outline drawing round the face as it is pressed, as the site draws it */}
      {outline > 0 ? (
        <svg viewBox="0 0 100 100" style={{ position: 'absolute', left: row.face.x * K - 1, top: row.face.y * K - 1, width: row.face.w * K + 2, height: row.face.h * K + 2, overflow: 'visible' }}>
          <polygon points="50,0 93.3,25 93.3,75 50,100 6.7,75 6.7,25" pathLength={100} fill="none" stroke={INK} strokeWidth={3} strokeDasharray={100} strokeDashoffset={100 - 100 * outline} />
        </svg>
      ) : null}
    </div>
  );
};

/* The top four, a beat each: face, name, TAO, longest held. */
const Featured: React.FC = () => {
  const frame = useCurrentFrame();
  const t0 = 9.3, each = 1.15;
  return (
    <>
      {FEAT.map((c: any, k: number) => {
        const from = t0 + k * each, to = from + each;
        const inP = at(frame, from, 0.5), outP = k === FEAT.length - 1 ? at(frame, 13.75, 0.35, GLIDE) : at(frame, to - 0.15, 0.35, GLIDE);
        const o = Math.min(inP, 1 - outP);
        if (o <= 0) return null;
        /* The first face comes out of its row; the rest arrive in place. */
        const box = faceBox(c.rank);
        const fly = k === 0 ? at(frame, 9.0, 0.8) : 1;
        const hx = lerp(box.x * K, 200, fly), hy = lerp(box.y * K, 230, fly), hs = lerp(box.w * K, 380, fly);
        const dx = (1 - inP) * 30 - outP * 30;
        return (
          <div key={c.address} style={{ position: 'absolute', inset: 0, opacity: k === 0 ? Math.min(1, fly * 3) * (1 - outP) : o }}>
            <Hex src={c.face} size={hs} style={{ left: hx + dx, top: hy, filter: 'drop-shadow(0 18px 28px rgba(20,18,15,.14))' }} />
            <div style={{ position: 'absolute', left: 680 + dx, top: 250 }}>
              <Label text={`No. ${c.rank}`} size={22} />
              <div style={{ fontFamily: SANS, fontWeight: 500, fontSize: 92, letterSpacing: '-0.03em', color: INK, marginTop: 14, whiteSpace: 'nowrap' }}>{c.name}</div>
              <div style={{ fontFamily: MONO, fontSize: 34, color: INK, marginTop: 18, letterSpacing: '0.02em' }}>{nz(c.tao)} TAO</div>
            </div>
            {c.held ? (
              <div style={{ position: 'absolute', left: 680 + dx * 1.4, top: 560, display: 'flex', alignItems: 'center', gap: 28 }}>
                {c.held.image ? <Img src={staticFile(c.held.image)} style={{ width: 150, height: 150, objectFit: 'cover', boxShadow: '0 12px 22px rgba(20,18,15,.12)' }} /> : null}
                <Label text={`Held ${nz(c.held.days)} days · ${String(c.held.label).replace(/#/g, '')}`} size={24} color={INK} />
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
};

export const Film3: React.FC = () => {
  const F = film(ID);
  const b = [0, 1, 2, 3].map((i) => beat(ID, i));
  return (
    <Paper>
      <Faces />
      <RowWords />
      <Register />
      <Featured />
      <Veil from={4.6} to={17.6} />
      <Beat from={b[0].at} to={b[0].to} text={b[0].type} size={96} y={1006} />
      <Beat from={b[1].at} to={b[1].to} text={b[1].type} y={1006} />
      <Beat from={b[3].at} to={b[3].to} text={b[3].type} y={1006} />
      <EndCard from={F.duration - 3.0} url={F.end} />
    </Paper>
  );
};
