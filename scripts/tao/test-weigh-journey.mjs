#!/usr/bin/env node
/* KEYRUN'S JOURNEY, WALKED BY A WALLET THAT HOLDS 13,749 TAO.
 *
 * Every TAO rule on this site is a comparison against what a wallet holds, and
 * the wallet these paths get exercised with is the artist's ... which holds
 * enough that no cap ever binds, has proposed nothing, and stands nowhere. So
 * the branches that only run for a collector with a modest balance shipped
 * three times without ever having been run: the sum that refused a legal move,
 * a spare-TAO check that answered nought for a wallet it had not been told
 * about, and a card that offered to weigh while knowing nothing about who was
 * weighing.
 *
 * THE STANDING RULE: a TAO-gated path is not tested until it has been walked
 * by a limited-TAO wallet that is not the artist. This is that walk, in code,
 * against the real route arithmetic and the real card render.
 *
 *   node scripts/tao/test-weigh-journey.mjs
 */
import { readFileSync } from 'node:fs';
import { palette, standing, allocations, checkChange, lockRule } from '../../api/_lib/nudges.js';

let pass = 0, fail = 0;
const is = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label.padEnd(58) + JSON.stringify(got) + (ok ? '' : '   want ' + JSON.stringify(want)));
  ok ? pass++ : fail++;
};

/* ---- the board, as the studio actually has it ---- */
const KEYRUN = '0xd614f79b1b01d42bed92eb05b58f973be9a3dd3d';   // holds 13,749
const UNIX = '0xcc3b37eeb73143e6d2a547058118fe25561a4eb2';
const CAT = '0xdafa9e3dae493f0b9d6872eff4fda0f40d1b7488';
/* One edition and nothing else, which is the smallest a collector gets. */
const NEWCOMER = '0x1111111111111111111111111111111111111111';
const GRN = '#80E080', TEAL = '#BCE1DD', YEL = '#E0E050';
const TAO = { [KEYRUN]: 13749, [UNIX]: 1500000, [CAT]: 90000, [NEWCOMER]: 500 };
const held = (a) => TAO[String(a).toLowerCase()] || 0;

const proposals = [
  { nudge: 'n', hex: GRN, address: CAT, name: 'piercedcat.eth', at: '1' },
  { nudge: 'n', hex: TEAL, address: UNIX, name: '0xunix.eth', at: '2' },
  { nudge: 'n', hex: YEL, address: KEYRUN, name: 'keyrun.eth', at: '3' },
];
const weighings = [
  { nudge: 'n', address: UNIX, candidate: GRN, amount: 100000, alloc: true, at: '4', name: '0xunix.eth' },
  { nudge: 'n', address: UNIX, candidate: TEAL, amount: 100000, alloc: true, at: '5', name: '0xunix.eth' },
];

/* What /api/nudge answers for one reader, in the shape the card is written
   against ... including `viewer`, which is the page's only way of knowing
   whether the board in front of somebody is a board about them. */
const payloadFor = (who, rows) => {
  const p = palette(rows, proposals, held, null);
  const dress = (r) => ({ address: r.address, name: r.name || null, delta: r.delta == null ? null : r.delta,
    moved: Boolean(r.moved), private: false, url: `/c/${r.address}`, side: null,
    candidate: r.candidate || null, weight: r.weight, at: r.at, clamped: Boolean(r.clamped) });
  return {
    viewer: who ? who.toLowerCase() : null,
    tao: who ? held(who) : null,
    nudges: [{
      id: 'n', number: 2, kind: 'candidates', question: 'Choose the second colour.',
      open: true, closes: '2026-09-21', constraint: null, slot_line: 'Colour 2 of 12',
      rule: lockRule(null), total: p.total, collectors: p.collectors, leader: p.leader,
      locked: null, why: p.why, progress: p.progress,
      ledger: (p.ledger || []).map(dress),
      candidates: (p.candidates || []).map((c) => ({ hex: c.hex, total: c.total, voters: c.voters,
        share: c.share, proposed_by: c.proposed_by, proposed_name: c.proposed_name,
        proposed_url: `/c/${c.proposed_by}`, wallets: (c.wallets || []).map(dress) })),
      mine: who ? standing(rows, who, held) : null,
      proposed: who ? proposals.some((x) => x.address.toLowerCase() === who.toLowerCase()) : false,
    }],
  };
};

