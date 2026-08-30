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
import { tally, latest, isOpen, provenanceLine, palette, standing, allocations, spread, checkHex, lockRule, kindOf, proposeMessage, weighMessage, withLive } from '../../api/_lib/nudges.js';
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
/* A weighing under the allocation model: it sets one colour and leaves the
   rest of that wallet's map alone. Rows without `alloc` are from before it and
   are folded differently ... see the migration cases at the end. */
const put = (address, hex, amount, at) => ({ nudge: 'p1', address, candidate: hex, amount, at, alloc: true, signature: `s-${address}-${hex}-${at}` });
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
  is('and the ones that shrank say so', p.candidates[0].wallets.filter((r) => r.clamped).length, 4);
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
  /* The record is every allocation change, newest first. */
  const held = { a: 300000, b: 120000, c: 90000 };
  const all = [
    put('a', RED, 300000, '2026-09-01T10:00:00Z'),
    put('b', BLUE, 120000, '2026-09-02T10:00:00Z'),
    put('b', RED, 120000, '2026-09-03T10:00:00Z'),
    put('c', RED, 90000, '2026-09-04T10:00:00Z'),
  ];
  const p = palette(all, [prop(RED, 'a', '1'), prop(BLUE, 'b', '2')], (x) => held[x] || 0, null);
  is('four changes is four entries', p.ledger.length, 4);
  is('newest first', p.ledger.map((r) => r.address), ['c', 'b', 'b', 'a']);
  is('each carries its colour and its delta',
    p.ledger.map((r) => `${r.candidate}${r.delta > 0 ? '+' : ''}${r.delta}`),
    [`${RED}+90000`, `${RED}+120000`, `${BLUE}+120000`, `${RED}+300000`]);

  /* And b is on BOTH now, which is the whole change: weighing red did not
     take the weight off blue. */
  is('a wallet may stand on two colours at once',
    [p.candidates.find((c) => c.hex === RED).wallets.some((w) => w.address === 'b'),
      p.candidates.find((c) => c.hex === BLUE).wallets.some((w) => w.address === 'b')], [true, true]);
  is('and counts once as a collector however it split', p.collectors, 3);
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
  /* Clamping moved off the ledger with the model. The record is what was
     signed ... a change of a stored amount ... and what that amount is worth
     today is a fact about now, said on the board and in the wallet's own
     purse rather than written back into the history. */
  is('the record shows a signed change, not a live figure', /r\.moved \? '<span class="cl"/.test(led), true);
  is('and what a weighing is worth today is said on the board',
    /clamped: weight </.test(fs2.readFileSync(new URL('../../api/_lib/nudges.js', import.meta.url), 'utf8')), true);
  const sw = page.slice(page.indexOf('function swatches'), page.indexOf('function purse'));
  is('a field per colour, not one box and a chosen colour',
    /id="amt-\$\{e\(x\.id\)\}-\$\{e\(c\.hex\.slice\(1\)\)\}"/.test(sw), true);
  is('pre-filled with what this wallet has on that colour', /value="\$\{on \|\| ''\}"/.test(sw), true);
  is('and nothing that picks one colour to the exclusion of the others',
    /data-pick/.test(page), false);
  const purse = page.slice(page.indexOf('function purse'), page.indexOf('function proposer'));
  is('what is left to spread is shown', /available/.test(purse), true);
  is('and an over-weight wallet is told rather than corrected',
    /m\.over > 0/.test(purse) && /in proportion/.test(purse), true);
  is('the record is a change log', /class="w"><span class="\$\{d < 0/.test(led), true);

  const bars = page.slice(page.indexOf('function thresholdBars'), page.indexOf('function ledgerRows'));
  is('two bars, not one', (bars.match(/bar\('/g) || []).length, 2);
  is('drawn in the house meter', /class="meter"/.test(bars) && /class="track"/.test(bars), true);
  is('and each stops at its own line', /Math\.min\(1, at \/ of\)/.test(bars), true);
}

/* ================= what has been said since the last deploy ================= */
{
  /* The bug this exists for, four minutes after nudge #1 opened: a collector
     signed for a colour, the route committed it to the repo and told them it
     was on the board, and the board was empty. api/nudge.js reads the file as
     the deployment serves it, and this site does not deploy on push. */
  const file = {
    weighings: [{ nudge: 'n', address: 'a', candidate: RED, amount: 1, signature: '0x1' }],
    proposals: [{ nudge: 'n', hex: RED, address: 'a', signature: '0x0' }],
  };
  const live = [
    { nudge: 'n', hex: RED, address: 'a', signature: '0x0' },
    { nudge: 'n', hex: BLUE, address: 'b', signature: '0x2' },
    { nudge: 'n', address: 'b', candidate: BLUE, amount: 5, signature: '0x3' },
  ];
  const m = withLive(file, live);
  is('a colour proposed since the deploy is on the board', m.proposals.map((p) => p.hex), [RED, BLUE]);
  is('and a weighing made since is in the tally', m.weighings.map((w) => w.signature), ['0x1', '0x3']);
  is('a row that has since reached the file appears once',
    m.proposals.filter((p) => p.signature === '0x0').length, 1);
  is('a proposal is told from a weighing by what it carries',
    [m.proposals.every((p) => p.hex), m.weighings.every((w) => w.candidate)], [true, true]);
  is('with nothing live the file stands alone',
    withLive(file, []).proposals.length + withLive(file, []).weighings.length, 2);
  is('and with no file at all the overlay is the whole of it',
    withLive(null, live).proposals.length, 2);

  /* And it reaches the tally, which is the point: the board is what the
     overlay makes it, not what the last deploy made it. */
  const p = palette(latest(m.weighings, 'n'), m.proposals.filter((x) => x.nudge === 'n'), () => 1000, null);
  is('the board is drawn from both', p.candidates.map((c) => c.hex).sort(), [BLUE, RED].sort());
}

/* ================= splitting =================
   Decision B: a wallet spreads its TAO across as many colours as it likes,
   total allocated no more than what it holds, and the remainder may simply sit
   there unallocated. */
{
  const held = { a: 300000 };
  const t = (x) => held[x] || 0;
  const props = [prop(RED, 'a', '1'), prop(BLUE, 'a', '2'), prop(GREEN, 'a', '3')];

  const two = palette([put('a', RED, 200000, '1'), put('a', BLUE, 50000, '2')], props, t, null);
  is('a wallet across two colours', two.candidates.filter((c) => c.total > 0).map((c) => [c.hex, c.total]),
    [[RED, 200000], [BLUE, 50000]]);
  is('and it is one collector, not two', two.collectors, 1);
  is('with fifty thousand of its TAO left unallocated', standing([put('a', RED, 200000, '1'), put('a', BLUE, 50000, '2')], 'a', t).available, 50000);

  /* The reported bug, made impossible by the model rather than by care:
     changing one colour cannot touch another, because they are different keys
     and the signature names one of them. */
  const edited = palette(
    [put('a', RED, 200000, '1'), put('a', BLUE, 50000, '2'), put('a', RED, 10000, '3')], props, t, null);
  is('editing red leaves blue exactly where it was',
    edited.candidates.find((c) => c.hex === BLUE).total, 50000);
  is('and red is what it was changed to', edited.candidates.find((c) => c.hex === RED).total, 10000);

  /* Nought is how a colour is taken back, and it is a change like any other. */
  const dropped = palette(
    [put('a', RED, 200000, '1'), put('a', BLUE, 50000, '2'), put('a', RED, 0, '3')], props, t, null);
  is('setting a colour to nought takes it back', dropped.candidates.find((c) => c.hex === RED).total, 0);
  is('and leaves the other one alone', dropped.candidates.find((c) => c.hex === BLUE).total, 50000);
  is('and is an entry in the record like anything else',
    dropped.ledger[0].delta, -200000);
  is('while the wallet still stands on blue', dropped.collectors, 1);

  is('a wallet with nothing allocated has all of it available',
    standing([], 'a', t).available, 300000);
  is('and one that allocated the lot has none', standing([put('a', RED, 300000, '1')], 'a', t).available, 0);
}

{
  /* Selling down. Nothing is rewritten ... what they signed is what they
     signed ... but the board is never inflated, so the set is scaled in
     proportion wherever it is read, which includes at lock. */
  const rows = [put('a', RED, 200000, '1'), put('a', BLUE, 100000, '2')];
  const p = palette(rows, [prop(RED, 'a', '1'), prop(BLUE, 'a', '2')], () => 120000, null);
  is('an over-weight wallet is scaled in proportion, keeping the shape',
    p.candidates.map((c) => [c.hex, c.total]).filter((x) => x[1] > 0), [[RED, 80000], [BLUE, 40000]]);
  is('the total is what they hold, never more', p.candidates.reduce((a, c) => a + c.total, 0), 120000);
  is('and they are named as over-weight rather than quietly corrected',
    [p.over.length, p.over[0].asked, p.over[0].held, p.over[0].over], [1, 300000, 120000, 180000]);
  is('their own standing says the same thing',
    standing(rows, 'a', () => 120000).over, 180000);
  is('and every scaled row says it was clamped',
    p.candidates.flatMap((c) => c.wallets).every((w) => w.clamped), true);
  is('the stored amounts are untouched',
    standing(rows, 'a', () => 120000).allocations.map((x) => x.amount), [200000, 100000]);

  /* Sold everything: the whole set goes to nought and they stop being a
     collector, without any of their signatures being lost. */
  const none = palette(rows, [prop(RED, 'a', '1')], () => 0, null);
  is('a wallet that sold up carries nothing', none.total, 0);
  is('and is not counted', none.collectors, 0);
  is('though the record still has every change they made', none.ledger.length, 2);
}

{
  /* The lock, with splits. A wallet counts once on the nudge however many
     colours it is across, and counts towards the leading colour only for the
     part it actually put there. */
  const held = { a: 200000, b: 200000, c: 200000, d: 200000, e: 200000 };
  const t = (x) => held[x] || 0;
  const props = [prop(RED, 'a', '1'), prop(BLUE, 'a', '2')];

  /* Five wallets, all split half and half. Red has 500,000 and five wallets. */
  const rows = ['a', 'b', 'c', 'd', 'e'].flatMap((x, i) => [
    put(x, RED, 100000, `${i}a`), put(x, BLUE, 100000, `${i}b`)]);
  const p = palette(rows, props, t, null);
  is('the leader carries five distinct wallets', [p.leader.hex, p.leader.voters], [RED, 5]);
  is('and half a million between them', p.leader.total, 500000);
  is('so it locks', Boolean(p.locked), true);
  is('while the nudge counts five collectors, not ten', p.collectors, 5);
  is('and the total is everything allocated across both colours', p.total, 1000000);

  /* Four wallets on red and one on blue: red has the TAO and not the wallets. */
  const four = palette([
    put('a', RED, 200000, '1'), put('b', RED, 200000, '2'),
    put('c', RED, 200000, '3'), put('d', RED, 100000, '4'),
    put('e', BLUE, 200000, '5')], props, t, null);
  is('four wallets on the leader is not five', four.leader.voters, 4);
  is('however much TAO they carry', four.leader.total, 700000);
  is('so nothing locks', four.locked, null);
  is('and it says which half is short', /5 collectors/.test(four.why), true);

  /* A wallet that split so thinly it carries nothing on the leader does not
     count towards it. */
  const thin = palette([
    put('a', RED, 200000, '1'), put('b', RED, 200000, '2'),
    put('c', RED, 200000, '3'), put('d', RED, 200000, '4'),
    put('e', RED, 0, '5'), put('e', BLUE, 200000, '6')], props, t, null);
  is('a wallet with nothing on the leader is not one of its voters', thin.leader.voters, 4);
  is('though it is still a collector on the nudge', thin.collectors, 5);
}

{
  /* Migration. The rows written before allocations existed carry over as one
     allocation each, untouched ... and nothing a collector had already moved
     away from comes back to life.

     This is 0xunix.eth's real history on nudge #1: blue, then red, then blue
     again, which is what somebody looks like fighting a model that took the
     first colour away when they weighed the second. */
  const real = [
    { nudge: 'p1', address: 'u', candidate: BLUE, amount: 100000, at: '2026-08-30T07:00:00Z', signature: 'r1' },
    { nudge: 'p1', address: 'u', candidate: RED, amount: 100000, at: '2026-08-30T07:30:00Z', signature: 'r2' },
    { nudge: 'p1', address: 'u', candidate: BLUE, amount: 100000, at: '2026-08-30T07:45:00Z', signature: 'r3' },
  ];
  const t = () => 100000;
  const p = palette(real, [prop(BLUE, 'u', '1'), prop(RED, 'u', '2')], t, null);
  is('the old rows fold to the one position the old model gave them',
    p.candidates.filter((c) => c.total > 0).map((c) => [c.hex, c.total]), [[BLUE, 100000]]);
  is('the colour they moved away from does not come back', p.candidates.find((c) => c.hex === RED).total, 0);
  is('and they are one collector holding one hundred thousand', [p.collectors, p.total], [1, 100000]);

  /* The history reads honestly: two moves, each one signature, each showing
     what it took off as well as what it put on. */
  is('five entries from three signatures', p.ledger.length, 5);
  is('and the two that were moves say so', p.ledger.filter((r) => r.moved).length, 2);
  is('newest first, ending where they started',
    p.ledger.map((r) => `${r.candidate}${r.delta > 0 ? '+' : ''}${r.delta}`),
    [`${BLUE}+100000`, `${RED}-100000`, `${RED}+100000`, `${BLUE}-100000`, `${BLUE}+100000`]);

  /* And from here on they can split, without the old rows arguing with it. */
  const after = palette([...real, put('u', RED, 40000, '2026-08-31T09:00:00Z')],
    [prop(BLUE, 'u', '1'), prop(RED, 'u', '2')], () => 140000, null);
  is('a split made after the migration simply adds',
    after.candidates.map((c) => [c.hex, c.total]).filter((x) => x[1] > 0), [[BLUE, 100000], [RED, 40000]]);
  is('and nothing is over-weight', after.over.length, 0);
}

/* ================= weighing without a wallet prompt ================= */
{
  /* A tiny store, enough for the session and the rate limit. */
  const str = new Map(); const list = new Map(); let NOW = Date.now();
  const ttl = new Map();
  const alive = (k) => !ttl.has(k) || ttl.get(k) > NOW;
  const fake = async (cmds) => cmds.map(([c, ...a]) => {
    const k = a[0];
    if (c === 'SET') {
      if (!alive(k)) { str.delete(k); ttl.delete(k); }
      if (a.includes('NX') && str.has(k)) return null;
      str.set(k, a[1]);
      const i = a.indexOf('EX');
      if (i > -1) ttl.set(k, NOW + Number(a[i + 1]) * 1000);
      return 'OK';
    }
    if (c === 'GET') { if (!alive(k)) { str.delete(k); ttl.delete(k); } return str.has(k) ? str.get(k) : null; }
    if (c === 'INCR') { const v = (Number(str.get(k)) || 0) + 1; str.set(k, String(v)); return v; }
    if (c === 'EXPIRE') { ttl.set(k, NOW + Number(a[1]) * 1000); return 1; }
    if (c === 'RPUSH') { if (!list.has(k)) list.set(k, []); list.get(k).push(...a.slice(1)); return 1; }
    if (c === 'LTRIM') return 'OK';
    if (c === 'LRANGE') return list.get(k) || [];
    throw new Error(`no ${c}`);
  });

  const { chatStore, sessionId, SCOPE, SCOPE_WEIGH } = await import('../../api/_lib/chat.js');
  const { nudgeStore } = await import('../../api/_lib/nudges.js');
  const db = chatStore(fake);
  const W = '0x' + 'a'.repeat(40);

  /* A session opened today may weigh. */
  await db.openSession('t'.repeat(64), W, 3600, SCOPE, { signature: '0xsig', issued: 'i', until: 'u', domain: 'mintface.art' });
  const now = await db.session('t'.repeat(64));
  is('a session opened today says who and what it may do', [now.address, now.scope], [W, SCOPE]);
  is('and it may weigh', now.scope >= SCOPE_WEIGH, true);

  /* One opened before weighing joined the sentence may not, and is still a
     perfectly good session for speaking. */
  await fake([['SET', `chat:s:${'o'.repeat(64)}`, W]]);
  const old = await db.session('o'.repeat(64));
  is('a session from before scopes existed still works', old.address, W);
  is('at the scope its sentence actually described', old.scope, 1);
  is('so it may not weigh', old.scope >= SCOPE_WEIGH, false);
  is('and the old accessor still answers for it', await db.whoseSession('o'.repeat(64)), W);

  /* The chain: signature -> session -> weighings. The session's public name is
     a hash of its token, so a weighing can carry it without carrying a
     credential, and the proof outlives the session. */
  const id = sessionId('t'.repeat(64));
  const proof = await db.sessionProof(id);
  is('the signature that opened a session is written down', proof.signature, '0xsig');
  is('under a name that is not the token', id !== 't'.repeat(64) && id.length === 16, true);
  is('and knowing the name does not give you the session', await db.session(id), null);

  /* The wallet prompt used to be the rate limit. Something has to be. */
  const rl = nudgeStore(fake);
  is('one act goes through', (await rl.spend(W)).ok, true);
  is('and a second in the same breath waits', Boolean((await rl.spend(W)).error), true);
  NOW += 5000;
  is('a few seconds later it does not', (await rl.spend(W)).ok, true);
  let stopped = null;
  for (let i = 0; i < 60 && !stopped; i++) { NOW += 5000; const r = await rl.spend(W); if (r.error) stopped = i; }
  is('and a script runs into a cap over ten minutes', stopped !== null, true);

  /* The overlay dedupes on whatever names an act, and a session row has no
     signature to be named by. */
  const row = { nudge: 'n', address: W, candidate: RED, amount: 1, at: '2026-09-01T00:00:00Z', session: id, alloc: true };
  const twice = withLive({ weighings: [row], proposals: [] }, [row]);
  is('a session weighing that has reached the file appears once', twice.weighings.length, 1);
  const other = withLive({ weighings: [row], proposals: [] },
    [{ ...row, at: '2026-09-01T00:05:00Z' }]);
  is('and a later one from the same session is a second act', other.weighings.length, 2);
}

{
  /* The sentence names what it authorises, on both sides, to the character. */
  const fs3 = require2('node:fs');
  const server = fs3.readFileSync(new URL('../../api/_lib/chat.js', import.meta.url), 'utf8');
  const browser = fs3.readFileSync(new URL('../../mintface.js', import.meta.url), 'utf8');
  const line = 'and weigh your TAO on the';
  is('the sign-in sentence names weighing', server.includes(line) && browser.includes(line), true);
  is('and it still promises nothing moves',
    server.includes('It moves nothing and spends nothing.'), true);
  const page = fs3.readFileSync(new URL('../../studio.html', import.meta.url), 'utf8');
  const weighFn = page.slice(page.indexOf('async function weigh('), page.indexOf('console.log') > 0 ? page.length : page.length);
  is('the page no longer signs a weighing', /MF\.sign\(message/.test(weighFn), false);
  is('and asks once more where a session predates the sentence', /j\.rescope/.test(page), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
