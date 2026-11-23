#!/usr/bin/env node
/* Strip Painting commissions (STRIP-CHECKOUT), against the real routes with
 * the store in memory and every outside service stubbed: FX, Resend, the
 * Ethereum RPC and Etherscan. Stripe's webhook is fed events signed with a
 * test secret, so the signature path is the real one.
 *
 *   node scripts/strip/test-commission.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

let pass = 0, fail = 0;
const is = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label.padEnd(76) + (ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`));
  ok ? pass++ : fail++;
};

Object.assign(process.env, {
  KV_REST_API_URL: 'http://kv.fake', KV_REST_API_TOKEN: 'fake',
  RESEND_API_KEY: 're_test_fake', EMAIL_TO_ARTIST: 'studio@example.test', EMAIL_FROM: 'MintFace <art@mintface.art>',
  ETHERSCAN_API_KEY: 'fake', STRIPE_SECRET_KEY: 'sk_test_fake', STRIPE_WEBHOOK_SECRET: 'whsec_test_fake',
  SITE_ORIGIN: 'https://mintface.art', STUDIO_PASSWORD: 'pw', STUDIO_SECRET: 'studio-secret', STUDIO_PATH: 'mintwork',
});
delete process.env.ETH_RPC;
delete process.env.CRON_SECRET;

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
    case 'RPUSH': { const l = g(a[0]) || []; l.push(...a.slice(1)); KV.set(a[0], l); return l.length; }
    case 'LRANGE': { const l = g(a[0]) || []; const e = Number(a[2]); return l.slice(Number(a[1]), e < 0 ? l.length + e + 1 : e + 1); }
    case 'SADD': { const s = g(a[0]) || new Set(); a.slice(1).forEach((x) => s.add(x)); KV.set(a[0], s); return 1; }
    case 'SREM': { const s = g(a[0]) || new Set(); a.slice(1).forEach((x) => s.delete(x)); KV.set(a[0], s); return 1; }
    case 'SMEMBERS': return [...(g(a[0]) || [])];
    default: throw new Error(`fake kv: ${C}`);
  }
}
const mail = [];
const chain = { head: 20000000, txs: new Map(), scan: [] };
const PAY_TO = '0xd40B63bF04a44e43fBFE5784bCf22ACaAB34a180';
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url.startsWith('http://kv.fake')) return new Response(JSON.stringify(JSON.parse(init.body).map((c) => ({ result: kv(c) }))));
  if (url.includes('open.er-api.com')) return new Response(JSON.stringify({ rates: { USD: 0.56 } }));
  if (url.includes('api.resend.com')) { mail.push(JSON.parse(init.body)); return new Response(JSON.stringify({ id: `m${mail.length}` })); }
  if (url.includes('api.etherscan.io')) {
    const action = new URL(url).searchParams.get('action');
    return new Response(JSON.stringify({ status: '1', result: action === 'txlist' ? chain.scan : [] }));
  }
  if (/publicnode|drpc|1rpc/.test(url)) {
    const { method, params } = JSON.parse(init.body);
    const hex = (n) => `0x${n.toString(16)}`;
    const t = params && params[0] ? chain.txs.get(String(params[0]).toLowerCase()) : null;
    const result = method === 'eth_blockNumber' ? hex(chain.head)
      : method === 'eth_getTransactionByHash' ? (t ? { hash: t.hash, to: t.to, value: hex(t.wei) } : null)
        : method === 'eth_getTransactionReceipt' ? (t ? { status: '0x1', blockNumber: hex(t.block) } : null) : null;
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }));
  }
  return realFetch(input, init);
};

const route = await import('../../api/commission.js');
const webhook = await import('../../api/webhook.js');
const admin = await import('../../api/commission-admin.js');
const cron = await import('../../api/cron/commissions.js');
const C = await import('../../api/_lib/commissions.js');
const { compose } = await import('../../api/_lib/wire.js');
const { issueSession, cookieHeader } = await import('../../api/_lib/studio.js');
const { default: Stripe } = await import('stripe');

const post = async (body) => { const r = await route.POST(new Request('https://mintface.art/api/commission', { method: 'POST', body: JSON.stringify(body) })); return { status: r.status, j: await r.json() }; };
const get = async (id) => { const r = await route.GET(new Request(`https://mintface.art/api/commission?id=${id}`)); return { status: r.status, j: await r.json() }; };
const spec = (o = {}) => ({ length_cm: 120, width_cm: 60, orientation: 'landscape', frame: 'none', delivery: 'collect', palette_id: 'site-6', ...o });
const wireQueue = () => (KV.get('wire:q') || []).map((id) => JSON.parse(KV.get(`wire:e:${id}`)));
const year = Number(new Intl.DateTimeFormat('en-NZ', { timeZone: 'Pacific/Auckland', year: 'numeric' }).format(new Date()));

console.log('\n— the order, before any payment —');
const made = await post({ action: 'create', spec: spec({ nzd: 1, price: 1 }) });
const A = made.j;
is('COMMISSION makes an order, numbered SP-year-0001, with a key', [made.status, A.id, typeof A.key, A.key.length > 20], [201, `SP-${year}-0001`, 'string', true]);
is('the price is the server\'s: 120 × 60 collected is NZD 2,028 · 0.4056 ETH, whatever the page sent', [A.order.price.nzd, A.order.price.eth], [2028, '0.4056']);
const render = await import('../../api/strip-render.js');
const shown = await (await render.GET(new Request('http://x/api/strip-render?width=60&palette=site-6'))).json();
is('the strips on the order are the strips the home block drew', JSON.stringify(A.order.strips), JSON.stringify(shown.strips));
is('a bad spec is refused', (await post({ action: 'create', spec: spec({ length_cm: 125 }) })).status, 400);
const pub = (await get(A.id)).j;
is('the public view has nothing personal in it', ['name', 'email', 'ship_to', 'x_handle', 'key_hash'].filter((k) => k in pub), []);
is('without the key, nothing changes', (await post({ action: 'update', id: A.id, key: 'nope', name: 'X' })).status, 403);
let u = await post({ action: 'update', id: A.id, key: A.key, name: 'Ada', email: 'ada@example.test' });
is('with it, the buyer\'s details are kept', [u.status, u.j.name, u.j.email], [200, 'Ada', 'ada@example.test']);
u = await post({ action: 'update', id: A.id, key: A.key, delivery: 'shipped' });
is('flipping to shipped reprices: 2,928 · 0.5856 ETH', [u.j.price.nzd, u.j.price.eth, u.j.spec.delivery], [2928, '0.5856', 'shipped']);
is('… and a shipped order cannot pay without an address', (await post({ action: 'eth', id: A.id, key: A.key })).j.error, 'where to ship it, please');
await post({ action: 'update', id: A.id, key: A.key, ship_to: '1 Test St, Hastings' });
is('a bad email is refused', (await post({ action: 'update', id: A.id, key: A.key, email: 'nope' })).status, 400);
is('the public view still says nothing personal', JSON.stringify((await get(A.id)).j).includes('ada@'), false);

console.log('\n— card: the webhook pays it, once —');
const stripe = new Stripe('sk_test_fake');
const hook = async (event) => {
  const payload = JSON.stringify(event);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
  const r = await webhook.POST(new Request('https://mintface.art/api/webhook', { method: 'POST', body: payload, headers: { 'stripe-signature': header } }));
  return r.status;
};
const session = { id: 'cs_test_1', object: 'checkout.session', payment_status: 'paid', amount_total: 292800, currency: 'nzd', payment_intent: 'pi_test_1', metadata: { kind: 'commission', commission: A.id } };
const event = { id: 'evt_1', type: 'checkout.session.completed', data: { object: session } };
const before = mail.length;
is('a signed completed session is accepted', await hook(event), 200);
let o = (await get(A.id)).j;
is('… and the order is paid, by card', [o.status, o.method], ['paid', 'card']);
const sent = mail.slice(before);
is('two emails: the buyer and the studio, each with the render attached', [sent.length, sent.map((m) => m.to).flat().sort(), sent.every((m) => (m.attachments || []).some((a) => a.filename === `${A.id}.png`))], [2, ['ada@example.test', 'studio@example.test'], true]);
is('the buyer\'s says commissioned, the reference, four weeks', [/commissioned/.test(sent.find((m) => m.to === 'ada@example.test').subject), /Allow 4 weeks/.test(sent.find((m) => m.to === 'ada@example.test').text), sent[0].subject.includes(A.id)], [true, true, true]);
is('the studio\'s carries the strip data and the console link', [sent.find((m) => m.to === 'studio@example.test').attachments.some((a) => a.filename.endsWith('-strips.json')), sent.find((m) => m.to === 'studio@example.test').text.includes(`/mintwork/commissions/${A.id}`)], [true, true]);
await hook(event);
await hook({ ...event, id: 'evt_2' });
is('a replayed event, or a second one, sends nothing more', mail.length - before, 2);
is('card commissions stay off the timeline', wireQueue().filter((e) => e.kind === 'commission').length, 0);
is('a paid order cannot be changed, and its doors are gone', [(await post({ action: 'update', id: A.id, key: A.key, name: 'Z' })).status, (await post({ action: 'eth', id: A.id, key: A.key })).status, 'eth' in o], [409, 409, false]);
is('a forged signature is refused', (await webhook.POST(new Request('https://mintface.art/api/webhook', { method: 'POST', body: JSON.stringify(event), headers: { 'stripe-signature': 't=1,v1=bad' } }))).status, 400);

console.log('\n— ETH: a connected wallet, named in the data —');
const B = (await post({ action: 'create', spec: spec({ palette_id: 'site-1' }) })).j;
await post({ action: 'update', id: B.id, key: B.key, name: 'Bo', email: 'bo@example.test', mention: true, x_handle: '@bo_paints' });
const e1 = (await post({ action: 'eth', id: B.id, key: B.key })).j;
is('PAY WITH ETH: the exact amount, the address, the order in the data, a QR', [e1.eth.amount, e1.eth.address, e1.eth.data === `0x${Buffer.from(B.id).toString('hex')}`, e1.eth.qr.startsWith('<svg'), e1.eth.uri.startsWith(`ethereum:${PAY_TO}@1?value=`)], ['0.4056', PAY_TO, true, true, true]);
is('… and the quote holds 48 hours at most', Date.parse(e1.expires_at) - Date.now() <= 48 * 36e5 + 1000, true);
const hashB = `0x${'b'.repeat(64)}`;
chain.txs.set(hashB, { hash: hashB, to: PAY_TO, wei: BigInt(e1.eth.wei), block: chain.head });
await post({ action: 'eth-tx', id: B.id, key: B.key, hash: hashB });
is('one confirmation is not enough', (await get(B.id)).j.status, 'pending_payment');
chain.head += 1;
is('two is: the waiting page sees it paid', (await get(B.id)).j.status, 'paid');
const tw = wireQueue().filter((ev) => ev.kind === 'commission');
is('an ETH commission goes on the wire, with the render, naming the buyer who asked', [tw.length, tw[0] && tw[0].payload.handle, tw[0] && tw[0].payload.price], [1, 'bo_paints', '0.41 ETH']);
const said = compose(tw[0]);
is('"COMMISSIONED · //STRIPS · 120 × 60 CM · 0.41 ETH · @bo_paints", the render as the card', [said.text.split('\n')[0], said.card.kind], ['COMMISSIONED · //STRIPS · 120 × 60 CM · 0.41 ETH · @bo_paints', 'work']);

console.log('\n— ETH: any wallet, matched by the watcher —');
const auth = { headers: { authorization: 'Bearer ' } };
const D = (await post({ action: 'create', spec: spec({ palette_id: 'site-2' }) })).j;
await post({ action: 'update', id: D.id, key: D.key, name: 'Di', email: 'di@example.test' });
const eD = (await post({ action: 'eth', id: D.id, key: D.key })).j.eth;
const near = BigInt(eD.wei) - BigInt(eD.wei) / 2000n; // within a thousandth
chain.scan = [{ hash: `0x${'d'.repeat(64)}`, to: PAY_TO.toLowerCase(), value: near.toString(), blockNumber: String(chain.head - 3), input: '0x', isError: '0' }];
await cron.GET(new Request('https://mintface.art/api/cron/commissions', auth));
o = (await get(D.id)).j;
is('an exact amount from an unconnected wallet pays the order', o.status, 'paid');
is('… and no mention was asked for, so the wire names nobody', wireQueue().filter((ev) => ev.kind === 'commission').pop().payload.handle, null);
await cron.GET(new Request('https://mintface.art/api/cron/commissions', auth));
is('the same transaction is never counted twice', JSON.parse(KV.get(`commission:o:${D.id}`)).eth.txs.length, 1);

console.log('\n— ETH: under, then over —');
const E = (await post({ action: 'create', spec: spec({ palette_id: 'site-3' }) })).j;
await post({ action: 'update', id: E.id, key: E.key, name: 'Ed', email: 'ed@example.test' });
const eE = (await post({ action: 'eth', id: E.id, key: E.key })).j.eth;
const data = `0x${Buffer.from(E.id).toString('hex')}`;
chain.scan = [{ hash: `0x${'e'.repeat(64)}`, to: PAY_TO, value: (BigInt(eE.wei) / 2n).toString(), blockNumber: String(chain.head - 2), input: data, isError: '0' }];
await cron.GET(new Request('https://mintface.art/api/cron/commissions', auth));
o = (await get(E.id)).j;
is('half arrives: still waiting, the page shows what came and what is left', [o.status, o.eth.received, o.eth.remaining], ['pending_payment', '0.2028', '0.2028']);
chain.scan.push({ hash: `0x${'f'.repeat(64)}`, to: PAY_TO, value: (BigInt(eE.wei) / 2n + 10n ** 16n).toString(), blockNumber: String(chain.head - 2), input: data, isError: '0' });
await cron.GET(new Request('https://mintface.art/api/cron/commissions', auth));
const raw = JSON.parse(KV.get(`commission:o:${E.id}`));
is('the rest, and more: paid, the surplus noted for a refund by hand', [raw.status, raw.eth.surplus_wei, /surplus/.test(raw.paid_amount)], ['paid', (10n ** 16n).toString(), true]);

console.log('\n— expiry —');
const F = (await post({ action: 'create', spec: spec() })).j;
const rec = JSON.parse(KV.get(`commission:o:${F.id}`));
rec.expires_at = new Date(Date.now() - 1000).toISOString();
KV.set(`commission:o:${F.id}`, JSON.stringify(rec));
is('a lapsed quote reads expired, and cannot be paid or changed', [(await get(F.id)).j.status, (await post({ action: 'eth', id: F.id, key: F.key })).status, (await post({ action: 'update', id: F.id, key: F.key, name: 'Fi' })).status], ['expired', 409, 409]);

console.log('\n— the console —');
const asStudio = (url, body) => (body ? admin.POST : admin.GET)(new Request(url, { method: body ? 'POST' : 'GET', ...(body ? { body: JSON.stringify(body) } : {}), headers: { cookie: cookieHeader(issueSession()).split(';')[0] } }));
is('without the studio\'s session, nothing', (await admin.GET(new Request('https://mintface.art/api/commission-admin'))).status, 401);
const list = await (await asStudio('https://mintface.art/api/commission-admin')).json();
is('with it: every order, newest first, the buyer named', [list.orders.length, list.orders[0].id, list.orders.find((x) => x.id === A.id).name], [5, F.id, 'Ada']);
is('filtered by status', (await (await asStudio('https://mintface.art/api/commission-admin?status=paid')).json()).orders.length, 4);
is('marking paid by hand needs a reason', (await asStudio('https://mintface.art/api/commission-admin', { id: F.id, action: 'mark-paid', method: 'bank' })).status, 400);
const m0 = mail.length;
const mp = await (await asStudio('https://mintface.art/api/commission-admin', { id: F.id, action: 'mark-paid', method: 'bank', note: 'paid by bank transfer, ref 123' })).json();
is('… and with one, it pays the order and tells the studio (this buyer left no email)', [mp.order.status, mail.length - m0, mail[mail.length - 1].to], ['paid', 1, 'studio@example.test']);
const st = await (await asStudio('https://mintface.art/api/commission-admin', { id: A.id, action: 'status', status: 'shipped', tracking: 'NZP123' })).json();
is('shipped with tracking: kept, and the buyer is told', [st.order.status, st.order.tracking, mail[mail.length - 1].subject.endsWith('shipped')], ['shipped', 'NZP123', true]);
const strips = await asStudio(`https://mintface.art/api/commission-admin?id=${A.id}&strips=1`);
is('DOWNLOAD STRIP DATA is a file of colours and widths', [/attachment/.test(strips.headers.get('content-disposition')), Object.keys((await strips.json()).strips[0]).sort()], [true, ['hex', 'mm']]);

/* COMMISSION-WESTSIDE. Every code here is made up as the test runs, in the
   test store, and checked for afterwards; none is written in this file. */
