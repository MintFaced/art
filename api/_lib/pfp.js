/* Faces: a hexagon picture for every collector (PFP.md).
 *
 * One picture per wallet, 512×512 webp in R2, from wherever the collector
 * already has one: their own upload, The Line (when PFP_PEER_BASE says where
 * it is), their OpenSea profile, their ENS avatar, their linked X account ...
 * in that order ... and otherwise nothing, which the page draws as their
 * longest-held work, faintly.
 *
 * The making of a face lives in @mintfaced/pfp, which theline.wtf runs too, so
 * one fix lands in both galleries. What is this site's is here: where records
 * and pictures are kept, whose X account is whose, MintFace being one face,
 * and the paper a transparent picture is laid on.
 *
 * EVERY PICTURE IS OURS BEFORE IT IS SHOWN. Fetched server-side, decoded,
 * turned upright, cropped, and written out with no metadata. Nothing is ever
 * hotlinked from OpenSea or X, so nothing on the page tells them who is
 * looking at whom.
 *
 * A PRIVATE COLLECTOR HAS NO FACE HERE. The register already declines to name
 * them; an OpenSea avatar beside "Private collector" would name them anyway.
 * They are skipped by the backfill and answered with nothing.
 */
import {
  createPfp, said, peerSaid, render as renderFace, variantUrl, fetchPicture, isOpenSeaDefault,
  openseaSource, ensSource, ensClient, xSource, peerSource,
} from '@mintfaced/pfp/server';
import { one, pipe, storeConfigured } from './kv.js';
import { putObject, r2Configured } from './r2.js';
import { byWallet, get as getAccount } from './accounts.js';
import artistFile from '../../data/source/artist.json' with { type: 'json' };

export { said, peerSaid, fetchPicture, isOpenSeaDefault };
export const SIZE = 512;
export const PUBLIC = process.env.ASSETS_PUBLIC_BASE || 'https://assets.mintface.art';
const lower = (a) => String(a || '').toLowerCase();
const isAddr = (a) => /^0x[0-9a-f]{40}$/.test(lower(a));
const parse = (v) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch (e) { return null; } };

/* MintFace is one face. The artist speaks from more than one wallet, and a
   picture set on any of them is the picture on all of them: kept once, under
   mintface.eth, and drawn for every artist wallet. */
const ARTIST_WALLETS = Object.entries(artistFile.wallets || {}).filter(([k]) => k.startsWith('0x'))
  .map(([k, v]) => [k.toLowerCase(), v]);
export const ARTIST_FACE = (ARTIST_WALLETS.find(([, v]) => v === 'mintface.eth') || ARTIST_WALLETS[0] || [null])[0];
export const canonical = (address) => (ARTIST_WALLETS.some(([k]) => k === lower(address)) && ARTIST_FACE ? ARTIST_FACE : lower(address));
/** The other artist wallets, each pointed at the one face. */
export const aliases = () => Object.fromEntries(ARTIST_WALLETS.filter(([k]) => k !== ARTIST_FACE).map(([k]) => [k, ARTIST_FACE]));

export const K = {
  rec: (a) => `pfp:${lower(a)}`,
  map: 'pfp:map',
  none: 'pfp:none',
  peer: 'pfp:peer',
  tmp: (id) => `pfp:tmp:${id}`,
  job: 'pfp:job',
  rate: (who, hour) => `pfp:rl:${who}:${hour}`,
};

/* The small copy the register draws, beside the big one. */
export const SMALL = 128;
export const smallOf = (url) => variantUrl(url, SMALL);

/* ---------------------------------------------------------------- the store */

/* Records in the KV store, with the map the register reads (wallet -> picture)
   and the set of those who chose none kept in step; pictures in R2 under
   pfp/<wallet>/<hash>.webp, each small copy as <hash>-<n>.webp beside it. */
