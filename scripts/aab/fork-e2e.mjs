#!/usr/bin/env node
/* THE AGENT RAIL, END TO END, ON A FORK OF MAINNET.
 *
 * Real Seaport 1.6, the real OpenSea conduit, real Geodetic World and WALLET
 * tokens. A test holder stands in for mintface.eth (the fork cannot sign for
 * a hardware wallet), receives a handful of works from it by impersonation,
 * and does exactly what /mintwork/rail asks of the real one: approves the conduit,
 * signs a batch once through eth_signTypedData_v4, and hands the signature to
 * the route. A fresh agent wallet with nothing but ETH then reads the feed,
 * takes a 402, sends the transaction it was given, and comes back with the
 * hash. Then every way an order can stop: filled without a callback, moved,
 * cancelled, voided by the counter.
 *
 * Nothing leaves this machine: the store is in memory, the site's data is read
 * from this checkout, and the chain is a local fork.
 *
 *   ANVIL=/path/to/anvil node scripts/aab/fork-e2e.mjs
 */
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { createPublicClient, createTestClient, createWalletClient, http, parseAbi, parseEther } from 'viem';
import { mainnet } from 'viem/chains';
import { english, generateMnemonic, generatePrivateKey, mnemonicToAccount, privateKeyToAccount } from 'viem/accounts';

const ROOT = new URL('../../', import.meta.url);
const ANVIL = process.env.ANVIL || 'anvil';
const PORT = 8546;
const RPC = `http://127.0.0.1:${PORT}`;
const UPSTREAM = process.env.FORK_URL || 'https://ethereum-rpc.publicnode.com';

let pass = 0, fail = 0;
const str = (v) => JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? x.toString() : x));
const is = (label, got, want) => {
  const ok = str(got) === str(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label.padEnd(66) + (ok ? '' : `got ${str(got)} want ${str(want)}`));
  ok ? pass++ : fail++;
};

/* ---------- the store, in memory, answering Upstash's pipeline ---------- */
process.env.KV_REST_API_URL = 'http://kv.fake';
process.env.KV_REST_API_TOKEN = 'fake';
delete process.env.GITHUB_TOKEN;
delete process.env.SITE_ORIGIN;
const KV = new Map();
function kv([cmd, ...a]) {
  const C = cmd.toUpperCase();
  const get = (k) => KV.get(k);
  if (C === 'GET') { const v = get(a[0]); return typeof v === 'string' ? v : null; }
  if (C === 'SET') {
    const nx = a.includes('NX');
    if (nx && KV.has(a[0])) return null;
    KV.set(a[0], a[1]); return 'OK';
  }
  if (C === 'DEL') { let n = 0; for (const k of a) n += KV.delete(k) ? 1 : 0; return n; }
  if (C === 'SADD') { const s = get(a[0]) || new Set(); a.slice(1).forEach((x) => s.add(x)); KV.set(a[0], s); return 1; }
  if (C === 'SREM') { const s = get(a[0]); if (s) a.slice(1).forEach((x) => s.delete(x)); return 1; }
  if (C === 'SMEMBERS') { const s = get(a[0]); return s ? [...s] : []; }
  if (C === 'RPUSH' || C === 'LPUSH') {
    const l = get(a[0]) || []; const items = a.slice(1);
    if (C === 'RPUSH') l.push(...items); else l.unshift(...items.reverse());
    KV.set(a[0], l); return l.length;
  }
  if (C === 'LRANGE') {
    const l = get(a[0]) || []; const start = Number(a[1]); const end = Number(a[2]);
    return l.slice(start, end < 0 ? l.length + end + 1 : end + 1);
  }
  if (C === 'LTRIM') { const l = get(a[0]) || []; KV.set(a[0], l.slice(Number(a[1]), Number(a[2]) + 1)); return 'OK'; }
  if (C === 'HGET') return null;
  throw new Error(`fake kv: ${C}`);
}
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url.startsWith('http://kv.fake')) {
    const cmds = JSON.parse(init.body);
    return new Response(JSON.stringify(cmds.map((c) => ({ result: kv(c) }))), { status: 200 });
  }
  if (url.startsWith('http://localhost:3000/')) {
    const path = new URL(url).pathname.slice(1);
    const file = new URL(path, ROOT);
    if (!existsSync(file)) return new Response('no', { status: 404 });
    return new Response(readFileSync(file), { status: 200 });
  }
  return realFetch(input, init);
};

