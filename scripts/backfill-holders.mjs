#!/usr/bin/env node
/* Holder rows, rebuilt from the transfer log.
 *
 * Most edition records carry a holders[] list with no acquisition date on it:
 * the Phase 1 enumeration read who held a token but not when they got it. That
 * is why a collector who holds only Seize And Share editions sorts last under
 * "most recent" on collectors.mintface.art ... there is no date to sort on.
 *
 * This sweeps each contract's transfer log and rebuilds the list from it, so
 * every row says who holds the token and when it reached them. Names already
 * on a row (an ENS, one of Ryan's display names) are carried across by address.
 *
 *   node scripts/backfill-holders.mjs --dry     # report only
 *   node scripts/backfill-holders.mjs           # write
 *
 * ERC-721 and ERC-1155 on Ethereum, read from the transfer log. FROGDNA is
 * Counterparty on Bitcoin, which keeps no such log ... but tokenscan publishes
 * the asset's sends, and the most recent send to an address is when that holder
 * got theirs, so it is dated the same way from a different book.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DRY = process.argv.includes('--dry');
const KEY = process.env.ETHERSCAN_API_KEY;
if (!KEY) { console.error('ETHERSCAN_API_KEY is not set'); process.exit(1); }

const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';        // ERC-721 Transfer
const SINGLE   = '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62';        // TransferSingle
const BATCH    = '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb';        // TransferBatch
const ARTIST = new Set([
  '0xd40b63bf04a44e43fbfe5784bcf22acaab34a180',
  '0xdd6b80649e8d472eb8fb52eb7eecfd2dc219ace7',
  '0x7110733ab02b2a18a947e3912bf54136fbced169',
]);
const VAULT = '0x6e420b64bb329be84a6627c68a7bdff825139773';
const BURN = new Set(['0x0000000000000000000000000000000000000000', '0x000000000000000000000000000000000000dead']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function es(params) {
  const url = `https://api.etherscan.io/v2/api?${new URLSearchParams({ chainid: '1', apikey: KEY, ...params })}`;
  for (let i = 0; i < 6; i++) {
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
async function sweep(addr, topic, from, to) {
  const r = await es({ module: 'logs', action: 'getLogs', address: addr, topic0: topic, fromBlock: String(from), toBlock: String(to), offset: '1000', page: '1' });
  await sleep(220);
  if (r === '__SPLIT__' || (Array.isArray(r) && r.length === 1000)) {
    if (from >= to) return Array.isArray(r) ? r : [];
    const mid = Math.floor((from + to) / 2);
    return (await sweep(addr, topic, from, mid)).concat(await sweep(addr, topic, mid + 1, to));
  }
  return Array.isArray(r) ? r : [];
}
async function head() {
  const r = await fetch('https://ethereum-rpc.publicnode.com', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
  });
  const n = parseInt((await r.json()).result, 16);
  if (!n || n < 25000000) throw new Error(`implausible head block: ${n}`);
  return n + 50;
}
async function deployBlock(addr) {
  const r = await es({ module: 'contract', action: 'getcontractcreation', contractaddresses: addr });
  await sleep(230);
  return Array.isArray(r) && r[0] ? Number(r[0].blockNumber) || 0 : 0;
}

const ts = (l) => new Date(parseInt(l.timeStamp, 16) * 1000).toISOString();
const order = (a, b) => parseInt(a.blockNumber, 16) - parseInt(b.blockNumber, 16) || parseInt(a.logIndex, 16) - parseInt(b.logIndex, 16);
const addrOf = (topic) => ('0x' + topic.slice(-40)).toLowerCase();

/* ERC-721: the last transfer into an address is when they got that token. */
async function erc721(addr, from, to) {
  const logs = (await sweep(addr, TRANSFER, from, to)).filter((l) => l.topics && l.topics.length >= 4).sort(order);
  const owner = new Map();
  for (const l of logs) owner.set(BigInt(l.topics[3]).toString(), { to: addrOf(l.topics[2]), at: ts(l) });
  return owner;   // tokenId -> { to, at }
}

