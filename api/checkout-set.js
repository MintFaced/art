import Stripe from 'stripe';
import { findWork, siteOrigin, useRequestOrigin } from './_lib/data.js';
import { claimWork, stateConfigured } from './_lib/state.js';
import { nzdToUsd } from './_lib/fx.js';
import { SET } from './set.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-07-29.dahlia' });
const IDENTIFIER = 'mintface-set-hqvbnztd';
const HOLD_MINUTES = Number(process.env.CHECKOUT_HOLD_MINUTES || 30);

const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });

/* One action for the whole set.

   Five works are claimed before a session exists, and if any one of them
   cannot be claimed every claim already taken is released. A set that is only
   four fifths held is worse than no set at all: it takes four works off sale
   for half an hour on behalf of a purchase that cannot complete. */
export async function POST(request) {
  useRequestOrigin(request);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }
  const ids = Array.isArray(body.works) ? body.works.map(String) : [];
  const cur = (body.currency || 'NZD').toUpperCase();
  if (cur !== 'NZD' && cur !== 'USD') return json({ error: 'currency must be NZD or USD' }, 400);
  if (ids.length !== SET.slots.length) return json({ error: `a set is ${SET.slots.length} works` }, 400);
  if (new Set(ids).size !== ids.length) return json({ error: 'the same work twice is not a set' }, 400);
  if (!stateConfigured()) return json({ error: 'the sale ledger is not reachable, email ryan@mintface.art' }, 503);

  // every work must be the right variant, available, and priced
  const picked = [];
  for (let i = 0; i < SET.slots.length; i++) {
    const slot = SET.slots[i];
    const hit = await findWork(ids[i]);
    if (!hit) return json({ error: `no such work: ${ids[i]}` }, 404);
    const { work } = hit;
    if (work.collection !== slot.key) return json({ error: `${ids[i]} is not a ${slot.title}` }, 400);
    if (slot.only && !slot.only.includes(work.id)) return json({ error: `${ids[i]} does not fill the ${slot.title} slot` }, 400);
    const nzd = work.pricing_nzd && work.pricing_nzd.digital;
    if (!(typeof nzd === 'number' && nzd > 0)) return json({ error: `${ids[i]} has no price` }, 409);
    if (!(work.offers && work.offers.digital)) return json({ error: `${ids[i]} is not on offer` }, 409);
    picked.push({ work, nzd, slot });
  }

  const holdUntil = Math.floor(Date.now() / 1000) + HOLD_MINUTES * 60;
  const claimed = [];
  const release = async () => {
    for (const id of claimed) {
      await claimWork(id, {
        expect: ['pending'],
        patch: { status: 'available', pending: null },
        message: `Set hold released: ${id}`,
      }).catch(() => {});
    }
  };

  for (const p of picked) {
    try {
      // claimWork throws when the work is not in the state it was expected in
      await claimWork(p.work.id, {
        expect: ['available'],
        patch: { status: 'pending', pending: { expires: new Date(holdUntil * 1000).toISOString(), set: SET.slug, what: 'digital' } },
        message: `Set hold: ${p.work.title || p.work.id}`,
      });
      claimed.push(p.work.id);
    } catch (err) {
      await release();
      return json({ error: `${p.work.title || p.work.id} was taken while you were choosing, pick another` },
        err.code === 'claimed' ? 409 : 503);
    }
  }

  const usdRate = cur === 'USD' ? await nzdToUsd() : null;
  const origin = siteOrigin();
  try {
    const session = await stripe.checkout.sessions.create({
      expires_at: holdUntil,
      mode: 'payment',
      integration_identifier: IDENTIFIER,
      line_items: picked.map((p) => ({
        quantity: 1,
        price_data: {
          currency: cur.toLowerCase(),
          unit_amount: Math.round((cur === 'NZD' ? p.nzd : p.nzd * usdRate) * 100),
          product_data: {
            name: `${p.work.title || p.work.id} ... ${p.slot.title}`,
            description: 'The Geodetic Set',
          },
        },
      })),
      metadata: {
        set: SET.slug,
        works: ids.join(','),
        what: 'digital',
      },
      success_url: `${origin}/set/${SET.slug}?paid={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/set/${SET.slug}`,
    });
    return json({ url: session.url, id: session.id });
  } catch (err) {
    await release();
    return json({ error: String(err.message || err).slice(0, 200) }, 502);
  }
}
