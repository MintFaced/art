/* POST /api/auth/x/unlink — detach the X identity from this wallet's account.
 *
 * Clears the verified handle and frees the X reverse index, then re-issues the
 * wallet session without the handle so the menu returns to CONNECT X and any
 * typed/overlay handle resurfaces where it existed. The wallet keeps its account
 * and its TAO; only the X link is undone.
 */
import crypto from 'node:crypto';
import { pipe, storeConfigured } from '../../_lib/kv.js';
import { unlinkX } from '../../_lib/accounts.js';
import { chatStore, sessionUntil, SCOPE } from '../../_lib/chat.js';
import { openCookies, hostOf, cookieFrom, corsFor, TOKEN_COOKIE } from '../../_lib/session.js';

const json = (request, b, s = 200, cookies = []) => {
  const h = new Headers({ 'content-type': 'application/json', 'cache-control': 'no-store', ...corsFor(request) });
  for (const c of cookies) h.append('set-cookie', c);
  return new Response(JSON.stringify(b), { status: s, headers: h });
};

export function OPTIONS(request) {
  return new Response(null, { status: 204, headers: corsFor(request) });
}

async function sessionDays(origin) {
  try {
    const cfg = await fetch(`${origin}/data/source/chat.json`, { headers: { accept: 'application/json' } }).then((r) => r.json());
    return { cfg, days: Number(cfg.session_days || 30) };
  } catch (e) { return { cfg: {}, days: 30 }; }
}

export async function POST(request) {
  if (!storeConfigured()) return json(request, { error: 'unavailable' }, 503);
  const token = cookieFrom(request, TOKEN_COOKIE);
  if (!token) return json(request, { error: 'no session' }, 401);

  const { cfg, days } = await sessionDays(new URL(request.url).origin);
  const db = chatStore(pipe, cfg);
  const sess = await db.session(token).catch(() => null);
  if (!sess || !sess.address) return json(request, { error: 'not a wallet session' }, 400);

  if (sess.account) await unlinkX(sess.account).catch(() => {});

  /* Re-issue the wallet session without the handle. The mf_who companion the
     nav reads drops back to `address|until`, so the menu offers CONNECT X again
     on the next draw ... no hard refresh. */
  const seconds = days * 86400;
  const issued = new Date().toISOString();
  const until = sessionUntil(issued, days);
  const fresh = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
  await db.openSession(fresh, sess.address, seconds, SCOPE, null, sess.account ? { acct: sess.account } : {});
  const cookies = openCookies({ token: fresh, address: sess.address, until, host: hostOf(request), seconds });
  return json(request, { ok: true }, 200, cookies);
}
