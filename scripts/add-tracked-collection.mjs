#!/usr/bin/env node
/* Enumerate a contract into the catalogue as a collector-tracked collection.
 *
 * These are collections whose holders belong in the collector register but
 * which are not site canon: they carry display:false and never reach a public
 * grid. They enter the one catalogue like everything else, so collectors
 * mintface.art picks them up from data/c and the nightly sweep covers them.
 * Nothing is wired into the collectors site directly ... that would be two
 * pipelines again, which is what this architecture exists to avoid.
 *
 *   node scripts/add-tracked-collection.mjs --dry
 *   node scripts/add-tracked-collection.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DRY = process.argv.includes('--dry');
const BS = 'https://eth.blockscout.com/api/v2';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TRACKED = [
  { slug: 'we-are-the-line', title: 'We are The Line', address: '0x269bC803c233620506c9D25d980E979bf8BcbBf6', standard: 'ERC-1155', year: '2024', medium: 'Collaborative', statement: 'One million artworks on The Line is the goal.' },
  { slug: 'first-selfie', title: 'First Selfie', address: '0x78613F36916dF52aD8CDA841d4C2dCed15802bf4', standard: 'ERC-721', year: '2021', medium: 'Illustration', statement: null },
  { slug: 'xnouns', title: 'XNouns', address: '0x2969Eca285C9acD0B7EeDEbE7714C4D913700794', standard: 'ERC-721', year: '2022', medium: 'Generative', statement: 'XNouns celebrates the glitch origins of XCOPY combined with the artistic freedom of Nouns.' },
];

// The same guard list the rest of the pipeline uses. A token sitting in one of
// these is listed or vaulted, not collected, and its holder is not a collector.
const ARTIST = {
  '0xd40b63bf04a44e43fbfe5784bcf22acaab34a180': 'mintface.eth',
  '0xdd6b80649e8d472eb8fb52eb7eecfd2dc219ace7': 'ryanj.eth',
  '0x7110733ab02b2a18a947e3912bf54136fbced169': 'mintfaced.eth',
};
const VAULT = '0x6e420b64bb329be84a6627c68a7bdff825139773';
const ESCROW = new Set(['0xcda72070e455bb31c7690a170224ce43623d0b6f', '0xa9b3b278b8d8492fc5f27b78ac6e26a88202a9a5']);
const BURN = new Set(['0x0000000000000000000000000000000000000000', '0x000000000000000000000000000000000000dead']);

async function g(p) {
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(BS + p, { headers: { accept: 'application/json' } });
      if (r.ok) return r.json();
      if (r.status === 404) return null;
    } catch (e) { /* retry */ }
    await sleep(600 * (i + 1));
  }
  return null;
}
async function paged(p, max = 100000) {
  const out = [];
  let next = {};
  for (let i = 0; i < 300; i++) {
    const qs = new URLSearchParams(next).toString();
    const j = await g(p + (qs ? (p.includes('?') ? '&' : '?') + qs : ''));
    if (!j || !j.items) break;
    out.push(...j.items);
    if (out.length >= max || !j.next_page_params) break;
    next = j.next_page_params;
    await sleep(140);
  }
  return out;
}

const statusOf = (a) => (ARTIST[a] ? 'artist_held' : (a === VAULT ? 'vaulted' : (ESCROW.has(a) ? 'listed' : 'acquired')));
const lower = (s) => String(s || '').toLowerCase();

