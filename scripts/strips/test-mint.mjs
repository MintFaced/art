#!/usr/bin/env node
/* The whole buyer's path, end to end, on a local chain: the real Manifold core,
 * Chainlink's coordinator mock, the real extension, and the site's own code.
 * The route's voucher goes into a real mint, the snapshot's proof into a real
 * free mint, and the still that comes back is compared with what the Maker drew.
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { decodeFunctionData, parseEther, getAddress } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { createWalletClient, http } from 'viem';
import { foundry } from 'viem/chains';
import { startChain, deployStack } from './chain.mjs';

const RPC = `http://127.0.0.1:${process.env.STRIPS_ANVIL_PORT || 8547}`;
process.env.STRIPS_RPC = RPC;
process.env.STRIPS_VOUCHER_KEY = `0x${'5a'.repeat(32)}`;

let fails = 0, passes = 0;
const is = (name, got, want) => {
  const ok = JSON.stringify(got, (_, v) => (typeof v === 'bigint' ? v.toString() : v)) === JSON.stringify(want, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
  if (ok) passes += 1; else fails += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` :: got ${JSON.stringify(got, (_, v) => (typeof v === 'bigint' ? v.toString() : v))}, wanted ${JSON.stringify(want)}`}`);
};
const refuses = async (name, fn, match) => { try { await fn(); is(name, 'no revert', match); } catch (e) { const s = `${e.shortMessage || ''} ${e.message || ''}`; is(name, s.includes(match), true); } };

const chain = await startChain();
let server;
try {
  const { client } = chain;
  const buyerAccount = mnemonicToAccount('test test test test test test test test test test test junk', { addressIndex: 1 });
  const vaultAccount = mnemonicToAccount('test test test test test test test test test test test junk', { addressIndex: 2 });
  const buyer = createWalletClient({ account: buyerAccount, chain: foundry, transport: http(RPC) });
  const { privateKeyToAccount } = await import('viem/accounts');
  const { core, coordinator, ledger, renderer, ext, send, payout } = await deployStack(chain, { signer: privateKeyToAccount(process.env.STRIPS_VOUCHER_KEY).address });

  process.env.STRIPS_DEPLOYMENT = JSON.stringify({ chain_id: 31337, core: core.address, extension: ext.address, ledger: ledger.address, renderer: renderer.address });
  const { prepareMint, designOf, checkMintSpec, read } = await import('../../api/_lib/strips.js');
  const { allowances, rootOf, proofOf, freeMintsFor, leafOf } = await import('../../api/_lib/strips-snapshot.js');
  const { tokenFor } = await import('../../api/_lib/strips-token.js');
  const { stillSVG } = await import('../../strips-design.js');

  const spec = (n = 0, extra = {}) => ({
    length_cm: 120, width_cm: 60, orientation: 'landscape', to: buyerAccount.address, gamma: 1, count: 55,
    colours: [{ hex: `#1122${(0x33 + n).toString(16).padStart(2, '0').toUpperCase()}`, amount: 'more' }, { hex: '#445566', amount: 'even' }, { hex: '#778899', amount: 'less' }, { hex: '#AA00BB', amount: 'even' }],
    ...extra,
  });

  console.log('\n— paid —');
  const a = await prepareMint(spec(1));
  is('prepare signs a voucher', a.status, 200);
  const payoutBefore = await client.getBalance({ address: payout });
  const write = (fn, args, value) => buyer.writeContract({ ...ext, functionName: fn, args, value });
  const voucherArg = (p) => ({ to: p.voucher.to, designHash: p.voucher.designHash, nonce: BigInt(p.voucher.nonce), deadline: BigInt(p.voucher.deadline) });
  const h = await write('mint', [a.design, voucherArg(a), a.signature], parseEther('0.009'));
  const r1 = await client.waitForTransactionReceipt({ hash: h });
  is('the voucher mints on-chain', r1.status, 'success');
  is('mint ETH went to mintface.eth', (await client.getBalance({ address: payout })) - payoutBefore, parseEther('0.009'));
  is('the token belongs to the buyer', (await client.readContract({ ...core, functionName: 'ownerOf', args: [1n] })).toLowerCase(), buyerAccount.address.toLowerCase());
  is('the design on-chain is the design prepared', await read.extension('designOf', [1n]), a.design);

  const before = await tokenFor(1);
  is('what the Maker drew is what the chain draws', await client.readContract({ ...renderer, functionName: 'still', args: [a.design] }), stillSVG(a.design));
  is('the token reads Tuning', before.attributes.find((x) => x.trait_type === 'Signal')?.value, 'Tuning');

  await send(coordinator, 'fulfillRandomWordsWithOverride', [1n, ext.address, [0x5eedn << 200n]]);
  const after = await tokenFor(1);
  is('the word lands and the traits fill in', [Boolean(after.word), after.attributes.some((x) => x.trait_type === 'Display')], [true, true]);

  console.log('\n— refused —');
  is('the same design is refused at the door', (await prepareMint(spec(1))).status, 409);
  is('no wallet, no voucher', (await prepareMint({ ...spec(2), to: 'nope' })).status, 400);
  is('two colours are too few', (await prepareMint({ ...spec(2), colours: spec(2).colours.slice(0, 2) })).status, 400);
  is('the //STRIPS red can\'t be a palette colour', (await prepareMint({ ...spec(2), colours: [{ hex: '#D32011' }, ...spec(2).colours] })).status, 400);
  const b = await prepareMint(spec(2));
  const dryRun = (args, value) => client.simulateContract({ ...ext, account: buyerAccount, functionName: 'mint', args, value });
  const mintedBefore = await read.extension('publicMinted');
  await refuses('a voucher can\'t be walked to a different wallet', () => dryRun([b.design, { ...voucherArg(b), to: vaultAccount.address }, b.signature], parseEther('0.009')), 'BadVoucher');
  await refuses('nor pay less', () => dryRun([b.design, voucherArg(b), b.signature], parseEther('0.001')), 'WrongPrice');
  await refuses('nor swap the design', () => dryRun([a.design, voucherArg(b), b.signature], parseEther('0.009')), 'BadVoucher');
  is('and nothing was minted by any of it', await read.extension('publicMinted'), mintedBefore);

  console.log('\n— a moved red line —');
  const c = await prepareMint(spec(3, { red_line: 50 }));
  await client.waitForTransactionReceipt({ hash: await write('mint', [c.design, voucherArg(c), c.signature], parseEther('0.009')) });
  is('the trait says where', (await tokenFor(2)).attributes.find((x) => x.trait_type === 'Red line').value, '50');

  console.log('\n— free, against the real register —');
  const register = JSON.parse(readFileSync(new URL('../../data/collectors-register.json', import.meta.url)));
  const taoAt = register.fields.indexOf('tao');
  const real = register.rows.map((r) => ({ wallet: r[0], tao_total: Math.floor(r[taoAt]) })).filter((r) => r.tao_total > 0);
  const hot = '0x000000000000000000000000000000000000bEEF';
  const vault = real[0].wallet;
  const rows = [...real, { wallet: buyerAccount.address.toLowerCase(), tao_total: 420000 }, { wallet: vaultAccount.address.toLowerCase(), tao_total: 99999 }];
  const combo = new Map([[vault.toLowerCase(), hot.toLowerCase()], [vaultAccount.address.toLowerCase(), buyerAccount.address.toLowerCase()]]);
  const table = allowances(rows, combo);
  const find = (w) => table.find((r) => r.wallet.toLowerCase() === w.toLowerCase());
  is('a hot wallet holding nothing collects its vault\'s allowance', [find(hot).tao_total, find(hot).free_mints > 0], [0, true]);
  is('the vault gets none of its own, and is pointed at the hot wallet', [find(vault).free_mints, find(vault).hot], [0, getAddress(hot)]);
  is('COMBO counts once, on the hot wallet', [find(buyerAccount.address).free_mints, find(vaultAccount.address).free_mints], [2, 0]);
  is('tiers: 99,999 / 100,000 / 419,999 / 420,000', allowances([99999, 100000, 419999, 420000].map((t, i) => ({ wallet: `0x${String(i + 1).padStart(40, '0')}`, tao_total: t }))).map((r) => r.free_mints).sort(), [0, 1, 1, 2]);

  const root = rootOf(table);
  const owed = BigInt(table.reduce((n, r) => n + r.free_mints, 0));
  await send(ledger, 'publishSnapshot', [root, 1795000000n, owed, 'ar://table', 'Snapshot 1, corrected']);
  await send(ledger, 'setClaimSnapshot', [2n]);
  const buyerRow = find(buyerAccount.address);
  let checked = 0, bad = 0;
  for (const row of [buyerRow, ...table.filter((_, i) => i % 97 === 0)]) {
    const ok = await client.readContract({ ...ledger, functionName: 'verify', args: [2n, row.wallet, BigInt(row.tao_total), BigInt(row.free_mints), proofOf(table, row)] });
    checked += 1; if (!ok) bad += 1;
  }
  is(`${checked} proofs from ${table.length} real rows verify on-chain`, bad, 0);
  is('a forged row doesn\'t', await client.readContract({ ...ledger, functionName: 'verify', args: [2n, buyerRow.wallet, BigInt(buyerRow.tao_total + 1), BigInt(buyerRow.free_mints), proofOf(table, buyerRow)] }), false);

  /* the file the site reads, and the copy on Arweave */
  let site = null;
  let arweave = null;
  let audited = null;
  server = createServer((req, res) => {
    const body = req.url.startsWith('/ar/') ? arweave : req.url === '/audit' ? audited : site;
    res.statusCode = body ? 200 : 404;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(body || {}));
  }).listen(0);
  await new Promise((ok) => server.once('listening', ok));
  process.env.STRIPS_SNAPSHOT_URL = `http://127.0.0.1:${server.address().port}/table`;
  process.env.STRIPS_SNAPSHOT_AUDIT_URL = `http://127.0.0.1:${server.address().port}/audit`;
  process.env.STRIPS_ARWEAVE_GATEWAY = `http://127.0.0.1:${server.address().port}/ar`;

  const { forgetSnapshot } = await import('../../api/_lib/strips-snapshot.js');
  const { GET: route, POST: routePost } = await import('../../api/strips.js');
  const prepare = (body) => routePost(new Request('http://x/api/strips/mint/prepare', { method: 'POST', body: JSON.stringify(body) }));
  const state = async () => (await route(new Request('http://x/api/strips/state'))).json();
  const stranger = '0x0000000000000000000000000000000000001234';
  const row = () => ({ rows: table, root, id: 2, taken_at: 1795000000, label: 'Snapshot 1, corrected' });

  console.log('\n— fail closed: no proofs, no price —');
  forgetSnapshot();
  is('no table deployed: the free route says it can\'t tell', (await freeMintsFor(buyerAccount.address)).unavailable, true);
  is('and says so in its status', (await route(new Request(`http://x/api/strips/free?wallet=${buyerAccount.address}`))).status, 503);
  is('the state says nobody can be sold to', (await state()).claims_ok, false);
  is('a paid voucher is refused to someone owed a free mint', (await prepare(spec(20))).status, 503);
  is('and to a stranger: the rule is for everyone', (await prepare({ ...spec(21), to: stranger })).status, 503);

  site = { rows: table.slice(1) };
  forgetSnapshot();
  is('a table that doesn\'t rebuild to the ledger\'s root is no table', [(await freeMintsFor(buyerAccount.address)).unavailable, (await state()).claims_ok], [true, false]);
  site = row();
  site.root = root; site.rows = [...table].reverse().slice(1);
  forgetSnapshot();
  is('whatever its own root field claims', (await state()).claims_ok, false);

  /* a figure that doesn't match, from anything but the console */
  await send(ledger, 'publishSnapshot', [root, 1795000000n, owed - 1n, 'ar://low', 'understated']);
  await send(ledger, 'setClaimSnapshot', [3n]);
  site = row();
  forgetSnapshot();
  is('a ledger holding back less than the table owes pauses the mint', [(await state()).claims_ok, (await freeMintsFor(buyerAccount.address)).unavailable], [false, true]);
  await send(ledger, 'publishSnapshot', [root, 1795000000n, owed + 1n, 'ar://high', 'overstated']);
  await send(ledger, 'setClaimSnapshot', [4n]);
  forgetSnapshot();
  is('and so does one holding back more', (await state()).claims_ok, false);
  await send(ledger, 'setClaimSnapshot', [2n]);
  forgetSnapshot();

  const open = await state();
  is('with the right table, the mint is on', [open.claims_ok, open.claim_live], [true, true]);
  is('the reserve is held back from what\'s for sale', [open.reserved, open.paid_left], [Number(owed), 621 - open.public_minted - Number(owed)]);
  is('someone owed a free mint can\'t be sold one', (await prepare(spec(22))).status, 409);
  is('a stranger can buy', (await prepare({ ...spec(23), to: stranger })).status, 200);
  is('a free mint is prepared for who it\'s owed to', (await prepare({ ...spec(24), free: true })).status, 200);
  is('and only them', (await prepare({ ...spec(25), to: stranger, free: true })).status, 403);

  {
    const realNow = Date.now;
    Date.now = () => realNow() + 31 * 86400_000;
    site = null;
    forgetSnapshot();
    const closed = await state();
    is('once the claim has closed the table isn\'t needed', [closed.claims_ok, closed.claim_live, closed.reserved === Number(owed)], [true, false, true]);
    is('nobody is owed anything, so a price is fine', (await prepare({ ...spec(26), to: stranger })).status, 200);
    Date.now = realNow;
    site = row();
    forgetSnapshot();
  }

  console.log('\n— publishing, checked —');
  const { txFor } = await import('../../api/_lib/strips-console.js');
  const nextId = 5;
  const next = { rows: table, root, id: nextId, taken_at: 1795000000, label: 'Snapshot 5' };
  const publish = (over = {}) => txFor('snapshot', { root, uri: 'ar://abc', ...over });
  const refused = async (name, got, re) => is(name, re.test(String((await got).error)), true);
  site = null;
  await refused('no table on the site, nothing to sign', publish(), /isn't on the site/);
  site = { ...next, id: 7 };
  await refused('a table with the wrong number', publish(), /snapshot 7/);
  site = { ...next, root: `0x${'22'.repeat(32)}` };
  await refused('a table that doesn\'t rebuild to its own root', publish({ root: `0x${'22'.repeat(32)}` }), /doesn't rebuild/);
  site = next;
  await refused('a root that isn\'t the table\'s', publish({ root: `0x${'33'.repeat(32)}` }), /isn't the deployed table/);
  site = { ...next, taken_at: 0 };
  await refused('a table with no date', publish(), /no taken_at/);
  site = next;
  await refused('no audit on the site', publish(), /Run the audit/);
  audited = { ok: true, root: `0x${'33'.repeat(32)}` };
  await refused('an audit of another table', publish(), /isn't a pass for this table/);
  audited = { ok: false, root };
  await refused('an audit that didn\'t pass', publish(), /isn't a pass for this table/);
  audited = { ok: true, root };
  await refused('nothing on Arweave yet', publish(), /couldn't read/);
  arweave = { rows: table.slice(1) };
  await refused('something else on Arweave', publish(), /doesn't rebuild/);
  arweave = { rows: table };
  const checkedTx = await publish();
  const signed = decodeFunctionData({ abi: ledger.abi, data: checkedTx.data });
  is('with everything right, the ledger gets what the table says', [signed.functionName, signed.args[0], signed.args[1], signed.args[2], signed.args[3], signed.args[4]], ['publishSnapshot', root, 1795000000n, owed, 'ar://abc', 'Snapshot 5']);
  is('and it goes to the ledger', checkedTx.to, ledger.address);

  site = row();
  forgetSnapshot();
  is('the deadline moves in days, within reason', [(await txFor('extend', { days: 0 })).error, (await txFor('extend', { days: 91 })).error], ['1 to 90 days', '1 to 90 days']);
  const longer = await txFor('extend', { days: 10 });
  const deadlineWas = await read.ledger('claimDeadline');
  await client.waitForTransactionReceipt({ hash: await chain.wallet.sendTransaction({ to: longer.to, data: longer.data }) });
  is('and it moves', (await read.ledger('claimDeadline')) - deadlineWas, 864000n);
  await refused('a correction needs its table on the site', txFor('correct', { snapshot: 1 }), /no table for snapshot 1/);
  is('the claim can be pointed at one that has it', (await txFor('correct', { snapshot: 2 })).to, ledger.address);
  await refused('but not at one whose figure is wrong', txFor('correct', { snapshot: 3 }), /holds back/);
  is('a contract wallet gets a voucher long enough to gather its signatures', Number((await prepareMint({ ...spec(30), to: ext.address })).voucher.deadline) - Math.floor(Date.now() / 1000) > 23 * 3600, true);
  is('an ordinary wallet doesn\'t', Number((await prepareMint({ ...spec(31), to: stranger })).voucher.deadline) - Math.floor(Date.now() / 1000) <= 1800, true);

  console.log('\n— free, spent —');
  site = row();
  forgetSnapshot();
  const free = await freeMintsFor(buyerAccount.address);
  is('the route says two left', [free.free_mints, free.left], [2, 2]);
  is('a vault is told where its allowance sits', (await freeMintsFor(vaultAccount.address)).on_hot_wallet, buyerAccount.address);

  const f = await prepareMint(spec(4));
  const hf = await buyer.writeContract({ ...ext, functionName: 'mintFree', args: [f.design, voucherArg(f), f.signature, BigInt(buyerRow.tao_total), BigInt(buyerRow.free_mints), free.proof] });
  is('the free mint goes through at no cost', (await client.waitForTransactionReceipt({ hash: hf })).status, 'success');
  forgetSnapshot();
  is('and the route counts it', (await freeMintsFor(buyerAccount.address)).left, 1);
  is('supply', await read.extension('publicMinted'), 3n);
} finally {
  if (server) server.close();
  chain.stop();
}
console.log(`\n${passes} passed, ${fails} failed`);
if (fails) process.exit(1);
