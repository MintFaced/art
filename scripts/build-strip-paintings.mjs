#!/usr/bin/env node
/* Projects data/source/strip-paintings.json into the two files the site reads:
 * data/c/strip-paintings.json and the collection's entry in data/index.json.
 *
 * The same transform 20-build and 30-split apply, for this collection alone.
 * It is here because the full pipeline re-reads every chain the artist has ever
 * touched, and nothing in this collection is on a chain ... so a statement Ryan
 * rewrites, or a site design that lands next week, should cost one command
 * rather than an overnight enumeration. A full rebuild produces the same files.
 *
 *   node scripts/build-strip-paintings.mjs
 */
import fs from 'node:fs';

const ROOT = new URL('../', import.meta.url).pathname;
const R = (p) => JSON.parse(fs.readFileSync(ROOT + p, 'utf8'));
const W = (p, v) => fs.writeFileSync(ROOT + p, JSON.stringify(v, null, 1));

const src = R('data/source/strip-paintings.json');
const META = R('data/source/collection-meta.json').collections;
const c = src.collection || {};

const works = (src.works || []).map((w) => ({
  ...w,
  collection: 'strip-paintings',
  edition: w.edition || { type: '1/1' },
  physical: { exists: true, ...(w.physical || {}) },
  // said once, here, so no page has to infer it from a missing price
  gallery: w.gallery !== false,
  tokenized: w.tokenized === true,
  status: w.status || 'not_tokenized',
  collector: w.collector || null,
}));

const tally = {};
for (const w of works) tally[w.status] = (tally[w.status] || 0) + 1;

const col = {
  slug: 'strip-paintings', title: c.title, group: c.group || 'core',
  year: c.year || null, medium: c.medium || null, physical: c.physical !== false,
  statement: c.statement || null, notes: c.notes || null,
  gallery: true, tokenized: false,
  links: c.links || null, nudge: c.nudge || null,
  counts: { works: works.length, ...tally },
  works,
};

// facets, as 30-split counts them. Nothing prices, so the price facet is empty.
const facets = {};
const distinct = (key, fn) => {
  const counts = {};
  for (const w of works) { const v = fn(w); if (v == null) continue; counts[v] = (counts[v] || 0) + 1; }
  if (Object.keys(counts).length > 1) facets[key] = counts;
};
distinct('availability', (w) => w.status);
distinct('year', (w) => w.year || null);
distinct('medium', (w) => w.medium || null);
const known = works.filter((w) => w.orientation).length;
if (known / Math.max(works.length, 1) >= 0.7) distinct('orientation', (w) => w.orientation);
distinct('edition', (w) => (w.edition && w.edition.type === 'edition' ? 'edition' : 'unique'));

const meta0 = META['strip-paintings'] || {};
W('data/c/strip-paintings.json', {
  ...col,
  group: meta0.group || col.group,
  genre: meta0.genre || null,
  ...(meta0.statement ? { statement: meta0.statement } : {}),
  ...(meta0.framing ? { framing: true } : {}),
  facets,
  works,
});

// The card leads with a site design: the work is the wall, not the photograph
// of the room it is standing in.
const cover = works.find((w) => w.group === 'site-design') || works[0] || null;
const entry = {
  slug: col.slug, title: col.title, group: meta0.group || col.group, year: col.year || null,
  medium: col.medium || null, genre: meta0.genre || null,
  card_statement: meta0.card_statement || null,
  framing: meta0.framing === true || undefined,
  physical: !!col.physical, statement: meta0.statement || col.statement || null,
  sold_out: false,
  counts: { works: works.length, ...tally, unique_works: works.length },
  cover: cover
    ? { id: cover.id, image: cover.digital?.image || cover.image || null, assets: cover.assets || null, orientation: cover.orientation || null }
    : null,
  contracts: null,
  links: col.links || null,
  notes: col.notes || null,
  has_children: false,
  tokenize_on_purchase: false,
  gallery: true,
  tokenized: false,
};

const idx = R('data/index.json');
idx.collections = idx.collections.filter((x) => x.slug !== 'strip-paintings');
const at = idx.collections.findIndex((x) => x.slug === 'pixelarcade');
idx.collections.splice(at < 0 ? 0 : at + 1, 0, entry);
for (const k of Object.keys(idx.work_index)) {
  if (idx.work_index[k] === 'strip-paintings') delete idx.work_index[k];
}
for (const w of works) idx.work_index[w.id] = 'strip-paintings';
W('data/index.json', idx);

console.log(`strip-paintings: ${works.length} works, ${Object.entries(tally).map(([k, v]) => `${v} ${k}`).join(', ')}`);
