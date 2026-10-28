/* Film 4 · MintFace Studio: nudges and weighing in (FILMS.md).
 *
 * The palette's pottles, exploded, then the five locked colours filling them
 * in the order they were chosen. A nudge in parts. Then the board's real
 * weigh-ins replaying from the ledger in the order they were signed, into the
 * real card. Then the room, from real posts. The lock rule is the one in force
 * since 28 Oct 2026: the most TAO at close locks.
 */
import React from 'react';
import { useCurrentFrame } from 'remotion';
import { S, C, SCRIPT, film, beat, fill } from './data';
import { Paper, Beat, Label, Hex, Capture, Crop, EndCard, Leader, Veil, at, lerp, f, FPS, GLIDE, INK, GREY, FAINT, RULE, PAPER, MONO, SANS, nz, placer, STAGGER, rnd } from './ui';

const ID = '04-studio';
const pots = C.pots;
const POTS = { x: 96, y: 150, scale: 1.2 };
const atPots = placer(POTS.x, POTS.y, POTS.scale);
const card = C.card;
const CARD = { x: 828, y: 64, scale: 0.72 };
const atCard = placer(CARD.x, CARD.y, CARD.scale);
const chat = C.chat;
const CHAT = { x: (1920 - chat.w * 2 * 0.9) / 2, y: 190, scale: 0.9 };
const atChat = placer(CHAT.x, CHAT.y, CHAT.scale);
const board = S.board;
const lockedBy = new Map(S.palette.map((p: any) => [p.slot, p]));

/* The site's pottle, path for path (studio.html). */
const Pot: React.FC<{ w: number; h: number; hex?: string | null; level?: number; line?: string; lineW?: number }> = ({ w, h, hex, level = 1, line = INK, lineW = 2 }) => (
  <svg viewBox="0 0 30 42" style={{ width: w, height: h, display: 'block', overflow: 'visible' }}>
    <defs><clipPath id={`lv${Math.round(level * 1000)}`}><rect x="0" y={10 + 28 * (1 - level)} width="30" height="42" /></clipPath></defs>
    {hex ? <path d="M6.5 10H23.5V35.5A2.5 2.5 0 0 1 21 38H9A2.5 2.5 0 0 1 6.5 35.5Z" fill={hex} clipPath={`url(#lv${Math.round(level * 1000)})`} /> : null}
    <path d="M4.5 10V5.5H25.5V10H4.5" fill="none" stroke={line} strokeWidth={lineW} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    <path d="M6.5 10V35.5A2.5 2.5 0 0 0 9 38H21A2.5 2.5 0 0 0 23.5 35.5V10" fill="none" stroke={line} strokeWidth={lineW} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
  </svg>
);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/* The day a colour locked, as the site writes dates: 21 Oct. In New Zealand. */
const shortDay = (iso: string) => {
  const d = new Date(new Date(iso).toLocaleString('en-US', { timeZone: 'Pacific/Auckland' }));
  return `${d.getDate()} ${MON[d.getMonth()]}`;
};

