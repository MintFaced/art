/* The agent rail: what an AI with a wallet can buy, the order it fills, and
 * what happens when it does (AAB.md, docs/AGENT-RAIL.md).
 *
 * THE SHAPE OF IT. The holding wallet signs a batch of Seaport sell orders at
 * the rail price, once, from a hardware wallet (/mintwork/rail). The orders live in
 * the store, never in the repo. An agent asks /ai/buy/{id}, is answered with a
 * 402 carrying the order and the transaction that fills it, sends that
 * transaction from its own wallet, and comes back with the hash. Payment and
 * token cross in one transaction on Ethereum; nothing here ever holds either.
 *
 * WHAT THE SERVER CAN AND CANNOT DO. It cannot make an order: only the
 * holder's signature does, and a batch signed by anybody else is refused. It
 * cannot stop a fill: the order is on Seaport's terms from the moment it is
 * served. What it can do is decline to serve an order that has gone stale,
 * and tell the story of a fill once it has happened.
 */
import { createPublicClient, encodeFunctionData, fallback, formatEther, getAddress, http, parseAbi, parseEther,
  recoverAddress, verifyMessage } from 'viem';
import { mainnet } from 'viem/chains';
import { one, pipe, storeConfigured } from './kv.js';
import * as S from './seaport.js';
import { siteJSON } from './data.js';
import { enqueue } from './wire.js';
import { stateConfigured, writeWorkState } from './state.js';

/* ---------- the chain ---------- */

const NODES = () => {
  const own = (process.env.AAB_RPC || process.env.ETH_RPCS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return own.length ? own : ['https://ethereum-rpc.publicnode.com', 'https://eth.llamarpc.com', 'https://cloudflare-eth.com'];
};
let CLIENT = null;
export const chain = () => CLIENT || (CLIENT = createPublicClient({
  chain: mainnet,
  transport: fallback(NODES().map((u) => http(u, { timeout: 12_000 }))),
  batch: { multicall: true },
}));
/** For the tests, and a fork: the client every call here goes through. */
export const useClient = (c) => { CLIENT = c; };

export const NFT_ABI = parseAbi([
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function balanceOf(address owner, uint256 id) view returns (uint256)',
  'function isApprovedForAll(address owner, address operator) view returns (bool)',
  'function setApprovalForAll(address operator, bool approved)',
]);
const REGISTRY_ABI = parseAbi(['function balanceOf(address owner) view returns (uint256)']);

/* ---------- config ---------- */

let CONF = null;
export async function config() {
  if (CONF && (CONF.pinned || Date.now() - CONF.at < 60_000)) return CONF.v;
  const v = await siteJSON('data/source/aab.json');
  if (!v || !v.holder) throw new Error('the agent rail has no config');
  CONF = { v, at: Date.now() };
  return v;
}
/** For the tests: a config that is not fetched. */
export const useConfig = (v) => { CONF = { v, at: Date.now(), pinned: true }; };

const site = () => (process.env.SITE_PUBLIC || 'https://mintface.art');

/* ---------- the store ---------- */

export const K = {
  order: (id) => `aab:o:${id}`,
  ids: 'aab:ids',
  hash: (h) => `aab:h:${String(h).toLowerCase()}`,
  draft: (d) => `aab:draft:${d}`,
  fill: (id) => `aab:fill:${id}`,
  tx: (h) => `aab:tx:${String(h).toLowerCase()}`,
  fills: 'aab:fills',
  retired: 'aab:retired',
  gone: 'aab:gone',
  feed: 'aab:feed',
  lock: (what) => `aab:lock:${what}`,
};

const parse = (v) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch (e) { return null; } };
const randomHex = (bytes) => `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString('hex')}`;
const eth = (wei) => (wei == null ? null : Number(formatEther(BigInt(wei))));

/** One of these at a time, for a while: a cheap fence round the public writes. */
async function fence(what, seconds) {
  const ok = await one('SET', K.lock(what), '1', 'NX', 'EX', String(seconds));
  return ok === 'OK';
}

/* ---------- the price ---------- */

/**
 * The list price in wei. THE LISTING IS THE PRICE: where the work is listed,
 * the listing is what the site shows and what a human pays, so it is what the
 * rail takes its quarter off. Where it is not, the catalogue figure.
 */
export function listWei(work, listing) {
  if (listing && listing.kind !== 'auction') {
    if (listing.price_wei && /^\d+$/.test(String(listing.price_wei))) return BigInt(listing.price_wei);
    if (listing.price_eth) return parseEther(String(listing.price_eth));
  }
  if (work && work.listed_eth) return parseEther(String(work.listed_eth));
  return null;
}
export const railWei = (list, bps) => (list * BigInt(bps)) / 10000n;

