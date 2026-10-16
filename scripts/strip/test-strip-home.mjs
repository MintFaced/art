#!/usr/bin/env node
/* The home page's Strip Painting door (STRIP-HOME): the price function, the
 * Maker reading it, the render endpoint, and the secret.
 *
 *   node scripts/strip/test-strip-home.mjs
 *
 * As in test-strip-page.mjs, the secret grep reads its terms from
 * docs/STRIP-PAGE.md (kept out of the repository) or STRIP_SECRET_TERMS, and
 * says it was skipped rather than passing quietly without them.
 */
import { readFileSync, existsSync } from 'node:fs';
import { stripPrice, stripEth } from '../../strip-price.js';
import { layStrips, layout, RED_LINE } from '../../api/_lib/strip-render.js';
import { GET, POST } from '../../api/strip-render.js';

let pass = 0, fail = 0;
const is = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label.padEnd(74) + (ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`));
  ok ? pass++ : fail++;
};
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const P = (o) => stripPrice(o);

console.log('\n— the price, the worked totals —');
is('80 cm shipped 2,252 · 120 cm 2,928 · 240 cm 5,256', [P({ lengthCm: 80, shipping: true }), P({ lengthCm: 120, shipping: true }), P({ lengthCm: 240, shipping: true })], [2252, 2928, 5256]);
is('framed and shipped: 120 cm 3,428 · 240 cm 6,156', [P({ lengthCm: 120, framed: true, shipping: true }), P({ lengthCm: 240, framed: true, shipping: true })], [3428, 6156]);
is('120 cm at 120 cm wide, shipped: 4,956', P({ lengthCm: 120, widthCm: 120, shipping: true }), 4956);
is('any width to 60 cm is one price', [P({ lengthCm: 120, widthCm: 10 }), P({ lengthCm: 120, widthCm: 60 })], [2028, 2028]);

console.log('\n— the price, as the page opens: collected, Ryan 16 October —');
is('120 × 60, portrait, unframed, collected: 2,028 · 0.41 ETH', [P({ lengthCm: 120 }), stripEth(P({ lengthCm: 120 }))], [2028, 0.41]);
is('slide to 240: 4,056 · black frame: 4,956 · shipped: 6,156', [P({ lengthCm: 240 }), P({ lengthCm: 240, framed: true }), P({ lengthCm: 240, framed: true, shipping: true })], [4056, 4956, 6156]);
is('120 wide at 120 long, collected: 4,056', P({ lengthCm: 120, widthCm: 120 }), 4056);
is('past what it covers, null, never a guess', [P({ lengthCm: 120, widthCm: 130 }), P({ lengthCm: 300, framed: true }), P({ lengthCm: 0 })], [null, null, null]);

console.log('\n— the Maker reads the same function —');
const maker = read('strip-painting-maker.html');
is('it imports strip-price.js and asks it', /from '\/strip-price\.js'/.test(maker) && /stripPrice\(/.test(maker), true);
is('the old tiers, rate and height factor are gone', /rate: (650|800|1000)|Height factor|\$1,000\/m/.test(maker), false);
is('the Maker lays no strip itself: it asks the server, by the millimetre', [/mulberry32|pickColour|layStrips|streamFor|Regenerate/.test(maker), /\/api\/strip-render/.test(maker) && /height_mm/.test(maker)], [false, true]);
is('its dials are the rhythm\'s: strips, vibrancy 1.0 to 1.6, height on the 6 mm grid', [/id="count"/.test(maker), /id="vib" min="1" max="1.6"/.test(maker), /id="height" value="600" min="102" step="6"/.test(maker)], [true, true, true]);

console.log('\n— the rhythm (strip-rhythm-spec) —');
const twelve = Array.from({ length: 12 }, (_, i) => ({ hex: `#${(0x0f0f0f * (i + 1)).toString(16).padStart(6, '0').slice(-6).toUpperCase()}` }));
const L = layout(twelve, 600);
const notRed = L.strips.filter((_, i) => i !== 15);
is('55 strips summing exactly to 600 mm, every one 6, 12 or 24', [L.count, L.strips.reduce((a, x) => a + x.mm, 0), notRed.every((x) => [6, 12, 24].includes(x.mm))], [55, 600, true]);
is('exactly one red strip, 16th from the bottom, 12 mm', [L.strips.filter((x) => x.hex === RED_LINE).length, L.strips[15].hex, L.strips[15].mm], [1, RED_LINE, 12]);
is('the order reverses every twelve: strip i and strip 23 − i are one colour', L.strips.slice(0, 12).every((x, i) => 23 - i === 15 || L.strips[23 - i].hex === x.hex), true);
is('… and the run of 24 repeats up the stack', L.strips.slice(24, 48).every((x, i) => i + 24 === 15 || x.hex === (L.strips[i].hex === RED_LINE ? x.hex : L.strips[i].hex)), true);
const dom = L.strips.filter((x) => x.hex === twelve[0].hex);
is('the dominant colour appears about five times and carries the thick strips', [dom.length >= 4 && dom.length <= 5, dom.filter((x) => x.mm === 24).length >= 3], [true, true]);
const thick = (g) => layout(twelve, 600, { gamma: g }).strips.filter((x, i) => i !== 15 && x.mm === 24).length;
is('punchier vibrancy, more 24 mm blocks (1.0 → 1.6)', thick(1.6) > thick(1.0), true);
const p16 = layout(twelve, 600, { gamma: 1.6 }).strips.filter((_, i) => i !== 15);
is('at 1.6, about 10 thick, 15 medium, 30 thin', [p16.filter((x) => x.mm === 24).length, p16.filter((x) => x.mm === 12).length + 1, p16.filter((x) => x.mm === 6).length], [10, 15, 30]);
is('the same inputs make the same painting, every run', JSON.stringify(layout(twelve, 600, { gamma: 1.3 })) === JSON.stringify(layout(twelve, 600, { gamma: 1.3 })), true);
is('a height off the grid is laid at the nearest 6 mm; a count it cannot hold is cut', [layout(twelve, 550).height, layout(twelve, 300).count, layout(twelve, 100).height, layout(twelve, 100).count, layout(twelve, 100).strips[15].hex], [552, 49, 102, 16, RED_LINE]);

console.log('\n— the render —');
const palettes = JSON.parse(read('data/strip-palettes.json')).palettes;
const designs = JSON.parse(read('data/source/strip-paintings.json')).works.filter((w) => w.group === 'site-design');
is('a palette for every site design, four colours at the least', designs.every((w) => palettes.some((p) => p.work === w.id && p.colours.length >= 4)), true);
const widths = [10, 30, 60, 90, 120];
is('every palette, every width: one red line, 16th, and the strips fill the width on the 6 mm grid',
  palettes.every((p) => widths.every((cm) => { const l = layout(p.colours, cm * 10); return l.strips.filter((x) => x.hex === RED_LINE).length === 1 && l.strips[15].hex === RED_LINE && l.strips.reduce((a, x) => a + x.mm, 0) === l.height && Math.abs(l.height - cm * 10) <= 3; })), true);
const ask = async (q) => { const r = await GET(new Request(`http://localhost:9/api/strip-render?${q}`)); return { r, j: await r.json() }; };
const a = await ask('width=60&palette=site-1');
const b = await ask('width=60&palette=site-1');
is('a palette and a width always give the same painting', JSON.stringify(a.j.strips), JSON.stringify(b.j.strips));
is('… and it is cached, being the same', /s-maxage/.test(a.r.headers.get('cache-control')), true);
is('the page receives a colour and a width per strip, and nothing else', [...new Set(a.j.strips.flatMap((s) => Object.keys(s)))].sort(), ['hex', 'mm']);
const random = await ask('width=60');
is('with no palette, one at random, never cached', [!!random.j.palette.id, random.r.headers.get('cache-control')], [true, 'no-store']);
const others = palettes.slice(1).map((p) => p.id).join(',');
is('… and not one this visitor has just seen', (await ask(`width=60&not=${others}`)).j.palette.id, palettes[0].id);
is('widths outside 10 to 120 cm are refused', [(await ask('width=0')).r.status, (await ask('width=130')).r.status], [400, 400]);
const photo = await POST(new Request('http://x/api/strip-render', { method: 'POST', body: JSON.stringify({ width: 60, colours: ['#112233', '#445566', '#778899', '#AABBCC'].map((hex, i) => ({ hex, w: 4 - i })) }) }));
is('a photograph\'s colours paint too, as palette "photo"', [photo.status, (await photo.json()).palette.id], [200, 'photo']);
const thin = await POST(new Request('http://x/api/strip-render', { method: 'POST', body: JSON.stringify({ width: 60, colours: [{ hex: '#112233', w: 1 }] }) }));
is('… but not from fewer than four', thin.status, 400);

console.log('\n— the home page —');
const home = read('index.html');
is('the home page opens the door from strip-home.js', /import\('\/strip-home\.js'\)/.test(home), true);
is('the site bands are gone from it', /MF\.stripBands|id="stripBands"/.test(home), false);
is('"See the street" goes to the collection page', /href="\/c\/strip-paintings">See the street/.test(home), true);
is('the block opens in landscape, 120 by 60, unframed (Ryan, 16 October)', /length: LEN\.standard, width: WIDTH\.standard, orient: 'landscape', frame: 'none'/.test(read('strip-home.js')), true);
is('NEW COLOURS is a real button, asking for any palette but the one on screen', /<button type="button" class="sh-new" data-new aria-label="New colours">/.test(read('strip-home.js')) && /&not=\$\{encodeURIComponent\(not\)\}/.test(read('strip-home.js')), true);

console.log('\n— the secret stays secret —');
const spec = new URL('../../docs/STRIP-PAGE.md', import.meta.url);
let terms = (process.env.STRIP_SECRET_TERMS || '').split('|').filter(Boolean);
if (!terms.length && existsSync(spec)) {
  const line = readFileSync(spec, 'utf8').split('\n').find((l) => /greps the built page for/.test(l)) || '';
  terms = [...line.slice(line.indexOf('greps the built page for')).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}
if (!terms.length) {
  console.log('  skip the secret grep: no docs/STRIP-PAGE.md here and no STRIP_SECRET_TERMS');
} else {
  /* Everything the home page is made of, and every painting it can be sent. */
  const sent = await Promise.all(palettes.map((p) => ask(`width=60&palette=${p.id}`).then((x) => JSON.stringify(x.j))));
  const bundle = [home, read('strip-home.js'), read('strip-price.js'), read('mintface.js'), read('mintface.css'), ...sent, maker].join('\n');
  is(`none of the ${terms.length} guarded terms is in the home page, its paintings or the Maker`, terms.filter((t) => bundle.includes(t)).length, 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