/* ---------------------------------------------------------------- pottles */
const Pottles: React.FC = () => {
  const frame = useCurrentFrame();
  const asm = (i: number) => at(frame, 3.0 + i * STAGGER, 0.85);
  const capIn = at(frame, 6.55, 0.35, GLIDE);
  const out = at(frame, 7.0, 0.45, GLIDE);
  if (out >= 1) return null;
  const t = frame / FPS;
  return (
    <div style={{ opacity: 1 - out }}>
      {pots.pots.map((p: any, i: number) => {
        const slot = i + 1;
        const lock: any = lockedBy.get(slot);
        const to = atPots(p.svg);
        const a = asm(i);
        /* Exploded: a loose arc across the frame, lifted. */
        const ex = { x: 150 + i * 138 + (rnd(i, 4) - 0.5) * 40, y: 250 + Math.sin(i * 0.55) * 90 + (rnd(i, 5) - 0.5) * 50 };
        const drift = 6 * (1 - a);
        const x = lerp(ex.x, to.x, a) + drift * Math.sin(t * 0.7 + i), y = lerp(ex.y, to.y, a) + drift * Math.cos(t * 0.6 + i);
        const w = lerp(to.w * 1.0, to.w, a), h = lerp(to.h, to.h, a);
        /* History: drained as they line up, then filled in lock order. */
        const fillAt = 3.75 + (slot - 1) * 0.55;
        const level = lock ? (frame < f(3.0) ? 1 : Math.max(1 - at(frame, 3.1, 0.35), at(frame, fillAt + 0.25, 0.4))) : 0;
        const state = lock ? 'filled' : (S.open && S.open.slot === slot ? 'live' : 'empty');
        const line = state === 'empty' ? RULE : INK;
        const lift = 1 - a;
        return (
          <React.Fragment key={slot}>
            <div style={{ position: 'absolute', left: x, top: y, opacity: 1 - capIn, filter: lift > 0.01 ? `drop-shadow(0 ${14 * lift}px ${20 * lift}px rgba(20,18,15,${0.14 * lift}))` : 'none' }}>
              <Pot w={w} h={h} hex={lock ? lock.hex : null} level={level} line={line} lineW={2.4} />
            </div>
            {/* labels while exploded: number and lock date */}
            {lift > 0 ? (
              <div style={{ position: 'absolute', left: x - 30, top: y + h + 14, width: w + 60, textAlign: 'center', opacity: lift * (state === 'empty' ? 0.6 : 1) }}>
                <Label text={lock ? `#${slot} · ${shortDay(lock.locked_at)}` : (state === 'live' ? `Slot ${slot} · open` : String(slot).padStart(2, '0'))} size={15}
                  color={state === 'empty' ? FAINT : INK} style={{ letterSpacing: '0.08em' }} />
              </div>
            ) : null}
            {/* the colour arriving, as a tile, then its backers counting */}
            {lock ? (() => {
              const drop = at(frame, fillAt - 0.2, 0.45);
              const vis = drop > 0 && drop < 1;
              const count = Math.round(lock.backers * at(frame, fillAt + 0.25, 0.4));
              const co = at(frame, fillAt + 0.2, 0.2) * (1 - at(frame, 6.3, 0.3, GLIDE));
              return (
                <>
                  {vis ? <div style={{ position: 'absolute', left: to.x + to.w * 0.25, top: lerp(to.y - 150, to.y + to.h * 0.3, drop), width: to.w * 0.5, height: to.w * 0.5, background: lock.hex, opacity: 1 - drop * 0.8 }} /> : null}
                  {co > 0 ? <Label text={`${count} backer${count === 1 ? '' : 's'}`} size={15} color={INK} style={{ position: 'absolute', left: to.x - 20, width: to.w + 40, textAlign: 'center', top: to.y - 46, opacity: co, letterSpacing: '0.06em' }} /> : null}
                </>
              );
            })() : null}
          </React.Fragment>
        );
      })}
      {capIn > 0 ? <Capture src={pots.image} x={POTS.x} y={POTS.y} w={pots.w} h={pots.h} scale={POTS.scale} opacity={capIn} /> : null}
    </div>
  );
};

/* ------------------------------------------------------------ the board */
const lead = board.candidates.find((c: any) => c.hex === (board.locked ? board.locked.hex : board.candidates[0].hex));
const other = board.candidates.find((c: any) => c !== lead);
const faceOf = (a: string) => (board.candidates.flatMap((c: any) => c.wallets).find((w: any) => w.address === a) || {}).face || null;
const rowOf = (name: string) => card.rows.find((r: any) => r.name === name);
const T = { lead: { x: 700, y: 260, s: 120 }, other: { x: 700, y: 520, s: 120 } };
const DOTS = { x: 1180, y: 290, gap: 46, r: 13 };
const BARS = { x: 1180, y: 420, w: 600 };
const Q = { x: 120, y: 120 };
const R0 = 10.25, STEP = 0.46;
const ASM = 13.75;
const ledger = board.ledger.map((r: any, i: number) => ({ ...r, t: R0 + i * STEP }));
const span = Math.max(lead.total, board.rule.tao);

