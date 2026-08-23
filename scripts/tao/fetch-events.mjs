#!/usr/bin/env node
/* The ownership history TAO is computed from.
 *
 * docs/TAO.md assumes the daily sweep already maintains this. It does not: the
 * sweep keeps who holds what now, plus a block cursor. Nothing anywhere kept
 * when a work changed hands, which is the one thing a time-weighted metric
 * needs. So this builds it, once, and extends it nightly.
 *
 * Two ways in, because the collections sit on two kinds of contract:
 *
 *   ours       Thirteen contracts Ryan deployed. Their entire log is MintFace
 *              work, so the whole range is swept from the deploy block and
 *              filtered to the tokens in the catalogue.
 *   shared     Five multi-artist contracts, the OpenSea Shared Storefront
 *              among them. Sweeping those means reading millions of other
 *              people's transfers, so history is read one token at a time.
 *
 * Events are cached per contract under data/tao/e and extended from a cursor.
 * Raw facts only ... no totals are stored anywhere, so TAO cannot drift.
 *
 *   node scripts/tao/fetch-events.mjs --dry
 *   node scripts/tao/fetch-events.mjs [--only=slug]
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const DRY = process.argv.includes('--dry');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1] || null;
const KEY = process.env.ETHERSCAN_API_KEY;
if (!KEY) { console.error('ETHERSCAN_API_KEY is not set'); process.exit(1); }

const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/source/tao.json'), 'utf8'));
const ES = 'https://api.etherscan.io/v2/api';
const BS = 'https://eth.blockscout.com/api/v2';
const OUT = path.join(ROOT, 'data/tao/e');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ERC-721 Transfer, ERC-1155 TransferSingle and TransferBatch
const T721 = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const T1155_ONE = '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62';
const T1155_MANY = '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb';

async function es(params) {
  const url = `${ES}?${new URLSearchParams({ chainid: '1', apikey: KEY, ...params })}`;
  for (let i = 0; i < 6; i++) {
    try {
      const j = await (await fetch(url)).json();
      if (j.status === '1') return j.result;
      if (j.message === 'No records found' || /no records/i.test(String(j.result))) return [];
      if (/rate limit|max calls/i.test(String(j.result))) { await sleep(1400); continue; }
      if (/window is too large|result window|more than 1000/i.test(String(j.result))) return '__SPLIT__';
      return [];
    } catch (e) { await sleep(800 * (i + 1)); }
  }
  return [];
}

// getLogs caps at 1000 rows, so a busy range is halved until it fits
async function sweep(addr, topic, from, to) {
  const r = await es({ module: 'logs', action: 'getLogs', address: addr, topic0: topic, fromBlock: String(from), toBlock: String(to), offset: '1000', page: '1' });
  await sleep(210);
  if (r === '__SPLIT__' || (Array.isArray(r) && r.length === 1000)) {
    if (from >= to) return Array.isArray(r) ? r : [];
    const mid = Math.floor((from + to) / 2);
    return (await sweep(addr, topic, from, mid)).concat(await sweep(addr, topic, mid + 1, to));
  }
  return Array.isArray(r) ? r : [];
}

async function deployBlock(addr) {
  const r = await es({ module: 'contract', action: 'getcontractcreation', contractaddresses: addr });
  await sleep(230);
  return Array.isArray(r) && r[0] ? Number(r[0].blockNumber) : 1;
}

async function head() {
  const r = await fetch('https://ethereum-rpc.publicnode.com', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
  });
  const n = parseInt((await r.json()).result, 16);
  if (!n || n < 25000000) throw new Error(`implausible head block: ${n}`);
  return n;
}

const addrOf = (topic) => ('0x' + topic.slice(-40)).toLowerCase();
const big = (hex) => BigInt(hex).toString();
const words = (data) => {
  const d = data.startsWith('0x') ? data.slice(2) : data;
  const out = [];
  for (let i = 0; i + 64 <= d.length; i += 64) out.push('0x' + d.slice(i, i + 64));
  return out;
};

/* ---------- what is in scope ---------- */
const skipCol = new Set(CFG.scope.exclude_collections);
const perToken = new Set(Object.keys(CFG.per_token_contracts).filter((k) => k.startsWith('0x')));
const targets = new Map();     // contract -> { std, tokens:Set, cols:Set }
for (const f of fs.readdirSync(path.join(ROOT, 'data/c')).filter((n) => n.endsWith('.json'))) {
  const col = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/c', f), 'utf8'));
  if (skipCol.has(col.slug)) continue;
  if (ONLY && col.slug !== ONLY) continue;
  for (const w of [...(col.works || []), ...(col.children || []).flatMap((c) => c.works || [])]) {
    const d = w.digital || {};
    if (!CFG.scope.chains.includes(d.chain) || !d.contract || d.token_id == null) continue;
    const a = d.contract.toLowerCase();
    if (!targets.has(a)) targets.set(a, { std: d.standard, tokens: new Set(), cols: new Set() });
    const t = targets.get(a);
    /* An edition minted as ERC-721 is one work spread over many token ids, and
       the record keeps them all in token_ids with one of them as the display
       id. Asking only for the display id finds a 72nd of Seize And Share. */
    const ids = w.token_ids && w.token_ids.length ? w.token_ids : [d.token_id];
    for (const id of ids) t.tokens.add(String(id));
    t.cols.add(col.slug);
  }
}

console.log(`${targets.size} contracts in scope, ${[...targets.values()].reduce((n, t) => n + t.tokens.size, 0)} tokens`);
const tip = await head();
console.log(`head block ${tip}`);

