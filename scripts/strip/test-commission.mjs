#!/usr/bin/env node
/* Strip Painting commissions (STRIP-CHECKOUT), against the real routes with
 * the store in memory and every outside service stubbed: FX, Resend, the
 * Ethereum RPC and Etherscan. Stripe's webhook is fed events signed with a
 * test secret, so the signature path is the real one.
 *
 *   node scripts/strip/test-commission.mjs
 */
import { readFileSync, existsSync } from 'node:fs';

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
is('"COMMISSIONED · STRIP PAINTING · 120 × 60 CM · 0.41 ETH · @bo_paints", the render as the card', [said.text.split('\n')[0], said.card.kind], ['COMMISSIONED · STRIP PAINTING · 120 × 60 CM · 0.41 ETH · @bo_paints', 'work']);

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
