/* GET /api/auth/x — begin Sign in with X.
 *
 * Mints a PKCE pair and a state, stashes the verifier+state in KV behind a
 * short-lived HttpOnly cookie (the sid), and sends the browser to X. The
 * verifier never leaves the server; only the challenge and state ride out. The
 * `return` param is where to land afterwards, validated to the family so this
 * is not an open redirect.
 *
 * The callback is always the canonical mintface.art host (collectors has no
 * functions), and the sid cookie is scoped .mintface.art so a sign-in that
 * starts anywhere in the family completes here.
 */
import crypto from 'node:crypto';
import { pkce, state, authorizeUrl, oauthConfigured } from '../_lib/x-oauth.js';
import { one, storeConfigured } from '../_lib/kv.js';

const CALLBACK = process.env.X_OAUTH_CALLBACK || 'https://mintface.art/api/auth/x/callback';
const FAMILY = ['mintface.art', 'collectors.mintface.art'];
const TTL = 600;                          // ten minutes to complete the round trip
export const XKEY = (sid) => `xauth:${sid}`;

// Only ever return the browser to a family page; anything else falls to home.
function safeReturn(raw) {
  try {
    const u = new URL(raw, 'https://mintface.art');
    if (FAMILY.includes(u.hostname.toLowerCase())) return u.toString();
  } catch (e) { /* fall through */ }
  return 'https://mintface.art/';
}

export async function GET(request) {
  if (!oauthConfigured()) return new Response('Sign in with X is not configured.', { status: 503 });
  if (!storeConfigured()) return new Response('Sign in is unavailable just now.', { status: 503 });

  const url = new URL(request.url);
  const ret = safeReturn(url.searchParams.get('return') || 'https://mintface.art/');
  const { verifier, challenge } = pkce();
  const st = state();
  const sid = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  await one('SET', XKEY(sid), JSON.stringify({ verifier, state: st, ret }), 'EX', String(TTL));

  const headers = new Headers({ location: authorizeUrl({ redirectUri: CALLBACK, challenge, state: st }) });
  headers.append('set-cookie',
    `mf_xauth=${sid}; Domain=.mintface.art; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${TTL}`);
  return new Response(null, { status: 302, headers });
}
