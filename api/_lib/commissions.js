/* Strip Painting commissions (STRIP-CHECKOUT): the order, its payment, and
 * what happens once it is paid.
 *
 * AN ORDER IS A RECORD BEFORE IT IS A PAYMENT. COMMISSION writes one, with the
 * strips the visitor saw and the price worked out here, and the checkout reads
 * it back: nothing a wallet or a closed tab does can lose it, and no amount is
 * ever taken from the browser.
 *
 * THE RECORD IS PRIVATE. It holds a name, an email and an address, so it lives
 * in the store (Upstash), never in the repository, which is public. The page
 * reads a public view with none of those in it; changing an order takes the
 * key handed back when it was made.
 *
 * PAID HAPPENS ONCE. However many times Stripe retries, or the chain is read,
 * the emails and the X post go out on the first transition and never again.
 */
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { pipe, one, storeConfigured } from './kv.js';
import { checkSpec, stripsOf, nzdOf, weiOf, ethText, specLine } from './commission-spec.js';
import { stripPNG } from './strip-png.js';
import { putObject, r2Configured } from './r2.js';
import { send } from './email.js';
import { nzdToUsd } from './fx.js';
import { enqueue } from './wire.js';
import { STRIP_ETH_NZD } from '../../strip-price.js';

export const LEAD_WEEKS = 4;
export const PAY_TO = (process.env.ETH_RECEIVE_ADDRESS || '0xd40B63bF04a44e43fBFE5784bCf22ACaAB34a180');
export const PAY_TO_ENS = 'mintface.eth';
const ASSETS = process.env.ASSETS_PUBLIC_BASE || 'https://assets.mintface.art';
const SITE = () => process.env.SITE_ORIGIN || 'https://mintface.art';
const ARTIST = () => process.env.EMAIL_TO_ARTIST || 'ryan@mintface.art';

const HOUR = 36e5;
const DAY = 24 * HOUR;
export const HOLD = { card: 7 * DAY, eth: 48 * HOUR };
const CONFIRMATIONS = 2;
const TOLERANCE = 1000n; // ± a thousandth, as wei / 1000

export const STATUSES = ['pending_payment', 'expired', 'paid', 'in_studio', 'painted', 'shipped', 'collected', 'complete', 'refunded'];

const K = {
  order: (id) => `commission:o:${id}`,
  ids: 'commission:ids',
  seq: (year) => `commission:seq:${year}`,
  paid: (id) => `commission:paid:${id}`,
  tx: (hash) => `commission:tx:${String(hash).toLowerCase()}`,
  evt: (id) => `commission:evt:${id}`,
  eth: 'commission:eth',
};

export const commissionsConfigured = () => storeConfigured();

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

export async function getOrder(id) {
  if (!/^SP-\d{4}-\d{4,}$/.test(String(id || ''))) return null;
  const raw = await one('GET', K.order(id));
  if (!raw) return null;
  const o = JSON.parse(raw);
  /* a quote lapses on its own clock: noticed here, kept when it is written */
  if (o.status === 'pending_payment' && Date.parse(o.expires_at) < now()) {
    o.status = 'expired';
    await save(o, 'expired unpaid');
  }
  return o;
}

async function save(o, what = null, note = null) {
  o.updated = iso();
  if (what) (o.history = o.history || []).push({ at: o.updated, what, ...(note ? { note } : {}) });
  await one('SET', K.order(o.id), JSON.stringify(o));
  return o;
}

export const renderUrl = (o) => (o.render_key ? `${ASSETS}/${o.render_key}` : null);
export const sizeLine = (o) => `${o.spec.length_cm} × ${o.spec.width_cm} cm ${o.spec.orientation}`;
const orderData = (id) => `0x${Buffer.from(id).toString('hex')}`;

function reprice(o) {
  o.price.nzd = nzdOf(o.spec);
  o.price.wei = weiOf(o.price.nzd).toString();
  o.price.eth = ethText(BigInt(o.price.wei));
  o.price.usd = o.price.usd_rate ? Math.round(o.price.nzd * o.price.usd_rate) : null;
}

