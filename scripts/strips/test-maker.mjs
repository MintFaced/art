#!/usr/bin/env node
/* The Maker in a real browser, against the real routes. The strip is the control
 * surface, so most of this is a hand on it: pressing, dragging, letting go.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { serve } from './serve.mjs';
import { stillSVG } from '../../strips-design.js';

const require = createRequire(new URL('../../contracts/package.json', import.meta.url));
const { chromium } = require('playwright');
const SHOTS = process.env.STRIPS_SHOTS || '';
const RED = '#d32011';

let fails = 0, passes = 0;
const is = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? passes += 1 : fails += 1; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` :: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`}`); };

const PRESETS = JSON.parse(readFileSync(new URL('../../data/maker-presets.json', import.meta.url), 'utf8')).presets;
const site = await serve(0, { stub: { '/api/nudge': { series: { locked: ['#112233', '#445566', '#778899', '#AABBCC'].map((hex) => ({ hex })) } }, '/api/fx': {} } });
const browser = await chromium.launch();
const errors = [];

/* The on-screen still is the chain's, told to fill the column. Nothing else about it differs. */
const STRETCH = ' preserveAspectRatio="none"';
const stillOf = (p) => p.evaluate(() => atob(document.getElementById('stripImg').src.split(',')[1]));
const ready = async (p) => {
  await p.waitForFunction(() => document.getElementById('stripImg').src.startsWith('data:image/svg'));
  await p.waitForFunction(() => document.querySelectorAll('.no').length > 0);
};
/* Bands bottom first, read from the still: colour and size. */
const bandsIn = (svg) => [...svg.matchAll(/<rect (?:y="(-?\d+)" )?(?:x="(\d+)" width="(\d+)" )?(?:width="\d+" )?height="(\d+)" fill="(#[0-9a-f]{6})"\/>/g)].map((m) => ({ fill: m[5], size: Number(m[3] ?? m[4]) }));
/* A band's middle on the page, by its place in the stack. */
const spot = async (p, n) => {
  const svg = await stillOf(p);
  const list = bandsIn(svg);
  const total = list.reduce((s, b) => s + b.size, 0);
  const before = list.slice(0, n).reduce((s, b) => s + b.size, 0);
  const box = await p.locator('#strips').boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height * (1 - (before + list[n].size / 2) / total) };
};

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  const posts = [];
  page.on('request', (r) => { if (r.method() === 'POST') posts.push({ url: r.url(), body: r.postData() }); });
  await page.goto(`${site.url}/strip-painting-maker`);
  await ready(page);

  const still = () => stillOf(page);
  const bands = async () => bandsIn(await still());
  const settled = async () => { await page.waitForTimeout(450); };
  const lastPost = () => JSON.parse(posts.filter((p) => p.url.includes('/api/strips/preview')).at(-1).body);
  const shareOf = (list, fill) => list.filter((b) => b.fill === fill).reduce((s, b) => s + b.size, 0) / list.reduce((s, b) => s + b.size, 0);
  const hexes = (p) => p.locator('.pal-row input[type=text]').evaluateAll((els) => els.map((x) => x.value));
  const knobOn = () => page.isVisible('#knob');

  console.log('\n— one screen —');
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(100);
    const m = await page.evaluate(() => {
      const on = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth; };
      const all = [document.getElementById('strips'), document.getElementById('mint'), document.getElementById('png'), document.getElementById('testSignal'), document.querySelector('#custom summary'), ...document.querySelectorAll('.no'), ...document.querySelectorAll('.op'), ...document.querySelectorAll('.sw')];
      const body = document.querySelector('.rail-body');
      return { scrolls: document.documentElement.scrollHeight > innerHeight || document.documentElement.scrollWidth > innerWidth, rail: body.scrollHeight > body.clientHeight, off: all.filter((x) => !on(x)).length, seen: all.length, strip: document.getElementById('strips').getBoundingClientRect().height / innerHeight > .8 };
    });
    is(`${w}x${h}: nothing scrolls, the strip and every control on screen`, [m.scrolls, m.rail, m.off, m.seen, m.strip], [false, false, 0, 29, true]);
  }
  is('the strip fills its column, and the file underneath is the chain\'s', (await still()).includes(STRETCH), true);
  is('the rail holds the true shape, untouched', await page.evaluate(() => atob(document.getElementById('trueShape').src.split(',')[1]).includes('preserveAspectRatio')), false);

  console.log('\n— opening —');
  is('twelve colours to start, and twelve swatches and the red', [await page.locator('.pal-row').count(), await page.locator('#sws .sw').count()], [12, 13]);
  /* a design mints once, so nobody may open on the same one */
  const openings = [await hexes(page)];
  for (let i = 0; i < 5; i += 1) {
    const visit = await context.newPage();
    visit.on('pageerror', (e) => errors.push(e.message));
    await visit.goto(`${site.url}/strip-painting-maker`);
    await ready(visit);
    openings.push(await hexes(visit));
    await visit.close();
  }
  is('every visit opens on a fresh palette, and the server lays each one', new Set(openings.map(String)).size, 6);
  is('twelve different colours each time, none the red line\'s', openings.every((c) => new Set(c).size === 12 && !c.includes('#D32011')), true);
  is('the preview is a real still', (await still()).startsWith('<svg '), true);
  is('Custom starts closed, and the signal off', [await page.isVisible('#length'), await page.isVisible('#vib'), await page.isVisible('#signal')], [false, false, false]);

  console.log('\n— a band —');
  await settled();
  const palette = (await hexes(page)).map((h) => h.toLowerCase());
  const start = await still();
  const was = bandsIn(start);
  const mid = was.findIndex((b, n) => n > 20 && b.fill === palette[3]); // an even colour, away from the edges
  const target = palette[3];
  let at = await spot(page, mid);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  is('pressing a band selects it', [await knobOn(), await page.getAttribute('#sws .sw[data-i="3"]', 'aria-pressed')], [true, 'true']);
  is('the tag says which and how much', (await page.textContent('#tag')).endsWith('... even'), true);
  is('every band of that colour is lit', await page.locator('.mark').count(), was.filter((b) => b.fill === target).length);
  await settled();
  const asked = posts.length;
  for (let i = 1; i <= 12; i += 1) await page.mouse.move(at.x + i * 20, at.y);
  await page.waitForFunction((s) => atob(document.getElementById('stripImg').src.split(',')[1]) !== s, start);
  const wide = await bands();
  is('dragging right widens it live, with the button still down', shareOf(wide, target) > shareOf(was, target), true);
  is('from answers already in hand: the drag waits on nothing', posts.length, asked);
  is('its neighbours give the room back, and the total holds', [wide.reduce((s, b) => s + b.size, 0) === was.reduce((s, b) => s + b.size, 0), wide.some((b, n) => b.fill !== target && b.size !== was[n].size)], [true, true]);
  is('the order holds', wide.map((b) => b.fill), was.map((b) => b.fill));
  const fills = wide.map((b) => b.fill);
  is('and so does the mirror', fills.slice(0, 12).every((f, i) => f === RED || fills[23 - i] === RED || fills[23 - i] === f), true);
  await page.mouse.up();
  await settled();
  is('and it stays when let go', [(await page.textContent('#tag')).endsWith('... more'), await knobOn()], [true, true]);
  is('the server hears a choice, not a band', [lastPost().colours.find((c) => c.hex.toLowerCase() === target).amount, 'bands' in lastPost(), 'strips' in lastPost()], ['more', false, false]);

  at = await spot(page, mid);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i += 1) await page.mouse.move(at.x - i * 14, at.y);
  await page.mouse.up();
  await settled();
  is('dragging back to the middle lands on even, and the same still as before', [(await page.textContent('#tag')).endsWith('... even'), await still()], [true, start]);

  at = await spot(page, mid);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i += 1) await page.mouse.move(at.x - i * 20, at.y);
  await settled();
  is('dragging left thins it', [(await page.textContent('#tag')).endsWith('... less'), shareOf(await bands(), target) < shareOf(was, target)], [true, true]);
  await page.keyboard.press('Escape');
  await settled();
  await page.mouse.up();
  is('Esc mid-drag puts it back and lets go', [await knobOn(), await still()], [false, start]);

  at = await spot(page, mid);
  await page.mouse.click(at.x, at.y);
  is('a click alone changes nothing', [await knobOn(), await still()], [true, start]);
  await page.keyboard.press('ArrowRight');
  await settled();
  is('arrows do what a drag does', (await page.textContent('#tag')).endsWith('... more'), true);
  await page.keyboard.press('ArrowLeft');
  await settled();
  await page.click('h1');
  is('clicking away lets go', [await knobOn(), await page.locator('.mark.on').count()], [false, 0]);
  await page.locator('#sws .sw').nth(3).click();
  is('a swatch lights its bands on the strip', [await knobOn(), await page.locator('.mark').count()], [true, was.filter((b) => b.fill === target).length]);
  await page.keyboard.press('Escape');
  is('Esc lets go', await knobOn(), false);
  is('the less, even and more buttons are gone', await page.locator('[data-amount]').count(), 0);

  console.log('\n— the red line —');
  const redBand = () => bands().then((list) => list.findIndex((b) => b.fill === RED));
  const mmOf = (list, n) => (list[n].size / list.reduce((s, b) => s + b.size, 0)) * 600;
  is('it starts sixteenth from the base', await redBand(), 15);
  const colours = (await bands()).map((b) => b.fill).filter((f) => f !== RED);
  at = await spot(page, 15);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  is('pressing it says whose it is, and shows no slider', [await page.textContent('#tag'), await knobOn(), await page.getAttribute('#swRed', 'aria-pressed')], ['the red line... yours to place', false, 'true']);
  const steps = [];
  for (let i = 1; i <= 30; i += 1) {
    await page.mouse.move(at.x, at.y - i * 3);
    steps.push(Number(await page.getAttribute('#strips', 'aria-valuenow')));
  }
  await page.mouse.up();
  await settled();
  const line = await redBand();
  is('dragging moves it strip by strip', [line > 15, steps.every((v, i) => !i || Math.abs(v - steps[i - 1]) <= 1), lastPost().red_line], [true, true, line + 1]);
  const moved = await bands();
  is('its width doesn\'t change', mmOf(moved, line), 12);
  is('nor its colour, and there is still one', moved.filter((b) => b.fill === RED).length, 1);
  is('the twelve are the same twelve', [...new Set(moved.map((b) => b.fill).filter((f) => f !== RED))].sort(), [...new Set(colours)].sort());
  at = await spot(page, line);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i += 1) await page.mouse.move(at.x + i * 30, at.y);
  await page.mouse.up();
  await settled();
  is('sideways it goes nowhere: it only moves up and down the stack', await redBand(), line);
  await page.click('#redReset');
  await settled();
  is('and comes back', [await redBand(), await page.textContent('#redVal')], [15, '16 (standard)']);
  await page.keyboard.press('ArrowUp');
  await settled();
  is('arrows place it too', await redBand(), 16);
  await page.keyboard.press('ArrowDown');
  await settled();
  await page.keyboard.press('Escape');
  is('the swatch selects it and can\'t recolour it', await (async () => { await page.click('#swRed'); const r = [await page.isVisible('#redBox'), await page.isVisible('#nudge')]; await page.keyboard.press('Escape'); return r; })(), [true, false]);

  console.log('\n— the numbers —');
  is('eight numbers and three layouts, lowercase as written', [await page.locator('.no').allTextContents(), await page.locator('.op').allTextContents(), await page.evaluate(() => getComputedStyle(document.querySelector('.op')).textTransform)], [['No.1', 'No.2', 'No.3', 'No.4', 'No.5', 'No.6', 'No.7', 'No.8'], ['smol', 'bigly', 'random'], 'none']);
  const number = (n) => page.locator(`.no[data-no="${n}"]`).click();
  await number(2);
  await settled();
  const volcanic = PRESETS.find((p) => p.no === 2);
  is('a number swaps in its twelve, heaviest first', await hexes(page), volcanic.hexes);
  const vb = await bands();
  const seq = volcanic.hexes.map((h) => h.toLowerCase());
  const run = [...seq, ...seq.slice().reverse()];
  is('the rhythm doesn\'t change', vb.map((b) => b.fill), Array.from({ length: 55 }, (_, i) => (i === 15 ? RED : run[i % 24])));
  is('the number is lit, the red line stays its own', [await page.getAttribute('.no[data-no="2"]', 'aria-pressed'), lastPost().colours.some((c) => c.hex === '#D32011')], ['true', false]);
  let laid = 0;
  for (const p of PRESETS) {
    await number(p.no);
    await settled();
    const b = await bands();
    if (b.length === 55 && b[15].fill === RED && String(await hexes(page)) === String(p.hexes) && new Set(p.hexes).size === 12) laid += 1;
  }
  is('all eight are twelve colours and lay out, red line on 16', laid, 8);

  console.log('\n— smol, bigly, random —');
  const mirrored = (list) => { const twelve = [...new Set(list.map((b) => b.fill).filter((f) => f !== RED))]; const f = list.map((b) => b.fill); return twelve.length === 12 && f.every((x, i) => x === RED || f[(i + 24 - (i % 24)) - 1 - (i % 24)] === undefined || f[(i - (i % 24)) + 23 - (i % 24)] === RED || f[(i - (i % 24)) + 23 - (i % 24)] === undefined || f[(i - (i % 24)) + 23 - (i % 24)] === x); };
  const mm = (list) => { const t = list.reduce((s, b) => s + b.size, 0); return list.map((b) => Math.round((b.size / t) * 600)); };
  const canon = (list) => mm(list).every((v, i) => (list[i].fill === RED ? v === 12 : [6, 12, 24].includes(v)));
  const op = (name) => page.locator(`.op[data-op="${name}"]`).click();
  await number(3);
  await settled();
  const standard = await still();
  const base3 = await bands();
  const three = [...new Set(base3.map((b) => b.fill))].sort();
  await op('bigly');
  await settled();
  const big = await still();
  const bigBands = bandsIn(big);
  await op('random');
  await settled();
  const r1 = await still();
  await op('random');
  await settled();
  const r2 = await still();
  const four = [standard, big, r1, r2];
  is('No.3, bigly, random, random: four different strips', new Set(four).size, 4);
  is('all the same twelve colours', four.every((v) => String([...new Set(bandsIn(v).map((b) => b.fill))].sort()) === String(three)), true);
  is('all mirrored, each with one red line', four.every((v) => mirrored(bandsIn(v)) && bandsIn(v).filter((b) => b.fill === RED).length === 1), true);
  is('every strip on the measure, the red line at its own', four.every((v) => canon(bandsIn(v))), true);
  const rolls = new Set();
  for (let i = 0; i < 4; i += 1) {
    await op('random');
    await settled();
    rolls.add(JSON.stringify(lastPost().colours.map((c) => c.amount).slice().sort()));
  }
  is('random re-rolls the widths as well as the order', rolls.size > 1, true);
  is('bigly has fewer bands and the fields lead', [bigBands.length < base3.length, mm(bigBands).filter((v) => v === 24).length > mm(base3).filter((v) => v === 24).length], [true, true]);
  await number(3);
  await settled();
  is('a number starts over from the standard layout', await still(), standard);
  await op('smol');
  await settled();
  const small = await bands();
  is('smol is tighter and busier', [small.length > base3.length, mm(small).filter((v) => v === 24).length, canon(small)], [true, 0, true]);
  is('and the number stays lit, because the colours haven\'t changed', await page.getAttribute('.no[data-no="3"]', 'aria-pressed'), 'true');
  is('the dials say what happened', await page.inputValue('#count'), String(small.length));
  await page.locator('#swRed').click();
  await page.keyboard.press('ArrowUp');
  await settled();
  await page.keyboard.press('Escape');
  await op('random');
  await settled();
  is('a placed red line stays placed through a layout', (await bands()).findIndex((b) => b.fill === RED), 16);
  await page.click('#swRed');
  await page.click('#redReset');
  await settled();
  await page.keyboard.press('Escape');

  await number(2);
  await settled();
  await page.locator('#sws .sw').nth(0).click();
  is('a swatch opens a nudge in the rail, over nothing', [await page.isVisible('#nudge'), await page.locator('input[type=color]').count()], [true, 0]);
  const before = await still();
  const answer = page.waitForResponse((r) => r.url().includes('/api/strips/preview') && JSON.parse(r.request().postData()).colours[0].hex !== volcanic.hexes[0]);
  await page.fill('#nH', '200');
  const nudged = await still();
  is('one colour changes at once, before the server has said a word', [nudged !== before, bandsIn(nudged).length, bandsIn(nudged).filter((b, n) => b.fill !== bandsIn(before)[n].fill).length > 0], [true, 55, true]);
  is('and that takes the number off', await page.getAttribute('.no[data-no="2"]', 'aria-pressed'), 'false');
  const { design: told } = await (await answer).json();
  await settled();
  is('the server\'s answer is the same still', await still(), stillSVG(told).replace('<svg ', `<svg${STRETCH} `));
  await page.fill('#nudgeHex', '#D32011');
  await page.locator('#nudgeHex').blur();
  await settled();
  is('the red line\'s red is refused here too', lastPost().colours[0].hex !== '#D32011', true);
  await page.keyboard.press('Escape');

  console.log('\n— custom —');
  await page.click('#custom summary');
  is('it opens with everything in it', [await page.isVisible('#length'), await page.isVisible('#width'), await page.isVisible('#count'), await page.isVisible('#vib'), await page.isVisible('[data-orient="portrait"]')], [true, true, true, true, true]);
  is('the strip stays on screen with it open', await page.evaluate(() => { const r = document.getElementById('strips').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && document.documentElement.scrollHeight <= innerHeight; }), true);
  is('and the two buttons stay pinned', await page.evaluate(() => { const r = document.getElementById('png').getBoundingClientRect(); return r.bottom <= innerHeight; }), true);

  const a = await still();
  await page.locator('.pal-row').nth(0).locator('[data-act="down"]').click();
  await settled();
  is('reordering changes the strip', (await still()) !== a, true);

  await page.locator('.pal-row').nth(0).locator('input[type=text]').fill('#010203');
  await page.locator('.pal-row').nth(0).locator('input[type=text]').blur();
  await settled();
  is('a typed hex lands', lastPost().colours[0].hex, '#010203');

  await page.locator('.pal-row').nth(1).locator('input[type=text]').fill('#D32011');
  await page.locator('.pal-row').nth(1).locator('input[type=text]').blur();
  await settled();
  is('the red line\'s red is refused as a palette colour', lastPost().colours[1].hex !== '#D32011', true);

  await page.locator('.pal-row').nth(2).locator('[data-act="lock"]').click();
  const kept = await page.locator('.pal-row').nth(2).locator('input[type=text]').inputValue();
  const was3 = await page.locator('.pal-row').nth(3).locator('input[type=text]').inputValue();
  await page.click('#refresh');
  await settled();
  is('refresh keeps the lock and changes the rest', [await page.locator('.pal-row').nth(2).locator('input[type=text]').inputValue() === kept, await page.locator('.pal-row').nth(3).locator('input[type=text]').inputValue() !== was3], [true, true]);

  for (let i = 0; i < 9; i += 1) await page.locator('.pal-row').last().locator('[data-act="drop"]').click();
  await settled();
  is('three is the least', [await page.locator('.pal-row').count(), await page.locator('.pal-row').last().locator('[data-act="drop"]').isDisabled()], [3, true]);

  await page.click('#community');
  await settled();
  is('the community palette loads', lastPost().colours.map((c) => c.hex), ['#112233', '#445566', '#778899', '#AABBCC']);

  await page.fill('#length', '200');
  await page.fill('#width', '30');
  await settled();
  const portraitBefore = await still();
  await page.click('[data-orient="portrait"]');
  await settled();
  const p = await still();
  is('portrait turns the still', [p !== portraitBefore, Number(p.match(/viewBox="0 0 (\d+) (\d+)/)[2]) > Number(p.match(/viewBox="0 0 (\d+) (\d+)/)[1])], [true, true]);

  /* in portrait the stack runs across: a band slides up and down, the line sideways */
  const box = await page.locator('#strips').boundingBox();
  const redNow = bandsIn(p).findIndex((b) => b.fill === RED);
  const list = bandsIn(p);
  const total = list.reduce((s, b) => s + b.size, 0);
  const redX = box.x + box.width * (list.slice(0, redNow).reduce((s, b) => s + b.size, 0) + list[redNow].size / 2) / total;
  await page.mouse.move(redX, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i += 1) await page.mouse.move(redX + i * 12, box.y + box.height / 2);
  await page.mouse.up();
  await settled();
  is('in portrait the red line slides along the stack', bandsIn(await still()).findIndex((b) => b.fill === RED) > redNow, true);
  await page.click('#redReset');
  await settled();
  await page.keyboard.press('Escape');

  await page.click('[data-orient="landscape"]');
  await settled();

  /* a narrower strip can't hold a line placed high up */
  await page.fill('#length', '120');
  await page.fill('#width', '60');
  await settled();
  await page.click('#swRed');
  for (let i = 0; i < 24; i += 1) await page.keyboard.press('ArrowUp');
  await settled();
  await page.keyboard.press('Escape');
  await page.fill('#width', '10');
  await settled();
  const narrow = await bands();
  is('a narrower strip brings the red line back inside it, and still lays out', [narrow.length, narrow.filter((b) => b.fill === RED).length, lastPost().red_line], [16, 1, 16]);
  await page.fill('#width', '60');
  await settled();

  await page.route('**/api/strips/preview', (r) => r.abort(), { times: 1 });
  const held = await still();
  await page.fill('#vib', '1.1');
  await settled();
  is('a failed answer says so and leaves the strip as it was', [await still(), (await page.textContent('#said')).length > 0], [held, true]);
  /* a size, because a step of vibrancy can land on the same design */
  await page.fill('#length', '130');
  await settled();
  is('and the next change still draws', (await still()) !== held, true);
  await page.fill('#length', '120');
  await settled();

  console.log('\n— what you see is what you mint —');
  /* a value this page hasn't asked about yet, so the answer is fresh */
  const fresh = page.waitForResponse((r) => r.url().includes('/api/strips/preview'));
  await page.fill('#vib', '1.35');
  const { design } = await (await fresh).json();
  await settled();
  is('the still on screen is what the design draws, but for the stretch', await still(), stillSVG(design).replace('<svg ', `<svg${STRETCH} `));
  is('the true shape is what the design draws, byte for byte', await page.evaluate(() => atob(document.getElementById('trueShape').src.split(',')[1])), stillSVG(design));

  console.log('\n— the test signal —');
  const buttons = async () => [await page.textContent('#mint'), await page.isDisabled('#mint'), await page.textContent('#png'), await page.isDisabled('#png'), await page.textContent('#pMint')];
  const picture = () => page.evaluate(() => document.getElementById('sigCanvas').toDataURL('image/jpeg', .3));
  /* how many of these colours are on the canvas right now */
  const onCanvas = (list) => page.evaluate((want) => {
    const c = document.getElementById('sigCanvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const seen = new Set();
    for (let i = 0; i < d.length; i += 4) seen.add(`#${[d[i], d[i + 1], d[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase());
    return want.filter((h) => seen.has(h)).length;
  }, list);
  const fps = (seconds) => page.evaluate((s) => new Promise((ok) => { let n = 0; const t0 = performance.now(); const tick = () => { n += 1; if (performance.now() - t0 >= s * 1000) ok(n / s); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); }), seconds);
  await number(2);
  await settled();
  const quietStill = await still();
  const offButtons = await buttons();
  const offPosts = posts.length;
  await page.click('#testSignal');
  await page.waitForTimeout(200);
  const cover = await page.evaluate(() => { const a = document.getElementById('signal').getBoundingClientRect(), b = document.getElementById('strips').getBoundingClientRect(), c = document.getElementById('sigCanvas').getBoundingClientRect(); return [a.width === b.width && a.height === b.height, c.width === b.width && c.height === b.height]; });
  is('Test Signal covers the whole strip', cover, [true, true]);
  is('it says what it is, on itself, and names nothing else', (await page.locator('#signal').innerText()).trim(), 'test signal... the real signal lands on-chain at mint');
  is('the button says it\'s on', await page.getAttribute('#testSignal', 'aria-pressed'), 'true');
  is('the mint buttons are exactly as they were', await buttons(), offButtons);
  const passes = [], looks = new Set(), rates = [];
  let palette12 = 0;
  for (let i = 0; i < 14; i += 1) {
    passes.push(await page.getAttribute('#signal', 'data-pass'));
    looks.add(await picture());
    palette12 = Math.max(palette12, await onCanvas(volcanic.hexes));
    rates.push(await fps(2));
  }
  const seen = [...new Set(passes)].sort();
  console.log(`     frames a second, each two-second sample: ${rates.map((r) => Math.round(r)).join(' ')}`);
  is('it loops through the calm, the middling and the heavy', seen, ['0', '1', '2']);
  is('it moves', looks.size >= 3, true);
  is('on their palette', palette12 >= 6, true);
  is('at a good rate, even at its heaviest', Math.min(...rates) >= 30, true);
  is('with the buttons untouched and nothing asked of the server', [await buttons(), posts.length], [offButtons, offPosts]);
  const onStrip = await page.locator('#strips').boundingBox();
  await page.mouse.click(onStrip.x + onStrip.width / 2, onStrip.y + onStrip.height / 2);
  is('the strip can\'t be pressed through it', [await knobOn(), await page.isVisible('#signal')], [false, true]);
  await number(7);
  await settled();
  const perfection = PRESETS.find((x) => x.no === 7);
  let next12 = 0;
  for (let i = 0; i < 8; i += 1) { next12 = Math.max(next12, await onCanvas(perfection.hexes)); await page.waitForTimeout(250); }
  is('a new preset reaches it live', [next12 >= 6, await page.isVisible('#signal')], [true, true]);
  await page.click('#testSignal');
  is('pressing again drops back', [await page.isVisible('#signal'), await page.getAttribute('#testSignal', 'aria-pressed')], [false, 'false']);
  const after = await picture();
  await page.waitForTimeout(300);
  is('and it has stopped', await picture(), after);
  await number(2);
  await settled();
  is('the still is the one it left', await still(), quietStill);
  await page.click('#testSignal');
  await page.keyboard.press('Escape');
  is('Esc drops back too', await page.isVisible('#signal'), false);
  const calm = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const slow = await calm.newPage();
  slow.on('pageerror', (e) => errors.push(e.message));
  await slow.goto(`${site.url}/strip-painting-maker`);
  await ready(slow);
  await slow.click('#testSignal');
  await slow.waitForTimeout(200);
  const one = await slow.evaluate(() => document.getElementById('sigCanvas').toDataURL());
  await slow.waitForTimeout(1200);
  is('someone who asked for less motion gets a held frame, not a flicker', [await slow.isVisible('#signal'), await slow.evaluate(() => document.getElementById('sigCanvas').toDataURL()) === one, one.length > 1000], [true, true, true]);
  await calm.close();

  console.log('\n— the two buttons —');
  const look = await page.evaluate(() => {
    const border = (id) => parseFloat(getComputedStyle(document.getElementById(id)).borderTopWidth);
    const palette = [...document.querySelectorAll('.block h2')].find((h) => h.textContent === 'Palette');
    return { png: border('png'), test: border('testSignal'), above: document.getElementById('testSignal').getBoundingClientRect().bottom <= palette.getBoundingClientRect().top };
  });
  is('one button pinned, Download beside it as words', [await page.locator('.actions button:visible').count(), look.png], [2, 0]);
  is('Test Signal is a button, above the palette', [look.test > 0, look.above], [true, true]);
  is('MINT waits for a deployment, DOWNLOAD doesn\'t', [await page.textContent('#mint'), await page.isDisabled('#mint'), await page.textContent('#png'), await page.isDisabled('#png')], ['Mint //STRIP · soon', true, 'Download //STRIP', false]);
  is('the commission is nowhere before the mint', [await page.isVisible('#commission'), /commission/i.test(await page.locator('body').innerText())], [false, false]);
  is('no grid is named on the page', /6 mm|grid/i.test(await page.textContent('main')), false);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#png')]);
  is('Download hands over the file', /^strips-120x60cm-\d+strips-redline\d+\.png$/.test(download.suggestedFilename()), true);
  const loopCount = await page.evaluate(() => new Promise((ok) => {
    let n = 0;
    const real = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function draw(...a) { n += 1; return real.apply(this, a); };
    setTimeout(() => { CanvasRenderingContext2D.prototype.drawImage = real; ok(n); }, 400);
  }));
  is('with the signal off, nothing is drawing', loopCount, 0);
  const waiting = await context.newPage();
  await waiting.route('**/api/strips/state', () => { /* never answers */ });
  await waiting.goto(`${site.url}/strip-painting-maker`);
  await waiting.waitForFunction(() => document.getElementById('stripImg').src.startsWith('data:image/svg'));
  is('until the page knows the state, no price anywhere', [/0\.009|ETH/.test(await waiting.locator('body').innerText()), await waiting.textContent('#pMint')], [false, '']);
  await waiting.close();
  const html = readFileSync(new URL('../../strip-painting-maker.html', import.meta.url), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
  is('and none in the page as served', /0\.009/.test(html), false);
  is('the public palettes carry the colours and nothing about how they were found', Object.keys(PRESETS[0]).sort(), ['hexes', 'no', 'title', 'weights']);

  if (SHOTS) await page.screenshot({ path: `${SHOTS}/maker-desktop.png` });

  console.log('\n— a phone —');
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const mobile = await phone.newPage();
  mobile.on('pageerror', (e) => errors.push(e.message));
  await mobile.goto(`${site.url}/strip-painting-maker`);
  await ready(mobile);
  await mobile.waitForTimeout(400);
  const fit = await mobile.evaluate(() => ({ wide: document.documentElement.scrollWidth <= innerWidth, tall: document.documentElement.scrollHeight <= innerHeight, strip: document.getElementById('strips').getBoundingClientRect().height / innerHeight, png: document.getElementById('png').getBoundingClientRect().bottom <= innerHeight }));
  is('nothing scrolls but the sheet, the strip keeps 55%, the buttons stay', [fit.wide, fit.tall, fit.strip >= .549, fit.png], [true, true, true, true]);

  const cdp = await phone.newCDPSession(mobile);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const mobileStart = bandsIn(await stillOf(mobile));
  const n = mobileStart.findIndex((b, i) => i > 20 && b.fill !== RED);
  const tapAt = await spot(mobile, n);
  await mobile.touchscreen.tap(tapAt.x, tapAt.y);
  await mobile.waitForTimeout(250);
  is('a tap selects', await mobile.isVisible('#knob'), true);
  const picked = await mobile.textContent('#tag');
  /* well away from the band, so the finger doesn't have to stay on it */
  const far = await spot(mobile, 6);
  const way = (await mobile.textContent('#tag')).endsWith('... more') ? -1 : 1;
  await touch('touchStart', 195, far.y);
  for (let i = 1; i <= 10; i += 1) await touch('touchMove', 195 + way * i * 14, far.y);
  await touch('touchEnd');
  await mobile.waitForTimeout(500);
  is('then a drag anywhere moves that colour, not the one under the finger', [(await mobile.textContent('#tag')).split(' ... ')[0], (await mobile.textContent('#tag')) !== picked], [picked.split(' ... ')[0], true]);
  is('with the strip still in view', await mobile.isVisible('#strips'), true);
  const other = await spot(mobile, 3);
  await mobile.touchscreen.tap(other.x, other.y);
  await mobile.waitForTimeout(250);
  is('a tap elsewhere picks again', (await mobile.textContent('#tag')).split(' ... ')[0] !== picked.split(' ... ')[0], true);
  if (SHOTS) await mobile.screenshot({ path: `${SHOTS}/maker-phone.png` });
  is('no page errors', errors, []);
} finally {
  await browser.close();
  site.close();
}
console.log(`\n${passes} passed, ${fails} failed`);
if (fails) process.exit(1);
