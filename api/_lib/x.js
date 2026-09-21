/* The X API, as much of it as a bot needs.
 *
 * Posting as an account is OAuth 1.0a user context ... four credentials, not a
 * bearer token, because a bearer speaks for the app and this has to speak for
 * the bot. Signed here with node's crypto rather than by adding a dependency:
 * the signature is forty lines and a library for it is forty thousand.
 *
 * Nothing here knows about nudges or sales. It takes text and maybe an image
 * and returns what X said, so the worker can be read as a worker.
 */
import { createHmac, randomBytes } from 'node:crypto';

const API = 'https://api.x.com';
const UPLOAD = 'https://upload.x.com/1.1/media/upload.json';

export const KEYS = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET'];
export const xConfigured = () => KEYS.every((k) => Boolean(process.env[k]));
/* One flag, for the day something misfires in public. The queue keeps filling
   while it is set; only the sending stops, so nothing is lost by pulling it. */
export const xPaused = () => /^(1|true|yes|on)$/i.test(String(process.env.X_BOT_PAUSED || ''));

/* RFC 3986, which is stricter than encodeURIComponent about these four. A
   signature computed over a differently-escaped string is simply wrong, and
   wrong here reads as "could not authenticate you" with nothing to go on. */
const enc = (s) => encodeURIComponent(String(s))
  .replace(/[!*'()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

function sign(method, url, params, { key, secret, token, tokenSecret }) {
  const oauth = {
    oauth_consumer_key: key,
    oauth_nonce: randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: token,
    oauth_version: '1.0',
  };
  /* The base string signs the query and the oauth params together, sorted.
     A JSON body is NOT signed, which is why the v2 endpoints work with an
     empty param set and the v1.1 upload has to have its query in here. */
  const all = { ...params, ...oauth };
  const base = [method.toUpperCase(), enc(url), enc(Object.keys(all).sort()
    .map((k) => `${enc(k)}=${enc(all[k])}`).join('&'))].join('&');
  const signingKey = `${enc(secret)}&${enc(tokenSecret)}`;
  oauth.oauth_signature = createHmac('sha1', signingKey).update(base).digest('base64');
  return `OAuth ${Object.keys(oauth).sort().map((k) => `${enc(k)}="${enc(oauth[k])}"`).join(', ')}`;
}

const creds = () => ({
  key: process.env.X_API_KEY,
  secret: process.env.X_API_SECRET,
  token: process.env.X_ACCESS_TOKEN,
  tokenSecret: process.env.X_ACCESS_SECRET,
});

/**
 * An image, up first. X wants media uploaded and referenced by id rather than
 * inlined, so a tweet with a card is two calls and the first one can fail on
 * its own ... which is why the caller is allowed to carry on without it. A
 * tweet with no picture is worth more than no tweet.
 */
export async function uploadMedia(bytes, type = 'image/png') {
  const c = creds();
  const body = new FormData();
  body.append('media', new Blob([bytes], { type }), 'card.png');
  const r = await fetch(UPLOAD, {
    method: 'POST',
    headers: { authorization: sign('POST', UPLOAD, {}, c) },
    body,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`x media ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return j.media_id_string || (j.media_id != null ? String(j.media_id) : null);
}

/** The tweet itself. Returns the id X assigned, which is what is recorded. */
export async function tweet(text, mediaIds = []) {
  const c = creds();
  const url = `${API}/2/tweets`;
  const payload = { text, ...(mediaIds && mediaIds.length ? { media: { media_ids: mediaIds } } : {}) };
  const r = await fetch(url, {
    method: 'POST',
    headers: { authorization: sign('POST', url, {}, c), 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(`x tweet ${r.status}: ${JSON.stringify(j).slice(0, 240)}`);
    err.status = r.status;
    /* 429 is the rate limit and 5xx is X having a moment: both are worth
       waiting on rather than giving up over. A 4xx that is not 429 means this
       tweet will never send, however many times it is offered. */
    err.retryable = r.status === 429 || r.status >= 500;
    throw err;
  }
  return (j.data && j.data.id) || null;
}

/** A tweet is 280 characters, and a link counts as 23 whatever its length. */
export function weight(text) {
  return String(text || '').replace(/https?:\/\/\S+/g, 'x'.repeat(23)).length;
}
