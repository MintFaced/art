/* Faces: a hexagon picture for every collector (PFP.md).
 *
 * One picture per wallet, 512×512 webp in R2, from wherever the collector
 * already has one: their own upload, their OpenSea profile, their ENS avatar,
 * their linked X account ... in that order ... and otherwise nothing, which
 * the page draws as their longest-held work, faintly.
 *
 * EVERY PICTURE IS OURS BEFORE IT IS SHOWN. Fetched server-side, decoded,
 * turned upright, cropped, and written out with no metadata, by the same
 * pipeline the Studio's pictures go through. Nothing is ever hotlinked from
 * OpenSea or X, so nothing on the page tells them who is looking at whom.
 *
 * A PRIVATE COLLECTOR HAS NO FACE HERE. The register already declines to name
 * them; an OpenSea avatar beside "Private collector" would name them anyway.
 * They are skipped by the backfill and answered with nothing.
 */
import { createHash, randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { normalize } from 'viem/ens';
import { createPublicClient, fallback, http } from 'viem';
import { mainnet } from 'viem/chains';
import { one, pipe, storeConfigured } from './kv.js';
import { putObject, r2Configured } from './r2.js';
import { decodeImage, processImage } from './images.js';
import { byWallet, get as getAccount } from './accounts.js';

export const SIZE = 512;
export const AUTO = ['opensea', 'ens', 'x'];
export const PUBLIC = process.env.ASSETS_PUBLIC_BASE || 'https://assets.mintface.art';
const lower = (a) => String(a || '').toLowerCase();
const isAddr = (a) => /^0x[0-9a-f]{40}$/.test(lower(a));
const parse = (v) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch (e) { return null; } };

export const K = {
  rec: (a) => `pfp:${lower(a)}`,
  map: 'pfp:map',
  none: 'pfp:none',
  tmp: (id) => `pfp:tmp:${id}`,
  job: 'pfp:job',
  rate: (who, hour) => `pfp:rl:${who}:${hour}`,
};

/* ---------------------------------------------------------------- reading */

export async function record(address) {
  return isAddr(address) ? parse(await one('GET', K.rec(address))) : null;
}

/** What anybody may know: the picture, where it came from, when. */
export const said = (r, address) => (r && r.source !== 'none' && r.url
  ? { address: lower(address), source: r.source, url: r.url, small: smallOf(r.url), updated: r.updated }
  : { address: lower(address), source: 'none', url: null, updated: r ? r.updated : null });

/** Every face at once, for the register: wallet -> picture. */
export async function all() {
  const flat = (await one('HGETALL', K.map)) || [];
  const map = {};
  for (let i = 0; i + 1 < flat.length; i += 2) map[flat[i]] = flat[i + 1];
  return map;
}

/* ---------------------------------------------------------------- making one */

/**
 * The square a crop names, cut out of the upright picture and written as a
 * 512 webp. A crop is the centre of the square as fractions of the picture,
 * and a zoom: 1 is the largest square that fits, 2 is half its side. Without
 * one, the centre.
 */
export async function render(bytes, crop = null) {
  const d = await decodeImage(bytes, { wide: true });
  if (d.error) return d;
  const { width: w, height: h } = d;
  const zoom = Math.max(1, Math.min(8, Number(crop && crop.zoom) || 1));
  const side = Math.max(1, Math.floor(Math.min(w, h) / zoom));
  const cx = Math.max(0, Math.min(1, crop && crop.cx != null ? Number(crop.cx) : 0.5));
  const cy = Math.max(0, Math.min(1, crop && crop.cy != null ? Number(crop.cy) : 0.5));
  const left = Math.max(0, Math.min(w - side, Math.round(cx * w - side / 2)));
  const top = Math.max(0, Math.min(h - side, Math.round(cy * h - side / 2)));
  const out = await d.img.extract({ left, top, width: side, height: side })
    .resize(SIZE, SIZE, { fit: 'cover' })
    .flatten({ background: '#faf9f6' })
    .toColourspace('srgb')
    .webp({ quality: 82 })
    .toBuffer();
  return { bytes: out };
}

const hashOf = (b) => createHash('sha256').update(b).digest('hex').slice(0, 12);

/* The small copy beside it, for every size under the profile header: a row
   of the register draws thirty-two pixels and should not fetch five hundred. */
