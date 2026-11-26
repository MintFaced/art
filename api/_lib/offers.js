/* Private offers (COMPOSITION-32): a link to buy one work at a set price, for
 * one named buyer. Composition 32 is the first; nothing here knows that.
 *
 * THE RECORD IS PRIVATE. It holds the buyer's name and maybe their email, so it
 * lives in the store (Upstash), never in the repository, which is public. Only
 * a sale's bare fact reaches data/state.json: acquired, when, and which offer.
 * Not the buyer, not their email, not the price.
 *
 * THE KEY IS THE LINK. It is handed back once, to the console, and only its hash
 * is kept. It travels after #k= in the link, so a browser never sends it in a
 * URL and no log ever holds it. New link makes another; the old one stops.
 *
 * THE AMOUNT IS THE RECORD'S. The browser names an offer and shows its key;
 * any figure it sends is ignored.
 *
 * PAID HAPPENS ONCE. However many times Stripe retries, the record is written
 * first and the receipt and the studio's note go out behind a once-only mark.
 *
 * GST. An offer marked GST-inclusive is only made when MINTFACE_GST_NUMBER is
 * set, so its receipt is a proper tax receipt. The number lives in Vercel's
 * environment and nowhere in this repository.
 */
import crypto from 'node:crypto';
import { pipe, one, storeConfigured } from './kv.js';
import { findWork } from './data.js';
import { send } from './email.js';
import { writeWorkState, stateConfigured } from './state.js';

const SITE = () => process.env.SITE_ORIGIN || 'https://mintface.art';
const ARTIST = () => process.env.EMAIL_TO_ARTIST || 'ryan@mintface.art';
export const gstNumber = () => String(process.env.MINTFACE_GST_NUMBER || '').trim() || null;
export const SELLER = 'MintFace (Ryan Jennings)';

const DAY = 864e5;
export const DEFAULT_DAYS = 14;
export const WHATS = ['painting', 'digital', 'both'];
export const DELIVERIES = ['collect', 'shipped'];
export const STATUSES = ['open', 'paid', 'cancelled'];
export const NO_GST = 'Set MINTFACE_GST_NUMBER first, so the receipt is a proper tax receipt.';

const K = {
  offer: (id) => `offer:${id}`,
  ids: 'offer:ids',
  seq: (year) => `offer:seq:${year}`,
  paid: (id) => `offer:paid:${id}`,
  evt: (id) => `offer:evt:${id}`,
};

export const offersConfigured = () => storeConfigured();

/* ------------------------------------------------------------ money */

/** The GST inside a GST-inclusive NZ price: three twenty-thirds, to the cent. */
export const gstOf = (nzd) => Math.round((Number(nzd) * 300) / 23) / 100;
const cents = (n) => Number(n).toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** NZD 1,000 or NZD 1,000.50: cents only where there are any. */
export const nzdText = (n) => `NZD ${Number.isInteger(Number(n)) ? Number(n).toLocaleString('en-NZ') : cents(n)}`;
export const amountLine = (o) => `${nzdText(o.nzd)}${o.gst_inclusive ? ' incl. GST' : ''}`;