const store = {
  get: async (a) => parse(await one('GET', K.rec(a))),
  getMany: async (as) => (await pipe(as.map((a) => ['GET', K.rec(a)]))).map(parse),
  set: async (a, rec) => {
    const cmds = [['SET', K.rec(a), JSON.stringify(rec)]];
    if (rec.url) cmds.push(['HSET', K.map, lower(a), rec.url], ['SREM', K.none, lower(a)]);
    else {
      cmds.push(['HDEL', K.map, lower(a)]);
      if (rec.chosen) cmds.push(['SADD', K.none, lower(a)]);
    }
    /* The faces The Line gave us, kept apart so they are never said back. */
    cmds.push([rec.source === 'peer' ? 'SADD' : 'SREM', K.peer, lower(a)]);
    await pipe(cmds);
  },
  putImage: async (a, { hash, images }) => {
    const key = `pfp/${lower(a)}/${hash}.webp`;
    await Promise.all(Object.entries(images).map(([n, bytes]) => putObject(Number(n) === SIZE ? key : variantUrl(key, Number(n)), bytes, 'image/webp')));
    return { key, url: `${PUBLIC}/${key}` };
  },
  /* An upload waiting to be cropped: the made-safe JPEG in R2, the note of
     whose it is in the store, for an hour. */
  stagePut: async (id, bytes, meta) => {
    const key = `pfp/tmp/${id}.jpg`;
    await putObject(key, bytes, 'image/jpeg');
    await one('SET', K.tmp(id), JSON.stringify({ key, ...meta }), 'EX', '3600');
    return { url: `${PUBLIC}/${key}` };
  },
  stageGet: async (id) => parse(await one('GET', K.tmp(id))),
  stageRead: async (t) => {
    const got = await fetchPicture(`${PUBLIC}/${t.key}`);
    return got.error ? null : got.bytes;
  },
  stageDrop: async (id) => { await one('DEL', K.tmp(id)); },
  getJob: async () => parse(await one('GET', K.job)),
  setJob: async (job) => { await one('SET', K.job, JSON.stringify(job)); },
};

/* ---------------------------------------------------------------- sources */

let CLIENT = null;
export const useChain = (c) => { CLIENT = c; };

export const fromOpenSea = openseaSource();
const ens = ensSource({ client: () => CLIENT || (CLIENT = ensClient()) });
export const fromEns = (address, name = null) => ens(address, { name });
/** The X picture of a verified link. */
export const fromX = xSource(async (address) => {
  const acct = await byWallet(lower(address));
  const a = acct ? await getAccount(acct) : null;
  return a && a.x_avatar ? a.x_avatar : null;
});
/* The Line, asked before OpenSea once PFP_PEER_BASE says where it is. Off
   until The Line answers. */
const PEER = process.env.PFP_PEER_BASE || '';
const fromPeer = PEER ? peerSource({ base: PEER }) : null;

export const AUTO = [...(fromPeer ? ['peer'] : []), 'opensea', 'ens', 'x'];

/* Raised when the round learns to read something it could not before, so a
   backfill that went past people it failed on goes round again from rank 1.
   2: OpenSea's AVIFs, which the first run could not open. */
export const ROUND_V = 2;

const P = createPfp({
  store,
  sources: { ...(fromPeer ? { peer: fromPeer } : {}), opensea: fromOpenSea, ens, x: fromX },
  background: '#faf9f6',
  version: ROUND_V,
});

/* ---------------------------------------------------------------- reading */

export async function record(address) {
  return isAddr(address) ? store.get(canonical(address)) : null;
}

/** Every face at once, for the register: wallet -> picture. */
export async function all() {
  const flat = (await one('HGETALL', K.map)) || [];
  const map = {};
  for (let i = 0; i + 1 < flat.length; i += 2) map[flat[i]] = flat[i + 1];
  return map;
}

/** Every wallet The Line may ask about: a face found or given here, or a
    choice of none. Not a face The Line gave us. */
export async function peerList() {
  const [keys, none, peer] = await pipe([['HKEYS', K.map], ['SMEMBERS', K.none], ['SMEMBERS', K.peer]]);
  const skip = new Set(peer || []);
  return [...new Set([...(keys || []), ...(none || [])])].filter((a) => !skip.has(a));
}

/* ---------------------------------------------------------------- changing one */

/** A picture cut where the crop says, as a 512 webp on this site's paper. */
export const render = (bytes, crop = null) => renderFace(bytes, crop, { background: '#faf9f6' });

export const useSource = P.useSource;
export const stage = P.stage;
export const save = P.save;
export const remove = P.remove;

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
export const round = P.round;

export const ready = () => storeConfigured() && r2Configured();