const Board: React.FC = () => {
  const frame = useCurrentFrame();
  const show = at(frame, 7.05, 0.5, GLIDE);
  if (show <= 0) return null;
  const a = at(frame, ASM, 1.0);
  const capIn = at(frame, 14.75, 0.35, GLIDE);
  const out = at(frame, 15.05, 0.4, GLIDE);
  if (out >= 1) return null;
  const parts = at(frame, 7.1, 0.6);
  const lab = 1 - at(frame, 10.0, 0.3, GLIDE);
  /* What the board has taken so far, collectors only. */
  let voters = 0, tao = 0;
  const landed = ledger.map((r: any) => {
    const p = at(frame, r.t, 0.5);
    if (p >= 1 && !r.artist && r.candidate === lead.hex) { voters += 1; tao += r.amount; }
    return p;
  });
  const growing = ledger.find((r: any) => frame >= f(r.t) && frame < f(r.t + 0.5) && !r.artist && r.candidate === lead.hex);
  if (growing) tao += growing.amount * at(frame, growing.t, 0.5);
  /* parts' assembled places in the card */
  const vT = atCard(card.bars.fills[0].track), tT = atCard(card.bars.fills[1].track);
  const qA = atCard(card.q);
  const lift = (1 - parts) * 0 + (1 - a);
  const sh = (l: number) => (l > 0.01 ? `drop-shadow(0 ${12 * l}px ${20 * l}px rgba(20,18,15,${0.14 * l}))` : 'none');
  const tiles = [{ c: lead, at: T.lead, dot: atCard(card.rows[0].dots[0]) }, { c: other, at: T.other, dot: atCard((rowOf('burnasso.eth') || card.rows[3]).dots[1] || card.rows[3].dots[0]) }].filter((x) => x.c);
  const vFill = Math.min(1, voters / board.rule.voters);
  const tFill = Math.min(1, tao / board.rule.tao);
  return (
    <div style={{ opacity: show * (1 - out) }}>
      <div style={{ opacity: 1 - capIn }}>
        {/* NUDGE: the question as asked, cut from the card */}
        <div style={{ position: 'absolute', left: lerp(Q.x, qA.x, a), top: lerp(Q.y, qA.y, a), filter: sh(1 - a), transform: `scale(${lerp(1.6, 1, a)})`, transformOrigin: '0 0' }}>
          <Crop src={card.image} img={{ w: card.w, h: card.h }} box={card.q} scale={CARD.scale} />
        </div>
        {lab > 0 ? <Leader from={{ x: Q.x + 240, y: Q.y + 60 }} to={{ x: Q.x + 300, y: Q.y + 130 }} label="Nudge" opacity={lab * parts} /> : null}
        {/* TILE: the colours collectors put up */}
        {tiles.map((tl, i) => {
          const x = lerp(tl.at.x, tl.dot.x, a), y = lerp(tl.at.y, tl.dot.y, a), s = lerp(tl.at.s, tl.dot.w, a);
          return (
            <React.Fragment key={tl.c.hex}>
              <div style={{ position: 'absolute', left: x, top: y, width: s, height: s, background: tl.c.hex, filter: sh(1 - a), opacity: parts }} />
              {a < 0.3 ? <Label text={tl.c.hex} size={16} style={{ position: 'absolute', left: tl.at.x, top: tl.at.y + tl.at.s + 12, opacity: parts * (1 - a / 0.3) }} /> : null}
            </React.Fragment>
          );
        })}
        {lab > 0 ? <Leader from={{ x: T.lead.x + T.lead.s, y: T.lead.y + 20 }} to={{ x: T.lead.x + T.lead.s + 90, y: T.lead.y - 50 }} label="Tile" opacity={lab * parts} /> : null}
        {/* DOT: one per collector the leader needs */}
        {Array.from({ length: board.rule.voters }, (_, i) => {
          const on = i < voters;
          const dx = DOTS.x + i * DOTS.gap;
          const o = parts * (1 - at(frame, ASM, 0.5, GLIDE));
          return <div key={i} style={{ position: 'absolute', left: dx - DOTS.r, top: DOTS.y - DOTS.r, width: DOTS.r * 2, height: DOTS.r * 2, borderRadius: '50%',
            border: `2px solid ${on ? INK : FAINT}`, background: on ? INK : 'transparent', opacity: o, filter: sh(1 - a) }} />;
        })}
        {lab > 0 ? <Leader from={{ x: DOTS.x + DOTS.gap * 2, y: DOTS.y - 16 }} to={{ x: DOTS.x + DOTS.gap * 3, y: DOTS.y - 90 }} label="Dot" opacity={lab * parts} /> : null}
        {/* WEIGHT: voters and TAO on the leader, filling as they land */}
        {[{ y: BARS.y, fill: vFill, to: vT, name: 'Voters' }, { y: BARS.y + 70, fill: tFill, to: tT, name: 'TAO on the leader' }].map((b, i) => (
          <div key={i} style={{ position: 'absolute', left: lerp(BARS.x, b.to.x, a), top: lerp(b.y, b.to.y, a), width: lerp(BARS.w, b.to.w, a), height: lerp(8, b.to.h, a),
            background: RULE, opacity: parts, filter: sh(1 - a) }}>
            <div style={{ width: `${b.fill * 100}%`, height: '100%', background: INK }} />
            {a < 0.3 ? <Label text={i === 0 ? `Voters ${voters} of ${board.rule.voters}` : `TAO on the leader ${nz(tao)}`} size={16} style={{ position: 'absolute', left: 0, top: -30, opacity: 1 - a / 0.3 }} /> : null}
          </div>
        ))}
        {lab > 0 ? <Leader from={{ x: BARS.x + BARS.w, y: BARS.y + 74 }} to={{ x: BARS.x + BARS.w + 20, y: BARS.y + 150 }} label="Weight" opacity={lab * parts} /> : null}
        {/* the weigh-ins, in the order they were signed */}
        {ledger.map((r: any, i: number) => {
          const p = landed[i];
          if (p <= 0) return null;
          const tile = r.candidate === lead.hex ? T.lead : T.other;
          const sameBefore = ledger.slice(0, i).filter((x: any) => x.candidate === r.candidate).length;
          const near = { x: tile.x + tile.s + 30 + sameBefore * 58, y: tile.y + tile.s - 52 };
          const start = { x: i % 2 ? 1980 : -80, y: 160 + rnd(i, 9) * 600 };
          const row = rowOf(r.name);
          /* each wallet lands once in the card, on its first row */
          const first = ledger.findIndex((x: any) => x.address === r.address) === i;
          const face = row ? atCard(row.face) : null;
          const k = first && face ? a : 0;
          const x = lerp(lerp(start.x, near.x, p), face ? face.x : near.x, k);
          const y = lerp(lerp(start.y, near.y, p), face ? face.y : near.y, k);
          const s = lerp(52, face ? face.w : 52, k);
          const gone = !first ? at(frame, ASM, 0.4, GLIDE) : 0;
          /* One line at a time, beside the tile: who, and what they put behind it. */
          const say = at(frame, r.t + 0.15, 0.12) * (1 - at(frame, r.t + STEP + 0.02, 0.12, GLIDE));
          return (
            <React.Fragment key={i}>
              <Hex src={faceOf(r.address)} size={s} style={{ left: x, top: y, opacity: 1 - gone }} />
              {say > 0 ? <Label text={r.artist ? `${r.name} · artist, not counted` : `${r.name} · +${nz(r.amount)} TAO`} size={18} color={INK}
                style={{ position: 'absolute', left: tile.x + tile.s + 30, top: tile.y + 8, opacity: say, letterSpacing: '0.06em' }} /> : null}
            </React.Fragment>
          );
        })}
      </div>
      <CardWords from={ASM} capIn={capIn} />
      {capIn > 0 ? <Capture src={card.image} x={CARD.x} y={CARD.y} w={card.w} h={card.h} scale={CARD.scale} opacity={capIn} /> : null}
    </div>
  );
};

