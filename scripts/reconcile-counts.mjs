#!/usr/bin/env node
/* Make the index counts agree with the records they describe.
 *
 * Collection counts are written by the split, from catalog.json. Everything
 * that edits a work afterwards ... the nightly ownership sweep, a recall, a
 * sale ... writes data/c and leaves the counts where they were. They drift
 * quietly, and the drift only shows as a number on a card that nobody can
 * check without opening the collection.
 *
 * The status tallies are recomputed here from the records. The derived
 * figures the split works out ... unique works, child works, editions minted
 * ... are left exactly as they are, because those come from the catalogue and
 * not from status.
 *
 *   node scripts/reconcile-counts.mjs --dry
 *   node scripts/reconcile-counts.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DRY = process.argv.includes('--dry');
const p = path.join(ROOT, 'data/index.json');
const raw = fs.readFileSync(p, 'utf8');
const idx = JSON.parse(raw);

// anything that is a tally of work status, and so ours to recompute
const STATUS = new Set(['available', 'acquired', 'sold_out', 'reserved', 'vaulted', 'burned', 'artist_held', 'listed']);
/* The split works these out from the records too, so they are derived here
   rather than carried forward. Preserving them meant a stale unique_works of
   181 was copied back over a corrected 185 ... the reconcile undoing the very
   thing it exists to do. A key is only written if the collection already had
   it, because the split omits them when they are zero. */
const derived = (works, children) => ({
  unique_works: works.filter((w) => !((w.edition || {}).type && w.edition.type !== '1/1')).length,
  edition_works: works.filter((w) => (w.edition || {}).type === 'edition').length,
  editions_minted: works.reduce((n, w) => n + (((w.edition || {}).type === 'edition')
    ? ((w.edition.minted || w.edition.of || 0)) : 0), 0),
  child_works: children.reduce((n, ch) => n + (ch.works || []).length, 0),
});
const changed = [];

for (const c of idx.collections) {
  let col;
  try { col = JSON.parse(fs.readFileSync(path.join(ROOT, `data/c/${c.slug}.json`), 'utf8')); } catch (e) { continue; }
  /* Parent works only, which is what the split means by `works`: children are
     counted separately as child_works and their statuses are not tallied here.
     Counting them together turned Genesis from 7 works into 13. */
  const works = col.works || [];
  if (!works.length) continue;

  const tally = {};
  for (const w of works) if (w.status) tally[w.status] = (tally[w.status] || 0) + 1;

  const before = { ...c.counts };
  const d = derived(works, col.children || []);
  const kept = Object.fromEntries(Object.entries(c.counts || {})
    .filter(([k]) => !STATUS.has(k) && k !== 'works' && !(k in d)));
  const redone = Object.fromEntries(Object.entries(d).filter(([k]) => k in (c.counts || {})));
  const after = { works: works.length, ...tally, ...kept, ...redone };

  const diff = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((k) => before[k] !== after[k])
    .map((k) => `${k} ${before[k] ?? 0} -> ${after[k] ?? 0}`);
  if (!diff.length) continue;

  changed.push({ slug: c.slug, diff });
  if (!DRY) c.counts = after;
  // the collection file carries its own copy, and it drifts the same way
  if (!DRY && col.counts) {
    col.counts = after;
    const cp = path.join(ROOT, `data/c/${c.slug}.json`);
    const craw = fs.readFileSync(cp, 'utf8');
    fs.writeFileSync(cp, JSON.stringify(col, null, 1) + (craw.endsWith('\n') ? '\n' : ''));
  }
}

if (!DRY) fs.writeFileSync(p, JSON.stringify(idx, null, 1) + (raw.endsWith('\n') ? '\n' : ''));
console.log(DRY ? 'DRY RUN' : 'WROTE');
for (const c of changed) console.log(`  ${c.slug.padEnd(22)} ${c.diff.join(', ')}`);
console.log(`\n${changed.length} collection${changed.length === 1 ? '' : 's'} reconciled`);
