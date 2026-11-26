/* /api/offer-admin: private offers, from the studio's side, behind the console
 * password (the mf_studio cookie /api/studio-api?do=login sets).
 *
 * GET                                  every offer, newest first
 * GET  ?id=OF-2026-0001                one offer, whole (less its key's hash)
 * POST {action:'create', workId, nzd, gst_inclusive, buyer_name, buyer_email?, delivery, days?, what?, note?}
 *      → {offer, link}. The key in the link is shown this once and kept nowhere.
 * POST {action:'cancel', id, note?}    the link stops working; refused once paid
 * POST {action:'newlink', id, note?}   a fresh key, the old link stops; refused once paid
 */
import Stripe from 'stripe';
import { useRequestOrigin } from './_lib/data.js';
import { sessionOk, sessionFrom } from './_lib/studio.js';
import {
  offersConfigured, createOffer, getOffer, listOffers, cancelOffer, newLink, stateOf, gstOf, specLine, gstNumber,
} from './_lib/offers.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
});
const gate = (request) => {
  if (!offersConfigured()) return json({ error: 'no store' }, 503);
  if (!sessionOk(sessionFrom(request))) return json({ error: 'sign in first', login: true }, 401);
  return null;
};
const whole = (o) => {
  const { key_hash, ...rest } = o;
  return { ...rest, state: stateOf(o), gst: o.gst_inclusive ? gstOf(o.nzd) : null, spec_line: specLine(o.item) };
};
const row = (o) => ({
  id: o.id, workId: o.workId, title: o.item.title, what: o.what, nzd: o.nzd, gst_inclusive: o.gst_inclusive,
  buyer_name: o.buyer_name, buyer_email: o.buyer_email, delivery: o.delivery,
  state: stateOf(o), created: o.created, expires: o.expires, paid_at: o.paid_at,
});
/* the key travels after a #, so it is never sent to the server or logged */
const linkTo = (request, o, key) => `${new URL(request.url).origin}/pay/${o.id}#k=${key}`;
const stripe = () => (process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-07-29.dahlia' }) : null);

export async function GET(request) {
  const stop = gate(request);
  if (stop) return stop;
  const id = new URL(request.url).searchParams.get('id');
  if (id) {
    const o = await getOffer(id);
    if (!o) return json({ error: 'no such offer' }, 404);
    return json({ offer: whole(o) });
  }
  return json({ offers: (await listOffers()).map(row), gst_number_set: Boolean(gstNumber()) });
}

export async function POST(request) {
  useRequestOrigin(request);
  const stop = gate(request);
  if (stop) return stop;
  let b;
  try { b = await request.json(); } catch { return json({ error: 'bad request' }, 400); }

  if (b.action === 'create') {
    const r = await createOffer({
      workId: b.workId, nzd: b.nzd, gst_inclusive: b.gst_inclusive === true, buyer_name: b.buyer_name,
      buyer_email: b.buyer_email, delivery: b.delivery, days: b.days, what: b.what, note: b.note,
    });
    if (r.error) return json({ error: r.error }, r.status || 400);
    return json({ offer: whole(r.offer), link: linkTo(request, r.offer, r.key) }, 201);
  }

  if (b.action === 'cancel') {
    const r = await cancelOffer(String(b.id || ''), { note: b.note, stripe: stripe() });
    if (r.error) return json({ error: r.error }, r.status || 400);
    return json({ offer: whole(r.offer) });
  }

  if (b.action === 'newlink') {
    const r = await newLink(String(b.id || ''), { note: b.note });
    if (r.error) return json({ error: r.error }, r.status || 400);
    return json({ offer: whole(r.offer), link: linkTo(request, r.offer, r.key) });
  }

  return json({ error: 'unknown action' }, 400);
}
