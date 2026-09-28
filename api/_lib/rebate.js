/* 🧧 The rebate: a discretionary split on agent-rail sales (REBATE.md).
 *
 * A campaign rebates part of each eligible rail sale: a share to TAO holders
 * by holdings, a share to the scout who sent the buying AI. It is off until
 * the holding wallet starts it with a signature, and it never moves a wei by
 * itself: it writes down who is owed what, and at the close /mintwork/rail hands
 * the holder a Disperse batch to sign.
 *
 * THE SCOUT IS IN THE BUYER'S OWN TRANSACTION. An agent that asks /ai/buy with
 * a ref is handed a transaction whose calldata carries the scout's wallet after
 * the Seaport call, where Seaport never reads it. Whoever sends that
 * transaction has said, on chain, who sent them. Nobody else can say it for
 * them: a ref stored against an order would go to whoever asked for that
 * order first, and asking for all 109 orders with your own ref is one loop.
 *
 * EVERYTHING HERE IS INTEGER WEI AND REPEATABLE. An allocation is a pure
 * function of the sale, the TAO snapshot before it, and the COMBO groups read
 * for that snapshot; the snapshot is named by its commit and the groups are
 * kept, so allocating a sale twice writes the same rows to the wei.
 */
import { decodeFunctionData, encodeFunctionData, formatEther, getAddress, parseAbi, verifyMessage } from 'viem';
import { normalize } from 'viem/ens';
import { one, pipe, storeConfigured } from './kv.js';
import { siteJSON, siteOrigin } from './data.js';
import { lastCommitBefore, readFileAt, repoConfigured } from './repo.js';
import { loadRegister } from './register.js';
import { fold, tagIndex } from './names.js';
import { RIGHTS_ALL, RIGHTS_MINTFACE, V1, V2 } from './delegate.js';
import { enqueue } from './wire.js';
import { chain, config, records } from './aab.js';

export const DISPERSE = '0xD152f549545093347A162Dce210e7293f1452150';
export const DISPERSE_ABI = parseAbi(['function disperseEther(address[] recipients, uint256[] values) payable']);
/* 'MFR1': the four bytes that mark a scout at the end of a fill's calldata. */
export const SCOUT_TAG = '4d465231';
export const CHUNK = 300;

const lower = (a) => String(a || '').toLowerCase();
const parse = (v) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch (e) { return null; } };
const eth = (wei) => Number(formatEther(BigInt(wei || 0)));

export const K = {
  campaign: (id) => `rebate:c:${id}`,
  list: 'rebate:list',
  open: 'rebate:open',
  sale: (tx) => `rebate:sale:${lower(tx)}`,
  sales: (id) => `rebate:sales:${id}`,
  groups: (snap) => `rebate:groups:${snap}`,
  payouts: 'rebate:payouts',
  payoutTx: (tx) => `rebate:ptx:${lower(tx)}`,
  view: 'rebate:view',
};

/* ---------------------------------------------------------------- the scout */

/** The fill's calldata, with the scout after it. */
export function withScout(data, wallet) {
  if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) return data;
  return `${data}${SCOUT_TAG}${lower(wallet).slice(2)}`;
}

/**
 * The scout a transaction names, or null. The marker has to sit exactly where
 * withScout puts it: ABI calldata is four bytes plus whole words, so the tail
 * lands 24 bytes past a word boundary, and anything else is not ours.
 */
export function scoutFrom(input) {
  const s = lower(input).replace(/^0x/, '');
  if (s.length < 8 + 48 || ((s.length / 2 - 4) % 32) !== 24) return null;
  const tail = s.slice(-48);
  if (tail.slice(0, 8) !== SCOUT_TAG) return null;
  return `0x${tail.slice(8)}`;
}

let REG = null;
const at = async (origin, p) => {
  const r = await fetch(`${origin}/${p}`, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`${p}: ${r.status}`);
  return r.json();
};
async function register() {
  if (REG && Date.now() - REG.at < 300_000) return REG.v;
  const v = await loadRegister(at, siteOrigin(), storeConfigured() ? pipe : null).catch(() => null);
  REG = { v, at: Date.now() };
  return v;
}
/** For the tests: a register that is not fetched. */
export const useRegister = (v) => { REG = { v, at: Date.now() + 1e12 }; };