/* The card's words, cut from the capture, settling in round the assembly. */
const CardWords: React.FC<{ from: number; capIn: number }> = ({ from, capIn }) => {
  const frame = useCurrentFrame();
  if (frame < f(from)) return null;
  const boxes = [card.when, card.note, card.promise, ...card.bars.labels.filter((l: any) => /[A-Z]{2}/.test(l.text) || / OF /.test(l.text)), card.tally, card.head,
    ...card.rows.map((r: any) => ({ x: r.nameBox.x - 2, y: r.box.y + 1, w: r.box.x + r.box.w - r.nameBox.x, h: r.box.h - 2 })),
    ...card.rows.map((r: any) => ({ x: r.box.x + 14, y: r.box.y + 1, w: 26, h: r.box.h - 2 }))].filter(Boolean);
  return (
    <>
      {boxes.map((b: any, i: number) => {
        const p = at(frame, from + 0.15 + i * STAGGER * 0.5, 0.8);
        const pos = atCard(b);
        return (
          <div key={i} style={{ position: 'absolute', left: pos.x, top: pos.y + (1 - p) * 20, opacity: p * (1 - capIn) }}>
            <Crop src={card.image} img={{ w: card.w, h: card.h }} box={b} scale={CARD.scale} />
          </div>
        );
      })}
    </>
  );
};

