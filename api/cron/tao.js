import { readFile, writeFile } from '../_lib/repo.js';
import { computeTao } from '../_lib/tao.js';
import { deriveCollectors, registerFile } from '../_lib/collectors.js';
import { loadRuns, saveRuns, hoursSince } from '../_lib/runs.js';
import { send } from '../_lib/email.js';

/* TAO, nightly, in three phases.
 *
 * Unlike the ownership sweep, this has something to do every single night even
 * when nothing has moved: TAO is a measure of time, so every holding is worth
 * more today than yesterday. The recompute is the point; new events are the
 * smaller half of the job.
 *
 *   A. the ownership diff, before any arithmetic. What moved since the last
 *      run, and how each thing left: sold, or given. The diff is written down
 *      whether or not it changes a total, because the diff is the evidence
 *      that the run looked.
 *   B. the recompute, in full, from the whole event history. No running total
 *      is kept anywhere, so a total cannot drift, and a bad night is fixed by
 *      fixing the events rather than by unpicking arithmetic.
 *   C. apply, and write down what was applied. Register, leaderboard, collector
 *      pages, and a run record that says what this run saw and how long it took.
 *
 * TAO never travels with a token. A sale takes back every day that holding
 * earned its seller; a gift leaves the days banked and simply stops the clock.
 * Either way the wallet receiving the token starts from zero on it.
 *
 * Reads the cached history over HTTP from the deployed site, which is cheap and
 * has no API limits, and writes back through the repo only what changed.
 */

