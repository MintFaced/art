#!/usr/bin/env node
/* The collectors' palette: the colour arithmetic, the constraint, and the arc.
 *
 * Two things are pinned hardest here, because both are ways the whole idea
 * quietly fails:
 *
 *   The distance is perceptual. Naive RGB refuses colours that plainly differ
 *   and passes colours that barely do, and this rule turns proposals away.
 *
 *   The floor comes down as the board fills. A fixed floor is a trap: twelve
 *   colours all 0.20 apart barely fit in this space at all, so the last slots
 *   would be asked for something that hardly exists. The check that matters is
 *   that twelve fill even when every collector picks the worst colour the rule
 *   allows.
 *
 *   node scripts/tao/test-palette.mjs
 */
import {
  oklab, oklch, deltaE, nearest, inSpace, field, share, floorFor, LADDER, FIELD_SHARE,
  checkCandidate, seriesState, filledSlots, constraintFor, slotLine, seriesProvenanceLine, SPACE,
} from '../../api/_lib/palette.js';
import fs from 'node:fs';

let pass = 0, fail = 0;
const is = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label.padEnd(60) + JSON.stringify(got) + (ok ? '' : '   want ' + JSON.stringify(want)));
  ok ? pass++ : fail++;
};
const near = (label, got, want, tol = 0.005) => {
  const ok = Math.abs(got - want) <= tol;
  console.log((ok ? '  ok   ' : '  FAIL ') + label.padEnd(60) + got.toFixed(3) + (ok ? '' : `   want ~${want}`));
  ok ? pass++ : fail++;
};

const RED = '#D32011';        // the red line, on every Strip Painting
const C1 = '#C0392B';         // the colour leading nudge #1
const BLUE = '#0E5890';       // the other one
/* Strip Painting No. 1, which is the streetscape space this is sampled from. */
const NO1 = ['#E16448', '#82B2CE', '#5FB25B', '#D5C089', '#4C4040', '#B4BBAE',
  '#6D392E', '#2F1F1D', '#B87556', '#2A6529', '#878082', '#EDBFB7'];

/* ---------------------------------------------------------- the distance */
{
  near('black to white is exactly 1', deltaE('#000000', '#FFFFFF'), 1, 0.0001);
  is('a colour is nought from itself', deltaE(C1, C1) === 0, true);
  is('and it is symmetric', deltaE(C1, BLUE).toFixed(9) === deltaE(BLUE, C1).toFixed(9), true);

  /* The case naive RGB gets wrong, and the reason this is in OKLab at all.
     Full blue and full green are the same distance from black in RGB ... 255
     on one channel ... and nobody has ever thought they look equally far from
     it. The eye is far less sensitive to blue, and OKLab says so. */
  const rgb = (a, b) => {
    const p = (h, i) => parseInt(h.slice(i, i + 2), 16);
    return Math.hypot(p(a, 1) - p(b, 1), p(a, 3) - p(b, 3), p(a, 5) - p(b, 5)) / 441.673;
  };
  is('RGB puts blue and green exactly as far from black as each other',
    rgb('#000000', '#0000FF').toFixed(6) === rgb('#000000', '#00FF00').toFixed(6), true);
  is('the eye does not, and neither does this',
    deltaE('#000000', '#00FF00') > deltaE('#000000', '#0000FF') + 0.3, true);

  near('the leader and the red line are nearly the same colour', deltaE(C1, RED), 0.04);
  near("No. 1's blue and its green", deltaE('#82B2CE', '#5FB25B'), 0.17);
}

/* ------------------------------------------------------------- the space */
{
  is('the leader is a streetscape colour', inSpace(C1, SPACE).ok, true);
  is('and so is the blue', inSpace(BLUE, SPACE).ok, true);
  is('every colour of Strip Painting No. 1 is', NO1.every((h) => inSpace(h, SPACE).ok), true);
  /* The red line is outside the palette. It always has been ... that is what
     "the red line sits outside the palette" says on the maker ... and here it
     is true in the arithmetic as well. */
  is('the red line is not in it', inSpace(RED, SPACE).ok, false);
  is('neon green is refused for saturation', inSpace('#00FF00', SPACE).why, 'more saturated than a streetscape colour');
  is('black is refused for being darker than these walls', inSpace('#000000', SPACE).why, 'darker than anything on these walls');
  is('white is refused for being lighter', inSpace('#FFFFFF', SPACE).why, 'lighter than anything on these walls');
}