/* ---- the card, run as the browser runs it ---- */
const page = readFileSync(new URL('../../studio.html', import.meta.url), 'utf8');
const slice = page.slice(page.indexOf('function pair(x, hex)'), page.indexOf('/* Open at the bottom.'));

function studio(state, session) {
  const said = [];
  const sent = [];
  const stubs = `
    const e = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    const num = (x) => Number(x || 0).toLocaleString('en-NZ');
    const short = (a) => String(a).slice(0, 6);
    const shortDate = (d) => String(d).slice(0, 10);
    const dateOf = (d) => String(d).slice(0, 10);
    const ROOM = { days: 30 };
    const NUDGE = { state: STATE, tao: STATE.tao || 0, who: STATE.viewer, tried: null,
      loading: false, picked: {}, putting: new Set(), moving: new Set() };
    const MF = {
      palette: { slivers: () => '', against: () => [] },
      colour: { name: () => ({ label: '\\u2248 PANTONE 359 C', short: '359 C' }),
        check: () => ({ ok: true, hex: '#207070', distance: 0.4 }) },
      session: { current: () => SESSION, open: async () => ({}) },
    };
    const viewer = () => (SESSION && NUDGE.who && NUDGE.who === SESSION.address ? SESSION : null);
    const loadNudges = async () => {};
    const localStorage = { getItem: () => null, setItem() {} };
    /* nudgeSay() is the page's own, out of the slice: it writes into the one
       line under the board, and this is that line, remembering what it was
       told. One sink, which is the point of the check. */
    const document = {
      addEventListener() {}, querySelectorAll: () => [],
      getElementById: (id) => {
        if (!String(id).startsWith('say-')) return null;
        const el = { textContent: '', className: '',
          set hidden(v) { SAID.push({ text: el.textContent, bad: /bad/.test(el.className) }); } };
        return el;
      },
    };
    const fetch = async (url, opts) => { SENT.push(JSON.parse(opts.body)); return { ok: true, json: async () => ({ ok: true }) }; };
  `;
  const fn = new Function('STATE', 'SESSION', 'SAID', 'SENT',
    stubs + slice + '\nreturn { candidateCard, colourRow, colourRows, position, proposer, changeCalc, changeLine, weigh, mayWeigh };');
  return { ...fn(state, session, said, sent), said, sent };
}

/* A row's field and its button, as the DOM hands them to weigh(). */
const panelFor = (value, opts = {}) => {
  const field = { value };
  const panel = {
    dataset: opts.src ? { src: opts.src } : {},
    querySelector: (q) => (q === '.amt' ? field
      : q === 'select.to' ? (opts.to ? { value: opts.to } : null)
        : q === 'select.src' ? (opts.pick != null ? { value: opts.pick } : null)
          : q === '.res' ? { textContent: '', classList: { toggle() {}, remove() {} } } : null),
  };
  const btn = { dataset: { weigh: 'n', hex: opts.hex || GRN, ...(opts.src ? { src: opts.src } : {}) },
    closest: (sel) => (/\.chg|\.put/.test(sel) ? panel : null) };
  return { field, panel, btn };
};

console.log('\n— the board does not know who is looking —');
{
  /* The regression: a session in the browser, a board fetched before it. The
     card must offer nothing rather than offer everything and refuse it. */
  const S = studio(payloadFor(null, weighings), { address: KEYRUN });
  const card = S.candidateCard(payloadFor(null, weighings).nudges[0]);
  is('nothing is editable', S.mayWeigh(), false);
  is('no weigh buttons are drawn', /data-put=/.test(card), false);
  is('no colour picker is drawn either', /type="color"/.test(card), false);
  is('and it says what it is doing, not "sign in"',
    /Reading where you stand/.test(card), true);
}