/**
 * A ref, as an agent passes it, to a wallet. The site's own naming first (the
 * overlay, a name chosen here, an ENS the register already knows), then ENS
 * live, then a verified X handle. A ref that lands nowhere is kept as typed and
 * names nobody; the purchase goes ahead either way.
 */
export async function resolveRef(raw) {
  const s = String(raw || '').trim().slice(0, 96);
  if (!s) return null;
  if (/^0x[0-9a-fA-F]{40}$/.test(s)) return { ref: s, wallet: lower(s), via: 'address' };
  const reg = await register();
  const bare = s.replace(/^@/, '');
  if (reg) {
    const hit = tagIndex(reg).get(fold(bare));
    if (hit) return { ref: s, wallet: lower(hit), via: 'name' };
  }
  if (/\.eth$/i.test(bare)) {
    try {
      const a = await chain().getEnsAddress({ name: normalize(bare) });
      if (a) return { ref: s, wallet: lower(a), via: 'ens' };
    } catch (e) { /* not a name the chain knows */ }
  }
  if (reg) {
    const h = bare.toLowerCase();
    for (const [address] of reg.rows) {
      const w = reg.who(address);
      if (w && !w.private && w.x && String(w.x).toLowerCase() === h) return { ref: s, wallet: lower(address), via: 'x' };
    }
  }
  return { ref: s, wallet: null, via: null };
}

/* ------------------------------------------------------------- the snapshot */

let SNAP = null;
/** For the tests: a snapshot that is not fetched. */
export const useSnapshot = (fn) => { SNAP = fn; };

/**
 * The TAO table from the last recompute committed before the sale. Named by
 * its commit, so a rerun reads the same table. Where the repo cannot be asked
 * (no token, a local run) the deployed table stands in, named by when it was
 * generated.
 */
export async function snapshotBefore(iso) {
  if (SNAP) return SNAP(iso);
  if (repoConfigured()) {
    const c = await lastCommitBefore('data/tao.json', iso);
    if (c) {
      const j = JSON.parse(await readFileAt('data/tao.json', c.sha));
      return { id: c.sha, generated: j.generated || null, wallets: j.wallets || {} };
    }
  }
  const j = await siteJSON('data/tao.json', { fresh: true });
  return { id: `deployed:${j && j.generated}`, generated: (j && j.generated) || null, wallets: (j && j.wallets) || {} };
}
export async function snapshotById(id) {
  if (SNAP) return SNAP(null, id);
  if (String(id).startsWith('deployed:')) return snapshotBefore(new Date().toISOString());
  const j = JSON.parse(await readFileAt('data/tao.json', id));
  return { id, generated: j.generated || null, wallets: j.wallets || {} };
}

/* ------------------------------------------------------------ COMBO groups */

const REG_ABI = parseAbi([
  'struct D { uint8 type_; address to; address from; bytes32 rights; address contract_; uint256 tokenId; uint256 amount; }',
  'function getOutgoingDelegations(address from) view returns (D[])',
  'function getDelegatesForAll(address vault) view returns (address[])',
]);

/**
 * Vault -> hot wallet, for every wallet in the snapshot, read once and kept.
 *
 * The same delegations a COMBO counts on the rest of the site: Delegate v2's
 * wallet-wide grants with all rights or the `mintface` rights, and v1's
 * wallet-wide grants. Read from the vault's side, because the ordinary COMBO is
 * a cold wallet with the art delegating to a hot one that holds nothing, and
 * asking the holders who delegates to them would never find it. A vault that
 * delegates to two hot wallets goes to the lower address, so the choice is the
 * same every time it is made.
 */
