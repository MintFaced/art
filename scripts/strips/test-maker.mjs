#!/usr/bin/env node
/* The Maker in a real browser, against the real routes. */
import { createRequire } from 'node:module';
import { serve } from './serve.mjs';
import { stillSVG } from '../../strips-design.js';

const require = createRequire(new URL('../../contracts/package.json', import.meta.url));
const { chromium } = require('playwright');
const SHOTS = process.env.STRIPS_SHOTS || '';

let fails = 0, passes = 0;
const is = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? passes += 1 : fails += 1; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` :: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`}`); };

const site = await serve(0, { stub: { '/api/nudge': { series: { locked: ['#112233', '#445566', '#778899', '#AABBCC'].map((hex) => ({ hex })) } }, '/api/fx': {} } });
const browser = await chromium.launch();
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  const posts = [];
  page.on('request', (r) => { if (r.method() === 'POST') posts.push({ url: r.url(), body: r.postData() }); });
  await page.goto(`${site.url}/strip-painting-maker`);
  await page.waitForFunction(() => document.getElementById('stripImg').src.startsWith('data:image/svg'));

  const still = () => page.evaluate(() => atob(document.getElementById('stripImg').src.split(',')[1]));
  const settled = async () => { await page.waitForTimeout(450); };
  is('twelve colours to start', await page.locator('.pal-row').count(), 12);
  /* a design mints once, so nobody may open on the same one */
  const colours = (p) => p.locator('.pal-row input[type=text]').evaluateAll((els) => els.map((x) => x.value));
  const openings = [await colours(page)];
  for (let i = 0; i < 5; i += 1) {
    const visit = await context.newPage();
    visit.on('pageerror', (e) => errors.push(e.message));
    await visit.goto(`${site.url}/strip-painting-maker`);
    await visit.waitForFunction(() => document.getElementById('stripImg').src.startsWith('data:image/svg'));
    openings.push(await colours(visit));
    await visit.close();
  }
  is('every visit opens on a fresh palette, and the server lays each one', new Set(openings.map(String)).size, 6);
  is('twelve different colours each time, none the red line\'s', openings.every((c) => new Set(c).size === 12 && !c.includes('#D32011')), true);
  const first = await still();
  is('the preview is a real still', first.startsWith('<svg xmlns'), true);
  const lastPost = () => JSON.parse(posts.filter((p) => p.url.includes('/api/strips/preview')).at(-1).body);

  console.log('\n— colours —');
  await page.locator('.pal-row').nth(0).locator('[data-amount="less"]').click();
  await settled();
  is('an amount changes the strip', (await still()) !== first, true);
  is('and goes to the server as a choice, not a band', [lastPost().colours[0].amount, 'bands' in lastPost(), 'strips' in lastPost()], ['less', false, false]);

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
  const before = await page.locator('.pal-row').nth(3).locator('input[type=text]').inputValue();
  await page.click('#refresh');
  await settled();
  is('refresh keeps the lock and changes the rest', [await page.locator('.pal-row').nth(2).locator('input[type=text]').inputValue() === kept, await page.locator('.pal-row').nth(3).locator('input[type=text]').inputValue() !== before], [true, true]);

  for (let i = 0; i < 9; i += 1) await page.locator('.pal-row').last().locator('[data-act="drop"]').click();
  await settled();
  is('three is the least', [await page.locator('.pal-row').count(), await page.locator('.pal-row').last().locator('[data-act="drop"]').isDisabled()], [3, true]);

  await page.click('#community');
  await settled();
  is('the community palette loads', lastPost().colours.map((c) => c.hex), ['#112233', '#445566', '#778899', '#AABBCC']);

  await page.waitForFunction(() => document.querySelectorAll('#street button').length > 0);
  await page.locator('#street button').first().click();
  await settled();
  is('a street work\'s palette loads in one tap', lastPost().colours.length > 3, true);

  console.log('\n— the red line —');
  is('the stepper starts closed', await page.isVisible('#momentBox'), false);
  await page.click('#moment');
  is('the quiet line opens it', [await page.isVisible('#momentBox'), await page.textContent('#redVal')], [true, '16 (standard)']);
  await page.click('#redUp');
  await settled();
  is('it moves on the design', [lastPost().red_line, (await page.textContent('#redVal')).startsWith('17')], [17, true]);
  await page.click('#redReset');
  await settled();
  is('and comes back', await page.textContent('#redVal'), '16 (standard)');

  console.log('\n— size —');
  await page.fill('#length', '200');
  await page.fill('#width', '30');
  await settled();
  const portraitBefore = await still();
  await page.click('[data-orient="portrait"]');
  await settled();
  const p = await still();
  is('portrait turns the still', [p !== portraitBefore, Number(p.match(/viewBox="0 0 (\d+) (\d+)/)[2]) > Number(p.match(/viewBox="0 0 (\d+) (\d+)/)[1])], [true, true]);
  await page.click('[data-orient="landscape"]');
  await settled();

  console.log('\n— what you see is what you mint —');
  /* a value this page hasn't asked about yet, so the answer is fresh */
  const answer = page.waitForResponse((r) => r.url().includes('/api/strips/preview'));
  await page.fill('#vib', '1.35');
  const { design } = await (await answer).json();
  await settled();
  is('the still on screen is byte for byte what the design draws', await still(), stillSVG(design));

  console.log('\n— the signal —');
  is('a sample is playing', await page.locator('#signal canvas').count(), 1);
  const frames = new Set();
  for (let i = 0; i < 30; i += 1) { frames.add(await page.evaluate(() => { const c = document.querySelector('#signal canvas'); return c ? c.toDataURL('image/jpeg', .2).length : 0; })); await page.waitForTimeout(160); }
  is('and it moves', frames.size > 1, true);
  is('the label says it isn\'t the real one', (await page.textContent('body')).includes('Your signal is drawn at mint.'), true);

  console.log('\n— buttons —');
  is('MINT waits for a deployment', [await page.textContent('#mint'), await page.isDisabled('#mint')], ['Mint · soon', true]);
  is('COMMISSION is beside it', await page.isVisible('#commission'), true);
  is('no grid is named on the page', /6 mm|grid/i.test(await page.textContent('main')), false);

  if (SHOTS) await page.screenshot({ path: `${SHOTS}/maker-desktop.png`, fullPage: true });
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  const mobile = await phone.newPage();
  await mobile.goto(`${site.url}/strip-painting-maker`);
  await mobile.waitForFunction(() => document.getElementById('stripImg').src.startsWith('data:image/svg'));
  await mobile.waitForTimeout(400);
  is('no sideways scroll on a phone', await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  if (SHOTS) await mobile.screenshot({ path: `${SHOTS}/maker-phone.png`, fullPage: true });
  is('no page errors', errors, []);
} finally {
  await browser.close();
  site.close();
}
console.log(`\n${passes} passed, ${fails} failed`);
if (fails) process.exit(1);
