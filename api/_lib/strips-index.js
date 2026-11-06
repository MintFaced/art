/* The collection at a glance: every token's still and traits in one list, for
 * the gallery and the collector pages, held in the store and rebuilt when the
 * chain says something changed. And strips-ar.json, the one file the app reads.
 */
import { parseAbi } from 'viem';
import sitesFile from '../../data/strip-sites.json' with { type: 'json' };
import { pipe } from './kv.js';
import { ABI, chain, deployment, read } from './strips.js';
import { attributesOf, traitsOf, DISPLAY_NAMES, RHYTHM_NAMES } from '../../strips-design.js';

export const K = { gallery: 'strips:gallery', cursor: 'strips:cursor', dirty: 'strips:dirty', arDay: 'strips:ar-day', tweeted: (kind, id) => `strips:tweeted:${kind}:${id}` };
const OWNER = parseAbi(['function ownerOf(uint256) view returns (address)']);

/* The same sum as StripsExtension.taoOf, for a list that isn't rebuilt every
   second: the clock keeps running between events, and the figure has to too.
   In TAO, to a tenth. */
const RATE_HELD = 42, RATE_REDEEMED = 690, DAY = 86400;
export function taoNow({ held_since: since, redeemed_at: at }, now = Math.floor(Date.now() / 1000)) {
  const tenths = !at ? Math.floor(((now - since) * RATE_HELD) / DAY)
    : since >= at ? Math.floor(((now - since) * RATE_REDEEMED) / DAY)
      : Math.floor(((at - since) * RATE_HELD + (now - at) * RATE_REDEEMED) / DAY);
  return tenths / 10;
}

async function one(id) {
  const d = deployment();
  const big = BigInt(id);
  /* only ownerOf may fail, and only for a burned token. Anything else is the
     network, and a list with holes in it is worse than no new list. */
  const [t, design, seed, redeemedAt, street, owner] = await Promise.all([
    read.extension('tokenOf', [big]), read.extension('designOf', [big]), read.extension('seedOf', [big]), read.extension('redeemedAt', [big]), read.extension('streetOf', [big]),
    chain().readContract({ address: d.core, abi: OWNER, functionName: 'ownerOf', args: [big] }).catch(() => null),
  ]);
  const word = seed ? `0x${seed.toString(16).padStart(64, '0')}` : '';
  const traits = word ? traitsOf(word) : null;
  return {
    id, owner, design, word, minted: Number(t.mintedAt), held_since: Number(t.heldSince), view: Number(t.viewIndex), redeemed: redeemedAt !== 0n, redeemed_at: Number(redeemedAt),
    no: Number(street.no), site: street.site,
    display: traits ? DISPLAY_NAMES[traits.display] : null, rhythm: traits ? RHYTHM_NAMES[traits.rhythm] : null,
  };
}

/** Every token, street works first. */
export async function allTokens() {
  const last = Number(await read.extension('lastId'));
  const out = [];
  for (let id = 1; id <= last; id += 25) {
    const ids = Array.from({ length: Math.min(25, last - id + 1) }, (_, i) => id + i);
    out.push(...(await Promise.all(ids.map(one))));
  }
  return out.sort((a, b) => (b.no ? 1 : 0) - (a.no ? 1 : 0) || (a.no - b.no) || a.id - b.id);
}

export async function saveGallery(list) {
  await pipe([['SET', K.gallery, JSON.stringify(list)]]);
  return list;
}

export async function readGallery() {
  const [reply] = await pipe([['GET', K.gallery]]);
  const v = reply && typeof reply === 'object' && 'result' in reply ? reply.result : reply;
  return v ? JSON.parse(String(v)) : [];
}

/** strips-ar.json: one row per street work. The app reads this and nothing else. */
export async function arManifest(list) {
  const rows = [];
  for (const t of list.filter((x) => x.no)) {
    const site = sitesFile.sites.find((s) => s.no === t.no) || {};
    const target = await read.extension('arTargetOf', [BigInt(t.id)]).catch(() => null);
    rows.push({
      no: t.no, address: site.address || t.site, lat: site.lat ?? null, lng: site.lng ?? null, token_id: t.id,
      ar_target: target && target.uri ? target.uri : null, installed_cm: target && target.uri ? { w: Number(target.widthCm), h: Number(target.heightCm) } : null,
      design: t.design, word: t.word, minted: t.minted,
      traits: attributesOf(t.design, { word: t.word, no: t.no, site: t.site }),
    });
  }
  return { generated: new Date().toISOString(), rows };
}

/** //STRIPS in the nightly register: every token an edition copy, a 1/1 from
    its redemption. They have no catalogue page, so they say where they live.

    `all` keeps every transfer on the core, listed or not. The run moves its
    cursor past whatever it doesn't keep, and this list can trail the chain, so
    a mint it hasn't caught up with would otherwise never earn. `first_block`
    is where the core's event file starts: there's nothing older to backfill. */
export function addToRegister(tokens, targets, list, { core, first_block: firstBlock }, site) {
  const a = core.toLowerCase();
  if (!list.length) return;
  if (!targets.has(a)) targets.set(a, { std: 'ERC721', tokens: new Set(), all: true, first_block: firstBlock || null });
  for (const t of list) {
    tokens.set(`${a}|${t.id}`, {
      unique: false, work: `strips-${t.id}`, collection: 'strip-paintings', title: `//STRIPS #${t.id}`,
      url: `${site}/c/strip-paintings/strips/${t.id}`, image: `${site}/api/strips/card/${t.id}`,
      ...(t.redeemed_at ? { unique_from: t.redeemed_at } : {}),
    });
    targets.get(a).tokens.add(String(t.id));
  }
}