/* ------------------------------------------------------------ the record */

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
export const keyOk = (o, key) => {
  if (!o || !key) return false;
  const a = Buffer.from(sha(key));
  const b = Buffer.from(o.key_hash || '');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const now = () => Date.now();
const iso = (t = now()) => new Date(t).toISOString();
const nzYear = () => Number(new Intl.DateTimeFormat('en-NZ', { timeZone: 'Pacific/Auckland', year: 'numeric' }).format(new Date()));
const nzDate = (t) => new Intl.DateTimeFormat('en-NZ', { timeZone: 'Pacific/Auckland', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(t));
/* letters and digits only, so a link pasted into a message survives whole */
const newKey = () => crypto.randomBytes(16).toString('hex');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** open, paid or cancelled as kept; an open offer past its date reads expired. */
export const stateOf = (o) => (o.status === 'open' && Date.parse(o.expires) < now() ? 'expired' : o.status);
export const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || null;

export async function getOffer(id) {
  if (!/^OF-\d{4}-\d{4,}$/.test(String(id || ''))) return null;
  const raw = await one('GET', K.offer(id));
  return raw ? JSON.parse(raw) : null;
}

async function save(o, what = null, note = null) {
  o.updated = iso();
  if (what) (o.history = o.history || []).push({ at: o.updated, what, ...(note ? { note } : {}) });
  await one('SET', K.offer(o.id), JSON.stringify(o));
  return o;
}

/* What the buyer pays for, taken from the catalogue once, when the offer is
   made, so the page and the receipt say the same thing however the catalogue
   moves afterwards. */
function itemOf(work, collection) {
  const p = work.physical || {};
  const medium = work.medium || (collection && collection.medium) || null;
  const size = p.width_cm && p.height_cm ? `${Math.round(p.width_cm * 10)} × ${Math.round(p.height_cm * 10)} mm` : null;
  const image = (work.digital && work.digital.image) || (work.assets && (work.assets.display || work.assets.image)) || null;
  return { title: work.title || work.id, medium, size, image };
}
export const specLine = (item) => [item.medium, item.size].filter(Boolean).join(' · ');
/** "Composition 32, acrylic on canvas, 1200 × 600 mm", for the receipt */
export const describe = (item) => [item.title, item.medium && item.medium.toLowerCase(), item.size].filter(Boolean).join(', ');
const imageUrl = (item) => (!item.image ? null : /^https:\/\//.test(item.image) ? item.image : item.image.startsWith('/') ? `${SITE()}${item.image}` : null);

export const deliveryLine = (o) => {
  if (o.what === 'digital') return 'The token is transferred by hand, to the wallet you name.';
  return o.delivery === 'shipped' ? 'Shipped to you, boxed. Ryan will confirm the address and crating within a day.' : 'Collected from The Line, Hastings.';
};
const deliveryShort = (o) => (o.what === 'digital' ? 'Token transferred by hand'
  : o.delivery === 'shipped' ? 'Shipped to you, boxed' : 'Collected from The Line, Hastings');

/** Made in the studio. The key comes back once, with the offer. */
export async function createOffer(input = {}) {
  const workId = String(input.workId || '').trim();
  if (!workId) return { error: 'which work? give its id, like composition-32-1' };
  const nzd = Number(input.nzd);
  if (!(Number.isFinite(nzd) && nzd > 0 && nzd <= 1e6)) return { error: 'the amount is NZD, more than 0' };
  if (Math.abs(Math.round(nzd * 100) - nzd * 100) > 1e-6) return { error: 'the amount goes to the cent at most' };
  const gst_inclusive = input.gst_inclusive === true;
  if (gst_inclusive && !gstNumber()) return { error: NO_GST, status: 409 };
  const buyer_name = String(input.buyer_name || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  if (!buyer_name) return { error: 'the buyer\'s name, please: the page and the receipt carry it' };
  const buyer_email = String(input.buyer_email || '').trim() || null;
  if (buyer_email && (!EMAIL.test(buyer_email) || buyer_email.length > 200)) return { error: 'that email address doesn\'t look right' };
  const what = input.what == null || input.what === '' ? 'painting' : String(input.what);
  if (!WHATS.includes(what)) return { error: 'what is painting, digital or both' };
  const delivery = input.delivery == null || input.delivery === '' ? 'collect' : String(input.delivery);
  if (!DELIVERIES.includes(delivery)) return { error: 'delivery is collect or shipped' };
  const days = input.days == null || input.days === '' ? DEFAULT_DAYS : Number(input.days);
  if (!(Number.isInteger(days) && days >= 1 && days <= 90)) return { error: 'days is a whole number from 1 to 90' };
  const note = String(input.note || '').trim().slice(0, 2000) || null;

  const hit = await findWork(workId);
  if (!hit) return { error: 'no such work', status: 404 };
  const item = itemOf(hit.work, hit.collection);

  const year = nzYear();
  const seq = await one('INCR', K.seq(year));
  const id = `OF-${year}-${String(seq).padStart(4, '0')}`;
  const key = newKey();
  const t = now();
  const o = {
    id, workId, what, nzd, gst_inclusive, buyer_name, buyer_email, delivery,
    key_hash: sha(key), status: 'open', created: iso(t), updated: iso(t),
    days, expires: iso(t + days * DAY), paid_at: null, payment_ref: null, paid_amount: null, receipt_to: null,
    item, note, session: null,
    history: [{ at: iso(t), what: 'made in the studio', ...(note ? { note } : {}) }],
  };
  await pipe([['SET', K.offer(id), JSON.stringify(o)], ['LPUSH', K.ids, id]]);
  return { offer: o, key };
}

/** What a key-holder sees: never an email address, never the key's hash. */
export function publicView(o) {
  return {
    id: o.id,
    state: stateOf(o),
    work: { id: o.workId, title: o.item.title, image: o.item.image, spec_line: specLine(o.item) },
    what: o.what,
    nzd: o.nzd,
    gst_inclusive: o.gst_inclusive,
    gst: o.gst_inclusive ? gstOf(o.nzd) : null,
    buyer_name: o.buyer_name,
    buyer_first_name: firstName(o.buyer_name),
    delivery: o.delivery,
    delivery_line: deliveryLine(o),
    expires: o.expires,
    paid_at: o.paid_at,
  };
}

/** Why an offer can't be paid now, as [status, message], or null if it can. */
export function cannotPay(o) {
  const s = stateOf(o);
  if (s === 'paid') return [409, 'Paid. Thank you.'];
  if (s === 'expired' || s === 'cancelled') return [410, 'This offer has ended. Write to the studio.'];
  return null;
}

/* ------------------------------------------------------------------ card */

/** A Stripe Checkout session for the offer's own amount, in NZD. */
export async function cardSession(stripe, o, { origin = SITE() } = {}) {
  const image = imageUrl(o.item);
  const gstNote = o.gst_inclusive ? `Includes GST of NZD ${cents(gstOf(o.nzd))} · ` : '';
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'nzd',
        unit_amount: Math.round(o.nzd * 100),
        product_data: {
          name: `${o.item.title} ... ${o.what === 'both' ? 'painting and token' : o.what}`,
          description: `${gstNote}${deliveryShort(o)}`,
          ...(image ? { images: [image] } : {}),
        },
      },
    }],
    ...(o.buyer_email ? { customer_email: o.buyer_email } : {}),
    billing_address_collection: 'required',
    phone_number_collection: { enabled: true },
    /* a shipped painting has its freight arranged by hand; a collected one says so and nothing more */
    ...(o.what !== 'digital' && o.delivery === 'shipped'
      ? { custom_text: { submit: { message: 'Shipping is included. Ryan will confirm the delivery address and crating with you within a day.' } } }
      : {}),
    client_reference_id: o.id,
    metadata: { kind: 'offer', offer: o.id, workId: o.workId },
    payment_intent_data: { metadata: { kind: 'offer', offer: o.id, workId: o.workId } },
    success_url: `${origin}/pay/${o.id}?paid=1`,
    cancel_url: `${origin}/pay/${o.id}`,
    expires_at: Math.floor(now() / 1000) + 60 * 60,
  });
  o.session = { id: session.id, expires: iso(now() + 60 * 60 * 1000) };
  await save(o, 'card checkout opened');
  return session;
}

