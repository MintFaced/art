import { readFile, writeFile } from '../_lib/repo.js';

/* Daily. Re-reads the live listing prices from chain and commits them.
 *
 * The listing is the price, so this is what keeps the site honest: Ryan
 * reprices on Foundation and the site follows the next morning without anyone
 * touching the catalogue.
 *
 * Foundation only. Its market contract escrows the token and stores the price,
 * both readable with an eth_call. OpenSea's Seaport listings live in an
 * off-chain order book and need OPENSEA_API_KEY before they can be read at all.
 */
const RPCS = [
  'https://ethereum-rpc.publicnode.com',
  'https://eth.drpc.org',
  'https://1rpc.io/eth',
  'https://rpc.flashbots.net',
];
const FOUNDATION = '0xcDA72070E455bb31C7690a170224Ce43623d0B6f';
const SEL = { ownerOf: '0x6352211e', getBuyPrice: '0x4635256e', getReserveAuctionIdFor: '0x2ab2b52b' };

// a call that threw, as distinct from a call that answered "not listed"
const FAILED = Symbol('failed');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let rpcIdx = 0;
async function rpc(method, params) {
  let lastErr;
  for (let i = 0; i < 5; i++) {
    const url = RPCS[rpcIdx++ % RPCS.length];
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 20000);
      const res = await fetch(url, {
        method: 'POST', signal: ac.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      clearTimeout(t);
      const j = await res.json();
      if (j.error) throw new Error(j.error.message);
      return j.result;
    } catch (e) { lastErr = e; await sleep(300 * (i + 1)); }
  }
  throw new Error(String(lastErr));
}
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      try { out[k] = await fn(items[k]); } catch (e) { out[k] = FAILED; }
    }
  }));
  return out;
}
const padAddr = (a) => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
const padUint = (n) => BigInt(n).toString(16).padStart(64, '0');
const asAddr = (hex) => (hex && hex !== '0x' ? '0x' + hex.slice(-40) : null);
const isZero = (a) => !a || /^0x0+$/i.test(a);

export async function GET(request) {
  // fail closed, exactly as the reserves cron does
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (!secret) {
    if (process.env.VERCEL_ENV === 'production') return new Response('cron secret is not set', { status: 503 });
  } else if (auth !== `Bearer ${secret}`) {
    return new Response('no', { status: 401 });
  }

  const index = JSON.parse((await readFile('data/index.json')).text);
  const all = [];
  for (const c of index.collections || []) {
    if (c.slug === 'the-vault') continue;
    let col;
    try { col = JSON.parse((await readFile(`data/c/${c.slug}.json`)).text); } catch { continue; }
    for (const w of col.works || []) {
      const d = w.digital || {};
      if (d.chain !== 'ethereum' || d.standard !== 'ERC-721' || !d.contract || d.token_id == null) continue;
      all.push({ id: w.id, contract: d.contract, token_id: String(d.token_id) });
    }
  }

  const owners = await mapLimit(all, 16, (w) =>
    rpc('eth_call', [{ to: w.contract, data: SEL.ownerOf + padUint(w.token_id) }, 'latest']).then(asAddr));
  // a failed lookup reads the same as "not listed", which would drop a price, so
  // the failures are retried before anything is concluded from them
  const retry = owners.map((o, i) => (typeof o === 'string' ? -1 : i)).filter((i) => i >= 0);
  if (retry.length) {
    const again = await mapLimit(retry, 4, async (i) => {
      await sleep(120);
      return rpc('eth_call', [{ to: all[i].contract, data: SEL.ownerOf + padUint(all[i].token_id) }, 'latest']).then(asAddr);
    });
    retry.forEach((i, k) => { if (typeof again[k] === 'string') owners[i] = again[k]; });
  }
  const unresolved = owners.filter((o) => typeof o !== 'string').length;
  const escrowed = all.filter((w, i) => typeof owners[i] === 'string' && owners[i].toLowerCase() === FOUNDATION.toLowerCase());

  const rows = await mapLimit(escrowed, 10, async (w) => {
    const arg = padAddr(w.contract) + padUint(w.token_id);
    const bp = await rpc('eth_call', [{ to: FOUNDATION, data: SEL.getBuyPrice + arg }, 'latest']);
    const seller = bp && bp.length >= 66 ? '0x' + bp.slice(26, 66) : null;
    const wei = bp && bp.length >= 130 ? BigInt('0x' + bp.slice(66, 130)) : 0n;
    const url = `https://foundation.app/mint/eth/${w.contract}/${w.token_id}`;
    if (!isZero(seller) && wei > 0n) {
      return [w.id, { venue: 'foundation', kind: 'buy-now', price_eth: Number(wei) / 1e18, price_wei: wei.toString(), seller, url }];
    }
    const au = await rpc('eth_call', [{ to: FOUNDATION, data: SEL.getReserveAuctionIdFor + arg }, 'latest']);
    const id = au && au !== '0x' ? BigInt(au) : 0n;
    if (id > 0n) return [w.id, { venue: 'foundation', kind: 'auction', auction_id: id.toString(), url }];
    return null;
  });

  const works = Object.fromEntries(rows.filter((r) => Array.isArray(r)));

  const existing = await readFile('data/listings.json').catch(() => ({ sha: null, text: null }));
  let previous = null;
  try { previous = existing.text ? JSON.parse(existing.text) : null; } catch { previous = null; }

  // Absence of an answer is not absence of a listing. Anything whose owner or
  // price call failed keeps yesterday's entry, otherwise a flaky RPC run would
  // quietly drop the work back to its catalogue price.
  let carried = 0;
  if (previous && previous.works) {
    const failed = new Set([
      ...all.filter((w, i) => typeof owners[i] !== 'string').map((w) => w.id),
      ...escrowed.filter((w, i) => rows[i] === FAILED).map((w) => w.id),
    ]);
    for (const id of failed) {
      if (!works[id] && previous.works[id]) { works[id] = { ...previous.works[id], carried_forward: true }; carried++; }
    }
  }

  const priced = Object.values(works).filter((v) => v.kind === 'buy-now').length;
  const payload = {
    _note: 'Live listing prices read from chain. Written by api/cron/listings.js and scripts/sync-listings.mjs; the site prefers these over the catalogue figure.',
    generated: new Date().toISOString(),
    sources: ['foundation'],
    counts: { checked: all.length, owner_unresolved: unresolved, escrowed: escrowed.length, priced, auction: Object.keys(works).length - priced, carried_forward: carried },
    works,
  };

  // If a run resolved almost nothing the chain calls failed, and writing that
  // would wipe every price on the site. Better to leave yesterday's file alone.
  const had = previous ? Object.keys(previous.works || {}).length : 0;
  if (had && Object.keys(works).length < had * 0.5) {
    return new Response(JSON.stringify({ skipped: 'too few listings resolved, keeping the previous file', found: Object.keys(works).length, had }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  }

  // GitHub needs the current sha to replace a file rather than create one
  await writeFile('data/listings.json', JSON.stringify(payload, null, 1) + '\n',
    `Listings: ${priced} priced, ${payload.counts.auction} at auction`, existing.sha || undefined);
  return new Response(JSON.stringify(payload.counts), { status: 200, headers: { 'content-type': 'application/json' } });
}
