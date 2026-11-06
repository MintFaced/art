/* TAO snapshots: the table, the tree and the free mints it sets.
 *
 * A leaf is (wallet, taoTotal, freeMints), hashed twice and paired in sorted
 * order, which is what TaoLedger.verify checks. The same bytes on both sides is
 * the whole point: anyone can take the published table and rebuild the root.
 */
import { encodeAbiParameters, keccak256, concat, getAddress } from 'viem';
import { deployed, read } from './strips.js';
import { siteOrigin } from './data.js';

export const FREE_TIERS = [{ at: 420_000, mints: 2 }, { at: 100_000, mints: 1 }];
export const freeMintsOf = (tao) => (FREE_TIERS.find((t) => tao >= t.at) || { mints: 0 }).mints;

export const leafOf = ({ wallet, tao_total, free_mints }) => keccak256(keccak256(encodeAbiParameters(
  [{ type: 'address' }, { type: 'uint256' }, { type: 'uint256' }],
  [getAddress(wallet), BigInt(tao_total), BigInt(free_mints)],
)));

const pair = (a, b) => keccak256(a.toLowerCase() < b.toLowerCase() ? concat([a, b]) : concat([b, a]));

/** Every level of the tree, leaves first, in a fixed order. */
function levels(rows) {
  let level = rows.map(leafOf).sort();
  const out = [level];
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? pair(level[i], level[i + 1]) : level[i]);
    out.push(next);
    level = next;
  }
  return out;
}

export const rootOf = (rows) => { const l = levels(rows); return l[l.length - 1][0]; };

export function proofOf(rows, row) {
  const all = levels(rows);
  let at = all[0].indexOf(leafOf(row));
  if (at < 0) return null;
  const proof = [];
  for (const level of all.slice(0, -1)) {
    const sibling = at ^ 1;
    if (sibling < level.length) proof.push(level[sibling]);
    at >>= 1;
  }
  return proof;
}

const lower = (a) => a.toLowerCase();

/** What a table owes, which is what the ledger has to be holding back. */
export const owedBy = (rows) => rows.reduce((n, r) => n + r.free_mints, 0);

/**
 * Who the exclusions take out, and why. They apply after delegation has
 * resolved: a wallet that speaks through an excluded key goes with it, so a
 * vault can't carry an excluded wallet's allowance in by the side door. `keys`
 * maps an address to the reason it's excluded.
 */
export function struckOut(rows, combo = new Map(), keys = new Map()) {
  const out = new Map();
  for (const r of rows) {
    const w = lower(r.wallet);
    const hot = lower(combo.get(w) || w);
    if (keys.has(w)) out.set(w, keys.get(w));
    else if (keys.has(hot)) out.set(w, `speaks through ${keys.get(hot)}`);
  }
  return out;
}

/**
 * Who gets what. `rows` are wallets and the TAO on what they hold now, `combo`
 * maps a vault to the hot wallet it speaks through. A COMBO's TAO is added up
 * once and its allowance sits on the hot wallet; the vault's own row keeps its
 * TAO and sets no free mints of its own. Excluded wallets leave no row at all.
 */
export function allowances(all, combo = new Map(), keys = new Map()) {
  const struck = struckOut(all, combo, keys);
  const rows = all.filter((r) => !struck.has(lower(r.wallet)));
  const group = new Map();
  for (const r of rows) {
    const hot = lower(combo.get(lower(r.wallet)) || r.wallet);
    group.set(hot, (group.get(hot) || 0) + r.tao_total);
  }
  const seen = new Set(rows.map((r) => lower(r.wallet)));
  const out = rows.map((r) => {
    const w = lower(r.wallet);
    const hot = combo.get(w);
    return { wallet: getAddress(r.wallet), tao_total: r.tao_total, free_mints: hot ? 0 : freeMintsOf(group.get(w) || 0), ...(hot ? { hot: getAddress(hot) } : {}) };
  });
  /* a hot wallet that holds nothing itself is still where the allowance goes */
  for (const [hot, total] of group) if (!seen.has(hot)) out.push({ wallet: getAddress(hot), tao_total: 0, free_mints: freeMintsOf(total) });
  return out.sort((a, b) => b.tao_total - a.tao_total || (a.wallet < b.wallet ? -1 : 1));
}

/* A table is only as good as what it rebuilds to, so the root is worked out
   from its rows here and never taken from the file's own say-so. */
let held = { at: 0, id: null, table: null };
/* The chain's side of the claim, for a few seconds. These routes are open, and
   during a claim a failed read pauses the mint, so a loop against them shouldn't
   turn straight into a loop against the RPC. A failed read isn't kept. */
const CLAIM_CACHE_MS = 15_000;
let claim = { at: 0, state: null };
export const forgetSnapshot = () => { held = { at: 0, id: null, table: null }; claim = { at: 0, state: null }; };

/* The public address in production, not the deployment's own *.vercel.app one,
   which deployment protection would close. It's the address the runbook checks. */
const tableOrigin = () => process.env.SITE_ORIGIN || (process.env.VERCEL_ENV === 'production' ? 'https://mintface.art' : siteOrigin());