/* ERC-1155: a shared contract can carry a hundred thousand transfers for other
   people's tokens, and sweeping all of that to date a dozen rows of ours is
   absurd. Blockscout will give the transfers of one token instance, so each
   work asks only about itself. Balances then say who still holds one, dated by
   the receipt that brought it. */
const BS = 'https://eth.blockscout.com/api/v2';
async function instanceTransfers(contract, id) {
  const out = [];
  let next = null;
  for (let page = 0; page < 40; page++) {
    const qs = next ? '?' + new URLSearchParams(next) : '';
    let j = null;
    for (let i = 0; i < 4 && !j; i++) {
      try {
        const r = await fetch(`${BS}/tokens/${contract}/instances/${encodeURIComponent(id)}/transfers${qs}`, { headers: { accept: 'application/json' } });
        if (r.ok) j = await r.json(); else if (r.status === 404) return out; else await sleep(600 * (i + 1));
      } catch (e) { await sleep(600 * (i + 1)); }
    }
    if (!j || !j.items) break;
    out.push(...j.items);
    if (!j.next_page_params) break;
    next = j.next_page_params;
    await sleep(140);
  }
  return out;
}

/* Balances come from the transfer stream, and are then checked against the
   contract. Not the other way round: Blockscout's holder list omits twenty of
   the forty-seven holders of Geodetic Moment Light, all of whom balanceOf()
   confirms, so the indexer is the thing that needs checking here.

   totalSupply(id) is the arbiter. If the derived balances do not sum to it, the
   work is left exactly as it was and reported rather than written. */