export async function groupsFor(snap) {
  const cached = parse(await one('GET', K.groups(snap.id)));
  if (cached) return cached;
  const addrs = Object.keys(snap.wallets).map(lower).filter((a) => /^0x[0-9a-f]{40}$/.test(a)).sort();
  const out = {};
  const client = chain();
  for (let i = 0; i < addrs.length; i += 150) {
    const slice = addrs.slice(i, i + 150);
    const res = await client.multicall({
      allowFailure: true,
      contracts: slice.flatMap((a) => [
        { address: V2, abi: REG_ABI, functionName: 'getOutgoingDelegations', args: [a] },
        { address: V1, abi: REG_ABI, functionName: 'getDelegatesForAll', args: [a] },
      ]),
    });
    slice.forEach((a, j) => {
      const hots = new Set();
      const v2 = res[j * 2];
      if (v2.status === 'success') {
        for (const d of v2.result) {
          if (Number(d.type_) === 1 && (d.rights === RIGHTS_ALL || d.rights === RIGHTS_MINTFACE)) hots.add(lower(d.to));
        }
      }
      const v1 = res[j * 2 + 1];
      if (v1.status === 'success') for (const h of v1.result) hots.add(lower(h));
      hots.delete(a);
      if (hots.size) out[a] = [...hots].sort()[0];
    });
  }
  await one('SET', K.groups(snap.id), JSON.stringify(out));
  return out;
}

/* ------------------------------------------------------------- allocation */

/**
 * Who is eligible, as groups: a COMBO is one holder, named by its hot wallet,
 * holding the sum of its wallets' TAO. The artist's wallets, and any group one
 * of them is in, are out entirely.
 */
export function eligibleHolders({ wallets, groups, exclude, minTao }) {
  const primary = (a) => groups[a] || a;
  const out = new Set([...exclude].map(lower));
  for (const a of Object.keys(wallets)) if (out.has(lower(a))) out.add(primary(lower(a)));
  for (const [v, h] of Object.entries(groups)) if (out.has(h)) out.add(v);
  const sum = new Map();
  for (const [a0, v] of Object.entries(wallets)) {
    const a = lower(a0);
    const t = Math.floor(Number(typeof v === 'object' && v ? v.tao : v) || 0);
    if (t <= 0 || out.has(a)) continue;
    const g = primary(a);
    if (out.has(g)) continue;
    sum.set(g, (sum.get(g) || 0) + t);
  }
  return [...sum].filter(([, t]) => t >= minTao).map(([wallet, tao]) => ({ wallet, tao }));
}

/** The group a wallet belongs to, and what that group holds. */
export function groupTao({ wallets, groups, wallet }) {
  const g = groups[lower(wallet)] || lower(wallet);
  let t = 0;
  for (const [a0, v] of Object.entries(wallets)) {
    const a = lower(a0);
    if ((groups[a] || a) === g) t += Math.floor(Number(typeof v === 'object' && v ? v.tao : v) || 0);
  }
  return { group: g, tao: t };
}

const byTaoThenWallet = (a, b) => (b.tao > a.tao ? 1 : b.tao < a.tao ? -1 : (a.wallet < b.wallet ? -1 : 1));

/**
 * One sale, split. Pure and in integer wei.
 *
 * The rebate is (holder% + scout%) of the price. The scout's part comes off
 * first where there is a valid scout; otherwise it is the holders'. The
 * holders' pool goes by TAO, with no group past the cap: anything over is
 * shared among the rest by TAO, again and again until nobody is over. Where
 * there are too few holders for the cap to be kept at all, it becomes an equal
 * split, the nearest thing to it. What floor division leaves over goes to the
 * largest holder row, so the rows add to the rebate exactly.
 */
