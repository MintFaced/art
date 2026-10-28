/* Film 2 · How TAO works (FILMS.md).
 *
 * One real collector, the works they hold, and their TAO climbing the way it
 * actually does: every day, 69 from each 1/1 and 4.2 from each edition copy.
 * The counter is their real figure on the snapshot's day, wound back the
 * number of days the ticks show, so it lands exactly on it. Then what they
 * weighed streams off it into the colour they backed (weighed, never spent:
 * the total does not fall), the other real backers join with theirs, and it
 * all assembles into the real card.
 */
import React from 'react';
import { Img, staticFile, useCurrentFrame } from 'remotion';
import { S, C, film, beat } from './data';
import { Paper, Beat, Label, Hex, Capture, Crop, EndCard, at, keys, lerp, f, FPS, GLIDE, INK, GREY, RULE, MONO, SANS, nz, placer, STAGGER } from './ui';

const ID = '02-tao';
const fr = S.front;
const DAYS = 14;
const R1 = S.rates.unique_per_day;
const RE = S.rates.edition_copy_per_day;
const uniques = fr.works.filter((w: any) => w.unique);
const editions = fr.works.filter((w: any) => !w.unique);
const perDayU = fr.one_of_ones * R1;
const perDayE = Math.round((fr.rate - perDayU) * 10) / 10;
const START = fr.tao - DAYS * fr.rate;

const HEX = { cx: 470, cy: 420, s: 250 };
const CARDW = 128;
const CARD = { x: 828, y: 64, scale: 0.72 };
const at2 = placer(CARD.x, CARD.y, CARD.scale);
const card = C.card;
const cardImg = { w: card.w, h: card.h };

/* The works round the face, kept to the left half. */
const orbit = (i: number, n: number) => {
  const a = -Math.PI / 2 + (i / n) * Math.PI * 2 + 0.4;
  return { x: HEX.cx + Math.cos(a) * 300 - CARDW / 2, y: HEX.cy + Math.sin(a) * 280 - CARDW / 2 - 10 };
};

/* The total: on the right while it climbs, then to the left as it is weighed. */
const counterAt = (frame: number) => keys(frame, [[0, { x: 1010, y: 300, s: 150 }], [11.0, { x: 1010, y: 300, s: 150 }], [11.9, { x: 120, y: 170, s: 96 }]]);
const TILE = { x: 1250, y: 150, s: 112 };
const BAR = { x: 1250, y: 318, w: 560, h: 12 };
const days = (t0: number, t1: number, frame: number) => DAYS * at(frame, t0, t1 - t0, (x) => x);

