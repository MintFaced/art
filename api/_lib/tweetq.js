/* The tweet queue. The queue is the truth; the timeline is the render.
 *
 * Every studio event that should become a tweet is appended here as a
 * self-contained job (the text is already written, the image is a URL to fetch
 * at send time). A worker drains in order and marks each one sent exactly once,
 * so a retry after a crash never double-tweets and a failure never drops an
 * event: it stays at the head and is tried again next run. Late beats lost.
 *
 * This module knows nothing about X — it takes a `post(job)` callback — so it
 * can be tested against a fake poster with no credentials and no network.
 */
import { pipe as realPipe, one as realOne, storeConfigured } from './kv.js';

// The store is injectable so the drain logic can be tested against an in-memory
// fake with no network; production uses the real Upstash client.
const realStore = { pipe: realPipe, one: realOne };

const QUEUE = 'tweet:queue';
const SENT = (id) => `tweet:sent:${id}`;
const SENT_TTL = 60 * 60 * 24 * 45;   // 45 days: long after an event could still be in the queue

export const queueReady = storeConfigured;

/* Append a job. `id` must be stable and unique for the event (a weighing
   signature, a `nudge#N:lock`, a sale txHash) — it is the idempotency key.
   `image` is null, { work } to reuse the work's OG card, or { og } query params
   for the tweet-card variant; the worker turns it into a URL. */
export async function enqueue(job, store = realStore) {
  if (!storeConfigured() || !job || !job.id) return false;
  const row = JSON.stringify({
    id: String(job.id),
    kind: job.kind || 'event',
    text: String(job.text || ''),
    image: job.image || null,
    at: new Date().toISOString(),
  });
  await store.pipe([['RPUSH', QUEUE, row], ['LTRIM', QUEUE, -5000, -1]]);
  return true;
}

/** How many jobs are waiting (for logging / the worker's report). */
export async function depth(store = realStore) {
  if (!storeConfigured()) return 0;
  const [n] = await store.pipe([['LLEN', QUEUE]]);
  return Number(n) || 0;
}

/**
 * Drain up to `limit` jobs in order through `post(job) -> Promise`.
 *
 * Per job: claim `tweet:sent:<id>` with SET NX.
 *   - claim won  -> not yet tweeted: post it; on success drop the head; on
 *     failure UN-mark it, stop, and leave it at the head to retry next run.
 *   - claim lost -> a prior run tweeted it but crashed before removing it:
 *     skip posting and just drop the head. This is the no-double-tweet guard.
 * Stops at the first failure so order is preserved (late beats lost).
 *
 * @returns { sent, skipped, failed, remaining }
 */
export async function drain({ limit = 10, spacingMs = 0, post, store = realStore }) {
  if (!storeConfigured()) return { sent: 0, skipped: 0, failed: 0, remaining: 0, reason: 'no-store' };
  const raw = await store.one('LRANGE', QUEUE, 0, limit - 1);
  const jobs = (raw || []).map((s) => { try { return JSON.parse(s); } catch (e) { return null; } });
  let sent = 0, skipped = 0, failed = 0;
  for (const job of jobs) {
    if (!job || !job.id) { await store.one('LPOP', QUEUE); skipped++; continue; }
    const claim = await store.one('SET', SENT(job.id), '1', 'NX', 'EX', SENT_TTL);
    if (claim === 'OK') {
      try {
        await post(job);
        sent++;
      } catch (err) {
        await store.one('DEL', SENT(job.id));  // let it retry; do not remove from queue
        failed++;
        break;                                  // preserve order: stop at the first failure
      }
    } else {
      skipped++;                                // already tweeted in a prior run
    }
    await store.one('LPOP', QUEUE);             // remove the processed head
    if (spacingMs && sent) await new Promise((r) => setTimeout(r, spacingMs));
  }
  return { sent, skipped, failed, remaining: await depth(store) };
}
