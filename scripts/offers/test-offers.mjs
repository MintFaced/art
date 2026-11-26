#!/usr/bin/env node
/* Private offers (COMPOSITION-32 §3), against the real routes with the store in
 * memory and every outside service stubbed: Resend, GitHub's contents API (for
 * data/state.json) and Stripe's session API. Stripe's webhook is fed events
 * signed with a test secret, so the signature path is the real one. The site's
 * own data files are read from this checkout.
 *
 *   node scripts/offers/test-offers.mjs
 *
 * The GST number here is a made-up stand-in. The real one lives in Vercel.
 */
import { readFileSync, existsSync } from 'node:fs';

let pass = 0, fail = 0;
const is = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label.padEnd(76) + (ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`));
  ok ? pass++ : fail++;
};
const ROOT = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const FAKE_GST = '000-000-000';

Object.assign(process.env, {
  KV_REST_API_URL: 'http://kv.fake', KV_REST_API_TOKEN: 'fake',
  RESEND_API_KEY: 're_test_fake', EMAIL_TO_ARTIST: 'studio@example.test', EMAIL_FROM: 'MintFace <art@mintface.art>',
  STRIPE_SECRET_KEY: 'sk_test_fake', STRIPE_WEBHOOK_SECRET: 'whsec_test_fake', GITHUB_TOKEN: 'ghp_test_fake',
  SITE_ORIGIN: 'https://mintface.art', STUDIO_PASSWORD: 'pw', STUDIO_SECRET: 'studio-secret', STUDIO_PATH: 'mintwork',
});
delete process.env.MINTFACE_GST_NUMBER;
delete process.env.EMAIL_BCC;

/* ---------------------------------------------------------- the fakes */
const KV = new Map();
function kv([cmd, ...a]) {
  const C = cmd.toUpperCase(); const g = (k) => KV.get(k);
  switch (C) {
    case 'GET': { const v = g(a[0]); return typeof v === 'string' ? v : null; }
    case 'SET': if (a.includes('NX') && KV.has(a[0])) return null; KV.set(a[0], a[1]); return 'OK';
    case 'EXISTS': return KV.has(a[0]) ? 1 : 0;
    case 'INCR': { const v = Number(g(a[0]) || 0) + 1; KV.set(a[0], String(v)); return v; }
    case 'LPUSH': { const l = g(a[0]) || []; l.unshift(...a.slice(1).reverse()); KV.set(a[0], l); return l.length; }
    case 'LRANGE': { const l = g(a[0]) || []; const e = Number(a[2]); return l.slice(Number(a[1]), e < 0 ? l.length + e + 1 : e + 1); }
    default: throw new Error(`fake kv: ${C}`);
  }
}
const mail = [];
const commits = [];
let stateFile = { works: {} };
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url.startsWith('http://kv.fake')) return new Response(JSON.stringify(JSON.parse(init.body).map((c) => ({ result: kv(c) }))));
  if (url.includes('api.resend.com')) { mail.push(JSON.parse(init.body)); return new Response(JSON.stringify({ id: `m${mail.length}` })); }
  if (url.startsWith('https://api.github.com/') && url.includes('/contents/data/state.json')) {
    if ((init.method || 'GET') === 'PUT') {
      const b = JSON.parse(init.body);
      stateFile = JSON.parse(Buffer.from(b.content, 'base64').toString('utf8'));
      commits.push({ message: b.message, body: Buffer.from(b.content, 'base64').toString('utf8') });
      return new Response(JSON.stringify({ content: { sha: `s${commits.length}` } }), { status: 200 });
    }
    return new Response(JSON.stringify({ sha: `s${commits.length}`, content: Buffer.from(JSON.stringify(stateFile)).toString('base64') }));
  }
  if (url.startsWith('https://mintface.art/')) {
    const p = new URL(url).pathname.slice(1);
    return existsSync(new URL(p, ROOT)) ? new Response(read(p), { headers: { 'content-type': 'application/json' } }) : new Response('not found', { status: 404 });
  }
  throw new Error(`unexpected fetch ${url}`);
};

const route = await import('../../api/offer.js');
const admin = await import('../../api/offer-admin.js');
const webhook = await import('../../api/webhook.js');
const O = await import('../../api/_lib/offers.js');
const { issueSession, cookieHeader } = await import('../../api/_lib/studio.js');
const { default: Stripe } = await import('stripe');

const asked = [];
const expired = [];
route.deps.stripe = () => ({ checkout: { sessions: { create: async (p) => { asked.push(p); return { id: `cs_test_${asked.length}`, url: 'https://checkout.stripe.test/o' }; } } } });

const cookie = cookieHeader(issueSession()).split(';')[0];
const asStudio = (body, { signedIn = true, q = '' } = {}) => (body ? admin.POST : admin.GET)(new Request(`https://mintface.art/api/offer-admin${q}`, {
  method: body ? 'POST' : 'GET', ...(body ? { body: JSON.stringify(body) } : {}), headers: signedIn ? { cookie } : {},
}));
const studio = async (body, opts) => { const r = await asStudio(body, opts); return { status: r.status, j: await r.json() }; };
const view = async (id, key) => {
  const r = await route.GET(new Request(`https://mintface.art/api/offer?id=${id}`, { headers: key ? { 'x-offer-key': key } : {} }));
  return { status: r.status, j: await r.json() };
};
const pay = async (body) => { const r = await route.POST(new Request('https://mintface.art/api/offer', { method: 'POST', body: JSON.stringify(body) })); return { status: r.status, j: await r.json() }; };
const keyOf = (link) => new URL(link).hash.replace('#k=', '');
const year = Number(new Intl.DateTimeFormat('en-NZ', { timeZone: 'Pacific/Auckland', year: 'numeric' }).format(new Date()));
const SHAUN = { action: 'create', workId: 'composition-32-1', nzd: 1000, gst_inclusive: true, buyer_name: 'Shaun Peterson', buyer_email: null, delivery: 'collect', days: 14, note: 'Composition 32, sold at The Line' };