const studio = async (body) => { const r = await asStudio('https://mintface.art/api/commission-admin', body); return { status: r.status, j: await r.json() }; };
const madeUp = (p) => `${p}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
const BUILDING = '201 Heretaunga Street West, Hastings';
const WEI = (nzdn) => ((BigInt(nzdn) * 10n ** 18n) / 5000n).toString();
const orderRec = (id) => JSON.parse(KV.get(`commission:o:${id}`));
const keep = (o) => KV.set(`commission:o:${o.id}`, JSON.stringify(o));

console.log('\n— the WestSide rate: the price —');
const priced = (s, discount = null) => { const x = { spec: s, discount, price: { usd_rate: 0.56 } }; C.reprice(x); return x.price; };
const atList = priced(spec());
const atRate = priced(spec(), { pct: 40 });
is('without a discount, reprice is as it was: 2,028 · 0.4056 ETH · USD at the rate', [atList.nzd, atList.eth, atList.wei, atList.usd], [2028, '0.4056', WEI(2028), Math.round(2028 * 0.56)]);
is('with 40% off: round(list × 0.6) = 1,217, wei exact at 5,000, USD from the discounted NZD', [atRate.list_nzd, atRate.nzd, atRate.eth, atRate.wei, atRate.usd], [2028, 1217, '0.2434', WEI(1217), Math.round(1217 * 0.56)]);
const framed = priced(spec({ frame: 'black' })).nzd;
is('the 40% comes off the frame too', priced(spec({ frame: 'black' }), { pct: 40 }).nzd, Math.round((framed * 60) / 100));

console.log('\n— the WestSide rate: codes, made in the console —');
const CODE = madeUp('T');
is('code-create refuses bad text: short, a space, an underscore, too long', await Promise.all(['AB1', 'WEST SIDE', 'WEST_SIDE', 'X'.repeat(25)].map(async (code) => (await studio({ action: 'code-create', code })).status)), [400, 400, 400, 400]);
const mk = await studio({ action: 'code-create', code: CODE.toLowerCase() });
is('a good one is kept upper case: WestSide, 40%, the cbd rule, on', [mk.status, mk.j.code.code, mk.j.code.label, mk.j.code.pct, mk.j.code.rule, mk.j.code.active], [201, CODE, 'WestSide', 40, 'cbd', true]);
is('the same code twice is refused', (await studio({ action: 'code-create', code: CODE })).status, 409);
const uses = () => KV.get(`commission:code-uses:${mk.j.code.id}`) || [];

console.log('\n— the WestSide rate: a buyer\'s code —');
const W = (await post({ action: 'create', spec: spec({ palette_id: 'site-4', delivery: 'shipped' }) })).j;
await post({ action: 'update', id: W.id, key: W.key, name: 'Wi', email: 'wi@example.test', ship_to: '9 Somewhere Rd, Auckland' });
let c1 = await post({ action: 'code', id: W.id, key: W.key, code: madeUp('NOPE'), building: BUILDING, fixed: true });
is('a wrong code: 400, "That code isn\'t one of ours.", one try counted', [c1.status, c1.j.error, orderRec(W.id).code_tries], [400, "That code isn't one of ours.", 1]);
c1 = await post({ action: 'code', id: W.id, key: W.key, code: CODE, fixed: true });
is('the right code without a building: "Which building? …"', [c1.status, c1.j.error], [400, 'Which building? The street address, please.']);
c1 = await post({ action: 'code', id: W.id, key: W.key, code: CODE, building: BUILDING });
is('… and without the tick: "Tick the box …"', [c1.status, c1.j.error], [400, "Tick the box if it's going on the building."]);
c1 = await post({ action: 'code', id: W.id, key: W.key, code: ` ${CODE.toLowerCase()} `, building: BUILDING, fixed: true });
is('with both, in any case: shipped becomes collected, NZD 2,028 → 1,217 · 0.2434 ETH', [c1.status, c1.j.spec.delivery, c1.j.price.list_nzd, c1.j.price.nzd, c1.j.price.eth, c1.j.discount.label, c1.j.discount.pct], [200, 'collect', 2028, 1217, '0.2434', 'WestSide', 40]);
is('the private view has the building; the tries are cleared', [c1.j.discount.building, orderRec(W.id).code_tries], [BUILDING, 0]);
const toShip = await post({ action: 'update', id: W.id, key: W.key, delivery: 'shipped' });
is('shipping it afterwards is refused, in Ryan\'s words', [toShip.status, toShip.j.error], [409, "The WestSide rate is for paintings fixed to a Hastings CBD building, so it's collected, not shipped. Remove the code to ship it."]);
const pubW = (await get(W.id)).j;
const pubWText = JSON.stringify(pubW);
is('the public view says WestSide 40%, with neither the code nor the building', [pubW.discount, pubWText.toUpperCase().includes(CODE), pubWText.includes(BUILDING), pubWText.includes('Heretaunga')], [{ label: 'WestSide', pct: 40 }, false, false, false]);
const adminW = await (await asStudio(`https://mintface.art/api/commission-admin?id=${W.id}`)).json();
is('the studio\'s view has the building; the record holds the code\'s id, never its text', [adminW.order.discount.building, adminW.order.discount.by, adminW.order.discount.code_id, KV.get(`commission:o:${W.id}`).toUpperCase().includes(CODE)], [BUILDING, 'buyer', mk.j.code.id, false]);
const off1 = await post({ action: 'uncode', id: W.id, key: W.key });
is('uncode brings back the list price', [off1.status, off1.j.price.nzd, off1.j.discount], [200, 2028, null]);