const imageOf = (w) => {
  const d = w.digital || {};
  if (w.assets && w.assets.image) return `https://assets.mintface.art/${w.assets.image}`;
  if (d.image_source && /^https?:/.test(d.image_source)) return d.image_source;
  return d.image || null;
};

/**
 * Every work in the rail's collections, with where it stands and what it would
 * cost on the rail. Sale state is laid over the catalogue the way the site
 * lays it, so a work sold this morning is sold here too.
 */
export async function railWorks() {
  const c = await config();
  const [listings, state] = await Promise.all([
    siteJSON('data/listings.json', { fresh: true }),
    siteJSON('data/state.json', { fresh: true }),
  ]);
  const out = [];
  for (const slug of c.sets) {
    const col = await siteJSON(`data/c/${slug}.json`);
    for (const w of (col && col.works) || []) {
      const d = w.digital || {};
      if (!d.contract || d.token_id == null || (d.chain && d.chain !== 'ethereum')) continue;
      const st = state && state.works ? state.works[w.id] : null;
      const listing = listings && listings.works ? listings.works[w.id] : null;
      const list = listWei(w, listing);
      out.push({
        id: w.id,
        title: w.title || w.id,
        collection: slug,
        collection_title: (col && col.title) || slug,
        status: (st && st.status) || w.status,
        contract: getAddress(d.contract),
        token_id: String(d.token_id),
        standard: d.standard || 'ERC-721',
        edition: (w.edition && w.edition.type) || '1/1',
        image: imageOf(w),
        url: `${site()}/w/${encodeURIComponent(w.id)}`,
        list_wei: list,
        rail_wei: list ? railWei(list, c.rate_bps) : null,
        listing_url: listing && listing.url ? listing.url : null,
      });
    }
  }
  return out;
}

/* ---------- drafting a batch ---------- */

const holderOf = async (works, holder) => chain().multicall({
  allowFailure: true,
  contracts: works.map((w) => (/1155/.test(w.standard)
    ? { address: w.contract, abi: NFT_ABI, functionName: 'balanceOf', args: [holder, BigInt(w.token_id)] }
    : { address: w.contract, abi: NFT_ABI, functionName: 'ownerOf', args: [BigInt(w.token_id)] })),
});

/**
 * The batch the holder is about to sign: every available work the holding
 * wallet actually holds, on a contract it has already approved the conduit
 * for, priced and dated. Kept for an hour under an id; the page asks the
 * wallet to sign it and sends the signature back with the id.
 *
 * What is left out is said, with why. A work in Foundation's escrow is
 * `available` in the catalogue and cannot be sold by an order from this
 * wallet, and pretending otherwise would put an order on the rail that no
 * agent can ever fill.
 */
