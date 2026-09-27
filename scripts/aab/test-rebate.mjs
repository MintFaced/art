#!/usr/bin/env node
/* 🧧 The rebate's arithmetic, with no network (REBATE.md).
 *
 * Every rule in the spec's acceptance list that can be held without a chain:
 * the split is exact to the wei, the scout's share rolls to the holders
 * whenever the scout is not valid, nobody passes the cap, a rerun is the same
 * rows, and the scout survives in the transaction an agent is handed.
 * scripts/aab/fork-e2e.mjs fills real orders with the scout in them.
 *
 *   node scripts/aab/test-rebate.mjs
 */
import { decodeFunctionData, parseEther } from 'viem';
import * as B from '../../api/_lib/rebate.js';
import * as S from '../../api/_lib/seaport.js';
import * as R from '../../api/_lib/aab.js';

let pass = 0, fail = 0;
const str = (v) => JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? x.toString() : x));
const is = (label, got, want) => {
  const ok = str(got) === str(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label.padEnd(66) + (ok ? '' : `got ${str(got)} want ${str(want)}`));
  ok ? pass++ : fail++;
};
const sum = (rows, kind) => rows.filter((r) => !kind || r.kind === kind).reduce((s, r) => s + BigInt(r.amount_wei), 0n);
const addr = (n) => `0x${n.toString(16).padStart(40, '0')}`;
const PRICE = parseEther('0.0375');
const terms = { priceWei: PRICE, holderPct: 40, scoutPct: 10, capPct: 5 };

/* Two hundred holders on a curve, like the real table. */
const holders = Array.from({ length: 200 }, (_, i) => ({ wallet: addr(1000 + i), tao: Math.floor(5000 + 2_000_000 / (i + 1)) }));

console.log('\n— one sale, split —');
{
  const a = B.allocate({ ...terms, holders, scout: addr(9) });
  is('with a valid scout, the rebate is exactly half the price', sum(a.rows), PRICE / 2n);
  is('the scout is exactly 10%', sum(a.rows, 'scout'), PRICE / 10n);
  is('the holders exactly 40%', sum(a.rows, 'holder'), (PRICE * 40n) / 100n);
  const b = B.allocate({ ...terms, holders, scout: null });
  is('with no scout, the holders take the whole 50%', [sum(b.rows, 'scout'), sum(b.rows, 'holder')], [0n, PRICE / 2n]);
  is('the same inputs give the same rows', str(B.allocate({ ...terms, holders: [...holders].reverse(), scout: addr(9) })), str(a));
  const odd = B.allocate({ ...terms, priceWei: 37_500_000_000_000_007n, holders, scout: addr(9) });
  is('a price that does not divide still adds up to the wei', sum(odd.rows), BigInt(odd.total));
  is('holder rows carry the TAO they were weighed by', a.rows.find((r) => r.kind === 'holder').tao_at_snapshot, holders[0].tao);
}

console.log('\n— the cap —');
{
  /* One group with 20% of the eligible TAO, as the spec's fixture has it. */
  const rest = Array.from({ length: 40 }, (_, i) => ({ wallet: addr(2000 + i), tao: 10_000 }));
  const whale = { wallet: addr(1), tao: 100_000 };
  const a = B.allocate({ ...terms, holders: [whale, ...rest], scout: null });
  const pool = BigInt(a.pool);
  const w = BigInt(a.rows.find((r) => r.wallet === addr(1)).amount_wei);
  is('20% of the TAO is held to the cap', w <= (pool * 5n) / 100n + 40n, true);
  is('and the excess goes to everybody else', sum(a.rows), pool);
  is('nobody past the cap, bar the rounding dust', a.rows.every((r) => BigInt(r.amount_wei) <= (pool * 5n) / 100n + 40n), true);
  const few = B.allocate({ ...terms, holders: rest.slice(0, 4), scout: null });
  is('four holders cannot keep a 5% cap: it becomes an even split', few.rows.map((r) => r.amount_wei), Array(4).fill(String(BigInt(few.pool) / 4n)));
  is('with nobody eligible, nothing is invented', [B.allocate({ ...terms, holders: [], scout: null }).unallocated], [String(PRICE / 2n)]);
}

