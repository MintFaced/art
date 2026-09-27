#!/usr/bin/env node
/* The agent rail's arithmetic, with no network (AAB.md).
 *
 * The bytes that matter were checked against the deployed Seaport 1.6 before
 * any of this was written: the order hash against its getOrderHash, a batch
 * signed with a throwaway key against its validate(), and a tampered proof
 * refused. scripts/aab/fork-e2e.mjs walks the whole rail on a fork. This file
 * keeps those properties true offline, on every run.
 *
 *   node scripts/aab/test-rail.mjs
 */
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, hashTypedData, parseEther } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import * as S from '../../api/_lib/seaport.js';
import * as R from '../../api/_lib/aab.js';
import { compose } from '../../api/_lib/wire.js';

let pass = 0, fail = 0;
const str = (v) => JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? x.toString() : x));
const is = (label, got, want) => {
  const ok = str(got) === str(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label.padEnd(64) + (ok ? '' : `got ${str(got)} want ${str(want)}`));
  ok ? pass++ : fail++;
};

const holder = privateKeyToAccount(generatePrivateKey());
const GW = '0xE16c77A770C6De5439F617e6E2F9fD46BB15D396';
const now = 1_800_000_000;
const order = (i, price = parseEther('0.0375')) => S.sellOrder({
  offerer: holder.address, token: GW, tokenId: i, priceWei: price,
  startTime: now - 60, endTime: now + 30 * 86400, salt: BigInt(1000 + i), counter: 0n,
});

console.log('\n— one order —');
{
  const o = order(7);
  is('it offers one ERC-721 and asks ETH, to the holder', [o.offer[0].itemType, o.offer[0].startAmount, o.consideration[0].itemType,
    o.consideration[0].recipient], [S.ITEM.ERC721, 1n, S.ITEM.NATIVE, holder.address]);
  is('open to anybody, no zone, through the OpenSea conduit', [o.orderType, o.zone, o.conduitKey],
    [S.ORDER_TYPE.FULL_OPEN, S.ZERO_ADDRESS, S.OPENSEA_CONDUIT_KEY]);
  is('an ERC-1155 sells one copy', S.sellOrder({ offerer: holder.address, token: GW, tokenId: 1, standard: 'ERC-1155',
    priceWei: 1n, startTime: 0, endTime: 1, salt: 1n }).offer[0].itemType, S.ITEM.ERC1155);
  is('a round trip through JSON keeps the hash', S.orderHash(S.orderFromJSON(S.orderToJSON(o))), S.orderHash(o));
  is('the Order drops the counter and counts the consideration',
    [('counter' in S.asOrder(o, '0x').parameters), S.asOrder(o, '0x').parameters.totalOriginalConsiderationItems], [false, 1n]);
}

console.log('\n— one signature for a batch —');
for (const n of [1, 2, 3, 5, 109]) {
  const orders = Array.from({ length: n }, (_, i) => order(i + 1));
  const tree = S.bulkTree(orders);
  const typed = S.bulkTypedData(tree);
  const sig = await holder.signTypedData(typed);
  let good = 0;
  for (let i = 0; i < n; i += 1) {
    const packed = S.packBulkSignature(sig, i, S.proofFor(tree, i));
    if ((await S.bulkSigner(orders[i], packed)) === holder.address) good += 1;
  }
  is(`${String(n).padStart(3)} orders: height ${tree.height}, every order recovers the holder`, good, n);
  is(`${String(n).padStart(3)} orders: the root's digest is the whole tree's digest`,
    S.bulkDigest(tree.root, tree.height), hashTypedData(typed));
}
{
  const orders = [order(1), order(2), order(3)];
  const tree = S.bulkTree(orders);
  const sig = await holder.signTypedData(S.bulkTypedData(tree));
  const packed = S.packBulkSignature(sig, 1, S.proofFor(tree, 1));
  const u = S.unpackBulkSignature(packed);
  is('a packed signature unpacks to its parts', [u.index, u.height, u.signature], [1, 2, sig]);
  is('another order under the same proof does not recover the holder',
    (await S.bulkSigner(orders[0], packed)) === holder.address, false);
  is('nor does a changed price', (await S.bulkSigner(order(2, 1n), packed)) === holder.address, false);
  const v0 = `${sig.slice(0, -2)}${(parseInt(sig.slice(-2), 16) - 27).toString(16).padStart(2, '0')}`;
  is('a wallet\'s v of 0 or 1 is put back to 27 or 28', S.normalizeSignature(v0), sig);
  is('the wallet form of the typed data names EIP712Domain and has no bigints',
    [Boolean(R.typedForWallet(tree).types.EIP712Domain), /"\d+n"/.test(JSON.stringify(R.typedForWallet(tree)))], [true, false]);
  let threw = false;
  try { S.heightFor(2 ** 24 + 1); } catch (e) { threw = true; }
  is('a batch past what one signature carries is refused', threw, true);
}