export const SMALL = 128;
export const smallOf = (url) => String(url || '').replace(/\.webp$/, `-${SMALL}.webp`);

/* Kept, and pointed at. A new picture gets a new key, so no cache anywhere can
   go on serving the old face under the new one's name. */
async function keep(address, bytes, fields) {
  const key = `pfp/${lower(address)}/${hashOf(bytes)}.webp`;
  const small = await sharp(bytes).resize(SMALL, SMALL).webp({ quality: 80 }).toBuffer();
  await Promise.all([putObject(key, bytes, 'image/webp'), putObject(smallOf(key), small, 'image/webp')]);
  const rec = { address: lower(address), key, url: `${PUBLIC}/${key}`, updated: new Date().toISOString(), ...fields };
  await pipe([
    ['SET', K.rec(address), JSON.stringify(rec)],
    ['HSET', K.map, lower(address), rec.url],
    ['SREM', K.none, lower(address)],
  ]);
  return rec;
}

/* ---------------------------------------------------------------- sources */

/* A fetch of somebody else's picture: https only, a public host, a timeout,
   a size cap. An ENS avatar can say anything, and this is a server. */
const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1\]?|\[?f[cd]|.*\.(local|internal|localhost)$)/i;
export async function fetchPicture(url) {
  let u;
  try { u = new URL(String(url)); } catch (e) { return { error: 'not a URL' }; }
  if (u.protocol !== 'https:' || PRIVATE_HOST.test(u.hostname) || /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname)) {
    return { error: 'not a public https URL' };
  }
  try {
    const r = await fetch(u.href, { redirect: 'follow', signal: AbortSignal.timeout(15000), headers: { accept: 'image/*' } });
    if (!r.ok) return { error: `answered ${r.status}` };
    const len = Number(r.headers.get('content-length') || 0);
    if (len > 12 * 1024 * 1024) return { error: 'too large' };
    const bytes = Buffer.from(await r.arrayBuffer());
    if (bytes.length > 12 * 1024 * 1024) return { error: 'too large' };
    return { bytes, type: r.headers.get('content-type') || null };
  } catch (e) { return { error: String(e.name === 'TimeoutError' ? 'timed out' : e.message).slice(0, 80) }; }
}

/* OpenSea's own stand-ins: the coloured default avatars every account starts
   with. A collector who never chose one has not got a picture there. */
export const isOpenSeaDefault = (url) => !url
  || /opensea-static\/opensea-profile|\/default[-_]?(profile|avatar)|\/avatars\/default/i.test(String(url));

export async function fromOpenSea(address) {
  const key = process.env.OPENSEA_API_KEY;
  if (!key) return { error: 'no OpenSea key here' };
  try {
    const r = await fetch(`https://api.opensea.io/api/v2/accounts/${lower(address)}`,
      { headers: { accept: 'application/json', 'x-api-key': key }, signal: AbortSignal.timeout(10000) });
    if (r.status === 404) return { none: true };
    if (r.status === 429) return { error: 'rate limited', retry: true };
    if (!r.ok) return { error: `OpenSea ${r.status}` };
    const j = await r.json();
    const url = j && j.profile_image_url;
    return isOpenSeaDefault(url) ? { none: true } : { url };
  } catch (e) { return { error: 'OpenSea did not answer' }; }
}

let CLIENT = null;
const chain = () => CLIENT || (CLIENT = createPublicClient({ chain: mainnet,
  transport: fallback(['https://ethereum-rpc.publicnode.com', 'https://eth.llamarpc.com'].map((u) => http(u, { timeout: 10000 }))) }));
export const useChain = (c) => { CLIENT = c; };

/** An ENS name's avatar, resolved to something fetchable: https, IPFS and NFT
    avatars all come back as an https URL from viem. */
export async function fromEns(address, name = null) {
  try {
    let n = name;
    if (!n) n = await chain().getEnsName({ address: lower(address) });
    if (!n) return { none: true };
    const url = await chain().getEnsAvatar({ name: normalize(n) });
    return url ? { url } : { none: true };
  } catch (e) { return { none: true }; }
}

