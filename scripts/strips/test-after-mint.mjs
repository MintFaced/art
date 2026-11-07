#!/usr/bin/env node
/* Everything after the mint, on a local chain with a stand-in store: the
 * console's street works, the tweet bot, the app's manifest, redemption orders,
 * the freeze, the register's clock, and the design page in a browser.
 */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { decodeEventLog, parseEther } from 'viem';
import { privateKeyToAccount, mnemonicToAccount } from 'viem/accounts';
import { startChain, deployStack } from './chain.mjs';

const require = createRequire(new URL('../../contracts/package.json', import.meta.url));
const { chromium } = require('playwright');
const SHOTS = process.env.STRIPS_SHOTS || '';

let fails = 0, passes = 0;
const str = (v) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x));
const is = (name, got, want) => { const ok = str(got) === str(want); ok ? passes += 1 : fails += 1; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` :: got ${str(got)}, wanted ${str(want)}`}`); };

/* Upstash, as far as kv.js can tell */
const KV = new Map();
const kv = createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const cmds = JSON.parse(Buffer.concat(chunks));
    const out = cmds.map(([op, key, ...rest]) => {
      if (op === 'GET') return { result: KV.has(key) ? KV.get(key) : null };
      if (op === 'SET') { if (rest.includes('NX') && KV.has(key)) return { result: null }; KV.set(key, rest[0]); return { result: 'OK' }; }
      if (op === 'INCR') { const n = Number(KV.get(key) || 0) + 1; KV.set(key, String(n)); return { result: n }; }
      if (op === 'LPUSH') { KV.set(key, JSON.stringify([rest[0], ...JSON.parse(KV.get(key) || '[]')])); return { result: 1 }; }
      if (op === 'DEL') { KV.delete(key); return { result: 1 }; }
      return { result: null };
    });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(out));
  });
});
await new Promise((ok) => kv.listen(0, '127.0.0.1', ok));
process.env.KV_REST_API_URL = `http://127.0.0.1:${kv.address().port}`;
process.env.KV_REST_API_TOKEN = 'test';
process.env.STRIPS_RPC = `http://127.0.0.1:${process.env.STRIPS_ANVIL_PORT || 8547}`;
process.env.STRIPS_VOUCHER_KEY = `0x${'5a'.repeat(32)}`;
process.env.STUDIO_PASSWORD = 'pw'; process.env.STUDIO_SECRET = 'studio-secret'; process.env.STUDIO_PATH = 'mintwork';

