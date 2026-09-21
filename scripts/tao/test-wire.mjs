/* The wire: the voice, the guards, and the two tables that must agree.
 *
 * Nothing here touches X or the store. The copy is pure and the queue's rules
 * are shapes, which is the point of splitting them that way: a feed is a thing
 * you cannot take back, so its wording is tested rather than watched.
 */
import { readFileSync } from 'node:fs';
import { compose, speak, who, slotsRow, shortDate, TAO_GLYPH } from '../../api/_lib/wire.js';
import { weight } from '../../api/_lib/x.js';
import { colourName, NAMES } from '../../api/_lib/palette.js';

let pass = 0; const fails = [];
const is = (what, got, want, note) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ok  ', what.padEnd(58), JSON.stringify(got)); }
  else { fails.push(what); console.log('  FAIL', what.padEnd(58), JSON.stringify(got), '  want', JSON.stringify(want)); }
};
const head = (t) => console.log(`\n${t}\n${'-'.repeat(t.length)}`);

const OVERLAY = { collectors: {
  '0xaaa': { name: 'piercedcat', x: 'piercedcat' },
  '0xbbb': { name: '0xunix', x: '0xunix' },
  '0xccc': { name: 'keyrun', x: 'keyrun' },
  '0xqqq': { name: 'shy one', x: 'shyone', quiet: true },
  '0xnnn': { name: 'no handle' },
} };
const ctx = { overlay: OVERLAY };
const text = (kind, payload) => (compose({ kind, payload }, ctx) || {}).text;

head('The voice');
is('a nudge opening says its number, question and close',
  text('nudge-open', { number: 3, question: 'Weigh in on the third colour.', closes: '2026-09-28T00:00:00Z', slot: 3 }).split('\n')[0],
  "NUDGE #3 · WEIGH IN ON THE THIRD COLOUR · CLOSES 28 SEP '26");
is('and links where there is somewhere to go',
  text('nudge-open', { number: 3, question: 'x', closes: '2026-09-28T00:00:00Z' }).includes('/studio'), true);
is('a weighing names the wallet, the figure and the colour',
  text('weigh', { hex: '#80E080', address: '0xaaa', amount: 100000 }),
  `@piercedcat PUT 100,000 TAO ${TAO_GLYPH} BEHIND ≈ LIGHT GREEN`);
is('a move reads as a move, not as an arrival',
  text('weigh', { hex: '#DA70D6', address: '0xccc', amount: 13749, moved: true }).includes('MOVED'), true);
is('a proposal credits whoever said it first',
  text('propose', { number: 3, hex: '#B0E0E6', address: '0xbbb' }),
  'POWDER BLUE PROPOSED BY @0xunix · NUDGE #3');
is('an exact colour is not hedged with a squiggle', colourName('#B0E0E6').exact, true);
is('and an inexact one is', colourName('#80E080').label, '≈ Light Green');

head('The honesty travels');
const artist = { hex: '#80E080', total: 627000, voters: 4, slot: 2, slots: 12,
  locked_by: 'artist', met: { voters: false, tao: true }, rule: { voters: 5, tao: 500000 } };
is('an artist lock says so on the timeline',
  text('nudge-lock', artist).endsWith('LOCKED BY THE ARTIST AT 4 OF 5 VOTERS'), true);
is('a threshold lock claims nothing for him',
  text('nudge-lock', { ...artist, locked_by: 'threshold', met: { voters: true, tao: true }, voters: 6 }).includes('ARTIST'), false);

head('Naming, and being left alone');
is('a handle is used where the overlay knows one', who('0xaaa', OVERLAY).label, '@piercedcat');
is('a name where it does not', who('0xnnn', OVERLAY).label, 'NO HANDLE');
is('an opt-out is silent ... no tag', who('0xqqq', OVERLAY).label, null);
is('and no name either', who('0xqqq', OVERLAY).quiet, true);
is('a quiet collector still has their act tweeted, unattributed',
  text('weigh', { hex: '#80E080', address: '0xqqq', amount: 5000 }).startsWith('A COLLECTOR PUT'), true);
is('a private collector on the register is left alone too',
  who('0xzzz', OVERLAY, { who: () => ({ private: true, name: 'Private collector' }) }).quiet, true);

head('House rules');
const all = [
  text('nudge-open', { number: 3, question: 'Weigh in on the third colour.', closes: '2026-09-28T00:00:00Z' }),
  text('propose', { number: 3, hex: '#B0E0E6', address: '0xbbb' }),
  text('weigh', { hex: '#80E080', address: '0xaaa', amount: 100000 }),
  text('nudge-lock', artist),
  text('sale', { collection: 'Ghost', title: 'Two Burdens', price: '0.3 ETH', address: '0xaaa', url: 'https://mintface.art/w/x' }),
];
is('no hashtags anywhere', all.some((t) => /#[A-Za-z]/.test(t)), false);
is('no exclamation marks', all.some((t) => t.includes('!')), false);
is('no emoji but the TAO glyph',
  all.some((t) => /\p{Extended_Pictographic}/u.test(t.replace(new RegExp(TAO_GLYPH, 'gu'), ''))), false);
is('everything fits in a tweet', all.every((t) => weight(t) <= 280), true);
is('figures are grouped, never bare digits',
  text('weigh', { hex: '#80E080', address: '0xaaa', amount: 1234567 }).includes('1,234,567'), true);

head('The card');
is('the pottle row marks locked, open and empty apart',
  slotsRow({ slots: 4, board: [{ slot: 1, state: 'locked', hex: '#0E5890' }, { slot: 2, state: 'locked', hex: '#80E080' }, { slot: 3, state: 'open' }] }),
  '#0E5890,#80E080,:o,');

head('Two tables, one meaning');
{
  /* The names live here now and the browser bundle keeps a copy, because
     mintface.js is a classic script and cannot import. The copies must not
     drift: a feed calling a swatch one thing and the page calling it another
     is the fault this catches. */
  const bundle = readFileSync(new URL('../../mintface.js', import.meta.url), 'utf8');
  const body = bundle.slice(bundle.indexOf('MF.colour.NAMES = ['), bundle.indexOf('MF.colour._named'));
  const theirs = [...body.matchAll(/\['(#[0-9A-F]{6})', '([^']+)'\]/g)].map((m) => [m[1], m[2]]);
  is('the bundle and the server hold the same number of colours', theirs.length, NAMES.length);
  const differ = theirs.filter(([h, n], i) => !NAMES[i] || NAMES[i][0] !== h || NAMES[i][1] !== n);
  is('and every one of them agrees', differ.length, 0, differ.slice(0, 3));
}

head('Sales are on-chain only');
{
  const tao = readFileSync(new URL('../../api/cron/tao.js', import.meta.url), 'utf8');
  const hook = readFileSync(new URL('../../api/webhook.js', import.meta.url), 'utf8');
  is('the sale event is raised from the chain sweep', /wire\('sale'/.test(tao), true);
  is('and never from the Stripe webhook', /wire\(|enqueue\(/.test(hook), false);
  is('a sale with no price is not tweeted', /if \(paid\) \{/.test(tao), true);
}

console.log(`\n${'='.repeat(74)}`);
console.log(fails.length ? `${fails.length} of ${pass + fails.length} checks failed.` : `All ${pass} checks pass.`);
process.exit(fails.length ? 1 : 0);
