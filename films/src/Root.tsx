import React from 'react';
import { Composition, Freeze, Sequence, useCurrentFrame } from 'remotion';
import { SCRIPT } from './data';
import { Film1 } from './Film1';
import { Film2 } from './Film2';
import { Film3 } from './Film3';
import { Film4 } from './Film4';
import { Cut60 } from './Cut60';

const fps = SCRIPT.fps, width = SCRIPT.width, height = SCRIPT.height;
const len = (id: string) => Math.round(SCRIPT.films[id].duration * fps);
export const HEAD = Math.round(0.5 * fps);

/* The clean head: the poster held still for half a second, then the film. */
const withHead = (C: React.FC) => {
  const Headed: React.FC = () => {
    const frame = useCurrentFrame();
    return frame < HEAD ? <Freeze frame={0}><C /></Freeze> : <Sequence from={HEAD}><C /></Sequence>;
  };
  return Headed;
};
export const FILMS: Record<string, React.FC> = { '01-strips': Film1, '02-tao': Film2, '03-collectors': Film3, '04-studio': Film4 };

export const Root: React.FC = () => (
  <>
    {Object.entries(FILMS).map(([id, C]) => (
      <Composition key={id} id={id} component={withHead(C)} durationInFrames={len(id)} fps={fps} width={width} height={height} />
    ))}
    <Composition id="00-mintface-60" component={Cut60} durationInFrames={len('00-mintface-60')} fps={fps} width={width} height={height} />
  </>
);
