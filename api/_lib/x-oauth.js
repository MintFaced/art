/* Sign in with X — OAuth 2.0 with PKCE. The user login, not the bot.
 *
 * This is the confidential-client flow: a Client ID and a Client Secret (the
 * OAuth 2.0 pair at the bottom of the app's Keys & Tokens, NOT the OAuth 1.0a
 * keys api/_lib/x.js uses to tweet). PKCE rides along on top because X requires
 * it even for confidential clients.
 *
 * We ask for the least that gets us an identity: users.read to read the profile,
 * tweet.read because X couples it to users.read, offline.access for a refresh
 * token so a 90-day session can renew the profile without a re-login. We never
 * request write and never tweet as a user.
 *
 * Nothing here touches sessions or the store — it is the protocol only, so the
 * routes can be read plainly and this can be tested on its own.
 */
import crypto from 'node:crypto';

const AUTHORIZE = 'https://x.com/i/oauth2/authorize';
const TOKEN = 'https://api.x.com/2/oauth2/token';
const ME = 'https://api.x.com/2/users/me?user.fields=profile_image_url,username,name';

export const SCOPES = ['users.read', 'tweet.read', 'offline.access'];

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const clientId = () => process.env.X_OAUTH_CLIENT_ID || null;
export const clientSecret = () => process.env.X_OAUTH_CLIENT_SECRET || null;
export const oauthConfigured = () => Boolean(clientId() && clientSecret());

/** A fresh PKCE pair. The verifier is the secret kept for the callback; the
    challenge is what rides to X in the open. */
export function pkce() {
  const verifier = b64url(crypto.randomBytes(32));          // 43 chars, unreserved
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

/** An unguessable value tying the callback to the request that started it. */
export const state = () => b64url(crypto.randomBytes(16));

/** Where to send the browser to begin. */
export function authorizeUrl({ redirectUri, challenge, state: st }) {
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: clientId(),
    redirect_uri: redirectUri,
    scope: SCOPES.join(' '),
    state: st,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  // X documents scope with %20 between values; URLSearchParams emits '+'. None
  // of our values contain a literal '+' (base64url uses -/_), so this is safe.
  return `${AUTHORIZE}?${q.toString().replace(/\+/g, '%20')}`;
}

// X's token endpoint wants HTTP Basic auth for a confidential client, and the
// body form-encoded. Shared by the code exchange and the refresh.
function basicAuth() {
  return 'Basic ' + Buffer.from(`${clientId()}:${clientSecret()}`).toString('base64');
}
async function token(form) {
  const r = await fetch(TOKEN, {
    method: 'POST',
    headers: { authorization: basicAuth(), 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`x oauth token ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return j;   // { access_token, refresh_token, expires_in, scope, token_type }
}

/** Exchange the authorization code for tokens. Needs the verifier from step one. */
export function exchangeCode({ code, redirectUri, verifier }) {
  return token({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    client_id: clientId(),
  });
}

/** Renew an access token from a refresh token (offline.access). */
export function refresh(refreshToken) {
  return token({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId() });
}

/** The identity: the stable id is the key; handle + avatar are display data. */
export async function me(accessToken) {
  const r = await fetch(ME, { headers: { authorization: `Bearer ${accessToken}` } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`x users/me ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  const d = (j && j.data) || {};
  return { id: d.id || null, username: d.username || null, name: d.name || null, avatar: d.profile_image_url || null };
}