console.log('\n— the WestSide rate: paid by card —');
await post({ action: 'code', id: W.id, key: W.key, code: CODE, building: BUILDING, fixed: true });
const asked = [];
const fakeStripe = { checkout: { sessions: { create: async (p) => { asked.push(p); return { id: `cs_test_w${asked.length}`, url: 'https://checkout.stripe.test/w' }; } } } };
await C.cardSession(fakeStripe, await C.getOrder(W.id), { currency: 'NZD' });
const lineW = asked[0].line_items[0].price_data;
is('the card line is the discounted NZD × 100, and names the rate', [lineW.currency, lineW.unit_amount, lineW.product_data.description.endsWith(' · WestSide rate, 40% off NZD 2,028'), asked[0].metadata.discount], ['nzd', 121700, true, 'westside-40']);
await C.cardSession(fakeStripe, await C.getOrder(W.id), { currency: 'USD' });
is('… and in USD it is the discounted NZD at the rate', [asked[1].line_items[0].price_data.currency, asked[1].line_items[0].price_data.unit_amount], ['usd', Math.round(1217 * 0.56) * 100]);
const mW = mail.length;
const evW = { id: 'evt_w1', type: 'checkout.session.completed', data: { object: { id: 'cs_test_w1', object: 'checkout.session', payment_status: 'paid', amount_total: 121700, currency: 'nzd', payment_intent: 'pi_test_w', metadata: { kind: 'commission', commission: W.id, discount: 'westside-40' } } } };
await hook(evW);
await hook(evW);
await hook({ ...evW, id: 'evt_w2' });
is('paid by card, and the use counted once however the webhook repeats', [(await get(W.id)).j.status, uses()], ['paid', [W.id]]);
const mailW = mail.slice(mW);
const buyerW = mailW.find((m) => m.to === 'wi@example.test');
const studioW = mailW.find((m) => m.to === 'studio@example.test');
is('the buyer\'s email has the rate under the price', [mailW.length, buyerW.text.includes('by card\nWestSide rate, 40% off (list NZD 2,028).')], [2, true]);
is('the studio\'s has the rate, the building, and the buyer\'s code as the hand', [studioW.text.includes('Rate: WestSide rate, 40% off NZD 2,028'), studioW.text.includes(`Building: ${BUILDING}`), studioW.text.includes('with the buyer\'s code')], [true, true, true]);
is('neither email has the code in it', mailW.some((m) => `${m.subject}\n${m.text}`.toUpperCase().includes(CODE)), false);
is('once paid, the code cannot come off', (await post({ action: 'uncode', id: W.id, key: W.key })).status, 409);