console.log('\n— a board about the collector who is looking —');
const mine = () => studio(payloadFor(KEYRUN, weighings), { address: KEYRUN });
{
  const S = mine();
  const x = payloadFor(KEYRUN, weighings).nudges[0];
  is('the wallet holds 13,749 and has all of it spare', [x.mine.held, x.mine.available], [13749, 13749]);
  is('the card is editable', S.mayWeigh(), true);
  const row = S.colourRow(x, x.candidates.find((c) => c.hex === GRN), true);
  is('the button reads WEIGH, not move and not propose', />Weigh</.test(row), true);
  is('WEIGH opens an amount field', /class="amt"/.test(row), true);
  is('with a label saying what it wants', /TAO to weigh/.test(row), true);
  is('and their spare TAO beside it', /13,749 spare/.test(row), true);
  is('there is no colour picker anywhere in the weigh form', /type="color"/.test(row), false);
  /* And for a collector who has not proposed, the two forms are two forms:
     the weigh field on the row, the picker under its own heading further
     down. Nobody clicking WEIGH can land on a colour input. */
  const N = studio(payloadFor(NEWCOMER, weighings), { address: NEWCOMER });
  const nx = payloadFor(NEWCOMER, weighings).nudges[0];
  const nrow = N.colourRow(nx, nx.candidates[0], true);
  is('a collector who has not proposed still gets an amount field to weigh in',
    /class="amt"/.test(nrow) && !/type="color"/.test(nrow), true);
  is('and the picker is somewhere else, under its own heading',
    /Propose a new colour/.test(N.proposer(nx)) && /type="color"/.test(N.proposer(nx)), true);
  is('the banner says they stand nowhere yet, with their TAO',
    /Nothing on the board yet/.test(S.position(x)) && /13,749 TAO to weigh/.test(S.position(x)), true);
  is('and never mentions moving anything', /Move/.test(S.position(x)), false);
}