export async function tableFor(id) {
  if (held.table && held.id === id && Date.now() - held.at < 300_000) return held.table;
  const r = await fetch(`${process.env.STRIPS_SNAPSHOT_URL || `${tableOrigin()}/data/strips-snapshot-${id}.json`}`, { signal: AbortSignal.timeout(6000) });
  const t = r.ok ? await r.json() : null;
  held = { at: Date.now(), id, table: t && Array.isArray(t.rows) ? { ...t, rebuilt: rootOf(t.rows) } : null };
  return held.table;
}

/**
 * Where the claim stands, and whether the site can honour it. `ok: false` means
 * the chain may be owed something the site can't tell anyone about: no snapshot
 * yet, or a claim running with no table deployed for it, or one that doesn't
 * rebuild to the root on the ledger, or a ledger holding back a different number
 * of mints than the table owes. Nothing is sold then. A collector with a free
 * mint must never be shown a price because a file went missing.
 */
export async function claimState() {
  if (claim.state && Date.now() - claim.at < CLAIM_CACHE_MS) return claim.state;
  const state = await readClaim();
  claim = { at: Date.now(), state };
  return state;
}

async function readClaim() {
  const [snapshot, deadline, reserved] = await Promise.all([read.ledger('claimSnapshot'), read.ledger('claimDeadline'), read.ledger('unclaimedReserve')]);
  const out = { snapshot: Number(snapshot), deadline: Number(deadline), reserved: Number(reserved), live: false, ok: false, table: null };
  if (!snapshot) return out;
  if (Date.now() / 1000 > out.deadline) return { ...out, ok: true };
  const [table, published] = await Promise.all([tableFor(out.snapshot).catch(() => null), read.ledger('snapshot', [snapshot])]);
  const good = Boolean(table) && table.rebuilt === published.root && owedBy(table.rows) === Number(published.freeMints);
  return { ...out, live: true, ok: good, table: good ? table : null };
}

/** A wallet's free mints: how many it has left, and the proof to spend them. */
export async function freeMintsFor(wallet) {
  const none = { free_mints: 0, left: 0, tao_total: 0, proof: [], deadline: 0 };
  if (!deployed()) return none;
  try {
    const c = await claimState();
    if (!c.ok) return { ...none, unavailable: true };
    if (!c.live) return none;
    const row = c.table.rows.find((r) => lower(r.wallet) === lower(wallet));
    /* a vault's allowance is on its hot wallet, and it should be told so */
    if (!row || !row.free_mints) return { ...none, tao_total: row ? row.tao_total : 0, on_hot_wallet: (row && row.hot) || null };
    const used = Number(await read.ledger('claimed', [BigInt(c.snapshot), getAddress(wallet)]));
    return { free_mints: row.free_mints, left: Math.max(0, row.free_mints - used), tao_total: row.tao_total, proof: proofOf(c.table.rows, row), deadline: c.deadline };
  } catch { return { ...none, unavailable: true }; }
}

const gateway = (uri) => uri.replace(/^ar:\/\/|^https:\/\/arweave\.net\//, `${process.env.STRIPS_ARWEAVE_GATEWAY || 'https://arweave.net'}/`);

/**
 * What has to be true before a root goes on-chain: the table is on the site, it
 * rebuilds to the root it claims, the root is the one being published, and the
 * copy on Arweave says the same. Everything the ledger stores comes from the
 * table, so nothing but the URI is typed by hand.
 */
/** The audit's result, deployed beside the table. No table is published without it. */
async function auditFor(id) {
  const url = process.env.STRIPS_SNAPSHOT_AUDIT_URL || `${tableOrigin()}/data/strips-snapshot-${id}-audit.json`;
  return fetch(url, { signal: AbortSignal.timeout(15000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
}

export async function checkPublish({ id, root, uri }) {
  forgetSnapshot();
  const t = await tableFor(id).catch(() => null);
  if (!t) return { error: `data/strips-snapshot-${id}.json isn't on the site. Deploy it first: the site has to serve the proofs before the claim opens.` };
  if (t.id !== id) return { error: `that table is snapshot ${t.id}, and the next on the ledger is ${id}` };
  if (t.rebuilt !== t.root) return { error: 'the deployed table doesn\'t rebuild to its own root' };
  if (lower(String(root)) !== lower(t.root)) return { error: `that isn't the deployed table's root, ${t.root}` };
  if (!(Number(t.taken_at) > 0)) return { error: 'the table has no taken_at' };
  const audit = await auditFor(id);
  if (!audit) return { error: `data/strips-snapshot-${id}-audit.json isn't on the site. Run the audit and deploy its result with the table.` };
  if (audit.ok !== true || lower(String(audit.root)) !== lower(t.root)) return { error: 'the deployed audit isn\'t a pass for this table. Run the audit again.' };
  const copy = await fetch(gateway(uri), { signal: AbortSignal.timeout(15000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!copy || !Array.isArray(copy.rows)) return { error: 'couldn\'t read that table from Arweave. It may still be settling: try again shortly.' };
  if (rootOf(copy.rows) !== t.root) return { error: 'the table on Arweave doesn\'t rebuild to this root' };
  return { taken_at: Number(t.taken_at), free_mints: owedBy(t.rows), label: t.label };
}
