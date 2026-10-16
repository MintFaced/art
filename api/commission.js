/* /api/commission: a Strip Painting commission, from COMMISSION to paid.
 *
 * GET  ?id=SP-2026-0041            the public view: the painting, the spec, the
 *                                   price, the status ... nothing personal. A
 *                                   transaction the buyer sent is checked here
 *                                   too, so a waiting page sees it land.
 * POST {action:'create', spec}       a new order; hands back its key, once
 * POST {action:'read',   id, key}    the buyer's own view, details included
 * POST {action:'update', id, key, name?, email?, ship_to?, delivery?, mention?, x_handle?}
 * POST {action:'card',   id, key, currency}   a Stripe Checkout session
 * POST {action:'eth',    id, key}    pay with ETH: address, exact amount, QR
 * POST {action:'eth-tx', id, key, hash}       a connected wallet's transaction
 *
 * The browser never sends an amount. Every price here is the order's.
 */
import Stripe from 'stripe';
import { useRequestOrigin, siteOrigin } from './_lib/data.js';
import {
  commissionsConfigured, createOrder, getOrder, publicView, privateView, updateOrder,
  readyToPay, cardSession, chooseEth, reportTx, checkPendingTx, keyOk,
} from './_lib/commissions.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
const closed = () => json({ error: 'commissions are not open here; write to ryan@mintface.art and it will be handled by hand' }, 503);

export async function GET(request) {
  if (!commissionsConfigured()) return closed();
  const id = new URL(request.url).searchParams.get('id');
  let o = await getOrder(id);
  if (!o) return json({ error: 'no such order' }, 404);
  if (o.eth && o.eth.pending_tx && o.status === 'pending_payment') {
    await checkPendingTx(o);
    o = (await getOrder(id)) || o;
  }
  return json(await publicView(o));
}

export async function POST(request) {
  useRequestOrigin(request);
  if (!commissionsConfigured()) return closed();
  let b;
  try { b = await request.json(); } catch { return json({ error: 'bad request' }, 400); }
  const action = b && b.action;

  if (action === 'create') {
    const r = await createOrder(b.spec);
    if (r.error) return json({ error: r.error }, 400);
    return json({ id: r.order.id, key: r.key, order: await publicView(r.order) }, 201);
  }

  if (action === 'read') {
    const o = await getOrder(b.id);
    if (!o) return json({ error: 'no such order' }, 404);
    if (!keyOk(o, b.key)) return json({ error: 'this order belongs to another browser' }, 403);
    return json(await privateView(o));
  }

  if (action === 'update') {
    const fields = {};
    for (const k of ['name', 'email', 'ship_to', 'delivery', 'mention', 'x_handle']) if (k in b) fields[k] = b[k];
    const r = await updateOrder(b.id, b.key, fields);
    if (r.error) return json({ error: r.error }, r.status || 400);
    return json(await privateView(r.order));
  }

  if (action === 'card') {
    const r = await updateOrder(b.id, b.key, {});
    if (r.error) return json({ error: r.error }, r.status || 400);
    const missing = readyToPay(r.order);
    if (missing) return json({ error: missing }, 400);
    if (!process.env.STRIPE_SECRET_KEY) return json({ error: 'card payment is not set up here' }, 503);
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-07-29.dahlia', appInfo: { name: 'mintface.art', url: 'https://mintface.art' } });
    try {
      const s = await cardSession(stripe, r.order, { currency: b.currency, origin: useRequestOrigin(request) || siteOrigin() });
      return json({ url: s.url });
    } catch (e) {
      console.error('commission card', b.id, e.message);
      return json({ error: 'the card checkout could not be opened; try again, or pay with ETH' }, 502);
    }
  }

  if (action === 'eth') {
    const r = await chooseEth(b.id, b.key);
    if (r.error) return json({ error: r.error }, r.status || 400);
    return json(await privateView(r.order));
  }

  if (action === 'eth-tx') {
    const r = await reportTx(b.id, b.key, b.hash);
    if (r.error) return json({ error: r.error }, r.status || 400);
    return json(await privateView(r.order));
  }

  return json({ error: 'unknown action' }, 400);
}