/** The X picture of a verified link, at full size rather than 48 pixels. */
export async function fromX(address) {
  try {
    const acct = await byWallet(lower(address));
    const a = acct ? await getAccount(acct) : null;
    const url = a && a.x_avatar ? String(a.x_avatar).replace(/_normal(\.[a-z]+)$/i, '$1') : null;
    return url ? { url } : { none: true };
  } catch (e) { return { none: true }; }
}

const SOURCES = { opensea: fromOpenSea, ens: fromEns, x: fromX };

/** One source, fetched, rendered and kept. */
export async function useSource(address, source, { by = 'self', ens = null } = {}) {
  if (!SOURCES[source]) return { error: 'no such source', status: 400 };
  const found = await (source === 'ens' ? fromEns(address, ens) : SOURCES[source](address));
  if (found.error) return { error: `Could not reach ${source === 'x' ? 'X' : source === 'ens' ? 'ENS' : 'OpenSea'} just now.`, status: 502, retry: found.retry };
  if (found.none || !found.url) return { error: `No ${source === 'x' ? 'X' : source === 'ens' ? 'ENS' : 'OpenSea'} picture for this wallet.`, status: 404 };
  const got = await fetchPicture(found.url);
  if (got.error) return { error: `That picture would not come: ${got.error}.`, status: 502 };
  const made = await render(got.bytes);
  if (made.error) return { error: made.error, status: 422 };
  /* Chosen, so the monthly refresh keeps to this source rather than going
     back to the first one in the order. */
  const rec = await keep(address, made.bytes, { source, src_url: found.url, uploaded_by: by === 'artist' ? 'artist' : null, chosen: true });
  return { ok: true, pfp: said(rec, address) };
}

/* ---------------------------------------------------------------- uploads */

/**
 * The first half of an upload: the picture as sent, made safe (upright,
 * stripped, at most 2000 on a side) and kept for an hour so it can be
 * cropped over. The crop is drawn on this copy, not on the original, so a
 * HEIC a browser cannot display is still something the page can show.
 */
export async function stage(address, bytes, { by = 'self' } = {}) {
  const out = await processImage(bytes);
  if (out.error) return { error: out.error, status: 400 };
  const id = randomBytes(9).toString('hex');
  const key = `pfp/tmp/${id}.jpg`;
  await putObject(key, out.bytes, 'image/jpeg');
  await one('SET', K.tmp(id), JSON.stringify({ key, w: out.w, h: out.h, owner: lower(address), by }), 'EX', '3600');
  return { ok: true, tmp: id, url: `${PUBLIC}/${key}`, w: out.w, h: out.h };
}

/** The second half: that picture, cut where the crop says, and kept. */
export async function save(address, tmpId, crop, { by = 'self' } = {}) {
  const t = parse(await one('GET', K.tmp(String(tmpId || ''))));
  if (!t || t.owner !== lower(address)) return { error: 'That upload has expired. Choose the picture again.', status: 410 };
  const got = await fetchPicture(`${PUBLIC}/${t.key}`);
  if (got.error) return { error: 'That upload could not be read back. Try again.', status: 502 };
  const made = await render(got.bytes, crop);
  if (made.error) return { error: made.error, status: 422 };
  const rec = await keep(address, made.bytes, { source: 'upload', src_url: null, uploaded_by: by === 'artist' ? 'artist' : 'self' });
  await one('DEL', K.tmp(tmpId));
  return { ok: true, pfp: said(rec, address) };
}

/** Back to the placeholder, and chosen: the refresh will not fill it again. */
export async function remove(address, { by = 'self' } = {}) {
  const rec = { address: lower(address), source: 'none', key: null, url: null, chosen: true, by, updated: new Date().toISOString() };
  await pipe([
    ['SET', K.rec(address), JSON.stringify(rec)],
    ['HDEL', K.map, lower(address)],
    ['SADD', K.none, lower(address)],
  ]);
  return { ok: true, pfp: said(rec, address) };
}

/** A light fence round the writes: a face does not change forty times an hour. */
export async function spend(who) {
  const hour = new Date().toISOString().slice(0, 13);
  const [n] = await pipe([['INCR', K.rate(who, hour)], ['EXPIRE', K.rate(who, hour), '3600']]);
  return Number(n) <= 30;
}

/* ---------------------------------------------------------------- the round */

/**
 * Filling the register, a batch at a time, from rank 1 down: the first time
 * through for everybody who has no picture yet, and after that once a month
 * for everybody whose picture came from a source, replacing it only if that
 * source now says something different. An upload is never replaced, and a
 * collector who chose none is never filled.
 */
