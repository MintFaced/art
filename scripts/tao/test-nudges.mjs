#!/usr/bin/env node
/* The nudge rules, checked against arithmetic done by hand.
 *
 * The clamp is what makes a nudge mean anything, so it is the case pinned
 * hardest: weigh a hundred thousand, sell down to ten, and ten is what you
 * said. Weigh what you hold, hold what you weighed.
 *
 *   node scripts/tao/test-nudges.mjs
 */
import { createRequire } from 'node:module';
import { tally, latest, isOpen, provenanceLine, palette, checkHex, lockRule, kindOf, proposeMessage, weighMessage } from '../../api/_lib/nudges.js';
const require2 = createRequire(import.meta.url);

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

/* ================= candidates, and the lock =================
   The pilot: choose a colour for the next Strip Painting. The collectors
   supply the answers as well as the weight, and the studio pre-commits to
   painting whatever locks ... so the threshold has to be real. */
const RED = '#C0392B', BLUE = '#2C3E50', GREEN = '#2A6529';
const prop = (hex, address, at) => ({ nudge: 'p1', hex, address, at });
const put = (address, hex, amount, at) => ({ nudge: 'p1', address, candidate: hex, amount, at });
const five = { a: 300000, b: 120000, c: 90000, d: 40000, e: 30000, f: 5, g: 900000 };
const holds = (x) => five[x] || 0;

{
  const p = palette(
    [put('a', RED, 300000, '1'), put('b', RED, 120000, '2'), put('c', RED, 90000, '3'),
      put('d', RED, 40000, '4'), put('e', RED, 30000, '5'), put('f', BLUE, 5, '6')],
    [prop(RED, 'a', '1'), prop(BLUE, 'b', '2'), prop(GREEN, 'c', '3')], holds, null);
  is('the board is sorted by weight', p.candidates.map((c) => c.hex), [RED, BLUE, GREEN]);
  is('a colour nobody weighed on is still on the board', p.candidates[2].total, 0);
  is('the leader carries its collectors', [p.leader.hex, p.leader.voters], [RED, 5]);
  is('five collectors and 580,000 TAO locks it', p.locked && p.locked.hex, RED);
  is('and there is nothing to explain', p.why, null);
  is('the total is every colour together', p.total, 580005);
  is('and the collectors are counted once each', p.collectors, 6);
}

