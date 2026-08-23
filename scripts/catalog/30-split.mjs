// Splits catalog.json into data/index.json + data/c/{slug}.json for the site.
// Edition sets collapse to one work record plus a holder list.
import fs from 'fs';
const ROOT = new URL('../../', import.meta.url).pathname;
import { adoptTracked } from './adopt-tracked.mjs';
const cat = JSON.parse(fs.readFileSync(ROOT + 'catalog.json', 'utf8'));

const DATA = ROOT + 'data';
fs.mkdirSync(DATA + '/c', { recursive: true });

// edition numbers live in the title on some contracts: "Traffic #156/1735"
const normTitle = (t) => (t || '').replace(/\s*#\s*\d+(\s*\/\s*\d+)?\s*$/, '').trim();
const key = (w) => `${normTitle(w.title)}|${w.digital?.image || ''}`;

// Genre and group live in an overlay rather than the build, so reclassifying a
// collection does not mean re-reading the chain.
// no try/catch: a missing or broken overlay should stop the split, not quietly
// produce a site with no genres on it
const META = JSON.parse(fs.readFileSync(ROOT + 'data/source/collection-meta.json', 'utf8')).collections;
const CONFIG = JSON.parse(fs.readFileSync(ROOT + 'data/source/config.json', 'utf8'));

// Some collections are known by one work rather than by whatever happens to be
// for sale. Named in the overlay beside genre, so a cover is an edit.
const COVER_OVERRIDE = Object.fromEntries(
  Object.entries(META).filter(([, m]) => m.cover).map(([slug, m]) => [slug, m.cover]),
);

// collapse rule: 4+ works in one collection sharing a title and an image are one edition set
function collapse(works) {
  const groups = new Map();
  for (const w of works) {
    const k = key(w);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(w);
  }
  const out = [];
  for (const [, g] of groups) {
    const t = normTitle(g[0].title);
    if (g.length < 4 || !t || !g[0].digital?.image) { out.push(...g); continue; }
    const first = g[0];
    // the set is offered at the price of the copy that is actually for sale,
    // which is rarely the first token minted
    const seller = g.find((w) => w.status === 'available') || first;
    const holders = g.map((w) => ({
      token_id: w.digital?.token_id,
      status: w.status,
      address: w.collector?.address || null,
      ens: w.collector?.ens || null,
      display_name: w.collector?.display_name || null,
      acquired: w.collector?.acquired || null,
    }));
    const live = holders.filter((h) => h.status !== 'burned');
    const artistHeld = holders.filter((h) => h.status === 'available').length;
    const vaulted = holders.filter((h) => h.status === 'vaulted').length;
    out.push({
      ...first,
      pricing_nzd: seller.pricing_nzd || first.pricing_nzd,
      pricing_eth: seller.pricing_eth || first.pricing_eth,
      listed_eth: seller.listed_eth != null ? seller.listed_eth : first.listed_eth,
      priced_in: seller.priced_in || first.priced_in,
      offers: seller.offers || first.offers,
      title: t,
      id: `${first.collection}-${t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
      edition: { type: 'edition', minted: g.length, live: live.length, burned: g.length - live.length, artist_held: artistHeld, vaulted },
      status: artistHeld > 0 ? 'available' : 'sold_out',
      collector: null,
      token_ids: g.map((w) => w.digital?.token_id),
      holders: live.map((h) => ({ address: h.address, ens: h.ens, display_name: h.display_name, acquired: h.acquired, status: h.status })).filter((h) => h.address),
      collapsed_from: g.length,
    });
  }
  return out;
}

const stripHeavy = (w) => {
  const c = { ...w };
  delete c.transfers;
  return c;
};

// orientation comes free where the chain metadata carried image dimensions
function withOrientation(w) {
  const d = w.digital && w.digital.image_details;
  if (!d || !d.width || !d.height) return w;
  const r = d.width / d.height;
  return { ...w, orientation: r > 1.05 ? 'landscape' : r < 0.95 ? 'portrait' : 'square' };
}

const numericId = (w) => {
  const n = Number(w.digital && w.digital.token_id);
  return isNaN(n) ? Number.MAX_SAFE_INTEGER : n;
};

function facets(works) {
  const f = {};
  const distinct = (key, fn) => {
    const counts = {};
    for (const w of works) {
      const v = fn(w);
      if (v == null) continue;
      counts[v] = (counts[v] || 0) + 1;
    }
    if (Object.keys(counts).length > 1) f[key] = counts;
  };
  distinct('availability', (w) => w.status);
  distinct('year', (w) => {
    const m = w.minted_onchain || w.minted || w.digital?.genesis_timestamp;
    const y = w.year || (m ? new Date(m).getFullYear() : null);
    return y ? String(y) : null;
  });
  distinct('medium', (w) => w.medium || null);
  distinct('price', (w) => {
    const p = w.pricing_nzd || {};
    const v = [p.both, p.painting, p.digital].find((x) => typeof x === 'number' && x > 0);
    if (v == null) return null;
    if (v < 500) return 'under-500';
    if (v < 1500) return '500-1500';
    if (v < 5000) return '1500-5000';
    return 'over-5000';
  });
  // only offer orientation when most of the collection can answer it
  const known = works.filter((w) => w.orientation).length;
  if (known / Math.max(works.length, 1) >= 0.7) distinct('orientation', (w) => w.orientation);
  distinct('edition', (w) => (w.edition && w.edition.type === 'edition' ? 'edition' : 'unique'));
  return f;
}

const index = {
  _meta: { ...cat._meta, split_generated: new Date().toISOString(), note: 'Browse index. Work records live in data/c/{slug}.json.' },
  groups: cat.groups,
  // decisions the site needs at render time, not chain data
  config: { framing_fee_nzd: CONFIG.framing_fee_nzd, framing_fee_quoted: CONFIG.framing_fee_quoted },
  collections: [],
  work_index: {},
  exhibition_history: cat.exhibition_history,
};

const files = [];
let totalBefore = 0, totalAfter = 0;
for (const col of cat.collections) {
  const raw = col.works || [];
  totalBefore += raw.length;
  const collapsible = raw.length && raw.every((w) => w.digital);
  // the newest paint goes at the top of the studio door
  const ordered = col.slug === 'recent-work'
    ? [...raw].sort((a, b) => String(b.added || b.year || '').localeCompare(String(a.added || a.year || '')))
    : raw;
  const works = (collapsible ? collapse(ordered) : ordered)
    .map(stripHeavy)
    .map(withOrientation)
    .sort((a, b) => (a.digital && b.digital ? numericId(a) - numericId(b) : 0));
  totalAfter += works.length;

  const meta0 = META[col.slug] || {};
  const file = {
    ...col,
    group: meta0.group || col.group,
    genre: meta0.genre || null,
    ...(meta0.statement ? { statement: meta0.statement } : {}),
    ...(meta0.framing ? { framing: true } : {}),
    // the work page needs the fee without a second fetch
    ...(meta0.framing ? { framing_fee_nzd: CONFIG.framing_fee_nzd, framing_fee_quoted: CONFIG.framing_fee_quoted } : {}),
    facets: facets(works),
    works,
  };
  files.push(file);

  const tally = {};
  for (const w of works) tally[w.status] = (tally[w.status] || 0) + 1;
  // some collections are known by one work rather than by whatever is for sale
  const chosen = COVER_OVERRIDE[col.slug];
  // lead with something a collector can actually buy
  const cover = (chosen && works.find((w) => w.id === chosen))
    || works.find((w) => w.status === 'available' && w.digital?.image)
    || works.find((w) => w.digital?.image)
    || works[0]
    || null;

  // burned tokens are not part of what a collection offers
  const live = works.filter((w) => w.status !== 'burned');
  const editionWorks = live.filter((w) => w.edition && w.edition.type === 'edition');
  const editionsMinted = editionWorks.reduce((n, w) => n + (w.edition.minted || w.edition.of || 0), 0);
  const uniqueWorks = live.length - editionWorks.length;
  const childWorks = (col.children || []).reduce((n, ch) => n + (ch.works || []).length, 0);

  const meta = META[col.slug] || {};
  index.collections.push({
    slug: col.slug, title: col.title, group: meta.group || col.group, year: col.year || null,
    medium: col.medium || null, genre: meta.genre || null,
    // a card wants one line; the page keeps whatever it already had
    card_statement: meta.card_statement || null,
    framing: meta.framing === true || undefined,
    physical: !!col.physical, statement: meta.statement || col.statement || null,
    sold_out: col.sold_out || false,
    counts: { works: works.length, ...tally, ...(editionsMinted ? { editions_minted: editionsMinted, edition_works: editionWorks.length } : {}), ...(uniqueWorks ? { unique_works: uniqueWorks } : {}), ...(childWorks ? { child_works: childWorks } : {}) },
    cover: cover ? { id: cover.id, image: cover.digital?.image || null, assets: cover.assets || null, orientation: cover.orientation || null } : null,
    contracts: col.contracts || null,
    links: col.links || null,
    notes: col.notes || null,
    has_children: !!col.children,
    tokenize_on_purchase: !!col.tokenize_on_purchase,
  });

  for (const w of works) index.work_index[w.id] = col.slug;
  if (col.children) {
    for (const ch of col.children) for (const w of ch.works || []) index.work_index[w.id] = col.slug;
  }
}

// the vault lists tokens by contract and id, so point each one at its work page
const byToken = new Map();
const titleById = new Map();
const imageById = new Map();
for (const f of files) {
  for (const w of f.works) {
    if (!w.id || !w.digital) continue;
    if (w.title) titleById.set(w.id, w.title);
    if (w.digital.image) imageById.set(w.id, w.digital.image);
    const c = w.digital.contract;
    if (!c) { if (w.wrapped && w.wrapped.contract) byToken.set(`${w.wrapped.contract.toLowerCase()}:${w.wrapped.token_id}`, w.id); continue; }
    const ids = w.token_ids && w.token_ids.length ? w.token_ids : [w.digital.token_id];
    for (const t of ids) byToken.set(`${c.toLowerCase()}:${t}`, w.id);
    if (w.wrapped && w.wrapped.contract) byToken.set(`${w.wrapped.contract.toLowerCase()}:${w.wrapped.token_id}`, w.id);
  }
}
let linkedVault = 0;
for (const f of files) {
  for (const w of f.works) {
    if (w.id || !w.collection_contract) continue;
    const hit = byToken.get(`${w.collection_contract.toLowerCase()}:${w.token_id}`);
    if (hit) {
      w.id = hit;
      const t = titleById.get(hit);
      if (t && t !== w.title) w.display_title = t;
      // the holdings snapshot can hold an image URL that has since died
      const img = imageById.get(hit);
      if (img && img !== w.image) w.image = img;
      linkedVault++;
    }
  }
}
for (const f of files) fs.writeFileSync(`${DATA}/c/${f.slug}.json`, JSON.stringify(f, null, 1));
console.log('vault records linked to work pages:', linkedVault);

// collections that live only in data/c would otherwise vanish here, since
// this index is built from catalog.json and they are not in it
const adopted = adoptTracked(index, ROOT, new Set(cat.collections.map((c) => c.slug)));
for (const a of adopted) console.log(`adopted ${a.slug}: ${a.works} works indexed (${a.how})`);

fs.writeFileSync(`${DATA}/index.json`, JSON.stringify(index, null, 1));
const size = (p) => (fs.statSync(p).size / 1024).toFixed(0) + ' KB';
console.log('work records', totalBefore, '->', totalAfter, '(editions collapsed)');
console.log('data/index.json', size(`${DATA}/index.json`));
for (const f of fs.readdirSync(`${DATA}/c`).sort()) console.log('  data/c/' + f.padEnd(28), size(`${DATA}/c/${f}`));
