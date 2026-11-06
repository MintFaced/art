#!/usr/bin/env node
/* The token plays with the network blocked. Takes real tokenURI output from the
 * real renderer, decodes animation_url, opens it in a browser that can't reach
 * anything, and watches the canvas change.
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pack, RED_INDEX } from '../../strips-design.js';
import { startChain, deployRenderer } from './chain.mjs';

const require = createRequire(new URL('../../contracts/package.json', import.meta.url));
const { chromium } = require('playwright');
const OUT = process.env.STRIPS_SHOTS || '';
if (OUT) mkdirSync(OUT, { recursive: true });

const palette = ['#E06448', '#D5C089', '#60B15C', '#2F201D', '#B67556', '#EEBFB7', '#82B2CE', '#4C4040'];
const bandsOf = (count) => Array.from({ length: count }, (_, i) => (i === 15 ? { c: RED_INDEX, u: 2 } : { c: i % palette.length, u: [1, 2, 1, 4, 1, 2][i % 6] }));
const CASES = [
  { name: 'landscape', design: pack({ length: 240, width: 60, colours: palette, bands: bandsOf(55) }), word: `0x${'a7'.repeat(32)}` },
  { name: 'portrait', design: pack({ portrait: true, length: 110, width: 55, colours: palette, bands: bandsOf(40) }), word: `0x${'3c19'.repeat(16)}` },
  { name: 'thin 24 to 1', design: pack({ length: 240, width: 10, colours: palette, bands: bandsOf(16) }), word: `0x${'0d'.repeat(32)}` },
  { name: 'tuning', design: pack({ length: 120, width: 60, colours: palette, bands: bandsOf(30) }), word: '' },
];

const chain = await startChain();
const browser = await chromium.launch();
let fails = 0;
try {
  const { renderer } = await deployRenderer(chain);
  for (const c of CASES) {
    const view = { id: 212n, design: c.design, word: c.word ? BigInt(c.word) : 0n, mintedAt: BigInt(Math.floor(Date.now() / 1000) - 5000), viewIndex: 0n, redeemed: false, photo: '', no: 0n, site: '' };
    /* the brief's limit: tokenURI has to come back inside a 30M gas eth_call */
    const uri = await chain.client.readContract({ ...renderer, functionName: 'render', args: [view], gas: 30_000_000n });
    const meta = JSON.parse(Buffer.from(uri.split(',')[1], 'base64').toString('utf8'));
    const context = await browser.newContext({ viewport: { width: 900, height: 600 }, offline: true });
    const page = await context.newPage();
    const asked = [], errors = [];
    await page.route('**/*', (route) => { const u = route.request().url(); if (u.startsWith('data:')) return route.continue(); asked.push(u); return route.abort(); });
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(meta.animation_url);
    await page.waitForSelector('canvas', { timeout: 8000 });
    const look = () => page.evaluate(() => { const c = document.querySelector('canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0, lit = 0; for (let i = 0; i < d.length; i += 97) { h = (h * 31 + d[i]) | 0; if (d[i] + d[i + 1] + d[i + 2] > 30) lit += 1; } return { h, lit, w: c.width, h2: c.height }; });
    const seen = new Set();
    let last;
    for (let i = 0; i < 40; i += 1) { last = await look(); seen.add(last.h); await page.waitForTimeout(250); }
    if (OUT) await page.screenshot({ path: `${OUT}/${c.name.replace(/\W+/g, '-')}.png` });
    const ok = !asked.length && !errors.length && last.lit > 0 && (c.word ? true : seen.size > 3);
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${c.name}: ${last.w}x${last.h2}, ${seen.size} different frames in 10 s, ${asked.length} network asks, ${errors.length} errors, ${Math.round(uri.length / 1024)} KB tokenURI${errors[0] ? ` :: ${errors[0]}` : ''}`);
    if (!ok) fails += 1;
    await context.close();
  }
} finally {
  await browser.close();
  chain.stop();
}
if (fails) process.exit(1);