const Counter: React.FC = () => {
  const frame = useCurrentFrame();
  const d1 = days(3.1, 7.9, frame);
  const d2 = days(8.1, 10.9, frame);
  const v = frame >= f(10.95) ? fr.tao : START + perDayU * Math.floor(d1) + perDayE * Math.floor(d2);
  const c = counterAt(frame);
  const fade = 1 - at(frame, 15.0, 0.5, GLIDE);
  const date = new Date(Date.parse(S.taken_at) - (DAYS - Math.floor(Math.max(d1, d2))) * 86400000);
  const when = Math.max(d1, d2) >= DAYS ? 'today' : date.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' });
  const weighed = at(frame, 11.4, 0.4, GLIDE);
  return (
    <div style={{ position: 'absolute', left: c.x, top: c.y, opacity: fade }}>
      <div style={{ fontFamily: SANS, fontWeight: 500, fontSize: c.s, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums', color: INK, lineHeight: 1 }}>{nz(v)}</div>
      <Label text={weighed > 0.5 ? `TAO · weighed, never spent` : `TAO · ${fr.name} · ${when}`} size={22} style={{ marginTop: 20 }} />
    </div>
  );
};

/* A day's units falling from each work into the total. */
const Units: React.FC<{ from: number; to: number; works: any[]; size: number; color: string }> = ({ from, to, works, size, color }) => {
  const frame = useCurrentFrame();
  const out: React.ReactNode[] = [];
  const step = (to - from) / DAYS;
  const c = counterAt(frame);
  for (let d = 0; d < DAYS; d++) {
    const t0 = from + d * step;
    works.forEach((w, i) => {
      const p = at(frame, t0 + i * 0.03, 0.6, GLIDE);
      if (p <= 0 || p >= 1) return;
      const o = orbit(fr.works.indexOf(w), fr.works.length);
      const sx = o.x + CARDW / 2, sy = o.y + CARDW / 2;
      const ex = c.x + 30 + (d % 7) * 40, ey = c.y + 80;
      const x = lerp(sx, ex, p), y = lerp(sy, ey, p) - Math.sin(p * Math.PI) * 70;
      out.push(<div key={`${d}-${i}`} style={{ position: 'absolute', left: x - size / 2, top: y - size / 2, width: size, height: size, background: color, opacity: 1 - p * 0.5 }} />);
    });
  }
  return <>{out}</>;
};

const Ticks: React.FC = () => {
  const frame = useCurrentFrame();
  const shown = Math.max(days(3.1, 7.9, frame), days(8.1, 10.9, frame));
  const o = at(frame, 2.9, 0.4, GLIDE) * (1 - at(frame, 10.9, 0.5, GLIDE));
  if (o <= 0) return null;
  return (
    <div style={{ position: 'absolute', left: 1012, top: 530, opacity: o, display: 'flex', gap: 16, alignItems: 'flex-end' }}>
      {Array.from({ length: DAYS }, (_, i) => (
        <div key={i} style={{ width: 3, height: i < shown ? 34 : 16, background: i < shown ? INK : RULE }} />
      ))}
      <Label text={`${DAYS} days`} size={18} style={{ marginLeft: 12 }} />
    </div>
  );
};

const Works: React.FC = () => {
  const frame = useCurrentFrame();
  const edFocus = at(frame, 8.0, 0.5);
  const leave = at(frame, 10.9, 0.7, GLIDE);
  if (leave >= 1) return null;
  const t = frame / FPS;
  return (
    <>
      {fr.works.map((w: any, i: number) => {
        const o = orbit(i, fr.works.length);
        const dx = 7 * Math.sin(t * 0.6 + i), dy = 7 * Math.cos(t * 0.5 + i * 1.7);
        const dim = w.unique ? 1 - 0.6 * edFocus * (1 - at(frame, 10.6, 0.3)) : 1;
        const lift = w.unique ? 1 : 1 + 0.7 * edFocus;
        return (
          <div key={w.id} style={{ position: 'absolute', left: o.x + dx, top: o.y + dy - leave * 40, width: CARDW, opacity: dim * (1 - leave),
            filter: `drop-shadow(0 ${12 * lift}px ${20 * lift}px rgba(20,18,15,${0.14 * lift}))` }}>
            {w.image ? <Img src={staticFile(w.image)} style={{ width: CARDW, height: CARDW, objectFit: 'cover', display: 'block', background: '#fff' }} /> : null}
            <Label text={w.unique ? `1/1 · ${R1} a day` : `Edition · ${RE}`} size={13} color={INK} style={{ marginTop: 8, letterSpacing: '0.1em' }} />
          </div>
        );
      })}
    </>
  );
};

const Face: React.FC = () => {
  const frame = useCurrentFrame();
  const leave = at(frame, 11.25, 0.4, GLIDE);
  if (leave >= 1) return null;
  return (
    <>
      <Hex src={fr.face} size={HEX.s} style={{ left: HEX.cx - HEX.s / 2, top: HEX.cy - HEX.s / 2, opacity: 1 - leave, filter: 'drop-shadow(0 18px 28px rgba(20,18,15,.14))' }} />
      <div style={{ position: 'absolute', left: HEX.cx - 200, top: HEX.cy + HEX.s / 2 + 22, width: 400, textAlign: 'center', fontFamily: SANS, fontSize: 30, color: INK, opacity: 1 - leave }}>{fr.name}</div>
    </>
  );
};

/* -------------------------------------------- weight, and the real card */

const board = S.board;
const lead = board.candidates.find((c: any) => c.hex === (board.locked ? board.locked.hex : board.candidates[0].hex));
const backers = board.ledger.filter((r: any) => !r.artist && r.candidate === lead.hex);
const ordered = [backers.find((r: any) => r.address === fr.address), ...backers.filter((r: any) => r.address !== fr.address)].filter(Boolean);
const faceOf = (a: string) => (board.candidates.flatMap((c: any) => c.wallets).find((w: any) => w.address === a) || {}).face || null;
const rowFor = (name: string) => card.rows.findIndex((r: any) => r.name === name);
const total = backers.reduce((a: number, r: any) => a + r.amount, 0);
const ASM = 14.3;

/* What streams off the total: the TAO they weighed, in units, to the tile. */
const Stream: React.FC = () => {
  const frame = useCurrentFrame();
  const c = counterAt(frame);
  const out: React.ReactNode[] = [];
  for (let k = 0; k < 22; k++) {
    const p = at(frame, 11.5 + k * 0.05, 0.7, GLIDE);
    if (p <= 0 || p >= 1) continue;
    const sx = c.x + 60 + (k % 6) * 46, sy = c.y + 50;
    const ex = TILE.x + TILE.s / 2, ey = TILE.y + TILE.s / 2;
    out.push(<div key={k} style={{ position: 'absolute', left: lerp(sx, ex, p) - 5, top: lerp(sy, ey, p) - Math.sin(p * Math.PI) * 90 - 5, width: 10, height: 10, background: INK, opacity: 1 - p * 0.3 }} />);
  }
  return <>{out}</>;
};

const Weight: React.FC = () => {
  const frame = useCurrentFrame();
  const show = at(frame, 11.2, 0.5, GLIDE);
  if (show <= 0) return null;
  const a = at(frame, ASM, 1.1);
  const capIn = at(frame, 15.65, 0.35, GLIDE);
  let acc = 0;
  const segs = ordered.map((r: any, i: number) => {
    const t0 = i === 0 ? 11.5 : 12.75 + (i - 1) * 0.45;
    const grow = at(frame, t0 + (i === 0 ? 0.5 : 0.25), i === 0 ? 1.0 : 0.55);
    const s = { r, x0: acc, w: r.amount * grow, t0 };
    acc += r.amount * grow;
    return s;
  });
  /* The bar runs to whichever is larger, the threshold or the total, as the
     card's does; then it takes the card's place for it. */
  const span = Math.max(total, board.rule.tao);
  const fillAt = at2(card.bars.fills[1].track);
  const bx = lerp(BAR.x, fillAt.x, a), by = lerp(BAR.y, fillAt.y, a), bw = lerp(BAR.w, fillAt.w, a), bh = lerp(BAR.h, fillAt.h, a);
  const dot = at2(card.rows[0].dots[0]);
  const tx = lerp(TILE.x, dot.x, a), ty = lerp(TILE.y, dot.y, a), ts = lerp(TILE.s, dot.w, a);
  return (
    <div style={{ opacity: show * (1 - capIn) }}>
      <div style={{ position: 'absolute', left: tx, top: ty, width: ts, height: ts, background: lead.hex,
        filter: `drop-shadow(0 ${12 * (1 - a)}px ${20 * (1 - a)}px rgba(20,18,15,${0.15 * (1 - a)}))` }} />
      <Label text={`${lead.hex} · Nudge #${board.number}`} size={18} color={INK} style={{ position: 'absolute', left: TILE.x + TILE.s + 24, top: TILE.y + 6, opacity: 1 - at(frame, ASM, 0.3) }} />
      <div style={{ position: 'absolute', left: bx, top: by, width: bw, height: bh, background: RULE }}>
        {segs.map((s: any, i: number) => (
          <div key={i} style={{ position: 'absolute', left: (s.x0 / span) * bw, top: 0, width: (s.w / span) * bw + 0.5, height: bh, background: INK }} />
        ))}
      </div>
      {segs.map((s: any, i: number) => {
        const row = card.rows[rowFor(s.r.name)];
        if (!row) return null;
        const arrive = at(frame, s.t0, 0.75);
        const start = i === 0 ? { x: HEX.cx - HEX.s / 2, y: HEX.cy - HEX.s / 2 } : { x: 1980, y: 380 + i * 120 };
        const near = { x: BAR.x, y: BAR.y + 42 + i * 74 };
        const face = at2(row.face);
        const land = at(frame, ASM + 0.05 + i * STAGGER, 1.0);
        const x = lerp(lerp(start.x, near.x, arrive), face.x, land);
        const y = lerp(lerp(start.y, near.y, arrive), face.y, land);
        const size = lerp(i === 0 ? lerp(HEX.s, 50, arrive) : 50, face.w, land);
        const counted = Math.round(s.r.amount * at(frame, s.t0 + 0.4, i === 0 ? 1.0 : 0.55));
        return (
          <React.Fragment key={s.r.address}>
            <Hex src={faceOf(s.r.address)} size={size} style={{ left: x, top: y }} />
            <div style={{ position: 'absolute', left: near.x + 70, top: near.y + 10, fontFamily: MONO, fontSize: 24, color: INK,
              opacity: arrive * (1 - at(frame, ASM, 0.35)), whiteSpace: 'nowrap' }}>{s.r.name} · {nz(counted)} TAO</div>
          </React.Fragment>
        );
      })}
    </div>
  );
};

/* The rest of the real card, coming in round what was assembled: the words
   as cut from the capture, the voters bar drawn, then the capture itself. */
const CardRest: React.FC = () => {
  const frame = useCurrentFrame();
  const capIn = at(frame, 15.65, 0.35, GLIDE);
  if (frame < f(ASM)) return null;
  const words = [card.q, card.when, card.note, card.promise, ...card.bars.labels.filter((l: any) => /[A-Z]{2}/.test(l.text) || / OF /.test(l.text)), card.tally, card.head,
    ...card.rows.map((r: any) => ({ x: r.nameBox.x - 2, y: r.box.y + 1, w: r.box.x + r.box.w - r.nameBox.x, h: r.box.h - 2 })),
    ...card.rows.slice(1).map((r: any) => ({ x: r.box.x, y: r.box.y + 1, w: 40, h: r.box.h - 2 })),
    ...card.rows.filter((r: any) => !ordered.some((o: any) => o.name === r.name)).map((r: any) => ({ x: r.face.x - 1, y: r.face.y - 1, w: r.face.w + 2, h: r.face.h + 2 }))].filter(Boolean);
  const voters = at2(card.bars.fills[0].track), vfill = card.bars.fills[0].fill.w / card.bars.fills[0].track.w;
  const vp = at(frame, ASM + 0.3, 0.9);
  return (
    <>
      <div style={{ position: 'absolute', left: voters.x, top: voters.y, width: voters.w, height: voters.h, background: RULE, opacity: vp * (1 - capIn) }}>
        <div style={{ width: voters.w * vfill * vp, height: voters.h, background: INK }} />
      </div>
      {words.map((b: any, i: number) => {
        const p = at(frame, ASM + 0.15 + i * STAGGER * 0.5, 0.8);
        const pos = at2(b);
        return (
          <div key={i} style={{ position: 'absolute', left: pos.x, top: pos.y + (1 - p) * 20, opacity: p * (1 - capIn) }}>
            <Crop src={card.image} img={cardImg} box={b} scale={CARD.scale} />
          </div>
        );
      })}
      <Capture src={card.image} x={CARD.x} y={CARD.y} w={card.w} h={card.h} scale={CARD.scale} opacity={capIn} />
    </>
  );
};

export const Film2: React.FC = () => {
  const F = film(ID);
  const b = [0, 1, 2, 3].map((i) => beat(ID, i));
  return (
    <Paper>
      <Works />
      <Units from={3.1} to={7.9} works={uniques} size={10} color={INK} />
      <Units from={8.1} to={10.9} works={editions} size={6} color={GREY} />
      <Face />
      <Counter />
      <Ticks />
      <Stream />
      <CardRest />
      <Weight />
      <Beat from={b[0].at} to={b[0].to} text={b[0].type} label={b[0].label} size={96} y={960} />
      <Beat from={b[1].at} to={b[1].to} text={b[1].type} y={1006} />
      <Beat from={b[2].at} to={b[2].to} text={b[2].type} y={1006} />
      <Beat from={b[3].at} to={b[3].to} text={b[3].type} y={1006} />
      <EndCard from={F.duration - 3.0} url={F.end} />
    </Paper>
  );
};