/* -------------------------------------------------------------- the room */
const Room: React.FC = () => {
  const frame = useCurrentFrame();
  const show = at(frame, 15.2, 0.3, GLIDE);
  if (show <= 0) return null;
  const capIn = at(frame, 16.3, 0.35, GLIDE);
  const out = at(frame, 16.75, 0.3, GLIDE);
  return (
    <div style={{ opacity: show * (1 - out) }}>
      {chat.posts.map((p: any, i: number) => {
        const a = at(frame, 15.2 + i * 0.28, 0.85);
        const to = atChat(p.box);
        const fromX = p.artist ? 1980 : -to.w - 60;
        const lift = 1 - a;
        return (
          <div key={p.n} style={{ position: 'absolute', left: lerp(fromX, to.x, a), top: to.y + lift * 30, opacity: 1 - capIn,
            filter: lift > 0.01 ? `drop-shadow(0 ${14 * lift}px ${22 * lift}px rgba(20,18,15,${0.16 * lift}))` : 'none' }}>
            <Crop src={chat.image} img={{ w: chat.w, h: chat.h }} box={p.box} scale={CHAT.scale} />
          </div>
        );
      })}
      {capIn > 0 ? <Capture src={chat.image} x={CHAT.x} y={CHAT.y} w={chat.w} h={chat.h} scale={CHAT.scale} opacity={capIn} /> : null}
    </div>
  );
};

/* ------------------------------------------------------------- the end */
const SHELF = { scale: 0.62 };
const End: React.FC<{ from: number }> = ({ from }) => {
  const frame = useCurrentFrame();
  const F = film(ID);
  const rule = (F.rule || []).map(fill);
  const shelf = pots.pots.reduce((b: any, p: any) => ({ x0: Math.min(b.x0, p.box.x), x1: Math.max(b.x1, p.box.x + p.box.w), y0: Math.min(b.y0, p.svg.y), y1: Math.max(b.y1, p.box.y + p.box.h) }), { x0: 1e9, x1: 0, y0: 1e9, y1: 0 });
  const box = { x: shelf.x0 - 4, y: shelf.y0 - 6, w: shelf.x1 - shelf.x0 + 8, h: shelf.y1 - shelf.y0 + 12 };
  const k = 2 * SHELF.scale;
  const left = 960 - (box.w * k) / 2, top = 214;
  const six = pots.pots.find((p: any) => p.state === 'live');
  const pulse = Math.sin(Math.PI * at(frame, from + 0.9, 0.9, (x) => x));
  return (
    <EndCard from={from} url={F.end} top={570}>
      <div style={{ position: 'absolute', left, top }}>
        <Crop src={pots.image} img={{ w: pots.w, h: pots.h }} box={box} scale={SHELF.scale} />
        {/* Slot 6, empty, pulses once: its own outline, drawn heavier and let go. */}
        {six ? (
          <div style={{ position: 'absolute', left: (six.svg.x - box.x) * k, top: (six.svg.y - box.y) * k, opacity: pulse, transform: `scale(${1 + 0.06 * pulse})`, transformOrigin: 'center' }}>
            <Pot w={six.svg.w * k} h={six.svg.h * k} line={INK} lineW={3.2} />
          </div>
        ) : null}
      </div>
      {rule.map((line: string, i: number) => (
        <Label key={i} text={line} size={i === 0 ? 24 : 18} color={i === 0 ? INK : GREY}
          style={{ position: 'absolute', top: 432 + i * 40, width: '100%', textAlign: 'center', letterSpacing: '0.14em' }} />
      ))}
    </EndCard>
  );
};

export const Film4: React.FC = () => {
  const F = film(ID);
  const b = [0, 1, 2, 3, 4].map((i) => beat(ID, i));
  return (
    <Paper>
      <Pottles />
      <Board />
      <Room />
      <Beat from={b[0].at} to={b[0].to} text={b[0].type} size={96} y={1006} />
      <Beat from={b[1].at} to={b[1].to} text={b[1].type} y={1006} />
      <Beat from={b[2].at} to={b[2].to} text={b[2].type} label={b[2].label} y={960} />
      <Beat from={b[3].at} to={b[3].to} text={b[3].type} label={b[3].label} y={960} />
      <Beat from={b[4].at} to={b[4].to} text={b[4].type} y={1006} />
      <End from={F.duration - 3.0} />
    </Paper>
  );
};