console.log('\n— the WestSide rate: paid in ETH —');
const X = (await post({ action: 'create', spec: spec({ palette_id: 'site-5' }) })).j;
await post({ action: 'update', id: X.id, key: X.key, name: 'Xi', email: 'xi@example.test', mention: true, x_handle: 'xi_walls' });
const ethX0 = (await post({ action: 'eth', id: X.id, key: X.key })).j.eth;
await post({ action: 'code', id: X.id, key: X.key, code: CODE, building: BUILDING, fixed: true });
const ethX = (await post({ action: 'eth', id: X.id, key: X.key })).j.eth;
is('the ETH box moves with the code: 0.4056 → 0.2434, the wei exact, the QR too', [ethX0.amount, ethX.amount, ethX.wei, ethX.uri.endsWith(`value=${WEI(1217)}`)], ['0.4056', '0.2434', WEI(1217), true]);
const named = `0x${Buffer.from(X.id).toString('hex')}`;
const halfX = BigInt(ethX.wei) / 2n;
chain.scan = [{ hash: `0x${'1'.repeat(64)}`, to: PAY_TO, value: halfX.toString(), blockNumber: String(chain.head - 2), input: named, isError: '0' }];
await cron.GET(new Request('https://mintface.art/api/cron/commissions', auth));
is('once ETH has arrived, the code can neither come off nor go on', [(await post({ action: 'uncode', id: X.id, key: X.key })).j.error, (await post({ action: 'code', id: X.id, key: X.key, code: CODE, building: BUILDING, fixed: true })).status], ['ETH has already arrived for this order; write to the studio to change it', 409]);
chain.scan.push({ hash: `0x${'2'.repeat(64)}`, to: PAY_TO, value: (BigInt(ethX.wei) - halfX).toString(), blockNumber: String(chain.head - 2), input: '0x', isError: '0' });
await cron.GET(new Request('https://mintface.art/api/cron/commissions', auth));
is('the watcher matched the discounted wei: paid, and one more use', [(await get(X.id)).j.status, uses().length], ['paid', 2]);
const wireX = wireQueue().filter((ev) => ev.kind === 'commission').pop();
is('the X post leaves the price out and says where it is going', [wireX.payload.price, compose(wireX).text.split('\n')[0]], [null, 'COMMISSIONED · //STRIPS · 120 × 60 CM · FOR A WALL IN THE HASTINGS CBD · @xi_walls']);
is('… with neither the code nor the building in it', [JSON.stringify(wireX).toUpperCase().includes(CODE), JSON.stringify(wireX).includes('Heretaunga')], [false, false]);

