/* Deriving collectors from the catalogue.
 *
 * One implementation, two callers: scripts/build-collectors.mjs runs it over
 * the working tree, api/cron/owners.js runs it over what it has just committed.
 * Forking this logic is how the two sites drifted apart the first time.
 *
 * Pure: hand it the collection records and it hands back the files to write.
 */

// Not collectors. The artist's own wallets, the vault, and the two contracts
// that hold a token while it is listed rather than because anyone bought it.
export const NOT_A_COLLECTOR = new Set([
  '0xd40b63bf04a44e43fbfe5784bcf22acaab34a180',   // mintface.eth
  '0xdd6b80649e8d472eb8fb52eb7eecfd2dc219ace7',   // ryanj.eth
  '0x6e420b64bb329be84a6627c68a7bdff825139773',   // mintestate.eth, the vault
  '0x7110733ab02b2a18a947e3912bf54136fbced169',   // mintfaced.eth
  '0xcda72070e455bb31c7690a170224ce43623d0b6f',   // Foundation escrow
  '0xa9b3b278b8d8492fc5f27b78ac6e26a88202a9a5',   // PixelArcade contract
  '0x0000000000000000000000000000000000000000',
  '0x000000000000000000000000000000000000dead',
]);

// A page at three works, or at any unique work. Below that a collector is still
// counted in every total, just not given a page.
export const MIN_WORKS = 3;

// An ENS name may hold emoji or accents, which make poor filenames and worse
// URLs. Those fall back to the address form; the name is still displayed.
const URL_SAFE = /^[a-z0-9._-]+$/;
const shortOf = (a, n) => a.slice(0, 2 + n);

/**
 * @param collections  array of parsed data/c/*.json records
 * @param titleOf      Map slug -> collection title
 * @param privateList  Set of lowercased addresses that render as "Private collector"
 * @param tao          data/tao.json, or null. Attached, never derived here:
 *                     TAO is computed from ownership history, which this
 *                     function has no sight of.
 */
