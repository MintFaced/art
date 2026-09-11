/* What the /combo page asks, and nothing else.
 *
 * One question: who speaks through this wallet, and what do they hold between
 * them? The page asks it on load, and again after the collector has been to
 * delegate.xyz and come back, which is the moment the whole thing turns on ...
 * so `fresh=1` exists and goes straight past the cache to the chain.
 *
 * It answers for the session's wallet where there is one, and for any address
 * in the query where there is not. That second case is deliberate and safe: a
 * COMBO is public. It is two or three addresses and a sum of numbers that are
 * already on the leaderboard, and reading somebody else's is exactly as
 * revealing as reading the registry, which anybody can do.
 */
import { useRequestOrigin, siteOrigin } from './_lib/data.js';
import { storeConfigured, pipe } from './_lib/kv.js';
import { chatStore } from './_lib/chat.js';
import { cookieFrom, TOKEN_COOKIE, corsFor } from './_lib/session.js';
import { comboFor, forget, comboMark } from './_lib/combo.js';
import { delegateUrl, isAddress, doors, RIGHTS_LABEL, RIGHTS_MINTFACE } from './_lib/delegate.js';
import { loadRegister } from './_lib/register.js';

const at = async (origin, p) => {
  const r = await fetch(`${origin}/${p}`, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`${p}: ${r.status}`);
  return r.json();
};

const reply = (request, body, status = 200) => new Response(JSON.stringify(body, null, 1), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...corsFor(request) },
});

export async function OPTIONS(request) {
  return new Response(null, { status: 204, headers: corsFor(request) });
}

export async function GET(request) {
  const origin = useRequestOrigin(request) || siteOrigin();
  const url = new URL(request.url);
  const fresh = url.searchParams.get('fresh') === '1';

  /* The session first, and the query only where there is none. A page that
     took the address from the query while somebody was signed in could be
     handed a link that quietly showed them somebody else's COMBO as if it were
     theirs ... which is a small thing here and a bad habit anywhere. */
  let signed = null;
  if (storeConfigured()) {
    const token = cookieFrom(request, TOKEN_COOKIE);
    if (token) signed = await chatStore(pipe).session(token).catch(() => null);
  }
  const address = String(signed ? signed.address : (url.searchParams.get('address') || '')).toLowerCase();

  /* What a vault has to be told, whether or not anybody is connected. The page
     is readable signed out ... it is the explanation as much as the machine. */
  const open = doors();
  const how = {
    rights: RIGHTS_LABEL,
    rights_bytes32: RIGHTS_MINTFACE,
    registry: 'delegate.xyz',
    type: 'ALL',
  };
  /* The second door, drawn only where the config has opened it. The page reads
     this rather than knowing about registries, so opening one is a config
     change on both halves at once rather than a deploy of the page. */
  const second = open.nftd
    ? { registry: 'nftdelegation.com', url: 'https://nftdelegation.com/', use_case: 'All',
      collection: 'All collections' }
    : null;

  if (!isAddress(address)) {
    return reply(request, { signed_in: false, address: null, combo: null, how, second, url: null });
  }

  /* A collector who has just delegated is looking at this page waiting for it
     to change. Two minutes of cache is the wrong answer to that one question,
     so the page asks for the chain and this forgets what it knew first. */
  if (fresh) await forget(address);

  let tao = null;
  try { tao = await at(origin, 'data/tao.json'); } catch (e) { tao = null; }
  if (!tao) return reply(request, { error: 'the register is not reachable' }, 503);

  const combo = await comboFor(tao, address, { fresh });
  const register = await loadRegister(at, origin, storeConfigured() ? pipe : null).catch(() => null);
  const named = (a) => {
    const who = register ? register.who(a) : null;
    return who && who.known && !who.private ? who.name : null;
  };

  return reply(request, {
    signed_in: Boolean(signed),
    address,
    how,
    second,
    /* Where the vault goes. Pre-filled as far as delegate.xyz's own URL will
       take it; the page shows the values to paste for anything it will not. */
    url: delegateUrl(address, { scoped: true }),
    url_all: delegateUrl(address, { scoped: false }),
    combo: {
      combo: combo.combo,
      mark: comboMark(combo.members.length),
      solo: combo.solo,
      total: combo.total,
      wallets: combo.members.length,
      members: combo.members.map((m) => ({
        address: m.address,
        name: named(m.address),
        tao: m.tao,
        hot: Boolean(m.hot),
        scoped: Boolean(m.scoped),
        registry: m.registry,
      })),
    },
    /* Said plainly rather than swallowed: a page reporting `no delegations`
       when it could not reach the registry is a page telling a lie with a
       straight face. */
    degraded: combo.degraded,
  });
}