async function enumerate(t) {
  const instances = await paged(`/tokens/${t.address}/instances`);
  const meta = await g(`/tokens/${t.address}`);
  const addr = await g(`/addresses/${t.address}`);
  const works = [];

  for (const inst of instances) {
    const md = inst.metadata || {};
    const id = String(inst.id);
    const image = md.image || inst.image_url || null;
    const base = {
      id: `${t.slug}-${id}`,
      collection: t.slug,
      title: (md.name || `${t.title} #${id}`).trim(),
      statement: md.description ? String(md.description).trim() : null,
      digital: { chain: 'ethereum', standard: t.standard, contract: t.address, token_id: id, image, animation: md.animation_url || null, external_url: md.external_url || null },
      physical: { exists: null },
      pricing_nzd: { digital: null, painting: null, both: null },
      listed_on: null, reserve: null,
      attributes: md.attributes || [],
    };

    if (t.standard === 'ERC-1155') {
      // edition-aware: a 1155 token is an edition, so it carries a holder list
      const hs = await paged(`/tokens/${t.address}/instances/${encodeURIComponent(id)}/holders`);
      const holders = hs.map((h) => ({
        address: h.address?.hash || null,
        ens: h.address?.ens_domain_name || ARTIST[lower(h.address?.hash)] || null,
        display_name: null,
        qty: Number(h.value || 0),
        acquired: null,
        status: statusOf(lower(h.address?.hash)),
      })).filter((h) => h.address && h.qty > 0 && !BURN.has(lower(h.address)));
      const minted = holders.reduce((n, h) => n + h.qty, 0);
      works.push({
        ...base,
        edition: { type: 'edition', minted, holders: holders.length,
          artist_held: holders.filter((h) => h.status === 'artist_held').reduce((n, h) => n + h.qty, 0),
          vaulted: holders.filter((h) => h.status === 'vaulted').reduce((n, h) => n + h.qty, 0) },
        status: holders.some((h) => h.status === 'artist_held') ? 'available' : 'sold_out',
        held_by: null, collector: null, holders,
      });
      await sleep(120);
    } else {
      const owner = lower(inst.owner?.hash);
      if (BURN.has(owner)) { works.push({ ...base, edition: { type: '1/1' }, status: 'burned', held_by: null, collector: null }); continue; }
      const st = statusOf(owner);
      works.push({
        ...base,
        edition: { type: '1/1' },
        status: st === 'acquired' ? 'acquired' : (st === 'vaulted' ? 'vaulted' : 'available'),
        held_by: st === 'artist_held' ? ARTIST[owner] : (st === 'listed' ? 'listed' : null),
        collector: st === 'acquired'
          ? { address: inst.owner?.hash || null, ens: inst.owner?.ens_domain_name || null, display_name: null, note: null, acquired: null }
          : null,
      });
    }
  }

  const tally = {};
  for (const w of works) tally[w.status] = (tally[w.status] || 0) + 1;
  return {
    slug: t.slug, title: t.title,
    group: 'experiments',
    display: false,     // tracked for collectors, never shown in a public grid
    year: t.year, medium: t.medium, physical: false,
    statement: t.statement,
    notes: `Collector-tracked. Enumerated from chain; holders feed the collector register. Not shown on mintface.art until Ryan says otherwise.`,
    counts: { works: works.length, ...tally },
    contracts: [{ chain: 'ethereum', standard: t.standard, address: t.address,
      name: meta?.name || null, deployed: null, deployer: addr?.creator_address_hash || null,
      holders: meta?.holders || meta?.holders_count || null }],
    works,
  };
}

const summary = [];
for (const t of TRACKED) {
  process.stderr.write(`${t.title} ... `);
  const col = await enumerate(t);
  const holders = new Set();
  for (const w of col.works) {
    if (w.collector?.address) holders.add(lower(w.collector.address));
    for (const h of w.holders || []) holders.add(lower(h.address));
  }
  process.stderr.write(`${col.works.length} works, ${holders.size} holders\n`);
  summary.push({ slug: t.slug, works: col.works.length, holders: holders.size, counts: col.counts });
  if (!DRY) fs.writeFileSync(path.join(ROOT, `data/c/${t.slug}.json`), JSON.stringify(col, null, 1) + '\n');
}

if (!DRY) {
  const p = path.join(ROOT, 'data/index.json');
  const raw = fs.readFileSync(p, 'utf8');
  const idx = JSON.parse(raw);
  // the group Ryan asked for: between the studies and the archive
  if (!idx.groups.some((g) => g.id === 'experiments')) {
    const at = idx.groups.findIndex((g) => g.id === 'feature');
    idx.groups.splice(at >= 0 ? at : idx.groups.length, 0, { id: 'experiments', title: 'Experiments' });
  }
  for (const t of TRACKED) {
    const col = JSON.parse(fs.readFileSync(path.join(ROOT, `data/c/${t.slug}.json`), 'utf8'));
    const entry = {
      slug: col.slug, title: col.title, group: col.group, display: false,
      year: col.year, medium: col.medium, genre: null,
      card_statement: null, physical: false, statement: col.statement,
      counts: col.counts, cover: null, contracts: col.contracts, notes: col.notes,
    };
    const at = idx.collections.findIndex((c) => c.slug === col.slug);
    if (at >= 0) idx.collections[at] = entry; else idx.collections.push(entry);
  }
  fs.writeFileSync(p, JSON.stringify(idx, null, 1) + (raw.endsWith('\n') ? '\n' : ''));
}

console.log(`\n${DRY ? 'DRY RUN' : 'WROTE'}`);
for (const s of summary) console.log(`  ${s.slug.padEnd(18)} ${String(s.works).padStart(4)} works  ${String(s.holders).padStart(4)} holders  ${JSON.stringify(s.counts)}`);