export function allocate({ priceWei, holderPct, scoutPct, capPct, holders, scout }) {
  const price = BigInt(priceWei);
  const total = (price * BigInt(holderPct + scoutPct)) / 100n;
  const scoutAmt = scout ? (price * BigInt(scoutPct)) / 100n : 0n;
  const pool = total - scoutAmt;
  const rows = [];
  if (scout) rows.push({ kind: 'scout', wallet: lower(scout), amount_wei: scoutAmt });
  const list = holders.map((h) => ({ wallet: lower(h.wallet), tao: BigInt(h.tao) })).sort(byTaoThenWallet);
  if (!list.length) return { rows: rows.map(str), total: String(total), pool: String(pool), unallocated: String(pool) };

  const n = BigInt(list.length);
  let cap = (pool * BigInt(capPct)) / 100n;
  const least = (pool + n - 1n) / n;
  if (cap < least) cap = least;
  const amt = new Map();
  let open = list;
  let left = pool;
  for (;;) {
    const W = open.reduce((s, h) => s + h.tao, 0n);
    const over = W > 0n ? open.filter((h) => (left * h.tao) / W > cap) : [];
    if (!over.length) {
      for (const h of open) amt.set(h.wallet, W > 0n ? (left * h.tao) / W : 0n);
      break;
    }
    for (const h of over) { amt.set(h.wallet, cap); left -= cap; }
    const gone = new Set(over.map((h) => h.wallet));
    open = open.filter((h) => !gone.has(h.wallet));
    if (!open.length) break;
  }
  let given = 0n;
  for (const v of amt.values()) given += v;
  const dust = pool - given;
  let top = list[0];
  for (const h of list) if (amt.get(h.wallet) > amt.get(top.wallet)) top = h;
  amt.set(top.wallet, amt.get(top.wallet) + dust);
  for (const h of list) {
    const a = amt.get(h.wallet);
    if (a > 0n) rows.push({ kind: 'holder', wallet: h.wallet, amount_wei: a, tao_at_snapshot: Number(h.tao) });
  }
  return { rows: rows.map(str), total: String(total), pool: String(pool), unallocated: '0' };
}
const str = (r) => ({ ...r, amount_wei: String(r.amount_wei) });

/* --------------------------------------------------------------- campaigns */

export async function campaign(id) { return parse(await one('GET', K.campaign(id))); }
export async function campaigns() {
  const ids = (await one('LRANGE', K.list, '0', '-1')) || [];
  if (!ids.length) return [];
  return (await pipe(ids.map((i) => ['GET', K.campaign(i)]))).map(parse).filter(Boolean);
}
export async function openCampaign() {
  const id = await one('GET', K.open);
  return id ? campaign(id) : null;
}

export const TERMS_DEFAULT = { holder_pct: 40, scout_pct: 10, min_tao: 5000, cap_pct: 5, min_payout_eth: '0.001' };

function checkTerms(t) {
  const n = (v) => Number(v);
  const out = {
    holder_pct: Math.floor(n(t.holder_pct)), scout_pct: Math.floor(n(t.scout_pct)),
    min_tao: Math.floor(n(t.min_tao)), cap_pct: Math.floor(n(t.cap_pct)),
    min_payout_eth: String(t.min_payout_eth),
  };
  const bad = [];
  if (!(out.holder_pct >= 0 && out.scout_pct >= 0 && out.holder_pct + out.scout_pct > 0 && out.holder_pct + out.scout_pct <= 100)) bad.push('the shares must add to between 1% and 100%');
  if (!(out.min_tao >= 0)) bad.push('the minimum TAO must be a whole number');
  if (!(out.cap_pct >= 1 && out.cap_pct <= 100)) bad.push('the cap must be between 1% and 100%');
  if (!/^\d+(\.\d{1,18})?$/.test(out.min_payout_eth)) bad.push('the minimum payout must be an ETH amount');
  return { terms: out, bad };
}

/** What the holder signs to start, close or mark a campaign. Every term is in it. */
export function campaignMessage({ action, id, terms = null, scope = null, issued }) {
  return [
    'mintface.art rebate',
    `Action: ${action}`,
    `Campaign: ${id}`,
    ...(terms ? [
      `Holders: ${terms.holder_pct}% by TAO, ${terms.min_tao} TAO or more, no one past ${terms.cap_pct}% of the pool`,
      `Scouts: ${terms.scout_pct}%`,
      `Paid out from: ${terms.min_payout_eth} ETH`,
    ] : []),
    ...(scope ? [`Works: ${scope.works.length} on the agent rail`, `Ends: ${scope.ends_at}`] : []),
    ...(action === 'start' ? ['I confirm an NZ adviser has reviewed the rebate framing.'] : []),
    `Issued: ${issued}`,
  ].join('\n');
}