console.log('\n— weighing all 13,749 on a colour —');
let after = weighings;
{
  const S = mine();
  const x = payloadFor(KEYRUN, weighings).nudges[0];
  is('the whole balance is a legal weighing',
    Boolean(S.changeCalc(x, { candidate: GRN, amount: 13749, source: '' }).ok), true);
  is('and a collector standing nowhere is never told to move something off',
    /Move some off/.test(JSON.stringify(S.changeCalc(x, { candidate: GRN, amount: 13749, source: '' }))), false);
  const over = S.changeCalc(x, { candidate: GRN, amount: 20000, source: '' });
  is('asking for more than they hold is refused by what they hold',
    /You hold 13,749 TAO/.test(over.error), true);
  is('and that refusal does not mention colours they are not on',
    /Move some off/.test(over.error), false);
  is('the panel line carries no refusal of its own',
    S.changeLine(x, { candidate: GRN, amount: 20000, source: '' }).text, '');

  /* Through the click path: the button, the field beside it, the request. */
  const { btn } = panelFor('13749', { hex: GRN });
  await S.weigh('n', GRN, btn);
  is('the request weighs the typed amount on the row it was typed on',
    S.sent.map((b) => [b.candidate, b.amount, b.from || null]), [[GRN, 13749, null]]);
  is('nothing was refused on the way', S.said.filter((m) => m.bad).map((m) => m.text), []);

  /* The route agrees, and the board takes it. */
  const map = allocations(weighings.filter((r) => r.address === KEYRUN)).by.get(KEYRUN) || new Map();
  is('and the route is of the same mind',
    Boolean(checkChange(map, held(KEYRUN), { candidate: GRN, amount: 13749 }).ok), true);
  after = [...weighings, { nudge: 'n', address: KEYRUN, candidate: GRN, amount: 13749, alloc: true, at: '6', name: 'keyrun.eth' }];
}
console.log('\n— the ledger shows it, and it can be changed —');
{
  const x = payloadFor(KEYRUN, after).nudges[0];
  const S = studio(payloadFor(KEYRUN, after), { address: KEYRUN });
  is('the board carries their TAO', x.candidates.find((c) => c.hex === GRN).total, 113749);
  is('they are one of its collectors', x.candidates.find((c) => c.hex === GRN).voters, 2);
  is('their standing is one row at the amount they weighed',
    x.mine.allocations, [{ hex: GRN, amount: 13749, weight: 13749 }]);
  is('with nothing left spare', x.mine.available, 0);
  const banner = S.position(x);
  is('the banner shows the position plainly', /13,749 TAO on #80E080/.test(banner), true);
  is('with CHANGE beside it', /data-change="n\|#80E080"/.test(banner), true);
}

console.log('\n— moving all of it to another colour —');
let moved = after;
{
  const x = payloadFor(KEYRUN, after).nudges[0];
  const S = studio(payloadFor(KEYRUN, after), { address: KEYRUN });
  const c = S.changeCalc(x, { candidate: TEAL, amount: 13749, source: GRN });
  is('the move is legal, and it is one act', [Boolean(c.ok), c.from, c.fromAmount], [true, GRN, 0]);
  const { btn } = panelFor('13749', { hex: GRN, src: GRN, to: TEAL });
  await S.weigh('n', GRN, btn);
  is('the request names both colours',
    S.sent.map((b) => [b.candidate, b.amount, b.from, b.from_amount]), [[TEAL, 13749, GRN, 0]]);
  is('and nothing was refused', S.said.filter((m) => m.bad).map((m) => m.text), []);
  const map = allocations(after.filter((r) => r.address === KEYRUN)).by.get(KEYRUN);
  const v = checkChange(map, held(KEYRUN), { candidate: TEAL, amount: 13749, from: GRN, fromAmount: 0 });
  is('the route lands them in a position that fits', [Boolean(v.ok), v.total], [true, 13749]);
  moved = [...after, { nudge: 'n', address: KEYRUN, candidate: TEAL, amount: 13749, from: GRN, from_amount: 0, alloc: true, at: '7', name: 'keyrun.eth' }];
}

console.log('\n— and adjusting it down —');
{
  const x = payloadFor(KEYRUN, moved).nudges[0];
  const S = studio(payloadFor(KEYRUN, moved), { address: KEYRUN });
  is('they stand on the colour they moved to, and only that one',
    x.mine.allocations, [{ hex: TEAL, amount: 13749, weight: 13749 }]);
  const c = S.changeCalc(x, { candidate: TEAL, amount: 10000, source: TEAL });
  is('bringing the number down is a change like any other',
    [Boolean(c.ok), c.from], [true, null]);
  const { btn } = panelFor('10000', { hex: TEAL, src: TEAL, to: TEAL });
  await S.weigh('n', TEAL, btn);
  is('and it goes as one absolute amount, with nothing moved',
    S.sent.map((b) => [b.candidate, b.amount, b.from || null]), [[TEAL, 10000, null]]);
  const down = [...moved, { nudge: 'n', address: KEYRUN, candidate: TEAL, amount: 10000, alloc: true, at: '8', name: 'keyrun.eth' }];
  const end = payloadFor(KEYRUN, down).nudges[0];
  is('the ledger ends with one row for them, at the final state',
    end.mine.allocations, [{ hex: TEAL, amount: 10000, weight: 10000 }]);
  is('the colour they left carries nothing of theirs',
    end.candidates.find((cc) => cc.hex === GRN).wallets.filter((w) => w.address === KEYRUN).length, 0);
  is('and the rest of their TAO is theirs to weigh again', end.mine.available, 3749);
  const S2 = studio(payloadFor(KEYRUN, down), { address: KEYRUN });
  const card = S2.candidateCard(end);
  is('at no point does the card say they hold more than they do',
    /more TAO than this wallet holds/.test(card), false);
  is('nor tell them to move something off a colour they are not on',
    /Move some off/.test(card), false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