/** The webhook's half: a completed session pays its offer, once. */
export async function offerPaid(session, eventId) {
  const id = session.metadata && session.metadata.offer;
  if (!id) return { skipped: 'no offer' };
  /* An event seen through to the end is not handled again. It is noted only
     once the offer is written, so a retry after a failure still does the work;
     paying is once-only on its own, so doing it twice changes nothing. */
  if (eventId && (await one('EXISTS', K.evt(eventId)))) return { already: 'event' };
  const r = await markPaid(id, session);
  if (eventId && !r.error) await one('SET', K.evt(eventId), '1', 'EX', String(60 * 60 * 24 * 30));
  return r;
}

async function markPaid(id, session) {
  const o = await getOffer(id);
  if (!o) return { error: 'no such offer' };
  const amount = (session.amount_total || 0) / 100;
  const currency = String(session.currency || 'nzd').toUpperCase();
  const buyer = session.customer_details || {};
  if (o.status !== 'paid') {
    const was = o.status;
    o.status = 'paid';
    o.paid_at = iso();
    o.payment_ref = session.payment_intent || session.id || null;
    o.paid_amount = `${amount} ${currency}`;
    o.receipt_to = buyer.email || o.buyer_email || null;
    const odd = Math.round(amount * 100) !== Math.round(o.nzd * 100) || currency !== 'NZD';
    await save(o, 'paid by card',
      [was === 'cancelled' ? 'paid through a checkout opened before the offer was cancelled' : null,
        odd ? `Stripe says ${amount} ${currency}, the offer says NZD ${o.nzd}` : null].filter(Boolean).join('; ') || null);
  }
  const first = await one('SET', K.paid(id), iso(), 'NX');
  if (first !== 'OK') return { offer: o, already: true };
  await Promise.all([
    recordSale(o).catch((e) => console.error('offer state', id, e.message)),
    emailBuyer(o).catch((e) => console.error('offer buyer email', id, e.message)),
    emailArtist(o, session).catch((e) => console.error('offer artist email', id, e.message)),
  ]);
  return { offer: o };
}

/* The work's public record: acquired, and when. Its collector's name stays
   whatever the catalogue already shows (Ryan's call, in the overlay), so an
   offer never publishes a buyer; the price stays off it too. */