/** COMMISSION: a checked spec becomes an order, with its render. */
export async function createOrder(input) {
  const { spec, error } = checkSpec(input || {});
  if (error) return { error };
  const year = nzYear();
  const seq = await one('INCR', K.seq(year));
  const id = `SP-${year}-${String(seq).padStart(4, '0')}`;
  const key = crypto.randomBytes(18).toString('base64url');
  let usdRate = null;
  try { usdRate = await nzdToUsd(); } catch { /* the USD figure is a guide, and can wait */ }
  const t = now();
  const o = {
    id, key_hash: sha(key), created: iso(t), updated: iso(t), status: 'pending_payment',
    spec, strip_data: stripsOf(spec), render_key: null,
    price: { nzd: 0, eth: '0', wei: '0', usd: null, usd_rate: usdRate, fx_at: usdRate ? iso(t) : null, eth_rate: STRIP_ETH_NZD },
    email: null, name: null, ship_to: null, mention: false, x_handle: null,
    method: null, currency: null, payment_ref: null, paid_at: null, paid_amount: null,
    deposit: false, balance_due: 0,
    expires_at: iso(t + HOLD.card),
    eth: null, notes: [], tracking: null, photos: [], history: [{ at: iso(t), what: 'ordered' }],
  };
  reprice(o);
  /* the picture they saw, kept at the moment they asked for it */
  if (r2Configured()) {
    try {
      o.render_key = await putObject(`commissions/${id}.png`, await renderOf(o), 'image/png');
    } catch (e) { console.error('commission render', id, e.message); }
  }
  await pipe([['SET', K.order(id), JSON.stringify(o)], ['LPUSH', K.ids, id]]);
  return { order: o, key };
}

export const renderOf = (o) => stripPNG({ ...o.spec, strips: o.strip_data });

/** What anybody holding the reference may see: nothing personal. */
export async function publicView(o) {
  const out = {
    id: o.id, status: o.status, created: o.created, expires_at: o.expires_at,
    spec: { length_cm: o.spec.length_cm, width_cm: o.spec.width_cm, orientation: o.spec.orientation, frame: o.spec.frame, delivery: o.spec.delivery, palette_id: o.spec.palette_id },
    spec_line: specLine(o.spec), strips: o.strip_data, render_url: renderUrl(o),
    price: { nzd: o.price.nzd, eth: o.price.eth, usd: o.price.usd, eth_rate: o.price.eth_rate },
    method: o.method, currency: o.currency, paid_at: o.paid_at, lead_weeks: LEAD_WEEKS, deposit: false,
  };
  if (o.eth && o.status === 'pending_payment') {
    const wei = BigInt(o.price.wei);
    const got = BigInt(o.eth.received_wei || '0');
    const uri = `ethereum:${PAY_TO}@1?value=${o.price.wei}`;
    out.eth = {
      address: PAY_TO, ens: PAY_TO_ENS, wei: o.price.wei, amount: o.price.eth, data: orderData(o.id), uri,
      received: ethText(got), remaining: ethText(got >= wei ? 0n : wei - got),
      pending_tx: o.eth.pending_tx || null,
      qr: await QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }),
    };
  }
  return out;
}

/** And what the person who made it may see, with the key. */
export const privateView = async (o) => ({
  ...(await publicView(o)), name: o.name, email: o.email, ship_to: o.ship_to, mention: o.mention, x_handle: o.x_handle,
});

/* -------------------------------------------------------- before payment */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HANDLE = /^@?[A-Za-z0-9_]{1,15}$/;

