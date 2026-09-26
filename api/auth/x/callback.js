/* GET /api/auth/x/callback — finish Sign in with X.
 *
 * Reads the sid cookie, pulls the stashed verifier+state from KV (one-time),
 * checks state (CSRF), exchanges the code, reads the identity, and upserts the
 * account. Then it mints the SAME opaque KV session the SIWE path mints, so
 * everything downstream keeps working unchanged: a wallet-linked account gets a
 * wallet session; an X-only account gets a spectator session (empty address,
 * its identity in the session extra and the mf_who cookie).
 */
import crypto from 'node:crypto';
import { exchangeCode, me } from '../../_lib/x-oauth.js';
import { one, pipe, storeConfigured } from '../../_lib/kv.js';
import { upsertX, get as getAccount } from '../../_lib/accounts.js';
import { chatStore, sessionUntil, SCOPE } from '../../_lib/chat.js';
import { openCookies, hostOf, cookieFrom } from '../../_lib/session.js';
import { XKEY } from '../x.js';

const CALLBACK = process.env.X_OAUTH_CALLBACK || 'https://mintface.art/api/auth/x/callback';
const HOME = 'https://mintface.art/';

const back = (dest, cookies = []) => {
  const headers = new Headers({ location: dest });
  for (const c of cookies) headers.append('set-cookie', c);
  // the sid is single-use; clear it whatever the outcome
  headers.append('set-cookie', 'mf_xauth=; Domain=.mintface.art; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0');
  return new Response(null, { status: 302, headers });
};
const fail = (why) => back(`${HOME}?x=${encodeURIComponent(why)}`);

async function sessionDays(origin) {
  try {
    const cfg = await fetch(`${origin}/data/source/chat.json`, { headers: { accept: 'application/json' } }).then((r) => r.json());
    return { cfg, days: Number(cfg.session_days || 30) };
  } catch (e) { return { cfg: {}, days: 30 }; }
}

export async function GET(request) {
  const url = new URL(request.url);
  if (url.searchParams.get('error')) return fail('denied');          // user declined at X
  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');
  if (!code || !stateParam) return fail('bad-request');
  if (!storeConfigured()) return fail('unavailable');

  // Recover the stash, one-time.
  const sid = cookieFrom(request, 'mf_xauth');
  if (!sid) return fail('no-session');
  const raw = await one('GET', XKEY(sid));
  if (!raw) return fail('expired');
  await one('DEL', XKEY(sid));
  let stash;
  try { stash = JSON.parse(raw); } catch (e) { return fail('bad-session'); }
  if (!stash.state || stash.state !== stateParam) return fail('state');   // CSRF

  // Exchange + identity.
  let ident;
  try {
    const tokens = await exchangeCode({ code, redirectUri: CALLBACK, verifier: stash.verifier });
    ident = await me(tokens.access_token);
  } catch (e) {
    console.error('x-auth callback:', String(e && e.message ? e.message : e));
    return fail('x-failed');
  }
  if (!ident.id) return fail('no-identity');

  // Account: find or create by the stable X id; refresh handle/avatar.
  const { account_id } = await upsertX({ x_id: ident.id, x_handle: ident.username, x_avatar: ident.avatar });
  const acct = await getAccount(account_id);
  const address = acct && acct.wallets && acct.wallets.length ? acct.wallets[0] : '';   // Phase 2 links wallets

  // Mint the session, the same shape SIWE mints, plus the X identity in extra.
  const { cfg, days } = await sessionDays(url.origin);
  const seconds = days * 86400;
  const issued = new Date().toISOString();
  const until = sessionUntil(issued, days);
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
  const db = chatStore(pipe, cfg);
  await db.openSession(token, address, seconds, SCOPE, null, { x: ident.id, acct: account_id });

  // A wallet-linked account reads as its wallet; an X-only account reads as its
  // handle, so the nav can draw the X identity where an address would be.
  const who = address ? `${address}|${until}` : `x:${ident.username || ident.id}|${until}`;
  const cookies = openCookies({ token, address, until, host: hostOf(request), seconds, who });
  return back(stash.ret || HOME, cookies);
}