export function deriveCollectors(collections, titleOf, privateList = new Set(), tao = null) {
  const people = new Map();

  const note = (addr, w) => {
    const a = String(addr || '').toLowerCase();
    if (!a.startsWith('0x') || NOT_A_COLLECTOR.has(a)) return;
    let p = people.get(a);
    if (!p) { p = { address: a, ens: null, display_name: null, works: [], collections: new Map() }; people.set(a, p); }
    if (w.ens && !p.ens) p.ens = w.ens;                       // holder rows carry names inconsistently
    if (w.display_name && !p.display_name) p.display_name = w.display_name;
    if (p.works.some((x) => x.id === w.id)) return;           // an edition held twice is one work here
    p.works.push({ id: w.id, title: w.title, collection: w.collection, group: w.group || null, genre: w.genre || null,
      acquired: w.acquired || null, unique: w.unique, image: w.image, orientation: w.orientation || null });
    p.collections.set(w.collection, (p.collections.get(w.collection) || 0) + 1);
  };

  for (const col of collections) {
    if (!col || col.slug === 'the-vault') continue;           // a holdings mirror, not a sale record
    for (const w of col.works || []) {
      const unique = !((w.edition || {}).type && w.edition.type !== '1/1');
      const image = (w.assets && (w.assets.display || w.assets.image)) || (w.digital && w.digital.image) || null;
      // group and genre are the collection's, taken as they are. The filters on
      // a collector page read these; nothing re-derives them from a title.
      const base = { id: w.id, title: w.title || w.id, collection: col.slug, group: col.group || null,
        genre: col.genre || null, unique, image, orientation: w.orientation };
      const c = w.collector || {};
      if (c.address) note(c.address, { ...base, ens: c.ens, display_name: c.display_name, acquired: c.acquired });
      for (const h of w.holders || []) {
        if (h.address) note(h.address, { ...base, ens: h.ens, display_name: h.display_name, acquired: h.acquired });
      }
    }
  }

  const all = [...people.values()];
  for (const p of all) {
    p.works.sort((a, b) => String(b.acquired || '').localeCompare(String(a.acquired || '')));
    const dates = p.works.map((w) => w.acquired).filter(Boolean).sort();
    p.first_collected = dates[0] || null;
    p.last_collected = dates[dates.length - 1] || null;
    p.counts = {
      works: p.works.length,
      one_of_ones: p.works.filter((w) => w.unique).length,
      editions: p.works.filter((w) => !w.unique).length,
      collections: p.collections.size,
    };
    const t = tao && tao.wallets ? tao.wallets[p.address] : null;
    p.tao = t ? t.tao : 0;
    p.tao_rate = t ? t.rate : 0;
    // what each work has contributed to their total, for the hover
    if (t && t.works) for (const w of p.works) { const v = t.works[w.id]; if (v) w.tao = v; }
    p.private = privateList.has(p.address);
    // the threshold decides a page, never whether someone is counted
    p.has_page = !p.private && (p.counts.works >= MIN_WORKS || p.counts.one_of_ones >= 1);
  }

  // shortest address prefix that collides with nothing
  /* A slug can come from a reverse record or from a name Ryan wrote down.
     firstladyart.eth resolves forward to its wallet but publishes no reverse
     record, so the recorded name is the only name it will ever have ... and
     /firstladyart.eth is what a person would type. The address always resolves
     as well, so nothing rots either way. */
  const nameSlug = (p) => {
    for (const n of [p.ens, p.display_name]) {
      const v = typeof n === 'string' ? n.trim().toLowerCase() : '';
      if (v && /\.eth$/.test(v) && URL_SAFE.test(v)) return v;
    }
    return null;
  };
  const ensSlug = nameSlug;
  const paged = all.filter((p) => p.has_page);
  let n = 8;
  for (; n <= 40; n += 4) {
    const seen = new Set();
    if (!paged.some((p) => { const s = ensSlug(p) || shortOf(p.address, n); if (seen.has(s)) return true; seen.add(s); return false; })) break;
  }
  for (const p of paged) p.slug = ensSlug(p) || shortOf(p.address, n);

  const ranked = all.slice().sort((a, b) =>
    b.counts.works - a.counts.works
    || b.counts.one_of_ones - a.counts.one_of_ones
    || String(a.ens || a.address).localeCompare(String(b.ens || b.address)));

  const summary = (p) => ({
    address: p.address, ens: p.ens, display_name: p.display_name,
    slug: p.has_page ? p.slug : null, private: p.private, has_page: p.has_page,
    counts: p.counts, first_collected: p.first_collected, last_collected: p.last_collected,
    tao: p.tao || 0, tao_rate: p.tao_rate || 0,
  });
  const collectionsOf = (p) => [...p.collections.entries()]
    .map(([slug, works]) => ({ slug, title: titleOf.get(slug) || slug, works }))
    .sort((a, b) => b.works - a.works);

  return {
    hexBits: n,
    all: ranked,
    index: {
      _note: 'Derived from data/c/*.json. collectors.mintface.art reads this; nothing here is edited by hand. Fix the work record and rebuild.',
      generated: new Date().toISOString(),
      threshold: { min_works: MIN_WORKS, or_any_unique: true },
      tao: tao ? { rates: tao.rates, generated: tao.generated, wallets: tao.counts.wallets } : null,
      counts: {
        collectors: all.length,
        with_page: paged.length,
        private: all.filter((p) => p.private).length,
        named: all.filter((p) => p.ens || p.display_name).length,
      },
      collectors: ranked.filter((p) => p.has_page).map(summary),
    },
    slugMap: {
      _note: 'address -> collector page slug, for the attribution link on work pages.',
      slugs: Object.fromEntries(ranked.filter((p) => p.has_page).map((p) => [p.address, p.slug])),
    },
    page: (p) => ({ ...summary(p), collections: collectionsOf(p), works: p.works }),
  };
}