export async function draft({ ids = null } = {}) {
  const c = await config();
  const holder = getAddress(c.holder);
  const all = (await railWorks()).filter((w) => !ids || ids.includes(w.id));
  /* ONE LIVE ORDER PER WORK. Drafting everything leaves out a work that
     already has an order with more than the renewal window left, because
     signing it again would put a second live order for it on Seaport, and
     every extra order is one more thing a cancel has to name. A work named
     outright (a renewal) is drafted whatever it has. */
  const live = new Map((await records()).map((r) => [r.id, r]));
  const soon = Date.now() + Number(c.renew_within_days || 7) * 86400 * 1000;
  const skipped = [];
  const candidates = [];
  let onRail = 0;
  for (const w of all) {
    if (w.status !== 'available') continue;
    const has = live.get(w.id);
    if (!ids && has && Date.parse(has.expires) > soon) { onRail += 1; continue; }
    if (!w.rail_wei) { skipped.push({ id: w.id, title: w.title, why: 'no list price' }); continue; }
    candidates.push(w);
  }
  if (!candidates.length) return { orders: [], skipped, needs_approval: [], on_rail: onRail };

  const client = chain();
  const operator = S.OPENSEA_CONDUIT;
  const contracts = [...new Set(candidates.map((w) => w.contract))];
  const [counter, owners, approvals] = await Promise.all([
    client.readContract({ address: S.SEAPORT, abi: S.SEAPORT_ABI, functionName: 'getCounter', args: [holder] }),
    holderOf(candidates, holder),
    client.multicall({ allowFailure: true, contracts: contracts.map((a) => ({
      address: a, abi: NFT_ABI, functionName: 'isApprovedForAll', args: [holder, operator] })) }),
  ]);
  const approved = new Map(contracts.map((a, i) => [a, approvals[i].status === 'success' && approvals[i].result === true]));
  const included = [];
  candidates.forEach((w, i) => {
    const o = owners[i];
    const holds = o.status === 'success' && (/1155/.test(w.standard)
      ? BigInt(o.result) > 0n
      : String(o.result).toLowerCase() === holder.toLowerCase());
    if (!holds) {
      skipped.push({ id: w.id, title: w.title, why: o.status === 'success'
        ? `not in ${c.holder_name || 'the holding wallet'}${/1155/.test(w.standard) ? '' : ` (held by ${o.result})`}`
        : 'could not read who holds it' });
      return;
    }
    if (!approved.get(w.contract)) { skipped.push({ id: w.id, title: w.title, why: 'its contract has not approved the conduit' }); return; }
    included.push(w);
  });
  const needs = contracts.filter((a) => !approved.get(a)).map((a) => ({
    contract: a,
    collection: candidates.find((w) => w.contract === a).collection_title,
    tx: { to: a, data: approvalData(operator), value: '0' },
  }));
  if (!included.length) return { orders: [], skipped, needs_approval: needs, on_rail: onRail };

  const now = Math.floor(Date.now() / 1000);
  const start = now - 60;
  const end = now + Number(c.days || 30) * 86400;
  const orders = included.map((w) => S.sellOrder({
    offerer: holder, token: w.contract, tokenId: w.token_id, standard: w.standard,
    priceWei: w.rail_wei, startTime: start, endTime: end, salt: BigInt(randomHex(32)), counter,
  }));
  const tree = S.bulkTree(orders);
  const id = randomHex(12).slice(2);
  const works = included.map((w) => ({ ...w, list_wei: String(w.list_wei), rail_wei: String(w.rail_wei) }));
  await one('SET', K.draft(id), JSON.stringify({
    id, created: new Date().toISOString(), holder, counter: String(counter),
    works, orders: orders.map(S.orderToJSON),
  }), 'EX', '3600');
  return {
    draft: id,
    count: orders.length,
    height: tree.height,
    expires: new Date(end * 1000).toISOString(),
    typed: typedForWallet(tree),
    orders: included.map((w) => ({ id: w.id, title: w.title, collection: w.collection_title,
      list_eth: eth(w.list_wei), rail_eth: eth(w.rail_wei) })),
    skipped,
    needs_approval: needs,
    on_rail: onRail,
  };
}

const approvalData = (operator) =>
  encodeFunctionData({ abi: NFT_ABI, functionName: 'setApprovalForAll', args: [operator, true] });

/* What eth_signTypedData_v4 is handed: EIP712Domain named in the types, and
   every number a decimal string, which is how every wallet wants them. */
export function typedForWallet(tree) {
  const t = S.bulkTypedData(tree);
  return JSON.parse(JSON.stringify({
    ...t,
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' }, { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' },
      ],
      ...t.types,
    },
  }, (k, v) => (typeof v === 'bigint' ? v.toString() : v)));
}

/* ---------- keeping a signed batch ---------- */

/**
 * The signature for a drafted batch, checked and kept.
 *
 * ONLY THE HOLDER'S. The signature is recovered against the batch's root and
 * refused unless it is the holding wallet's, so nobody can put an order on the
 * rail by posting here ... the page is public and so is this route. Then one
 * of the orders is put to Seaport's own validate(), as a call that changes
 * nothing, so a signature Seaport would refuse is refused here first.
 */
