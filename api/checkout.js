import Stripe from 'stripe';
import { findWork, priceNZD, siteOrigin, useRequestOrigin } from './_lib/data.js';
import { nzdToUsd, toMinorUnits } from './_lib/fx.js';
import { workState } from './_lib/state.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2026-07-29.dahlia',
  appInfo: { name: 'mintface.art', url: 'https://mintface.art' },
});

const WHAT = {
  digital: 'Digital work',
  painting: 'Painting',
  both: 'Painting and digital work together',
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// tag sessions so flows can be compared in the dashboard
const IDENTIFIER = 'mintface-checkout-qkzrwvhd';

export async function POST(request) {
  useRequestOrigin(request);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }

  const { workId, what, currency } = body || {};
  if (!workId || !WHAT[what]) return json({ error: 'workId and what are required' }, 400);
  const cur = (currency || 'NZD').toUpperCase();
  if (cur !== 'NZD' && cur !== 'USD') return json({ error: 'currency must be NZD or USD' }, 400);

  const hit = await findWork(workId);
  if (!hit) return json({ error: 'no such work' }, 404);
  const { work, collection } = hit;

  // live state wins over the static catalog
  let status = work.status;
  try {
    const live = await workState(workId);
    if (live && live.status) status = live.status;
  } catch { /* state store unreachable, fall back to the catalog */ }
  if (status !== 'available') return json({ error: `this work is ${status}` }, 409);

  if ((what === 'painting' || what === 'both') && !collection.physical) {
    return json({ error: 'this work has no painting' }, 400);
  }

  const nzd = priceNZD(work, what);
  if (!nzd) return json({ error: 'no price set for that option' }, 409);

  const amount = cur === 'NZD' ? nzd : nzd * (await nzdToUsd());
  const origin = siteOrigin();
  const title = work.title || 'Untitled';
  const physical = what === 'painting' || what === 'both';

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    // payment methods are chosen dynamically by Stripe, configured in the dashboard
    line_items: [{
      quantity: 1,
      price_data: {
        currency: cur.toLowerCase(),
        unit_amount: toMinorUnits(amount),
        product_data: {
          name: `${title} ... ${collection.title}`,
          description: WHAT[what] + (cur === 'USD' ? ' (converted from NZD)' : ''),
          ...(work.digital?.image ? { images: [work.digital.image] } : {}),
        },
      },
    }],
    success_url: `${origin}/w/${encodeURIComponent(workId)}?paid={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/w/${encodeURIComponent(workId)}`,
    client_reference_id: workId,
    metadata: { workId, what, collection: collection.slug, price_nzd: String(nzd), currency: cur },
    integration_identifier: IDENTIFIER,
    billing_address_collection: 'required',
    phone_number_collection: { enabled: physical },
    ...(physical ? {
      custom_text: {
        submit: { message: 'Shipping is included worldwide. Ryan will confirm the delivery address and crating with you within a day.' },
      },
    } : {}),
  });

  return json({ url: session.url, id: session.id });
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}
