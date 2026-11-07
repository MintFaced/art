#!/usr/bin/env node
/* All 56 faults, in a real browser, held to what the brief says about them.
 *
 * The faults came across from the study as dense one-liners, and a token only
 * ever shows the two to four the VRF word picks, so a broken one could sit
 * unseen until the first token that drew it. Each runs here at every shape a
 * token can be, street strips included.
 *
 * STRIPS_SHOTS=dir leaves a contact sheet to look at.
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { serve } from './serve.mjs';

const require = createRequire(new URL('../../contracts/package.json', import.meta.url));
const { chromium } = require('playwright');

let passes = 0; let fails = 0;
const is = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? passes += 1 : fails += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n     got  ${JSON.stringify(got).slice(0, 900)}\n     want ${JSON.stringify(want).slice(0, 300)}`}`);
};

/* Three colours and a red line, as the Maker packs them, at each size below */
const BODY = '04112233445566d32011aa00bb021222323222120202122232322212f2021222323222120202122232322212020212223232221202021121323221110101112132322111';
const hex2 = (n) => n.toString(16).padStart(4, '0');
const design = (portrait, length, width) => `0x${portrait ? '01' : '00'}${hex2(length)}${hex2(width)}${BODY}`;
const SHAPES = [
  { name: 'a Maker landscape', hex: design(false, 120, 60), long: 1200 },
  { name: 'a Maker portrait', hex: design(true, 120, 60), long: 1200 },
  { name: 'the street strip at No.1', hex: design(false, 600, 55), long: 1200 },
  { name: 'a gallery thumbnail of it', hex: design(false, 600, 55), long: 160 },
  { name: 'an awkward size, every edge fractional', hex: design(false, 130, 70), long: 1001 },
  { name: 'and portrait', hex: design(true, 130, 70), long: 1001 },
];