export async function keepSigned({ draft: id, signature }) {
  const c = await config();
  const d = parse(await one('GET', K.draft(id)));
  if (!d) return { error: 'That batch has expired. Draft it again.', status: 410 };
  const sig = S.normalizeSignature(signature);
  const orders = d.orders.map(S.orderFromJSON);
  const tree = S.bulkTree(orders);
  let signer;
  try { signer = await recoverAddress({ hash: S.bulkDigest(tree.root, tree.height), signature: sig }); }
  catch (e) { return { error: 'That is not a signature this batch can read.', status: 400 }; }
  if (signer.toLowerCase() !== String(c.holder).toLowerCase()) {
    return { error: `Signed by ${signer}, not by ${c.holder_name || c.holder}. Nothing was kept.`, status: 403 };
  }
  const packed = orders.map((o, i) => S.packBulkSignature(sig, i, S.proofFor(tree, i)));
  try {
    const ok = await chain().simulateContract({
      address: S.SEAPORT, abi: S.SEAPORT_ABI, functionName: 'validate',
      args: [[S.asOrder(orders[0], packed[0])]], account: '0x000000000000000000000000000000000000dEaD',
    });
    if (ok.result !== true) return { error: 'Seaport would not accept this batch. Nothing was kept.', status: 422 };
  } catch (e) {
    return { error: `Seaport would not accept this batch: ${String(e.shortMessage || e.message).slice(0, 140)}`, status: 422 };
  }

  const before = await pipe(d.works.map((w) => ['GET', K.order(w.id)]));
  const cmds = [];
  let retired = 0;
  d.works.forEach((w, i) => {
    const old = parse(before[i]);
    /* An order this one replaces is still good on Seaport until it expires or
       is cancelled, and whoever was served it can still fill it. So it is
       kept, price changed or not: "cancel everything" has to be able to name
       every order that was ever handed out and has not yet run out. */
    if (old && old.hash !== S.orderHash(orders[i]) && Date.parse(old.expires) > Date.now()) {
      cmds.push(['RPUSH', K.retired, JSON.stringify({ id: old.id, hash: old.hash, order: old.order,
        rail_wei: old.rail_wei, expires: old.expires, retired: new Date().toISOString() })]);
      retired += 1;
    }
    const hash = S.orderHash(orders[i]);
    const rec = {
      id: w.id, title: w.title, collection: w.collection, collection_title: w.collection_title,
      contract: w.contract, token_id: w.token_id, standard: w.standard, edition: w.edition,
      image: w.image, url: w.url, listing_url: w.listing_url,
      list_wei: w.list_wei, rail_wei: w.rail_wei,
      order: d.orders[i], signature: packed[i], hash,
      start: new Date(Number(orders[i].startTime) * 1000).toISOString(),
      expires: new Date(Number(orders[i].endTime) * 1000).toISOString(),
      batch: id, signed_at: new Date().toISOString(),
    };
    cmds.push(['SET', K.order(w.id), JSON.stringify(rec)], ['SADD', K.ids, w.id], ['SET', K.hash(hash), w.id]);
  });
  cmds.push(['DEL', K.draft(id)], ['DEL', K.feed]);
  await pipe(cmds);
  return { kept: d.works.length, retired, expires: new Date(Number(orders[0].endTime) * 1000).toISOString() };
}

/* ---------- reading what is on the rail ---------- */

export async function records() {
  const ids = (await one('SMEMBERS', K.ids)) || [];
  if (!ids.length) return [];
  const rows = await pipe(ids.map((i) => ['GET', K.order(i)]));
  return rows.map(parse).filter(Boolean);
}

export const recordFor = async (id) => parse(await one('GET', K.order(id)));

/**
 * The feed an agent reads: every work with a live order on it, and nothing
 * else. Absence is silent ... a work sold, cancelled or expired simply is not
 * here. Rebuilt at most every five minutes, and at once after anything that
 * changes it.
 */
export async function feed() {
  const cached = parse(await one('GET', K.feed));
  if (cached) return cached;
  const [recs, state] = await Promise.all([records(), siteJSON('data/state.json', { fresh: true })]);
  const now = Date.now();
  const works = recs
    .filter((r) => Date.parse(r.expires) > now)
    .filter((r) => { const s = state && state.works && state.works[r.id]; return !s || !s.status || s.status === 'available'; })
    .sort((a, b) => a.collection.localeCompare(b.collection) || a.id.localeCompare(b.id, 'en', { numeric: true }))
    .map((r) => ({
      id: r.id, title: r.title, collection: r.collection, collection_title: r.collection_title,
      chain: 'ethereum', contract: r.contract, token_id: r.token_id, standard: r.standard, edition: r.edition,
      image: r.image,
      list_price_eth: eth(r.list_wei), ai_price_eth: eth(r.rail_wei), ai_price_wei: r.rail_wei,
      order_expires: r.expires,
      url: r.url,
      buy: `${site()}/ai/buy/${encodeURIComponent(r.id)}`,
    }));
  const out = {
    generated_at: new Date().toISOString(),
    count: works.length,
    rail: {
      chain: 'ethereum', chain_id: 1, currency: 'ETH',
      seaport: S.SEAPORT, seaport_version: S.VERSION,
      how: `${site()}/llms.txt`,
    },
    works,
  };
  await one('SET', K.feed, JSON.stringify(out), 'EX', '300');
  return out;
}

/* ---------- the chain's view of one order ---------- */

