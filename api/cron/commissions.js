/* Every minute: the commissions that are waiting on something.
 *
 *   ETH that arrived for an order (the watcher, in api/_lib/commissions.js)
 *   the one nudge, an hour after ETH was chosen and nothing has come
 *   quotes that have lapsed, marked expired
 *
 * Asks the chain only while an order is waiting on ETH, so a quiet week costs
 * nothing but a read of an empty set.
 */
import { watchEth, listOrders, nudgeEth, getOrder, commissionsConfigured } from '../_lib/commissions.js';

const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });

export async function GET(request) {
  const auth = request.headers.get('authorization');
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) return json({ error: 'unauthorised' }, 401);
  if (!process.env.CRON_SECRET && process.env.VERCEL_ENV === 'production') return json({ error: 'CRON_SECRET is not set' }, 503);
  if (!commissionsConfigured()) return json({ skipped: 'no store' });

  const out = { eth: null, nudged: [], expired: [] };
  try { out.eth = await watchEth(); } catch (e) { out.eth = { error: e.message }; }

  for (const o of await listOrders({ status: 'pending_payment' })) {
    const fresh = await getOrder(o.id); // writes the lapse when it has happened
    if (!fresh) continue;
    if (fresh.status === 'expired') { out.expired.push(o.id); continue; }
    if (await nudgeEth(fresh)) out.nudged.push(o.id);
  }
  return json(out);
}
