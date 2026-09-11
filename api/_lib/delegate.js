/* Delegate Cash, read straight off the chain.
 *
 * A collector's art lives in a vault they do not want to connect to anything.
 * Delegate Cash is the standard answer: the vault signs once, ever, on
 * delegate.xyz, naming a hot wallet that may act for it. This reads that
 * registry so the hot wallet can deploy the vault's TAO here, and the vault
 * never touches this site.
 *
 * WE READ THE REGISTRY. WE DO NOT WRITE IT, AND WE DO NOT PROXY THE VAULT'S
 * SIGNATURE. Delegating happens on delegate.xyz, which is audited, canonical
 * and not ours; a site that offered to collect a vault's signature itself
 * would be teaching collectors to do the exact thing every drainer asks for.
 *
 * Two registries, because there are two. v2 is the live one and carries a
 * `rights` label, so a cautious vault can delegate to this site alone rather
 * than to everything the hot wallet can reach. v1 is the original, still
 * holding delegations nobody has migrated, and has no rights concept at all.
 *
 * ENUMERATE LOOSELY, VERIFY STRICTLY. The list call says what is there; the
 * check call is the registry's own yes-or-no and is what we actually trust. A
 * decode that drifts ... a struct reordered in some future registry, a chain
 * returning something unexpected ... produces candidates that then fail
 * verification, rather than members nobody granted.
 *
 * ONE HOP. A vault delegating to a hot wallet is honoured. A hot wallet that
 * is itself delegated to by a third wallet which was delegated to by a fourth
 * is not walked: chains are how one signature quietly becomes authority over
 * wallets nobody meant to include.
 *
 * FAIL OPEN. Every path here returns `degraded` rather than throwing. A
 * registry hiccup must never stop a plain wallet connecting and speaking: the
 * COMBO is additive, and additive things do not get to break the base case.
 *
 * ONE DOOR IN V1. Delegate Cash, and only Delegate Cash. The 6529
 * NFTDelegation registry is deferred rather than dropped, and the shape of
 * this file is the whole of what a second door needs: `incoming()` reads each
 * registry into one `want` map keyed by vault address, so a wallet that has
 * delegated in both is already ONE member rather than two, and a second
 * reader is a third entry in that first `calls()` batch plus its own row in
 * the verification batch under it. Its use case `All` maps to TYPE_ALL here;
 * its other codes are Memes-specific and are not a voice on this site. What a
 * second door needs before it can be written is the registry's mainnet
 * address and its two selectors, verified against a live delegation the way
 * both of these were ... which is why there is no flag standing here switching
 * nothing on: a flag that gates an unwritten reader is a promise the config
 * cannot keep.
 */

/* Both registries live at the same address on every chain they are deployed
   to, which is what the leading zeros in them are for. */
export const V2 = '0x00000000000000447e69651d841bd8d104bed493';
export const V1 = '0x00000000000076a84fef008cdabe6409d2fe638b';

/* The rights label a vault may scope its delegation to, and the bytes32 it is
   on the chain: the ASCII, right-padded with zeros, which is what delegate.xyz
   writes for a short string. Shown on /combo for pasting, so the two have to
   agree to the character. */
export const RIGHTS_LABEL = 'mintface';
export const RIGHTS_ALL = `0x${'0'.repeat(64)}`;
export const RIGHTS_MINTFACE = `0x${[...RIGHTS_LABEL]
  .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
  .padEnd(64, '0')}`;

/* DelegationType.ALL, in both registries. The others are per-contract and
   per-token, which are about NFTs rather than about who somebody is, and
   carrying somebody's whole TAO on a delegation scoped to one token id would
   be reading a permission as something much larger than it was written. */
const TYPE_ALL = 1;

/* Public nodes, tried in turn, exactly as api/eth-payment.js does it. No key,
   so no secret to leak and nothing to expire; three of them, so one being down
   is not this feature being down. */
const RPCS = (process.env.ETH_RPCS || '').split(',').map((s) => s.trim()).filter(Boolean);
const NODES = RPCS.length ? RPCS : [
  'https://ethereum-rpc.publicnode.com',
  'https://eth.drpc.org',
  'https://1rpc.io/eth',
];

