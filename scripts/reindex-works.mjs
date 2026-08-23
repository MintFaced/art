#!/usr/bin/env node
/* Rebuild the map the work route reads, from the records themselves.
 *
 * index.work_index is what turns /w/{id} into a page, and only the split ever
 * wrote it. Anything that edits data/c on its own ... the tracked-collection
 * enumerator, the Roads or Rivers children ... leaves complete records the
 * route cannot reach. The fault is invisible from either side: the collection
 * file looks whole, the index looks well-formed.
 *
 * The full split cannot be used to repair this, because it rebuilds data/c
 * from catalog.json and would overwrite the recovered images, restored names
 * and acquisition dates those files carry. So the map is rebuilt from data/c,
 * which is what the route actually reads.
 *
 * The vault is skipped deliberately. Its rows are pointers at works that live
 * in other collections ... every one of its 211 linked rows already resolves
 * to its home collection, and indexing them here would move those pages into
 * the vault.
 *
 *   node scripts/reindex-works.mjs --dry
 *   node scripts/reindex-works.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { adoptTracked } from './catalog/adopt-tracked.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const DRY = process.argv.includes('--dry');
const p = path.join(ROOT, 'data/index.json');
const raw = fs.readFileSync(p, 'utf8');
const idx = JSON.parse(raw);
const catalog = new Set(JSON.parse(fs.readFileSync(path.join(ROOT, 'catalog.json'), 'utf8')).collections.map((c) => c.slug));

// first make sure every collection on disk has an index entry at all
const adopted = adoptTracked(idx, ROOT, catalog);

const before = { ...(idx.work_index || {}) };
const wi = {};
const per = [];
for (const f of fs.readdirSync(path.join(ROOT, 'data/c')).filter((n) => n.endsWith('.json')).sort()) {
  const col = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/c', f), 'utf8'));
  const slug = col.slug || f.replace(/\.json$/, '');
  if (slug === 'the-vault') continue;
  let n = 0;
  const put = (w) => { if (w && w.id) { wi[w.id] = slug; n++; } };
  for (const w of col.works || []) put(w);
  for (const ch of col.children || []) for (const w of ch.works || []) put(w);
  per.push({ slug, n, added: (col.works || []).concat((col.children || []).flatMap((c) => c.works || [])).filter((w) => w.id && !before[w.id]).length });
}
idx.work_index = wi;

const lost = Object.keys(before).filter((k) => !wi[k]);
if (!DRY) fs.writeFileSync(p, JSON.stringify(idx, null, 1) + (raw.endsWith('\n') ? '\n' : ''));

console.log(DRY ? 'DRY RUN' : 'WROTE');
for (const a of adopted) console.log(`  entry     ${a.slug.padEnd(20)} (${a.how})`);
for (const c of per.filter((c) => c.added)) console.log(`  reachable ${c.slug.padEnd(20)} +${c.added} works that answered 404`);
console.log(`\nwork_index ${Object.keys(before).length} -> ${Object.keys(wi).length}`);
if (lost.length) console.log(`dropped ${lost.length}: ${lost.slice(0, 8).join(', ')}`);
