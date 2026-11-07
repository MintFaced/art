#!/usr/bin/env node
/* The handoff from page to wallet: the real Maker and console in a browser, the
 * real routes, a local chain, and a wallet that behaves like one. It can sit on
 * the wrong network, refuse to leave it, and refuse to sign. Everything it does
 * sign really lands.
 *
 * The other tests send these transactions from scripts, which proves the
 * contracts and the routes. Only this proves what a person's click sends.
 */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { getAddress, parseEther } from 'viem';
import { mnemonicToAccount, privateKeyToAccount } from 'viem/accounts';
import { startChain, deployStack } from './chain.mjs';
import { serve } from './serve.mjs';

const require = createRequire(new URL('../../contracts/package.json', import.meta.url));
const { chromium } = require('playwright');

let passes = 0; let fails = 0;
const str = (v) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x));
const is = (name, got, want) => {
  const ok = str(got) === str(want);
  ok ? passes += 1 : fails += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n     got  ${str(got)}\n     want ${str(want)}`}`);
};

const KV = new Map();
const kv = createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const out = JSON.parse(Buffer.concat(chunks)).map(([op, key, ...rest]) => {
      if (op === 'GET') return { result: KV.has(key) ? KV.get(key) : null };
      if (op === 'SET') { KV.set(key, rest[0]); return { result: 'OK' }; }
      if (op === 'DEL') { KV.delete(key); return { result: 1 }; }
      if (op === 'INCR') { const n = Number(KV.get(key) || 0) + 1; KV.set(key, String(n)); return { result: n }; }
      return { result: 'OK' };
    });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(out));
  });
}).listen(0);
await new Promise((ok) => kv.once('listening', ok));
process.env.KV_REST_API_URL = `http://127.0.0.1:${kv.address().port}`;
process.env.KV_REST_API_TOKEN = 'test';
process.env.STRIPS_RPC = `http://127.0.0.1:${process.env.STRIPS_ANVIL_PORT || 8547}`;
process.env.STRIPS_VOUCHER_KEY = `0x${'5a'.repeat(32)}`;
process.env.STUDIO_PASSWORD = 'pw'; process.env.STUDIO_SECRET = 'studio-secret'; process.env.STUDIO_PATH = 'mintwork';

const LOCAL = '0x7a69';
const BASE = '0x2105';
const MNEMONIC = 'test test test test test test test test test test test junk';