async function recordSale(o) {
  if (!stateConfigured()) return;
  const hit = await findWork(o.workId).catch(() => null);
  const shown = (hit && hit.work && hit.work.collector && hit.work.collector.display_name) || null;
  await writeWorkState(o.workId, {
    status: 'acquired', pending: null, note: null, what: o.what, sold_out: true,
    paid: { at: o.paid_at, offer: o.id },
    collector: { display_name: shown, ens: null, note: null, acquired: o.paid_at },
  }, `Sold: ${o.item.title} (${o.what}, private offer ${o.id})`);
}

/* ---------------------------------------------------------------- emails */

export function receiptText(o, gst = gstNumber()) {
  const lines = [
    o.gst_inclusive ? 'TAX RECEIPT' : 'RECEIPT',
    '',
    `Seller: ${SELLER}`,
    ...(o.gst_inclusive ? [`GST number: ${gst}`] : []),
    `Date: ${nzDate(o.paid_at || now())}`,
    `Receipt: ${o.id}`,
    `Buyer: ${o.buyer_name}`,
    '',
    describe(o.item),
    `Total: NZD ${cents(o.nzd)}${o.gst_inclusive ? ' incl. GST' : ''}`,
    ...(o.gst_inclusive ? [`GST: NZD ${cents(gstOf(o.nzd))}`] : []),
  ];
  return lines.join('\n');
}

async function emailBuyer(o) {
  if (!o.receipt_to) return;
  const next = o.what === 'digital' ? deliveryLine(o)
    : o.delivery === 'shipped' ? deliveryLine(o)
      : 'Collected from The Line, Hastings. Ryan will write to arrange a time.';
  await send({
    to: o.receipt_to,
    subject: `${o.item.title} ... paid, with your receipt`,
    text: `${firstName(o.buyer_name) || 'Hello'},

Thank you. Your payment for ${o.item.title} has gone through.

${next}

${receiptText(o)}

Questions: reply to this email.

Ryan
MintFace`,
  });
}

async function emailArtist(o, session) {
  const d = session.customer_details || {};
  const a = d.address || null;
  const address = a ? [a.line1, a.line2, a.city, a.state, a.postal_code, a.country].filter(Boolean).join(', ') : null;
  const line = `Paid: ${o.item.title}, ${o.buyer_name}, ${amountLine(o)}.`;
  await send({
    to: ARTIST(),
    subject: line.replace(/\.$/, ''),
    text: `${line}

Offer: ${o.id}
What: ${o.what}
Delivery: ${o.what === 'digital' ? 'token' : o.delivery}
Stripe: ${o.payment_ref || '-'}
Email: ${d.email || o.buyer_email || '-'}
Phone: ${d.phone || '-'}
Billing: ${address || '-'}
Receipt sent to: ${o.receipt_to || 'nobody (no email)'}

${SITE()}/mintwork/offers`,
  });
}

/* --------------------------------------------------------------- console */

export async function listOffers({ limit = 200 } = {}) {
  const ids = (await one('LRANGE', K.ids, '0', String(limit - 1))) || [];
  if (!ids.length) return [];
  const raw = await pipe(ids.map((id) => ['GET', K.offer(id)]));
  return raw.filter(Boolean).map((r) => JSON.parse(r));
}

/** No more: the link stops working. An open card checkout is closed too. */
export async function cancelOffer(id, { note = null, stripe = null } = {}) {
  const o = await getOffer(id);
  if (!o) return { error: 'no such offer', status: 404 };
  if (o.status === 'paid') return { error: 'this offer is paid; refund it in Stripe if it has to be undone', status: 409 };
  if (o.status === 'cancelled') return { error: 'already cancelled', status: 409 };
  o.status = 'cancelled';
  await save(o, 'cancelled by the studio', String(note || '').trim().slice(0, 2000) || null);
  if (stripe && o.session && Date.parse(o.session.expires) > now()) {
    await stripe.checkout.sessions.expire(o.session.id).catch(() => { /* already finished or expired */ });
  }
  return { offer: o };
}

/**
 * New link: a fresh key, and the old link stops opening the offer. The clock
 * starts again from today, for as many days as the offer was first given.
 */
export async function newLink(id, { note = null } = {}) {
  const o = await getOffer(id);
  if (!o) return { error: 'no such offer', status: 404 };
  if (o.status === 'paid') return { error: 'this offer is paid; a new link would have nothing to pay', status: 409 };
  if (o.status === 'cancelled') return { error: 'this offer is cancelled; make a new one', status: 409 };
  const key = newKey();
  o.key_hash = sha(key);
  o.expires = iso(now() + (o.days || DEFAULT_DAYS) * DAY);
  await save(o, 'new link made by the studio (the old link no longer opens it)', String(note || '').trim().slice(0, 2000) || null);
  return { offer: o, key };
}
