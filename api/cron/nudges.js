import { readFile, writeFile } from '../_lib/repo.js';
import { kindOf, CANDIDATES } from '../_lib/nudges.js';
import { bankingContext, bankNudge } from '../_lib/banking.js';
import { enqueue, slotsRow } from '../_lib/wire.js';
import { seriesState } from '../_lib/palette.js';

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

  const ctx = await bankingContext(at);
  const file = await readFile('data/nudges.json');
  const store = JSON.parse(file.text);
  const dropped = [];

  const now = Date.now();
  const banked = [];
  for (const n of store.nudges || []) {
    if (n.banked || n.published === false) continue;
    if (new Date(n.closes).getTime() > now) continue;
    /* A yes or a no keeps one weighing per wallet; a board of colours folds
       every row a wallet ever signed. Taking the latest on a board throws away
       every colour but the last one touched, which on nudge #1 was the whole
       difference between a colour locking and nothing locking at all. */
    /* A nudge with candidates banks a colour, or banks the fact that no colour
       reached the threshold. Both are records and the second is not a failure:
       the studio undertook to paint what locked, and a lock that would have
       been carried by three people or by one wallet's holding is not the thing
       that was promised.

       No decision is passed: at the close date the thresholds decide, which is
       the normal path. The artist's own lock comes through the console and the
       same function, and says so on the card. */
    const out = await bankNudge(n, ctx, null, dropped);
    n.banked = out.banked;
    /* The same event the console raises when it closes one early, from the
       other path that closes them. One kind of thing happened, so one kind of
       event goes out, and the feed cannot tell which hand did it ... which is
       right, because the card already says. */
    if (out.banked.locked) {
      const arc = seriesState(store);
      await enqueue('nudge-lock', {
        number: n.number, hex: out.banked.locked.hex, total: out.banked.locked.total,
        voters: out.banked.locked.voters, slot: n.slot || null, slots: (arc && arc.slots) || 12,
        locked_by: out.banked.locked_by, met: out.banked.met, rule: out.banked.rule,
        slots_row: slotsRow(arc),
      });
    }
    if (kindOf(n) === CANDIDATES) {
      banked.push(`#${n.number} ${out.p.locked ? `locked ${out.p.locked.hex}` : 'no colour locked'}`
        + ` ... ${Math.round(out.p.total)} TAO across ${out.p.collectors}`);
    } else {
      banked.push(`#${n.number} ${out.t.result} ... ${Math.round(out.t.total)} TAO across ${out.t.collectors}`);
    }
  }

  if (banked.length && !dry) {
    await writeFile('data/nudges.json', JSON.stringify(store, null, 1) + '\n',
      `Nudges: banked ${banked.length}`, file.sha);
  }
  const summary = `nudges: ${banked.length} banked`
    + (dropped.length ? `, ${dropped.length} delegation${dropped.length === 1 ? '' : 's'} clamped` : '');
  console.log(summary, banked.join('; '), dropped.join('; '));
  return new Response(JSON.stringify({ summary, banked, dropped, dry }, null, 1),
    { status: 200, headers: { 'content-type': 'application/json' } });
}
