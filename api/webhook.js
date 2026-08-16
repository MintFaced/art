import Stripe from 'stripe';
import { findWork, useRequestOrigin } from './_lib/data.js';
import { writeWorkState, workState } from './_lib/state.js';
import { send, templates } from './_lib/email.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-07-29.dahlia' });
const SECRET = process.env.STRIPE_WEBHOOK_SECRET;

// Fulfilment lives here, never on the success page. A buyer can pay and close the
// tab before it loads, and a delayed payment method settles hours later.
export async function POST(request) {
  useRequestOrigin(request);
  const raw = await request.text();
  const sig = request.headers.get('stripe-signature');

  let event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, SECRET);
  } catch (err) {
    return new Response(`signature: ${err.message}`, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const session = event.data.object;
        // a completed session can still be unpaid with delayed payment methods
        if (session.payment_status === 'unpaid') break;
        await fulfil(session);
        break;
      }
      case 'checkout.session.async_payment_failed':
        await release(event.data.object, 'payment failed');
        break;
      case 'checkout.session.expired':
        await release(event.data.object, 'checkout abandoned');
        break;
      default:
        break;
    }
  } catch (err) {
    // 500 tells Stripe to retry, which is what we want if GitHub or Resend blinked
    console.error('webhook handling failed', err);
    return new Response(`handler: ${err.message}`, { status: 500 });
  }

  return new Response('ok', { status: 200 });
}

// Only lift a hold that belongs to this session. A later buyer may already have
// claimed the work, and their hold must not be cleared by an older timeout.
async function release(session, why) {
  const workId = session.metadata?.workId || session.client_reference_id;
  if (!workId) return;
  const live = await workState(workId);
  if (!live || live.status !== 'pending') return;
  if (live.pending?.session && live.pending.session !== session.id) return;
  await writeWorkState(workId, { status: 'available', pending: null, note: why },
    `Hold lifted: ${workId}, ${why}`);
}

// One of a kind, or any purchase including the painting. An edition can be sold
// again tomorrow, so a sale records itself without closing the work.
function closesTheWork(work, what) {
  if (what === 'painting' || what === 'both') return true;
  return !(work && work.edition && work.edition.type === 'edition');
}

async function fulfil(session) {
  const workId = session.metadata?.workId || session.client_reference_id;
  if (!workId) return;

  const hit = await findWork(workId);
  const title = hit?.work?.title || workId;
  const what = session.metadata?.what || 'digital';
  const closes = closesTheWork(hit?.work, what);
  const amount = (session.amount_total || 0) / 100;
  const currency = (session.currency || 'nzd').toUpperCase();
  const email = session.customer_details?.email || null;
  const address = session.customer_details?.address || null;
  const shipping = address
    ? [session.customer_details?.name, address.line1, address.line2, address.city, address.state, address.postal_code, address.country]
        .filter(Boolean)
        .filter((line, i, all) => line !== all[i - 1])
        .join('\n')
    : null;

  await writeWorkState(workId, {
    status: closes ? 'acquired' : 'available',
    what,
    sold_out: closes,
    paid: { amount, currency, session: session.id, at: new Date().toISOString() },
    collector: { email, display_name: null, ens: null, note: null, acquired: new Date().toISOString() },
    token_transfer: 'pending',
  }, `Sold: ${title} (${what}, ${amount} ${currency})`);

  const notify = process.env.EMAIL_TO_ARTIST || 'ryan@mintface.art';
  const t = templates.sold({ title, what, amount, currency, email, shipping });
  await send({ to: notify, subject: t.subject, text: t.text }).catch((e) => console.error('artist email', e));

  if (email) {
    await send({
      to: email,
      subject: `Thank you ... ${title}`,
      text: `Your payment for ${title} has gone through.

What: ${what === 'both' ? 'the painting and the digital work' : what === 'painting' ? 'the painting' : 'the digital work'}
Paid: ${amount} ${currency}

${what === 'digital' ? 'The token will be transferred to your wallet by hand, usually within a day. Reply with the address you would like it sent to.' : 'Ryan will be in touch within a day to arrange crating and freight, and to take the wallet address for the token.'}

Ryan
MintFace`,
    }).catch((e) => console.error('buyer email', e));
  }
}
