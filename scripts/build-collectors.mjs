#!/usr/bin/env node
/* Collectors, derived from the catalogue.
 *
 * collectors.mintface.art used to enumerate the chain itself and drifted five
 * months out of date doing it. It now reads what this writes, built from the
 * same data/c/*.json the main site renders: one sweep, one truth, two deploys.
 *
 * The derivation lives in api/_lib/collectors.js so the daily cron runs exactly
 * this logic rather than its own copy. Forking it is how the two sites came
 * apart the first time.
 *
 * Nothing here is edited by hand. If a collector looks wrong the work record is
 * wrong: fix that and rebuild.
 *
 *   node scripts/build-collectors.mjs           # write the files
 *   node scripts/build-collectors.mjs --dry     # report only
 */
import fs from 'node:fs';
import path from 'node:path';
import { deriveCollectors } from '../api/_lib/collectors.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const DRY = process.argv.includes('--dry');
const load = (p, fallback) => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')); } catch (e) { return fallback; }
};

const index = load('data/index.json', { collections: [] });
const titleOf = new Map((index.collections || []).map((c) => [c.slug, c.title]));
const privateList = new Set((load('data/source/collectors-private.json', { wallets: [] }).wallets || [])
  .map((w) => String(w).toLowerCase()));

const collections = fs.readdirSync(path.join(ROOT, 'data/c'))
  .filter((n) => n.endsWith('.json'))
  .map((n) => load(`data/c/${n}`, null))
  .filter(Boolean);

// TAO is computed from ownership history by scripts/tao/build.mjs; this only
// attaches it. If it has never been built the collectors still build fine.
const tao = load('data/tao.json', null);
const d = deriveCollectors(collections, titleOf, privateList, tao);

if (DRY) {
  console.log(JSON.stringify(d.index.counts, null, 1));
  console.log(`address slugs use ${d.hexBits} hex chars`);
  console.log('\ntop of the index:');
  for (const p of d.index.collectors.slice(0, 12)) {
    console.log(`  ${String(p.ens || p.display_name || p.address).slice(0, 30).padEnd(30)}`
      + ` ${String(p.counts.works).padStart(3)} works ${String(p.counts.one_of_ones).padStart(2)} unique`
      + ` ${String(p.tao || 0).padStart(9)} TAO  /${p.slug}`);
  }
} else {
  fs.writeFileSync(path.join(ROOT, 'data/collectors.json'), JSON.stringify(d.index, null, 1) + '\n');
  // one row per line keeps the nightly diff readable and the file small
  fs.writeFileSync(path.join(ROOT, 'data/collectors-register.json'),
    `{\n "_note": ${JSON.stringify(d.register._note)},\n "generated": ${JSON.stringify(d.register.generated)},\n`
    + ` "fields": ${JSON.stringify(d.register.fields)},\n "rows": [\n`
    + d.register.rows.map((r) => '  ' + JSON.stringify(r)).join(',\n') + '\n ]\n}\n');
  fs.writeFileSync(path.join(ROOT, 'data/collector-slugs.json'), JSON.stringify(d.slugMap, null, 1) + '\n');

  const dir = path.join(ROOT, 'data/collectors');
  fs.mkdirSync(dir, { recursive: true });
  const keep = new Set();
  for (const p of d.all) {
    if (!p.has_page) continue;
    keep.add(`${p.slug}.json`);
    fs.writeFileSync(path.join(dir, `${p.slug}.json`), JSON.stringify(d.page(p), null, 1) + '\n');
  }
  // someone who drops below the threshold should not leave a page behind
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.json') && !keep.has(f)) fs.unlinkSync(path.join(dir, f));

  console.log(`wrote data/collectors.json (${d.index.counts.collectors} collectors), ${keep.size} pages, and the slug map`);
  console.log(`wrote data/collectors-register.json (${d.register.rows.length} ranked rows)`);
}
