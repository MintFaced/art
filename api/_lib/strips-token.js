/* One //STRIPS token, read off the chain. */
import { parseAbiItem } from 'viem';
import { deployed, deployment, read, chain, ABI } from './strips.js';
import { attributesOf, stillSVG, decodeDesign } from '../../strips-design.js';

const STORY = parseAbiItem('event Story(uint256 indexed id, address indexed author, string text)');
const CREATOR_STORY = parseAbiItem('event CreatorStory(uint256 indexed id, string text)');

/** A token's stories, oldest first, from the event log. Ryan can hide one on
    the site, and the chain keeps it either way. */
export async function storiesFor(id) {
  const d = deployment();
  const range = { address: d.extension, args: { id: BigInt(id) }, fromBlock: BigInt(d.first_block || 0), toBlock: 'latest' };
  const [theirs, ours] = await Promise.all([
    chain().getLogs({ ...range, event: STORY }).catch(() => []),
    chain().getLogs({ ...range, event: CREATOR_STORY }).catch(() => []),
  ]);
  const at = (l) => [Number(l.blockNumber), l.logIndex];
  return [...theirs.map((l) => ({ by: l.args.author, text: l.args.text, at: at(l), tx: l.transactionHash })),
    ...ours.map((l) => ({ by: 'MintFace', text: l.args.text, at: at(l), tx: l.transactionHash }))]
    .sort((a, b) => a.at[0] - b.at[0] || a.at[1] - b.at[1]);
}

/** Ask OpenSea to read a token again. The core has no ERC-4906, so nothing else
    tells a marketplace a word has landed or a view has changed. */
export async function refreshOpenSea(id) {
  const key = process.env.OPENSEA_API_KEY;
  if (!deployed() || !key) return false;
  const r = await fetch(`https://api.opensea.io/api/v2/chain/ethereum/contract/${deployment().core}/nfts/${id}/refresh`, { method: 'POST', headers: { 'x-api-key': key }, signal: AbortSignal.timeout(6000) }).catch(() => null);
  return Boolean(r && r.ok);
}

/** The strips a token paints as, at its own width, for a redemption order. */
export function stripsOfToken(hex) {
  const d = decodeDesign(hex);
  const units = d.bands.reduce((n, b) => n + b.u, 0);
  const mm = (d.width * 10) / units;
  return d.bands.map((b) => ({ hex: b.hex, mm: +(b.u * mm).toFixed(2) }));
}

/** A token's still as PNG bytes, for X. sharp loads here rather than at the
    top of the file so the routes that never draw don't pay for it. */
export async function cardPNG(hex) {
  const { stripPNG } = await import('./strip-png.js');
  const d = decodeDesign(hex);
  return stripPNG({ length_cm: d.length, width_cm: d.width, orientation: d.portrait ? 'portrait' : 'landscape', strips: stripsOfToken(hex) });
}

export async function tokenFor(id) {
  if (!deployed() || !Number.isInteger(id) || id < 1) return null;
  const d = deployment();
  let t;
  try { t = await read.extension('tokenOf', [BigInt(id)]); } catch { return null; }
  if (!t || !t.mintedAt) return null;
  const big = BigInt(id);
  const [design, seed, redeemedAt, photos, street, tao, owner, stories] = await Promise.all([
    read.extension('designOf', [big]), read.extension('seedOf', [big]), read.extension('redeemedAt', [big]),
    read.extension('photosOf', [big]), read.extension('streetOf', [big]), read.extension('taoOf', [big]),
    chain().readContract({ address: d.core, abi: ABI, functionName: 'ownerOf', args: [big] }).catch(() => null),
    storiesFor(id),
  ]);
  const word = seed ? `0x${seed.toString(16).padStart(64, '0')}` : '';
  const redeemed = redeemedAt !== 0n;
  const no = Number(street.no);
  return {
    id, owner, design, word, minted: Number(t.mintedAt), held_since: Number(t.heldSince), view: Number(t.viewIndex),
    photos, redeemed, redeemed_at: Number(redeemedAt), no, site: street.site, tao: Number(tao) / 10, stories,
    still: stillSVG(design),
    attributes: attributesOf(design, { word, redeemed, no, site: street.site }),
    core: d.core, extension: d.extension,
  };
}