/** The next campaign as it would start now: its id, its scope, its message. */
export async function draftCampaign(termsIn) {
  if (await one('GET', K.open)) return { error: 'A campaign is already open. Close it first.', status: 409 };
  const { terms, bad } = checkTerms({ ...TERMS_DEFAULT, ...(termsIn || {}) });
  if (bad.length) return { error: bad.join('; '), status: 400 };
  const recs = await records();
  if (!recs.length) return { error: 'There is nothing on the rail to run a campaign over.', status: 409 };
  const n = ((await one('LRANGE', K.list, '0', '-1')) || []).length + 1;
  const scope = {
    works: recs.map((r) => r.id).sort(),
    batch: [...new Set(recs.map((r) => r.batch))].sort().join(','),
    ends_at: new Date(Math.min(...recs.map((r) => Date.parse(r.expires)))).toISOString(),
  };
  const issued = new Date().toISOString();
  const id = `c${n}`;
  return { id, name: `Campaign ${n}`, terms, scope, issued, message: campaignMessage({ action: 'start', id, terms, scope, issued }) };
}

const signedByHolder = async (message, signature) => {
  const c = await config();
  try { return await verifyMessage({ address: getAddress(c.holder), message, signature }); } catch (e) { return false; }
};
const fresh = (issued) => Math.abs(Date.now() - Date.parse(issued)) < 15 * 60 * 1000;

export async function startCampaign({ terms: termsIn, issued, signature }) {
  const d = await draftCampaign(termsIn);
  if (d.error) return d;
  if (!fresh(issued)) return { error: 'That signature is too old. Sign again.', status: 400 };
  const message = campaignMessage({ action: 'start', id: d.id, terms: d.terms, scope: d.scope, issued });
  if (!(await signedByHolder(message, signature))) return { error: 'Not signed by the holding wallet. Nothing started.', status: 403 };
  const rec = {
    id: d.id, name: d.name, ...d.terms, scope: d.scope,
    status: 'open', starts_at: new Date().toISOString(), ends_at: d.scope.ends_at,
    started: { issued, signature }, adviser: true,
  };
  const ok = await one('SET', K.open, d.id, 'NX');
  if (ok !== 'OK') return { error: 'A campaign is already open.', status: 409 };
  await pipe([['SET', K.campaign(d.id), JSON.stringify(rec)], ['RPUSH', K.list, d.id], ['DEL', K.view]]);
  return { ok: true, campaign: rec };
}

export async function closeCampaign(id, why, { issued = null, signature = null } = {}) {
  const c = await campaign(id);
  if (!c || c.status !== 'open') return { error: 'That campaign is not open.', status: 409 };
  if (why === 'closed by the artist') {
    if (!fresh(issued)) return { error: 'That signature is too old. Sign again.', status: 400 };
    const message = campaignMessage({ action: 'close', id, issued });
    if (!(await signedByHolder(message, signature))) return { error: 'Not signed by the holding wallet.', status: 403 };
  }
  const closed = { ...c, status: 'closed', closed_at: new Date().toISOString(), closed_why: why };
  await pipe([['SET', K.campaign(id), JSON.stringify(closed)], ['DEL', K.open], ['DEL', K.view]]);
  const s = await summary(closed);
  await enqueue('rebate-close', { campaign: closed.name, rebated_eth: s.rebated_eth, collectors: s.holders, scouts: s.scouts });
  return { ok: true, campaign: closed };
}

/** Closes an open campaign whose window has ended, or that has no live order
    left in it (sold, cancelled or expired, the campaign is over either way). */
export async function checkClose() {
  const c = await openCampaign();
  if (!c) return null;
  if (Date.now() >= Date.parse(c.ends_at)) return closeCampaign(c.id, 'the orders expired');
  const live = new Set((await records()).map((r) => r.id));
  if (!c.scope.works.some((w) => live.has(w))) return closeCampaign(c.id, 'no orders left in it');
  return null;
}

/* -------------------------------------------------------------- one sale */

/**
 * A rail fill, weighed against the open campaign. Called by the rail when it
 * tells a fill, before the tweet, so the tweet can say what happened.
 */
export async function onRailFill(rec, fill) {
  const c = await openCampaign();
  if (!c || !c.scope.works.includes(rec.id)) return null;
  const done = parse(await one('GET', K.sale(fill.tx)));
  if (done) return done;
  const client = chain();
  const [block, tx] = await Promise.all([
    client.getBlock({ blockNumber: BigInt(fill.block) }),
    client.getTransaction({ hash: fill.tx }),
  ]);
  const soldAt = new Date(Number(block.timestamp) * 1000).toISOString();
  if (soldAt < c.starts_at || soldAt > c.ends_at) return null;
  return allocateSale(c, { rec, fill, soldAt, input: tx.input });
}