const chain = await startChain();
let site, browser;
try {
  const { client, wallet } = chain;
  const s = await deployStack(chain, { signer: privateKeyToAccount(process.env.STRIPS_VOUCHER_KEY).address });
  const { core, coordinator, ext, ledger, send, owner, estate } = s;
  process.env.STRIPS_DEPLOYMENT = JSON.stringify({ chain_id: 31337, core: core.address, extension: ext.address, ledger: ledger.address, renderer: s.renderer.address, first_block: 0 });

  const { draftFor, saveDesign, signDesign, txFor, consoleView, sizeOfSite, setCheck } = await import('../../api/_lib/strips-console.js');
  const { checkMintSpec, designOf, prepareMint, read } = await import('../../api/_lib/strips.js');
  const { run } = await import('../../api/cron/strips.js');
  const { addToRegister, readGallery, K } = await import('../../api/_lib/strips-index.js');
  const { tokenFor, storiesFor } = await import('../../api/_lib/strips-token.js');
  const { computeTao } = await import('../../api/_lib/tao.js');
  const sign = async (tx) => { const hash = await wallet.sendTransaction({ to: tx.to, data: tx.data }); return client.waitForTransactionReceipt({ hash }); };

  console.log('\n— street works —');
  const sites = (await import('../../data/strip-sites.json', { with: { type: 'json' } })).default.sites;
  const sizeOf = (no) => { const { across_mm: _, ...rest } = sizeOfSite(sites.find((x) => x.no === no)); return rest; };
  is('No.1 reads as 6 m, past the Maker\'s range', sizeOf(1), { length_cm: 600, width_cm: 55, orientation: 'landscape' });
  is('No.5 stands up', sizeOf(5), { length_cm: 110, width_cm: 55, orientation: 'portrait' });
  is('a proposed site has no size', sizeOfSite(sites.find((x) => x.no === 9)), null);

  const draft = draftFor(1);
  is('a draft starts unsigned', draft.signed, false);
  is('a design with no red line is refused', (await saveDesign(1, { ...draft, strips: draft.strips.filter((x) => x.hex !== '#D32011') })).error, 'one red line, exactly');
  is('a design that can\'t pack is refused', /pack/.test((await saveDesign(1, { ...draft, strips: draft.strips.map((x, i) => (i === 0 ? { ...x, mm: 1 } : x)) })).error || ''), true);
  await saveDesign(1, draft);
  is('an unsigned design can\'t mint', /sign the design off/.test((await txFor('street', { no: 1 })).error), true);
  is('nor can a site with none', (await txFor('street', { no: 9 })).error, 'that site has no design yet');
  await signDesign(1);
  const r = await sign(await txFor('street', { no: 1 }));
  is('signed off, it mints from Ryan\'s wallet', r.status, 'success');
  is('to the estate', (await client.readContract({ ...core, functionName: 'ownerOf', args: [1n] })).toLowerCase(), estate.toLowerCase());
  const street = await tokenFor(1);
  is('with its No.', street.attributes.find((a) => a.trait_type === 'No.').value, 'No.1 · 320 West');
  is('at the street size, past what the Maker offers', street.attributes.find((a) => a.trait_type === 'Length').value, '600 cm');
  is('the console shows it minted', (await consoleView()).sites.find((x) => x.no === 1).token_id, 1);

  console.log('\n— the tweet bot —');
  const buyerAccount = mnemonicToAccount('test test test test test test test test test test test junk', { addressIndex: 1 });
  const { createWalletClient, http } = await import('viem');
  const { foundry } = await import('viem/chains');
  const buyer = createWalletClient({ account: buyerAccount, chain: foundry, transport: http(process.env.STRIPS_RPC) });
  const p = await prepareMint({ to: buyerAccount.address, length_cm: 120, width_cm: 60, orientation: 'landscape', colours: [{ hex: '#112233' }, { hex: '#445566' }, { hex: '#778899' }, { hex: '#AA00BB', amount: 'more' }] });
  await client.waitForTransactionReceipt({ hash: await buyer.sendTransaction({ to: p.tx.to, data: p.tx.data, value: parseEther('0.009') }) });
  const said = [];
  let refuse = 1;
  const refreshed = [];
  const deps = { depth: 0n, card: async () => 'media', tweet: async (text, media) => { if (refuse-- > 0) throw new Error('x said no'); said.push([text, media]); }, publish: async (m) => { deps.manifest = m; }, refresh: async (id) => { refreshed.push(id); } };
  await run(deps);
  is('nothing tweets while a token is tuning', said, []);
  await send(coordinator, 'fulfillRandomWordsWithOverride', [1n, ext.address, [1n << 100n]]);
  await send(coordinator, 'fulfillRandomWordsWithOverride', [2n, ext.address, [0xABCDEFn << 64n]]);
  const failed = await run(deps);
  is('X saying no doesn\'t stop the index', [failed.rebuilt, failed.later, said.length], [true, 2, 0]);
  is('the gallery has the word even so', (await readGallery()).find((t) => t.id === 2).display !== null, true);
  is('and OpenSea is asked to read each token again', refreshed, [1, 2]);
  await run(deps);
  is('the tweets go out next time, in order, every one once', said.map((x) => x[0].split(' · ').slice(0, 2).join(' · ')), ['MINTED · //STRIPS #1', 'MINTED · //STRIPS #2']);
  is('in the brief\'s shape', /^MINTED · \/\/STRIPS #2 · [A-Za-z&\- ]+ · (CALM|RESTLESS|HAYWIRE)$/.test(said[1][0]), true);
  is('with the still as the card', said[1][1], ['media']);
  await run(deps);
  is('a third run posts nothing', said.length, 2);
  /* a tweet X will never take isn't offered for ever */
  KV.set(K.later, JSON.stringify([{ kind: 'redeemed', id: 1 }]));
  const refused = { ...deps, tweet: async () => { throw Object.assign(new Error('x tweet 403'), { retryable: false }); } };
  is('a tweet X will never take is dropped', (await run(refused)).later, 0);
  is('and marked, so it isn\'t tried again', KV.get(K.tweeted('redeemed', 1)), 'refused');


  /* a sale goes out through the wire, which fetches its picture by URL */
  const { GET: route } = await import('../../api/strips.js');
  const cardOf = (id) => route(new Request(`https://test.invalid/api/strips/card/${id}`));
  const pic = await cardOf(2);
  const png = Buffer.from(await pic.arrayBuffer());
  is('a sale has a picture X will take', [pic.status, pic.headers.get('content-type'), png.subarray(1, 4).toString()], [200, 'image/png', 'PNG']);
  is('and a token that isn\'t there has none', (await cardOf(99)).status, 404);

  console.log('\n— the gallery and the app —');
  const list = await readGallery();
  is('street works first', list.map((t) => t.no), [1, 0]);
  is('the gallery carries the owner and the display', [Boolean(list[1].owner), Boolean(list[1].display)], [true, true]);
  KV.delete(K.arDay);
  await sign(await txFor('target', { id: 1, uri: 'ar://crop', width_cm: 600, height_cm: 55 }));
  await run(deps);
  const row = deps.manifest.rows[0];
  is('strips-ar.json has one row per street work', deps.manifest.rows.length, 1);
  is('with everything the app needs', [row.no, row.address, row.token_id, row.ar_target, row.installed_cm, row.design.length > 20, row.word.length, row.minted > 0], [1, '320 West', 1, 'ar://crop', { w: 600, h: 55 }, true, 66, true]);
  /* the site records hold no coordinates yet: they're Ryan's pins, and a row
     carries what's there rather than a guess */
  is('GPS is passed through from the site record, never made up', [row.lat, row.lng], [sites[0].lat ?? null, sites[0].lng ?? null]);

  console.log('\n— redemption —');
  process.env.COMMISSIONS_TEST = '1';
  const { createOrder } = await import('../../api/_lib/commissions.js');
  const order = await createOrder({ token_id: 2 });
  is('the order is the token\'s size and id', [order.order.spec.token_id, order.order.spec.length_cm, order.order.spec.width_cm], [2, 120, 60]);
  is('with the token\'s exact strips, summing to the width', Math.round(order.order.strip_data.reduce((n, x) => n + x.mm, 0)), 600);
  is('priced by the same function', order.order.price.nzd > 0, true);
  is('a street work can\'t be redeemed', (await createOrder({ token_id: 1 })).error, 'a street work is already a painting');
  is('nor a token that doesn\'t exist', (await createOrder({ token_id: 99 })).error, 'no such token');
  is('a console redeem needs a real URI', (await txFor('redeem', { id: 2, uri: 'https://example.com/x.jpg' })).error, 'an Arweave URI, ar://...');
  await sign(await txFor('redeem', { id: 2, uri: 'ar://painted' }));
  is('redeemed, it can\'t be ordered again', (await createOrder({ token_id: 2 })).error, 'that token is already a painting');
  await run(deps);
  is('REDEEMED tweets', said.at(-1)[0], 'REDEEMED · //STRIPS #2');
  is('the creator story is on the page', (await storiesFor(2)).at(-1).text, '120 x 60 cm, painted by MintFace');
  is('the gallery shows it', (await readGallery()).find((t) => t.id === 2).redeemed, true);

  console.log('\n— the freeze —');
  is('refused under 50 mints', /50 mints/.test((await txFor('freeze')).error), true);
  for (const k of ['mintface', 'opensea', 'etherscan', 'wallet']) await setCheck(k, true);
  is('still refused on the checks alone', Boolean((await txFor('freeze')).error), true);
  is('an unknown check is refused', (await setCheck('nope', true)).error, 'no such check');

  console.log('\n— the register —');
  const DAY = 86400;
  const cfg = { rates: { unique_per_day: 69, edition_copy_per_day: 4.2 }, exclusions: {} };
  const ev = [{ contract: 'c', token: '1', from: '', to: '0xa', qty: 1, ts: 0, sale: false }];
  const tao = (meta, now) => computeTao(ev, new Map([['c|1', meta]]), cfg, now).wallets[0];
  is('4.2 a day before redemption', tao({ unique: false, work: 'w', unique_from: 100 * DAY }, 10 * DAY).tao_total, 42);
  is('and 69 from it', tao({ unique: false, work: 'w', unique_from: 10 * DAY }, 12 * DAY).tao_total, 42 + 138);
  is('the rate says so', tao({ unique: false, work: 'w', unique_from: 10 * DAY }, 12 * DAY).tao_rate, 69);
  is('a token with no redemption is unchanged', tao({ unique: false, work: 'w' }, 10 * DAY).tao_total, 42);
  const metas = new Map();
  addToRegister(metas, new Map(), [{ id: 7 }], { core: '0xABC', first_block: 9 }, 'https://site');
  is('its sale tweet uses that picture', metas.get('0xabc|7').image, 'https://site/api/strips/card/7');

  console.log('\n— a token the core minted by itself —');
  const { allTokens } = await import('../../api/_lib/strips-index.js');
  await send(core, 'mintBase', [owner.address]);
  const q = await prepareMint({ to: buyerAccount.address, length_cm: 120, width_cm: 60, orientation: 'landscape', colours: [{ hex: '#223344' }, { hex: '#556677' }, { hex: '#8899AA' }] });
  await client.waitForTransactionReceipt({ hash: await buyer.sendTransaction({ to: q.tx.to, data: q.tx.data, value: parseEther('0.009') }) });
  is('the list steps over it and keeps going', (await allTokens()).map((t) => t.id), [1, 2, 4]);

  console.log('\n— the console is behind the password —');
  const admin = await import('../../api/strips-admin.js');
  is('no session, no console', (await admin.GET(new Request('http://x/api/strips-admin'))).status, 401);
  is('no session, no transaction', (await admin.POST(new Request('http://x/api/strips-admin', { method: 'POST', body: '{"action":"tx","op":"freeze"}' }))).status, 401);

  console.log('\n— in a browser —');
  const { serve } = await import('./serve.mjs');
  site = await serve(0);
  browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${site.url}/c/strip-paintings/strips/2`);
  await page.waitForSelector('#stage canvas, #stage img', { timeout: 10000 });
  is('the design page finds its token', await page.textContent('#title'), '//STRIPS #2');
  is('the traits table is there', (await page.textContent('#traits')).includes('Redeemed'), true);
  is('the VRF word is shown', (await page.textContent('#traits')).includes('VRF word'), true);
  is('the story is there', (await page.textContent('#stories')).includes('painted by MintFace'), true);
  is('a stranger sees no owner controls', [await page.isVisible('#tell'), await page.isVisible('#acts')], [false, false]);
  await page.locator('#views button', { hasText: 'Still' }).click();
  is('the view switch shows the still', await page.locator('#stage img').count(), 1);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/token.png`, fullPage: true });
  await page.goto(`${site.url}/c/strip-paintings/strips/99`);
  await page.waitForFunction(() => document.getElementById('title').textContent.includes('No such'));
  is('a token that doesn\'t exist says so', true, true);
  await page.goto(`${site.url}/c/strip-paintings`);
  await page.waitForSelector('#strips:not([hidden]) .tok', { timeout: 10000 });
  is('the gallery fills in', await page.locator('.tok').count(), 2);
  await page.selectOption('[data-f="redeemed"]', 'Yes');
  is('and filters', await page.locator('.tok').count(), 1);
  if (SHOTS) await page.locator('#strips').screenshot({ path: `${SHOTS}/gallery.png` });
  is('no page errors from //STRIPS', errors.filter((m) => /strip/i.test(m)), []);

  console.log('\n— a rush —');
  const sleep = (ms) => new Promise((ok) => { setTimeout(ok, ms); });
  const slow = [];
  KV.set(K.later, JSON.stringify(Array.from({ length: 8 }, (_, i) => ({ kind: 'refresh', id: i + 100 }))));
  const first = await run({ ...deps, budget: 120, refresh: async (id) => { await sleep(50); slow.push(id); } });
  is('a run stops at its budget with the rest saved', [first.later > 0, slow.length < 8, JSON.parse(KV.get(K.later)).length === first.later], [true, true, true]);
  const second = await run({ ...deps, refresh: async (id) => { slow.push(id); } });
  is('the next one finishes the list, each job once', [second.later, [...slow].sort((x, y) => x - y)], [0, [100, 101, 102, 103, 104, 105, 106, 107]]);

  console.log('\n— a quiet mint, and a run stopped halfway —');
  const cursorWas = KV.get(K.cursor);
  await send(ext, 'setMintOpen', [false]);
  const spec = checkMintSpec({ length_cm: 120, width_cm: 60, orientation: 'landscape', colours: [{ hex: '#101112' }, { hex: '#202122' }, { hex: '#303132' }] }).spec;
  const stopped = await sign(await txFor('twin', { design: designOf(spec).design, to: owner.address }));
  const minted = stopped.logs.map((l) => { try { return decodeEventLog({ abi: ext.abi, data: l.data, topics: l.topics }); } catch { return null; } }).find((e) => e && e.eventName === 'Minted');
  const quietWord = 7n << 90n;
  await send(coordinator, 'fulfillRandomWordsWithOverride', [minted.args.requestId, ext.address, [quietWord]]);
  const tweeted = said.length;
  KV.delete(K.gallery);
  /* Vercel saves nothing for a run it stops, so the order of the work is what protects it */
  const killed = await run({ ...deps, refresh: async () => { throw new Error('stopped at 60 seconds'); } }).catch((e) => e.message);
  is('a run stopped in the slow work', killed, 'stopped at 60 seconds');
  is('has already moved the cursor', BigInt(KV.get(K.cursor)) > BigInt(cursorWas), true);
  is('and built the gallery', (await readGallery()).some((t) => t.id === Number(minted.args.id)), true);
  is('and left the work on the list, so the next run isn\'t starting over', JSON.parse(KV.get(K.later)), [{ kind: 'refresh', id: Number(minted.args.id) }]);
  await run(deps);
  is('a word that lands while the mint is closed isn\'t tweeted', said.length, tweeted);
  await send(ext, 'setMintOpen', [true]);
  await run(deps);
  is('nor when it opens', said.length, tweeted);
  is('OpenSea is still asked to read it', refreshed.at(-1), Number(minted.args.id));

  KV.set(K.later, JSON.stringify([{ kind: 'minted', id: Number(minted.args.id), word: `0x${quietWord.toString(16).padStart(64, '0')}` }]));
  const stuck = await run({ ...deps, timeout: 40, tweet: () => new Promise(() => {}) });
  is('a hung X doesn\'t hold the run, and the tweet waits its turn', stuck.later, 1);
  KV.set(K.later, JSON.stringify([{ kind: 'refresh', id: 5 }]));
  let asked = 0;
  for (let i = 0; i < 4; i += 1) await run({ ...deps, refresh: async () => { asked += 1; return false; } });
  is('a failed refresh is tried three times, then let go', [asked, JSON.parse(KV.get(K.later))], [3, []]);

  console.log('\n— when things go wrong —');
  const quietId = Number(minted.args.id);
  const word = `0x${quietWord.toString(16).padStart(64, '0')}`;
  const queued = () => JSON.stringify([{ kind: 'minted', id: quietId, word }, { kind: 'redeemed', id: quietId }]);
  const noKeys = Object.assign(new Error('x tweet 401'), { status: 401, retryable: false, credentials: true });
  KV.set(K.later, queued());
  const keyless = await run({ ...deps, tweet: async () => { throw noKeys; } });
  is('keys X won\'t take burn nothing: the whole list waits', [keyless.later, KV.has(K.tweeted('minted', quietId)), KV.has(K.tweeted('redeemed', quietId))], [2, false, false]);
  is('and the run says so', keyless.failed.some((f) => /refused the keys/.test(f)), true);
  const sent = [];
  process.env.X_BOT_PAUSED = '1';
  const paused = await run({ ...deps, tweet: async (t) => { sent.push(t); } });
  delete process.env.X_BOT_PAUSED;
  is('X_BOT_PAUSED stops the tweets and the list keeps them', [sent, paused.later], [[], 2]);
  KV.set(K.dirty, '1');
  KV.delete(K.arDay);
  const broken = await run({ ...deps, tokens: async () => { throw new Error('r2 is down'); }, publish: async () => { throw new Error('r2 is down'); }, tweet: async (t) => { sent.push(t); } });
  is('a broken manifest or gallery doesn\'t stop the list', [sent.length, broken.later], [2, 0]);
  is('and it says what broke, for the next run to try', [broken.failed.length, KV.has(K.dirty), KV.has(K.arDay)], [2, true, false]);
  await run(deps);

  KV.delete(K.tweeted('minted', quietId));
  KV.set(K.later, queued());
  const repeat = await run({ ...deps, tweet: async () => { throw Object.assign(new Error('x tweet 403'), { status: 403, retryable: false, duplicate: true }); } });
  is('words X already has count as sent', [KV.get(K.tweeted('minted', quietId)), repeat.tweets], ['1', 0]);

  let cut = false;
  KV.delete(K.tweeted('minted', quietId));
  KV.set(K.later, JSON.stringify([{ kind: 'minted', id: quietId, word }]));
  await run({ ...deps, timeout: 40, tweet: (_t, _m, signal) => new Promise((_, no) => signal.addEventListener('abort', () => { cut = true; no(new Error('aborted')); })) });
  is('a call that runs out of time is really stopped', cut, true);

  KV.set(K.lock, '1');
  const held = await run({ ...deps, tweet: async (t) => { sent.push(t); } });
  is('a second run stands aside', [Boolean(held.skipped), sent.length], [true, 2]);
  KV.delete(K.lock);
  await run({ ...deps, tweet: async (t) => { sent.push(t); } });
  is('and the lock goes when a run ends', [sent.length, KV.has(K.lock)], [3, false]);

  KV.set(K.later, JSON.stringify([{ kind: 'minted', id: 9999, word }, { kind: 'redeemed', id: quietId }]));
  KV.delete(K.tweeted('redeemed', quietId));
  const stray = await run({ ...deps, tweet: async (t) => { sent.push(t); } });
  is('a job that can\'t be read waits and holds nothing up', [stray.later, sent.length, stray.failed.length > 0], [1, 4, true]);
  KV.set(K.later, '[]');

  const home = K.cursor;
  process.env.STRIPS_NETWORK = 'sepolia';
  const rehearsal = [K.cursor, K.later, K.tweeted('minted', 1), K.gallery];
  delete process.env.STRIPS_NETWORK;
  is('a rehearsal has keys of its own', rehearsal, ['strips:sepolia:cursor', 'strips:sepolia:tweet-later', 'strips:sepolia:tweeted:minted:1', 'strips:sepolia:gallery']);
  is('and mainnet\'s are as they were', [home, K.tweeted('minted', 1)], ['strips:cursor', 'strips:tweeted:minted:1']);

  /* what X says, read the way X says it */
  const { tweet: send1 } = await import('../../api/_lib/x.js');
  const realFetch = globalThis.fetch;
  for (const k of ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET']) process.env[k] = process.env[k] || 'test';
  const answer = (status, body) => { globalThis.fetch = async () => new Response(JSON.stringify(body), { status }); return send1('words').catch((e) => e); };
  const dupe = await answer(403, { detail: 'You are not allowed to create a Tweet with duplicate content.' });
  const denied = await answer(403, { detail: 'Forbidden' });
  const gone = await answer(401, { detail: 'Unauthorized' });
  const wrong = await answer(400, { detail: 'too long' });
  globalThis.fetch = realFetch;
  is('X\'s answers are told apart', [[dupe.duplicate, dupe.credentials], [denied.duplicate, denied.credentials], [gone.duplicate, gone.credentials], [wrong.duplicate, wrong.credentials, wrong.retryable]], [[true, false], [false, true], [false, true], [false, false, false]]);
} finally {
  if (browser) await browser.close();
  if (site) site.close();
  kv.close();
  chain.stop();
}
console.log(`\n${passes} passed, ${fails} failed`);
if (fails) process.exit(1);