const chain = await startChain();
let site; let browser; let tableServer;
try {
  const { client } = chain;
  const buyer = mnemonicToAccount(MNEMONIC, { addressIndex: 1 }).address;
  const collector = mnemonicToAccount(MNEMONIC, { addressIndex: 2 }).address;

  /* a snapshot that gives the collector two free mints */
  const { allowances, forgetSnapshot, rootOf } = await import('../../api/_lib/strips-snapshot.js');
  const table = allowances([{ wallet: collector.toLowerCase(), tao_total: 420000 }, { wallet: `0x${'1'.repeat(40)}`, tao_total: 100000 }]);
  const s = await deployStack(chain, { signer: privateKeyToAccount(process.env.STRIPS_VOUCHER_KEY).address, snapshot: { root: rootOf(table), free_mints: 3 } });
  const { core, ledger, send, ext, owner, estate, payout } = s;
  process.env.STRIPS_DEPLOYMENT = JSON.stringify({ chain_id: 31337, core: core.address, extension: ext.address, ledger: ledger.address, renderer: s.renderer.address, first_block: 0 });
  let serving = { rows: table };
  tableServer = createServer((_, res) => { res.statusCode = serving ? 200 : 404; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(serving || {})); }).listen(0);
  await new Promise((ok) => tableServer.once('listening', ok));
  process.env.STRIPS_SNAPSHOT_URL = `http://127.0.0.1:${tableServer.address().port}/`;

  const { issueSession, COOKIE } = await import('../../api/_lib/studio.js');
  const { storiesFor } = await import('../../api/_lib/strips-token.js');
  site = await serve(0, { stub: { '/api/nudge': { series: { locked: ['#112233', '#445566', '#778899', '#AABBCC'].map((hex) => ({ hex })) } }, '/api/fx': {} } });
  browser = await chromium.launch();
  const errors = [];

  /* A browser with one wallet in it. What it was asked to send is kept here,
     outside the page, because a mint navigates away. */
  const open = async (account, path, { cookies = [] } = {}) => {
    const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    await context.addCookies(cookies);
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    const sent = [];
    await page.exposeFunction('__rpc', (method, params) => client.request({ method, params }));
    await page.exposeFunction('__sent', (tx, on) => { sent.push({ ...tx, on }); });
    await page.addInitScript(({ who, local }) => {
      const no = () => Object.assign(new Error('User rejected the request.'), { code: 4001 });
      /* a wallet stays connected to a site across pages */
      const w = { chain: local, refuseSwitch: false, refuseSign: false, connected: sessionStorage.getItem('wallet') === 'on' };
      window.__wallet = w;
      window.ethereum = {
        isMetaMask: true, on() {}, removeListener() {},
        async request({ method, params }) {
          if (method === 'eth_chainId') return w.chain;
          if (method === 'eth_accounts') return w.connected ? [who] : [];
          if (method === 'eth_requestAccounts') { w.connected = true; sessionStorage.setItem('wallet', 'on'); return [who]; }
          if (method === 'wallet_switchEthereumChain') { if (w.refuseSwitch) throw no(); w.chain = params[0].chainId; return null; }
          if (method === 'eth_sendTransaction') {
            if (w.refuseSign) throw no();
            const tx = params[0];
            if (tx.value !== undefined && !/^0x[0-9a-f]+$/i.test(tx.value)) throw new Error(`a wallet won't read value ${tx.value}`);
            await window.__sent(tx, w.chain);
            /* on another network the money is gone, and no chain here can show it */
            if (w.chain !== local) return `0x${'dead'.repeat(16)}`;
          }
          /* a session over the relay is only obliged to sign */
          if (method === 'eth_getTransactionReceipt') throw new Error('not in this session');
          return window.__rpc(method, params);
        },
      };
    }, { who: account, local: LOCAL });
    await page.goto(`${site.url}${path}`);
    return { page, sent, set: (patch) => page.evaluate((p) => Object.assign(window.__wallet, p), patch) };
  };
  const label = (m) => m.page.textContent('#mint');
  const maker = async (account, { connect = true } = {}) => {
    const m = await open(account, '/strip-painting-maker');
    await m.page.waitForFunction(() => document.getElementById('stripImg').src.startsWith('data:image/svg'));
    await m.page.waitForFunction(() => document.getElementById('mint').textContent !== 'Mint //STRIP · soon');
    if (connect) {
      await m.page.click('#mint');
      await m.page.waitForFunction(() => /^Mint \/\/STRIP( · free)?$/.test(document.getElementById('mint').textContent));
    }
    return m;
  };
  const clickMint = async (m) => {
    await m.page.click('#mint');
    await m.page.waitForTimeout(600);
    await m.page.waitForFunction(() => !document.getElementById('mint').disabled);
  };
  const owns = (id) => client.readContract({ ...core, functionName: 'ownerOf', args: [id] }).then(getAddress).catch(() => null);

  console.log('\n— the Maker, while free mints are being claimed —');
  const stranger = await maker(collector, { connect: false });
  is('before it knows who you are it asks you to connect, with the price in the row', [await label(stranger), await stranger.page.isDisabled('#mint'), await stranger.page.textContent('#pMint')], ['Connect to mint', false, '0.009 ETH']);
  await stranger.page.click('#mint');
  await stranger.page.waitForFunction(() => document.getElementById('mint').textContent === 'Mint //STRIP · free');
  is('someone owed a free mint is shown a free mint', [await label(stranger), await stranger.page.textContent('#pMint')], ['Mint //STRIP · free', 'Free']);
  is('and no price anywhere on the screen', /0\.009|ETH/.test(await stranger.page.locator('body').innerText()), false);
  is('and connecting sends nothing', stranger.sent.length, 0);
  await stranger.page.click('#testSignal');
  is('the test signal changes neither the button nor the row', [await label(stranger), await stranger.page.isDisabled('#mint'), await stranger.page.textContent('#pMint'), await stranger.page.isVisible('#signal')], ['Mint //STRIP · free', false, 'Free', true]);
  is('and shows no price', /0\.009|ETH/.test(await stranger.page.locator('body').innerText()), false);
  await stranger.page.close();

  console.log('\n— the Maker, when the free mints can\'t be read —');
  serving = null;
  forgetSnapshot();
  const noTable = await maker(collector, { connect: false });
  is('with no table deployed nobody gets a button', [await label(noTable), await noTable.page.isDisabled('#mint'), await noTable.page.isDisabled('#png'), await noTable.page.textContent('#pMint')], ['Mint //STRIP · paused', true, true, 'Paused']);
  is('nor a price', /0\.009|ETH/.test(await noTable.page.locator('body').innerText()), false);
  await noTable.page.click('#testSignal');
  is('the test signal opens nothing', [await noTable.page.isVisible('#signal'), await noTable.page.isDisabled('#mint'), await noTable.page.isDisabled('#png'), await label(noTable)], [true, true, true, 'Mint //STRIP · paused']);
  is('and it says why', (await noTable.page.textContent('#freeNote')).includes('can\'t be read'), true);
  await noTable.page.close();
  serving = { rows: table.slice(1) };
  forgetSnapshot();
  const wrongTable = await maker(buyer, { connect: false });
  is('nor with a table that isn\'t the one on the ledger', [await label(wrongTable), await wrongTable.page.isDisabled('#png')], ['Mint //STRIP · paused', true]);
  await wrongTable.page.close();

  serving = { rows: table };
  forgetSnapshot();
  const midway = await maker(collector, { connect: false });
  await midway.page.route('**/api/strips/free*', (r) => r.abort());
  await midway.page.click('#mint');
  await midway.page.waitForFunction(() => document.getElementById('mint').textContent === 'Mint //STRIP · paused');
  is('if a wallet\'s own read fails, not knowing doesn\'t read as paying', [await label(midway), await midway.page.isDisabled('#png'), midway.sent.length], ['Mint //STRIP · paused', true, 0]);
  await midway.page.close();

  console.log('\n— the Maker, when the wallet says no —');
  const m = await maker(buyer);
  const painted = await m.page.locator('.pal-row input[type=text]').evaluateAll((els) => els.map((x) => x.value));
  await m.set({ chain: BASE, refuseSwitch: true });
  await clickMint(m);
  is('on the wrong network, with the switch refused, nothing is sent', m.sent.map((t) => t.on), []);
  is('and no token exists', await owns(1n), null);
  await m.set({ chain: LOCAL, refuseSwitch: false, refuseSign: true });
  await clickMint(m);
  is('a wallet that won\'t sign sends nothing', m.sent.length, 0);
  is('and the button comes back', await m.page.isDisabled('#mint'), false);

  console.log('\n— the Maker, paid —');
  is('someone with no free mint is shown the price', await m.page.textContent('#pMint'), '0.009 ETH');
  await m.set({ chain: BASE, refuseSign: false });
  const before = await client.getBalance({ address: payout });
  is('the two buttons are all there is before the mint', [await m.page.isVisible('#commission'), await m.page.locator('.actions button:visible').count()], [false, 2]);
  await m.page.click('#testSignal');
  const prepared = m.page.waitForRequest((r) => r.url().endsWith('/api/strips/mint/prepare'));
  await m.page.click('#mint');
  const asked = JSON.parse((await prepared).postData());
  is('a mint with the test signal running asks for what it always does', [asked.free, asked.to.toLowerCase(), asked.colours.length, 'word' in asked, 'signal' in asked], [false, buyer.toLowerCase(), 12, false, false]);
  await m.page.waitForSelector('#minted:not([hidden])', { timeout: 30000 });
  is('on the wrong network it asks to move first, then sends there', m.sent.map((t) => t.on), [LOCAL]);
  is('the mint ends on the offer, with the strip still on screen', [await m.page.textContent('#mintedNo'), await m.page.textContent('#commission'), await m.page.isVisible('#stripImg'), await m.page.isVisible('#mint')], ['//STRIP #1 is yours.', 'Commission the painting', true, false]);
  is('the test signal has gone', await m.page.isVisible('#signal'), false);
  is('the offer says what the painting costs', /ETH/.test(await m.page.textContent('#pTotal')), true);
  is('and links to the token', await m.page.getAttribute('#seeToken', 'href'), '/c/strip-paintings/strips/1');
  is('the buyer holds it', await owns(1n), getAddress(buyer));
  is('the price arrived', (await client.getBalance({ address: payout })) - before, parseEther('0.009'));

  console.log('\n— the commission, after the mint —');
  const ordering = m.page.waitForRequest((r) => r.url().endsWith('/api/commission') && r.method() === 'POST');
  await Promise.all([m.page.waitForURL(/\/commission\/SP-/, { timeout: 30000 }), m.page.click('#commission')]);
  is('the order is the token\'s, read off the chain, not the page\'s', JSON.parse((await ordering).postData()), { action: 'create', spec: { token_id: 1 } });
  const { getOrder } = await import('../../api/_lib/commissions.js');
  const order = await getOrder(new URL(m.page.url()).pathname.split('/').pop());
  const { decodeDesign } = await import('../../strips-design.js');
  const onChain = decodeDesign(await client.readContract({ ...ext, functionName: 'designOf', args: [1n] }));
  is('so it paints the twin of what was minted', [order.spec.token_id, order.strip_data.map((b) => b.hex.toUpperCase())], [1, onChain.bands.map((b) => b.hex.toUpperCase())]);
  await m.page.goto(`${site.url}/strip-painting-maker`);
  await m.page.waitForFunction(() => document.getElementById('mint').textContent !== 'Mint //STRIP · soon');
  is('a fresh Maker offers no commission', await m.page.isVisible('#commission'), false);
  await m.page.goto(`${site.url}/c/strip-paintings/strips/1`);

  console.log('\n— the token page —');
  await m.page.waitForSelector('#tell:not([hidden])');
  await m.set({ chain: BASE, refuseSwitch: true });
  const had = m.sent.length;
  await m.page.fill('#storyText', 'Painted in the rain.');
  await m.page.click('#storySend');
  await m.page.waitForFunction(() => /another network/.test(document.getElementById('said').textContent));
  is('a story from the wrong network goes nowhere', m.sent.length, had);
  await m.set({ refuseSwitch: false });
  await m.page.click('#storySend');
  await m.page.waitForFunction(() => /^Sent/.test(document.getElementById('said').textContent));
  is('allowed to move, it lands on the token', (await storiesFor(1)).map((x) => x.text), ['Painted in the rain.']);

  console.log('\n— the Maker, free —');
  const f = await maker(collector);
  is('someone owed a free mint is never shown a price', [await label(f), /0\.009|ETH/.test(await f.page.locator('body').innerText())], ['Mint //STRIP · free', false]);
  is('and can mint straight away', await f.page.isDisabled('#mint'), false);
  /* and if they reach a design that's gone, by hand, it says so */
  await f.page.click('#custom summary');
  for (const [i, hex] of painted.entries()) {
    const input = f.page.locator('.pal-row').nth(i).locator('input[type=text]');
    await input.fill(hex);
    await input.blur();
  }
  await f.page.waitForFunction(() => document.getElementById('mint').textContent === 'Design taken');
  is('the same design twice reads as taken, and says what to do', [await f.page.isDisabled('#mint'), (await f.page.textContent('#freeNote')).includes('move the red line')], [true, true]);
  await f.page.click('#refresh');
  await f.page.waitForFunction(() => !document.getElementById('mint').disabled);
  await f.page.click('#mint');
  await f.page.waitForSelector('#minted:not([hidden])', { timeout: 30000 });
  is('it ends on the offer too', [await f.page.textContent('#mintedNo'), await f.page.getAttribute('#seeToken', 'href')], ['//STRIP #2 is yours.', '/c/strip-paintings/strips/2']);
  is('a free mint asks for nothing', f.sent.map((t) => BigInt(t.value)), [0n]);
  is('and the collector holds it', await owns(2n), getAddress(collector));
  is('with one left on the ledger', await client.readContract({ ...ledger, functionName: 'claimed', args: [await client.readContract({ ...ledger, functionName: 'claimSnapshot' }), collector] }), 1n);

  console.log('\n— the console —');
  const cookies = [{ name: COOKIE, value: issueSession(), url: site.url }];
  const c = await open(owner.address, '/mintwork/strips', { cookies });
  await c.page.waitForSelector('[data-edit="1"]');
  is('it opens, with the sites listed', await c.page.locator('[data-edit]').count() > 0, true);
  await c.page.click('[data-edit="1"]');
  await c.page.waitForFunction(() => document.getElementById('editJson').value.length > 20);
  is('a draft opens to check against the panel', await c.page.isVisible('#editor'), true);
  await c.page.waitForFunction(() => document.getElementById('editStill').complete && document.getElementById('editStill').naturalWidth > 0);
  await c.page.click('#editSave');
  await c.page.waitForFunction(() => /save/i.test(document.getElementById('said').textContent));
  await c.page.click('#editSign');
  await c.page.waitForSelector('[data-mint="1"]');
  is('signing it off offers the mint', await c.page.isVisible('[data-mint="1"]'), true);

  /* each step waits on what that step says, from a clean line */
  const act = async (selector, says) => {
    await c.page.evaluate(() => { document.getElementById('said').textContent = ''; });
    await c.page.click(selector);
    await c.page.waitForFunction((re) => new RegExp(re).test(document.getElementById('said').textContent), says);
  };
  await c.set({ chain: BASE, refuseSwitch: true });
  await act('[data-mint="1"]', 'another network');
  is('on the wrong network, with the switch refused, the console sends nothing', c.sent.map((t) => t.on), []);
  await c.set({ refuseSwitch: false });
  await act('[data-mint="1"]', '^Done: 0x');
  is('allowed to move, it mints there', c.sent.map((t) => t.on), [LOCAL]);
  is('to the estate', await owns(3n), getAddress(estate));
  await c.page.waitForSelector('[data-mint="1"]:disabled');
  is('and the page catches up, so it can\'t be pressed twice', await c.page.isDisabled('[data-mint="1"]'), true);

  await act('#openMint', '^Done: 0x');
  is('the public mint closes from here', await client.readContract({ ...ext, functionName: 'mintOpen' }), false);
  await c.page.waitForFunction(() => document.getElementById('openMint').textContent === 'Open the public mint');
  is('and the button turns round', await c.page.textContent('#openMint'), 'Open the public mint');
  await act('#openMint', '^Done: 0x');
  is('and opens it again', await client.readContract({ ...ext, functionName: 'mintOpen' }), true);
  is('the freeze waits for its mints', await c.page.isDisabled('#freeze'), true);

  is('no page errors anywhere', errors, []);
} catch (e) {
  fails += 1;
  console.log('FAIL', e.shortMessage || e.message);
} finally {
  await browser?.close();
  site?.close();
  tableServer?.close();
  kv.close();
  chain.stop();
}
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