console.log('\n— the WestSide rate: wrong guesses —');
const G = (await post({ action: 'create', spec: spec() })).j;
const guesses = [];
for (let i = 0; i < 10; i += 1) guesses.push((await post({ action: 'code', id: G.id, key: G.key, code: madeUp('GUESS'), building: BUILDING, fixed: true })).status);
is('ten wrong codes: ten 400s, each counted on the order', [guesses.filter((s) => s === 400).length, orderRec(G.id).code_tries], [10, 10]);
const g11 = await post({ action: 'code', id: G.id, key: G.key, code: CODE, building: BUILDING, fixed: true });
is('the 11th try is locked out for an hour, the right code or not', [g11.status, g11.j.error, Math.round((Date.parse(orderRec(G.id).code_locked_until) - Date.now()) / 6e4)], [429, 'Too many tries. Try again in an hour, or write to the studio.', 60]);
const lockedG = orderRec(G.id);
lockedG.code_locked_until = new Date(Date.now() - 1000).toISOString();
keep(lockedG);
is('an hour on, the right code works', (await post({ action: 'code', id: G.id, key: G.key, code: CODE, building: BUILDING, fixed: true })).j.price.nzd, 1217);

console.log('\n— the WestSide rate: ended, switched off, used up —');
const ENDED = madeUp('E');
const OFF = madeUp('O');
const ONE = madeUp('N');
await studio({ action: 'code-create', code: ENDED, ends: '2020-01-31' });
await studio({ action: 'code-create', code: OFF });
await studio({ action: 'code-create', code: ONE, max_uses: 1 });
const offd = await studio({ action: 'code-active', code: OFF, active: false });
const tryOn = async (who, code) => post({ action: 'code', id: who.id, key: who.key, code, building: BUILDING, fixed: true });
const L = (await post({ action: 'create', spec: spec() })).j;
const endedSay = await tryOn(L, ENDED);
is('an ended code is refused, and says so differently from an unknown one', [endedSay.status, endedSay.j.error], [400, 'That code has ended.']);
is('a code switched off is refused', [offd.j.code.active, (await tryOn(L, OFF)).j.error], [false, 'That code has ended.']);
const P1 = (await post({ action: 'create', spec: spec() })).j;
const P2 = (await post({ action: 'create', spec: spec() })).j;
is('a code with one use left goes on two waiting orders', [(await tryOn(P1, ONE)).status, (await tryOn(P2, ONE)).status], [200, 200]);
await studio({ id: P2.id, action: 'mark-paid', method: 'bank', note: 'test: paid by transfer' });
is('one pays: the code is at its limit, and a new order is refused', (await tryOn(L, ONE)).j.error, 'That code has ended.');
await hook({ id: 'evt_p1', type: 'checkout.session.completed', data: { object: { id: 'cs_test_p1', object: 'checkout.session', payment_status: 'paid', amount_total: 121700, currency: 'nzd', payment_intent: 'pi_test_p1', metadata: { kind: 'commission', commission: P1.id } } } });
is('… but the order already holding it still pays, at its rate', [(await get(P1.id)).j.status, (await get(P1.id)).j.price.nzd], ['paid', 1217]);

