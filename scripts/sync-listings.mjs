#!/usr/bin/env node
/* Live listing prices, read from chain.
 *
 * The listing is the price. Where a work is listed on Foundation the price sits
 * on chain in the market contract, so there is nothing to keep in step by hand:
 * this reads it and writes data/listings.json, which the site prefers over the
 * catalogue figure.
 *
 * Two venues, read two different ways. Foundation escrows the token and stores
 * the price on chain, so an eth_call answers. OpenSea's Seaport listings are
 * signed orders in an off-chain book, so they need OPENSEA_API_KEY.
 *
 * Only the artist's own listings count. Anyone holding a MintFace work can list
 * it on OpenSea, and a stranger's resale is not this site's asking price ... so
 * every OpenSea order is filtered to an offerer in ARTIST. Foundation needs no
 * such filter: the seller is checked there too, but only the artist can have
 * escrowed the token in the first place.
 *
 *   node scripts/sync-listings.mjs            # write data/listings.json
 *   node scripts/sync-listings.mjs --dry      # report, write nothing
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DRY = process.argv.includes('--dry');

const RPCS = [
  'https://ethereum-rpc.publicnode.com',
  'https://eth.drpc.org',
  'https://1rpc.io/eth',
  'https://rpc.flashbots.net',
];
// Foundation's market proxy. It holds the token while a work is listed, which
// is why an escrowed work reads as "not in the artist's wallet" everywhere else.
const FOUNDATION = '0xcDA72070E455bb31C7690a170224Ce43623d0B6f';
// selectors, from the verified implementation at 0x60d0a9f0...d328
const SEL = {
  ownerOf: '0x6352211e',              // ownerOf(uint256)
  getBuyPrice: '0x4635256e',          // getBuyPrice(address,uint256) -> (seller, price)
  getReserveAuctionIdFor: '0x2ab2b52b', // getReserveAuctionIdFor(address,uint256)
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let rpcIdx = 0;
async function rpc(method, params) {
  let lastErr;
  for (let i = 0; i < 6; i++) {
    const url = RPCS[rpcIdx++ % RPCS.length];
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 25000);
      const res = await fetch(url, {
        method: 'POST', signal: ac.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      clearTimeout(t);
      const j = await res.json();
      if (j.error) throw new Error(j.error.message);
      return j.result;
    } catch (e) { lastErr = e; await sleep(400 * (i + 1)); }
  }
  throw new Error(`rpc ${method}: ${lastErr}`);
}
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      try { out[k] = await fn(items[k]); } catch (e) { out[k] = { __error: String(e.message || e) }; }
    }
  }));
  return out;
}

// mintface.eth, ryanj.eth, mintestate.eth, mintfaced.eth
const ARTIST = new Set([
  '0xd40b63bf04a44e43fbfe5784bcf22acaab34a180',
  '0xdd6b80649e8d472eb8fb52eb7eecfd2dc219ace7',
  '0x6e420b64bb329be84a6627c68a7bdff825139773',
  '0x7110733ab02b2a18a947e3912bf54136fbced169',
]);
const OS_KEY = process.env.OPENSEA_API_KEY || '';

async function os(pathname) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(`https://api.opensea.io/api/v2${pathname}`,
        { headers: { accept: 'application/json', 'x-api-key': OS_KEY } });
      if (r.status === 429) { await sleep(1500 * (i + 1)); continue; }
      if (!r.ok) return null;
      return await r.json();
    } catch (e) { await sleep(600 * (i + 1)); }
  }
  return null;
}

// contract -> OpenSea collection slug. The slug is not derivable, it has to be
// asked for, and several MintFace contracts sit under names that are not theirs.
async function openseaSlugs(contracts) {
  const map = new Map();
  for (const c of contracts) {
    const j = await os(`/chain/ethereum/contract/${c}`);
    if (j && j.collection) map.set(c, j.collection);
    await sleep(280);
  }
  return map;
}

async function openseaListings(byToken, contracts) {
  if (!OS_KEY) return { entries: {}, skipped: 'OPENSEA_API_KEY is not set' };
  const slugs = await openseaSlugs(contracts);
  const entries = {};
  let seen = 0, mine = 0;
  for (const slug of new Set(slugs.values())) {
    let next = null;
    for (let page = 0; page < 20; page++) {
      const q = `/listings/collection/${encodeURIComponent(slug)}/all?limit=100${next ? `&next=${encodeURIComponent(next)}` : ''}`;
      const j = await os(q);
      if (!j || !Array.isArray(j.listings)) break;
      for (const l of j.listings) {
        seen++;
        if (l.status && l.status !== 'ACTIVE') continue;
        const p = l.protocol_data && l.protocol_data.parameters;
        const offerer = (p && p.offerer || '').toLowerCase();
        // the whole point of this reader: a stranger's resale is not our price
        if (!ARTIST.has(offerer)) continue;
        const cur = l.price && l.price.current;
        if (!cur || cur.currency !== 'ETH' || !cur.value) continue;
        const contract = (l.asset && l.asset.contract || '').toLowerCase();
        const tokenId = l.asset && l.asset.identifier;
        if (!contract || tokenId == null) continue;
        const id = byToken.get(`${contract}|${tokenId}`);
        if (!id) continue;                       // a token the catalogue does not carry
        const wei = BigInt(cur.value);
        const eth = Number(wei) / 1e18;
        const prev = entries[id];
        // if the artist has more than one live order on a token, the cheapest is
        // the one a buyer would actually fill
        if (prev && prev.price_eth <= eth) continue;
        entries[id] = {
          venue: 'opensea', kind: 'buy-now',
          price_eth: eth, price_wei: wei.toString(),
          seller: offerer,
          expires: p.endTime ? new Date(Number(p.endTime) * 1000).toISOString() : null,
          url: `https://opensea.io/item/ethereum/${contract}/${tokenId}`,
        };
        mine++;
      }
      next = j.next || null;
      if (!next) break;
      await sleep(300);
    }
    await sleep(300);
  }
  return { entries, seen, mine: Object.keys(entries).length };
}

const padAddr = (a) => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
const padUint = (n) => BigInt(n).toString(16).padStart(64, '0');
const asAddr = (hex) => (hex && hex !== '0x' ? '0x' + hex.slice(-40) : null);
const isZero = (a) => !a || /^0x0+$/i.test(a);

// every ethereum ERC-721 work the catalogue knows about
function works() {
  const dir = path.join(ROOT, 'data', 'c');
  const out = [];
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (d.slug === 'the-vault') continue;              // a holdings mirror, not a sale surface
    for (const w of d.works || []) {
      const dg = w.digital || {};
      if (dg.chain !== 'ethereum' || dg.standard !== 'ERC-721' || !dg.contract || dg.token_id == null) continue;
      out.push({ slug: d.slug, id: w.id, title: w.title, contract: dg.contract, token_id: String(dg.token_id) });
    }
  }
  return out;
}

const all = works();
process.stderr.write(`checking ${all.length} works for a live listing\n`);

// 1. who holds each token. Only the ones Foundation is holding can be listed there.
const owners = await mapLimit(all, 20, async (w) =>
  asAddr(await rpc('eth_call', [{ to: w.contract, data: SEL.ownerOf + padUint(w.token_id) }, 'latest'])));
// A failed ownerOf is indistinguishable from "not listed" downstream, which
// would silently drop a work's price. So the failures get a second, gentler
// pass before anything is concluded from them.
const retryIdx = owners.map((o, i) => (typeof o === 'string' ? -1 : i)).filter((i) => i >= 0);
if (retryIdx.length) {
  process.stderr.write(`  retrying ${retryIdx.length} owner lookups\n`);
  const again = await mapLimit(retryIdx, 4, async (i) => {
    await sleep(150);
    return asAddr(await rpc('eth_call', [{ to: all[i].contract, data: SEL.ownerOf + padUint(all[i].token_id) }, 'latest']));
  });
  retryIdx.forEach((i, k) => { if (typeof again[k] === 'string') owners[i] = again[k]; });
}
const unresolved = owners.filter((o) => typeof o !== 'string').length;
const escrowed = all.filter((w, i) => typeof owners[i] === 'string'
  && owners[i].toLowerCase() === FOUNDATION.toLowerCase());
process.stderr.write(`  ${escrowed.length} held by the Foundation market` + (unresolved ? `, ${unresolved} owner lookups failed` : '') + `\n`);

// 2. the price, and how it is listed
const listed = await mapLimit(escrowed, 12, async (w) => {
  const arg = padAddr(w.contract) + padUint(w.token_id);
  const bp = await rpc('eth_call', [{ to: FOUNDATION, data: SEL.getBuyPrice + arg }, 'latest']);
  const seller = bp && bp.length >= 66 ? '0x' + bp.slice(26, 66) : null;
  const wei = bp && bp.length >= 130 ? BigInt('0x' + bp.slice(66, 130)) : 0n;
  if (!isZero(seller) && wei > 0n) {
    return { ...w, kind: 'buy-now', seller, price_wei: wei.toString(), price_eth: Number(wei) / 1e18 };
  }
  const au = await rpc('eth_call', [{ to: FOUNDATION, data: SEL.getReserveAuctionIdFor + arg }, 'latest']);
  const auctionId = au && au !== '0x' ? BigInt(au) : 0n;
  // A reserve auction has no fixed price until it is bid on, so there is nothing
  // to quote. It is still recorded, because the page should say it is at auction.
  if (auctionId > 0n) return { ...w, kind: 'auction', auction_id: auctionId.toString() };
  return { ...w, kind: 'none' };
});

const priced = listed.filter((x) => x && x.kind === 'buy-now');
const auctions = listed.filter((x) => x && x.kind === 'auction');
const errored = listed.filter((x) => x && x.__error);

const byId = {};
for (const x of priced) {
  byId[x.id] = {
    venue: 'foundation',
    kind: 'buy-now',
    price_eth: x.price_eth,
    price_wei: x.price_wei,
    seller: x.seller,
    url: `https://foundation.app/mint/eth/${x.contract}/${x.token_id}`,
  };
}
for (const x of auctions) {
  byId[x.id] = {
    venue: 'foundation',
    kind: 'auction',
    auction_id: x.auction_id,
    url: `https://foundation.app/mint/eth/${x.contract}/${x.token_id}`,
  };
}

// 3. OpenSea, for anything the artist has listed there. A token in Foundation
// escrow cannot be filled on OpenSea ... Foundation is holding it ... so where
// both venues answer, Foundation wins.
const byToken = new Map(all.map((w) => [`${w.contract.toLowerCase()}|${w.token_id}`, w.id]));
const contracts = [...new Set(all.map((w) => w.contract.toLowerCase()))];
const osOut = await openseaListings(byToken, contracts);
let osAdded = 0;
if (osOut.skipped) {
  process.stderr.write(`  opensea skipped: ${osOut.skipped}\n`);
} else {
  for (const [id, entry] of Object.entries(osOut.entries)) {
    if (byId[id]) continue;                    // Foundation already has the token
    byId[id] = entry; osAdded++;
  }
  process.stderr.write(`  opensea: ${osOut.mine} listed by an artist wallet, ${osAdded} added\n`);
}

// Absence of an answer is not the same as absence of a listing. Where a call
// failed ... an owner lookup that never resolved, or a price read that errored
// ... the previous file's entry is carried forward rather than dropped, because
// dropping it would quietly return the work to its catalogue price.
let carried = 0;
try {
  const prev = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'listings.json'), 'utf8'));
  // matched by position: mapLimit's error object carries no id of its own
  const failedIds = new Set([
    ...all.filter((w, i) => typeof owners[i] !== 'string').map((w) => w.id),
    ...escrowed.filter((w, i) => !listed[i] || listed[i].__error).map((w) => w.id),
  ]);
  // OpenSea unreachable means its side is unknown, not empty
  if (osOut.skipped) {
    for (const [id, v] of Object.entries(prev.works || {})) if (v.venue === 'opensea') failedIds.add(id);
  }
  for (const id of failedIds) {
    if (!byId[id] && prev.works && prev.works[id]) { byId[id] = { ...prev.works[id], carried_forward: true }; carried++; }
  }
} catch (e) { /* no previous file, nothing to carry */ }

const payload = {
  _note: 'Live listing prices read from chain. Written by scripts/sync-listings.mjs; the site prefers these over the catalogue figure. Foundation only ... OpenSea listings live in an off-chain order book and need an API key.',
  generated: new Date().toISOString(),
  sources: OS_KEY ? ['foundation', 'opensea'] : ['foundation'],
  counts: { checked: all.length, owner_unresolved: unresolved, escrowed: escrowed.length, priced: priced.length, auction: auctions.length, errored: errored.length, opensea: osAdded, carried_forward: carried },
  works: byId,
};

if (DRY) {
  console.log(JSON.stringify(payload.counts, null, 1));
  const seen = new Map();
  for (const x of priced) {
    const k = `${x.slug} @ ${x.price_eth} ETH`;
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  for (const [k, n] of [...seen].sort()) console.log(`  ${n.toString().padStart(3)}  ${k}`);
  if (errored.length) console.log(`  ${errored.length} errored`);
} else {
  fs.writeFileSync(path.join(ROOT, 'data', 'listings.json'), JSON.stringify(payload, null, 1) + '\n');
  console.log(`wrote data/listings.json ... ${priced.length} priced, ${auctions.length} at auction`);
}
