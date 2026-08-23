#!/usr/bin/env node
/* Write a banked nudge onto the works it steered.
 *
 * The line is permanent, so it is copied onto the work rather than looked up:
 * a work page should not need the studio to be reachable to say how it came
 * about, and the figures are the ones the nudge closed with, which cannot
 * change afterwards.
 *
 *   node scripts/stamp-nudge.mjs nudge-1 strip-painting-4 strip-painting-5
 */
import fs from 'node:fs';
import path from 'node:path';
import { provenanceLine } from '../api/_lib/nudges.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const [id, ...works] = process.argv.slice(2).filter((a) => a !== '--dry');
const DRY = process.argv.includes('--dry');
if (!id || !works.length) { console.error('usage: stamp-nudge.mjs <nudge-id> <work-id> [work-id ...]'); process.exit(1); }

const store = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/nudges.json'), 'utf8'));
const n = (store.nudges || []).find((x) => x.id === id);
if (!n) { console.error(`no nudge ${id}`); process.exit(1); }
if (!n.banked) { console.error(`nudge ${id} has not banked yet, so there is nothing settled to write`); process.exit(1); }

const line = provenanceLine(n.banked);
const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/index.json'), 'utf8'));
let done = 0;
for (const workId of works) {
  const slug = idx.work_index && idx.work_index[workId];
  if (!slug) { console.log(`  no such work: ${workId}`); continue; }
  const p = path.join(ROOT, `data/c/${slug}.json`);
  const raw = fs.readFileSync(p, 'utf8');
  const col = JSON.parse(raw);
  const w = (col.works || []).find((x) => x.id === workId)
    || (col.children || []).flatMap((c) => c.works || []).find((x) => x.id === workId);
  if (!w) { console.log(`  not in ${slug}: ${workId}`); continue; }
  w.nudge = { id: n.id, number: n.number, line };
  if (!DRY) fs.writeFileSync(p, JSON.stringify(col, null, 1) + (raw.endsWith('\n') ? '\n' : ''));
  console.log(`  ${workId}  ${line}`);
  done++;
}
console.log(`\n${DRY ? 'would stamp' : 'stamped'} ${done} work${done === 1 ? '' : 's'}`);
