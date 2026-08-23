import fs from 'fs';

const ROOT = new URL('../../', import.meta.url).pathname;
const R = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const seed = R(ROOT + 'docs/catalog.seed.json');
const wallets = R('wallets.json');
const cmeta = R('raw/contract-meta.json');
const TT = fs.existsSync('raw/token-transfers.json') ? R('raw/token-transfers.json') : {};
let TTKEY = null;

const ART = {
  'mintface.eth': wallets['mintface.eth'].toLowerCase(),
  'ryanj.eth': wallets['ryanj.eth'].toLowerCase(),
  'mintestate.eth': wallets['mintestate.eth'].toLowerCase(),
};
const FND_MARKET = '0xcda72070e455bb31c7690a170224ce43623d0b6f';
const PIXELARCADE_HOLDER = '0xa9b3b278b8d8492fc5f27b78ac6e26a88202a9a5';
const BURN = new Set(['0x0000000000000000000000000000000000000000', '0x000000000000000000000000000000000000dead']);

function classify(addr, ens) {
  const a = (addr || '').toLowerCase();
  if (!a) return { status: 'unknown', collector: null };
  if (BURN.has(a)) return { status: 'burned', collector: null };
  if (a === ART['mintestate.eth']) return { status: 'vaulted', collector: null, held_by: 'mintestate.eth' };
  if (a === ART['mintface.eth'] || a === ART['ryanj.eth']) return { status: 'available', collector: null, held_by: a === ART['mintface.eth'] ? 'mintface.eth' : 'ryanj.eth' };
  if (a === FND_MARKET) return { status: 'available', collector: null, held_by: 'Foundation market escrow', listed_on: 'Foundation' };
  if (a === PIXELARCADE_HOLDER) return { status: 'available', collector: null, held_by: 'PixelArcade contract' };
  return { status: 'acquired', collector: { address: addr, ens: ens || null, display_name: null, note: null, acquired: null } };
}

const clean = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : s);

function workFrom(inst, { collection, contract, chain = 'ethereum', standard = 'ERC-721', idPrefix, editionType }) {
  const md = inst.metadata || {};
  const c = classify(inst.owner?.hash, inst.owner?.ens_domain_name);
  const dims = md.image_details || {};
  const tt = (TTKEY && TT[TTKEY] && TT[TTKEY][inst.id]) || null;
  if (c.collector && tt) c.collector.acquired = tt.last_transfer || null;
  const attributes = Array.isArray(md.attributes) && md.attributes.length ? md.attributes : null;
  return {
    attributes,
    minted_onchain: tt ? tt.minted : null,
    mint_tx: tt ? tt.mint_tx : null,
    transfers: tt ? tt.transfers : null,
    id: `${idPrefix || collection}-${inst.id}`,
    collection,
    title: clean(md.name) || null,
    statement: clean(md.description) || null,
    edition: { type: editionType || '1/1' },
    digital: {
      chain, standard, contract, token_id: String(inst.id),
      image: inst.image_url || md.image || null,
      animation: inst.animation_url || md.animation_url || null,
      image_details: dims.width ? { width: dims.width, height: dims.height, format: dims.format, bytes: dims.bytes } : null,
      external_url: md.external_url || null,
    },
    physical: { exists: null, width_cm: null, height_cm: null, depth_cm: null, ready_to_hang: null, framed: null, certificate: null, packaging: 'Ships boxed/crated, freight included' },
    pricing_nzd: { digital: null, painting: null, both: null },
    status: c.status,
    held_by: c.held_by || null,
    listed_on: c.listed_on || null,
    reserve: null,
    collector: c.collector,
  };
}

function edition1155(inst, { collection, contract, idPrefix }) {
  const md = inst.metadata || {};
  const holders = (inst.__holders || []).map((h) => ({ ...h, ...classify(h.address, h.ens) }));
  const supply = holders.reduce((n, h) => n + Number(h.value || 0), 0);
  const artistHeld = holders.filter((h) => h.status === 'available').reduce((n, h) => n + Number(h.value || 0), 0);
  const vaulted = holders.filter((h) => h.status === 'vaulted').reduce((n, h) => n + Number(h.value || 0), 0);
  return {
    id: `${idPrefix || collection}-${inst.id}`,
    collection,
    title: clean(md.name) || null,
    statement: clean(md.description) || null,
    edition: { type: 'edition', minted: supply, holders: holders.filter(h=>h.status!=='burned').length, artist_held: artistHeld, vaulted },
    digital: { chain: 'ethereum', standard: 'ERC-1155', contract, token_id: String(inst.id), image: inst.image_url || md.image || null, animation: inst.animation_url || null, external_url: md.external_url || null },
    physical: { exists: null },
    pricing_nzd: { digital: null, painting: null, both: null },
    status: artistHeld > 0 ? 'available' : 'sold_out',
    holders: holders.filter(h=>h.status!=='burned').map((h) => ({ address: h.address, ens: h.ens, qty: Number(h.value || 0), status: h.status })),
  };
}

const collections = [];
/* Some contracts name a token with nothing but its number ... Patrimora's
   metadata for token 83 is literally "#83". A title should say what the thing
   is, so the collection name goes back on the front as the work is pushed.
   Anything carrying a real name is left exactly as the chain gave it. */
const BARE_NUMBER = /^#?\d+$/;
function qualifyTitles(c) {
  if (!c || !c.title) return c;
  for (const w of c.works || []) {
    const t = String(w.title || '').trim();
    if (BARE_NUMBER.test(t)) w.title = `${c.title} ${t.startsWith('#') ? t : '#' + t}`;
  }
  return c;
}
const push = (c) => collections.push(qualifyTitles(c));
const stats = {};
const tally = (works) => {
  const t = {};
  for (const w of works) t[w.status] = (t[w.status] || 0) + 1;
  return t;
};

// ---------- helper to load a dedicated contract ----------
const load = (key) => R(`raw/${key}.json`);
const meta = (key) => cmeta[key] || {};