const RPCS = ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org', 'https://1rpc.io/eth'];
let rpcIdx = 0;
async function rpc(method, params) {
  for (let k = 0; k < 5; k++) {
    try {
      const r = await fetch(RPCS[rpcIdx++ % RPCS.length], {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message || 'rpc error');
      return j.result;
    } catch (e) { await sleep(400 * (k + 1)); }
  }
  return null;
}
const padU = (n) => BigInt(n).toString(16).padStart(64, '0');
/* Every 1155 contract in this catalogue implements totalSupply(uint256), so a
   missing answer is always a failed call and never a contract that has none.
   That matters: if a rate limit could pass for "no arbiter", the check would
   quietly switch itself off and let unverified rows through. It returns null
   only when it truly could not ask, and null means refuse. */
async function totalSupply(contract, id) {
  for (let k = 0; k < 8; k++) {
    const r = await rpc('eth_call', [{ to: contract, data: '0xbd85b039' + padU(id) }, 'latest']);
    if (typeof r === 'string' && /^0x[0-9a-f]+$/i.test(r) && r !== '0x') {
      try { return Number(BigInt(r)); } catch (e) { /* fall through and ask again */ }
    }
    await sleep(500 * (k + 1));
  }
  return null;
}

// the indexer's own holder list, used as the second opinion
async function instanceHolders(contract, id) {
  const out = [];
  let next = null;
  for (let page = 0; page < 40; page++) {
    const qs = next ? '?' + new URLSearchParams(next) : '';
    let j = null;
    for (let i = 0; i < 4 && !j; i++) {
      try {
        const r = await fetch(`${BS}/tokens/${contract}/instances/${encodeURIComponent(id)}/holders${qs}`, { headers: { accept: 'application/json' } });
        if (r.ok) j = await r.json(); else if (r.status === 404) return out; else await sleep(600 * (i + 1));
      } catch (e) { await sleep(600 * (i + 1)); }
    }
    if (!j || !j.items) break;
    out.push(...j.items);
    if (!j.next_page_params) break;
    next = j.next_page_params;
    await sleep(140);
  }
  return out;
}

async function erc1155Instance(contract, id) {
  const fresh = await instanceTransfers(contract, id);      // newest first
  const items = fresh.slice().reverse();                   // oldest first, for balances
  const bal = new Map();
  const move = (who, n, at) => {
    if (!who || BURN.has(who)) return;
    const cur = bal.get(who) || { n: 0n, at: null };
    cur.n += n;
    if (n > 0n) cur.at = at;
    if (cur.n <= 0n) { cur.n = 0n; cur.at = null; }
    bal.set(who, cur);
  };
  for (const t of items) {
    const v = BigInt(t.total && t.total.value != null ? t.total.value : 1);
    move(String(t.from?.hash || '').toLowerCase(), -v, t.timestamp);
    move(String(t.to?.hash || '').toLowerCase(), v, t.timestamp);
  }
  const rows = [...bal.entries()].filter(([, v]) => v.n > 0n)
    .map(([address, v]) => ({ address, qty: Number(v.n), at: v.at }));

  /* Neither source is reliable on its own. Blockscout's holder list omits
     twenty of Geodetic Moment Light's forty-seven; its transfer list is short
     for 2022 10k, whose supply runs to a thousand. So both are tried and the
     contract decides: whichever adds up to totalSupply is the true one. If
     neither does, the work is left exactly as it was. */
  const supply = await totalSupply(contract, id);
  const sum = (rs) => rs.reduce((n, r) => n + r.qty, 0);
  if (supply == null) {
    process.stderr.write(`  !! ${contract} #${id}: could not read totalSupply ... left alone\n`);
    return null;                        // unverifiable is not the same as verified
  }
  if (sum(rows) === supply) return rows;

  const listed = (await instanceHolders(contract, id)).map((h) => ({
    address: String(h.address?.hash || '').toLowerCase(),
    qty: Number(h.value || 0),
    at: null,
  })).filter((x) => x.address && x.qty > 0);
  if (listed.length && sum(listed) === supply) {
    // dates from whatever transfers were visible; a holder we never saw arrive stays undated
    const got = new Map();
    for (const t of fresh) {
      const to = String(t.to?.hash || '').toLowerCase();
      if (to && !got.has(to)) got.set(to, t.timestamp);
    }
    for (const r of listed) r.at = got.get(r.address) || null;
    process.stderr.write(`  ${contract} #${id}: transfers were short, took the holder list (${supply})\n`);
    return listed;
  }
  process.stderr.write(`  !! ${contract} #${id}: derived ${sum(rows)}, listed ${sum(listed)}, totalSupply ${supply} ... left alone\n`);
  return null;
}

const statusOf = (a) => (ARTIST.has(a) ? 'artist_held' : (a === VAULT ? 'vaulted' : 'acquired'));

const files = fs.readdirSync(path.join(ROOT, 'data/c')).filter((n) => n.endsWith('.json'));
const contracts = new Map();   // address -> { standard, works: [{file, work}] }
for (const f of files) {
  const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/c', f), 'utf8'));
  if (d.slug === 'the-vault') continue;
  for (const w of d.works || []) {
    if (!(w.holders || []).length) continue;
    const dg = w.digital || {};
    if (dg.chain !== 'ethereum' || !dg.contract) continue;
    const a = dg.contract.toLowerCase();
    if (!contracts.has(a)) contracts.set(a, { standard: dg.standard, works: [] });
    contracts.get(a).works.push({ file: f, slug: d.slug, work: w });
  }
}

const HEAD = await head();
const report = [];
const touched = new Set();
const docs = new Map();   // file -> parsed

for (const [addr, c] of contracts) {
  const from = await deployBlock(addr);
  process.stderr.write(`${addr} ${c.standard} ... `);
  let filled = 0, rows = 0;
  if (c.standard === 'ERC-721') {
    const owner = await erc721(addr, from, HEAD);
    for (const { file, work } of c.works) {
      const ids = work.token_ids && work.token_ids.length ? work.token_ids : [(work.digital || {}).token_id];
      const names = new Map((work.holders || []).map((h) => [String(h.address || '').toLowerCase(), h]));
      /* One row per holder, not per token. That is the convention everywhere
         except the Roads & Rivers Traffic record, whose own edition.holders
         count disagrees with its rows ... so it is the anomaly, and this
         brings it into line. qty says how many they hold; the date is the most
         recent receipt, when their present holding was established. */
      const held = new Map();
      for (const id of ids) {
        const o = owner.get(String(id));
        if (!o || BURN.has(o.to)) continue;
        const cur = held.get(o.to) || { qty: 0, at: null };
        cur.qty += 1;
        if (!cur.at || o.at > cur.at) cur.at = o.at;
        held.set(o.to, cur);
      }
      const next = [...held.entries()].map(([a, v]) => {
        const prev = names.get(a) || {};
        return { address: prev.address || a, ens: prev.ens || null, display_name: prev.display_name || null, qty: v.qty, acquired: v.at, status: statusOf(a) };
      });
      if (!next.length) continue;
      rows += next.length;
      filled += next.filter((h) => h.acquired).length;
      work.__holders = next;
      touched.add(file);
    }
  } else if (c.standard === 'ERC-1155') {
    for (const { file, work } of c.works) {
      const id = String((work.digital || {}).token_id);
      const list = await erc1155Instance(addr, id);
      if (!list || !list.length) continue;
      const names = new Map((work.holders || []).map((h) => [String(h.address || '').toLowerCase(), h]));
      const next = list.map((x) => {
        const prev = names.get(x.address) || {};
        return { address: prev.address || x.address, ens: prev.ens || null, display_name: prev.display_name || null, qty: x.qty, acquired: x.at, status: statusOf(x.address) };
      });
      rows += next.length;
      filled += next.filter((h) => h.acquired).length;
      work.__holders = next;
      touched.add(file);
    }
  }
  process.stderr.write(`${rows} rows, ${filled} dated\n`);
  report.push({ addr, standard: c.standard, rows, filled });
}

/* FROGDNA, on Counterparty. Same idea, different ledger: the asset's send list
   gives who received what and when. The issuing address holds the remainder and
   has no send to date it, so it stays undated ... it never left home. */
async function frogdna() {
  const out = new Map();
  try {
    const j = await (await fetch('https://tokenscan.io/api/sends/FROGDNA')).json();
    for (const s of (j.data || []).slice().sort((a, b) => a.block_index - b.block_index)) {
      if (s.status !== 'valid' || !s.destination) continue;
      out.set(s.destination, new Date(Number(s.timestamp) * 1000).toISOString());
    }
  } catch (e) { process.stderr.write(`frogdna sends unavailable: ${e.message}\n`); }
  return out;
}
const FROG = await frogdna();
{
  const p = path.join(ROOT, 'data/c/frogdna.json');
  const raw = fs.readFileSync(p, 'utf8');
  const d = JSON.parse(raw);
  let n = 0, rows = 0;
  for (const w of d.works || []) {
    for (const h of w.holders || []) {
      rows++;
      const at = FROG.get(h.address);
      if (at && !h.acquired) { if (!DRY) h.acquired = at; n++; }
    }
  }
  if (n && !DRY) fs.writeFileSync(p, JSON.stringify(d, null, 1) + (raw.endsWith('\n') ? '\n' : ''));
  report.push({ addr: 'FROGDNA (Counterparty)', standard: 'sends', rows, filled: n });
}

// apply
let before = 0, after = 0;
for (const f of files) {
  const p = path.join(ROOT, 'data/c', f);
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (d.slug === 'the-vault') continue;
  let changed = false;
  for (const w of d.works || []) {
    const src = (contracts.get(String((w.digital || {}).contract || '').toLowerCase())?.works || [])
      .find((x) => x.work.id === w.id);
    const next = src && src.work.__holders;
    if (!next) { before += (w.holders || []).filter((h) => h.acquired).length; continue; }
    before += (w.holders || []).filter((h) => h.acquired).length;
    after += next.filter((h) => h.acquired).length;
    if (!DRY) { w.holders = next; changed = true; }
  }
  if (changed && !DRY) {
    const raw = fs.readFileSync(p, 'utf8');
    fs.writeFileSync(p, JSON.stringify(d, null, 1) + (raw.endsWith('\n') ? '\n' : ''));
  }
}

console.log(`\n${DRY ? 'DRY RUN' : 'WROTE'}`);
for (const r of report) console.log(`  ${r.addr} ${r.standard.padEnd(8)} ${String(r.rows).padStart(5)} rows  ${String(r.filled).padStart(5)} dated`);
console.log(`\nholder rows with a date: ${before} -> ${after}`);