{
  /* Enough TAO, not enough people. One wallet cannot choose the colour the
     studio has undertaken to paint. */
  const p = palette([put('g', RED, 900000, '1')], [prop(RED, 'g', '1')], holds, null);
  is('one wallet with nine hundred thousand does not lock it', p.locked, null);
  is('and is told which half it is short of', /5 collectors/.test(p.why), true);
}
{
  /* Enough people, not enough TAO. A crowd holding nothing cannot either. */
  const light = { a: 10, b: 10, c: 10, d: 10, e: 10 };
  const p = palette(
    ['a', 'b', 'c', 'd', 'e'].map((x, i) => put(x, RED, 10, String(i))),
    [prop(RED, 'a', '1')], (x) => light[x] || 0, null);
  is('five collectors holding fifty TAO between them do not lock it', p.locked, null);
  is('and are told which half', /500,000 TAO/.test(p.why), true);
}
{
  const p = palette([], [], holds, null);
  is('nothing proposed locks nothing', p.locked, null);
  is('and says so plainly', p.why, 'Nobody proposed a colour.');
}
{
  /* The clamp is the same clamp. Weigh six hundred thousand, sell down to
     thirty thousand, and thirty thousand is what the colour carries. */
  const p = palette(
    ['a', 'b', 'c', 'd'].map((x, i) => put(x, RED, 200000, String(i))).concat([put('e', RED, 600000, '5')]),
    [prop(RED, 'a', '1')], holds, null);
  is('five weighings on one colour', p.candidates[0].voters, 5);
  is('each clamped to what its wallet still holds', p.candidates[0].total, 200000 + 120000 + 90000 + 40000 + 30000);
  is('and the ones that shrank say so', p.candidates[0].ledger.filter((r) => r.clamped).length, 4);
  /* Which is the whole point of the clamp meeting the threshold: six hundred
     thousand was said, four hundred and eighty thousand is held, and the
     colour does not lock. What was promised is a colour the collectors still
     stood behind at close, not one they stood behind in May. */
  is('and the colour does not lock on TAO nobody holds any more', p.locked, null);
}
{
  /* A colour is a colour, not a row somebody owns: the same red proposed by
     two people is one swatch, and the first to say it keeps the credit. */
  const p = palette([], [prop(RED, 'a', '2026-01-02'), prop('#c0392b', 'b', '2026-01-01')], holds, null);
  is('the same colour twice is one swatch', p.candidates.length, 1);
  is('and the credit goes to whoever said it first', p.candidates[0].proposed_by, 'b');
  is('however it was typed', p.candidates[0].hex, RED);
}
{
  const rule = lockRule({ lock: { voters: 2, tao: 100 } });
  is('a nudge may set its own threshold', [rule.voters, rule.tao], [2, 100]);
  is('and the pilot is the default', [lockRule(null).voters, lockRule(null).tao], [5, 500000]);
}
{
  is('a colour is six hex digits', checkHex('c0392b').hex, RED);
  is('however it is typed', checkHex('#C0392B').hex, RED);
  is('three digits expand', checkHex('#abc').hex, '#AABBCC');
  is('and anything else is refused', Boolean(checkHex('teal').error), true);
  is('including one digit too many', Boolean(checkHex('#c0392b1').error), true);
}
{
  /* A signature names the colour it is for, so it cannot be spent on another. */
  const one = weighMessage({ nudge: 'q', candidate: RED, amount: 10, address: '0xa', issued: 'z' });
  const two = weighMessage({ nudge: 'q', candidate: BLUE, amount: 10, address: '0xa', issued: 'z' });
  is('a weighing names its colour', /^Colour: #C0392B$/m.test(one), true);
  is('and two colours are two sentences', one === two, false);
  is('a binary nudge still names a side', /^Side: YES$/m.test(weighMessage({ nudge: 'q', side: 'yes', amount: 1, address: '0xa', issued: 'z' })), true);
  is('and proposing is its own sentence', /Proposing puts this colour on the board/.test(proposeMessage({ nudge: 'q', hex: RED, address: '0xa', issued: 'z' })), true);
}
{
  is('a nudge with candidates says so', kindOf({ kind: 'candidates' }), 'candidates');
  is('and anything else is a yes or a no', kindOf({}), 'binary');
  is('a locked colour names itself in the provenance line',
    provenanceLine({ total: 512340, collectors: 7, number: 1, locked: { hex: RED } }),
    'Colour chosen by 512,340 TAO across 7 collectors · #C0392B · Nudge #1');
  is('and a nudge that only steered says only that',
    provenanceLine({ total: 214000, collectors: 31, number: 3 }),
    'Steered by 214,000 TAO across 31 collectors · Nudge #3');
}

/* ================= the public record ================= */
{
  /* One row per collector, and the row is where they stand now. Somebody who
     moves from blue to red is not two rows and not a history: the card is
     who-stands-where, and every signature that got them there is in the
     weighings file. */
  const held = { a: 300000, b: 120000, c: 90000 };
  const all = [
    { nudge: 'p1', address: 'a', candidate: RED, amount: 300000, at: '2026-09-01T10:00:00Z' },
    { nudge: 'p1', address: 'b', candidate: BLUE, amount: 120000, at: '2026-09-02T10:00:00Z' },
    { nudge: 'p1', address: 'b', candidate: RED, amount: 120000, at: '2026-09-03T10:00:00Z' },
    { nudge: 'p1', address: 'c', candidate: RED, amount: 90000, at: '2026-09-04T10:00:00Z' },
  ];
  const p = palette(latest(all, 'p1'), [prop(RED, 'a', '1'), prop(BLUE, 'b', '2')], (x) => held[x] || 0, null);
  is('four weighings from three collectors is three rows', p.ledger.length, 3);
  is('newest first', p.ledger.map((r) => r.address), ['c', 'b', 'a']);
  is('the one who switched appears once', p.ledger.filter((r) => r.address === 'b').length, 1);
  is('on the colour they are on now', p.ledger.find((r) => r.address === 'b').candidate, RED);
  is('and blue keeps nothing they took away', p.candidates.find((c) => c.hex === BLUE).total, 0);
  is('every row says which colour it is behind', p.ledger.every((r) => r.candidate), true);

  /* Somebody who sold everything still stands somewhere. The row says nought
     rather than disappearing: a ledger that quietly dropped people would be a
     ledger you could not check against the total. */
  const sold = palette(latest(all, 'p1'), [prop(RED, 'a', '1')], (x) => (x === 'a' ? 0 : held[x] || 0), null);
  is('a collector who sold down keeps their row', sold.ledger.length, 3);
  is('at nothing', sold.ledger.find((r) => r.address === 'a').weight, 0);
  is('marked as clamped', sold.ledger.find((r) => r.address === 'a').clamped, true);
  is('and is not counted among the collectors', sold.collectors, 2);
}
{
  /* How far the lock is, as two fractions. Not one blended figure: a nudge
     that met one threshold has met neither, and a single number would be a
     number that does not exist. */
  const held = { a: 380000, b: 1, c: 1, d: 1 };
  const p = palette(
    ['a', 'b', 'c', 'd'].map((x, i) => put(x, RED, held[x], String(i))),
    [prop(RED, 'a', '1')], (x) => held[x] || 0, null);
  is('the voters fraction', [p.progress.voters.at, p.progress.voters.of], [4, 5]);
  is('the TAO fraction', [p.progress.tao.at, p.progress.tao.of], [380003, 500000]);
  is('and it is short of both, so nothing locks', p.locked, null);

  const none = palette([], [], () => 0, null);
  is('with nothing proposed the fractions are nought', [none.progress.voters.at, none.progress.tao.at], [0, 0]);

  const over = palette(
    ['a', 'b', 'c', 'd', 'e', 'f'].map((x, i) => put(x, RED, 200000, String(i))),
    [prop(RED, 'a', '1')], () => 200000, null);
  is('past the line the fractions report what is actually there',
    [over.progress.voters.at, over.progress.tao.at], [6, 1200000]);
  is('and it locks', Boolean(over.locked), true);
}
{
  /* The card, read as text. Two class collisions bit here on the way in ...
     a ledger name wearing the room's hover affordance was drawn at opacity
     nought, and a colour chip wearing the availability dot came out round ...
     which is what a merged surface does when two components share a word. */
  const fs2 = require2('node:fs');
  const page = fs2.readFileSync(new URL('../../studio.html', import.meta.url), 'utf8');
  const led = page.slice(page.indexOf('function ledgerRows'), page.indexOf('function candidateCard'));
  is('the ledger has a summary above it', /collector\$\{x\.collectors === 1/.test(led)
    && /TAO weighed/.test(led), true);
  is('a name with a page is a door', /r\.url && !r\.private \? `<a href=/.test(led), true);
  is('a private collector is not', /class="anon"/.test(led), true);
  is('the ledger does not wear the room\'s hover class', /class="quiet"/.test(led), false);
  is('nor the availability dot', /class="dot"/.test(led), false);
  is('and the colour chip is its own class', /class="hexdot"/.test(led), true);
  is('the figures are the live ones, marked where they shrank', /r\.clamped \? '<span class="cl"/.test(led), true);
  const bars = page.slice(page.indexOf('function thresholdBars'), page.indexOf('function ledgerRows'));
  is('two bars, not one', (bars.match(/bar\('/g) || []).length, 2);
  is('drawn in the house meter', /class="meter"/.test(bars) && /class="track"/.test(bars), true);
  is('and each stops at its own line', /Math\.min\(1, at \/ of\)/.test(bars), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
