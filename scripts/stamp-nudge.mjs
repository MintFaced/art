#!/usr/bin/env node
/* Write a banked nudge onto the works it steered.
 *
 * The line is permanent, so it is copied onto the work rather than looked up:
 * a work page should not need the studio to be reachable to say how it came
 * about, and the figures are the ones the nudge closed with, which cannot
 * change afterwards.
 *
 *   node scripts/stamp-nudge.mjs nudge-1 strip-painting-4 strip-painting-5
 *
 * A painting made from the collectors' whole palette is stamped with the arc
 * rather than with one of its nudges, because one nudge chose a twelfth of it:
 *
 *   node scripts/stamp-nudge.mjs --series strip-palette strip-painting-7
 *
 * That writes the compound line and the per-slot record with it, so every
 * colour on the work leads back to the ledger that locked it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { provenanceLine } from '../api/_lib/nudges.js';
import { seriesState, seriesProvenanceLine } from '../api/_lib/palette.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const at = argv.indexOf('--series');
const seriesId = at >= 0 ? argv[at + 1] : null;
const rest = argv.filter((a, i) => a !== '--dry' && a !== '--series' && !(at >= 0 && i === at + 1));
const [id, ...works] = seriesId ? [seriesId, ...rest] : rest;

if (!id || !works.length) {
  console.error('usage: stamp-nudge.mjs [--series <series-id>] <nudge-id|work-id> <work-id> [work-id ...]');
  process.exit(1);
}

const store = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/nudges.json'), 'utf8'));

/* What gets written on a work: one nudge, or the whole arc. */
let stamp;
if (seriesId) {
  const state = seriesState(store);
  if (!state || state.id !== seriesId) { console.error(`no series ${seriesId}`); process.exit(1); }
  if (!state.locked.length) { console.error(`series ${seriesId} has locked nothing yet`); process.exit(1); }
  if (!state.complete) {
    /* Stamping a half-finished palette would freeze a line that is going to be
       wrong the next time a slot locks. The record on a work is permanent, so
       it is only written once the palette is. */
    console.error(`series ${seriesId} is ${state.locked.length} of ${state.slots} locked. `
      + 'A work carries this line for good, so it is stamped when the palette is complete.');
    process.exit(1);
  }
  stamp = {
    series: state.id,
    line: seriesProvenanceLine(state),
    slots: state.locked.map((v) => ({ slot: v.slot, hex: v.hex, nudge: v.nudge, number: v.number })),
  };
} else {
  const n = (store.nudges || []).find((x) => x.id === id);
  if (!n) { console.error(`no nudge ${id}`); process.exit(1); }
  if (!n.banked) { console.error(`nudge ${id} has not banked yet, so there is nothing settled to write`); process.exit(1); }
  stamp = { id: n.id, number: n.number, line: provenanceLine(n.banked) };
}

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
  w.nudge = stamp;
  if (!DRY) fs.writeFileSync(p, JSON.stringify(col, null, 1) + (raw.endsWith('\n') ? '\n' : ''));
  console.log(`  ${workId}  ${stamp.line}`);
  done++;
}
console.log(`\n${DRY ? 'would stamp' : 'stamped'} ${done} work${done === 1 ? '' : 's'}`);
