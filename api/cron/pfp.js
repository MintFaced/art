/* Faces for the register (PFP.md), a batch at a time.
 *
 * Every ten minutes, eighty collectors from wherever the last batch stopped,
 * rank 1 first so the top of the register fills first: OpenSea, then ENS, then
 * X, and the first picture found is fetched, made ours and kept. When the whole
 * register has been through once the job waits a month and goes round again,
 * replacing a picture only where its source now says something different. An
 * upload is never replaced; somebody who chose no picture is never given one.
 *
 * The log is the job's own record: hits per source, and where it is up to.
 */
import { round, ready } from '../_lib/pfp.js';

/* A little under three requests a second to OpenSea at most, and the whole
   register in about eight hours. Four minutes of work in a five-minute
   function: whatever is left is picked up ten minutes later. */

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (!secret) {
    if (process.env.VERCEL_ENV === 'production') return new Response('cron secret is not set', { status: 503 });
  } else if (auth !== `Bearer ${secret}`) {
    return new Response('no', { status: 401 });
  }
  if (!ready()) return new Response(JSON.stringify({ skipped: 'no store or no bucket' }), { status: 200 });
  const site = process.env.SITE_ORIGIN || 'https://mintface.art';
  const reg = await fetch(`${site}/data/collectors-register.json`).then((r) => r.json());
  const f = (k) => reg.fields.indexOf(k);
  const rows = reg.rows.map((r) => ({ address: r[f('address')], ens: r[f('ens')] || null, fwd: f('fwd') >= 0 ? r[f('fwd')] || null : null,
    private: Boolean(r[f('private')]), rank: r[f('rank')] }));
  const out = await round({ rows, batch: 80, pause: 350, budget: 240000 });
  console.log('pfp:', out.phase, `${out.cursor}/${out.of}`, JSON.stringify(out.hits));
  return new Response(JSON.stringify(out, null, 1), { status: 200, headers: { 'content-type': 'application/json' } });
}
