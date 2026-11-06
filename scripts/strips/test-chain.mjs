#!/usr/bin/env node
/* The Maker's promise: what you see is what you mint. Thousands of random
 * designs and words, run through the real renderer on a local chain and through
 * strips-design.js, and every string compared byte for byte.
 */
import { randomBytes } from 'node:crypto';
import { attributesOf, stillSVG, pack, RED_INDEX, traitsOf, DISPLAY_NAMES } from '../../strips-design.js';
import { startChain, deployRenderer } from './chain.mjs';

const N = Number(process.env.N || 1500);
const chain = await startChain();
let fails = 0;
const say = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} ${extra}`); if (!ok) fails += 1; };

try {
  const { engine, renderer } = await deployRenderer(chain);
  console.log(`engine stored: ${engine.gas} gas · renderer: ${renderer.gas} gas`);
  const read = (functionName, args) => chain.client.readContract({ ...renderer, functionName, args });

  const int = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const hex = () => `#${randomBytes(3).toString('hex').toUpperCase()}`;
  function randomDesign() {
    const n = int(3, 12);
    const colours = Array.from({ length: n }, hex);
    const count = int(2, 199);
    const red = int(0, count - 1);
    const bands = Array.from({ length: count }, (_, i) => ({ c: i === red ? RED_INDEX : int(0, n - 1), u: int(1, 15) }));
    return pack({ portrait: Math.random() < .5, length: int(1, 700), width: int(1, 300), colours, bands });
  }

  let badStill = 0, badTraits = 0, badTuning = 0;
  const tally = new Array(10).fill(0);
  for (let i = 0; i < N; i += 1) {
    const design = randomDesign();
    const word = `0x${randomBytes(32).toString('hex')}`;
    const view = { id: BigInt(i + 1), design, word: BigInt(word), mintedAt: 1795000000n, viewIndex: 0n, redeemed: i % 2 === 0, photo: '', no: i % 5 === 0 ? 5n : 0n, site: i % 5 === 0 ? '300 West Laneway' : '' };
    const svg = await read('still', [design]);
    if (svg !== stillSVG(design)) { badStill += 1; if (badStill === 1) console.log('first still mismatch\n sol', svg.slice(0, 300), '\n js ', stillSVG(design).slice(0, 300)); }
    const sol = JSON.parse(await read('attributes', [view]));
    const js = attributesOf(design, { word, redeemed: view.redeemed, no: Number(view.no), site: view.site });
    if (JSON.stringify(sol) !== JSON.stringify(js)) { badTraits += 1; if (badTraits === 1) console.log('first trait mismatch\n sol', JSON.stringify(sol), '\n js ', JSON.stringify(js)); }
    const tuning = JSON.parse(await read('attributes', [{ ...view, word: 0n }]));
    if (JSON.stringify(tuning) !== JSON.stringify(attributesOf(design, { redeemed: view.redeemed, no: Number(view.no), site: view.site }))) badTuning += 1;
    tally[traitsOf(word).display] += 1;
  }
  say(`still matches byte for byte across ${N} designs`, badStill === 0, `(${badStill} off)`);
  say(`traits match across ${N} words`, badTraits === 0, `(${badTraits} off)`);
  say(`Tuning matches across ${N}`, badTuning === 0, `(${badTuning} off)`);
  console.log('displays drawn:', tally.map((n, i) => `${DISPLAY_NAMES[i]} ${(n / N * 100).toFixed(1)}%`).join(' · '));
} finally {
  chain.stop();
}
if (fails) process.exit(1);
