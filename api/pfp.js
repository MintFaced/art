/* Faces (PFP.md): reading them, and changing your own.
 *
 *   GET  /api/pfp?address=0x...   one collector's picture: { source, url, updated }
 *   GET  /api/pfp?all=1           every picture, wallet -> url, for the register
 *   POST /api/pfp                 your own picture:
 *        stage   (multipart: payload + image)  -> { tmp, url, w, h } to crop over
 *        save    { tmp, crop: { cx, cy, zoom } }
 *        use     { source: opensea | ens | x }
 *        remove  {}                             -> back to the placeholder, and it stays
 *
 * Signed in with a wallet (or with X and a linked wallet), you may change your
 * own and nobody else's. The artist, signed into the console, may change
 * anybody's, and says whose with { address }.
 */
import { pipe, storeConfigured } from './_lib/kv.js';
import { chatStore } from './_lib/chat.js';
import { corsFor, cookieFrom, TOKEN_COOKIE } from './_lib/session.js';
import { sessionFrom, sessionOk } from './_lib/studio.js';
import { siteJSON, useRequestOrigin } from './_lib/data.js';
import * as P from './_lib/pfp.js';

const lower = (a) => String(a || '').toLowerCase();
const isAddr = (a) => /^0x[0-9a-f]{40}$/.test(lower(a));
const out = (request, body, status = 200, cache = 'no-store') => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': cache, ...corsFor(request) },
});

/* Who is private on the register, read once a few minutes. */
let PRIV = null;
async function privateSet() {
  if (PRIV && Date.now() - PRIV.at < 300000) return PRIV.set;
  const reg = await siteJSON('data/collectors-register.json').catch(() => null);
  const set = new Set();
  if (reg && reg.fields && reg.rows) {
    const ai = reg.fields.indexOf('address'); const pi = reg.fields.indexOf('private');
    for (const r of reg.rows) if (r[pi]) set.add(lower(r[ai]));
  }
  PRIV = { set, at: Date.now() };
  return set;
}

export async function OPTIONS(request) { return out(request, {}, 204); }

export async function GET(request) {
  useRequestOrigin(request);
  if (!storeConfigured()) return out(request, { error: 'Pictures are not set up on this deployment.' }, 503);
  const url = new URL(request.url);
  const priv = await privateSet();
  if (url.searchParams.get('all')) {
    /* Wallet -> the picture's key name alone. The rest of every URL is the
       same, and three thousand of them written out in full is most of the
       file: https://assets.mintface.art/pfp/<wallet>/<name>.webp, and the
       small copy is <name>-128.webp beside it. */
    const all = await P.all();
    const map = {};
    for (const [a, u] of Object.entries(all)) {
      if (priv.has(a)) continue;
      const m = /\/pfp\/0x[0-9a-f]{40}\/([0-9a-f]+)\.webp$/.exec(u);
      if (m) map[a] = m[1];
    }
    /* Short: a face somebody has just saved should reach the register and
       their page within about a minute and a half, not seven. */
    return out(request, { base: `${P.PUBLIC}/pfp`, small: P.SMALL, map }, 200, 'public, max-age=30, s-maxage=60');
  }
  const address = lower(url.searchParams.get('address'));
  if (!isAddr(address)) return out(request, { error: 'Which wallet?' }, 400);
  if (priv.has(address)) return out(request, P.said(null, address));
  return out(request, P.said(await P.record(address), address), 200, 'public, max-age=30, s-maxage=60');
}

export async function POST(request) {
  useRequestOrigin(request);
  if (!storeConfigured() || !P.ready()) return out(request, { error: 'Pictures are not set up on this deployment.' }, 503);
  let body = {};
  let upload = null;
  try {
    if (/^multipart\/form-data/i.test(request.headers.get('content-type') || '')) {
      const form = await request.formData();
      body = JSON.parse(String(form.get('payload') || '{}'));
      const f = form.get('image');
      if (f && typeof f.arrayBuffer === 'function') upload = Buffer.from(await f.arrayBuffer());
    } else body = await request.json();
  } catch (e) { return out(request, { error: 'bad request' }, 400); }

  /* Who, and whose. */
  const artist = sessionOk(sessionFrom(request));
  let address;
  if (artist) {
    address = lower(body.address);
    if (!isAddr(address)) return out(request, { error: 'Whose picture?' }, 400);
  } else {
    const token = cookieFrom(request, TOKEN_COOKIE) || String(body.token || '');
    address = token ? await chatStore(pipe, {}).whoseSession(token) : null;
    if (!address) return out(request, { error: 'Sign in with your wallet to change your picture.', signin: true }, 401);
    if (body.address && lower(body.address) !== lower(address)) {
      return out(request, { error: 'You can only change your own picture.' }, 403);
    }
  }
  const by = artist ? 'artist' : 'self';
  if (!artist && !(await P.spend(address))) return out(request, { error: 'That is a lot of changes in an hour. Try again later.' }, 429);

  const action = String(body.action || '');
  let res;
  if (action === 'stage') {
    if (!upload) return out(request, { error: 'Choose a picture.' }, 400);
    res = await P.stage(address, upload, { by });
  } else if (action === 'save') {
    res = await P.save(address, body.tmp, body.crop || null, { by });
  } else if (action === 'use') {
    res = await P.useSource(address, String(body.source || ''), { by });
  } else if (action === 'remove') {
    res = await P.remove(address, { by });
  } else {
    return out(request, { error: 'Unknown action.' }, 400);
  }
  return out(request, res, res.status || 200);
}