/* ---------- the fork ---------- */
/* A fresh mnemonic, never anvil's default: its first account has a public
   key, and on mainnet it carries an EIP-7702 delegation that sweeps any ETH it
   receives ... which a fork inherits, and which made a correct payment look
   like no payment at all. */
const MNEMONIC = generateMnemonic(english);
const anvil = spawn(ANVIL, ['--fork-url', UPSTREAM, '--port', String(PORT), '--silent', '--chain-id', '1',
  '--mnemonic', MNEMONIC], { stdio: 'inherit' });
const stop = () => { try { anvil.kill('SIGTERM'); } catch (e) { /* gone */ } };
process.on('exit', stop);
const pub = createPublicClient({ chain: mainnet, transport: http(RPC), batch: { multicall: true } });
const test = createTestClient({ chain: mainnet, mode: 'anvil', transport: http(RPC) });
for (let i = 0; i < 60; i += 1) {
  try { await pub.getBlockNumber(); break; } catch (e) { await new Promise((r) => setTimeout(r, 500)); }
}
console.log(`\nfork of mainnet at block ${await pub.getBlockNumber()}`);

const R = await import('../../api/_lib/aab.js');
const S = await import('../../api/_lib/seaport.js');
const route = await import('../../api/aab.js');
R.useClient(pub);

const MINTFACE = '0xd40b63bf04a44e43fbfe5784bcf22acaab34a180';
const HOLDER = mnemonicToAccount(MNEMONIC).address;                   // the fork's first account, unlocked
const GW = '0xE16c77A770C6De5439F617e6E2F9fD46BB15D396';
const WALLET = '0x7f51b00487fb9de02fe64cd5b5df073ba62e681d';
const NFT = parseAbi(['function ownerOf(uint256) view returns (address)', 'function transferFrom(address,address,uint256)']);
R.useConfig({ holder: HOLDER, holder_name: 'test holder', sets: ['geodetic-world', 'wallet'], rate_bps: 7500,
  days: 30, renew_within_days: 7, marker: 'agent', gate_8004: false, erc8004_registry: null, opensea_fallback: true });