console.log('\n— the WestSide rate: the studio\'s hand —');
const H = (await post({ action: 'create', spec: spec({ delivery: 'shipped' }) })).j;
await post({ action: 'update', id: H.id, key: H.key, name: 'Hu', email: 'hu@example.test', ship_to: '3 Away Lane, Napier' });
await post({ action: 'eth', id: H.id, key: H.key });
const lapse = orderRec(H.id);
lapse.expires_at = new Date(Date.now() - 1000).toISOString();
keep(lapse);
is('an ETH quote that lapsed reads expired', (await get(H.id)).j.status, 'expired');
is('the studio\'s rate needs a building and a note', [(await studio({ id: H.id, action: 'discount', note: 'x' })).status, (await studio({ id: H.id, action: 'discount', building: BUILDING })).status], [400, 400]);
is('… and a pct from 1 to 90', (await studio({ id: H.id, action: 'discount', pct: 95, building: BUILDING, note: 'x' })).status, 400);
const dH = (await studio({ id: H.id, action: 'discount', building: BUILDING, note: 'WestSide, fixed to the test building' })).j.order;
is('on a lapsed order it reopens it for 7 days: collected, 40% off, by the studio', [dH.status, Math.round((Date.parse(dH.expires_at) - Date.now()) / 36e5), dH.spec.delivery, dH.price.nzd, dH.discount.by, dH.discount.code_id, dH.history.some((h) => h.what === 'reopened for the WestSide rate')], ['pending_payment', 168, 'collect', 1217, 'studio', null, true]);
is('… the lapsed ETH quote cleared, to start again at the new amount', [dH.eth, dH.method, (KV.get('commission:eth') || new Set()).has(H.id)], [null, null, false]);
const readH = (await post({ action: 'read', id: H.id, key: H.key })).j;
is('the buyer\'s page has the new price on reload', [readH.status, readH.price.nzd, readH.discount.by], ['pending_payment', 1217, 'studio']);
is('removing it needs a note too, then the list price is back', [(await studio({ id: H.id, action: 'undiscount' })).status, (await studio({ id: H.id, action: 'undiscount', note: 'test' })).j.order.price.nzd], [400, 2028]);
const dPaid = await studio({ id: F.id, action: 'discount', building: BUILDING, note: 'too late' });
is('on a paid order it is refused, with the refund wording', [dPaid.status, dPaid.j.error], [409, 'already paid: refund the difference by hand in Stripe or ETH']);
const listed = await (await asStudio('https://mintface.art/api/commission-admin')).json();
is('the console list tags the WestSide orders', [listed.orders.find((x) => x.id === W.id).discount, listed.orders.find((x) => x.id === A.id).discount], [{ label: 'WestSide', pct: 40 }, null]);
const codesNow = (await (await asStudio('https://mintface.art/api/commission-admin?codes=1')).json()).codes;
const ours = codesNow.find((c) => c.code === CODE);
is('?codes=1: every code, with the orders that paid with it and their NZD', [codesNow.length, ours.uses.slice().sort(), ours.paid_nzd], [4, [W.id, X.id].sort(), 1217 * 2]);
is('… and the studio\'s own rate counts as no code\'s use', codesNow.every((c) => !c.uses.includes(H.id)), true);

