#!/usr/bin/env node
/* Add work that has been minted since the catalogue was last written.
 *
 * Patrimora 182 to 185 minted, sold, and never reached the site: the sweep
 * tracks tokens it already knows and had no way to notice a new one. This
 * closes that, and the same module runs inside the nightly cron so it stays
 * closed.
 *
 *   node scripts/discover-mints.mjs --dry
 *   node scripts/discover-mints.mjs [--from=BLOCK]
 */
import fs from 'node:fs';
import path from 'node:path';
import { mintsSince, readToken, buildRecord } from '../api/_lib/discover.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const DRY = process.argv.includes('--dry');
const FROM = Number((process.argv.find((a) => a.startsWith('--from=')) || '').split('=')[1]) || null;
const KEY = process.env.ETHERSCAN_API_KEY;
if (!KEY) { console.error('ETHERSCAN_API_KEY is not set'); process.exit(1); }
const RPC = process.env.ETH_RPC || 'https://ethereum-rpc.publicnode.com';
const BS = 'https://eth.blockscout.com/api/v2';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/source/open-mint.json'), 'utf8'));
const ARTIST = {
  '0xd40b63bf04a44e43fbfe5784bcf22acaab34a180': 'mintface.eth',
  '0xdd6b80649e8d472eb8fb52eb7eecfd2dc219ace7': 'ryanj.eth',
  '0x7110733ab02b2a18a947e3912bf54136fbced169': 'mintfaced.eth',
};
const VAULT = '0x6e420b64bb329be84a6627c68a7bdff825139773';
const ESCROW = new Set(['0xcda72070e455bb31c7690a170224ce43623d0b6f', '0xa9b3b278b8d8492fc5f27b78ac6e26a88202a9a5']);

async function es(params) {
  const url = `https://api.etherscan.io/v2/api?${new URLSearchParams({ chainid: '1', apikey: KEY, ...params })}`;
  for (let i = 0; i < 5; i++) {
    try {
      const j = await (await fetch(url)).json();
      if (j.status === '1') return j.result;
      if (j.message === 'No records found' || /no records/i.test(String(j.result))) return [];
      if (/rate limit|max calls/i.test(String(j.result))) { await sleep(1300); continue; }
      if (/window is too large|result window|more than 1000/i.test(String(j.result))) return '__SPLIT__';
      return [];
    } catch (e) { await sleep(700 * (i + 1)); }
  }
  return [];
}
async function head() {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }) });
  const n = parseInt((await r.json()).result, 16);
  if (!n || n < 25000000) throw new Error(`implausible head block: ${n}`);
  return n;
}
async function who(addr) {
  try {
    const r = await fetch(`${BS}/addresses/${addr}`, { headers: { accept: 'application/json' } });
    if (!r.ok) return { address: addr, ens: null };
    const j = await r.json();
    return { address: j.hash || addr, ens: j.ens_domain_name || null };
  } catch (e) { return { address: addr, ens: null }; }
}

const HEAD = await head();
const report = [];

for (const [contract, c] of Object.entries(CFG.contracts)) {
  const p = path.join(ROOT, `data/c/${c.collection}.json`);
  let col;
  try { col = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { console.log(`  ${c.collection}: no collection file`); continue; }
  const known = new Set((col.works || []).map((w) => String((w.digital || {}).token_id)));

  // from the deploy block on the first run, from the cursor after that
  const from = FROM || CFG.cursor[contract] || 1;
  process.stderr.write(`${c.collection}: reading births from block ${from} ... `);
  const mints = await mintsSince({ contract, fromBlock: from, toBlock: HEAD, es });
  const fresh = mints.filter((m) => !known.has(m.tokenId));
  process.stderr.write(`${mints.length} mints, ${fresh.length} new\n`);

  const added = [];
  for (const m of fresh) {
    const { owner, md } = await readToken({ contract, tokenId: m.tokenId, standard: c.standard, rpc: RPC });
    await sleep(150);
    const rec = buildRecord({
      collection: c.collection, contract: col.contracts?.[0]?.address || contract, standard: c.standard,
      tokenId: m.tokenId, titlePattern: c.title, mint: m, owner: owner || m.to, md,
      artist: ARTIST, vault: VAULT, escrow: ESCROW,
    });
    if (rec.collector && rec.collector.address) {
      const id = await who(rec.collector.address);
      rec.collector.address = id.address;
      rec.collector.ens = id.ens;
      await sleep(120);
    }
    added.push(rec);
  }

  if (added.length && !DRY) {
    col.works = [...(col.works || []), ...added];
    const tally = {};
    for (const w of col.works) if (w.status) tally[w.status] = (tally[w.status] || 0) + 1;
    // unique_works is derived, and a new 1/1 is one more of them
    const uniq = col.works.filter((w) => !((w.edition || {}).type && w.edition.type !== '1/1')).length;
    col.counts = { ...col.counts, works: col.works.length, ...tally,
      ...(col.counts && col.counts.unique_works != null ? { unique_works: uniq } : {}) };
    fs.writeFileSync(p, JSON.stringify(col, null, 1) + '\n');
  }
  if (!DRY) CFG.cursor[contract] = HEAD;
  report.push({ collection: c.collection, found: fresh.length, added });
}

if (!DRY) fs.writeFileSync(path.join(ROOT, 'data/source/open-mint.json'), JSON.stringify(CFG, null, 1) + '\n');

console.log(DRY ? '\nDRY RUN' : '\nWROTE');
for (const r of report) {
  console.log(`  ${r.collection.padEnd(14)} ${r.found} new`);
  for (const w of r.added) {
    console.log(`    ${w.id.padEnd(18)} ${String(w.title).padEnd(20)} ${w.status.padEnd(10)}`
      + `${w.collector ? (w.collector.ens || w.collector.address.slice(0, 10)) : (w.held_by || '')}`
      + `${w.digital.image ? '' : '   NO IMAGE'}`);
  }
}