export async function liveState(rec) {
  const client = chain();
  const c = await config();
  const holder = String(c.holder).toLowerCase();
  const [status, owner, counter] = await client.multicall({
    allowFailure: true,
    contracts: [
      { address: S.SEAPORT, abi: S.SEAPORT_ABI, functionName: 'getOrderStatus', args: [rec.hash] },
      /1155/.test(rec.standard)
        ? { address: rec.contract, abi: NFT_ABI, functionName: 'balanceOf', args: [getAddress(c.holder), BigInt(rec.token_id)] }
        : { address: rec.contract, abi: NFT_ABI, functionName: 'ownerOf', args: [BigInt(rec.token_id)] },
      { address: S.SEAPORT, abi: S.SEAPORT_ABI, functionName: 'getCounter', args: [getAddress(c.holder)] },
    ],
  });
  if (status.status !== 'success') return { state: 'unknown' };
  const [, cancelled, filled, total] = status.result;
  if (total > 0n && filled >= total) return { state: 'filled' };
  if (cancelled) return { state: 'cancelled' };
  /* Voided by the counter. Seaport does not mark these cancelled ... the hash
     they were signed under simply stops being the hash of anything fillable ...
     so getOrderStatus says nothing and the counter is the only witness. */
  if (counter.status === 'success' && String(counter.result) !== String(rec.order.counter)) return { state: 'cancelled' };
  if (Date.parse(rec.expires) <= Date.now()) return { state: 'expired' };
  if (owner.status === 'success') {
    const holds = /1155/.test(rec.standard) ? BigInt(owner.result) > 0n : String(owner.result).toLowerCase() === holder;
    if (!holds) return { state: 'moved', owner: /1155/.test(rec.standard) ? null : owner.result };
  }
  return { state: 'live' };
}

/** A fill of this order in this transaction, or why not. */
export async function fillIn(txHash, rec) {
  let receipt;
  try { receipt = await chain().getTransactionReceipt({ hash: txHash }); }
  catch (e) { return { pending: true }; }
  if (receipt.status !== 'success') return { error: 'That transaction failed on chain.' };
  const hit = S.fillsIn(receipt).find((f) => String(f.orderHash).toLowerCase() === String(rec.hash).toLowerCase());
  if (!hit) return { error: 'That transaction did not fill this order.' };
  return { tx: receipt.transactionHash, buyer: String(hit.recipient).toLowerCase(), block: Number(receipt.blockNumber) };
}

/**
 * Where an order was filled, when nobody told us: the offerer's fills since
 * the order opened, searched a slice at a time because a public node will not
 * answer for a month of blocks in one go.
 */
export async function findFill(rec) {
  const client = chain();
  const c = await config();
  const latest = await client.getBlockNumber();
  const back = BigInt(Math.ceil((Date.now() - Date.parse(rec.start)) / 12000) + 300);
  const floor = latest > back ? latest - back : 0n;
  const STEP = 10_000n;
  for (let to = latest; to > floor; to -= STEP) {
    const from = to - STEP + 1n > floor ? to - STEP + 1n : floor;
    try {
      const logs = await client.getContractEvents({
        address: S.SEAPORT, abi: S.SEAPORT_ABI, eventName: 'OrderFulfilled',
        args: { offerer: getAddress(c.holder) }, fromBlock: from, toBlock: to,
      });
      const hit = logs.find((l) => String(l.args.orderHash).toLowerCase() === String(rec.hash).toLowerCase());
      if (hit) return { tx: hit.transactionHash, buyer: String(hit.args.recipient).toLowerCase(), block: Number(hit.blockNumber) };
    } catch (e) { /* a node that will not take this slice; the caller can be told the hash later */ }
  }
  return null;
}

/* ---------- a fill, told once ---------- */

async function registered(address) {
  const c = await config();
  if (!c.erc8004_registry) return null;
  try {
    const n = await chain().readContract({ address: getAddress(c.erc8004_registry), abi: REGISTRY_ABI,
      functionName: 'balanceOf', args: [getAddress(address)] });
    return n > 0n;
  } catch (e) { return null; }
}

/**
 * Everything that follows a fill, exactly once whoever notices it first: the
 * buy route when the agent comes back, the nightly TAO run when it did not.
 *
 * The work is marked collected in the sale state (which the site lays over the
 * catalogue within a deploy), the fill is written down, and the tweet is
 * queued. TAO needs nothing from here: a Seaport sale is a sale to the nightly
 * run, and it starts the buyer's clock on its own.
 */