/* ------------------------------------------------------------- the floor */
{
  is('nothing locked means the top of the ladder', floorFor([]).floor, LADDER[0]);
  const one = floorFor([RED, C1]);
  is('one locked colour and the red gets the top rung too', one.floor, 0.30);
  is('and it leaves well over the quarter the rule asks for', one.share >= FIELD_SHARE, true);

  /* The rule is exactly this: the highest rung that still leaves a quarter of
     the field. Checked against the arithmetic rather than against a table. */
  const against = [RED, C1, '#82B2CE', '#5FB25B'];
  const f = floorFor(against);
  is('the floor is a rung of the ladder', LADDER.includes(f.floor), true);
  is('it leaves at least a quarter of the field', f.share >= FIELD_SHARE, true);
  const higher = LADDER[LADDER.indexOf(f.floor) - 1];
  is('and the rung above it would not', share(against, higher) < FIELD_SHARE, true);

  is('the floor comes down as the board fills',
    floorFor([RED, C1, '#82B2CE', '#5FB25B', '#D5C089', '#2F1F1D']).floor <= one.floor, true);
  is('and never below the last rung',
    floorFor([...NO1, RED]).floor >= LADDER[LADDER.length - 1], true);
}

/* ------------------------------------------------------- twelve must fit
 *
 * The check the whole arc rests on, run twice: once with the collectors doing
 * exactly what the nudge asks ... choosing the colour furthest from everything
 * locked ... and once with them crowding the board as hard as the rule allows.
 * Twelve slots fill both ways.
 *
 * And the same simulation against a FIXED floor, which is what makes the case
 * for the ladder: hold every slot to 0.30 and the sixth one is impossible. Not
 * because anybody did anything wrong, but because twelve colours that far
 * apart do not fit in a streetscape. A rule that asks for a colour which does
 * not exist is a rule that hands the decision back to the artist.
 */
const grid = field(SPACE);
const bestIn = (against, floor) => {
  const ps = against.map(oklab);
  let best = null, bd = -1;
  for (const p of grid) {
    let min = Infinity;
    for (const q of ps) { const d = deltaE(p.lab, q); if (d < min) min = d; }
    if (min > bd) { bd = min; best = p.hex; }
  }
  return { hex: best, distance: bd, ok: bd >= floor };
};
const worstIn = (against, floor) => {
  const ps = against.map(oklab);
  let worst = null, wd = Infinity;
  for (const p of grid) {
    let min = Infinity;
    for (const q of ps) { const d = deltaE(p.lab, q); if (d < min) min = d; }
    if (min >= floor && min < wd) { wd = min; worst = p.hex; }
  }
  return worst ? { hex: worst, distance: wd, ok: true } : { hex: null, ok: false };
};

const fill = (pick, fixedFloor = null) => {
  const locked = [C1];
  const floors = [];
  for (let slot = 2; slot <= 12; slot += 1) {
    const against = [...locked, RED];
    const floor = fixedFloor == null ? floorFor(against).floor : fixedFloor;
    floors.push(floor);
    const got = pick(against, floor);
    if (!got.ok) return { filled: slot - 1, floors, stuck: slot };
    locked.push(got.hex);
  }
  return { filled: 12, floors, stuck: null };
};

{
  const well = fill(bestIn);
  is('twelve fill when the collectors choose the furthest colour each time', well.filled, 12);
  is('and the floor never went up on the way',
    well.floors.every((f, i) => i === 0 || f <= well.floors[i - 1]), true);
  is('the colour straight after the first lock is asked for the most', well.floors[0], 0.30);
  is('and the twelfth is still asked for something', well.floors[well.floors.length - 1] >= 0.10, true);

  const crowded = fill(worstIn);
  is('and twelve fill when every choice crowds the board instead', crowded.filled, 12);

  const rigid = fill(bestIn, 0.30);
  is('a fixed 0.30 floor runs out before twelve', rigid.filled < 12, true);
  is('and it is the sixth colour that cannot exist', rigid.stuck, 6);
}