async function allocateSale(c, { rec, fill, soldAt, input, snapshotId = null }) {
  const conf = await config();
  const artist = await siteJSON('data/source/artist.json').catch(() => null);
  const exclude = new Set([lower(conf.holder), ...Object.keys((artist && artist.wallets) || {}).map(lower)]);
  const snap = snapshotId ? await snapshotById(snapshotId) : await snapshotBefore(soldAt);
  const groups = await groupsFor(snap);
  const holders = eligibleHolders({ wallets: snap.wallets, groups, exclude, minTao: c.min_tao });

  const named = scoutFrom(input);
  let scout = null;
  let why = named ? null : 'no scout named in the transaction';
  if (named) {
    const s = groupTao({ wallets: snap.wallets, groups, wallet: named });
    const b = groupTao({ wallets: snap.wallets, groups, wallet: fill.buyer });
    if (exclude.has(named) || exclude.has(s.group)) why = 'the scout is the artist';
    else if (s.group === b.group) why = 'the scout is the buyer';
    else if (s.tao < c.min_tao) why = `the scout held ${s.tao} TAO, under ${c.min_tao}`;
    else scout = s.group;
  }
  const a = allocate({ priceWei: rec.rail_wei, holderPct: c.holder_pct, scoutPct: c.scout_pct, capPct: c.cap_pct, holders, scout });
  const sale = {
    campaign: c.id, tx: lower(fill.tx), block: fill.block, sold_at: soldAt,
    work: { id: rec.id, title: rec.title, collection: rec.collection_title },
    price_wei: String(rec.rail_wei), buyer: lower(fill.buyer),
    scout: { named, wallet: scout, why: scout ? null : why },
    snapshot: { id: snap.id, generated: snap.generated }, holders: holders.length,
    rebate_wei: a.total, holder_pool_wei: a.pool, unallocated_wei: a.unallocated,
    rows: a.rows,
    pct: c.holder_pct + c.scout_pct,
  };
  if (snapshotId) return sale;
  const first = await one('SET', K.sale(fill.tx), JSON.stringify(sale), 'NX');
  if (first !== 'OK') return parse(await one('GET', K.sale(fill.tx)));
  await pipe([['RPUSH', K.sales(c.id), lower(fill.tx)], ['DEL', K.view]]);
  return sale;
}

/** The same sale, allocated again from what it recorded: for checking, never written. */
export async function reallocate(tx) {
  const s = parse(await one('GET', K.sale(tx)));
  if (!s) return null;
  const c = await campaign(s.campaign);
  const rec = { id: s.work.id, title: s.work.title, collection_title: s.work.collection, rail_wei: s.price_wei };
  /* A stand-in calldata with the same scout in the same place: a selector
     and one word, then the marker. The allocation reads nothing else of it. */
  const input = s.scout.named ? withScout(`0x${'00'.repeat(36)}`, s.scout.named) : '0x';
  return allocateSale(c, { rec, fill: { tx, block: s.block, buyer: s.buyer }, soldAt: s.sold_at, input, snapshotId: s.snapshot.id });
}

/* -------------------------------------------------------------- the ledger */

export async function salesOf(id) {
  const txs = (await one('LRANGE', K.sales(id), '0', '-1')) || [];
  if (!txs.length) return [];
  return (await pipe(txs.map((t) => ['GET', K.sale(t)]))).map(parse).filter(Boolean);
}

export async function payouts() {
  return ((await one('LRANGE', K.payouts, '0', '-1')) || []).map(parse).filter(Boolean);
}

