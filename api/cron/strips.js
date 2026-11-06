/* Every minute: what the chain has said about //STRIPS since last time.
 *
 *   a word landed   tweet MINTED with its traits, the still as the card
 *   a redemption    tweet REDEEMED
 *   anything moved  rebuild the gallery the site reads
 *   once a day      rebuild strips-ar.json for the app
 *
 * The cursor only moves past what's been dealt with, and each tweet is marked
 * once sent, so a failed run picks up where it stopped and nothing posts twice.
 */
import { parseAbiItem } from 'viem';
import { pipe, storeConfigured } from '../_lib/kv.js';
import { chain, deployed, deployment, read } from '../_lib/strips.js';
import { allTokens, arManifest, K, saveGallery } from '../_lib/strips-index.js';
import { cardPNG } from '../_lib/strips-token.js';
import { putObject, r2Configured } from '../_lib/r2.js';
import { tweet, uploadMedia } from '../_lib/x.js';
import { attributesOf } from '../../strips-design.js';

const SEEDED = parseAbiItem('event Seeded(uint256 indexed id, uint256 indexed requestId, uint256 word)');
const REDEEMED = parseAbiItem('event Redeemed(uint256 indexed id, uint256 viewIndex)');
const VIEW = parseAbiItem('event ViewChanged(uint256 indexed id, uint8 viewIndex)');
const TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)');
const SPAN = 2000n;

const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
const value = (reply) => (reply && typeof reply === 'object' && 'result' in reply ? reply.result : reply);

/** The words a mint tweet says: MINTED · //STRIPS #212 · OLED · HAYWIRE */
export function mintedLine(id, word, design) {
  const a = attributesOf(design, { word });
  const of = (k) => (a.find((x) => x.trait_type === k) || {}).value || '';
  return `MINTED · //STRIPS #${id} · ${of('Display')} · ${of('Rhythm').toUpperCase()}`;
}

const card = async (design) => uploadMedia(await cardPNG(design), 'image/png');

/* once only, marked after it has really gone */
async function once(kind, id, text, design, deps) {
  const key = K.tweeted(kind, id);
  if (value((await pipe([['GET', key]]))[0])) return false;
  const media = await deps.card(design).then((m) => [m]).catch(() => []);
  await deps.tweet(text, media);
  await pipe([['SET', key, '1']]);
  return true;
}

/** One pass. `deps` is for the tests, which keep their tweets to themselves. */
export async function run(deps = { tweet, card }) {
  const d = deployment();
  const head = await chain().getBlockNumber({ cacheTime: 0 });
  const saved = value((await pipe([['GET', K.cursor]]))[0]);
  let from = saved ? BigInt(saved) + 1n : BigInt(d.first_block || 0);
  const out = { from: String(from), to: String(head), tweets: 0, rebuilt: false, ar: false };
  while (from <= head) {
    const to = from + SPAN > head ? head : from + SPAN;
    const range = { fromBlock: from, toBlock: to };
    const [seeded, redeemed, views, moved] = await Promise.all([
      chain().getLogs({ address: d.extension, event: SEEDED, ...range }),
      chain().getLogs({ address: d.extension, event: REDEEMED, ...range }),
      chain().getLogs({ address: d.extension, event: VIEW, ...range }),
      chain().getLogs({ address: d.core, event: TRANSFER, ...range }),
    ]);
    for (const l of seeded) {
      const id = Number(l.args.id);
      const design = await read.extension('designOf', [BigInt(id)]);
      const word = `0x${l.args.word.toString(16).padStart(64, '0')}`;
      if (await once('minted', id, mintedLine(id, word, design), design, deps)) out.tweets += 1;
    }
    for (const l of redeemed) {
      const id = Number(l.args.id);
      const design = await read.extension('designOf', [BigInt(id)]);
      if (await once('redeemed', id, `REDEEMED · //STRIPS #${id}`, design, deps)) out.tweets += 1;
    }
    /* the note goes down before the cursor moves, so a rebuild that fails
       below is tried again next minute rather than waiting for the next event */
    if (seeded.length || redeemed.length || views.length || moved.length) await pipe([['SET', K.dirty, '1']]);
    await pipe([['SET', K.cursor, String(to)]]);
    from = to + 1n;
  }
  const list = value((await pipe([['GET', K.dirty]]))[0]) ? await saveGallery(await allTokens()) : null;
  if (list) await pipe([['DEL', K.dirty]]);
  out.rebuilt = Boolean(list);

  const day = new Date().toISOString().slice(0, 10);
  if (value((await pipe([['GET', K.arDay]]))[0]) !== day) {
    const manifest = await arManifest(list || await allTokens());
    if (deps.publish) await deps.publish(manifest);
    else if (r2Configured()) await putObject('app/strips-ar.json', Buffer.from(JSON.stringify(manifest)), 'application/json');
    await pipe([['SET', K.arDay, day]]);
    out.ar = true;
  }
  return out;
}

export async function GET(request) {
  const auth = request.headers.get('authorization');
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) return json({ error: 'unauthorised' }, 401);
  if (!process.env.CRON_SECRET && process.env.VERCEL_ENV === 'production') return json({ error: 'CRON_SECRET is not set' }, 503);
  if (!deployed()) return json({ skipped: 'not deployed' });
  if (!storeConfigured()) return json({ skipped: 'no store' });
  try { return json(await run()); } catch (e) { return json({ error: e.message }, 500); }
}
