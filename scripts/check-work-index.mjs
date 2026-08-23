#!/usr/bin/env node
/* Every work record must be reachable from a work page.
 *
 * A record can exist in full and still answer 404, because the route reaches it
 * only through index.work_index. That gap is invisible from either side: the
 * collection file looks complete and the index looks well-formed. It is only
 * visible by comparing them, which is what this does.
 *
 *   node scripts/check-work-index.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/index.json'), 'utf8'));
const wi = idx.work_index || {};
const missing = [];
let total = 0;

for (const f of fs.readdirSync(path.join(ROOT, 'data/c')).filter((n) => n.endsWith('.json')).sort()) {
  const col = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/c', f), 'utf8'));
  const slug = col.slug || f.replace(/\.json$/, '');
  const rows = [...(col.works || []), ...(col.children || []).flatMap((c) => c.works || [])];
  // the vault holds pointers at works that live in other collections, so its
  // rows are reachable when they resolve anywhere, not when they resolve here
  const pointers = slug === 'the-vault';
  let gone = 0;
  for (const w of rows) {
    if (!w.id) continue;                       // vault rows that never linked
    total++;
    if (pointers ? !wi[w.id] : wi[w.id] !== slug) gone++;
  }
  if (gone) missing.push({ slug, gone, of: rows.length });
}

for (const m of missing) console.log(`  ${m.slug.padEnd(22)} ${m.gone} of ${m.of} works unreachable`);
console.log(missing.length
  ? `\n${missing.reduce((n, m) => n + m.gone, 0)} works would 404 ... run scripts/reindex-works.mjs`
  : `all ${total} work records reachable`);
process.exit(missing.length ? 1 : 0);
