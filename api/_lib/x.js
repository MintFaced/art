/* The X (Twitter) wire, OAuth 1.0a user context, hand-rolled.
 *
 * No SDK: the whole surface the tweet-bot needs is three calls — upload an
 * image, post a tweet, delete a tweet — and OAuth 1.0a is a signature over a
 * sorted parameter string, which node's crypto does directly. A dependency
 * would be more code to trust than the fifty lines it replaces.
 *
 * Credentials are four env vars, Production only (see isConfigured / guardProd):
 *   X_API_KEY, X_API_SECRET         ... the app (consumer) key + secret
 *   X_ACCESS_TOKEN, X_ACCESS_SECRET ... the bot account's user token + secret
 *
 * Signing note: only the OAuth parameters (and any query-string params) go into
 * the signature base. JSON and multipart bodies do not, which is why tweets
 * carry a JSON body and media goes up as multipart — neither perturbs the
 * signature, and the request stays simple.
 */
import crypto from 'node:crypto';

const KEYS = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET'];

export function isConfigured() {
  return KEYS.every((k) => typeof process.env[k] === 'string' && process.env[k].length > 0);
}

/* Production carries the credentials on purpose and Preview deliberately does
   not, so a branch deploy cannot tweet. This is belt to isConfigured's braces:
   even if a key leaked into Preview, VERCEL_ENV gates the act. */
export function isProd() {
  return process.env.VERCEL_ENV === 'production';
}
export function canTweet() {
  return isProd() && isConfigured();
}

// RFC 3986 percent-encoding: encodeURIComponent leaves ! * ' ( ) alone, OAuth wants them encoded.
export const enc = (s) => encodeURIComponent(String(s)).replace(/[!*'()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

/* The pure signature, exported so it can be checked against X's published example
   without a live call. `params` is every parameter that must be signed: the
   oauth_* set plus any query-string params (never the JSON/multipart body). */
export function signature({ method, url, params, consumerSecret, tokenSecret }) {
  const paramString = Object.keys(params)
    .map((k) => [enc(k), enc(params[k])])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : (a[1] < b[1] ? -1 : 1)))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const base = [method.toUpperCase(), enc(url.split('?')[0]), enc(paramString)].join('&');
  const signingKey = `${enc(consumerSecret)}&${enc(tokenSecret)}`;
  return crypto.createHmac('sha1', signingKey).update(base).digest('base64');
}

function oauthHeader(method, url, extraParams = {}) {
  const oauth = {
    oauth_consumer_key: process.env.X_API_KEY,
    oauth_token: process.env.X_ACCESS_TOKEN,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_version: '1.0',
  };
  oauth.oauth_signature = signature({
    method, url,
    params: { ...oauth, ...extraParams },   // oauth params + query params, never the body
    consumerSecret: process.env.X_API_SECRET,
    tokenSecret: process.env.X_ACCESS_SECRET,
  });
  return 'OAuth ' + Object.keys(oauth)
    .sort()
    .map((k) => `${enc(k)}="${enc(oauth[k])}"`)
    .join(', ');
}

/** Upload one image, return its media_id_string. Bytes as a Buffer/Uint8Array. */
export async function uploadMedia(bytes, mimeType = 'image/png') {
  const url = 'https://upload.twitter.com/1.1/media/upload.json';
  // Multipart body is not part of the signature, so the header signs only oauth.
  const boundary = '----mfx' + crypto.randomBytes(8).toString('hex');
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="card.png"\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n`, 'utf8');
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  const body = Buffer.concat([head, Buffer.from(bytes), tail]);
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: oauthHeader('POST', url),
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`media upload failed (${r.status}): ${JSON.stringify(j).slice(0, 200)}`);
  const id = j.media_id_string || (j.media_id != null ? String(j.media_id) : null);
  if (!id) throw new Error('media upload returned no id');
  return id;
}

/** Post a tweet. Returns { id }. mediaIds optional. */
export async function tweet(text, mediaIds = []) {
  const url = 'https://api.x.com/2/tweets';
  const payload = { text: String(text) };
  if (mediaIds && mediaIds.length) payload.media = { media_ids: mediaIds.map(String) };
  const r = await fetch(url, {
    method: 'POST',
    headers: { authorization: oauthHeader('POST', url), 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`tweet failed (${r.status}): ${JSON.stringify(j).slice(0, 200)}`);
  const id = j && j.data && j.data.id;
  if (!id) throw new Error('tweet returned no id');
  return { id: String(id) };
}

/** Delete a tweet by id (used to clean up the acceptance throwaway). */
export async function deleteTweet(id) {
  const url = `https://api.x.com/2/tweets/${encodeURIComponent(id)}`;
  const r = await fetch(url, { method: 'DELETE', headers: { authorization: oauthHeader('DELETE', url) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`delete failed (${r.status}): ${JSON.stringify(j).slice(0, 200)}`);
  return { deleted: !!(j && j.data && j.data.deleted) };
}