/* --------------------------------------------------------- the candidate */
{
  const bound = { against: [RED, C1], floor: 0.30, space: SPACE };
  is('a colour too close to the red is refused',
    Boolean(checkCandidate('#E16448', bound).error), true);
  is('and the refusal names the colour it clashes with, not the rule',
    checkCandidate('#E16448', bound).nearest, '#D32011');
  is("No. 1's blue stands clear", checkCandidate('#82B2CE', bound).error, undefined);
  is('a colour outside the space is refused before any distance is measured',
    checkCandidate('#00FF00', bound).nearest, undefined);
  is('and short hex still parses', checkCandidate('#8BC', bound).hex, '#88BBCC');
  is('a colour exactly on the floor is allowed, not refused',
    Boolean(checkCandidate('#82B2CE', { ...bound, floor: deltaE('#82B2CE', C1) }).error), false);
  is('and a hair under it is not',
    Boolean(checkCandidate('#82B2CE', { ...bound, floor: deltaE('#82B2CE', C1) + 0.001 }).error), true);
  is('with nothing locked, only the space applies',
    checkCandidate('#E16448', { against: [], floor: 0.30, space: SPACE }).hex, '#E16448');
}

/* ------------------------------------------------------------- the arc */
const store = JSON.parse(fs.readFileSync(new URL('../../data/nudges.json', import.meta.url), 'utf8'));
{
  const s = seriesState(store, { now: new Date('2026-09-07T00:00:00Z') });
  is('the series is twelve slots', s.slots, 12);
  is('and the board draws all twelve', s.board.length, 12);
  is('nudge one holds slot one while it runs', s.board[0].state, 'open');
  is('nothing is locked yet', s.locked.length, 0);
  is('so the palette is not complete', s.complete, false);
  is('the red line is beside it and is not a slot', s.fixed.hex, '#D32011');
  is('and it is what a new colour stands clear of', s.against, ['#D32011']);

  /* Slot one opened the palette with nothing to be different from. A rule
     invented so that every nudge has one would be a rule. */
  is('slot one carries no constraint', constraintFor(store, store.nudges[0]), null);
  const c2 = constraintFor(store, store.nudges[1]);
  is('slot two stands clear of the red even before anything locks',
    c2.against.map((a) => a.hex), ['#D32011']);
  is('and the red is marked as fixed rather than locked', c2.against[0].fixed, true);
}

{
  /* Nudge one banks a colour. Everything downstream is a reading of that ...
     the slot, the constraint on slot two, the maker's palette, the line a
     painting carries. */
  const after = JSON.parse(JSON.stringify(store));
  after.nudges[0].banked = { number: 1, locked: { hex: C1 }, total: 512340, collectors: 7,
    banked_at: '2026-09-13T00:10:00.000Z' };
  const s = seriesState(after, { now: new Date('2026-09-14T00:00:00Z') });
  is('slot one is filled by the colour it locked', s.board[0].hex, C1);
  is('and says which nudge locked it', s.board[0].number, 1);
  is('one of twelve', [s.locked.length, s.slots], [1, 12]);
  is('slot two is still empty until its nudge is published', s.board[1].state, 'empty');

  const c = constraintFor(after, after.nudges[1], s);
  is('slot two now stands clear of the locked colour and the red',
    c.against.map((a) => a.hex), [C1, '#D32011']);
  is('and it is labelled by the nudge that locked it', c.against[0].label, 'Nudge #1');
  is('the floor is the top rung with one colour down', c.floor, 0.30);

  is('a banked card says where it sits in the arc', slotLine(after.nudges[0], 12), 'Colour 1 of 12');
  is('the compound line counts the arc, not one nudge of it',
    seriesProvenanceLine(s), 'Palette by 1 nudge · 7 collectors · 512,340 TAO');
}