const site = await serve(0);
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${site.url}/robots.txt`);

  const sweep = await page.evaluate(async ({ shapes }) => {
    const m = await import('/strips-blink.js');
    const hash = (c) => {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let h = 0x811c9dc5;
      for (let i = 0; i < d.length; i += 1) h = Math.imul(h ^ d[i], 0x01000193);
      return h >>> 0;
    };
    const isGrey = (c) => {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - d[i + 1]) > 1 || Math.abs(d[i + 1] - d[i + 2]) > 1) return false;
      return true;
    };
    const P = [0, .01, .1, .25, .42, .5, .56, .74, .9, .99, 1];
    const out = { faults: 0, threw: [], silent: [], unsteady: [], colour: [], stillMoved: [], slow: [], sizes: [] };
    for (const shape of shapes) {
      const d = m.decodeDesign(shape.hex);
      const { w, h } = m.sizeOf(d, shape.long);
      out.sizes.push([shape.name, w, h]);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      for (const display of m.DISPLAYS) {
        const mono = !!display.mono;
        m.renderStill(ctx, d, mono);
        const still = hash(c);
        for (const id of display.faults) {
          out.faults += 1;
          let moved = false;
          let worst = 0;
          for (const p of P) {
            try {
              /* over two different pictures, because a viewer arriving now and
                 one who has been watching have different frames underneath */
              ctx.fillStyle = '#ff00ff'; ctx.fillRect(0, 0, w, h);
              const t0 = performance.now();
              m.renderFrame(ctx, d, id, p, { mono });
              worst = Math.max(worst, performance.now() - t0);
              const first = hash(c);
              if (first !== still) moved = true;
              ctx.fillStyle = '#00ff00'; ctx.fillRect(0, 0, w, h);
              m.renderFrame(ctx, d, id, p, { mono });
              if (hash(c) !== first) out.unsteady.push(`${id} p=${p} on ${shape.name}`);
              if (mono && !isGrey(c)) out.colour.push(`${id} p=${p} on ${shape.name}`);
            } catch (e) { out.threw.push(`${id} p=${p} on ${shape.name}: ${e.message}`); }
          }
          if (!moved) out.silent.push(`${id} on ${shape.name}`);
          if (shape.long === 1200) out.slow.push([Math.round(worst), id, shape.name]);
          m.renderStill(ctx, d, mono);
          if (hash(c) !== still) out.stillMoved.push(`${id} on ${shape.name}`);
        }
      }
    }
    out.slow.sort((a, b) => b[0] - a[0]);
    out.slow = out.slow.slice(0, 6);
    return out;
  }, { shapes: SHAPES });

  console.log('\n— every fault, every shape —');
  console.log('     ', sweep.sizes.map(([n, w, h]) => `${n} ${w}×${h}`).join(' · '));
  is('56 faults at each of the shapes', sweep.faults, 56 * SHAPES.length);
  is('none throws', sweep.threw, []);
  is('every one draws something', sweep.silent, []);
  is('a frame owes nothing to the one before it, so everyone sees one signal', sweep.unsteady, []);
  is('a valve set stays black and white', sweep.colour, []);
  is('every fault settles back to the exact still', sweep.stillMoved, []);
  console.log('      slowest frames at 1200 px, ms:', sweep.slow.map(([ms, id]) => `${id} ${ms}`).join(', '));

  const clock = await page.evaluate(async () => {
    const m = await import('/strips-blink.js');
    const word = (n) => `0x${n.toString(16).padStart(8, '0').repeat(8)}`;
    const HOURS = 6; const STEP = .05;
    const byRhythm = {};
    const issues = { foreign: [], negative: [], shortGap: [] };
    let chains = 0; let runs = 0;
    for (let n = 1; n <= 240; n += 1) {
      const w = word(Math.imul(n, 0x9E3779B1) >>> 0);
      const tr = m.traitsOf(w);
      const name = m.RHYTHMS[tr.rhythm].id;
      const r = byRhythm[name] || (byRhythm[name] = { tokens: 0, on: 0, ticks: 0 });
      r.tokens += 1;
      let last = null;
      const span = name === 'haywire' ? HOURS * 3600 : 3600;
      for (let t = 0; t < span; t += STEP) {
        const s = m.schedule(w, tr, t);
        r.ticks += 1;
        if (s) {
          r.on += 1;
          if (s.p < 0 || s.p > 1) issues.negative.push([w, t, s.p]);
          if (!tr.faults.includes(s.id) && !['hhold', 'snow', '_dark', '_on', '_lines'].includes(s.id)) issues.foreign.push([name, s.id]);
          if (s.id !== last) { runs += 1; if (s.id === '_lines') chains += 1; }
        }
        last = s ? s.id : null;
      }
    }
    const w = word(0xABCDEF);
    const tr = m.traitsOf(w);
    const line = (hour) => Array.from({ length: 7200 }, (_, i) => { const s = m.schedule(w, tr, hour * 3600 + i / 2); return s ? s.id : '.'; }).join();
    const hundredYears = Math.floor(100 * 365.25 * 24);
    return { byRhythm, issues, chains, runs, loops: line(0) === line(1), far: line(hundredYears) === line(hundredYears + 1), farFine: line(hundredYears) === line(0), before: m.schedule(w, tr, -1) };
  });
  console.log('\n— the clock —');
  is('only a token\'s own faults and the signature chain ever play', clock.issues.foreign.slice(0, 5), []);
  is('p stays between 0 and 1', clock.issues.negative.slice(0, 5), []);
  is('nothing plays before the mint', clock.before, null);
  is('one hour isn\'t the next', clock.loops, false);
  is('nor a hundred years on', [clock.far, clock.farFine], [false, false]);
  const shares = Object.fromEntries(Object.entries(clock.byRhythm).map(([k, v]) => [k, Math.round((v.on / v.ticks) * 100)]));
  console.log('      time a fault is on screen, %:', JSON.stringify(shares), '· tokens', JSON.stringify(Object.fromEntries(Object.entries(clock.byRhythm).map(([k, v]) => [k, v.tokens]))));
  /* a chain is six pieces and one event */
  const oneIn = (clock.runs - 5 * clock.chains) / clock.chains;
  console.log(`      a signature chain in 1 of every ${oneIn.toFixed(1)} events`);
  is('about one fault in seven is the signature chain', oneIn > 6 && oneIn < 8.5, true);
  is('the still holds most of the time, calm', shares.calm < 50, true);
  is('and restless', shares.restless < 50, true);

  is('no page errors', errors, []);

  if (process.env.STRIPS_SHOTS) {
    const sheet = await page.evaluate(async (hex) => {
      const m = await import('/strips-blink.js');
      const d = m.decodeDesign(hex);
      const all = m.DISPLAYS.flatMap((x) => x.faults.map((id) => [id, !!x.mono]));
      const W = 240; const H = 120; const cols = 8; const rows = Math.ceil(all.length / cols);
      const c = document.createElement('canvas'); c.width = cols * (W + 6); c.height = rows * (H + 22);
      const x = c.getContext('2d'); x.fillStyle = '#222'; x.fillRect(0, 0, c.width, c.height);
      const one = document.createElement('canvas'); one.width = W * 2; one.height = H * 2;
      const o = one.getContext('2d');
      all.forEach(([id, mono], i) => {
        m.renderFrame(o, d, id, .5, { mono });
        const cx = (i % cols) * (W + 6); const cy = Math.floor(i / cols) * (H + 22);
        x.drawImage(one, cx, cy, W, H);
        x.fillStyle = '#fff'; x.font = '13px monospace'; x.fillText(id, cx + 2, cy + H + 15);
      });
      return c.toDataURL('image/png').split(',')[1];
    }, SHAPES[0].hex);
    writeFileSync(`${process.env.STRIPS_SHOTS}/faults.png`, Buffer.from(sheet, 'base64'));
  }
} catch (e) {
  fails += 1;
  console.log('FAIL', e.message);
} finally {
  await browser.close();
  site.close();
}
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