export async function recordFill(rec, { tx, buyer, block }) {
  const at = new Date().toISOString();
  const fill = {
    id: rec.id, title: rec.title, collection: rec.collection, collection_title: rec.collection_title,
    image: rec.image, url: rec.url,
    tx, buyer, block, order_hash: rec.hash,
    price_wei: rec.rail_wei, price_eth: eth(rec.rail_wei), list_eth: eth(rec.list_wei),
    erc8004: await registered(buyer),
    at,
  };
  const first = await one('SET', K.fill(rec.id), JSON.stringify(fill), 'NX');
  if (first !== 'OK') return { fill: parse(await one('GET', K.fill(rec.id))), fresh: false };
  await pipe([
    ['SET', K.tx(tx), rec.id],
    ['LPUSH', K.fills, JSON.stringify(fill)],
    ['SREM', K.ids, rec.id],
    ['DEL', K.feed],
  ]);
  if (stateConfigured()) {
    try {
      await writeWorkState(rec.id, {
        status: 'acquired',
        what: 'digital',
        via: 'agent-rail',
        paid: { amount: fill.price_eth, currency: 'ETH', tx, from: buyer, at, via: 'agent-rail' },
        collector: { address: buyer, ens: null, display_name: null, note: null, acquired: at },
        token_transfer: 'done',
      }, `Collected on the agent rail: ${rec.title} (${fill.price_eth} ETH)`);
    } catch (e) { console.error('aab: sale state not written', rec.id, String(e.message || e)); }
  }
  await enqueue('sale', {
    id: rec.id, title: rec.title, collection: rec.collection_title,
    price: `${fill.price_eth} ETH`, address: buyer, url: rec.url,
    image: `${site()}/api/og?work=${encodeURIComponent(rec.id)}`,
    tx, via: 'agent-rail',
  });
  return { fill, fresh: true };
}

/**
 * For the nightly TAO run, before it queues a sale tweet: is this transaction
 * a fill of a rail order? If the rail already told it, the run stays quiet; if
 * nobody has, it is told now, the rail's way.
 */
export async function railSale(txHash, { seller } = {}) {
  if (!storeConfigured()) return null;
  const c = await config();
  if (seller && String(seller).toLowerCase() !== String(c.holder).toLowerCase()) return null;
  const known = await one('GET', K.tx(txHash));
  if (known) return { id: known, told: true };
  let receipt;
  try { receipt = await chain().getTransactionReceipt({ hash: txHash }); } catch (e) { return null; }
  for (const f of S.fillsIn(receipt)) {
    const id = await one('GET', K.hash(f.orderHash));
    if (!id) continue;
    const rec = await recordFor(id);
    if (!rec) continue;
    await recordFill(rec, { tx: receipt.transactionHash, buyer: String(f.recipient).toLowerCase(), block: Number(receipt.blockNumber) });
    return { id, told: false };
  }
  return null;
}

/* ---------- the door ---------- */

const secondsLeft = (rec) => Math.max(0, Math.floor((Date.parse(rec.expires) - Date.now()) / 1000));

export function welcome(fill) {
  return {
    ok: true,
    message: 'Welcome to the register.',
    work: { id: fill.id, title: fill.title, collection: fill.collection_title, image: fill.image, url: fill.url },
    tx: fill.tx,
    etherscan: `https://etherscan.io/tx/${fill.tx}`,
    collector: fill.buyer,
    register: `https://collectors.mintface.art/${fill.buyer}`,
    price_eth: fill.price_eth,
    tao: 'TAO accrues from the next daily recompute. With it you can weigh in, propose colours and speak in the Studio.',
    studio: `${site()}/studio`,
  };
}