const lower = (a) => String(a || '').toLowerCase();
export const isAddress = (a) => /^0x[0-9a-f]{40}$/.test(lower(a));
const word = (v) => lower(v).replace(/^0x/, '').padStart(64, '0');

/* A batch of eth_calls as one request where the node will take it, and one at
   a time where it will not. Public nodes vary; the answer has to be the same
   either way, so the fallback is a real fallback rather than an error. */
async function calls(list, { timeout = 6000 } = {}) {
  if (!list.length) return [];
  const body = list.map((c, i) => ({
    jsonrpc: '2.0', id: i + 1, method: 'eth_call',
    params: [{ to: c.to, data: c.data }, 'latest'],
  }));
  for (const url of NODES) {
    try {
      const out = await once(url, body, timeout);
      if (out) return out;
    } catch (e) { /* the next node */ }
  }
  return null;
}

async function once(url, body, timeout) {
  const stop = AbortSignal.timeout ? AbortSignal.timeout(timeout) : undefined;
  const r = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body.length === 1 ? body[0] : body), signal: stop,
  });
  if (!r.ok) throw new Error(`rpc ${r.status}`);
  const j = await r.json();
  const rows = Array.isArray(j) ? j : [j];
  /* Sorted back into the order asked for: a batch may come back in any order,
     and a result read against the wrong question is worse than no result. */
  const byId = new Map(rows.map((x) => [Number(x.id), x]));
  const out = [];
  for (let i = 0; i < body.length; i += 1) {
    const hit = byId.get(body[i].id);
    if (!hit || hit.error || typeof hit.result !== 'string') return null;
    out.push(hit.result);
  }
  return out;
}

/** One call, or null. */
const call = async (to, data, opts) => {
  const out = await calls([{ to, data }], opts);
  return out ? out[0] : null;
};

/* ---------------------------------------------------------------- decoding */

const words = (hex) => {
  const s = String(hex || '').replace(/^0x/, '');
  const out = [];
  for (let i = 0; i + 64 <= s.length; i += 64) out.push(s.slice(i, i + 64));
  return out;
};

/**
 * A flat array of fixed-size structs, as the registries return them.
 *
 * Neither Delegation nor DelegationInfo has a dynamic member, so the array is
 * encoded inline: an offset, a count, then count * size words with no
 * per-entry offsets. Verified against live mainnet data rather than read off
 * an ABI and hoped for.
 */
function structs(hex, size) {
  const w = words(hex);
  if (w.length < 2) return [];
  const count = Number(BigInt(`0x${w[1]}`));
  if (!Number.isFinite(count) || count < 0 || count > 4096) return [];
  if (w.length < 2 + count * size) return [];
  const out = [];
  for (let i = 0; i < count; i += 1) out.push(w.slice(2 + i * size, 2 + (i + 1) * size));
  return out;
}

const addrAt = (w) => `0x${w.slice(24)}`;
const intAt = (w) => Number(BigInt(`0x${w}`));

/* ------------------------------------------------------------- the reads */

/* getIncomingDelegations(address) -> Delegation[]
   struct Delegation { uint8 type_; address to; address from; bytes32 rights;
                       address contract_; uint256 tokenId; uint256 amount; } */
const V2_INCOMING = '0x42f87c25';
/* checkDelegateForAll(address to, address from, bytes32 rights) -> bool */
const V2_CHECK = '0xe839bd53';
/* getDelegationsByDelegate(address) -> DelegationInfo[]
   struct DelegationInfo { DelegationType type; address vault; address delegate;
                           address contract_; uint256 tokenId; } */
const V1_INCOMING = '0x4fc69282';
/* checkDelegateForAll(address delegate, address vault) -> bool */
const V1_CHECK = '0x9c395bc2';

const truthy = (hex) => Boolean(hex) && /[1-9a-f]/.test(String(hex).replace(/^0x/, ''));

/**
 * Every wallet that has delegated to this one, as the two registries say now.
 *
 * @returns {{ members: Array<{address, rights, registry, scoped}>, degraded: boolean }}
 */