/* ---------- one contract ---------- */
async function viaLogs(addr, t, cached) {
  const from = cached.cursor ? cached.cursor + 1 : await deployBlock(addr);
  if (from > tip) return { events: [], from, to: tip };
  const topics = t.std === 'ERC-1155' ? [T1155_ONE, T1155_MANY] : [T721];
  const events = [];
  for (const topic of topics) {
    const logs = await sweep(addr, topic, from, tip);
    for (const l of logs) {
      const ts = Number(l.timeStamp) || parseInt(l.timeStamp, 16);
      const blk = Number(l.blockNumber) || parseInt(l.blockNumber, 16);
      if (topic === T721) {
        // an ERC-20 Transfer shares this signature but has no fourth topic
        if (!l.topics || l.topics.length < 4) continue;
        const id = big(l.topics[3]);
        if (!t.tokens.has(id)) continue;
        events.push([id, addrOf(l.topics[1]), addrOf(l.topics[2]), 1, ts, blk, l.transactionHash]);
      } else if (topic === T1155_ONE) {
        const w = words(l.data);
        if (w.length < 2) continue;
        const id = big(w[0]);
        if (!t.tokens.has(id)) continue;
        events.push([id, addrOf(l.topics[2]), addrOf(l.topics[3]), Number(BigInt(w[1])), ts, blk, l.transactionHash]);
      } else {
        // TransferBatch: two dynamic arrays, offsets then lengths then items
        const w = words(l.data);
        if (w.length < 4) continue;
        const idsAt = Number(BigInt(w[0])) / 32;
        const valsAt = Number(BigInt(w[1])) / 32;
        const n = Number(BigInt(w[idsAt] || '0x0'));
        for (let i = 0; i < n; i++) {
          const id = big(w[idsAt + 1 + i] || '0x0');
          if (!t.tokens.has(id)) continue;
          events.push([id, addrOf(l.topics[2]), addrOf(l.topics[3]), Number(BigInt(w[valsAt + 1 + i] || '0x0')), ts, blk, l.transactionHash]);
        }
      }
    }
  }
  return { events, from, to: tip };
}

async function viaToken(addr, t, cached) {
  // one token at a time; the contract belongs to many artists
  const events = [];
  const since = cached.cursor || 0;
  let done = 0;
  for (const id of t.tokens) {
    let next = {};
    for (let page = 0; page < 60; page++) {
      const qs = new URLSearchParams(next).toString();
      const url = `${BS}/tokens/${addr}/instances/${encodeURIComponent(id)}/transfers${qs ? '?' + qs : ''}`;
      let j = null;
      for (let i = 0; i < 4; i++) {
        try { const r = await fetch(url, { headers: { accept: 'application/json' } }); if (r.ok) { j = await r.json(); break; } if (r.status === 404) break; } catch (e) { /* retry */ }
        await sleep(700 * (i + 1));
      }
      if (!j || !j.items) break;
      let older = false;
      for (const it of j.items) {
        const blk = Number(it.block_number);
        if (blk <= since) { older = true; continue; }
        const ts = Math.floor(new Date(it.timestamp).getTime() / 1000);
        const qty = Number((it.total && it.total.value) || 1) || 1;
        events.push([String(id), String(it.from?.hash || '').toLowerCase(), String(it.to?.hash || '').toLowerCase(), qty, ts, blk, it.transaction_hash]);
      }
      if (older || !j.next_page_params) break;
      next = j.next_page_params;
      await sleep(130);
    }
    if (++done % 25 === 0) process.stderr.write(`    ${done}/${t.tokens.size} tokens\n`);
    await sleep(110);
  }
  return { events, from: since + 1, to: tip };
}

/* ---------- run ---------- */
let totalNew = 0;
const summary = [];
for (const [addr, t] of targets) {
  const file = path.join(OUT, `${addr}.json`);
  let cached = { contract: addr, standard: t.std, collections: [...t.cols], cursor: 0, events: [] };
  try { cached = { ...cached, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch (e) { /* first run */ }
  /* Reading a shared contract one token at a time is only worth it for the
     first backfill. Once there is a cursor, a day of that contract's log is
     small enough to sweep and filter like any other ... which is what keeps
     the nightly run in seconds rather than minutes. */
  const backfill = !cached.cursor;
  const how = perToken.has(addr) && backfill ? 'per-token' : 'sweep';
  process.stderr.write(`${addr} ${how.padEnd(9)} ${t.tokens.size} tokens ... `);

  const { events } = how === 'per-token' ? await viaToken(addr, t, cached) : await viaLogs(addr, t, cached);
  // a re-run must not double-count, and per-token paging can overlap a block
  const seen = new Set(cached.events.map((e) => `${e[0]}|${e[5]}|${e[6]}|${e[1]}|${e[2]}`));
  const fresh = events.filter((e) => !seen.has(`${e[0]}|${e[5]}|${e[6]}|${e[1]}|${e[2]}`));
  cached.events = cached.events.concat(fresh).sort((a, b) => a[5] - b[5] || a[4] - b[4]);
  cached.cursor = tip;
  cached.collections = [...t.cols];
  cached.standard = t.std;
  cached.updated = new Date().toISOString();
  process.stderr.write(`+${fresh.length} (${cached.events.length} total)\n`);
  totalNew += fresh.length;
  summary.push({ addr, how, tokens: t.tokens.size, fresh: fresh.length, total: cached.events.length, cols: [...t.cols].join(',') });
  if (!DRY) fs.writeFileSync(file, JSON.stringify(cached));
}

console.log(`\n${DRY ? 'DRY RUN' : 'WROTE'} ${summary.length} contracts, ${totalNew} new events`);
for (const s of summary) console.log(`  ${s.addr} ${String(s.total).padStart(6)} events  ${s.how.padEnd(9)} ${s.cols}`);
