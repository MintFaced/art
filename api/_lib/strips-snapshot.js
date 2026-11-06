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

/**
 * Who gets what. `rows` are the register, `combo` maps a vault to the hot wallet
 * it speaks through. A COMBO's TAO is added up once and its allowance sits on
 * the hot wallet; the vault's own row keeps its TAO, because the register stays
 * per wallet, and sets no free mints of its own.
 */
export function allowances(rows, combo = new Map()) {
  const lower = (a) => a.toLowerCase();
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

let held = { at: 0, table: null };
export const forgetSnapshot = () => { held = { at: 0, table: null }; };
async function table() {
  if (Date.now() - held.at < 300_000 && held.table) return held.table;
  const r = await fetch(`${process.env.STRIPS_SNAPSHOT_URL || `${siteOrigin()}/data/strips-snapshot-1.json`}`, { signal: AbortSignal.timeout(6000) });
  held = { at: Date.now(), table: r.ok ? await r.json() : null };
  return held.table;
}

/** A wallet's free mints: how many it has left, and the proof to spend them. */
export async function freeMintsFor(wallet) {
  const none = { free_mints: 0, left: 0, tao_total: 0, proof: [], deadline: 0 };
  if (!deployed()) return none;
  const t = await table().catch(() => null);
  if (!t) return none;
  const row = t.rows.find((r) => r.wallet.toLowerCase() === wallet.toLowerCase());
  /* a vault's allowance is on its hot wallet, and it should be told so */
  if (!row || !row.free_mints) return { ...none, tao_total: row ? row.tao_total : 0, on_hot_wallet: (row && row.hot) || null };
  const [snapshot, deadline] = await Promise.all([read.ledger('claimSnapshot'), read.ledger('claimDeadline')]);
  const used = Number(await read.ledger('claimed', [snapshot, getAddress(wallet)]));
  const open = Date.now() / 1000 <= Number(deadline);
  return { free_mints: row.free_mints, left: open ? Math.max(0, row.free_mints - used) : 0, tao_total: row.tao_total, proof: proofOf(t.rows, row), deadline: Number(deadline) };
}
