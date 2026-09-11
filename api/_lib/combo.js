/* The COMBO: a hot wallet and the vaults that speak through it, as one voice.
 *
 * Every TAO gate on this site asks the same question ... how much does this
 * wallet hold ... and every one of them should get the same answer, so the
 * answer lives here and the gates call it. Nudge weighing, the notes
 * threshold, the room: one coherent promise, which is that your TAO works
 * from your hot wallet.
 *
 * WHAT A COMBO IS NOT. It is not a register merge. The leaderboard, the
 * collector pages and the TAO totals stay per-wallet chain truth, because
 * those say who holds what and a delegation does not move a single token. A
 * COMBO is a voting-time power, and it exists at the three moments where a
 * gate is actually being asked a question.
 *
 * CHAIN TRUTH AT THOSE MOMENTS, AND NOT CACHED ACROSS DAYS. The registry is
 * read when a session starts, again when TAO is deployed, and again at a
 * nudge's close. The only cache is a couple of minutes wide and exists so that
 * a page somebody reloads four times is four reads of a cache rather than
 * twelve of the chain; a delegation revoked this morning is gone from the
 * COMBO by the time anybody could have used it.
 */
import { incoming, isAddress, RIGHTS_ALL } from './delegate.js';
import { storeConfigured, pipe } from './kv.js';

const lower = (a) => String(a || '').toLowerCase();

/* Two minutes. Long enough that a reader clicking about the site is not
   re-reading the chain on every page; short enough that `revoke it and it is
   gone` is true in any sense a person would recognise. */
const CACHE_SECONDS = Math.max(0, Number(process.env.COMBO_CACHE_SECONDS ?? 120));
const key = (a) => `mf:combo:${lower(a)}`;

async function cached(address) {
  if (!CACHE_SECONDS || !storeConfigured()) return null;
  try {
    const [raw] = await pipe([['GET', key(address)]]);
    return raw ? JSON.parse(String(raw)) : null;
  } catch (e) { return null; }
}

async function remember(address, members) {
  if (!CACHE_SECONDS || !storeConfigured()) return;
  try {
    await pipe([['SET', key(address), JSON.stringify(members), 'EX', String(CACHE_SECONDS)]]);
  } catch (e) { /* a cache that will not write is still a working site */ }
}

/** Drop what is remembered, so the next read is the chain. Used the moment a
 *  collector says they have just delegated and wants to see it. */
export async function forget(address) {
  if (!storeConfigured()) return;
  try { await pipe([['DEL', key(address)]]); } catch (e) { /* nothing to do */ }
}

/**
 * The wallets that may speak through this one, verified.
 *
 * @returns {{ members: Array<{address, rights, registry, scoped}>, degraded, cached }}
 */
export async function membersFor(address, { fresh = false } = {}) {
  const a = lower(address);
  if (!isAddress(a)) return { members: [], degraded: false, cached: false };
  if (!fresh) {
    const hit = await cached(a);
    if (hit) return { members: hit, degraded: false, cached: true };
  }
  const out = await incoming(a);
  /* A degraded read is never written down. Remembering `no members` because
     the network was unwell is how a two-minute cache turns a hiccup into a
     collector's vote being clamped. */
  if (!out.degraded) await remember(a, out.members);
  return { members: out.members, degraded: out.degraded, cached: false };
}

/** TAO as the register computes it, per wallet, with no COMBO anywhere in it. */
export const soloTao = (tao, address) => {
  const w = tao && tao.wallets && tao.wallets[lower(address)];
  return Math.max(0, Math.floor(Number(w ? w.tao : 0) || 0));
};

/**
 * The whole COMBO for one wallet: who is in it, and what it holds between them.
 *
 * `combo` is false for the great majority of collectors, who have delegated
 * nothing and whose answer is exactly the answer they always got. Everything
 * downstream of this can treat a solo wallet as a COMBO of one and stop
 * carrying two code paths.
 *
 * @param tao  the parsed data/tao.json
 */
export async function comboFor(tao, address, opts = {}) {
  const hot = lower(address);
  const own = soloTao(tao, hot);
  if (!isAddress(hot)) {
    return { hot, members: [], wallets: [], solo: own, total: own, combo: false, degraded: false };
  }
  const { members, degraded, cached: fromCache } = await membersFor(hot, opts);
  const vaults = members.map((m) => ({
    address: m.address,
    tao: soloTao(tao, m.address),
    rights: m.rights || RIGHTS_ALL,
    registry: m.registry,
    scoped: Boolean(m.scoped),
  }));
  const total = own + vaults.reduce((n, v) => n + v.tao, 0);
  return {
    hot,
    /* The hot wallet first, because it is the one doing the talking, and then
       the vaults heaviest first ... which is the order a collector would read
       their own COMBO out in. */
    members: [{ address: hot, tao: own, rights: RIGHTS_ALL, registry: null, scoped: false, hot: true },
      ...vaults.sort((a, b) => b.tao - a.tao)],
    wallets: [hot, ...vaults.map((v) => v.address)],
    solo: own,
    total,
    combo: vaults.length > 0,
    degraded,
    cached: Boolean(fromCache),
  };
}

/**
 * The same, but never a chain read: what a wallet holds on its own.
 *
 * For every surface that should not be asking the registry at all ... an
 * anonymous page view, a leaderboard, a collector page. A gate calls
 * `comboFor`; a picture of the register calls this.
 */
export const soloOnly = (tao, address) => {
  const own = soloTao(tao, address);
  return { hot: lower(address), members: [], wallets: [lower(address)], solo: own, total: own, combo: false, degraded: false };
};

/** The quiet marker, said the one way it is said everywhere. */
export const comboMark = (n) => `COMBO · ${n} WALLET${n === 1 ? '' : 'S'}`;
