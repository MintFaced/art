#!/usr/bin/env node
/* The nudge rules, checked against arithmetic done by hand.
 *
 * The clamp is what makes a nudge mean anything, so it is the case pinned
 * hardest: weigh a hundred thousand, sell down to ten, and ten is what you
 * said. Weigh what you hold, hold what you weighed.
 *
 *   node scripts/tao/test-nudges.mjs
 */
import { tally, latest, isOpen, provenanceLine } from '../../api/_lib/nudges.js';

let pass = 0, fail = 0;
const is = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label.padEnd(56) + JSON.stringify(got) + (ok ? '' : '   want ' + JSON.stringify(want)));
  ok ? pass++ : fail++;
};

const A = '0xaaa', B = '0xbbb', C = '0xccc';
const w = (address, side, amount, at) => ({ nudge: 'n1', address, side, amount, at });

// plain tally
{ const t = tally([w(A, 'yes', 100, '1'), w(B, 'no', 40, '2')], () => 1000);
  is('yes 100, no 40', [t.totals.yes, t.totals.no], [100, 40]);
  is('two collectors', t.collectors, 2);
  is('result follows the weight', t.result, 'yes'); }

// the clamp
{ const held = { [A]: 10 };
  const t = tally([w(A, 'yes', 100000, '1')], (x) => held[x] || 0);
  is('weighed 100000, holds 10, counts 10', t.totals.yes, 10);
  is('and is marked as clamped', t.ledger[0].clamped, true); }

// selling out entirely removes the weight but not the row
{ const t = tally([w(A, 'yes', 500, '1'), w(B, 'no', 100, '2')], (x) => (x === A ? 0 : 100));
  is('a wallet that sold everything weighs nothing', t.totals.yes, 0);
  is('the other side still stands', t.totals.no, 100);
  is('and it no longer counts as a collector', t.counts.yes, 0); }

// latest stands
{ const all = [w(A, 'yes', 10, '2026-01-01'), w(A, 'no', 90, '2026-02-01'), w(B, 'yes', 5, '2026-01-05')];
  const rows = latest(all, 'n1');
  is('one row per wallet', rows.length, 2);
  const t = tally(rows, () => 1000);
  is('the later weighing is the one that counts', [t.totals.yes, t.totals.no], [5, 90]); }

// never inflated
{ const t = tally([w(A, 'yes', 50, '1')], () => 999999);
  is('holding more does not inflate what was said', t.totals.yes, 50); }

// an even split
{ const t = tally([w(A, 'yes', 100, '1'), w(B, 'no', 100, '2')], () => 1000);
  is('even is even, not a win', t.result, 'even'); }

// shares
{ const t = tally([w(A, 'yes', 75, '1'), w(B, 'no', 25, '2')], () => 1000);
  is('share of the whole', [t.share.yes, t.share.no], [0.75, 0.25]); }

// open and closed
is('an open nudge is open', isOpen({ closes: '2099-01-01' }, new Date('2026-01-01')), true);
is('a past close date is closed', isOpen({ closes: '2020-01-01' }, new Date('2026-01-01')), false);
is('a banked nudge is closed', isOpen({ closes: '2099-01-01', banked: {} }, new Date('2026-01-01')), false);
is('an unpublished nudge is not open', isOpen({ closes: '2099-01-01', published: false }, new Date('2026-01-01')), false);

// the line a work carries
is('provenance line', provenanceLine({ total: 214000, collectors: 31, number: 3 }),
  'Steered by 214,000 TAO across 31 collectors · Nudge #3');
is('one collector reads singular', provenanceLine({ total: 10, collectors: 1, number: 1 }),
  'Steered by 10 TAO across 1 collector · Nudge #1');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