/** The buyer's details and the delivery, while the order waits for payment. */
export async function updateOrder(id, key, fields = {}) {
  const o = await getOrder(id);
  if (!o) return { error: 'no such order', status: 404 };
  if (!keyOk(o, key)) return { error: 'this order belongs to another browser', status: 403 };
  if (o.status !== 'pending_payment') return { error: `this order is ${o.status.replace('_', ' ')}`, status: 409 };
  if ('name' in fields) o.name = String(fields.name || '').trim().slice(0, 120) || null;
  if ('email' in fields) {
    const e = String(fields.email || '').trim();
    if (e && !EMAIL.test(e)) return { error: 'that email does not look right', status: 400 };
    o.email = e || null;
  }
  if ('ship_to' in fields) o.ship_to = String(fields.ship_to || '').trim().slice(0, 600) || null;
  if ('mention' in fields) o.mention = Boolean(fields.mention);
  if ('x_handle' in fields) {
    const h = String(fields.x_handle || '').trim();
    if (h && !HANDLE.test(h)) return { error: 'that X handle does not look right', status: 400 };
    o.x_handle = h ? h.replace(/^@/, '') : null;
  }
  if ('delivery' in fields && fields.delivery !== o.spec.delivery) {
    if (!['collect', 'shipped'].includes(fields.delivery)) return { error: 'delivery is collect or shipped', status: 400 };
    if (o.eth && BigInt(o.eth.received_wei || '0') > 0n) return { error: 'ETH has already arrived for this order; write to the studio to change it', status: 409 };
    o.spec.delivery = fields.delivery;
    reprice(o);
    await save(o, `delivery: ${fields.delivery}`);
    return { order: o };
  }
  await save(o);
  return { order: o };
}

/** Ready to pay: the details a painting needs to reach somebody. */
export function readyToPay(o) {
  if (!o.name) return 'a name, please';
  if (!o.email) return 'an email, please';
  if (o.spec.delivery === 'shipped' && !o.ship_to) return 'where to ship it, please';
  return null;
}

/* ------------------------------------------------------------------ card */

/** A Stripe Checkout session for the order's own amount, in NZD or USD. */
export async function cardSession(stripe, o, { currency = 'NZD', origin = SITE() } = {}) {
  const cur = currency === 'USD' ? 'USD' : 'NZD';
  let amount = o.price.nzd;
  if (cur === 'USD') {
    const rate = await nzdToUsd();
    o.price.usd_rate = rate;
    o.price.fx_at = iso();
    o.price.usd = Math.round(o.price.nzd * rate);
    amount = o.price.usd;
  }
  o.currency = cur;
  await save(o, `card checkout opened (${cur})`);
  const image = renderUrl(o);
  return stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      quantity: 1,
      price_data: {
        currency: cur.toLowerCase(),
        unit_amount: Math.round(amount * 100),
        product_data: {
          name: `Strip Painting commission · ${o.id} · ${sizeLine(o)}`,
          description: specLine(o.spec),
          ...(image ? { images: [image] } : {}),
        },
      },
    }],
    customer_email: o.email,
    payment_intent_data: { receipt_email: o.email, metadata: { kind: 'commission', commission: o.id } },
    client_reference_id: o.id,
    metadata: { kind: 'commission', commission: o.id, nzd: String(o.price.nzd), currency: cur },
    success_url: `${origin}/commission/${o.id}/paid?session={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/commission/${o.id}`,
    expires_at: Math.floor(now() / 1000) + 60 * 60,
  });
}

/** The webhook's half: a completed session pays its order, once. */
export async function cardPaid(session, eventId) {
  const id = session.metadata && session.metadata.commission;
  if (!id) return { skipped: 'no commission' };
  /* An event seen through to the end is not handled again. It is noted only
     once the order is written, so a retry after a failure still does the work;
     paying is once-only on its own, so doing it twice changes nothing. */
  if (eventId && (await one('EXISTS', K.evt(eventId)))) return { already: 'event' };
  const amount = (session.amount_total || 0) / 100;
  const currency = String(session.currency || 'nzd').toUpperCase();
  const r = await markPaid(id, { method: 'card', ref: session.payment_intent || session.id, amount: `${amount} ${currency}` });
  if (eventId && !r.error) await one('SET', K.evt(eventId), '1', 'EX', String(60 * 60 * 24 * 30));
  return r;
}