console.log('\n— GST —');
is('1,000 gives 130.43', O.gstOf(1000), 130.43);
is('23 gives 3.00', O.gstOf(23).toFixed(2), '3.00');
is('0.01 gives 0.00', O.gstOf(0.01).toFixed(2), '0.00');

console.log('\n— the studio makes an offer —');
is('not signed in: refused', (await studio(null, { signedIn: false })).status, 401);
const noGst = await studio(SHAUN);
is('with no MINTFACE_GST_NUMBER, a GST-inclusive offer is refused', [noGst.status, noGst.j.error], [409, 'Set MINTFACE_GST_NUMBER first, so the receipt is a proper tax receipt.']);
is('... and nothing was made', (KV.get('offer:ids') || []).length, 0);
is('the console says the number is missing', (await studio(null)).j.gst_number_set, false);
process.env.MINTFACE_GST_NUMBER = FAKE_GST;
is('a work that isn\'t in the catalogue is refused', (await studio({ ...SHAUN, workId: 'no-such-work-1' })).status, 404);
is('a buyer\'s name is required', (await studio({ ...SHAUN, buyer_name: '  ' })).status, 400);
const made = await studio(SHAUN);
const A = made.j.offer;
const keyA = keyOf(made.j.link);
is('made: OF-year-0001, 14 days, open', [made.status, A.id, A.state, A.days], [201, `OF-${year}-0001`, 'open', 14]);
is('the link is /pay/<id>#k=<key>, the key 32 hex', [made.j.link.startsWith(`https://mintface.art/pay/${A.id}#k=`), /^[0-9a-f]{32}$/.test(keyA)], [true, true]);
const kept = KV.get(`offer:${A.id}`);
is('only the key\'s hash is kept: the key is nowhere in the store', [kept.includes(keyA), [...KV.values()].some((v) => typeof v === 'string' && v.includes(keyA))], [false, false]);
is('the console never shows the hash', JSON.stringify((await studio(null, { q: `?id=${A.id}` })).j).includes('key_hash'), false);
is('it took the work from the catalogue: title, spec, image', [A.item.title, A.spec_line, A.item.image], ['Composition 32', 'Acrylic on canvas · 1200 × 600 mm', '/composition-32-by-mintface.jpg']);
const lapse = 1000 * 60 * 60 * 24 * 14;
is('it ends in 14 days by default', Math.abs(Date.parse(A.expires) - Date.parse(A.created) - lapse) < 5000, true);

console.log('\n— the buyer\'s page —');
const v = await view(A.id, keyA);
is('the right key: the work, the amount, the GST, the name, collected', [v.status, v.j.work.title, v.j.work.spec_line, v.j.nzd, v.j.gst, v.j.gst_inclusive, v.j.buyer_name, v.j.buyer_first_name, v.j.delivery_line],
  [200, 'Composition 32', 'Acrylic on canvas · 1200 × 600 mm', 1000, 130.43, true, 'Shaun Peterson', 'Shaun', 'Collected from The Line, Hastings.']);