function dedicated({ slug, title, group, year, medium, physical, statement, links, contractKey, filter, notes, aliases, sold_out, editionRule, series, afterEach }) {
  const { contract, items } = load(contractKey);
  const cm = meta(contractKey);
  TTKEY = contractKey;
  const sel = filter ? items.filter(filter) : items;
  const works = sel.map((i) => {
    const w = workFrom(i, { collection: slug, contract: contract.address, standard: contract.type, editionType: editionRule ? editionRule(i) : '1/1' });
    if (afterEach) afterEach(w, i);
    return w;
  });
  TTKEY = null;
  const t = tally(works);
  stats[slug] = t;
  push({
    slug, title, group, year, medium, physical: !!physical, statement: statement || null,
    aliases: aliases || undefined, links: links || undefined, notes: notes || undefined,
    sold_out: sold_out || undefined,
    counts: { works: works.length, ...t, ...(series ? { series: series(sel) } : {}) },
    contracts: [{ chain: 'ethereum', standard: contract.type, address: contract.address, name: cm.name || null, deployed: cm.deployed || null, deployer: cm.deployer || null, holders: cm.holders || null }],
    works,
  });
  return works;
}

// The PixelArcade works are SVGs that animate themselves. The chain points at
// IPFS, which is slow to unreliable, so the site reads them from the project's
// own public repo instead. Same bytes, checked against the copies in this one.
// an object element has no intrinsic size, so each work carries its own shape
const PIXELARCADE_ASPECT = fs.existsSync('raw/pixelarcade-aspect.json') ? R('raw/pixelarcade-aspect.json') : {};

const PIXELARCADE_SVG = (tokenId) =>
  `https://cdn.jsdelivr.net/gh/MintFaced/pixel-arcade@main/public/svg/${String(tokenId).padStart(3, '0')}.svg`;

// ---- CORE ----
dedicated({ slug: 'pixelarcade', title: 'PixelArcade', group: 'core', year: '2026', medium: 'Acrylic / Pixel / Tokenized', physical: true,
  statement: seed.collections.find(c=>c.slug==='pixelarcade').statement, links: { site: 'https://pixelarcade.art' }, contractKey: 'pixelarcade',
  afterEach: (work, inst) => {
    work.digital.image_source = PIXELARCADE_SVG(inst.id);
    work.digital.image_source_note = 'mirror of the on-chain SVG, served from the project repo';
    if (PIXELARCADE_ASPECT[inst.id]) work.digital.aspect_ratio = PIXELARCADE_ASPECT[inst.id];
  },
  notes: 'Physical claim mechanic — 63 of 64 tokens held by the PixelArcade contract.',
  series: (items) => ({
    eight_bit_studies: items.filter((i) => /Eight-Bit Study/i.test(i.metadata?.name || '')).length,
    sixteen_bit_compositions: items.filter((i) => /Sixteen-Bit Composition/i.test(i.metadata?.name || '')).length,
    thirty_two_bit_tableaux: items.filter((i) => /Thirty-Two-Bit Tableau/i.test(i.metadata?.name || '')).length,
    wildpixel: items.filter((i) => /Wildpixel/i.test(i.metadata?.description || '')).length,
  }) });

dedicated({ slug: 'artificial-flowers', title: 'Artificial Flowers', group: 'core', year: '2025', medium: 'Painting / AI / AR', physical: true,
  statement: null, contractKey: 'artificial-flowers' });

dedicated({ slug: 'patrimora', title: 'Patrimora', group: 'core', year: '2025', medium: 'Generative', physical: false,
  statement: null, contractKey: 'patrimora' });

dedicated({ slug: 'two-burdens', title: 'Two Burdens', group: 'core', year: '2024', medium: 'Painting', physical: true,
  statement: 'The inner and outer burdens.', links: { site: 'https://twoburdens.com', networked: 'https://networked.art/mintfacenft/twoburdens' }, contractKey: 'two-burdens' });

dedicated({ slug: 'hidden-landscapes', title: 'Hidden Landscapes', group: 'core', year: '2022', medium: 'AI — ArtBreeder', physical: false,
  statement: 'Hidden landscapes are emotions painted with words.', aliases: ['Geodetic AI', 'geoai'],
  links: { networked: 'https://networked.art/mintfacenft/geoai', more: 'https://www.geodeticmoments.com/hidden-landscapes/' },
  contractKey: 'geodetic-ai', filter: (i) => !/Dark hearts of kings/i.test(i.metadata?.description || ''),
  notes: 'Shares contract with Geodetic Illusions.' });

