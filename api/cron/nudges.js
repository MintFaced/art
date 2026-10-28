import { readFile } from '../_lib/repo.js';
import { bankingContext, closeDue, dueAt, lockEvent } from '../_lib/banking.js';
import { enqueue, slotsRow } from '../_lib/wire.js';
import { seriesState } from '../_lib/palette.js';
import { saveNudges, logAct, PATH } from '../_lib/nudge-file.js';

/* Banking a nudge.
 *
 * At the close date the tally stops being a live reading and becomes a record.
 * The clamp is applied one last time here, against the TAO each collector
 * actually holds at close: someone who weighed a hundred thousand and then
 * sold down banks only what they still hold. Weigh what you hold, hold what
 * you weighed.
 *
 * Banked figures are frozen into the nudge, so the record never moves again
 * however the register changes afterwards.
 *
 * AND THE SAME CLAMP FALLS ON A REVOKED DELEGATION. This is the third and last
 * moment the COMBO is read against the chain. A vault that has left a COMBO
 * since the weighing, or sold down, weighs nothing here ... which is not a
 * punishment and not a special case: it is the identical rule the whole board
 * runs on, which is that you bank what you still hold at the close. A vault
 * you no longer speak for is TAO you no longer hold.
 */
export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (!secret) {
    if (process.env.VERCEL_ENV === 'production') return new Response('cron secret is not set', { status: 503 });
  } else if (auth !== `Bearer ${secret}`) {
    return new Response('no', { status: 401 });
  }
  const dry = new URL(request.url).searchParams.get('dry') === '1';
  const site = process.env.SITE_ORIGIN || 'https://mintface.art';
  const at = async (p) => (await fetch(`${site}/${p}`, { headers: { accept: 'application/json' } })).json();

  /* HOURLY, AT FIVE PAST. It ran once a day at 22:00 UTC, which banked a
     nudge that closed at 1pm in Hastings at 11am the next day ... and in the
     twenty-two hours between, the board said closed while nothing had been
     decided. Every hour is the close within the hour, in either daylight, and
     an hour with nothing due reads one file and stops. */
  const file = await readFile(PATH);
  const store = JSON.parse(file.text);
  const now = new Date();
  if (!dueAt(store, now).length) {
    return new Response(JSON.stringify({ summary: 'nudges: nothing due', banked: [], dry }, null, 1),
      { status: 200, headers: { 'content-type': 'application/json' } });
  }

  const ctx = await bankingContext(at);
  const dropped = [];
  const done = await closeDue(store, ctx, { now, dropped });
  const banked = done.filter((d) => !d.held);

  if (banked.length && !dry) {
    await saveNudges(store, `Nudges: banked ${banked.map((d) => `#${d.n.number}${d.banked.locked ? ` ${d.banked.locked.hex}` : ''}`).join(', ')}`, file.sha);
    const arc = seriesState(store);
    for (const d of banked) {
      /* The same event the console raises when it locks one, from the other
         path that locks them, and claimed once for the nudge: whichever hand
         gets there first is the tweet. */
      if (d.banked.locked) {
        await enqueue('nudge-lock', lockEvent(d.n, d.banked, arc, slotsRow), { once: `${d.n.id}:lock` });
      }
    }
  }
  if (!dry) {
    for (const d of done) {
      /* A held nudge is seen again every hour until the artist settles it, and
         says so once: the first hour after its close. */
      if (d.held && now.getTime() - new Date(d.n.closes).getTime() > 3600 * 1000) continue;
      await logAct({ act: d.held ? 'hold' : 'close', nudge: d.n.id, number: d.n.number, by: 'close job', line: d.why });
    }
  }
  const summary = `nudges: ${banked.length} banked`
    + (done.length > banked.length ? `, ${done.length - banked.length} waiting on the artist` : '')
    + (dropped.length ? `, ${dropped.length} delegation${dropped.length === 1 ? '' : 's'} clamped` : '');
  console.log(summary, done.map((d) => d.why).join('; '), dropped.join('; '));
  return new Response(JSON.stringify({ summary, banked: done.map((d) => d.why), dropped, dry }, null, 1),
    { status: 200, headers: { 'content-type': 'application/json' } });
}
