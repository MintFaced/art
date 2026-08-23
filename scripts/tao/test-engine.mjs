#!/usr/bin/env node
/* The accrual rules, checked against arithmetic done by hand.
 *
 * TAO is the only number on the site that can go down, so the rules that take
 * it away are the ones worth pinning: a sale removes every day it earned, a
 * gift leaves them banked, a partial exit takes its share. Each case here is
 * one a reader could work out on paper and disagree with.
 *
 *   node scripts/tao/test-engine.mjs
 */
import { computeTao } from '../../api/_lib/tao.js';
const cfg = { rates: { unique_per_day: 69, edition_copy_per_day: 4.2 },
  exclusions: { '0x0000000000000000000000000000000000000000': 'mint', '0xartist': 'x' } };
const D = 86400, T0 = 1000000000;
const A = '0xaaa', B = '0xbbb', ZERO = '0x0000000000000000000000000000000000000000';
const tokens = new Map([['c1|1', { unique: true, work: 'w1' }], ['c1|2', { unique: false, work: 'w2' }]]);
const run = (evs, days) => computeTao(evs, tokens, cfg, T0 + days * D);
const ev = (o) => ({ contract: 'c1', ...o });
let pass = 0, fail = 0;
const is = (label, got, want) => {
  const ok = Math.abs(got - want) < 0.51;
  console.log((ok ? '  ok   ' : '  FAIL ') + label.padEnd(52) + String(got).padStart(9) + '   want ' + want);
  ok ? pass++ : fail++;
};

// 1/1 held 100 days
is('1/1 held 100 days = 6900',
  run([ev({ token: '1', from: ZERO, to: A, qty: 1, ts: T0 })], 100).wallets[0].tao_total, 6900);

// rate
is('rate for one 1/1 = 69/day',
  run([ev({ token: '1', from: ZERO, to: A, qty: 1, ts: T0 })], 100).wallets[0].tao_rate, 69);

// 3 edition copies held 100 days = 3 * 4.2 * 100
is('3 edition copies, 100 days = 1260',
  run([ev({ token: '2', from: ZERO, to: A, qty: 3, ts: T0 })], 100).wallets[0].tao_total, 1260);

// sold after 100 days: all of it goes
{ const r = run([ev({ token: '1', from: ZERO, to: A, qty: 1, ts: T0 }),
                 ev({ token: '1', from: A, to: B, qty: 1, ts: T0 + 100 * D, sale: true })], 200);
  const a = r.wallets.find((w) => w.address === A), b = r.wallets.find((w) => w.address === B);
  is('seller keeps nothing', a.tao_total, 0);
  is('seller shows what was lost', a.tao_lost, 6900);
  is('buyer accrues from purchase only', b.tao_total, 6900); }

// gifted after 100 days: sender keeps the days, accrual stops
{ const r = run([ev({ token: '1', from: ZERO, to: A, qty: 1, ts: T0 }),
                 ev({ token: '1', from: A, to: B, qty: 1, ts: T0 + 100 * D, sale: false })], 200);
  const a = r.wallets.find((w) => w.address === A), b = r.wallets.find((w) => w.address === B);
  is('gifter keeps banked TAO', a.tao_total, 6900);
  is('gifter rate stops', a.tao_rate, 0);
  is('receiver accrues from the gift', b.tao_total, 6900); }

// partial edition sale takes a proportional share
{ const r = run([ev({ token: '2', from: ZERO, to: A, qty: 4, ts: T0 }),
                 ev({ token: '2', from: A, to: B, qty: 1, ts: T0 + 100 * D, sale: true })], 100);
  const a = r.wallets.find((w) => w.address === A);
  is('4 copies 100 days, sell 1: 1680 - 420', a.tao_total, 1260); }

// balance change mid-tenure is an interval boundary
{ const r = run([ev({ token: '2', from: ZERO, to: A, qty: 1, ts: T0 }),
                 ev({ token: '2', from: ZERO, to: A, qty: 2, ts: T0 + 100 * D })], 200);
  is('1 copy 100d then 3 copies 100d = 420 + 1260', r.wallets[0].tao_total, 1680); }

// mint interval accrues to nobody
{ const r = run([ev({ token: '1', from: ZERO, to: ZERO, qty: 1, ts: T0 })], 100);
  is('zero address never accrues', r.wallets.length, 0); }

// excluded wallet accrues nothing, and its exit takes nothing back
{ const r = run([ev({ token: '1', from: ZERO, to: '0xartist', qty: 1, ts: T0 }),
                 ev({ token: '1', from: '0xartist', to: A, qty: 1, ts: T0 + 50 * D, sale: true })], 100);
  is('artist wallet does not accrue', r.wallets.length, 1);
  is('collector accrues only their 50 days', r.wallets[0].tao_total, 3450); }

// re-acquired after selling: fresh start, old loss stays lost
{ const r = run([ev({ token: '1', from: ZERO, to: A, qty: 1, ts: T0 }),
                 ev({ token: '1', from: A, to: B, qty: 1, ts: T0 + 100 * D, sale: true }),
                 ev({ token: '1', from: B, to: A, qty: 1, ts: T0 + 150 * D, sale: true })], 200);
  const a = r.wallets.find((w) => w.address === A);
  is('re-acquiring starts fresh (50 days)', a.tao_total, 3450); }

// fractional days count fractionally, display floors
{ const r = run([ev({ token: '1', from: ZERO, to: A, qty: 1, ts: T0 })], 0.5);
  is('half a day = 34 (34.5 floored)', r.wallets[0].tao_total, 34); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