/** The 402: the order, the transaction that fills it, and what to do after. */
export function paymentRequired(rec, c) {
  const components = S.orderFromJSON(rec.order);
  const tx = S.fulfillTransaction(components, rec.signature);
  const url = `${site()}/ai/buy/${encodeURIComponent(rec.id)}`;
  return {
    x402Version: 1,
    error: 'Payment required. Fill the Seaport order below from your own wallet, then request this URL again with the transaction hash.',
    accepts: [{
      scheme: 'seaport-fill',
      network: 'ethereum',
      chainId: 1,
      maxAmountRequired: String(rec.rail_wei),
      asset: 'ETH',
      payTo: getAddress(c.holder),
      resource: url,
      description: `${rec.title}, ${rec.collection_title}. ${eth(rec.rail_wei)} ETH on the agent rail, ${100 - Number(c.rate_bps) / 100}% under list.`,
      mimeType: 'application/json',
      maxTimeoutSeconds: secondsLeft(rec),
      extra: {
        work: { id: rec.id, title: rec.title, collection: rec.collection_title, contract: rec.contract,
          token_id: rec.token_id, standard: rec.standard, image: rec.image, url: rec.url },
        price_eth: eth(rec.rail_wei),
        list_price_eth: eth(rec.list_wei),
        order_hash: rec.hash,
        order_expires: rec.expires,
        seaport: { address: S.SEAPORT, version: S.VERSION },
        order: JSON.parse(JSON.stringify(S.asOrder(components, rec.signature), (k, v) => (typeof v === 'bigint' ? v.toString() : v))),
        transaction: { chainId: tx.chainId, to: tx.to, value: tx.value.toString(), data: tx.data },
        then: {
          how: 'Request this URL again with the transaction hash, either as the X-PAYMENT header or as ?tx=0x...',
          example: `curl -H "X-PAYMENT: 0xYOUR_TX_HASH" ${url}`,
        },
        custody: 'None. Payment and token cross in one Seaport transaction; the token goes to the address that sends it.',
      },
    }],
  };
}

/* Read the hash an agent came back with: a bare hash, or x402's base64 JSON. */
export function paymentHash(header, query) {
  const raw = String(header || query || '').trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(raw)) return raw;
  try {
    const j = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    const h = j.txHash || j.tx || j.transactionHash || (j.payload && (j.payload.txHash || j.payload.transactionHash));
    return /^0x[0-9a-fA-F]{64}$/.test(String(h)) ? String(h) : null;
  } catch (e) { return null; }
}

/**
 * The agent gate (ERC-8004), off unless the config turns it on. When on, the
 * order is only served to a wallet that signs for this request and holds an
 * identity in the registry. The signature is over three lines, so it names
 * this site, this work, and a moment within the last fifteen minutes.
 */
export const gateMessage = (id, issued) => `mintface.art agent rail\nWork: ${id}\nIssued: ${issued}`;
export async function gate(c, id, headers) {
  if (!c.gate_8004) return null;
  if (!c.erc8004_registry) return { status: 503, body: { error: 'The agent gate is on, but no registry is set. Nothing is served until it is.' } };
  const address = headers.get('x-agent-address');
  const signature = headers.get('x-agent-signature');
  const issued = headers.get('x-agent-issued');
  const fresh = issued && Math.abs(Date.now() - Date.parse(issued)) < 15 * 60 * 1000;
  const need = { error: 'This rail serves registered agents. Send X-Agent-Address, X-Agent-Issued (ISO time) and X-Agent-Signature (personal_sign of the message below).',
    message: gateMessage(id, issued || 'YYYY-MM-DDTHH:MM:SSZ') };
  if (!address || !signature || !fresh) return { status: 403, body: need };
  let ok = false;
  try { ok = await verifyMessage({ address: getAddress(address), message: gateMessage(id, issued), signature }); } catch (e) { ok = false; }
  if (!ok) return { status: 403, body: { ...need, error: 'That signature does not match that address and message.' } };
  if (await registered(address) !== true) return { status: 403, body: { error: 'That address holds no identity in the agent registry.', registry: c.erc8004_registry } };
  return null;
}

/**
 * GET /ai/buy/{id}. Five answers:
 *   200  it is filled (by this caller or before), and here is the record;
 *   402  it is on the rail, and here is how to pay;
 *   404  it is not on the rail;
 *   409  a hash was sent that does not fill it;
 *   410  it was on the rail and is not any more.
 */
export async function buy(id, { txHash = null, headers = new Headers() } = {}) {
  const c = await config();
  const done = parse(await one('GET', K.fill(id)));
  if (done) return { status: 200, body: welcome(done) };
  const rec = await recordFor(id);
  const fallbackUrl = rec && rec.listing_url;
  if (!rec) {
    return { status: 404, body: { error: 'This work is not on the agent rail right now.',
      catalog: `${site()}/ai/catalog.json`, work: `${site()}/w/${encodeURIComponent(id)}` } };
  }
  if (txHash) {
    const f = await fillIn(txHash, rec);
    if (f.pending) return { status: 202, body: { pending: true, message: 'That transaction is not mined yet. Ask again in a few seconds.' } };
    if (f.error) return { status: 409, body: { error: f.error, order_hash: rec.hash } };
    const { fill } = await recordFill(rec, f);
    return { status: 200, body: welcome(fill) };
  }
  const live = await liveState(rec);
  if (live.state === 'filled') {
    const f = await findFill(rec);
    if (f) { const { fill } = await recordFill(rec, f); return { status: 200, body: welcome(fill) }; }
    return { status: 410, body: { error: 'This order has been filled. If it was you, send the transaction hash to be welcomed properly.', order_hash: rec.hash } };
  }
  if (live.state !== 'live' && live.state !== 'unknown') {
    await retire(rec, live.state);
    return { status: 410, body: {
      error: { cancelled: 'This order was cancelled.', expired: 'This order has expired.', moved: 'This work has left the holding wallet.' }[live.state] || 'This order is no longer live.',
      ...(c.opensea_fallback && fallbackUrl ? { opensea: fallbackUrl } : {}),
    } };
  }
  const refused = await gate(c, id, headers);
  if (refused) return refused;
  return { status: 402, body: paymentRequired(rec, c) };
}