console.log('\n— the transaction an agent sends —');
{
  const o = order(9);
  const tx = S.fulfillTransaction(o, '0x1234');
  const d = decodeFunctionData({ abi: S.SEAPORT_ABI, data: tx.data });
  is('it calls fulfillOrder on Seaport 1.6 with the price as value', [tx.to, d.functionName, tx.value, tx.chainId],
    [S.SEAPORT, 'fulfillOrder', parseEther('0.0375'), 1]);
  is('with the order and no conduit of the buyer\'s', [d.args[0].parameters.salt, d.args[0].signature, d.args[1]],
    [o.salt, '0x1234', S.ZERO_HASH]);
  const cancel = decodeFunctionData({ abi: S.SEAPORT_ABI, data: S.cancelData([o]) });
  is('cancel names exactly the orders given', [cancel.functionName, cancel.args[0].length], ['cancel', 1]);

  /* A receipt, as a node would return it. */
  const topics = encodeEventTopics({ abi: S.SEAPORT_ABI, eventName: 'OrderFulfilled', args: { offerer: holder.address, zone: S.ZERO_ADDRESS } });
  const data = encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'address' },
      { type: 'tuple[]', components: [{ type: 'uint8' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }] },
      { type: 'tuple[]', components: [{ type: 'uint8' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'address' }] }],
    [S.orderHash(o), '0x00000000000000000000000000000000000000aa', [[2, GW, 9n, 1n]], [[0, S.ZERO_ADDRESS, 0n, parseEther('0.0375'), holder.address]]]);
  const receipt = { logs: [{ address: S.SEAPORT, topics, data, logIndex: 0 },
    { address: '0x000000000000000000000000000000000000bEEF', topics, data, logIndex: 1 }] };
  const fills = S.fillsIn(receipt);
  is('a fill is read from Seaport\'s log, and only Seaport\'s', [fills.length, fills[0].orderHash], [1, S.orderHash(o)]);
  is('with the buyer as the recipient', fills[0].recipient.toLowerCase(), '0x00000000000000000000000000000000000000aa');
}

console.log('\n— the price —');
{
  const w = { listed_eth: 0.05 };
  is('the live listing is the list price', R.listWei(w, { kind: 'buy-now', price_wei: '30600000000000000' }), 30600000000000000n);
  is('then the listing in ETH', R.listWei(w, { kind: 'buy-now', price_eth: 0.1 }), parseEther('0.1'));
  is('an auction\'s reserve is not a list price', R.listWei(w, { kind: 'auction', price_wei: '1' }), parseEther('0.05'));
  is('then the catalogue', R.listWei(w, null), parseEther('0.05'));
  is('and with neither there is no price', R.listWei({}, null), null);
  is('25% under list', R.railWei(parseEther('0.05'), 7500), parseEther('0.0375'));
}

console.log('\n— the door —');
{
  const h = `0x${'ab'.repeat(32)}`;
  is('a bare hash in X-PAYMENT', R.paymentHash(h), h);
  is('x402\'s base64 JSON', R.paymentHash(Buffer.from(JSON.stringify({ x402Version: 1, payload: { txHash: h } })).toString('base64')), h);
  is('or ?tx=', R.paymentHash(null, h), h);
  is('and nothing else', [R.paymentHash('0x12'), R.paymentHash('not base64 json')], [null, null]);
  is('the agent gate names the site, the work and the moment',
    R.gateMessage('geodetic-world-1', '2026-09-27T00:00:00Z'), 'mintface.art agent rail\nWork: geodetic-world-1\nIssued: 2026-09-27T00:00:00Z');
}

console.log('\n— the tweet —');
{
  const ev = (via) => ({ kind: 'sale', payload: { id: 'geodetic-world-14', title: 'Geodetic Lisbon', collection: 'Geodetic World',
    price: '0.0375 ETH', address: '0x00000000000000000000000000000000000000aa', url: 'https://mintface.art/w/geodetic-world-14', ...(via ? { via } : {}) } });
  is('a rail fill says it came through the rail', compose(ev('agent-rail')).text.split('\n')[0].startsWith('COLLECTED ON THE AGENT RAIL · GEODETIC WORLD · GEODETIC LISBON · 0.0375 ETH'), true);
  is('any other sale is as it was', compose(ev(null)).text.startsWith('COLLECTED · GEODETIC WORLD'), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