/* ------------------------------------------------------------------- ETH */

async function rpc(method, params) {
  const urls = [process.env.ETH_RPC, 'https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org', 'https://1rpc.io/eth'].filter(Boolean);
  let last;
  for (const url of urls) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(6000) });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message);
      return j.result;
    } catch (e) { last = e; }
  }
  throw last || new Error('no rpc');
}

/** PAY WITH ETH: the order now waits for ETH, for 48 hours at the most. */
export async function chooseEth(id, key) {
  const o = await getOrder(id);
  if (!o) return { error: 'no such order', status: 404 };
  if (!keyOk(o, key)) return { error: 'this order belongs to another browser', status: 403 };
  if (o.status !== 'pending_payment') return { error: `this order is ${o.status.replace('_', ' ')}`, status: 409 };
  const missing = readyToPay(o);
  if (missing) return { error: missing, status: 400 };
  if (!o.eth) {
    let block = 0;
    try { block = parseInt(await rpc('eth_blockNumber', []), 16) - 5; } catch { /* the watcher reads from the order's time instead */ }
    o.eth = { chosen_at: iso(), from_block: block, received_wei: '0', txs: [], pending_tx: null, nudged_at: null, surplus_wei: null };
    o.expires_at = iso(Math.min(Date.parse(o.expires_at), now() + HOLD.eth));
    o.method = 'eth';
    await save(o, 'ETH chosen');
    await one('SADD', K.eth, o.id);
  }
  return { order: o };
}

/** A connected wallet hands back its transaction: kept, and checked now. */
export async function reportTx(id, key, hash) {
  const o = await getOrder(id);
  if (!o) return { error: 'no such order', status: 404 };
  if (!keyOk(o, key)) return { error: 'this order belongs to another browser', status: 403 };
  if (!/^0x[0-9a-fA-F]{64}$/.test(String(hash || ''))) return { error: 'that is not a transaction hash', status: 400 };
  if (!o.eth) return { error: 'choose ETH first', status: 409 };
  o.eth.pending_tx = hash.toLowerCase();
  await save(o, 'transaction sent', hash);
  await checkPendingTx(o);
  return { order: (await getOrder(id)) || o };
}

/** A transaction the buyer named, once it is mined twice over and pays us. */
export async function checkPendingTx(o) {
  const hash = o && o.eth && o.eth.pending_tx;
  if (!hash || o.status !== 'pending_payment') return null;
  try {
    const [tx, receipt, head] = await Promise.all([
      rpc('eth_getTransactionByHash', [hash]), rpc('eth_getTransactionReceipt', [hash]), rpc('eth_blockNumber', []),
    ]);
    if (!tx || !receipt) return 'not mined yet';
    if (receipt.status !== '0x1') { o.eth.pending_tx = null; await save(o, 'transaction failed on chain', hash); return 'failed'; }
    if (String(tx.to || '').toLowerCase() !== PAY_TO.toLowerCase()) { o.eth.pending_tx = null; await save(o, 'transaction went elsewhere', hash); return 'wrong address'; }
    const confs = parseInt(head, 16) - parseInt(receipt.blockNumber, 16) + 1;
    if (confs < CONFIRMATIONS) return `${confs} of ${CONFIRMATIONS} confirmations`;
    return credit(o.id, hash, BigInt(tx.value), 'wallet');
  } catch (e) {
    return `not checked: ${e.message}`;
  }
}

