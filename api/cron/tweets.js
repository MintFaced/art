/* The worker that drains the tweet queue to X.
 *
 * Runs on a schedule (and can be hand-triggered with WARM_KEY for the
 * acceptance). It tweets nothing unless it is Production with credentials
 * present, so a preview deploy or a local run is silent by construction. A
 * single env flag, TWEETS_PAUSED=1, stops the drain for the day something
 * misfires publicly — the queue keeps filling, and clearing the flag resumes it
 * in order.
 */
import { drain, depth } from '../_lib/tweetq.js';
import { canTweet, uploadMedia, tweet, deleteTweet } from '../_lib/x.js';
import { one, storeConfigured } from '../_lib/kv.js';
import { readFile, repoConfigured } from '../_lib/repo.js';
import { isOpen } from '../_lib/nudges.js';
import * as wire from '../_lib/tweet-events.js';

const ORIGIN = 'https://mintface.art';           // where the OG images are rendered
const json = (b, s = 200) => new Response(JSON.stringify(b), {
  status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

// Turn a job's image spec into an OG URL, or null for a text-only tweet.
function imageUrl(image) {
  if (!image) return null;
  if (image.work) return `${ORIGIN}/api/og?work=${encodeURIComponent(image.work)}`;
  if (image.og) return `${ORIGIN}/api/og?${image.og}`;
  return null;
}

// Post one job: render + upload its image (if any), then tweet.
async function post(job) {
  let mediaIds = [];
  const url = imageUrl(job.image);
  if (url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`image render failed (${r.status}) for ${url}`);
    const bytes = Buffer.from(await r.arrayBuffer());
    mediaIds = [await uploadMedia(bytes, 'image/png')];
  }
  await tweet(job.text, mediaIds);
}

/* A nudge opens by the clock — no write fires — so we notice the transition
   here. Each open is claimed once (SET NX, no expiry: a nudge opens once). On
   `seed`, the claims are taken WITHOUT tweeting, so a launch does not backfill
   every nudge already open: only the ones that open afterwards reach the feed. */
async function scanOpens({ seed = false } = {}) {
  if (!storeConfigured() || !repoConfigured()) return { opened: 0, seeded: 0 };
  let store;
  try { store = JSON.parse((await readFile('data/nudges.json')).text); }
  catch (e) { return { opened: 0, seeded: 0, error: 'no nudges' }; }
  let opened = 0, seeded = 0;
  for (const n of store.nudges || []) {
    if (n.banked || n.published === false || !isOpen(n)) continue;
    const claim = await one('SET', `tweet:opened:${n.id}`, '1', 'NX');
    if (claim !== 'OK') continue;              // already announced (or seeded)
    if (seed) { seeded++; continue; }
    await wire.open({ n, slot: n.number }).catch(() => {});
    opened++;
  }
  return { opened, seeded };
}

export async function GET(request) {
  // ---- auth: the cron secret, or WARM_KEY for a manual hand-drain ----
  const secret = process.env.CRON_SECRET;
  const warm = process.env.WARM_KEY;
  const auth = request.headers.get('authorization') || '';
  const allowed = [secret, warm].filter(Boolean).map((s) => `Bearer ${s}`);
  if (allowed.length) {
    if (!allowed.includes(auth)) return json({ error: 'unauthorized' }, 401);
  } else if (process.env.VERCEL_ENV === 'production') {
    return json({ error: 'no cron secret set' }, 503);   // fail closed in prod
  }

  const params = new URL(request.url).searchParams;

  // ---- acceptance self-test: prove the pipe with one throwaway tweet, then
  // delete it. Manual only (WARM_KEY), Production-with-credentials only. ----
  if (params.get('selftest') === '1') {
    if (!canTweet()) return json({ selftest: 'skipped', reason: 'not production or no credentials' });
    try {
      const stamp = new Date().toISOString();
      const { id } = await tweet(`studio wire ... pipe check ${stamp} ... this tweet deletes itself`);
      const del = await deleteTweet(id);
      return json({ selftest: 'ok', posted: id, deleted: del.deleted });
    } catch (err) {
      return json({ selftest: 'failed', error: String(err && err.message || err) }, 502);
    }
  }

  // ---- one-time launch seed: claim every currently-open nudge without tweeting
  // it, so the feed does not backfill. Run once (WARM_KEY) before going live. ----
  if (params.get('seed') === '1') {
    return json({ seeded: await scanOpens({ seed: true }) });
  }

  // ---- kill switch: pause the drain, keep the queue ----
  if (process.env.TWEETS_PAUSED === '1') {
    return json({ paused: true, remaining: await depth() });
  }

  // ---- silent everywhere but Production-with-credentials ----
  if (!canTweet()) {
    return json({ skipped: 'not production or no credentials', env: process.env.VERCEL_ENV || null, remaining: await depth() });
  }

  /* Ships dormant. Deploying the bot must not, by itself, start a feed: the
     first automatic run would otherwise notice every already-open nudge and
     tweet them all at once, which is exactly the backfill the spec forbids. So
     the wire only goes live when TWEETS_LIVE=1 is set — after the launch has
     seeded the open nudges and proven the pipe. selftest and seed above ignore
     this flag because they are manual and safe. */
  if (process.env.TWEETS_LIVE !== '1') {
    return json({ dormant: true, hint: 'set TWEETS_LIVE=1 after seeding to go live', remaining: await depth() });
  }

  // Notice any nudge that has just opened, then drain. Free-tier friendly: a
  // small batch with spacing, in order. Late beats lost.
  const opens = await scanOpens();
  const result = await drain({ limit: 8, spacingMs: 1500, post });
  return json({ ...result, opens });
}
