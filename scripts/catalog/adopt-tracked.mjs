/* Collections that live only in data/c, carried through the split.
 *
 * A tracked collection is enumerated straight into data/c and the index by
 * scripts/add-tracked-collection.mjs. It never enters catalog.json, because
 * catalog.json is built from the artist's own wallets and these contracts are
 * not that. Two things follow, and both have now bitten:
 *
 *   the work pages 404    The work route finds a record through
 *                         index.work_index, and only the split ever wrote that
 *                         map. A collection added outside the split gets full
 *                         records with no way to reach them:
 *                         data/c/first-selfie.json held all 101 works while
 *                         /w/first-selfie-79 returned 404, as did every XNouns
 *                         and XLIFE page.
 *
 *   the split drops them  The split rebuilds index.json from catalog.json, so
 *                         the next full rebuild would have deleted all four
 *                         from the index outright ... including their covers,
 *                         which for these collections are recorded nowhere
 *                         else.
 *
 * So the entry already in the index is carried forward verbatim rather than
 * derived a second time, and work_index is rebuilt from the records on disk.
 * Deriving is only for a collection that has never been indexed at all.
 */
import fs from 'node:fs';
import path from 'node:path';

const derive = (col) => ({
  slug: col.slug, title: col.title, group: col.group,
  ...(col.display === true ? {} : { display: false }),
  year: col.year || null, medium: col.medium || null, genre: col.genre || null,
  card_statement: col.card_statement || null, physical: !!col.physical,
  statement: col.statement || null, counts: col.counts || { works: (col.works || []).length },
  cover: null, contracts: col.contracts || null, notes: col.notes || null,
});

/* index      the index being written
 * root       repo root
 * catalog    slugs the split itself owns; anything else in data/c is tracked */
export function adoptTracked(index, root, catalog) {
  const dir = path.join(root, 'data', 'c');
  const have = new Map(index.collections.map((c) => [c.slug, c]));
  // read before the split overwrites it: this is where a carried entry lives
  let prev = new Map();
  try {
    const old = JSON.parse(fs.readFileSync(path.join(root, 'data', 'index.json'), 'utf8'));
    prev = new Map((old.collections || []).map((c) => [c.slug, c]));
  } catch (e) { /* first build */ }

  const adopted = [];
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    const slug = f.replace(/\.json$/, '');
    if (catalog.has(slug)) continue;
    const col = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (col.slug !== slug) continue;                 // a stray file is not a collection

    if (!have.has(slug)) index.collections.push(prev.get(slug) || derive(col));

    let n = 0;
    const put = (w) => { if (w && w.id) { index.work_index[w.id] = slug; n++; } };
    for (const w of col.works || []) put(w);
    for (const ch of col.children || []) for (const w of ch.works || []) put(w);
    adopted.push({ slug, works: n, how: have.has(slug) ? 'in place' : (prev.has(slug) ? 'carried' : 'derived') });
  }
  return adopted;
}
