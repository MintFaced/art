/* The 60-second cut (FILMS.md): the palette and MintFace; each film behind a
 * one-second chapter card, trimmed to its exploded open, its reconstruction
 * and its line; and the hundred faces pulling back to reveal the palette,
 * with one end card for both sites. The films are played from their own
 * timelines, so the cut can never say anything the films do not. */
import React from 'react';
import { AbsoluteFill, Img, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { S, C, film } from './data';
import { Paper, Label, Hex, Crop, EndCard, at, lerp, f, GLIDE, INK, rnd } from './ui';
import { Film1 } from './Film1';
import { Film2 } from './Film2';
import { Film3 } from './Film3';
import { Film4 } from './Film4';

const BY: Record<string, React.FC> = { '01-strips': Film1, '02-tao': Film2, '03-collectors': Film3, '04-studio': Film4 };
const CUT = film('00-mintface-60');
const FADE = 8;

/* The pottle shelf, cut from the Studio capture: the palette as the site has it. */
const pots = C.pots;
const shelf = pots.pots.reduce((b: any, p: any) => ({ x0: Math.min(b.x0, p.box.x), x1: Math.max(b.x1, p.box.x + p.box.w), y0: Math.min(b.y0, p.svg.y), y1: Math.max(b.y1, p.box.y + p.box.h) }), { x0: 1e9, x1: 0, y0: 1e9, y1: 0 });
const SHELF = { x: shelf.x0 - 4, y: shelf.y0 - 6, w: shelf.x1 - shelf.x0 + 8, h: shelf.y1 - shelf.y0 + 12 };
const Shelf: React.FC<{ scale: number; top: number; opacity?: number }> = ({ scale, top, opacity = 1 }) => (
  <div style={{ position: 'absolute', left: 960 - SHELF.w * scale, top, opacity }}>
    <Crop src={pots.image} img={{ w: pots.w, h: pots.h }} box={SHELF} scale={scale} />
  </div>
);

const Faded: React.FC<{ len: number; children: React.ReactNode; fadeIn?: boolean }> = ({ len, children, fadeIn = true }) => {
  const frame = useCurrentFrame();
  const o = Math.min(fadeIn ? Math.min(1, frame / FADE) : 1, Math.min(1, (len - frame) / FADE));
  return <AbsoluteFill style={{ opacity: Math.max(0, o) }}>{children}</AbsoluteFill>;
};

const Open: React.FC = () => (
  <Paper>
    <Shelf scale={0.8} top={330} />
    <Img src={staticFile('brand/MintFace-Logo-Black.png')} style={{ position: 'absolute', top: 640, left: 960 - 150, width: 300, height: 'auto' }} />
  </Paper>
);

const Chapter: React.FC<{ text: string }> = ({ text }) => (
  <Paper>
    <Label text={text} size={44} color={INK} style={{ position: 'absolute', top: 510, width: '100%', textAlign: 'center', letterSpacing: '0.2em' }} />
  </Paper>
);

const Close: React.FC<{ len: number }> = ({ len }) => {
  const frame = useCurrentFrame();
  const back = at(frame, 0, 1.4);
  const scale = lerp(2.8, 1, back);
  return (
    <Paper>
      {S.top.map((c: any, i: number) => {
        /* Round the palette, clear of it. */
        const a = rnd(i, 11) * Math.PI * 2, r = 380 + rnd(i, 12) * 520;
        const x = 960 + Math.cos(a) * r * 1.5 * scale, y = 540 + Math.sin(a) * r * 0.75 * scale;
        const size = (30 + rnd(i, 13) * 34) * Math.sqrt(scale);
        return <Hex key={c.address} src={c.face} size={size} style={{ left: x - size / 2, top: y - size / 2, opacity: 0.35 + 0.65 * back }} />;
      })}
      <Shelf scale={0.8} top={330} opacity={at(frame, 0.5, 0.8)} />
      <EndCard from={1.2} url={CUT.end} top={590}>
        <Shelf scale={0.8} top={300} />
      </EndCard>
    </Paper>
  );
};

export const Cut60: React.FC = () => {
  const parts: React.ReactNode[] = [];
  let t = 0;
  const openLen = f(CUT.open_len);
  parts.push(<Sequence key="open" from={0} durationInFrames={openLen}><Faded len={openLen} fadeIn={false}><Open /></Faded></Sequence>);
  t += openLen;
  CUT.chapters.forEach((ch: any, k: number) => {
    const cl = f(CUT.card_len);
    parts.push(<Sequence key={`c${k}`} from={t} durationInFrames={cl}><Faded len={cl}><Chapter text={ch.card} /></Faded></Sequence>);
    t += cl;
    const Film = BY[ch.film];
    ch.ranges.forEach(([a, b]: number[], j: number) => {
      const len = f(b) - f(a);
      parts.push(
        <Sequence key={`s${k}-${j}`} from={t} durationInFrames={len}>
          <Faded len={len}><Sequence from={-f(a)}><Film /></Sequence></Faded>
        </Sequence>,
      );
      t += len;
    });
  });
  const closeLen = f(CUT.duration) - t;
  parts.push(<Sequence key="close" from={t} durationInFrames={closeLen}><Faded len={closeLen + FADE}><Close len={closeLen} /></Faded></Sequence>);
  return <AbsoluteFill style={{ background: '#FAF9F6' }}>{parts}</AbsoluteFill>;
};