const ETHERSCAN = 'https://api.etherscan.io/v2/api';
const T721 = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const T1155_ONE = '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62';
const T1155_MANY = '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb';
const RPC = process.env.ETH_RPC || 'https://ethereum-rpc.publicnode.com';
const RUNS = 'data/tao/runs.json';
// how many runs in a row may change nothing while our own contracts are busy
const QUIET_RUNS = Number(process.env.TAO_QUIET_RUNS || 3);
// the schedule is daily; a gap much beyond that is a run that did not happen
const MAX_GAP_HOURS = Number(process.env.TAO_MAX_GAP_HOURS || 36);
// the sweep runs half an hour before this one, so anything past a day and a
// half means it has missed at least one night and said nothing
const OWNERS_STALE_HOURS = Number(process.env.TAO_OWNERS_STALE_HOURS || 36);
// collector pages rewritten per run, for the wallets whose works moved. The
// figures on every other page come from the overlay, live, so they need no
// commit ... this budget only stops one extraordinary night writing hundreds.
const PAGE_BUDGET = Number(process.env.TAO_PAGE_BUDGET || 40);

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
  const started = Date.now();

  /* The run record is written whichever way this goes. A failure that leaves no
     trace is the one that goes on failing, so the catch writes the same record
     with ok:false and the reason, and then says so out loud. */
  let prior = { runs: [], sha: undefined };
  try {
    prior = await loadRuns(RUNS);
  } catch (e) { /* first run, or the repo is unreachable ... the run itself will say */ }

  try {
    const out = await run({ key, dry, started, prior, url });
    return new Response(JSON.stringify(out, null, 1), { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (err) {
    const why = String(err && err.message ? err.message : err).slice(0, 300);
    const entry = { run_id: `r${started.toString(36)}`, at: new Date(started).toISOString(), ok: false, ms: Date.now() - started, error: why };
    if (!dry) {
      await saveRuns(RUNS, prior, entry, { keep: 90, note: NOTE, message: `TAO run failed: ${why.slice(0, 60)}` }).catch(() => {});
      await alarm(`TAO: the nightly run failed`,
        `The TAO run stopped with:\n\n  ${why}\n\nNothing was written. Totals on the site are yesterday's until the next run.\n\nThe last ninety runs are at https://mintface.art/data/tao/runs.json\n\nMintFace`);
    }
    console.error('tao: run failed', why);
    return new Response(JSON.stringify({ ok: false, error: why }, null, 1),
      { status: 500, headers: { 'content-type': 'application/json' } });
  }
}

const NOTE = 'One record per TAO run, newest first, ninety kept. A run that changes nothing is recorded too ... '
  + 'a quiet night and a run that stopped looking are otherwise the same thing. See docs/TAO.md.';

async function alarm(subject, text) {
  const to = process.env.EMAIL_TO_ARTIST;
  if (!to) { console.error('tao alarm, nowhere to send it:', subject); return; }
  await send({ to, subject, text }).catch((e) => console.error('tao alarm failed to send', String(e)));
}

async function run({ key, dry, started, prior, url }) {
  /* One id for this run, stamped on every piece of evidence it leaves, so the
     totals row and the run record can be matched up without guessing from
     timestamps. */
  const runId = `r${started.toString(36)}`;
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
  const shared = new Set(Object.keys(CFG.per_token_contracts || {}).filter((k) => k.startsWith('0x')));

  /* ---- the catalogue.
     Two scopes, and conflating them is how the register lost four hundred
     collectors a night. `scoped` is what accrues TAO ... canon and archive,
     minus the patron collections. `all` is the register: every collection
     there is, because a collector of XNouns is still a collector. */
  const all = [];
  const scoped = [];
  const tokens = new Map();
  const targets = new Map();
  for (const c of index.collections || []) {
    let col;
    try { col = await get(`data/c/${c.slug}.json`); } catch (e) { continue; }
    all.push(col);
    if (skip.has(c.slug)) continue;
    scoped.push(col);
    for (const w of [...(col.works || []), ...(col.children || []).flatMap((x) => x.works || [])]) {
      const d = w.digital || {};
      if (!CFG.scope.chains.includes(d.chain) || !d.contract || d.token_id == null) continue;
      const unique = !((w.edition || {}).type && w.edition.type !== '1/1');
      const ids = w.token_ids && w.token_ids.length ? w.token_ids : [d.token_id];
      const a = d.contract.toLowerCase();
      if (!targets.has(a)) targets.set(a, { std: d.standard, tokens: new Set() });
      for (const id of ids) {
        tokens.set(`${a}|${id}`, { unique, work: w.id, collection: col.slug, title: w.title || w.id });
        targets.get(a).tokens.add(String(id));
      }
    }
  }

  /* ================= Phase A ... the ownership diff =================
     What moved, and how it left. Before any TAO arithmetic, because the
     arithmetic is only worth reading if the movement it rests on is written
     down beside it. */
  const HEAD = await head();
  const files = new Map();
  const arrived = [];            // events this run had not seen before
  let chainEvents = 0;           // raw logs on our own contracts, ours or not
  let scannedFrom = Infinity;
  let neverBackfilled = [];

  for (const [addr, t] of targets) {
    let cached = null;
    try { cached = await get(`data/tao/e/${addr}.json`); } catch (e) { /* never backfilled */ }
    // the first backfill reads shared contracts one token at a time and is far
    // too slow for a function; scripts/tao/fetch-events.mjs does that by hand
    if (!cached || !cached.cursor) { neverBackfilled.push(addr); continue; }
    const from = cached.cursor + 1;
    if (from < scannedFrom) scannedFrom = from;
    if (from > HEAD) { files.set(addr, { data: cached, changed: false }); continue; }
    const topics = t.std === 'ERC-1155' ? [T1155_ONE, T1155_MANY] : [T721];
    const found = [];
    for (const topic of topics) {
      const logs = await sweep(addr, topic, from, HEAD, key);
      // On our own contracts every log is MintFace art moving. On the shared
      // ones almost none of it is, so counting those would make every night
      // look busy and the staleness alarm would never fire.
      if (!shared.has(addr)) chainEvents += logs.length;
      for (const l of logs) {
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
    for (const e of add) arrived.push({ contract: addr, token: e[0], from: e[1], to: e[2], qty: Number(e[3]) || 1, ts: e[4], block: e[5], tx: e[6] });
    files.set(addr, { data: cached, changed: add.length > 0 });
  }
  if (!Number.isFinite(scannedFrom)) scannedFrom = HEAD;

  /* Sale or gift, for everything that has left a collector.
     What arrived this run is classified first: the diff cannot describe how a
     work left until its transaction has been read, and an unread exit defaults
     to a gift, which is the forgiving direction but also the silent one. */
  let sales = { _note: 'Sale classification per transaction.', tx: {} };
  try { sales = await get('data/tao/sales.json'); } catch (e) { /* first run */ }
  const market = new Map(Object.entries(CFG.marketplaces).filter(([k]) => k.startsWith('0x')));
  const weth = String(CFG.weth).toLowerCase();

  const need = new Map();
  const wants = (from, tx) => {
    if (!from || nobody.has(from) || !tx || sales.tx[tx]) return;
    if (!need.has(tx)) need.set(tx, new Set());
    need.get(tx).add(from);
  };
  for (const e of arrived) wants(e.from, e.tx);              // this run's exits, first
  const fresh = new Set(need.keys());
  for (const { data } of files.values()) {
    for (const [, from, , , , , tx] of data.events) wants(from, tx);
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
  const unclassified = Math.max(0, need.size - classified);
  const freshUnread = [...fresh].filter((tx) => !sales.tx[tx]).length;

  /* The diff itself. One line per movement, saying which wallet gained, which
     lost, and on what terms ... which is the whole rule in one place:
     sold subtracts, given keeps, and the receiver starts from zero either way. */
  const gained = new Map();
  const lost = new Map();
  const movements = [];
  for (const e of arrived) {
    const meta = tokens.get(`${e.contract}|${e.token}`);
    if (!meta) continue;
    const sold = Boolean(sales.tx[e.tx] && sales.tx[e.tx].sale);
    const minted = !e.from || nobody.has(e.from);
    const how = minted ? 'mint' : (sold ? 'sale' : 'transfer');
    movements.push({
      work: meta.work, title: meta.title, token: e.token, contract: e.contract, qty: e.qty,
      at: new Date(e.ts * 1000).toISOString(), block: e.block, tx: e.tx,
      from: minted ? null : e.from, to: nobody.has(e.to) ? null : e.to, how,
      effect: how === 'mint' ? 'accrual starts for the receiver; nothing accrued before it'
        : how === 'sale' ? 'the seller loses every day this holding earned them; the buyer starts from zero'
          : 'the sender keeps what it banked and stops accruing; the receiver starts from zero',
      why: sales.tx[e.tx] ? sales.tx[e.tx].why : 'not yet read ... treated as a transfer until it is',
    });
    if (e.to && !nobody.has(e.to)) gained.set(e.to, (gained.get(e.to) || 0) + 1);
    if (!minted) {
      const l = lost.get(e.from) || { sales: 0, transfers: 0 };
      l[sold ? 'sales' : 'transfers']++;
      lost.set(e.from, l);
    }
  }
  const affected = new Set([...gained.keys(), ...lost.keys()]);

  /* ================= Phase B ... the recompute =================
     In full, from the whole history, every run. */
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
      // summed unrounded, rounded once at the end
      tao_live: Math.round(held.reduce((n, w) => n + w.tao_exact, 0)),
      tao_lost_to_sales: Math.round(wallets.reduce((n, w) => n + w.tao_lost, 0)),
    },
    wallets: Object.fromEntries(held.map((w) => [w.address, { tao: w.tao_total, rate: w.tao_rate, lost: w.tao_lost, sales: w.sales, works: w.works }])),
  };

  // what the affected wallets were worth before this run, so the record can
  // show the subtraction rather than assert it
  let before = null;
  try { before = await get('data/tao.json'); } catch (e) { /* first run */ }
  const wasLive = before && before.counts ? before.counts.tao_live : null;
  const movers = [...affected].map((a) => {
    const b = before && before.wallets ? before.wallets[a] : null;
    const n = tao.wallets[a] || null;
    return { address: a, before: b ? b.tao : 0, after: n ? n.tao : 0,
      delta: (n ? n.tao : 0) - (b ? b.tao : 0), gained: gained.get(a) || 0, ...(lost.get(a) || {}) };
  }).sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta)).slice(0, 25);

  /* ================= Phase C ... apply, and write down what was applied ====== */
  const written = [];
  const put = async (path, body, msg) => {
    const cur = await readFile(path).catch(() => ({ sha: null }));
    const text = typeof body === 'string' ? body : JSON.stringify(body, null, 1) + '\n';
    if (cur.text != null && cur.text === text) return;                  // nothing moved, no commit
    await writeFile(path, text, msg, cur.sha || undefined);
    written.push(path);
  };

  let registerCounts = null;
  let pagesWritten = 0;
  if (!dry) {
    for (const [addr, f] of files) {
      if (!f.changed) continue;
      const cur = await readFile(`data/tao/e/${addr}.json`).catch(() => ({ sha: null }));
      await writeFile(`data/tao/e/${addr}.json`, JSON.stringify(f.data), `TAO events: ${addr.slice(0, 10)}`, cur.sha || undefined);
      written.push(`data/tao/e/${addr}.json`);
    }
    /* The board's own total, and where it stood the run before. Two numbers in
       two hundred bytes, written by the only thing that knows both, so the
       register's header can show the day's movement as run-over-run truth
       rather than a figure somebody typed in once. A day the total falls ...
       sales taking back more than time adds ... shows the fall, which is the
       whole of the metric having stakes. */
    /* One row per successful run, newest first. A failed run writes nothing
       here, which is the point: the delta is the change between two totals that
       were both actually computed, never between a real one and a gap. The
       header reads the top two rows and does no arithmetic of its own beyond
       the division. */
    let totals = { rows: [] };
    try { totals = await get('data/tao/totals.json'); } catch (e) { /* the first one */ }
    const row = {
      run_id: runId,
      run_at: tao.generated,
      head_block: HEAD,
      total_tao: tao.counts.tao_live,
      address_count: tao.counts.wallets,
    };
    await put('data/tao/totals.json', {
      _note: 'One row per successful TAO recompute, newest first. A failed run writes nothing here, '
        + 'so a delta is always the change between two totals that were both computed.',
      keep: 400,
      rows: [row, ...(totals.rows || []).filter((r) => r.run_id !== runId)].slice(0, 400),
    }, `TAO total: ${tao.counts.tao_live.toLocaleString('en-NZ')}`);

    /* What is for sale, small enough for another site to read. The collections
       are already open in memory for the register rebuild, so this costs
       nothing but the writing of it, and it saves the collectors site pulling
       five megabytes of catalogue to answer one question. */
    const forSale = [];
    for (const col of all) {
      if (skip.has(col.slug)) continue;                 // patron collections are not MintFace art to acquire
      const works = [...(col.works || []), ...(col.children || []).flatMap((x) => x.works || [])];
      const free = works.filter((w) => w.status === 'available');
      if (!free.length) continue;
      const nzd = [];
      const eth = [];
      for (const w of free) {
        for (const v of Object.values(w.pricing_nzd || {})) if (typeof v === 'number' && v > 0) nzd.push(v);
        if (w.priced_in === 'ETH') for (const v of Object.values(w.pricing_eth || {})) if (typeof v === 'number' && v > 0) eth.push(v);
      }
      forSale.push({
        slug: col.slug, title: col.title || col.slug, available: free.length,
        from_nzd: nzd.length ? Math.min(...nzd) : null,
        from_eth: eth.length ? Math.min(...eth) : null,
      });
    }
    forSale.sort((a, b) => b.available - a.available);
    await put('data/availability.json', {
      _note: 'What is available, by collection, for anywhere that needs to say so without reading the catalogue.',
      generated: tao.generated,
      totals: { collections: forSale.length, works: forSale.reduce((n, x) => n + x.available, 0) },
      collections: forSale,
    }, `Available: ${forSale.reduce((n, x) => n + x.available, 0)} works across ${forSale.length} collections`);

    if (classified) await put('data/tao/sales.json', sales, `TAO: ${classified} transactions classified`);
    await put('data/tao.json', tao, `TAO: ${tao.counts.wallets} wallets, ${tao.counts.tao_live.toLocaleString('en-NZ')} live`);
    // the exit ledger is what scripts/tao/report.mjs and check-integrity.mjs
    // read to show their working; it goes stale the moment an exit is added
    if (movements.length || !before) {
      await put('data/tao/exits.json', { _note: 'Every exit, with the verdict that decided whether its TAO was taken back.', generated: tao.generated, exits },
        `TAO: ${exits.length} exits on record`);
    }

    /* The register, the leaderboard, and the pages, all from one derivation.
       Every collection goes in, not only the ones that accrue: TAO decides what
       earns, never who is a collector. Rebuilding this from the TAO scope alone
       is what quietly dropped four hundred and seventy people from the register
       every night between this run and the next morning's sweep. */
    try {
      const titleOf = new Map((index.collections || []).map((c) => [c.slug, c.title]));
      let priv = new Set();
      try { priv = new Set((((await get('data/source/collectors-private.json')).wallets) || []).map((w) => String(w).toLowerCase())); } catch (e) { /* nobody */ }
      let nudges = null;
      try { nudges = await get('data/nudge-weighings.json'); } catch (e) { /* none yet */ }

      const d = deriveCollectors(all, titleOf, priv, tao, nudges);
      registerCounts = d.index.counts;
      await put('data/collectors.json', d.index, `Collectors: TAO to ${tao.generated.slice(0, 10)}`);
      /* Through registerFile rather than put, as in api/cron/owners.js: the
         register is written one row per line, so the nightly diff shows the
         rows that moved rather than the whole file reformatted. */
      {
        const cur = await readFile('data/collectors-register.json').catch(() => ({ sha: null }));
        await writeFile('data/collectors-register.json', registerFile(d.register),
          `Register: ${d.register.rows.length} ranked by TAO`, cur.sha || undefined);
      }
      await put('data/collector-slugs.json', d.slugMap, 'Collectors: slug map');

      /* A collector page carries its own TAO, and every page's figure moves
         every night, because time moved. Rewriting all eight hundred nightly
         would be eight hundred commits for arithmetic nobody disputes, so the
         whole board is published instead as one small overlay ... forty
         kilobytes ... that the page reads live and lays over what it was
         served. The page files themselves are rewritten only for the wallets
         that actually moved tonight, where the list of works has changed and
         not just its age. */
      const overlay = { _note: 'Live TAO for the collector pages: [tao, rate, rank, per-work]. Written with data/tao.json.',
        generated: tao.generated, rates: CFG.rates, wallets: {} };
      for (const p of d.all) {
        if (!p.has_page) continue;
        overlay.wallets[p.address] = [p.tao || 0, p.tao_rate || 0, p.tao_rank || 0,
          Object.fromEntries(p.works.filter((w) => w.tao).map((w) => [w.id, w.tao]))];
      }
      await put('data/tao/pages.json', overlay, `TAO overlay: ${Object.keys(overlay.wallets).length} pages`);

      const moved = d.all.filter((p) => p.has_page && affected.has(p.address));
      for (const p of moved.slice(0, PAGE_BUDGET)) {
        await put(`data/collectors/${p.slug}.json`, d.page(p), `Collectors: ${p.slug}`);
        pagesWritten++;
      }
      if (moved.length > PAGE_BUDGET) {
        console.warn(`tao: ${moved.length - PAGE_BUDGET} collector pages moved and were not rewritten tonight`);
      }
    } catch (e) {
      throw new Error(`the register rebuild failed: ${String(e.message || e).slice(0, 160)}`);
    }
  }

  /* The sweep half an hour before this one has been stopping dead without
     saying so, three nights running, because it was being killed by the
     platform before its own catch could run. A process cannot be relied on to
     report a failure that kills it. This one completes in half a minute every
     night, so it is the right place to notice: the cursor either moved since
     yesterday or it did not, and that is a fact about a file rather than a
     hope about a process.

     The general rule, worth keeping: the watchdog belongs in a different
     process from the thing it watches. */
  const alarms = [];
  let ownersAge = null;
  try {
    const cur = await get('data/owners-cursor.json');
    ownersAge = (Date.now() - Date.parse(cur.updated)) / 3600000;
    if (Number.isFinite(ownersAge) && ownersAge > OWNERS_STALE_HOURS) {
      alarms.push(`the ownership sweep has not finished for ${Math.round(ownersAge)} hours `
        + `... its cursor is still on block ${cur.last_block}, so who holds what is that old. `
        + `TAO is unaffected: it reads its own event history, not the register.`);
    }
  } catch (e) { alarms.push('the ownership sweep has no cursor at all ... it has never finished'); }

  /* ---- the run record, and the thing that pages us ---- */
  const gap = hoursSince(prior.runs, started);
  const entry = {
    run_id: runId, at: new Date(started).toISOString(), ok: true, ms: Date.now() - started, dry: dry || undefined,
    blocks: { from: scannedFrom, to: HEAD, scanned: Math.max(0, HEAD - scannedFrom + 1) },
    chain_events: chainEvents,
    changed_hands: { works: movements.length, sales: movements.filter((m) => m.how === 'sale').length,
      transfers: movements.filter((m) => m.how === 'transfer').length, mints: movements.filter((m) => m.how === 'mint').length },
    wallets_affected: affected.size,
    tao: { live: tao.counts.tao_live, was: wasLive, delta: wasLive == null ? null : tao.counts.tao_live - wasLive,
      lost_to_sales: tao.counts.tao_lost_to_sales, wallets: tao.counts.wallets },
    register: registerCounts,
    classified, unclassified, events: tao.counts.events,
    owners_cursor_age_hours: ownersAge == null ? null : Math.round(ownersAge * 10) / 10,
    files: written.length, pages: pagesWritten,
    movements: movements.slice(0, 25),
    movers,
  };


  if (gap != null && gap > MAX_GAP_HOURS) {
    alarms.push(`the previous run was ${Math.round(gap)} hours ago, on a daily schedule ... at least one run did not happen`);
  }
  const recent = [entry, ...prior.runs].slice(0, QUIET_RUNS);
  if (recent.length >= QUIET_RUNS && recent.every((r) => r.ok !== false && r.chain_events > 0
    && (!r.changed_hands || r.changed_hands.works === 0))) {
    alarms.push(`${QUIET_RUNS} runs in a row found nothing while ${chainEvents} transfers went past on our own contracts ... the sweep may have stopped seeing`);
  }
  if (neverBackfilled.length) {
    alarms.push(`${neverBackfilled.length} contract${neverBackfilled.length === 1 ? ' has' : 's have'} no event history at all, so nothing on ${neverBackfilled.length === 1 ? 'it' : 'them'} accrues: ${neverBackfilled.join(', ')}`);
  }
  if (freshUnread) {
    alarms.push(`${freshUnread} exit${freshUnread === 1 ? '' : 's'} that arrived tonight went unread and were treated as gifts ... their TAO was not taken back`);
  }
  if (alarms.length) entry.alarms = alarms;

  if (!dry) {
    await saveRuns(RUNS, prior, entry, { keep: 90, note: NOTE,
      message: `TAO run: ${entry.changed_hands.works} moved, ${entry.tao.wallets} wallets, ${Math.round(entry.ms / 1000)}s` });
    if (alarms.length) {
      await alarm(`TAO: ${alarms.length} thing${alarms.length === 1 ? '' : 's'} to look at`,
        `Tonight's TAO run finished, and raised ${alarms.length === 1 ? 'this' : 'these'}:\n\n`
        + alarms.map((a) => `  ... ${a}`).join('\n\n')
        + `\n\nThe run itself: ${entry.changed_hands.works} works changed hands, ${entry.wallets_affected} wallets affected, `
        + `${entry.tao.wallets} wallets holding ${entry.tao.live.toLocaleString('en-NZ')} TAO.\n\n`
        + `The last ninety runs are at https://mintface.art/data/tao/runs.json\n\nMintFace`);
    }
  }

  const summary = `tao: ${tao.counts.wallets} wallets, ${tao.counts.tao_live} live, ${movements.length} works changed hands `
    + `(${entry.changed_hands.sales} sold, ${entry.changed_hands.transfers} given), ${affected.size} wallets affected, `
    + `${classified} transactions classified, ${written.length} files written, ${pagesWritten} pages, ${Math.round(entry.ms / 1000)}s`;
  console.log(summary);
  if (alarms.length) for (const a of alarms) console.warn('tao alarm:', a);

  // ?runs=n hands back the record without re-reading it from the site
  const showRuns = Number(url.searchParams.get('runs') || 0);
  return { summary, dry, head: HEAD, counts: tao.counts, run: entry, alarms,
    ...(showRuns ? { runs: [entry, ...prior.runs].slice(0, showRuns) } : {}) };
}
