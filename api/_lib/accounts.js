/* Accounts — the thin identity layer that lets one person reach one place by
 * two doors: a verified X identity, and one or more wallets.
 *
 * Everything downstream (TAO, the register, chat) is still keyed by wallet
 * address and stays that way — an account is only the join that says "these
 * wallets and this X id are the same person." A wallet stays the key to TAO;
 * the account is the key to identity.
 *
 * Stored in the same Upstash KV as everything else. The reverse indexes are
 * HSETNX so a credential (an X id, a wallet) can be claimed by exactly one
 * account and a second claim loses atomically ... which is the collision rule
 * (X-AUTH item 23), enforced by the store rather than by a check-then-write.
 */
import crypto from 'node:crypto';
import { pipe, one, storeConfigured } from './kv.js';

const A = (id) => `acct:${id}`;          // hash: x_id, x_handle, x_avatar, created, last_login, login_method
const BYX = 'acct:byx';                  // hash  x_id   -> account_id
const BYWALLET = 'acct:bywallet';        // hash  wallet -> account_id
const WALLETS = (id) => `acct:${id}:w`;  // set   of linked wallet addresses
const LOG = 'acct:log';                  // append-only trail

export const accountsReady = storeConfigured;
const lower = (a) => String(a || '').toLowerCase();
const newId = () => crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');

// Upstash returns HGETALL as a flat array; fold it to an object.
const asMap = (flat) => {
  const o = {};
  if (Array.isArray(flat)) for (let i = 0; i < flat.length; i += 2) o[flat[i]] = flat[i + 1];
  return o;
};

async function note(kind, account_id, detail) {
  try { await one('RPUSH', LOG, JSON.stringify({ at: new Date().toISOString(), kind, account_id, ...detail })); } catch (e) { /* the trail is not the act */ }
}

/** The account behind an X id, or null. */
export async function byX(x_id) {
  if (!storeConfigured() || !x_id) return null;
  return (await one('HGET', BYX, String(x_id))) || null;
}

/** The account behind a wallet, or null. */
export async function byWallet(address) {
  if (!storeConfigured() || !address) return null;
  return (await one('HGET', BYWALLET, lower(address))) || null;
}

/** Everything on an account, including its linked wallets. */
export async function get(account_id) {
  if (!storeConfigured() || !account_id) return null;
  const [flat, wallets] = await pipe([['HGETALL', A(account_id)], ['SMEMBERS', WALLETS(account_id)]]);
  const m = asMap(flat);
  if (!m.created && !m.x_id && !(wallets && wallets.length)) return null;
  return {
    account_id,
    x_id: m.x_id || null,
    x_handle: m.x_handle || null,
    x_avatar: m.x_avatar || null,
    login_method: m.login_method || null,
    created: m.created || null,
    last_login: m.last_login || null,
    wallets: wallets || [],
  };
}

/**
 * Sign-in with X: find the account for this X id or create one, and refresh the
 * handle/avatar (they change; the id does not). Returns { account_id, created }.
 */
export async function upsertX({ x_id, x_handle, x_avatar }) {
  const id = newId();
  const claimed = await one('HSETNX', BYX, String(x_id), id);   // 1 = this X id was unclaimed
  const account_id = claimed === 1 ? id : await one('HGET', BYX, String(x_id));
  const now = new Date().toISOString();
  const fields = ['x_id', String(x_id), 'x_handle', x_handle || '', 'x_avatar', x_avatar || '', 'last_login', now, 'login_method', 'x'];
  if (claimed === 1) fields.push('created', now);
  await one('HSET', A(account_id), ...fields);
  if (claimed === 1) await note('x-signup', account_id, { x_id: String(x_id) });
  return { account_id, created: claimed === 1 };
}

/**
 * Link a wallet to an account (used by the SIWE path once it knows the account).
 * A wallet already on THIS account is idempotent; on another account it is a
 * collision, refused rather than merged (v1 has no merge UI).
 */
export async function linkWallet(account_id, address) {
  const a = lower(address);
  const claimed = await one('HSETNX', BYWALLET, a, account_id);  // 1 = wallet was free
  if (claimed !== 1) {
    const owner = await one('HGET', BYWALLET, a);
    if (owner === account_id) return { ok: true, already: true };
    return { ok: false, collision: true, owner };
  }
  await one('SADD', WALLETS(account_id), a);
  await note('link-wallet', account_id, { wallet: a });
  return { ok: true };
}

/** Attach an X identity to an existing (wallet-first) account. Collision-safe. */
export async function linkX(account_id, { x_id, x_handle, x_avatar }) {
  const claimed = await one('HSETNX', BYX, String(x_id), account_id);
  if (claimed !== 1) {
    const owner = await one('HGET', BYX, String(x_id));
    if (owner === account_id) return { ok: true, already: true };
    return { ok: false, collision: true, owner };
  }
  await one('HSET', A(account_id), 'x_id', String(x_id), 'x_handle', x_handle || '', 'x_avatar', x_avatar || '');
  await note('link-x', account_id, { x_id: String(x_id) });
  return { ok: true };
}

/** Unlink X: clears the id/handle/avatar and frees the reverse index. */
export async function unlinkX(account_id) {
  const acct = await get(account_id);
  if (acct && acct.x_id) await one('HDEL', BYX, String(acct.x_id));
  await one('HDEL', A(account_id), 'x_id', 'x_handle', 'x_avatar');
  await note('unlink-x', account_id, {});
  return { ok: true };
}
