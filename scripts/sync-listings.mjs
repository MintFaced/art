#!/usr/bin/env node
/* Live listing prices, read from chain.
 *
 * The listing is the price. Where a work is listed on Foundation the price sits
 * on chain in the market contract, so there is nothing to keep in step by hand:
 * this reads it and writes data/listings.json, which the site prefers over the
 * catalogue figure.
 *
 * Foundation only, for now. Foundation escrows the token and stores the price,
 * so both are readable with an eth_call and no API key. OpenSea is the other
 * half and cannot be done this way: Seaport listings are signed orders held in
 * OpenSea's off-chain book, so they need an OPENSEA_API_KEY. When that key
 * exists, add a second reader here and merge into the same file.
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
  for (const id of failedIds) {
    if (!byId[id] && prev.works && prev.works[id]) { byId[id] = { ...prev.works[id], carried_forward: true }; carried++; }
  }
} catch (e) { /* no previous file, nothing to carry */ }

const payload = {
  _note: 'Live listing prices read from chain. Written by scripts/sync-listings.mjs; the site prefers these over the catalogue figure. Foundation only ... OpenSea listings live in an off-chain order book and need an API key.',
  generated: new Date().toISOString(),
  sources: ['foundation'],
  counts: { checked: all.length, owner_unresolved: unresolved, escrowed: escrowed.length, priced: priced.length, auction: auctions.length, errored: errored.length, carried_forward: carried },
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
