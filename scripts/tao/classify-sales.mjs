#!/usr/bin/env node
/* Was this a sale, or was it a gift?
 *
 * The whole weight of TAO rests here. A sale takes back every day a holding
 * ever earned; a plain transfer leaves those days banked. Call a gift a sale
 * and a patron is punished for generosity. Call a sale a gift and the metric
 * means nothing.
 *
 * Consideration is read from the transaction the transfer sat in:
 *
 *   marketplace   a log from Seaport, Blur, LooksRare, Foundation and the
 *                 rest, kept as config. Their presence is the strong signal.
 *   WETH          a WETH transfer landing on the wallet that gave up the art
 *                 in the same transaction.
 *   ETH           value attached to the transaction, sent by someone other
 *                 than the wallet giving up the art. That is a hand-to-hand
 *                 sale with no marketplace in it. Sampling put this at about
 *                 one exit in fifty, so it is small but real.
 *
 * Anything else defaults to a plain transfer, which is the forgiving
 * direction, and is written down as ambiguous so it can be argued with rather
 * than quietly costing someone their total. Every verdict is recorded with its
 * reason in data/tao/sales.json.
 *
 *   node scripts/tao/classify-sales.mjs [--recheck]
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const RECHECK = process.argv.includes('--recheck');
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/source/tao.json'), 'utf8'));
const RPC = process.env.ETH_RPC || 'https://ethereum-rpc.publicnode.com';
const OUT = path.join(ROOT, 'data/tao/sales.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MARKET = new Map(Object.entries(CFG.marketplaces).filter(([k]) => k.startsWith('0x')));
const WETH = CFG.weth.toLowerCase();
const T721 = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const NOBODY = new Set(Object.keys(CFG.exclusions).filter((k) => k.startsWith('0x')));

// ---- every transaction in which a collector gave something up
const wanted = new Map();      // tx -> Set(seller)
for (const f of fs.readdirSync(path.join(ROOT, 'data/tao/e')).filter((n) => n.endsWith('.json'))) {
  const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/tao/e', f), 'utf8'));
  for (const [, from, , , , , tx] of d.events) {
    if (!from || NOBODY.has(from) || !tx) continue;
    if (!wanted.has(tx)) wanted.set(tx, new Set());
    wanted.get(tx).add(from);
  }
}

let cache = { _note: 'Sale classification per transaction. Rebuilt by scripts/tao/classify-sales.mjs.', tx: {} };
try { cache = { ...cache, ...JSON.parse(fs.readFileSync(OUT, 'utf8')) }; } catch (e) { /* first run */ }
const todo = [...wanted.keys()].filter((tx) => RECHECK || !cache.tx[tx]);
console.log(`${wanted.size} transactions where art left a collector, ${todo.length} to classify`);

async function receipts(hashes) {
  // receipt for the logs, transaction for the ETH it carried
  const body = hashes.flatMap((h, i) => [
    { jsonrpc: '2.0', id: i, method: 'eth_getTransactionReceipt', params: [h] },
    { jsonrpc: '2.0', id: hashes.length + i, method: 'eth_getTransactionByHash', params: [h] },
  ]);
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) { await sleep(900 * (i + 1)); continue; }
      const j = await r.json();
      if (!Array.isArray(j)) { await sleep(900 * (i + 1)); continue; }
      const out = new Map();
      for (const row of j) {
        if (!row || !row.result) continue;
        const i = row.id % hashes.length;
        const cur = out.get(hashes[i]) || {};
        if (row.id < hashes.length) cur.receipt = row.result; else cur.tx = row.result;
        out.set(hashes[i], cur);
      }
      return out;
    } catch (e) { await sleep(900 * (i + 1)); }
  }
  return new Map();
}

const verdict = (got, sellers) => {
  const rec = got && got.receipt;
  const tx = got && got.tx;
  if (!rec || !Array.isArray(rec.logs)) return { sale: false, why: 'no receipt ... treated as a transfer' };
  for (const l of rec.logs) {
    const a = String(l.address || '').toLowerCase();
    if (MARKET.has(a)) return { sale: true, why: MARKET.get(a) };
  }
  // WETH landing on the wallet that gave up the art is consideration
  for (const l of rec.logs) {
    if (String(l.address || '').toLowerCase() !== WETH) continue;
    if (!l.topics || l.topics[0] !== T721 || l.topics.length < 3) continue;
    const to = ('0x' + l.topics[2].slice(-40)).toLowerCase();
    if (sellers.has(to)) return { sale: true, why: 'WETH paid to the seller' };
  }
  /* ETH attached, sent by someone who is not the one giving up the art. A
     seller moving their own work between their own wallets pays gas, not
     value, so this does not catch them. */
  if (tx && tx.value && BigInt(tx.value) > 0n && !sellers.has(String(tx.from || '').toLowerCase())) {
    return { sale: true, why: 'ETH paid directly, no marketplace' };
  }
  return { sale: false, why: 'no marketplace and no payment found' };
};

let done = 0, sales = 0;
for (let i = 0; i < todo.length; i += 12) {
  const batch = todo.slice(i, i + 12);
  const recs = await receipts(batch);
  for (const tx of batch) {
    const v = verdict(recs.get(tx), wanted.get(tx));
    cache.tx[tx] = v;
    if (v.sale) sales++;
  }
  done += batch.length;
  if (done % 240 === 0) process.stderr.write(`  ${done}/${todo.length}, ${sales} sales so far\n`);
  await sleep(120);
}

cache.updated = new Date().toISOString();
fs.writeFileSync(OUT, JSON.stringify(cache, null, 1));

const all = Object.values(cache.tx);
const why = {};
for (const v of all) why[v.why] = (why[v.why] || 0) + 1;
console.log(`\n${all.length} transactions classified, ${all.filter((v) => v.sale).length} sales`);
for (const [w, n] of Object.entries(why).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${w}`);
