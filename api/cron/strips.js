/* Every minute: what the chain has said about //STRIPS since last time.
 *
 *   a word landed   tweet MINTED with its traits, the still as the card, and
 *                   ask OpenSea to read the token again
 *   a redemption    tweet REDEEMED
 *   anything moved  rebuild the gallery the site reads
 *   once a day      rebuild strips-ar.json for the app
 *
 * Three steps, cheapest first, because Vercel stops this at 60 seconds and saves
 * nothing for it. Reading the logs only writes down what's to do, and the cursor
 * moves with the list. The gallery comes next, so a rush can't keep it stale. The
 * slow work, X and OpenSea, runs last from that list, for as long as the budget
 * allows, and the rest waits for the next run.
 *
 * A word read while the mint is closed isn't tweeted, then or later: mint 1 is
 * checked in private, and street works go in before the public opens. The mint's
 * state is read at the scan, not at the word's own block, so a run that falls
 * behind across an open or a close can land either side of it.
 *
 * A tweet that fails waits its turn, and so does everything behind it while X
 * won't take the keys or X_BOT_PAUSED is set. One X will never take is dropped.
 * Each tweet is marked once sent. If an answer is lost the tweet goes again, and
 * X refuses the same words twice, which counts as sent.
 *
 * One run at a time. Trouble with the gallery or the manifest is reported, and
 * the list still gets its turn.
 */
import { parseAbiItem } from 'viem';
import { pipe, storeConfigured } from '../_lib/kv.js';
import { chain, deployed, deployment, read } from '../_lib/strips.js';
import { allTokens, arManifest, K, saveGallery } from '../_lib/strips-index.js';
import { cardPNG, refreshOpenSea } from '../_lib/strips-token.js';
import { putObject, r2Configured } from '../_lib/r2.js';
import { tweet, uploadMedia, xPaused } from '../_lib/x.js';
import { attributesOf } from '../../strips-design.js';

const SEEDED = parseAbiItem('event Seeded(uint256 indexed id, uint256 indexed requestId, uint256 word)');
const REDEEMED = parseAbiItem('event Redeemed(uint256 indexed id, uint256 viewIndex)');
const VIEW = parseAbiItem('event ViewChanged(uint256 indexed id, uint8 viewIndex)');
const TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)');
const SPAN = 2000n;
/* Vercel stops this at 60 seconds. The gap is for a job already started. */
const BUDGET_MS = 40_000;
const CALL_MS = 12_000;
const SAVE_EVERY = 10;
const REFRESH_TRIES = 3;
/* Past the longest a run can last, so a killed run can't hold the next one off for long. */
const LOCK_SECONDS = 70;
/* A provider a block or two behind mustn't leave the cursor past a word it never saw. */
const SAFE_DEPTH = 3n;

const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
const value = (reply) => (reply && typeof reply === 'object' && 'result' in reply ? reply.result : reply);

/** The words a mint tweet says: MINTED · //STRIPS #212 · OLED · HAYWIRE */
export function mintedLine(id, word, design) {
  const a = attributesOf(design, { word });
  const of = (k) => (a.find((x) => x.trait_type === k) || {}).value || '';
  return `MINTED · //STRIPS #${id} · ${of('Display')} · ${of('Rhythm').toUpperCase()}`;
}

const card = async (design) => uploadMedia(await cardPNG(design), 'image/png');

/* X and OpenSea are other people's servers, and a hung one would take the run with it */
const within = (ms, work) => {
  const stop = new AbortController();
  let timer;
  const late = new Promise((_, no) => { timer = setTimeout(() => { stop.abort(); no(new Error(`nothing back in ${ms} ms`)); }, ms); });
  return Promise.race([work(stop.signal), late]).finally(() => clearTimeout(timer));
};

/* once only, marked after it has really gone. Throws if it's worth trying again. */
async function once(kind, id, text, design, deps) {
  const key = K.tweeted(kind, id);
  if (value((await pipe([['GET', key]]))[0])) return false;
  const wait = deps.timeout ?? CALL_MS;
  const media = await within(wait, () => deps.card(design)).then((m) => [m]).catch(() => []);
  try {
    await within(wait, (signal) => deps.tweet(text, media, signal));
  } catch (e) {
    console.error('strips: tweet failed', kind, id, e.message);
    if (e.duplicate) { await pipe([['SET', key, '1']]); return false; }
    if (e.retryable !== false || e.credentials) throw e;
    await pipe([['SET', key, 'refused']]);
    return false;
  }
  await pipe([['SET', key, '1']]);
  return true;
}

