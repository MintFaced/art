import Stripe from 'stripe';
import { findWork, priceNZD, siteOrigin, useRequestOrigin } from './_lib/data.js';
import { nzdToUsd, toMinorUnits } from './_lib/fx.js';
import { readQuote } from './_lib/quote.js';
import { workState, claimWork, stateConfigured } from './_lib/state.js';

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

// How long a buyer has at the Stripe checkout before the hold lifts. Stripe
// allows thirty minutes at the least, which suits a fifteen minute quote.
const HOLD_MINUTES = Number(process.env.CHECKOUT_HOLD_MINUTES || 30);

// One of a kind, or any purchase that includes the painting. Editions can be
// sold to as many people as there are editions, so they are not held.
function isOneOfAKind(work, what) {
  if (what === 'painting' || what === 'both') return true;
  return !(work.edition && work.edition.type === 'edition');
}

export async function POST(request) {
  useRequestOrigin(request);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }

  const { workId, what, currency, quote } = body || {};
  if (!workId || !WHAT[what]) return json({ error: 'workId and what are required' }, 400);
  const cur = (currency || 'NZD').toUpperCase();
  if (cur !== 'NZD' && cur !== 'USD') return json({ error: 'currency must be NZD or USD' }, 400);

  const hit = await findWork(workId);
  if (!hit) return json({ error: 'no such work' }, 404);
  const { work, collection } = hit;

  const unique = isOneOfAKind(work, what);

  // A unique work cannot be sold twice, so if the ledger is unreachable we stop
  // rather than risk two buyers paying for one painting.
  if (unique && !stateConfigured()) {
    return json({ error: 'the sale ledger is not reachable, email art@mintface.art and it will be handled by hand' }, 503);
  }

  // live state wins over the static catalog
  let status = work.status;
  try {
    const live = await workState(workId);
    if (live && live.status) status = live.status;
  } catch (err) {
    if (unique) return json({ error: 'could not check whether this is still available, try again in a moment' }, 503);
  }
  if (status !== 'available') {
    return json({ error: status === 'pending'
      ? 'someone is at the checkout with this one, try again in a few minutes'
      : `this work is ${status}` }, 409);
  }

  if ((what === 'painting' || what === 'both') && !collection.physical) {
    return json({ error: 'this work has no painting' }, 400);
  }

  const nzd = priceNZD(work, what);
  if (!nzd) return json({ error: 'no price set for that option' }, 409);

  // a quote issued when the slide-over opened is honoured for its full life, so
  // the figure on the button is the figure on the card
  let usdRate = null;
  let quoteId = null;
  if (cur === 'USD' && quote) {
    try {
      const q = readQuote(quote, { workId });
      if (q.rates?.usd) { usdRate = q.rates.usd; quoteId = q.id; }
    } catch (err) {
      return json({ error: err.message }, 409);
    }
  }
  const amount = cur === 'NZD' ? nzd : nzd * (usdRate || (await nzdToUsd()));
  const origin = siteOrigin();
  const title = work.title || 'Untitled';
  const physical = what === 'painting' || what === 'both';

  const holdUntil = Math.floor(Date.now() / 1000) + HOLD_MINUTES * 60;

  const session = await stripe.checkout.sessions.create({
    expires_at: holdUntil,
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
    metadata: { workId, what, collection: collection.slug, price_nzd: String(nzd), currency: cur, ...(quoteId ? { quote: quoteId } : {}) },
    integration_identifier: IDENTIFIER,
    billing_address_collection: 'required',
    phone_number_collection: { enabled: physical },
    ...(physical ? {
      custom_text: {
        submit: { message: 'Shipping is included worldwide. Ryan will confirm the delivery address and crating with you within a day.' },
      },
    } : {}),
  });

  // Hold it only once Stripe has a session to point at, and give the hold back
  // if the claim fails, so an abandoned session cannot strand the work.
  if (unique) {
    try {
      await claimWork(workId, {
        expect: ['available'],
        patch: {
          status: 'pending',
          pending: { session: session.id, what, expires: new Date(holdUntil * 1000).toISOString() },
        },
        message: `Checkout opened: ${title} (${what})`,
      });
    } catch (err) {
      await stripe.checkout.sessions.expire(session.id).catch(() => {});
      return json({ error: err.message }, err.code === 'claimed' ? 409 : 503);
    }
  }

  return json({ url: session.url, id: session.id, holds_until: new Date(holdUntil * 1000).toISOString() });
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}