console.log('\n— who is a holder —');
{
  const ARTIST = addr(0xa);
  const wallets = { [addr(1)]: { tao: 3000 }, [addr(2)]: { tao: 3000 }, [addr(3)]: { tao: 9000 },
    [addr(4)]: { tao: 1000 }, [ARTIST]: { tao: 50_000 }, [addr(5)]: { tao: 40_000 } };
  /* 1 and 2 are one COMBO through hot wallet 7, who holds nothing; 5 is a
     vault delegating to the artist. */
  const groups = { [addr(1)]: addr(7), [addr(2)]: addr(7), [addr(5)]: ARTIST };
  const h = B.eligibleHolders({ wallets, groups, exclude: new Set([ARTIST]), minTao: 5000 });
  const by = Object.fromEntries(h.map((x) => [x.wallet, x.tao]));
  is('a COMBO is one holder, named by its hot wallet, holding the sum', by[addr(7)], 6000);
  is('which clears 5,000 though neither wallet does alone', [by[addr(1)], by[addr(2)]], [undefined, undefined]);
  is('a wallet under 5,000 is out', by[addr(4)], undefined);
  is('the artist is out, and so is a vault that speaks through the artist', [by[ARTIST], by[addr(5)]], [undefined, undefined]);
  is('the group of a vault is its hot wallet', B.groupTao({ wallets, groups, wallet: addr(2) }), { group: addr(7), tao: 6000 });
}

console.log('\n— the scout, in the buyer\'s own transaction —');
{
  const scout = '0x00000000000000000000000000000000000000c0';
  const order = S.sellOrder({ offerer: addr(0xa), token: addr(0xb), tokenId: 1, priceWei: PRICE, startTime: 0, endTime: 9e9, salt: 1n });
  const plain = S.fulfillTransaction(order, `0x${'11'.repeat(65)}`);
  const withS = B.withScout(plain.data, scout);
  is('the scout reads back out of the calldata', B.scoutFrom(withS), scout);
  is('Seaport\'s own arguments decode exactly as before', str(decodeFunctionData({ abi: S.SEAPORT_ABI, data: withS }).args),
    str(decodeFunctionData({ abi: S.SEAPORT_ABI, data: plain.data }).args));
  is('a transaction with no scout names nobody', B.scoutFrom(plain.data), null);
  is('nor does the marker anywhere but at the very end', B.scoutFrom(`${withS}00`), null);
  R.useConfig({ holder: addr(0xa), rate_bps: 7500, days: 30 });
  const rec = { id: 'w', title: 'T', collection_title: 'C', contract: addr(0xb), token_id: '1', standard: 'ERC-721',
    order: S.orderToJSON(order), signature: `0x${'11'.repeat(65)}`, rail_wei: String(PRICE), list_wei: String(PRICE),
    hash: S.orderHash(order), expires: new Date(Date.now() + 86400e3).toISOString() };
  const p = R.paymentRequired(rec, { holder: addr(0xa), rate_bps: 7500 }, { ref: '@scout', wallet: scout });
  is('the 402 hands out the transaction with the scout already in it', B.scoutFrom(p.accepts[0].extra.transaction.data), scout);
  is('and says so', p.accepts[0].extra.scout.wallet, scout);
  const q = R.paymentRequired(rec, { holder: addr(0xa), rate_bps: 7500 }, { ref: 'nobody', wallet: null });
  is('a ref that names nobody leaves the transaction as it was', q.accepts[0].extra.transaction.data, plain.data);
}

console.log('\n— what the holder signs —');
{
  const m = B.campaignMessage({ action: 'start', id: 'c1', issued: '2026-09-28T00:00:00Z',
    terms: { holder_pct: 40, scout_pct: 10, min_tao: 5000, cap_pct: 5, min_payout_eth: '0.001' },
    scope: { works: Array(109).fill('x'), ends_at: '2026-10-27T04:15:00.000Z' } });
  is('every term is in the message', ['40% by TAO', '5000 TAO or more', '5% of the pool', 'Scouts: 10%', '0.001 ETH', '109 on the agent rail', '2026-10-27']
    .every((t) => m.includes(t)), true);
  is('and starting it confirms the adviser has looked', m.includes('I confirm an NZ adviser has reviewed the rebate framing.'), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