/** ETH that arrived for an order: counted once per transaction, paid when it is enough. */
export async function credit(id, hash, wei, how) {
  const claimed = await one('SET', K.tx(hash), id, 'NX');
  if (claimed !== 'OK') return 'already counted';
  const o = await getOrder(id);
  if (!o || !o.eth) return 'no order';
  const got = BigInt(o.eth.received_wei || '0') + wei;
  o.eth.received_wei = got.toString();
  o.eth.txs.push({ hash: hash.toLowerCase(), wei: wei.toString(), at: iso(), how });
  if (o.eth.pending_tx === hash.toLowerCase()) o.eth.pending_tx = null;
  const due = BigInt(o.price.wei);
  const floor = due - due / TOLERANCE;
  if (got > due + due / TOLERANCE) o.eth.surplus_wei = (got - due).toString();
  await save(o, `${ethText(wei)} ETH received`, hash);
  if (got < floor) return `${ethText(got)} of ${o.price.eth} ETH received`;
  const surplus = o.eth.surplus_wei ? ` (surplus ${ethText(BigInt(o.eth.surplus_wei))} ETH to refund by hand)` : '';
  await markPaid(id, { method: 'eth', ref: o.eth.txs[0].hash, amount: `${ethText(got)} ETH${surplus}` });
  return 'paid';
}

/* What the watcher reads: every transfer into the address since the oldest
   order still waiting, from Etherscan, both ordinary and internal (a contract
   wallet pays through an internal transfer). */
async function arrivals(fromBlock) {
  const key = process.env.ETHERSCAN_API_KEY;
  if (!key) throw new Error('ETHERSCAN_API_KEY is not set');
  const ask = async (action) => {
    const q = new URLSearchParams({ chainid: '1', module: 'account', action, address: PAY_TO, startblock: String(fromBlock), endblock: '99999999', sort: 'asc', apikey: key });
    const r = await fetch(`https://api.etherscan.io/v2/api?${q}`, { signal: AbortSignal.timeout(10000) });
    const j = await r.json();
    if (j.status !== '1') return [];
    return j.result;
  };
  const [plain, internal] = await Promise.all([ask('txlist'), ask('txlistinternal')]);
  const head = parseInt(await rpc('eth_blockNumber', []), 16);
  return [...plain, ...internal]
    .filter((t) => String(t.to || '').toLowerCase() === PAY_TO.toLowerCase() && String(t.isError || '0') === '0')
    .filter((t) => head - Number(t.blockNumber) + 1 >= CONFIRMATIONS)
    .map((t) => ({ hash: t.hash, wei: BigInt(t.value), block: Number(t.blockNumber), data: String(t.input || '0x') }));
}

/**
 * The watcher: ETH that arrived for orders waiting on it. A transaction that
 * names an order in its data pays that order, whatever the amount. One that
 * names nothing pays the oldest waiting order it covers to within a thousandth;
 * ETH that matches nothing is left for Ryan.
 */
export async function watchEth() {
  const ids = (await one('SMEMBERS', K.eth)) || [];
  if (!ids.length) return { waiting: 0 };
  const waiting = [];
  for (const id of ids) {
    const o = await getOrder(id);
    if (!o || o.status !== 'pending_payment' || !o.eth) { await one('SREM', K.eth, id); continue; }
    if (o.eth.pending_tx) await checkPendingTx(o);
    const fresh = await getOrder(id);
    if (fresh && fresh.status === 'pending_payment') waiting.push(fresh);
    else await one('SREM', K.eth, id);
  }
  if (!waiting.length) return { waiting: 0 };
  const from = Math.max(0, Math.min(...waiting.map((o) => o.eth.from_block || 0)));
  const seen = await arrivals(from);
  const out = [];
  for (const t of seen) {
    if (await one('EXISTS', K.tx(t.hash))) continue;
    const named = t.data.startsWith('0x') && t.data.length > 2 ? Buffer.from(t.data.slice(2), 'hex').toString('utf8') : '';
    let o = waiting.find((x) => x.id === named && t.block >= (x.eth.from_block || 0));
    if (!o) {
      o = waiting
        .filter((x) => t.block >= (x.eth.from_block || 0) && x.status === 'pending_payment')
        .filter((x) => {
          const owed = BigInt(x.price.wei) - BigInt(x.eth.received_wei || '0');
          const d = t.wei > owed ? t.wei - owed : owed - t.wei;
          return owed > 0n && d <= owed / TOLERANCE;
        })
        .sort((a, b) => Date.parse(a.created) - Date.parse(b.created))[0];
    }
    if (!o) continue;
    const said = await credit(o.id, t.hash, t.wei, named === o.id ? 'named' : 'amount');
    out.push({ id: o.id, hash: t.hash, said });
    if (said === 'paid') o.status = 'paid';
  }
  return { waiting: waiting.length, matched: out };
}