/* Raised when the round learns to read something it could not before, so a
   backfill that went past people it failed on goes round again from rank 1.
   2: OpenSea's AVIFs, which the first run could not open. */
export const ROUND_V = 2;

export async function round({ rows, batch = 40, pause = 300, now = Date.now(), budget = 0 } = {}) {
  /* A batch that runs slow stops where it is and saves its place, rather than
     being cut off by the platform halfway through a write. */
  const deadline = budget ? Date.now() + budget : 0;
  let job = parse(await one('GET', K.job));
  if (!job || job.v !== ROUND_V) job = { v: ROUND_V, phase: 'backfill', cursor: 0, hits: {}, started: new Date(now).toISOString() };
  if (job.phase === 'idle') {
    if (now < Date.parse(job.next_refresh || 0)) return { ...job, did: 0 };
    Object.assign(job, { phase: 'refresh', cursor: 0, hits: {}, started: new Date(now).toISOString() });
  }
  const order = rows.filter((r) => !r.private && isAddr(r.address)).sort((a, b) => (a.rank || 1e9) - (b.rank || 1e9));
  const slice = order.slice(job.cursor, job.cursor + batch);
  const recs = slice.length ? (await pipe(slice.map((r) => ['GET', K.rec(r.address)]))).map(parse) : [];
  let did = 0;
  let stopped = false;
  let i = 0;
  for (; i < slice.length; i += 1) {
    if (deadline && Date.now() > deadline) { stopped = true; break; }
    const r = slice[i];
    const was = recs[i];
    if (was && (was.source === 'upload' || (was.chosen && was.source === 'none'))) continue;
    if (job.phase === 'backfill' && was && was.source !== 'none') continue;
    let hit = null;
    let limited = false;
    /* A source somebody picked is the only one looked at again. */
    for (const source of (was && was.chosen ? [was.source] : AUTO)) {
      const found = await (source === 'ens' ? fromEns(r.address, r.ens || r.fwd || null) : SOURCES[source](r.address));
      /* OpenSea saying slow down is not OpenSea saying no picture: this
         collector is left exactly as they were, and the batch stops here to
         pick up from them next time. */
      if (found.retry) { limited = true; break; }
      if (found.url) { hit = { source, url: found.url }; break; }
    }
    if (limited) { job.hits.rate_limited = (job.hits.rate_limited || 0) + 1; stopped = true; break; }
    if (hit && !(was && was.source === hit.source && was.src_url === hit.url)) {
      const got = await fetchPicture(hit.url);
      const made = got.bytes ? await render(got.bytes) : null;
      if (made && made.bytes) {
        await keep(r.address, made.bytes, { source: hit.source, src_url: hit.url, uploaded_by: null });
        job.hits[hit.source] = (job.hits[hit.source] || 0) + 1;
      } else {
        /* Found and not readable: counted, and the last few kept with why, so
           a kind of picture this cannot open says what it is. */
        job.hits.unreadable = (job.hits.unreadable || 0) + 1;
        let host = null;
        try { host = new URL(hit.url).host; } catch (e) { /* said as it was */ }
        job.unreadable = [...(job.unreadable || []), { address: r.address, source: hit.source, host,
          type: got.type || null, why: String(got.error || (made && made.error) || 'unknown').slice(0, 80) }].slice(-8);
      }
    } else if (!hit && !was) {
      await one('SET', K.rec(r.address), JSON.stringify({ address: lower(r.address), source: 'none', url: null, updated: new Date(now).toISOString() }));
      job.hits.none = (job.hits.none || 0) + 1;
    } else if (hit) job.hits.unchanged = (job.hits.unchanged || 0) + 1;
    did += 1;
    if (pause) await new Promise((ok) => setTimeout(ok, pause));
  }
  job.cursor += stopped ? i : slice.length;
  if (!stopped && job.cursor >= order.length) {
    Object.assign(job, { phase: 'idle', cursor: 0, finished: new Date(now).toISOString(),
      next_refresh: new Date(now + 30 * 86400000).toISOString() });
  }
  await one('SET', K.job, JSON.stringify(job));
  return { ...job, did, of: order.length };
}

export const ready = () => storeConfigured() && r2Configured();