is('no email address in it, nor the hash', /@|key_hash/.test(JSON.stringify(v.j)), false);
is('a wrong key returns 403', [(await view(A.id, 'f'.repeat(32))).status, (await view(A.id, 'f'.repeat(32))).j.error], [403, 'This link belongs to someone else.']);
is('no key returns 403, and so does an id that doesn\'t exist', [(await view(A.id, null)).status, (await view(`OF-${year}-9999`, keyA)).status], [403, 403]);

console.log('\n— card —');
const c = await pay({ action: 'card', id: A.id, key: keyA, nzd: 1, amount: 1, unit_amount: 100 });
const s = asked[asked.length - 1];
is('a session opens', [c.status, c.j.url], [200, 'https://checkout.stripe.test/o']);
is('the browser can\'t change the amount: NZD 1,000 whatever it sends', [s.line_items[0].price_data.currency, s.line_items[0].price_data.unit_amount], ['nzd', 100000]);
is('line item and description', [s.line_items[0].price_data.product_data.name, s.line_items[0].price_data.product_data.description],
  ['Composition 32 ... painting', 'Includes GST of NZD 130.43 · Collected from The Line, Hastings']);
is('metadata says offer, which, and the work', s.metadata, { kind: 'offer', offer: A.id, workId: 'composition-32-1' });
is('billing address and phone required', [s.billing_address_collection, s.phone_number_collection.enabled], ['required', true]);
is('collected: no "shipping included worldwide" text anywhere', /worldwide|Shipping is included/i.test(JSON.stringify(s)), false);
is('the session lasts an hour', Math.abs(s.expires_at - (Math.floor(Date.now() / 1000) + 3600)) < 5, true);
is('it comes back to /pay/<id>', [s.success_url, s.cancel_url], [`https://mintface.art/pay/${A.id}?paid=1`, `https://mintface.art/pay/${A.id}`]);
is('a wrong key can\'t open a checkout', (await pay({ action: 'card', id: A.id, key: 'f'.repeat(32) })).status, 403);
delete process.env.MINTFACE_GST_NUMBER;
is('with the GST number gone, a GST-inclusive checkout won\'t open', (await pay({ action: 'card', id: A.id, key: keyA })).status, 503);
process.env.MINTFACE_GST_NUMBER = FAKE_GST;

console.log('\n— expired, cancelled, a new link —');
const B = (await studio({ ...SHAUN, buyer_name: 'Bea Test', buyer_email: 'bea@example.test', days: 3 }));
const rec = JSON.parse(KV.get(`offer:${B.j.offer.id}`));
rec.expires = new Date(Date.now() - 1000).toISOString();
KV.set(`offer:${B.j.offer.id}`, JSON.stringify(rec));
const ended = await view(B.j.offer.id, keyOf(B.j.link));
is('an expired offer returns 410, with the ended wording', [ended.status, ended.j.state, ended.j.error], [410, 'expired', 'This offer has ended. Write to the studio.']);
is('... and refuses a checkout', (await pay({ action: 'card', id: B.j.offer.id, key: keyOf(B.j.link) })).status, 410);
const page = read('pay.js');
is('the page shows the ended state on a 410', [/status === 410\) return done\(MSG\.ended/.test(page), page.includes("ended: 'This offer has ended. Write to the studio.'")], [true, true]);
is('... and the paid and someone-else states', [page.includes("paid: 'Paid. Thank you.'"), page.includes("someoneElse: 'This link belongs to someone else.'")], [true, true]);
const nl = await studio({ action: 'newlink', id: B.j.offer.id });
is('New link reopens it for another stretch, with a fresh key', [nl.status, nl.j.offer.state, keyOf(nl.j.link) !== keyOf(B.j.link)], [200, 'open', true]);
is('New link makes the old key 403', [(await view(B.j.offer.id, keyOf(B.j.link))).status, (await view(B.j.offer.id, keyOf(nl.j.link))).status], [403, 200]);
const C = await studio({ ...SHAUN, buyer_name: 'Cy Test' });
const cn = await studio({ action: 'cancel', id: C.j.offer.id });
is('Cancel', [cn.status, cn.j.offer.state], [200, 'cancelled']);
is('a cancelled offer refuses card checkout', (await pay({ action: 'card', id: C.j.offer.id, key: keyOf(C.j.link) })).status, 410);
is('a cancelled offer can\'t get a new link', (await studio({ action: 'newlink', id: C.j.offer.id })).status, 409);