/* ------------------------------------------------------------------ paid */

/**
 * Paid. The order is written first and the side effects after, behind a
 * once-only mark, so a retry that finds the order already paid still sends
 * the emails if the first attempt died before them, and never sends twice.
 */
export async function markPaid(id, { method, ref, amount, note = null, by = null }) {
  const o = await getOrder(id);
  if (!o) return { error: 'no such order' };
  if (o.status === 'pending_payment' || o.status === 'expired') {
    o.status = 'paid';
    o.method = method;
    o.payment_ref = ref || null;
    o.paid_at = iso();
    o.paid_amount = amount || null;
    if (note) o.notes.push({ at: o.paid_at, note, by });
    await save(o, by ? `marked paid by hand (${method})` : `paid by ${method}`, note || ref);
    await one('SREM', K.eth, id);
  }
  const first = await one('SET', K.paid(id), iso(), 'NX');
  if (first !== 'OK') return { order: o, already: true };
  await Promise.all([
    emailBuyerPaid(o).catch((e) => console.error('commission buyer email', id, e.message)),
    emailArtistPaid(o).catch((e) => console.error('commission artist email', id, e.message)),
  ]);
  /* ETH only: card sales stay off the timeline, as every fiat sale does */
  if (o.method === 'eth') {
    await enqueue('commission', {
      id: o.id, size: `${o.spec.length_cm} × ${o.spec.width_cm} cm`, price: `${Number(o.price.eth).toFixed(2)} ETH`,
      image: renderUrl(o), handle: o.mention && o.x_handle ? o.x_handle : null, url: SITE(),
    });
  }
  return { order: o };
}

/* ---------------------------------------------------------------- emails */

const deliveryLine = (o) => (o.spec.delivery === 'shipped' ? `Shipped worldwide, boxed, to:\n${o.ship_to}` : 'Collected from The Line, Hastings. We will write when it is ready.');
const paidLine = (o) => {
  if (o.method === 'eth') return `${o.paid_amount || `${o.price.eth} ETH`} (at ${STRIP_ETH_NZD.toLocaleString('en-NZ')} NZD per ETH)`;
  return o.paid_amount || `NZD ${o.price.nzd.toLocaleString('en-NZ')}`;
};
const pngFor = async (o) => [{ filename: `${o.id}.png`, content: await renderOf(o) }];

async function emailBuyerPaid(o) {
  if (!o.email) return;
  await send({
    to: o.email,
    subject: `Strip Painting ${o.id} ... commissioned`,
    text: `Commissioned.

Reference: ${o.id}
${specLine(o.spec)}
Colours: ${o.spec.palette_id} (${o.spec.colours.map((c) => c.hex).join(' ')})
Paid: ${paidLine(o)} by ${o.method === 'eth' ? 'ETH' : 'card'}

${deliveryLine(o)}

We paint it to this size and these colours. Allow ${LEAD_WEEKS} weeks. We'll send a photograph before it ships.

The painting as you chose it is attached. Questions: reply to this email.

Ryan
MintFace`,
    attachments: await pngFor(o),
  });
}

