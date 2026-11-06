#!/usr/bin/env node
/* Nothing about how a design is made goes on-chain. A hit fails the build.
 *
 * Reads the extension, renderer, engine, their comments, the deployed bytes,
 * what tokenURI returns, and the snapshot tables. The guarded terms come from
 * docs/STRIP-PAGE.md (kept out of the repository) or STRIP_SECRET_TERMS, on top
 * of the shapes below, which say what's guarded without saying what it is.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { pack, RED_INDEX } from '../../strips-design.js';
import { startChain, deployRenderer } from './chain.mjs';

const root = new URL('../../', import.meta.url);
const SHAPES = [/\bgrid\b/i, /\b\d+\s?mm\b/i, /millimet/i, /k-?means/i, /\bcluster/i, /\bmirror/i, /\bsampl(e|ing)\b/i, /\bgamma\b/i, /\bvibrancy\b/i, /\bshare\b/i];
const doc = new URL('docs/STRIP-PAGE.md', root);
let terms = (process.env.STRIP_SECRET_TERMS || '').split('|').filter(Boolean);
if (!terms.length && existsSync(doc)) {
  const line = readFileSync(doc, 'utf8').split('\n').find((l) => /greps the built page for/.test(l)) || '';
  terms = [...line.slice(line.indexOf('greps the built page for')).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

const targets = [];
for (const f of readdirSync(new URL('contracts/src/', root))) targets.push([`contracts/src/${f}`, readFileSync(new URL(`contracts/src/${f}`, root), 'utf8')]);
targets.push(['contracts/script/Deploy.s.sol', readFileSync(new URL('contracts/script/Deploy.s.sol', root), 'utf8')]);
targets.push(['contracts/README.md', readFileSync(new URL('contracts/README.md', root), 'utf8')]);
targets.push(['strips-blink.js', readFileSync(new URL('strips-blink.js', root), 'utf8')]);
targets.push(['contracts/build/engine.min.js', readFileSync(new URL('contracts/build/engine.min.js', root), 'utf8')]);
for (const f of ['data/strips-snapshot-1.csv', 'data/strips-snapshot-1.json']) if (existsSync(new URL(f, root))) targets.push([f, readFileSync(new URL(f, root), 'utf8')]);

const chain = await startChain();
try {
  const { renderer } = await deployRenderer(chain);
  const design = pack({ length: 120, width: 60, colours: ['#112233', '#445566', '#778899'], bands: Array.from({ length: 30 }, (_, i) => (i === 15 ? { c: RED_INDEX, u: 2 } : { c: i % 3, u: 1 + (i % 4) })) });
  const view = { id: 1n, design, word: 12345n, mintedAt: 1795000000n, viewIndex: 0n, redeemed: false, photo: '', no: 5n, site: '300 West Laneway' };
  const uri = await chain.client.readContract({ ...renderer, functionName: 'render', args: [view], gas: 30_000_000n });
  const json = Buffer.from(uri.split(',')[1], 'base64').toString('utf8');
  const meta = JSON.parse(json);
  targets.push(['tokenURI metadata', json.replace(/"(image|animation_url)":"data:[^"]*"/g, '')]);
  targets.push(['tokenURI still', Buffer.from(meta.image.split(',')[1], 'base64').toString('utf8')]);
  targets.push(['tokenURI page', Buffer.from(meta.animation_url.split(',')[1], 'base64').toString('utf8').replace(/atob\("[^"]*"\)/, '')]);
} finally { chain.stop(); }

let hits = 0;
for (const [name, text] of targets) {
  for (const re of [...SHAPES, ...terms.map((t) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))]) {
    const m = text.match(re);
    if (m) { hits += 1; console.log(`FAIL ${name}: a guarded shape (${re.source.length > 3 ? re.source.slice(0, 12) : '?'}…) near "${text.slice(Math.max(0, m.index - 24), m.index + 24).replace(/\s+/g, ' ')}"`); }
  }
}
console.log(`${targets.length} things read, ${SHAPES.length + terms.length} patterns, ${hits} hits`);
if (hits) process.exit(1);