/** Owed per wallet across every campaign, paid per wallet across every payout. */
export async function balances() {
  const all = await campaigns();
  const owed = new Map();
  for (const c of all) {
    for (const s of await salesOf(c.id)) {
      for (const r of s.rows) {
        const o = owed.get(r.wallet) || { wallet: r.wallet, owed: 0n, kinds: new Set(), by: {} };
        o.owed += BigInt(r.amount_wei);
        o.kinds.add(r.kind);
        o.by[c.id] = String(BigInt(o.by[c.id] || 0) + BigInt(r.amount_wei));
        owed.set(r.wallet, o);
      }
    }
  }
  const paid = new Map();
  for (const p of await payouts()) for (const [w, v] of p.pairs) paid.set(w, (paid.get(w) || 0n) + BigInt(v));
  return { owed, paid, campaigns: all };
}

async function summary(c) {
  const sales = await salesOf(c.id);
  let rebated = 0n;
  const holders = new Set();
  const scouts = new Set();
  for (const s of sales) {
    rebated += BigInt(s.rebate_wei) - BigInt(s.unallocated_wei || 0);
    for (const r of s.rows) (r.kind === 'scout' ? scouts : holders).add(r.wallet);
  }
  return { sales: sales.length, rebated_wei: String(rebated), rebated_eth: eth(rebated), holders: holders.size, scouts: scouts.size };
}

/**
 * The public ledger, as /ai draws it: every campaign, what it has rebated, and
 * who is owed what, largest first. A viewer's own row is found wherever it
 * falls. Names are the register's, and a private collector stays unnamed.
 */
export async function view({ wallet = null, limit = 60 } = {}) {
  const cachedAll = wallet ? null : parse(await one('GET', K.view));
  if (cachedAll) return cachedAll;
  const { owed, paid, campaigns: all } = await balances();
  if (!all.length) return { campaigns: [], owed: [], count: 0 };
  const reg = await register();
  const nameOf = (a) => {
    const w = reg && reg.who ? reg.who(a) : null;
    if (w && w.private) return { name: w.name || null, url: null };
    return { name: (w && (w.x ? `@${w.x}` : w.name)) || null, url: reg && reg.urlOf ? reg.urlOf(a) : null };
  };
  const rows = [...owed.values()].map((o) => {
    const p = paid.get(o.wallet) || 0n;
    return { wallet: o.wallet, ...nameOf(o.wallet), kind: [...o.kinds].sort().join(' + '),
      owed_wei: String(o.owed), owed_eth: eth(o.owed), paid_wei: String(p), paid_eth: eth(p) };
  }).sort((a, b) => (BigInt(b.owed_wei) > BigInt(a.owed_wei) ? 1 : BigInt(b.owed_wei) < BigInt(a.owed_wei) ? -1 : 0));
  const cs = [];
  for (const c of all) {
    const sales = await salesOf(c.id);
    const s = await summary(c);
    cs.push({
      id: c.id, name: c.name, status: c.status, starts_at: c.starts_at, ends_at: c.ends_at,
      closed_at: c.closed_at || null, closed_why: c.closed_why || null,
      holder_pct: c.holder_pct, scout_pct: c.scout_pct, min_tao: c.min_tao, cap_pct: c.cap_pct,
      min_payout_eth: c.min_payout_eth, works: c.scope.works.length, ...s,
      sale_rows: sales.map((x) => ({
        tx: x.tx, sold_at: x.sold_at, work: x.work, price_eth: eth(x.price_wei),
        rebate_eth: eth(x.rebate_wei), holder_pool_eth: eth(x.holder_pool_wei), holders: x.holders,
        scout: x.scout.wallet ? { wallet: x.scout.wallet, ...nameOf(x.scout.wallet) } : null,
        top: x.rows.filter((r) => r.kind === 'holder').slice(0, 10).map((r) => ({ wallet: r.wallet, ...nameOf(r.wallet), eth: eth(r.amount_wei) })),
      })),
    });
  }
  const out = { campaigns: cs, owed: rows.slice(0, limit), count: rows.length };
  if (wallet) out.you = rows.find((r) => r.wallet === lower(wallet)) || null;
  else await one('SET', K.view, JSON.stringify(out), 'EX', '120');
  return out;
}

/* -------------------------------------------------------------- payout */

/**
 * The Disperse batch for everybody owed at least the minimum, net of what has
 * been paid, across every campaign so far: what one campaign left under the
 * minimum rolls into the next one's. Split into transactions of CHUNK
 * recipients. Nothing here sends anything; the holder signs each one.
 */