async function emailArtistPaid(o) {
  await send({
    to: ARTIST(),
    subject: `Strip Painting ${o.id} ... commissioned (${o.method})`,
    text: `${o.id} is paid.

${specLine(o.spec)}
Colours: ${o.spec.palette_id} (${o.spec.colours.map((c) => c.hex).join(' ')})
Paid: ${paidLine(o)} by ${o.method}${o.payment_ref ? `\nRef: ${o.payment_ref}` : ''}

Name: ${o.name || '-'}
Email: ${o.email || '-'}
${deliveryLine(o)}
X: ${o.mention && o.x_handle ? `@${o.x_handle} (mention)` : 'no mention'}

${SITE()}/mintwork/commissions/${o.id}`,
    attachments: [...(await pngFor(o)), { filename: `${o.id}-strips.json`, content: Buffer.from(JSON.stringify({ id: o.id, spec: o.spec, strips: o.strip_data }, null, 1)) }],
  });
}

/** One nudge, an hour after ETH was chosen and nothing has arrived. */
export async function nudgeEth(o) {
  if (!o.email || !o.eth || o.eth.nudged_at || o.status !== 'pending_payment') return false;
  if (now() - Date.parse(o.eth.chosen_at) < HOUR) return false;
  if (BigInt(o.eth.received_wei || '0') > 0n || o.eth.pending_tx) return false;
  o.eth.nudged_at = iso();
  await save(o, 'ETH nudge sent');
  await send({
    to: o.email,
    subject: `Strip Painting ${o.id} ... waiting for ETH`,
    text: `Your Strip Painting is waiting for its ETH.

Send exactly ${o.price.eth} ETH (at ${STRIP_ETH_NZD.toLocaleString('en-NZ')} NZD per ETH)
to ${PAY_TO_ENS} ${PAY_TO}

The quote holds until ${new Date(o.expires_at).toUTCString()}.
${SITE()}/commission/${o.id}

Ryan
MintFace`,
  }).catch((e) => console.error('commission nudge', o.id, e.message));
  return true;
}

/* --------------------------------------------------------------- console */

export async function listOrders({ status = null, limit = 200 } = {}) {
  const ids = (await one('LRANGE', K.ids, '0', String(limit - 1))) || [];
  if (!ids.length) return [];
  const raw = await pipe(ids.map((id) => ['GET', K.order(id)]));
  return raw.filter(Boolean).map((r) => JSON.parse(r))
    .map((o) => (o.status === 'pending_payment' && Date.parse(o.expires_at) < now() ? { ...o, status: 'expired' } : o))
    .filter((o) => !status || o.status === status);
}

/** The studio's hand on an order: a status, a note, tracking, a photograph. */
export async function studioUpdate(id, { status, note, tracking, photo } = {}, by = 'studio') {
  const o = await getOrder(id);
  if (!o) return { error: 'no such order', status: 404 };
  if (status && !STATUSES.includes(status)) return { error: 'no such status', status: 400 };
  const was = o.status;
  if (note) o.notes.push({ at: iso(), note: String(note).slice(0, 2000), by });
  if (tracking) o.tracking = String(tracking).slice(0, 300);
  if (photo) o.photos.push({ at: iso(), key: photo });
  if (status && status !== was) o.status = status;
  await save(o, status && status !== was ? `${was} → ${status}` : 'studio note', note || tracking || photo || null);
  if (status === 'painted' && was !== 'painted' && o.email && o.photos.length) {
    const last = o.photos[o.photos.length - 1];
    await send({
      to: o.email,
      subject: `Strip Painting ${o.id} ... painted`,
      text: `It is painted. Here it is.\n\n${ASSETS}/${last.key}\n\n${o.spec.delivery === 'shipped' ? 'It ships next, boxed. We will send the tracking.' : 'Ready to collect from The Line, Hastings. Reply to arrange a time.'}\n\nRyan\nMintFace`,
    }).catch((e) => console.error('commission painted email', id, e.message));
  }
  if (status === 'shipped' && was !== 'shipped' && o.email) {
    await send({
      to: o.email,
      subject: `Strip Painting ${o.id} ... shipped`,
      text: `It is on its way.${o.tracking ? `\n\nTracking: ${o.tracking}` : ''}\n\nRyan\nMintFace`,
    }).catch((e) => console.error('commission shipped email', id, e.message));
  }
  return { order: o };
}