console.log('\n— the webhook pays it, once —');
const stripe = new Stripe('sk_test_fake');
const hook = async (event) => {
  const payload = JSON.stringify(event);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
  const r = await webhook.POST(new Request('https://mintface.art/api/webhook', { method: 'POST', body: payload, headers: { 'stripe-signature': header } }));
  return r.status;
};
const session = {
  id: 'cs_test_1', object: 'checkout.session', payment_status: 'paid', amount_total: 100000, currency: 'nzd', payment_intent: 'pi_test_offer_1',
  customer_details: { email: 'shaun@example.test', name: 'Shaun Peterson', phone: '+64 21 000 0000', address: { line1: '1 Test St', city: 'Hastings', country: 'NZ' } },
  metadata: { kind: 'offer', offer: A.id, workId: 'composition-32-1' },
};
const abandon = await hook({ id: 'evt_x', type: 'checkout.session.expired', data: { object: { ...session, payment_status: 'unpaid' } } });
is('an expired session leaves the offer open', [abandon, (await view(A.id, keyA)).j.state], [200, 'open']);
const event = { id: 'evt_1', type: 'checkout.session.completed', data: { object: session } };
const before = mail.length;
is('a signed completed session is accepted', await hook(event), 200);
const paid = await view(A.id, keyA);
is('the offer is paid', [paid.status, paid.j.state, typeof paid.j.paid_at], [200, 'paid', 'string']);
const whole = (await studio(null, { q: `?id=${A.id}` })).j.offer;
is('payment_ref and paid_at written', [whole.payment_ref, Boolean(whole.paid_at), whole.receipt_to], ['pi_test_offer_1', true, 'shaun@example.test']);
await hook(event);
await hook({ ...event, id: 'evt_2' });
const sent = mail.slice(before);
is('a replayed event, or a second one, pays once and sends two emails once', [sent.length, sent.map((m) => m.to).flat().sort(), commits.length], [2, ['shaun@example.test', 'studio@example.test'], 1]);
const receipt = sent.find((m) => [m.to].flat().includes('shaun@example.test'));
is('the buyer\'s email is a thank-you with a tax receipt', [/Thank you/.test(receipt.text), /TAX RECEIPT/.test(receipt.text)], [true, true]);
is('... seller, GST number, buyer, the work, the total and 130.43', [
  receipt.text.includes('Seller: MintFace (Ryan Jennings)'), receipt.text.includes(`GST number: ${FAKE_GST}`), receipt.text.includes('Buyer: Shaun Peterson'),
  receipt.text.includes('Composition 32, acrylic on canvas, 1200 × 600 mm'), receipt.text.includes('Total: NZD 1,000.00 incl. GST'), receipt.text.includes('GST: NZD 130.43')], [true, true, true, true, true, true]);
is('... and the date, in New Zealand', receipt.text.includes(`Date: ${new Intl.DateTimeFormat('en-NZ', { timeZone: 'Pacific/Auckland', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())}`), true);
const note = sent.find((m) => [m.to].flat().includes('studio@example.test'));
is('the studio\'s: "Paid: Composition 32, Shaun Peterson, NZD 1,000 incl. GST."', [note.subject, note.text.startsWith('Paid: Composition 32, Shaun Peterson, NZD 1,000 incl. GST.')], ['Paid: Composition 32, Shaun Peterson, NZD 1,000 incl. GST', true]);
const st = stateFile.works['composition-32-1'];
is('the work stays acquired, with the collector name the catalogue shows', [st.status, st.sold_out, st.collector.display_name], ['acquired', true, 'Shaun Peterson']);
is('state.json and its commit carry no email, no price, no payment ref', [/@|1000|130\.43|pi_test/.test(commits[0].body), /@|1000|pi_test/.test(commits[0].message)], [false, false]);
is('a paid offer can\'t be cancelled or re-linked, nor checked out again', [(await studio({ action: 'cancel', id: A.id })).status, (await studio({ action: 'newlink', id: A.id })).status, (await pay({ action: 'card', id: A.id, key: keyA })).status], [409, 409, 409]);
const list = (await studio(null)).j.offers;
is('the console lists open, paid and cancelled offers', [...new Set(list.map((o) => o.state))].sort(), ['cancelled', 'open', 'paid']);

console.log('\n— copy and privacy —');
const files = ['api/_lib/offers.js', 'api/offer.js', 'api/offer-admin.js', 'pay.html', 'pay.js', 'mintwork/offers.html', 'f-buy.js', 'data/f/composition-32.json'];
is('no em dash in any new copy', files.filter((f) => /—/.test(read(f))), []);
is('the GST number is read from the environment only, never written here', files.filter((f) => /\d{2,3}-\d{3}-\d{3}/.test(read(f))), []);
is('offers keep emails out of state.json (the reserve rule)', /buyer_email|receipt_to/.test(read('api/_lib/offers.js').split('async function recordSale')[1].split('/* ----')[0]), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