export async function payoutPlan(id) {
  const c = await campaign(id);
  if (!c) return { error: 'No such campaign.', status: 404 };
  if (c.status === 'open') return { error: 'Close the campaign before preparing its payout.', status: 409 };
  const min = BigInt(Math.round(Number(c.min_payout_eth) * 1e9)) * 10n ** 9n;
  const { owed, paid } = await balances();
  const due = [];
  const below = [];
  for (const o of owed.values()) {
    const left = o.owed - (paid.get(o.wallet) || 0n);
    if (left <= 0n) continue;
    (left >= min ? due : below).push({ wallet: o.wallet, wei: left });
  }
  due.sort((a, b) => (b.wei > a.wei ? 1 : b.wei < a.wei ? -1 : (a.wallet < b.wallet ? -1 : 1)));
  const chunks = [];
  for (let i = 0; i < due.length; i += CHUNK) {
    const part = due.slice(i, i + CHUNK);
    const value = part.reduce((s, x) => s + x.wei, 0n);
    chunks.push({
      count: part.length, value_wei: String(value), value_eth: eth(value),
      tx: { to: DISPERSE, value: String(value),
        data: encodeFunctionData({ abi: DISPERSE_ABI, functionName: 'disperseEther',
          args: [part.map((x) => getAddress(x.wallet)), part.map((x) => x.wei)] }) },
    });
  }
  const total = due.reduce((s, x) => s + x.wei, 0n);
  const under = below.reduce((s, x) => s + x.wei, 0n);
  return { campaign: id, recipients: due.length, total_wei: String(total), total_eth: eth(total), chunks,
    below: { count: below.length, total_wei: String(under), total_eth: eth(under) }, min_payout_eth: c.min_payout_eth };
}

/**
 * A payout the holder sent, read back from the chain and written down: every
 * recipient and amount in a Disperse call from the holding wallet. Only such a
 * transaction counts, so this needs no signature of its own.
 */
export async function recordPayout(txHash) {
  const conf = await config();
  const client = chain();
  const [tx, receipt] = await Promise.all([client.getTransaction({ hash: txHash }), client.getTransactionReceipt({ hash: txHash })]);
  if (receipt.status !== 'success') return { error: 'That transaction failed on chain.', status: 409 };
  if (lower(tx.from) !== lower(conf.holder)) return { error: 'That transaction was not sent by the holding wallet.', status: 403 };
  if (lower(tx.to) !== lower(DISPERSE)) return { error: 'That transaction is not a Disperse payout.', status: 409 };
  const d = decodeFunctionData({ abi: DISPERSE_ABI, data: tx.input });
  if (d.functionName !== 'disperseEther') return { error: 'That is not an ETH payout.', status: 409 };
  const pairs = d.args[0].map((w, i) => [lower(w), String(d.args[1][i])]);
  const rec = { tx: lower(txHash), at: new Date().toISOString(), pairs,
    total_wei: String(d.args[1].reduce((s, v) => s + v, 0n)) };
  const first = await one('SET', K.payoutTx(txHash), '1', 'NX');
  if (first !== 'OK') return { ok: true, already: true };
  await pipe([['RPUSH', K.payouts, JSON.stringify(rec)], ['DEL', K.view]]);
  /* Every closed campaign whose owed rows are now all paid, or under the
     minimum, is paid. */
  const { owed, paid, campaigns: all } = await balances();
  for (const c of all.filter((x) => x.status === 'closed')) {
    const min = BigInt(Math.round(Number(c.min_payout_eth) * 1e9)) * 10n ** 9n;
    const open = [...owed.values()].some((o) => o.owed - (paid.get(o.wallet) || 0n) >= min);
    if (!open) {
      await one('SET', K.campaign(c.id), JSON.stringify({ ...c, status: 'paid', paid_at: rec.at }));
      const sum = (await payouts()).reduce((s, p) => s + BigInt(p.total_wei), 0n);
      await enqueue('rebate-paid', { campaign: c.name, paid_eth: eth(sum) });
    }
  }
  return { ok: true, recipients: pairs.length, total_eth: eth(rec.total_wei) };
}