dedicated({ slug: 'roads-and-rivers', title: 'Roads & Rivers', group: 'core', year: '2022', medium: 'Photography', physical: false,
  statement: 'Roads are for travelling. Rivers go with the flow.', links: { networked: 'https://networked.art/mintfacenft/roadsandrivers' },
  contractKey: 'roads-and-rivers',
  editionRule: (i) => /^Roads and Rivers #\d+/.test(i.metadata?.name || '') ? '1/1' : 'edition',
  series: (items) => ({
    one_of_ones: items.filter((i) => /^Roads and Rivers #\d+/.test(i.metadata?.name || '')).length,
    traffic_editions: items.filter((i) => /Traffic/i.test(i.metadata?.name || '')).length,
    rivers_end_editions: items.filter((i) => /Rivers End/i.test(i.metadata?.name || '')).length,
    ath_world: items.filter((i) => /ATH World/i.test(i.metadata?.name || '')).length,
    no_metadata_burned: items.filter((i) => !i.metadata?.name).length,
  }),
  notes: 'Chain shows 40 tokens named "Roads and Rivers #N" (1/1s) and 168 edition tokens (156 Traffic, 12 Rivers End); 8 tokens burned. Seed said 36 x 1/1 + 162 editions.' });

// ---- GEODETIC ----
dedicated({ slug: 'geodetic-world', title: 'Geodetic World', group: 'geodetic', year: '2023', medium: 'AI', physical: false,
  statement: 'Distance separates, yet presence remains.', links: { networked: 'https://networked.art/mintfacenft/geodeticworld' }, contractKey: 'geodetic-world' });

dedicated({ slug: 'geodetica', title: 'Geodetica', group: 'geodetic', year: '2022', medium: 'AI', physical: false, sold_out: true,
  statement: 'The shortest visual path between human and machine.', links: { networked: 'https://networked.art/mintfacenft/geodetica' },
  contractKey: 'geodetica', filter: (i) => /^Geodetica/i.test(i.metadata?.name || ''),
  notes: 'Contract also carries Trouble Ahead (78 editions) and AInception (1/1) — see other-works.' });

dedicated({ slug: 'geodetic-illusions', title: 'Geodetic Illusions', group: 'geodetic-studies', year: '2022', medium: 'Neural painting', physical: false,
  statement: 'Preparation studies.', contractKey: 'geodetic-ai', filter: (i) => /Dark hearts of kings/i.test(i.metadata?.description || ''),
  notes: 'Shares contract with Hidden Landscapes.' });

// The storefront keeps its metadata off chain, behind the endpoint uri() names,
// so the image and the traits are fetched separately by 29-storefront-metadata.
const STOREFRONT_META = fs.existsSync('raw/storefront-metadata.json') ? R('raw/storefront-metadata.json') : {};
// the whole storefront index space, including tokens that were never minted on
// chain and so are invisible to any indexer
const STOREFRONT_SCAN = fs.existsSync('raw/storefront-scan.json') ? R('raw/storefront-scan.json') : {};

// Geodetic Moments — OpenSea shared storefront, creator ryanj.eth
{
  const detail = R('raw/os-detail.json');
  const gm = detail.filter((t) => /^Geodetic (Moment|Marker)/i.test(t.name || ''));
  const works = gm.map((t) => {
    const sf = STOREFRONT_META[t.id] || {};
    const holder = (t.holders || [])[0] || {};
    const c = holder.address ? classify(holder.address, holder.ens)
      : classify(t.last_transfer?.to, t.last_transfer?.to_ens);
    if (c.collector) c.collector.acquired = t.last_transfer?.ts || null;
    const md = t.metadata || {};
    const num = Number((t.name || '').match(/#(\d+)/)?.[1] || 0);
    return {
      id: `geodetic-moments-${num || t.index}`, collection: 'geodetic-moments',
      title: clean(t.name) || clean(sf.name), statement: clean(sf.description) || clean(md.description) || null,
      attributes: (sf.attributes && sf.attributes.length ? sf.attributes : null)
        || (Array.isArray(md.attributes) && md.attributes.length ? md.attributes : null),
      edition: { type: '1/1' },
      digital: {
        chain: 'ethereum', standard: 'ERC-1155', contract: '0x495f947276749Ce646f68AC8c248420045cb7b5e',
        token_id: t.id, opensea_index: t.index,
        image: sf.image || t.image || md.image || null,
        animation: sf.animation_url || t.animation || null,
        external_url: md.external_url || null,
      },
      physical: { exists: null }, pricing_nzd: { digital: null, painting: null, both: null },
      status: c.status, held_by: c.held_by || null, collector: c.collector,
      minted_onchain: t.first_transfer?.ts || null, last_transfer: t.last_transfer?.ts || null,
    };
  }).sort((a, b) => (Number(a.id.split('-').pop()) - Number(b.id.split('-').pop())));
  // works that only OpenSea knows about: lazy minted, never transferred, so no
  // chain record exists and nobody has bought them
  const seen = new Set(works.map((w) => String(w.digital.token_id)));
  for (const rec of Object.values(STOREFRONT_SCAN)) {
    if (!/^Geodetic (Moment|Marker)/i.test(rec.name || '')) continue;
    if (seen.has(String(rec.token_id))) continue;
    const num = Number((rec.name.match(/#(\d+)/) || [])[1] || 0);
    works.push({
      id: `geodetic-moments-${num || rec.index}`,
      collection: 'geodetic-moments',
      title: clean(rec.name),
      statement: clean(rec.description) || null,
      attributes: rec.attributes && rec.attributes.length ? rec.attributes : null,
      edition: { type: '1/1' },
      digital: {
        chain: 'ethereum', standard: 'ERC-1155',
        contract: '0x495f947276749Ce646f68AC8c248420045cb7b5e',
        token_id: rec.token_id, opensea_index: rec.index,
        image: rec.image || null, animation: rec.animation_url || null,
        minted: false,
        tokenize_on_purchase: true,
      },
      physical: { exists: null }, pricing_nzd: { digital: null, painting: null, both: null },
      status: 'available',
      held_by: 'ryanj.eth',
      collector: null,
      never_minted: true,
    });
  }
  works.sort((a, b) => Number(a.id.split('-').pop()) - Number(b.id.split('-').pop()));

  const t = tally(works); stats['geodetic-moments'] = t;
  const firsts = works.map(w=>w.minted_onchain).filter(Boolean).sort();
  push({ slug: 'geodetic-moments', title: 'Geodetic Moments', group: 'geodetic', year: '2021', medium: 'Photography', physical: false, sold_out: true,
    statement: 'Look to the horizon and measure where you stand.',
    counts: { works: works.length, expected: 100, never_minted: works.filter((w) => w.never_minted).length, ...t },
    notes: 'Lazy minted on the OpenSea shared storefront. The ones never sold have no chain record at all, so they are read from OpenSea and are tokenized on purchase like the recent paintings.',
    first_onchain_transfer: firsts[0] || null,
    contracts: [{ chain: 'ethereum', standard: 'ERC-1155', address: '0x495f947276749Ce646f68AC8c248420045cb7b5e', name: 'OpenSea Shared Storefront', creator_wallet: 'ryanj.eth' }],
    works });
}

// Geodetic Memory — networked.art "Minted" contract
{
  const { items } = R('raw/minted-all.json');
  const gm = items.filter((i) => /Geodetic Memory/i.test(i.metadata?.name || ''));
  TTKEY = 'minted-all';
  const works = gm.map((i) => workFrom(i, { collection: 'geodetic-memory', contract: '0xa81f8083072F192948dcaE38DA5c0C6073DA979c' }));
  TTKEY = null;
  const t = tally(works); stats['geodetic-memory'] = t;
  push({ slug: 'geodetic-memory', title: 'Geodetic Memory', group: 'geodetic', year: '2022', medium: 'Photography', physical: false,
    statement: 'A dance with the unconscious mind, after Dali.', links: { networked: 'https://networked.art/mintfacenft/geodetic-memory' },
    counts: { works: works.length, ...t },
    edition_summary: { minted: works.length, burned: t.burned || 0, live: works.length - (t.burned || 0), single_work_editions: true },
    contracts: [{ chain: 'ethereum', standard: 'ERC-721', address: '0xa81f8083072F192948dcaE38DA5c0C6073DA979c', name: 'Minted (networked.art shared contract)' }],
    works });
}

// Blockscout truncates metadata at 4096 characters, which cuts a fully on chain
// SVG in half, so these are read from the token's own uri().
const ONCHAIN_SVG = fs.existsSync('raw/onchain-svg.json') ? R('raw/onchain-svg.json') : {};

// Geodetic On-Chain + Geodetic Home (shared 1155)
{
  const { contract, items } = R('raw/geodetic-home-onchain.json');
  const mk = (i, slug) => {
    const w = edition1155(i, { collection: slug, contract: contract.address });
    const chain = ONCHAIN_SVG[i.id];
    if (chain) {
      if (chain.image) w.digital.image = chain.image;
      else if (chain.image_broken) {
        w.digital.image = null;
        w.digital.image_note = 'the SVG stored on chain for this token is incomplete';
      }
      if (chain.attributes) w.attributes = chain.attributes;
      if (chain.description && !w.statement) w.statement = clean(chain.description);
    }
    return w;
  };
  const home = items.filter((i) => /^Geodetic Home/i.test(i.metadata?.name || '')).map((i) => mk(i, 'geodetic-home'));
  const onchain = items.filter((i) => !/^Geodetic Home/i.test(i.metadata?.name || '')).map((i) => mk(i, 'geodetic-onchain'));
  const cm = meta('geodetic-onchain');
  push({ slug: 'geodetic-onchain', title: 'Geodetic On-Chain', group: 'geodetic', year: '2022', medium: 'Illustration', physical: false,
    statement: 'The master moulds for the geodetic form.',
    notes: 'Fully on-chain SVG works. Shares contract with Geodetic Home. Position first in the Geodetic set as origin works.',
    counts: { works: onchain.length, editions_minted: onchain.reduce((n, w) => n + w.edition.minted, 0) },
    contracts: [{ chain: 'ethereum', standard: 'ERC-1155', address: contract.address, deployed: cm.deployed, holders: cm.holders }],
    works: onchain });
  push({ slug: 'geodetic-home', title: 'Geodetic Home', group: 'geodetic', year: '2025', medium: 'Sculpture', physical: false, sold_out: true,
    statement: 'We are home now.',
    links: { opensea: 'https://opensea.io/item/ethereum/0x7b5ccc13ffacf2bc8204be1359a3eea3cae4dce4/5' },
    counts: { works: home.length, editions_minted: home.reduce((n, w) => n + w.edition.minted, 0) },
    contracts: [{ chain: 'ethereum', standard: 'ERC-1155', address: contract.address, deployed: cm.deployed }],
    works: home });
}

// ---- AI STUDIES ----
dedicated({ slug: 'visual-language', title: 'Visual Language', group: 'ai-studies', year: '2022', medium: 'AI', physical: false,
  statement: 'The first line of a famous speech, reimagined by AI.', links: { networked: 'https://networked.art/mintfacenft/visuallanguage' }, contractKey: 'visual-language' });
dedicated({ slug: 'panoptic', title: 'Panoptic', group: 'ai-studies', year: '2022', medium: 'AI', physical: false,
  statement: 'Prompting our future from a single view.', links: { networked: 'https://networked.art/mintfacenft/panopticon' }, contractKey: 'panoptic' });
dedicated({ slug: 'wallet', title: 'WALLΞT', group: 'ai-studies', year: '2022', medium: 'AI', physical: false,
  statement: 'Artwork seeded by ten wallet addresses, interpreted by AI.', links: { networked: 'https://networked.art/mintfacenft/wallet' }, contractKey: 'wallet' });

// ---- BITCOIN ----
{
  const canon = R('raw/recursive-canon.json');
  const ARTIST_ORD = 'bc1pnx85u4nlvy7q3sce5xvhm6e38fyve8eeg98kwu2c2e9v054jmj3suqsmrd';
  const works = canon.works.map((w) => {
    const ins = w.inscription;
    const status = ins ? (ins.address === ARTIST_ORD ? 'available' : 'acquired') : 'uninscribed';
    return {
      id: `recursive-mind-${w.n}`,
      collection: 'recursive-mind',
      title: w.title,
      sequence: w.sequence,
      keyword: w.keyword,
      age: w.age,
      statement: null,
      edition: { type: '1/1' },
      digital: ins
        ? {
            chain: 'bitcoin', standard: 'Ordinals', inscribed: true,
            inscription_id: ins.id, inscription_number: ins.inscription_number, sat: ins.sat,
            content_type: ins.content_type, content_length: ins.content_length,
            genesis_height: ins.genesis_height, genesis_timestamp: ins.genesis_timestamp,
            image: w.site_image, image_credit: 'rrrecursive.com',
            content_url: `https://ordinals.com/content/${ins.id}`,
          }
        : {
            chain: 'bitcoin', standard: 'Ordinals', inscribed: false,
            inscription_id: null, image: w.site_image, image_credit: 'rrrecursive.com',
          },
      links: ins
        ? { ordinals: `https://ordinals.com/inscription/${ins.id}`, gamma: `https://gamma.io/inscription/${ins.id}`, site: 'https://rrrecursive.com' }
        : { site: 'https://rrrecursive.com' },
      physical: { exists: null }, pricing_nzd: { digital: null },
      status,
      held_by: status === 'available' ? 'artist ordinals wallet' : null,
      collector: status === 'acquired' ? { address: ins.address, ens: null, display_name: null, note: null, acquired: null } : null,
    };
  });
  const t = tally(works); stats['recursive-mind'] = t;
  push({
    slug: 'recursive-mind', title: 'Recursive Mind', group: 'core', year: '2023 to 2025', medium: 'Illustration', physical: false,
    statement: 'Endless thought patterns looping into infinity.',
    links: { site: 'https://rrrecursive.com', gamma: 'https://gamma.io/ordinals/collections/recursive-mind/items' },
    notes: 'Canon is thirteen thoughts. Eight are inscribed on Bitcoin, five are not yet inscribed. The RRRECURSIVE cover inscription is the collection marker, not a work.',
    counts: { works: works.length, inscribed: works.filter((w) => w.digital.inscribed).length, uninscribed: works.filter((w) => !w.digital.inscribed).length, ...t },
    cover_inscription: canon.cover
      ? { inscription_id: canon.cover.id, inscription_number: canon.cover.inscription_number, genesis_timestamp: canon.cover.genesis_timestamp, image: `https://ordinals.com/content/${canon.cover.id}` }
      : null,
    contracts: [{ chain: 'bitcoin', standard: 'Ordinals', wallet: ARTIST_ORD }],
    works,
  });
}
{
  const holders = R('frogdna-holders.json');
  const emblem = R('raw/emblem-vault.json')[0] || null;
  const artistBtc = '1GpCYqHS3sqvg4n837NJmcsmWLfAssXcqK';
  const hs = (holders.data || []).map((h) => ({ address: h.address, qty: Number(h.quantity), status: h.address === artistBtc ? 'available' : 'acquired' }));
  const artistQty = hs.filter((h) => h.status === 'available').reduce((n, h) => n + h.qty, 0);

  const wrappedHolders = (emblem?.holders || []).map((h) => ({ ...h, ...classify(h.address, h.ens) }));
  const wrappedTotal = wrappedHolders.reduce((n, h) => n + Number(h.qty || 0), 0);
  const wrappedArtist = wrappedHolders.filter((h) => h.status === 'available').reduce((n, h) => n + Number(h.qty || 0), 0);
  const wrappedVaulted = wrappedHolders.filter((h) => h.status === 'vaulted').reduce((n, h) => n + Number(h.qty || 0), 0);

  push({
    slug: 'frogdna', title: 'FROGDNA', group: 'core', year: '2025', medium: 'Painting', physical: true,
    statement: null,
    links: { site: 'https://frogdna.com', tokenscan: 'https://cp20.tokenscan.io/asset/FROGDNA', fake_rares: 'https://fakeraredirectory.wordpress.com/series-2/', emblem: emblem?.external_url || null, opensea: emblem ? `https://opensea.io/item/ethereum/0x4c03bcad293fb0562d26faa7d90a0cb3ea74c919/${emblem.id}` : null },
    notes: 'Counterparty asset on Bitcoin (Fake Rare series), not an Ordinal. Some editions are wrapped in an EmblemVault ERC-1155 and trade on Ethereum.',
    counts: { works: 1, editions: 88, holders: hs.length, artist_held_native: artistQty, wrapped: wrappedTotal, artist_held_wrapped: wrappedArtist },
    contracts: [
      { chain: 'bitcoin', standard: 'Counterparty', asset: 'FROGDNA', asset_id: '1753067758', issuer: artistBtc, supply: 88, locked: true, first_issuance_block: 913856, last_issuance_block: 914012, metadata: 'https://easyasset.art/j/cns6ae/FROGD.json' },
      emblem ? { chain: 'ethereum', standard: 'ERC-1155', address: '0x4C03BCAD293fb0562D26FAa7D90A0cb3Ea74c919', token_id: emblem.id, name: 'EmblemVault', role: `Wrapped for Ethereum, ${wrappedTotal} of the edition` } : null,
    ].filter(Boolean),
    works: [{
      id: 'frogdna-1', collection: 'frogdna', title: 'FROGDNA',
      edition: { type: 'edition', of: 88, holders: hs.length, artist_held: artistQty },
      digital: { chain: 'bitcoin', standard: 'Counterparty', asset: 'FROGDNA', image: '/frogdna-by-mintface.jpg' },
      wrapped: emblem ? {
        chain: 'ethereum', standard: 'ERC-1155',
        contract: '0x4C03BCAD293fb0562D26FAa7D90A0cb3Ea74c919', token_id: emblem.id,
        name: emblem.name, image: emblem.image,
        total: wrappedTotal, artist_held: wrappedArtist, vaulted: wrappedVaulted,
        holders: wrappedHolders.map((h) => ({ address: h.address, ens: h.ens, qty: Number(h.qty || 0), status: h.status })),
        links: { opensea: `https://opensea.io/item/ethereum/0x4c03bcad293fb0562d26faa7d90a0cb3ea74c919/${emblem.id}`, emblem: emblem.external_url },
      } : null,
      physical: { exists: true, width_cm: null, height_cm: null, depth_cm: null },
      pricing_nzd: { digital: null, painting: null, both: null },
      status: artistQty > 0 || wrappedArtist > 0 ? 'available' : 'sold_out',
      buy_paths: ['stripe_nzd', 'stripe_usd', 'reserve', 'eth_emblem_vault', 'btc_counterparty'],
      holders: hs,
    }],
  });
}

// ---- ID PLEASE (Meme Card 362 inside 6529's The Memes) ----
{
  const t = R('raw/id-please-token.json');
  const holders = t.holders.map((h) => ({ ...h, ...classify(h.address, h.ens) }));
  const artistHeld = holders.filter((h) => h.status === 'available').reduce((n, h) => n + h.qty, 0);
  const vaulted = holders.filter((h) => h.status === 'vaulted').reduce((n, h) => n + h.qty, 0);
  const attr = (k) => (t.attributes || []).find((a) => a.trait_type === k)?.value;
  const work = {
    id: 'id-please-362', collection: 'id-please', title: clean(t.name), statement: clean(t.description) || null,
    attributes: Array.isArray(t.attributes) && t.attributes.length ? t.attributes : null,
    edition: { type: 'edition', minted: t.supply, holders: holders.length, artist_held: artistHeld, vaulted },
    minted_onchain: t.minted, mint_tx: t.mint_tx, platform: 'The Memes by 6529',
    digital: { chain: 'ethereum', standard: 'ERC-1155', contract: t.contract, token_id: t.token_id, image: t.image, animation: t.animation, attributes: t.attributes },
    physical: { exists: null }, pricing_nzd: { digital: null },
    status: artistHeld > 0 ? 'available' : 'sold_out',
    holders: holders.map((h) => ({ address: h.address, ens: h.ens, qty: h.qty, status: h.status })),
    links: { opensea: `https://opensea.io/item/ethereum/${t.contract}/${t.token_id}`, seize: 'https://6529.io/the-memes/362' },
  };
  push({
    slug: 'id-please', title: 'ID Please', group: 'core', year: '2025', medium: 'Illustration', physical: false,
    statement: clean(t.description) || null,
    notes: `Meme Card ${attr('Type - Card') || 362}, season ${attr('Type - Season') || ''}, inside The Memes by 6529. A MintFace work in someone else's shared collection, like the Foundation 1/1s. Placement in the site's own groups is Ryan's call.`,
    counts: { works: 1, editions: t.supply, holders: holders.length, artist_held: artistHeld },
    contracts: [{ chain: 'ethereum', standard: 'ERC-1155', address: t.contract, token_id: t.token_id, name: 'The Memes by 6529' }],
    works: [work],
  });
}

// ---- FEATURES: GENESIS ----
{
  const rar = R('raw/shared-rarible-1155.json');
  const cvn = rar.tokens.find((t) => /City versus Nature/i.test(t.instance?.metadata?.name || ''));
  const md = cvn.instance?.metadata || {};
  const mint = cvn.transfers.filter((x) => /^0x0+$/.test(x.from || '')).sort((a, b) => new Date(a.ts) - new Date(b.ts))[0];
  const fnd = R('raw/foundation-creators.json').filter((t) => t.isArtist);
  const fndWorks = fnd.map((t) => {
    const c = classify(t.owner, t.owner_ens);
    return { id: `foundation-${t.id}`, collection: 'foundation-1of1s', title: clean(t.name), statement: clean(t.metadata?.description) || null,
      edition: { type: '1/1' },
      digital: { chain: 'ethereum', standard: 'ERC-721', contract: '0x3B3ee1931Dc30C1957379FAc9aba94D1C48a5405', token_id: String(t.id), image: t.image || null, external_url: t.metadata?.external_url || null, platform: 'Foundation' },
      physical: { exists: null }, pricing_nzd: { digital: null }, status: c.status, held_by: c.held_by || null, listed_on: c.listed_on || null, collector: c.collector };
  });
  const cvnWork = {
    id: 'city-vs-nature', collection: 'genesis', feature_group: 'city-vs-nature',
    title: 'City versus Nature', statement: clean(md.description) || null,
    edition: { type: 'edition', of: Number(mint?.value || 5) },
    minted: mint?.ts || null, mint_tx: mint?.tx || null, platform: 'Rarible',
    digital: { chain: 'ethereum', standard: 'ERC-1155', contract: '0xd07dc4262BCDbf85190C01c996b4C06a461d2430', token_id: String(cvn.id), image: cvn.instance?.image_url || md.image || null, external_url: md.external_url || null },
    physical: { exists: null }, pricing_nzd: { digital: null },
    status: 'sold_out', collector: null,
    links: { rarible: `https://rarible.com/token/0xd07dc4262bcdbf85190c01c996b4c06a461d2430:${cvn.id}` },
  };
  const genesisWorks = [cvnWork, ...fndWorks.map((w) => ({ ...w, collection: 'genesis', feature_group: 'foundation' }))];

  push({ slug: 'genesis', title: 'Genesis', group: 'feature', year: '2021', medium: 'Photography', physical: false,
    statement: 'City vs Nature ... the genesis mint ... and the Foundation 1/1s that followed.',
    counts: { works: genesisWorks.length, ...tally(genesisWorks) },
    contracts: [
      { chain: 'ethereum', standard: 'ERC-1155', address: '0xd07dc4262BCDbf85190C01c996b4C06a461d2430', token_id: String(cvn.id), name: 'Rarible', role: 'City versus Nature, the genesis mint' },
      { chain: 'ethereum', standard: 'ERC-721', address: '0x3B3ee1931Dc30C1957379FAc9aba94D1C48a5405', name: 'Foundation', role: 'The Foundation 1/1s' },
    ],
    works: genesisWorks,
    children: [
      { slug: 'city-vs-nature', title: 'City versus Nature', note: 'Genesis mint',
        minted: mint?.ts || null, minted_tx: mint?.tx || null, platform: 'Rarible',
        contract: { chain: 'ethereum', standard: 'ERC-1155', address: '0xd07dc4262BCDbf85190C01c996b4C06a461d2430', token_id: String(cvn.id) },
        edition: { type: 'edition', of: Number(mint?.value || 5) },
        title_note: 'On-chain title is "City versus Nature".',
        statement: clean(md.description) || null,
        image: cvn.instance?.image_url || md.image || null,
        links: { rarible: `https://rarible.com/token/0xd07dc4262bcdbf85190c01c996b4c06a461d2430:${cvn.id}` } },
      { slug: 'foundation-1of1s', title: 'Foundation 1/1s', wallet: 'ryanj.eth',
        note: 'Chain-verified: 6 tokens created by ryanj.eth on the Foundation shared contract (tokenCreator).',
        networked: 'https://networked.art/mintface/foundation',
        counts: { works: fndWorks.length, ...tally(fndWorks) },
        works: fndWorks },
    ] });
}

// ---- FEATURES: 2022 10k ----
{
  const one = R('raw/10k-project.json');
  const inst = one.items[0];
  const c1 = classify(inst.owner?.hash, inst.owner?.ens_domain_name);
  const comm = R('raw/10k-commemoration.json');
  const commWorks = comm.items.map((i) => edition1155(i, { collection: '2022-10k', contract: comm.contract.address }));
  const seed10k = seed.collections.find((c) => c.slug === '2022-10k');
  push({ slug: '2022-10k', title: '2022 (10k Project)', group: 'feature', year: '2022', medium: 'Data portrait', physical: false,
    statement: seed10k.statement, links: seed10k.links, collaborator: seed10k.collaborator, artist_credit: seed10k.artist_credit,
    contracts: [
      { chain: 'ethereum', standard: 'ERC-721', address: one.contract.address, name: '2022', deployed: meta('10k-project').deployed, role: 'The 1/1' },
      { chain: 'ethereum', standard: 'ERC-1155', address: comm.contract.address, deployed: meta('10k-commemoration').deployed, role: 'The commemoration editions' },
    ],
    works: [
      { id: '10k-project', collection: '2022-10k', title: clean(inst.metadata?.name), statement: clean(inst.metadata?.description),
        edition: { type: '1/1' }, minted: meta('10k-project').deployed, platform: 'Foundation',
        digital: { chain: 'ethereum', standard: 'ERC-721', contract: one.contract.address, token_id: String(inst.id), image: inst.image_url || inst.metadata?.image, external_url: inst.metadata?.external_url || null },
        resolution: '4800 x 4800', physical: { exists: false }, pricing_nzd: { digital: null },
        status: c1.status, held_by: c1.held_by || null, listed_on: c1.listed_on || null, collector: c1.collector,
        links: seed10k.works[0].links },
      ...commWorks,
    ] });
}

// ---- SEIZE AND SHARE (archive) ----
{
  const { contract, items } = load('seize-and-share');
  const cm = meta('seize-and-share');
  const attr = (i, k) => (i.metadata?.attributes || []).find((a) => a.trait_type === k)?.value || null;
  const norm = (t) => (t || '').replace(/\s*#?\s*\d+(\s*\/\s*\d+)?\s*$/, '').trim();

  const groups = new Map();
  for (const i of items) {
    const name = norm(i.metadata?.name) || 'Untitled';
    const img = i.image_url || i.metadata?.image || '';
    const key = `${name}|${img}`;
    if (!groups.has(key)) groups.set(key, { name, img, items: [] });
    groups.get(key).items.push(i);
  }

  const works = [...groups.values()].map((g) => {
    const first = g.items[0];
    const holders = g.items.map((i) => ({ address: i.owner?.hash, ens: i.owner?.ens_domain_name, ...classify(i.owner?.hash, i.owner?.ens_domain_name) }));
    const artistHeld = holders.filter((h) => h.status === 'available').length;
    const vaulted = holders.filter((h) => h.status === 'vaulted').length;
    const ids = g.items.map((i) => String(i.id));
    const owners = new Map();
    for (const h of holders) if (h.address) owners.set(h.address, { address: h.address, ens: h.ens, status: h.status, qty: (owners.get(h.address)?.qty || 0) + 1 });
    return {
      id: `seize-and-share-${g.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled'}-${first.id}`,
      collection: 'seize-and-share',
      title: clean(g.name),
      statement: clean(first.metadata?.description) || null,
      derivative_of: attr(first, 'Artist'),
      meme_card: attr(first, 'Meme Card'),
      meme_season: attr(first, 'Meme Season'),
      attributes: Array.isArray(first.metadata?.attributes) && first.metadata.attributes.length ? first.metadata.attributes : null,
      edition: { type: 'edition', minted: g.items.length, holders: owners.size, artist_held: artistHeld, vaulted },
      digital: { chain: 'ethereum', standard: 'ERC-721', contract: contract.address, token_id: ids[0], image: g.img || null, animation: first.animation_url || null },
      token_ids: ids,
      physical: { exists: null }, pricing_nzd: { digital: null },
      status: artistHeld > 0 ? 'available' : 'sold_out',
      holders: [...owners.values()],
    };
  }).sort((a, b) => b.edition.minted - a.edition.minted);

  const t = tally(works); stats['seize-and-share'] = t;
  push({
    slug: 'seize-and-share', title: 'Seize And Share', group: 'archive', year: '2022', medium: 'Derivative works', physical: false,
    statement: 'The genesis meme of Punk6529 seized, sharded and shared.',
    notes: 'A study of another project. Derivative works made from meme cards by other artists, then broken into shards and given away. Kept as an archive rather than a collection.',
    links: { site: 'https://www.mintface.xyz/seize-and-share/', opensea: 'https://opensea.io/collection/seize-and-share' },
    counts: { works: works.length, tokens: items.length, ...t },
    contracts: [{ chain: 'ethereum', standard: 'ERC-721', address: contract.address, name: cm.name || 'Seize And Share', deployed: cm.deployed || null, holders: cm.holders || null }],
    works,
  });
}

// ---- THE VAULT ----
{
  const holdings = R('raw/holdings.json')['mintestate.eth'];
  const own = new Set(collections.flatMap((c) => (c.contracts || []).map((x) => (x.address || '').toLowerCase())).filter(Boolean));
  const mine = holdings.filter((h) => own.has((h.contract || '').toLowerCase()));
  const other = holdings.filter((h) => !own.has((h.contract || '').toLowerCase()));
  const byC = {};
  for (const h of other) { const k = `${h.contract_name || '(unnamed)'} | ${h.contract}`; byC[k] = (byC[k] || 0) + 1; }
  push({ slug: 'the-vault', title: 'The Vault', group: 'vault', wallet: 'mintestate.eth', wallet_address: wallets['mintestate.eth'],
    statement: seed.collections.find((c) => c.slug === 'the-vault').statement,
    intent: seed._meta.vault_intent,
    counts: { total_nfts_held: holdings.length, own_works: mine.length, other_holdings: other.length },
    works: mine.map((h) => ({ collection_contract: h.contract, contract_name: h.contract_name, standard: h.type, token_id: h.id, title: clean(h.name), image: h.image, animation: h.animation, qty: h.value ? Number(h.value) : 1, status: 'vaulted' })),
    other_holdings_summary: Object.entries(byC).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ collection: k, count: n })) });
}

// ---- RECENT WORK (not on chain yet, tokenized on purchase) ----
{
  const path = ROOT + 'data/source/recent-work.json';
  const src = fs.existsSync(path) ? R(path) : { collection: {}, works: [] };
  const c = src.collection || {};
  const works = (src.works || []).map((w) => ({
    ...w,
    collection: 'recent-work',
    edition: w.edition || { type: '1/1' },
    digital: {
      chain: w.digital?.chain || 'ethereum',
      standard: w.digital?.standard || 'ERC-721',
      minted: false,
      tokenize_on_purchase: true,
      contract: null,
      token_id: null,
      ...(w.digital || {}),
    },
    physical: { exists: true, packaging: 'Ships boxed/crated, freight included', ...(w.physical || {}) },
    pricing_nzd: { digital: null, painting: null, both: null, ...(w.pricing_nzd || {}) },
    status: w.status || 'available',
    collector: w.collector || null,
  }));
  const t = tally(works); stats['recent-work'] = t;
  push({
    slug: 'recent-work', title: c.title || 'Recent Work', group: 'recent',
    year: c.year || null, medium: c.medium || 'Painting', physical: c.physical !== false,
    statement: c.statement || 'Latest paintings.',
    notes: c.notes || 'Not yet minted. Each work is tokenized on purchase, so the collector wallet is the first owner written to chain.',
    tokenize_on_purchase: true,
    counts: { works: works.length, ...t },
    works,
  });
}

// ---- OTHER WORKS found on artist contracts but not in the seed ----
const other_works = [];
{
  const geo = load('geodetica');
  for (const i of geo.items.filter((x) => !/^Geodetica/i.test(x.metadata?.name || ''))) {
    other_works.push({ ...workFrom(i, { collection: null, contract: geo.contract.address }), found_on: 'Geodetica contract', needs_placement: true });
  }
  const rr = load('roads-and-rivers');
  const rrGroups = {};
  for (const i of rr.items) { const n = (i.metadata?.name || '(none)').replace(/\s*#?\s*\d+.*$/, '').trim() || '(none)'; (rrGroups[n] = rrGroups[n] || []).push(i); }
  const mm = load('mintface-mint');
  other_works.push({ note: 'Purple MintPass — 100 access passes on contract 0xE35CB2BEA009C4b40643d4970388eBF47446c899, not artwork. Excluded from the catalog.', count: mm.items.length, needs_placement: true });
  other_works.push({ note: 'Seize And Share — 838 holders, contract 0xe63f4E6CE4110A2faD3DE9ed38e7eA5858EB953b deployed 2022-06-11 by mintface.eth. Not in the seed. 123 held in the vault.', needs_placement: true });
  other_works.push({ note: 'Geodetic Sculpture — two 1/1 contracts (0xA59f33d2b133De3F341c22f8feD38Ab8caeF1998 GS1, 0xe9d9CC9Cb7287b0cC4de6Edd9664A537B7aFa177 MOCS) deployed 2026-06-20 by ryanj.eth, both held by ryanj.eth. Not in the seed.', needs_placement: true });
  other_works.push({ note: 'Roads & Rivers name groups: ' + Object.entries(rrGroups).map(([k, v]) => `${k} (${v.length})`).join(', ') });
}

// Images repaired by hand where the chain data is damaged. Always carries a note,
// so a repair is never presented as chain truth.
{
  const path = ROOT + 'data/source/recovered-images.json';
  if (fs.existsSync(path)) {
    const rec = R(path).works || {};
    let n = 0;
    for (const c of collections) {
      for (const w of c.works || []) {
        const r = rec[w.id];
        if (!r) continue;
        if (r.image) w.digital.image = r.image;
        w.digital.image_note = r.note || null;
        w.digital.image_recovered = true;
        delete w.digital.image_broken;
        n++;
      }
    }
    if (n) console.log('recovered images applied to', n, 'works');
  }
}

// Two collections are listed in ETH on chain. NZD is master here, so the figure
// was converted once and rounded clean; the site quotes ETH live from it like
// every other work.
{
  const path = ROOT + 'data/source/pricing-override.json';
  if (fs.existsSync(path)) {
    const src = R(path);
    const per = src.collections || {};
    let n = 0;
    for (const c of collections) {
      const p = per[c.slug];
      if (!p) continue;
      for (const w of c.works || []) {
        if (w.status !== 'available') continue;
        w.pricing_nzd = { ...(w.pricing_nzd || {}), digital: p.digital };
        if (p.listed_eth) w.listed_eth = p.listed_eth;
        w.offers = { digital: p.digital != null, painting: false, both: false };
        n++;
      }
    }
    if (n) console.log('price override applied to', n, 'works');
  }
}

// Ryan's hand data: prices, dimensions, collector names. Merged over the chain
// so rebuilding from chain never loses it.
{
  const path = ROOT + 'data/source/overlay.json';
  if (fs.existsSync(path)) {
    const ov = R(path);
    let touched = 0;
    for (const c of collections) {
      for (const w of c.works || []) {
        const e = (ov.works || {})[w.id];
        if (!e) continue;
        touched++;
        if (e.pricing_nzd) w.pricing_nzd = { ...(w.pricing_nzd || {}), ...e.pricing_nzd };
        if (e.physical) w.physical = { ...(w.physical || {}), ...e.physical };
        if (e.offers) w.offers = e.offers;
        if (e.painting_included) w.painting_included = true;
        if (e.listing) w.listing = e.listing;
        if (e.notes) w.hand_notes = e.notes;
        if (e.status) { if (w.status_chain == null) w.status_chain = w.status; w.status = e.status; }
        if (e.collector_display_name) {
          w.collector = { ...(w.collector || { address: null, ens: null, note: null, acquired: null }), display_name: e.collector_display_name };
        }
      }
    }
    console.log('overlay applied to', touched, 'works');
  }
}

const catalog = {
  _meta: {
    version: '1.0.0',
    generated: new Date().toISOString(),
    generated_by: 'Phase 1 chain enumeration — Blockscout v2, Ethereum RPC, ordinals.com, Counterparty (xchain.io/tokenscan.io)',
    note: 'Canonical catalog for mintface.art. Single source of truth. Edit + push to deploy.',
    assets_base: seed._meta.assets_base,
    artist_wallets: {
      'mintface.eth': wallets['mintface.eth'],
      'ryanj.eth': wallets['ryanj.eth'],
      'mintestate.eth': wallets['mintestate.eth'],
      bitcoin_ordinals: 'bc1pnx85u4nlvy7q3sce5xvhm6e38fyve8eeg98kwu2c2e9v054jmj3suqsmrd',
      bitcoin_counterparty: '1GpCYqHS3sqvg4n837NJmcsmWLfAssXcqK',
    },
    special_addresses: {
      foundation_market_escrow: '0xcDA72070E455bb31C7690a170224Ce43623d0B6f',
      pixelarcade_contract: '0xa9B3B278b8d8492Fc5F27B78ac6E26A88202A9A5',
    },
    status_values: ['available', 'reserved', 'acquired', 'vaulted', 'burned', 'sold_out'],
    pricing: seed._meta.pricing,
    shipping: seed._meta.shipping,
    reserve_days: seed._meta.reserve_days,
    vault_intent: seed._meta.vault_intent,
    design_decisions: seed._meta.design_decisions,
    to_overlay_by_ryan: ['pricing_nzd per work', 'physical dimensions', 'collector display_name + note', 'statements marked null'],
  },
  groups: [...seed.groups, { id: 'archive', title: 'Archive' }],
  collections,
  exhibition_history: seed.exhibition_history,
  work_schema_example: seed.work_schema_example,
  other_works,
};

// house style: no em-dashes anywhere in site copy, ellipses instead; drop seed FILL placeholders
const destyle = (o) => {
  if (typeof o === 'string') {
    if (/^FILL\b/.test(o.trim())) return null;
    return o
      .replace(/\s*—\s*/g, ' ... ')
      .replace(/(\d)\s*–\s*(\d)/g, '$1 to $2')
      .replace(/(\d)\s*–\s*$/, 'Since $1'.replace('Since ', '') + ' onward')
      .replace(/\s+\.\.\.\s+$/, ' ...');
  }
  if (Array.isArray(o)) return o.map(destyle);
  if (o && typeof o === 'object') { const r = {}; for (const k of Object.keys(o)) r[k] = destyle(o[k]); return r; }
  return o;
};
fs.writeFileSync(ROOT + 'catalog.json', JSON.stringify(destyle(catalog), null, 2));
console.log('WROTE catalog.json');
let total = 0;
for (const c of collections) {
  const n = (c.works || []).length + (c.children ? c.children.reduce((s, ch) => s + (ch.works?.length || 0), 0) : 0);
  total += n;
  console.log(String(n).padStart(5), c.slug.padEnd(22), JSON.stringify(c.counts || {}));
}
console.log('TOTAL work records:', total);