console.log('\n— a new pay link, from the console —');
const pl = await studio({ id: H.id, action: 'pay-link' });
const newKey = pl.status === 200 ? new URL(pl.j.url).hash.replace(/^#k=/, '') : '';
is('NEW PAY LINK: the order\'s page with a fresh key after the #', [pl.status, pl.j.url.startsWith(`https://mintface.art/commission/${H.id}#k=`), newKey.length > 20, newKey !== H.key], [200, true, true, true]);
is('the new key opens the order in any browser; the old one no longer does', [(await post({ action: 'read', id: H.id, key: newKey })).status, (await post({ action: 'read', id: H.id, key: H.key })).status], [200, 403]);
is('the key is kept only as its hash: not in the record, its history, or the studio\'s view', [KV.get(`commission:o:${H.id}`).includes(newKey), JSON.stringify(pl.j.order).includes(newKey), 'key_hash' in pl.j.order, orderRec(H.id).history.at(-1).what], [false, false, false, 'new pay link made by the studio (the old link no longer opens it)']);
is('the buyer pays with it as before', (await post({ action: 'update', id: H.id, key: newKey, name: 'Hu Again' })).j.name, 'Hu Again');
is('a paid order gets no pay link', [(await studio({ id: F.id, action: 'pay-link' })).status], [409]);
is('… and nobody without the studio\'s session gets one', (await admin.POST(new Request('https://mintface.art/api/commission-admin', { method: 'POST', body: JSON.stringify({ id: H.id, action: 'pay-link' }) }))).status, 401);

console.log('\n— the WestSide rate: no code in the repo —');
const codeTerms = [CODE, ENDED, OFF, ONE, ['WEST', 'SIDE', '40'].join('')];
const root = new URL('../../', import.meta.url).pathname;
const found = spawnSync('git', ['grep', '-I', '-i', '-l', '-F', ...codeTerms.flatMap((t) => ['-e', t])], { cwd: root, encoding: 'utf8' });
if (found.status === 0 || found.status === 1) is('no tracked file holds a made-up code, or the suggested one', found.stdout.trim(), '');
else console.log('  skip the repo grep: no git here');
is('no email, wire event or order record holds one either', codeTerms.slice(0, 4).filter((t) => [...mail.map((m) => `${m.subject}\n${m.text}`), ...wireQueue().map((ev) => JSON.stringify(ev)), ...[...KV.keys()].filter((k) => k.startsWith('commission:o:')).map((k) => KV.get(k))].join('\n').toUpperCase().includes(t)), []);

console.log('\n— nothing personal in public, and the secret kept —');
const state = readFileSync(new URL('../../data/state.json', import.meta.url), 'utf8');
is('data/state.json holds no email', /"email"\s*:\s*"[^"]/.test(state), false);
const readSrc = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
is('the webhook and reserve keep contacts privately, not in state or a commit message', [/collector: \{ email/.test(readSrc('api/webhook.js')), /\$\{email\} until/.test(readSrc('api/reserve.js')), /keepContact\('reserve'/.test(readSrc('api/reserve.js'))], [false, false, true]);
const spec2 = new URL('../../docs/STRIP-PAGE.md', import.meta.url);
let terms = (process.env.STRIP_SECRET_TERMS || '').split('|').filter(Boolean);
if (!terms.length && existsSync(spec2)) {
  const line = readFileSync(spec2, 'utf8').split('\n').find((l) => /greps the built page for/.test(l)) || '';
  terms = [...line.slice(line.indexOf('greps the built page for')).matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}
if (!terms.length) console.log('  skip the secret grep: no docs/STRIP-PAGE.md here and no STRIP_SECRET_TERMS');
else {
  const bundle = [readSrc('commission.html'), readSrc('commission.js'), readSrc('mintwork/commissions.html'), JSON.stringify(pub),
    ...mail.map((m) => `${m.subject}\n${m.text}\n${(m.attachments || []).filter((a) => /json/.test(a.filename)).map((a) => Buffer.from(a.content.data || a.content).toString()).join('\n')}`)].join('\n');
  is(`none of the ${terms.length} guarded terms is in the checkout, the console or the emails`, terms.filter((t) => bundle.includes(t)).length, 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