export async function incoming(hot) {
  const to = lower(hot);
  if (!isAddress(to)) return { members: [], degraded: false };

  const found = await calls([
    { to: V2, data: V2_INCOMING + word(to) },
    { to: V1, data: V1_INCOMING + word(to) },
  ]);
  /* The registries could not be read. Say so rather than saying `no
     delegations`: one is a fact about the chain and the other is a fact about
     the network, and a caller deciding whether to clamp somebody's vote needs
     to know which it has been handed. */
  if (!found) return { members: [], degraded: true };

  const want = new Map();
  const take = (from, rights, registry, scoped) => {
    const a = lower(from);
    /* A wallet delegating to itself is not a COMBO, it is a wallet. */
    if (!isAddress(a) || a === to) return;
    if (!want.has(a)) want.set(a, { address: a, rights, registry, scoped });
  };

  for (const s of structs(found[0], 7)) {
    if (intAt(s[0]) !== TYPE_ALL) continue;
    const rights = `0x${s[3]}`;
    /* Everything, or this site by name. A delegation scoped to some other
       project's rights label was not granted to us and is not ours to read as
       if it were. */
    if (rights === RIGHTS_ALL) take(addrAt(s[2]), rights, 'v2', false);
    else if (rights === RIGHTS_MINTFACE) take(addrAt(s[2]), rights, 'v2', true);
  }
  for (const s of structs(found[1], 5)) {
    if (intAt(s[0]) !== TYPE_ALL) continue;
    take(addrAt(s[1]), RIGHTS_ALL, 'v1', false);
  }

  const list = [...want.values()];
  if (!list.length) return { members: [], degraded: false };

  /* And now the registry's own yes or no, for each one. This is the answer
     that counts: the enumeration above is a convenience, and a convenience is
     not a permission. */
  const checks = await calls(list.map((m) => (m.registry === 'v2'
    ? { to: V2, data: V2_CHECK + word(to) + word(m.address) + word(m.rights) }
    : { to: V1, data: V1_CHECK + word(to) + word(m.address) })));
  if (!checks) return { members: [], degraded: true };

  return { members: list.filter((_, i) => truthy(checks[i])), degraded: false };
}

/**
 * Is this one delegation still good, right now?
 *
 * Asked at a nudge's close, per member, on the membership recorded when the
 * weighing was made. A revoked delegation has to clamp exactly like a sale,
 * and the only way to know is to ask the chain again at the moment it matters.
 *
 * @returns {{ ok: boolean, degraded: boolean }}
 */
export async function stillDelegated(hot, vault, rights = RIGHTS_ALL) {
  const to = lower(hot);
  const from = lower(vault);
  if (!isAddress(to) || !isAddress(from) || to === from) return { ok: false, degraded: false };
  const out = await calls([
    { to: V2, data: V2_CHECK + word(to) + word(from) + word(rights) },
    { to: V2, data: V2_CHECK + word(to) + word(from) + word(RIGHTS_ALL) },
    { to: V1, data: V1_CHECK + word(to) + word(from) },
  ]);
  if (!out) return { ok: false, degraded: true };
  return { ok: out.some(truthy), degraded: false };
}

/** Many of them at once, for a close that has a board's worth to check. */
export async function stillDelegatedMany(pairs) {
  const list = (pairs || []).filter((p) => isAddress(p.hot) && isAddress(p.vault)
    && lower(p.hot) !== lower(p.vault));
  if (!list.length) return { ok: new Map(), degraded: false };
  const body = [];
  for (const p of list) {
    body.push({ to: V2, data: V2_CHECK + word(p.hot) + word(p.vault) + word(p.rights || RIGHTS_ALL) });
    body.push({ to: V2, data: V2_CHECK + word(p.hot) + word(p.vault) + word(RIGHTS_ALL) });
    body.push({ to: V1, data: V1_CHECK + word(p.hot) + word(p.vault) });
  }
  const out = await calls(body, { timeout: 12000 });
  if (!out) return { ok: new Map(), degraded: true };
  const ok = new Map();
  list.forEach((p, i) => {
    ok.set(`${lower(p.hot)}|${lower(p.vault)}`, out.slice(i * 3, i * 3 + 3).some(truthy));
  });
  return { ok, degraded: false };
}

/** Where a vault goes to sign, with everything we can fill in already filled. */
export function delegateUrl(hot, { scoped = true } = {}) {
  const to = lower(hot);
  const q = new URLSearchParams({ to, type: 'ALL' });
  if (scoped) q.set('rights', RIGHTS_LABEL);
  return `https://delegate.xyz/?${q.toString()}`;
}