{
  /* A nudge that banks without locking leaves its slot empty ... and the slot
     can be asked again, which is the difference between a palette that failed
     once and a palette that is short forever. */
  const missed = JSON.parse(JSON.stringify(store));
  missed.nudges[0].banked = { number: 1, locked: null, total: 200001, collectors: 3,
    banked_at: '2026-09-13T00:10:00.000Z' };
  const s = seriesState(missed, { now: new Date('2026-09-14T00:00:00Z') });
  is('a nudge that locked nothing leaves its slot empty', s.board[0].state, 'empty');
  is('and the palette is not short by definition', s.slots, 12);
  missed.nudges.push({ id: 'nudge-3', number: 3, kind: 'candidates', series: 'strip-palette', slot: 1,
    question: 'Choose the first colour, again.', closes: '2026-10-11T00:00:00.000Z', published: true,
    banked: { number: 3, locked: { hex: BLUE }, total: 600000, collectors: 6, banked_at: '2026-10-11T00:10:00.000Z' } });
  const s2 = seriesState(missed, { now: new Date('2026-10-12T00:00:00Z') });
  is('asking the slot again fills it', s2.board[0].hex, BLUE);
  is('and it is credited to the nudge that settled it', s2.board[0].number, 3);
  is('one slot, one colour, however many times it was asked',
    filledSlots(missed).filter((f) => f.slot === 1).length, 1);
}

{
  /* A palette filled from nothing, slot one included: every colour clears the
     floor that was in force when it was asked, and every one of them is a
     streetscape colour. Which is the whole claim the arc makes. */
  const locked = [];
  let held = true;
  for (let slot = 1; slot <= 12; slot += 1) {
    const against = slot === 1 ? [] : [...locked, RED];
    const { floor } = floorFor(against);
    const got = slot === 1 ? { hex: C1, ok: true } : bestIn(against, floor);
    if (!got.ok) held = false;
    locked.push(got.hex);
  }
  is('a palette filled from nothing is twelve colours', locked.length, 12);
  is('and every one of them cleared the floor it was asked for', held, true);
  is('all twelve are streetscape colours', locked.every((h) => inSpace(h, SPACE).ok), true);
  /* Twelve distinct colours, which is the thing a drifting palette would not
     have produced ... and the reason for the constraint in the first place. */
  is('and no two of them are the same colour', new Set(locked).size, 12);
}

/* --------------------------------------------------- the pages, and the copy
 *
 * The picker runs the same arithmetic in the browser so it can say no before
 * anybody signs. Two copies of a rule is two chances to drift, and a picker
 * that says yes to a colour the route refuses is worse than no picker at all
 * ... so the matrices are checked character for character, and the page checks
 * below pin the things the arc is actually made of.
 */
{
  const read = (f) => fs.readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
  const server = read('api/_lib/palette.js');
  const browser = read('mintface.js');
  for (const row of [
    '0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b',
    '0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b',
    '0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b',
    '0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s',
    '1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s',
    '0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s',
  ]) {
    is(`both copies carry ${row.slice(0, 14)}...`, server.includes(row) && browser.includes(row), true);
  }
  is('and both refuse a colour for the same reason, in the same words',
    server.includes('more saturated than a streetscape colour')
    && browser.includes('more saturated than a streetscape colour'), true);
  is('the picker is a courtesy and the route is the check',
    read('api/nudge.js').includes('checkCandidate(body.hex'), true);

  const studio = read('studio.html');
  is('the studio draws the twelve slots and the red beside them',
    /function drawPalette/.test(studio) && /slot fixed/.test(studio), true);
  is('an empty slot is drawn rather than left out', /slot empty/.test(studio), true);
  is('a candidate is shown against what it must clear',
    /function pair\(x, hex\)/.test(studio) && /class="pair"/.test(studio), true);
  is('and the card says what it is standing clear of',
    /Standing clear of/.test(studio), true);
  is('a banked card places itself in the arc', /x\.slot_line/.test(studio), true);
  is('the picker answers while it is dragged, not when it closes',
    /data-colourfield/.test(studio) && /addEventListener\('input'/.test(studio), true);
  is('and it will not send a colour it has already refused',
    /go\.disabled = !v\.ok/.test(studio), true);

  const col = read('c.html');
  is('the collection page draws the strip too', /function paletteMarkup/.test(col), true);
  is('and shows whichever nudge in the series is open',
    /mine\.find\(\(n\) => n\.open\)/.test(col), true);

  const maker = read('strip-painting-maker.html');
  is('the maker reads the series rather than a single colour',
    /function readSeries/.test(maker) && !/readCommunityColour/.test(maker), true);
  is('a locked colour already in the palette is marked, not added twice',
    /if \(at >= 0\) S\.palette\[at\]/.test(maker), true);
  is('and the spec names whose colours they were',
    /collectors' colours/.test(maker), true);

  is('a work carries the whole palette, with every slot reachable',
    /palette-slots/.test(read('w.html')), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
