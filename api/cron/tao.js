import { readFile, writeFile } from '../_lib/repo.js';
import { computeTao } from '../_lib/tao.js';
import { deriveCollectors } from '../_lib/collectors.js';

/* TAO, nightly.
 *
 * Unlike the ownership sweep, this has something to do every single night even
 * when nothing has moved: TAO is a measure of time, so every holding is worth
 * more today than yesterday. The recompute is the point; new events are the
 * smaller half of the job.
 *
 * Everything is recomputed from the whole event history each run. No running
 * total is kept anywhere, so a total cannot drift, and a bad night can be
 * fixed by fixing the events rather than by unpicking arithmetic.
 *
 * Reads the cached history over HTTP from the deployed site, which is cheap and
 * has no API limits, and writes back through the repo only what changed.
 */

const ETHERSCAN = 'https://api.etherscan.io/v2/api';
const T721 = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const T1155_ONE = '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62';
const T1155_MANY = '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb';
const RPC = process.env.ETH_RPC || 'https://ethereum-rpc.publicnode.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function es(params, key) {
  const url = `${ETHERSCAN}?${new URLSearchParams({ chainid: '1', apikey: key, ...params })}`;
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
async function sweep(addr, topic, from, to, key) {
  const r = await es({ module: 'logs', action: 'getLogs', address: addr, topic0: topic, fromBlock: String(from), toBlock: String(to), offset: '1000', page: '1' }, key);
  await sleep(200);
  if (r === '__SPLIT__' || (Array.isArray(r) && r.length === 1000)) {
    if (from >= to) return Array.isArray(r) ? r : [];
    const mid = Math.floor((from + to) / 2);
    return (await sweep(addr, topic, from, mid, key)).concat(await sweep(addr, topic, mid + 1, to, key));
  }
  return Array.isArray(r) ? r : [];
}
async function head() {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }) });
  const n = parseInt((await r.json()).result, 16);
  if (!n || n < 25000000) throw new Error(`implausible head block: ${n}`);
  return n;
}
const addrOf = (t) => ('0x' + t.slice(-40)).toLowerCase();
const words = (data) => {
  const d = data.startsWith('0x') ? data.slice(2) : data;
  const out = [];
  for (let i = 0; i + 64 <= d.length; i += 64) out.push('0x' + d.slice(i, i + 64));
  return out;
};

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (!secret) {
    if (process.env.VERCEL_ENV === 'production') return new Response('cron secret is not set', { status: 503 });
  } else if (auth !== `Bearer ${secret}`) {
    return new Response('no', { status: 401 });
  }
  const key = process.env.ETHERSCAN_API_KEY;
  if (!key) return new Response('ETHERSCAN_API_KEY is not set', { status: 503 });

  const url = new URL(request.url);
  const dry = url.searchParams.get('dry') === '1';
  const site = process.env.SITE_ORIGIN || 'https://mintface.art';
  const get = async (p) => {
    const r = await fetch(`${site}/${p}`, { headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error(`${p}: ${r.status}`);
    return r.json();
  };

  const CFG = await get('data/source/tao.json');
  const index = await get('data/index.json');
  const skip = new Set(CFG.scope.exclude_collections);
  const nobody = new Set(Object.keys(CFG.exclusions).filter((k) => k.startsWith('0x')));

  // ---- the catalogue, and what each token id is
  const collections = [];
  const tokens = new Map();
  const targets = new Map();
  for (const c of index.collections || []) {
    if (skip.has(c.slug)) continue;
    let col;
    try { col = await get(`data/c/${c.slug}.json`); } catch (e) { continue; }
    collections.push(col);
    for (const w of [...(col.works || []), ...(col.children || []).flatMap((x) => x.works || [])]) {
      const d = w.digital || {};
      if (!CFG.scope.chains.includes(d.chain) || !d.contract || d.token_id == null) continue;
      const unique = !((w.edition || {}).type && w.edition.type !== '1/1');
      const ids = w.token_ids && w.token_ids.length ? w.token_ids : [d.token_id];
      const a = d.contract.toLowerCase();
      if (!targets.has(a)) targets.set(a, { std: d.standard, tokens: new Set() });
      for (const id of ids) {
        tokens.set(`${a}|${id}`, { unique, work: w.id, collection: col.slug });
        targets.get(a).tokens.add(String(id));
      }
    }
  }

  // ---- extend the history
  const HEAD = await head();
  const files = new Map();
  let fresh = 0;
  for (const [addr, t] of targets) {
    let cached = null;
    try { cached = await get(`data/tao/e/${addr}.json`); } catch (e) { /* never backfilled */ }
    // the first backfill reads shared contracts one token at a time and is far
    // too slow for a function; scripts/tao/fetch-events.mjs does that by hand
    if (!cached || !cached.cursor) continue;
    const from = cached.cursor + 1;
    if (from > HEAD) { files.set(addr, { data: cached, changed: false }); continue; }
    const topics = t.std === 'ERC-1155' ? [T1155_ONE, T1155_MANY] : [T721];
    const found = [];
    for (const topic of topics) {
      for (const l of await sweep(addr, topic, from, HEAD, key)) {
        const ts = Number(l.timeStamp) || parseInt(l.timeStamp, 16);
        const blk = Number(l.blockNumber) || parseInt(l.blockNumber, 16);
        if (topic === T721) {
          if (!l.topics || l.topics.length < 4) continue;
          const id = BigInt(l.topics[3]).toString();
          if (!t.tokens.has(id)) continue;
          found.push([id, addrOf(l.topics[1]), addrOf(l.topics[2]), 1, ts, blk, l.transactionHash]);
        } else if (topic === T1155_ONE) {
          const w = words(l.data);
          if (w.length < 2) continue;
          const id = BigInt(w[0]).toString();
          if (!t.tokens.has(id)) continue;
          found.push([id, addrOf(l.topics[2]), addrOf(l.topics[3]), Number(BigInt(w[1])), ts, blk, l.transactionHash]);
        } else {
          const w = words(l.data);
          if (w.length < 4) continue;
          const idsAt = Number(BigInt(w[0])) / 32;
          const valsAt = Number(BigInt(w[1])) / 32;
          const n = Number(BigInt(w[idsAt] || '0x0'));
          for (let i = 0; i < n; i++) {
            const id = BigInt(w[idsAt + 1 + i] || '0x0').toString();
            if (!t.tokens.has(id)) continue;
            found.push([id, addrOf(l.topics[2]), addrOf(l.topics[3]), Number(BigInt(w[valsAt + 1 + i] || '0x0')), ts, blk, l.transactionHash]);
          }
        }
      }
    }
    const seen = new Set(cached.events.map((e) => `${e[0]}|${e[5]}|${e[6]}|${e[1]}|${e[2]}`));
    const add = found.filter((e) => !seen.has(`${e[0]}|${e[5]}|${e[6]}|${e[1]}|${e[2]}`));
    cached.events = cached.events.concat(add).sort((a, b) => a[5] - b[5] || a[4] - b[4]);
    cached.cursor = HEAD;
    cached.updated = new Date().toISOString();
    fresh += add.length;
    files.set(addr, { data: cached, changed: add.length > 0 });
  }

  // ---- classify anything new that left a collector
  let sales = { _note: 'Sale classification per transaction.', tx: {} };
  try { sales = await get('data/tao/sales.json'); } catch (e) { /* first run */ }
  const market = new Map(Object.entries(CFG.marketplaces).filter(([k]) => k.startsWith('0x')));
  const weth = String(CFG.weth).toLowerCase();
  const need = new Map();
  for (const { data } of files.values()) {
    for (const [, from, , , , , tx] of data.events) {
      if (!from || nobody.has(from) || !tx || sales.tx[tx]) continue;
      if (!need.has(tx)) need.set(tx, new Set());
      need.get(tx).add(from);
    }
  }
  let classified = 0;
  const list = [...need.keys()].slice(0, 400);        // a night's worth; the rest waits for tomorrow
  for (let i = 0; i < list.length; i += 12) {
    const batch = list.slice(i, i + 12);
    let recs = [];
    try {
      const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(batch.map((h, n) => ({ jsonrpc: '2.0', id: n, method: 'eth_getTransactionReceipt', params: [h] }))) });
      recs = await r.json();
    } catch (e) { recs = []; }
    const byId = new Map((Array.isArray(recs) ? recs : []).map((r) => [r.id, r.result]));
    for (let n = 0; n < batch.length; n++) {
      const rec = byId.get(n);
      const sellers = need.get(batch[n]);
      let v = { sale: false, why: 'no marketplace and no payment found' };
      if (!rec || !Array.isArray(rec.logs)) v = { sale: false, why: 'no receipt ... treated as a transfer' };
      else {
        const hit = rec.logs.find((l) => market.has(String(l.address || '').toLowerCase()));
        if (hit) v = { sale: true, why: market.get(String(hit.address).toLowerCase()) };
        else if (rec.logs.some((l) => String(l.address || '').toLowerCase() === weth && l.topics
          && l.topics[0] === T721 && l.topics.length >= 3 && sellers.has(addrOf(l.topics[2])))) {
          v = { sale: true, why: 'WETH paid to the seller' };
        }
      }
      sales.tx[batch[n]] = v;
      classified++;
    }
    await sleep(110);
  }

  // ---- recompute, always
  const events = [];
  for (const [addr, { data }] of files) {
    for (const [token, from, to, qty, ts, blk, tx] of data.events) {
      events.push({ contract: addr, token, from, to, qty: Number(qty) || 1, ts, block: blk, tx,
        sale: Boolean(sales.tx[tx] && sales.tx[tx].sale) });
    }
  }
  events.sort((a, b) => a.ts - b.ts || a.block - b.block);
  const now = Math.floor(Date.now() / 1000);
  const { wallets, exits } = computeTao(events, tokens, CFG, now);
  const held = wallets.filter((w) => w.tao_total > 0);

  const tao = {
    _note: 'TAO, recomputed in full from data/tao/e on every run. Nothing here is edited by hand ... see docs/TAO.md.',
    generated: new Date(now * 1000).toISOString(),
    rates: CFG.rates,
    counts: {
      wallets: held.length, events: events.length, exits: exits.length,
      sales: exits.filter((e) => e.verdict === 'sale').length,
      transfers: exits.filter((e) => e.verdict === 'transfer').length,
      tao_live: held.reduce((n, w) => n + w.tao_total, 0),
      tao_lost_to_sales: Math.round(wallets.reduce((n, w) => n + w.tao_lost, 0)),
    },
    wallets: Object.fromEntries(held.map((w) => [w.address, { tao: w.tao_total, rate: w.tao_rate, lost: w.tao_lost, sales: w.sales, works: w.works }])),
  };

  let wrote = 0;
  if (!dry) {
    const put = async (path, body, msg) => {
      const cur = await readFile(path).catch(() => ({ sha: null }));
      await writeFile(path, JSON.stringify(body, null, 1) + '\n', msg, cur.sha || undefined);
      wrote++;
    };
    for (const [addr, f] of files) {
      if (!f.changed) continue;
      const cur = await readFile(`data/tao/e/${addr}.json`).catch(() => ({ sha: null }));
      await writeFile(`data/tao/e/${addr}.json`, JSON.stringify(f.data), `TAO events: ${addr.slice(0, 10)}`, cur.sha || undefined);
      wrote++;
    }
    if (classified) await put('data/tao/sales.json', sales, `TAO: ${classified} transactions classified`);
    await put('data/tao.json', tao, `TAO: ${tao.counts.wallets} wallets, ${tao.counts.tao_live.toLocaleString('en-NZ')} live`);

    // the collector index carries TAO, so it is rewritten with it
    try {
      const titleOf = new Map((index.collections || []).map((c) => [c.slug, c.title]));
      let priv = new Set();
      try { priv = new Set((((await get('data/source/collectors-private.json')).wallets) || []).map((w) => String(w).toLowerCase())); } catch (e) { /* nobody */ }
      const d = deriveCollectors(collections, titleOf, priv, tao);
      await put('data/collectors.json', d.index, `Collectors: TAO to ${tao.generated.slice(0, 10)}`);
    } catch (e) { /* the index keeps yesterday's TAO rather than none */ }
  }

  const top = held.slice(0, 5).map((w) => `${w.address.slice(0, 10)} ${w.tao_total}`).join(', ');
  const summary = `tao: ${tao.counts.wallets} wallets, ${tao.counts.tao_live} live, ${fresh} new events, `
    + `${classified} transactions classified, ${tao.counts.sales} sales on record, ${wrote} files written`;
  console.log(summary);
  return new Response(JSON.stringify({ summary, top, dry, head: HEAD, counts: tao.counts }, null, 1),
    { status: 200, headers: { 'content-type': 'application/json' } });
}
