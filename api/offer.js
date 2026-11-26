/* /api/offer: a private offer, from the buyer's side. Every call shows the key
 * from the link (#k=), so only the person it was made for gets anywhere.
 *
 * GET  ?id=OF-2026-0001   (header x-offer-key)   the offer: the work, the
 *                          amount, the buyer's name, the state. No email.
 *                          403 for a wrong or missing key, 410 once it has
 *                          ended (expired or cancelled).
 * POST {action:'card', id, key}                   a Stripe Checkout session
 *
 * The key never goes in a URL, so no log holds it. The browser never sends
 * an amount: any it does send is ignored, and every figure is the offer's.
 */
import Stripe from 'stripe';
import { useRequestOrigin, siteOrigin } from './_lib/data.js';
import { offersConfigured, getOffer, keyOk, publicView, cannotPay, cardSession, gstNumber } from './_lib/offers.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
});
const SOMEONE_ELSE = 'This link belongs to someone else.';

/* swapped for a stand-in by the tests; nothing else touches it */
export const deps = {
  stripe: () => new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-07-29.dahlia', appInfo: { name: 'mintface.art', url: 'https://mintface.art' } }),
};

/* a wrong id and a wrong key look the same from outside */
async function opened(id, key) {
  const o = await getOffer(id);
  if (!o || !keyOk(o, key)) return { stop: json({ error: SOMEONE_ELSE }, 403) };
  return { o };
}

export async function GET(request) {
  useRequestOrigin(request);
  if (!offersConfigured()) return json({ error: 'offers are not open here; write to ryan@mintface.art' }, 503);
  const id = new URL(request.url).searchParams.get('id');
  const { o, stop } = await opened(id, request.headers.get('x-offer-key'));
  if (stop) return stop;
  const view = publicView(o);
  const no = cannotPay(o);
  if (no && no[0] === 410) return json({ error: no[1], ...view }, 410);
  return json(view);
}

export async function POST(request) {
  const origin = useRequestOrigin(request) || siteOrigin();
  if (!offersConfigured()) return json({ error: 'offers are not open here; write to ryan@mintface.art' }, 503);
  let b;
  try { b = await request.json(); } catch { return json({ error: 'bad request' }, 400); }
  if (!b || b.action !== 'card') return json({ error: 'unknown action' }, 400);

  const { o, stop } = await opened(b.id, b.key);
  if (stop) return stop;
  const no = cannotPay(o);
  if (no) return json({ error: no[1], state: publicView(o).state }, no[0]);
  /* a GST-inclusive price is only taken where the receipt can carry the number */
  if (o.gst_inclusive && !gstNumber()) {
    console.error('offer card', o.id, 'MINTFACE_GST_NUMBER is not set');
    return json({ error: 'Card payment isn\'t open on this link yet. Write to the studio.' }, 503);
  }
  if (!process.env.STRIPE_SECRET_KEY) return json({ error: 'card payment is not set up here' }, 503);
  try {
    const s = await cardSession(deps.stripe(), o, { origin });
    return json({ url: s.url });
  } catch (e) {
    console.error('offer card', o.id, e.message);
    return json({ error: 'The card checkout could not be opened. Try again in a minute.' }, 502);
  }
}