/** Off the rail, with the reason kept where /mintwork/rail can read it. */
export async function retire(rec, why) {
  await pipe([
    ['SREM', K.ids, rec.id],
    ['DEL', K.order(rec.id)],
    ['LPUSH', K.gone, JSON.stringify({ id: rec.id, title: rec.title, hash: rec.hash, why, at: new Date().toISOString() })],
    ['LTRIM', K.gone, '0', '199'],
    ['DEL', K.feed],
  ]);
}

/* ---------- keeping it honest ---------- */

/**
 * Every order against the chain, at once: filled ones are told, dead ones are
 * taken off. Run by the nightly listings cron and by /mintwork/rail after a cancel.
 */
export async function sweep() {
  const recs = await records();
  const out = { live: 0, filled: 0, retired: 0, unknown: 0 };
  for (const rec of recs) {
    const s = await liveState(rec);
    if (s.state === 'live') { out.live += 1; continue; }
    if (s.state === 'unknown') { out.unknown += 1; continue; }
    if (s.state === 'filled') {
      const f = await findFill(rec);
      if (f) await recordFill(rec, f); else await retire(rec, 'filled');
      out.filled += 1;
      continue;
    }
    await retire(rec, s.state);
    out.retired += 1;
  }
  return out;
}

/** What /mintwork/rail shows: every order, without its signature. */
export async function ledger() {
  const c = await config();
  const [recs, retiredRaw, goneRaw, fillsRaw] = await Promise.all([
    records(),
    one('LRANGE', K.retired, '0', '-1'),
    one('LRANGE', K.gone, '0', '49'),
    one('LRANGE', K.fills, '0', '49'),
  ]);
  const soon = Number(c.renew_within_days || 7) * 86400 * 1000;
  const orders = recs.map((r) => ({
    id: r.id, title: r.title, collection: r.collection_title,
    list_eth: eth(r.list_wei), rail_eth: eth(r.rail_wei),
    expires: r.expires, renew: Date.parse(r.expires) - Date.now() < soon,
    hash: r.hash, batch: r.batch,
  })).sort((a, b) => Date.parse(a.expires) - Date.parse(b.expires) || a.id.localeCompare(b.id, 'en', { numeric: true }));
  const retired = (retiredRaw || []).map(parse).filter(Boolean).filter((r) => Date.parse(r.expires) > Date.now());
  return {
    holder: c.holder, holder_name: c.holder_name, rate_bps: c.rate_bps, days: c.days,
    orders,
    renew: orders.filter((o) => o.renew).length,
    retired: retired.length,
    gone: (goneRaw || []).map(parse).filter(Boolean),
    fills: (fillsRaw || []).map(parse).filter(Boolean),
  };
}

/**
 * The transaction that cancels orders, for the holder to send: every order on
 * the rail, or only the ones a re-sign replaced. Seaport cancels exactly the
 * orders named, so listings elsewhere are untouched ... unlike incrementCounter,
 * which is offered separately and says what it costs.
 */
export async function cancelPlan(scope = 'all') {
  const retired = ((await one('LRANGE', K.retired, '0', '-1')) || []).map(parse).filter(Boolean);
  const list = scope === 'retired' ? retired : [...(await records()), ...retired];
  const live = list.filter((r) => Date.parse(r.expires) > Date.now());
  if (!live.length) return { count: 0 };
  return {
    count: live.length,
    tx: { to: S.SEAPORT, value: '0', data: S.cancelData(live.map((r) => S.orderFromJSON(r.order))) },
  };
}

/** After a cancel is mined: the retired list is cleared of what it named. */
export async function clearRetired() {
  await one('DEL', K.retired);
}

export { fence, eth as weiToEth, site };