/* One job off the list. What comes back goes on the list again. */
async function work(job, deps, x, out) {
  if (job.kind === 'refresh') {
    const asked = await (deps.refresh || refreshOpenSea)(job.id);
    const tries = (job.tries || 0) + 1;
    return asked === false && tries < REFRESH_TRIES ? { ...job, tries } : null;
  }
  /* X has already said no this run, or we've said no to X, and tweets go out in order */
  if (x.down) return job;
  /* a job that can't be read stays on the list and holds nothing else up */
  const design = await read.extension('designOf', [BigInt(job.id)]).catch((e) => { out.failed.push(`job ${job.id}: ${e.shortMessage || e.message}`); return null; });
  if (!design) return job;
  const text = job.kind === 'minted' ? mintedLine(job.id, job.word, design) : `REDEEMED · //STRIPS #${job.id}`;
  try {
    if (await once(job.kind, job.id, text, design, deps)) out.tweets += 1;
    return null;
  } catch (e) {
    x.down = true;
    if (e.credentials) out.failed.push(`x refused the keys: ${e.message}`);
    return job;
  }
}

/** One run at a time. `deps` is for the tests, which keep their tweets to themselves. */
export async function run(deps = { tweet, card }) {
  const [got] = await pipe([['SET', K.lock, '1', 'NX', 'EX', String(LOCK_SECONDS)]]);
  if (value(got) !== 'OK') return { skipped: 'another run is going' };
  try { return await pass(deps); } finally { await pipe([['DEL', K.lock]]).catch(() => {}); }
}

async function pass(deps) {
  const started = Date.now();
  const spent = () => Date.now() - started >= (deps.budget ?? BUDGET_MS);
  const d = deployment();
  const head = (await chain().getBlockNumber({ cacheTime: 0 })) - (deps.depth ?? SAFE_DEPTH);
  const saved = value((await pipe([['GET', K.cursor]]))[0]);
  let from = saved ? BigInt(saved) + 1n : BigInt(d.first_block || 0);
  const out = { from: String(from), to: String(head), tweets: 0, later: 0, rebuilt: false, ar: false, failed: [] };

  /* what's to do, and where the cursor is, go down together */
  const jobs = JSON.parse(value((await pipe([['GET', K.later]]))[0]) || '[]');
  const open = await read.extension('mintOpen');
  while (from <= head && !spent()) {
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
      if (open) jobs.push({ kind: 'minted', id, word: `0x${l.args.word.toString(16).padStart(64, '0')}` });
      jobs.push({ kind: 'refresh', id });
    }
    for (const l of redeemed) jobs.push({ kind: 'redeemed', id: Number(l.args.id) });
    const dirty = seeded.length || redeemed.length || views.length || moved.length ? [['SET', K.dirty, '1']] : [];
    await pipe([...dirty, ['SET', K.later, JSON.stringify(jobs)], ['SET', K.cursor, String(to)]]);
    from = to + 1n;
  }

  /* Either of these can fail on its own and try again next run. Neither holds up the list. */
  let list = null;
  try {
    list = value((await pipe([['GET', K.dirty]]))[0]) ? await saveGallery(await (deps.tokens || allTokens)()) : null;
    if (list) await pipe([['DEL', K.dirty]]);
    out.rebuilt = Boolean(list);
  } catch (e) { out.failed.push(`gallery: ${e.shortMessage || e.message}`); }

  const day = new Date().toISOString().slice(0, 10);
  try {
    if (value((await pipe([['GET', K.arDay]]))[0]) !== day) {
      const manifest = await arManifest(list || await (deps.tokens || allTokens)());
      if (deps.publish) await deps.publish(manifest);
      else if (r2Configured()) await putObject('app/strips-ar.json', Buffer.from(JSON.stringify(manifest)), 'application/json');
      await pipe([['SET', K.arDay, day]]);
      out.ar = true;
    }
  } catch (e) { out.failed.push(`manifest: ${e.shortMessage || e.message}`); }

  /* the slow work, from the list, saved as it goes */
  const x = { down: xPaused() };
  const kept = [];
  let done = 0;
  const save = () => pipe([['SET', K.later, JSON.stringify([...kept, ...jobs.slice(done)])]]);
  while (done < jobs.length && !spent()) {
    const again = await work(jobs[done], deps, x, out);
    done += 1;
    if (again) kept.push(again);
    if (done % SAVE_EVERY === 0) await save();
  }
  if (jobs.length) await save();
  out.later = kept.length + jobs.length - done;
  for (const f of out.failed) console.error('strips:', f);
  return out;
}

export async function GET(request) {
  const auth = request.headers.get('authorization');
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) return json({ error: 'unauthorised' }, 401);
  if (!process.env.CRON_SECRET && process.env.VERCEL_ENV === 'production') return json({ error: 'CRON_SECRET is not set' }, 503);
  if (!deployed()) return json({ skipped: 'not deployed' });
  if (!storeConfigured()) return json({ skipped: 'no store' });
  try {
    const out = await run();
    return json(out, out.failed && out.failed.length ? 500 : 200);
  } catch (e) { return json({ error: e.message }, 500); }
}