const send = async (from, tx) => {
  const hash = await pub.request({ method: 'eth_sendTransaction', params: [{ from, to: tx.to, data: tx.data,
    value: `0x${BigInt(tx.value || 0).toString(16)}` }] });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error(`reverted: ${hash}`);
  return hash;
};
const get = async (path, headers = {}) => {
  const res = await route.GET(new Request(`http://localhost:3000${path}`, { headers }));
  return { status: res.status, body: await res.json(), headers: res.headers };
};
const post = async (body) => {
  const res = await route.POST(new Request('http://localhost:3000/api/aab', { method: 'POST', body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
};

try {
  /* ---- five works move to the test holder, as if it were mintface.eth ---- */
  const col = (slug) => JSON.parse(readFileSync(new URL(`data/c/${slug}.json`, ROOT))).works;
  const held = async (w) => String(await pub.readContract({ address: w.digital.contract, abi: NFT, functionName: 'ownerOf',
    args: [BigInt(w.digital.token_id)] })).toLowerCase() === MINTFACE;
  const pick = [];
  for (const w of col('geodetic-world').filter((x) => x.status === 'available')) { if (pick.length < 4 && await held(w)) pick.push(w); }
  for (const w of col('wallet').filter((x) => x.status === 'available')) { if (pick.length < 5 && await held(w)) pick.push(w); }
  await test.impersonateAccount({ address: MINTFACE });
  await test.setBalance({ address: MINTFACE, value: parseEther('1') });
  for (const w of pick) {
    await send(MINTFACE, { to: w.digital.contract, data: (await import('viem')).encodeFunctionData({ abi: NFT,
      functionName: 'transferFrom', args: [MINTFACE, HOLDER, BigInt(w.digital.token_id)] }) });
  }
  await test.stopImpersonatingAccount({ address: MINTFACE });
  console.log(`moved ${pick.map((w) => w.id).join(', ')} to the test holder\n`);
  is('the test holder is a plain wallet, with no code of its own', await pub.getCode({ address: HOLDER }) || null, null);
  const [a, b, c, d, wal] = pick;

  console.log('— the holder, at /mintwork/rail —');
  let dr = await post({ action: 'draft' });
  is('a fresh holder is told both contracts need the conduit approved', dr.body.needs_approval.length, 2);
  is('and nothing can be signed yet', dr.body.orders.length, 0);
  is('works it does not hold are left out, with why',
    dr.body.skipped.some((s) => /not in test holder/.test(s.why)), true);
  for (const n of dr.body.needs_approval) await send(HOLDER, n.tx);
  KV.delete('aab:lock:draft');
  dr = await post({ action: 'draft' });
  is('approved, the batch is the five works it holds', dr.body.orders.map((o) => o.id).sort(), pick.map((w) => w.id).sort());
  const gw = dr.body.orders.find((o) => o.id === a.id);
  is('a Geodetic World is drafted at 25% under its list', [gw.list_eth, gw.rail_eth], [0.05, 0.0375]);
  const wo = dr.body.orders.find((o) => o.id === wal.id);
  is('a WALLET, with no live listing, at 25% under the catalogue', [wo.list_eth, wo.rail_eth], [0.5, 0.375]);

  /* The wallet's own signing path, with the JSON the page hands it. */
  const signature = await pub.request({ method: 'eth_signTypedData_v4', params: [HOLDER, JSON.stringify(dr.body.typed)] });
  const forged = await privateKeyToAccount(generatePrivateKey()).signTypedData(
    { ...dr.body.typed, types: Object.fromEntries(Object.entries(dr.body.typed.types).filter(([k]) => k !== 'EIP712Domain')) });
  let kept = await post({ action: 'keep', draft: dr.body.draft, signature: forged });
  is('a batch signed by anybody else is refused', [kept.status, /not by test holder/.test(kept.body.error)], [403, true]);
  kept = await post({ action: 'keep', draft: dr.body.draft, signature });
  is('the holder\'s one signature puts five orders on the rail', kept.body.kept, 5);
  KV.delete('aab:lock:draft');
  const again = await post({ action: 'draft' });
  is('drafting everything again signs nothing twice', [again.body.orders.length, again.body.on_rail], [0, 5]);

  console.log('\n— a fresh agent, with nothing but ETH —');
  const agentKey = generatePrivateKey();
  const agent = privateKeyToAccount(agentKey);
  await test.setBalance({ address: agent.address, value: parseEther('2') });
  const wallet = createWalletClient({ account: agent, chain: mainnet, transport: http(RPC) });

  const feed = await get('/ai/catalog.json');
  is('the feed lists the five', feed.body.works.map((w) => w.id).sort(), pick.map((w) => w.id).sort());
  const row = feed.body.works.find((w) => w.id === a.id);
  is('each row carries what the spec asks for',
    ['id', 'title', 'collection', 'contract', 'token_id', 'standard', 'edition', 'image', 'list_price_eth', 'ai_price_eth', 'order_expires', 'url', 'buy']
      .every((k) => row[k] != null), true);

  const q = await get(`/ai/buy/${a.id}`);
  is('asking for a work answers 402', q.status, 402);
  const acc = q.body.accepts[0];
  is('in the x402 shape, with the seaport-fill scheme', [q.body.x402Version, acc.scheme, acc.network], [1, 'seaport-fill', 'ethereum']);
  is('the amount is the rail price in wei', acc.maxAmountRequired, parseEther('0.0375').toString());
  const t = acc.extra.transaction;
  const before = await pub.getBalance({ address: HOLDER });
  const hash = await wallet.sendTransaction({ to: t.to, data: t.data, value: BigInt(t.value) });
  const rc = await pub.waitForTransactionReceipt({ hash });
  is('the agent sends the transaction it was given, and it lands', rc.status, 'success');
  is('the token is the agent\'s', String(await pub.readContract({ address: GW, abi: NFT, functionName: 'ownerOf',
    args: [BigInt(a.digital.token_id)] })).toLowerCase(), agent.address.toLowerCase());
  is('and the holder has the ETH, in the same transaction',
    (await pub.getBalance({ address: HOLDER })) - before, parseEther('0.0375'));

  const back = await get(`/ai/buy/${a.id}`, { 'X-PAYMENT': hash });
  is('coming back with the hash answers 200', back.status, 200);
  is('with the welcome, the transaction and the collector',
    [back.body.message, back.body.tx, back.body.collector], ['Welcome to the register.', hash, agent.address.toLowerCase()]);
  is('and x402\'s settlement header', Boolean(back.headers.get('x-payment-response')), true);
  const queued = [...KV.entries()].filter(([k]) => k.startsWith('wire:e:')).map(([, v]) => JSON.parse(v));
  is('one sale tweet is queued, marked as the rail\'s', queued.map((e) => [e.kind, e.payload.via]), [['sale', 'agent-rail']]);
  is('the feed drops the work', (await get('/ai/catalog.json')).body.works.some((w) => w.id === a.id), false);
  is('asking again is the same welcome, not another sale', (await get(`/ai/buy/${a.id}`)).status, 200);
  is('the base64 x402 payload works too',
    R.paymentHash(Buffer.from(JSON.stringify({ payload: { txHash: hash } })).toString('base64')), hash);

  console.log('\n— every way an order stops —');
  is('a hash that fills another order is refused', (await get(`/ai/buy/${b.id}?tx=${hash}`)).status, 409);

  /* Filled with no callback: the nightly run finds it and tells it once. */
  const q2 = await get(`/ai/buy/${b.id}`);
  const h2 = await wallet.sendTransaction({ to: q2.body.accepts[0].extra.transaction.to,
    data: q2.body.accepts[0].extra.transaction.data, value: BigInt(q2.body.accepts[0].extra.transaction.value) });
  await pub.waitForTransactionReceipt({ hash: h2 });
  const told = await R.railSale(h2, { seller: HOLDER });
  is('the nightly run recognises a rail fill nobody reported', told && told.told, false);
  is('and a second look stays quiet', (await R.railSale(h2, { seller: HOLDER })).told, true);
  is('a sale by another seller is not the rail\'s', await R.railSale(h2, { seller: MINTFACE }), null);
  const tweets = [...KV.entries()].filter(([k]) => k.startsWith('wire:e:')).length;
  is('so there are two tweets for two sales, not three', tweets, 2);

  /* Moved: the holder sends one away. */
  await send(HOLDER, { to: GW, data: (await import('viem')).encodeFunctionData({ abi: NFT, functionName: 'transferFrom',
    args: [HOLDER, MINTFACE, BigInt(c.digital.token_id)] }) });
  const moved = await get(`/ai/buy/${c.id}`);
  is('a work that left the wallet answers 410', [moved.status, moved.body.error], [410, 'This work has left the holding wallet.']);
  is('and comes off the rail', KV.has(`aab:o:${c.id}`), false);

  /* Renewed: the old order is still good on Seaport, so it stays on file. */
  const oldHash = KV.get(`aab:o:${d.id}`) && JSON.parse(KV.get(`aab:o:${d.id}`)).hash;
  KV.delete('aab:lock:draft');
  const rn = await post({ action: 'draft', ids: [d.id] });
  const rs = await pub.request({ method: 'eth_signTypedData_v4', params: [HOLDER, JSON.stringify(rn.body.typed)] });
  const rk = await post({ action: 'keep', draft: rn.body.draft, signature: rs });
  is('a renewal at the same price still keeps the order it replaced', rk.body.retired, 1);

  /* Cancelled: one transaction, every order the rail ever handed out. */
  const plan = await post({ action: 'cancel', scope: 'all' });
  is('cancel names the two on the rail and the one a renewal replaced', plan.body.count, 3);
  await send(HOLDER, plan.body.tx);
  const [, oldCancelled] = await pub.readContract({ address: S.SEAPORT, abi: S.SEAPORT_ABI, functionName: 'getOrderStatus', args: [oldHash] });
  is('and the replaced one is cancelled on chain too', oldCancelled, true);
  is('a cancelled order answers 410', (await get(`/ai/buy/${d.id}`)).status, 410);
  KV.delete('aab:lock:sweep');
  const sw = await post({ action: 'sweep' });
  is('the sweep takes the last one off', [sw.body.retired, (await get('/ai/catalog.json')).body.count], [1, 0]);

  /* Voided by the counter: sign a fresh batch, then raise the counter. */
  KV.delete('aab:lock:draft');
  await send(HOLDER, { to: GW, data: '0x' }).catch(() => null);
  const dr2 = await post({ action: 'draft', ids: [d.id] });
  const sig2 = await pub.request({ method: 'eth_signTypedData_v4', params: [HOLDER, JSON.stringify(dr2.body.typed)] });
  await post({ action: 'keep', draft: dr2.body.draft, signature: sig2 });
  is('re-signed, the work is back on the rail', (await get(`/ai/buy/${d.id}`)).status, 402);
  await send(HOLDER, (await post({ action: 'void' })).body.tx);
  const voided = await get(`/ai/buy/${d.id}`);
  is('after incrementCounter it answers 410, though Seaport never marks it cancelled', voided.status, 410);

  const led = await get('/api/aab?view=ledger');
  is('the ledger never carries a signature', JSON.stringify(led.body).includes('"signature"'), false);
  is('and records both fills', led.body.fills.length, 2);
} catch (err) {
  console.error('\nERROR', err);
  fail += 1;
} finally {
  console.log(`\n${pass} passed, ${fail} failed`);
  stop();
  process.exit(fail ? 1 : 0);
}
