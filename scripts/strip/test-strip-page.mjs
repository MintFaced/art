#!/usr/bin/env node
/* Strip Paintings slice 2 (docs/STRIP-PAGE.md): the collection page's plates,
 * facts and register, against the acceptance in the doc.
 *
 *   node scripts/strip/test-strip-page.mjs
 *
 * The secret grep reads its terms from docs/STRIP-PAGE.md, which is kept out
 * of the repository on purpose: a public test naming the words it guards
 * would publish them. Without that file (or STRIP_SECRET_TERMS, separated by
 * "|") that one check says it was skipped rather than passing quietly.
 */
import { readFileSync, existsSync } from 'node:fs';
import { planSVG, registerRows, known } from '../../strip-plan.js';
import {
  plateHTML, factsOf, actionOf, editionLine, heroOf, paletteSiteOf, plateTitle,
  STRIP_ETH_NZD, STANDARD_M, fromNZD, ethAtStripRate,
} from '../../strip-plate.js';
import { GET } from '../../api/strip-sites.js';

let pass = 0, fail = 0;
const is = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label.padEnd(72) + (ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`));
  ok ? pass++ : fail++;
};
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const file = JSON.parse(read('data/strip-sites.json'));
const sites = file.sites;
const col = JSON.parse(read('data/c/strip-paintings.json'));
const works = Object.fromEntries(col.works.map((w) => [w.id, w]));
const page = read('c/strip-paintings.html');
const site = (no, patch = {}) => ({ ...sites.find((s) => s.no === no), ...patch });
const specimens = (s, sp) => ({ ...s, specimens: { gallery: null, before: null, after: null, detail: null, ...sp } });

console.log('\n— zero hardcoded site facts —');
/* The page's own markup and script, comments aside, must not know a single
   thing about any one site: every address, building and size arrives from
   the API. */
const bare = page.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
/* a standard panel size is the series' fact (the technical sheet names it),
   even when a site happens to be one */
const standard = STANDARD_M.map((m) => `${m} m × 600 mm`);
const facts = sites.flatMap((s) => [s.address, s.building, standard.includes(s.size) ? null : s.size, s.tenant].filter(Boolean));
is('no address, building, size or tenant is written into the page', facts.filter((f) => bare.includes(f)), []);
const plate = read('strip-plate.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
is('nor into the plate component', facts.filter((f) => plate.includes(f)), []);
is('the page reads the sites from the API', /fetch\('\/api\/strip-sites'\)/.test(page), true);

console.log('\n— plates —');
const plated = sites.filter((s) => s.work_id).map((s) => s.no);
is('a plate for every site with a work, and only those', plated.length > 0 && plated.every((n) => sites.find((s) => s.no === n).work_id), true);
const five = site(5);
is('site 5 has no work, so no plate', five.work_id, null);
is('… but it is in the register', registerRows(sites).some((r) => r.no === '05' && r.address === five.address), true);
is('the register lists every site, plated or not', registerRows(sites).length, sites.length);

const one = specimens(site(1), { gallery: 'k/g.jpg', before: 'k/b.jpg', after: 'k/a.jpg', detail: 'k/d.jpg' });
const h1 = plateHTML(one, works[one.work_id]);
is('site 1 with both photographs: a slider', [h1.includes('data-ba'), h1.includes('type="range"')], [true, true]);
is('… the After over the Before, both from R2', [h1.indexOf('k/b.jpg') < h1.indexOf('k/a.jpg'), h1.includes('https://assets.mintface.art/k/a.jpg')], [true, true]);
is('… labelled After, Drag, Before', /After<\/span><label[^>]*>Drag<\/label>[\s\S]*Before<\/span>/.test(h1), true);
is('… gallery, slider and detail make three figures', (h1.match(/<figure/g) || []).length, 3);
is('… and the plate is headed "No. 1 · <address>"', h1.includes(`>${plateTitle(one)}</h3>`), true);
is('… with the status line from the file', h1.includes(`>${one.status} · ${one.building}</p>`), true);

const two = specimens(site(2), { gallery: 'k/g2.jpg', before: 'k/b2.jpg' });
const h2 = plateHTML(two, works[two.work_id]);
is('site 2 with gallery and before only: no slider', [h2.includes('data-ba'), h2.includes('type="range"')], [false, false]);
is('… the before shown plain, with its label', [h2.includes('ph-before'), h2.includes('<figcaption>Before</figcaption>')], [true, true]);
is('… beside the gallery photograph', h2.includes('ph-gallery'), true);
const none = plateHTML(specimens(site(3), {}), works[site(3).work_id]);
is('no photographs: no figures at all, never an empty frame', none.includes('<figure'), false);
is('a work renders its band', none.includes('class="plate-band"'), true);
is('no data URIs anywhere in a plate', [h1, h2, none].some((h) => h.includes('data:')), false);

console.log('\n— the acceptance, on the real file —');
is('ten sites', sites.length, 10);
const real = (no) => plateHTML(site(no), works[site(no).work_id]);
is('site 1: Before and After, so a slider', [!!site(1).work_id, real(1).includes('type="range"')], [true, true]);
is('site 2: gallery and before, no slider', [!!site(2).work_id, real(2).includes('ph-gallery'), real(2).includes('ph-before'), real(2).includes('type="range"')], [true, true, true, false]);
is('site 5: no work, so a register row only', [site(5).work_id, registerRows(sites).some((r) => r.no === '05')], [null, true]);
is('site 5\'s After is a mockup, and the register says so', registerRows(sites).find((r) => r.no === '05').specimens, 'BEFORE · AFTER (MOCKUP)');
is('every specimen key is an R2 key, never a data URI or a local path', sites.every((s) => Object.entries(s.specimens).every(([k, v]) => k === 'after_is_mockup' || v == null || /^strip(-paintings)?\//.test(v))), true);
is('no placeholder survives into the file', JSON.stringify(sites).includes('[SIZE]'), false);

console.log('\n— facts and actions —');
const f = (s, o) => Object.fromEntries(factsOf(s, works[s.work_id], o));
is('a priced site: NZD, then ETH at the fixed rate, then USD', f(site(1, { price: { nzd: 1800 }, sale_state: 'for_sale' }), { usd: 0.6 }).Price,
  `NZ$1,800 · 0.36 ETH at ${STRIP_ETH_NZD.toLocaleString('en-NZ')} NZD per ETH · US$1,080`);
is('no price: the sale state\'s word', [f(site(1, { sale_state: 'on_building' })).Price, f(site(1, { sale_state: 'collected' })).Price, f(site(1, { sale_state: 'not_for_sale' })).Price],
  ['On a building', 'Collected', 'Not for sale']);
is('no price and no sale state: no price fact, nothing invented', 'Price' in f(site(1, { price: { nzd: null }, sale_state: null })), false);
is('no size on file: no size fact', 'Size' in f(site(3, { size: null })), false);
is('panels join the size when known', f(site(1, { panels: 3 })).Size, `${site(1).size} · 3 panels`);
is('for_sale and priced: COLLECT, into the existing checkout on the work page', actionOf(site(1, { sale_state: 'for_sale', price: { nzd: 3600 } })), { label: 'Collect', href: '/w/strip-painting-site-1', button: true });
is('for_sale with no price yet: no button, the facts say "For sale"', [actionOf(site(1, { sale_state: 'for_sale', price: { nzd: null } })), f(site(1, { sale_state: 'for_sale', price: { nzd: null } })).Price], [null, 'For sale']);
is('rental_only: "Available to rent"', actionOf(site(1, { sale_state: 'rental_only' })).label, 'Available to rent');
is('anything else: no action', [null, 'on_building', 'collected', 'not_for_sale'].map((x) => actionOf(site(1, { sale_state: x }))), [null, null, null, null]);
is('no edition line until the tokens exist', [editionLine(site(1)), editionLine(site(1, { edition: { contract: '0x1', tokens: null } }))], [null, null]);
const ed = editionLine(site(1, { edition: { contract: '0xabc', tokens: [1, 2, 3] } }));
is('then: estate, for sale, gifted to the tenant', [ed.text, ed.parts[0].text, ed.parts[1].link.label, ed.parts[2].text],
  ['Photograph edition of 3', '1/3 mintestate.eth', 'Collect →', '3/3 gifted to the tenant']);
is('commission from 1.2 m at NZ$1,500 a metre: 1,800 and 0.36 ETH', [fromNZD(), ethAtStripRate(fromNZD())], [1800, 0.36]);

console.log('\n— hero and palette —');
is('the hero is the first After there is', heroOf([specimens(site(3), { after: 'k/a3.jpg' }), specimens(site(1), { gallery: 'k/g.jpg' })]).key, 'k/a3.jpg');
is('until there is one, the first gallery photograph', heroOf(sites).kind, sites.some((s) => s.specimens.after) ? 'after' : 'gallery');
is('with no photographs at all, the first painting', heroOf([specimens(site(1), {})], works).kind, 'render');
is('the palette beside the method is the first site that has one', paletteSiteOf([site(2, { palette: ['#000000'] }), site(1)]).no, 2);

console.log('\n— placeholders and mockups —');
is('a bracketed placeholder is no value', [known('[SIZE]'), known(' [PRICE] '), known('2.4 m × 600 mm')], [null, null, '2.4 m × 600 mm']);
is('… so "[SIZE]" never reaches the facts row', 'Size' in f(site(3, { size: '[SIZE]' })), false);
is('… nor the register', registerRows([site(3, { size: '[SIZE]' })])[0].size, null);
is('a size that already counts its panels is not counted twice', f(site(3, { size: '2 × 2.4 m × 600 mm', panels: 2 })).Size, '2 × 2.4 m × 600 mm');
is('one panel is not "1 panels"', f(site(3, { size: '1.2 m × 600 mm', panels: 1 })).Size, '1.2 m × 600 mm');
const mock = specimens(site(1), { before: 'k/b.jpg', after: 'k/m.jpg', after_is_mockup: true });
is('a mocked-up After never leads the page', heroOf([mock, specimens(site(2), { gallery: 'k/g2.jpg' })]).key, 'k/g2.jpg');
is('… and says MOCKUP on the picture and under it', [plateHTML(mock, works[mock.work_id]).includes('class="ph-mock"'), plateHTML(mock, works[mock.work_id]).includes('After · mockup')], [true, true]);
const alone = specimens(site(1), { after: 'k/m.jpg', after_is_mockup: true });
is('… alone too', plateHTML(alone, works[alone.work_id]).includes('<figcaption>After · mockup</figcaption>'), true);
is('the register calls it a mockup', registerRows([mock])[0].specimens, 'BEFORE · AFTER (MOCKUP)');
const sparse = { no: 11, address: '1 Test St', street: 'Heretaunga St W', side: 'north', building: 'Test', status: 'proposed', specimens: { before: 'k/b.jpg' }, work_id: 'strip-painting-site-1' };
is('a site missing the optional fields still draws', (() => { try { return plateHTML(sparse, works[sparse.work_id]).includes('plate-11'); } catch { return false; } })(), true);

console.log('\n— the API carries the tiles and the links —');
const api = await (await GET()).json();
is('exhibited: three tiles', api.exhibited.length, 3);
is('a tile without a picture has no image key (the page labels it)', api.exhibited.filter((t) => !t.image).every((t) => t.name), true);
is('links for later slices are null until they exist', Object.keys(api.links).sort(), ['dossier', 'rent', 'technical_sheet']);

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
  /* Everything the page is made of, and everything it says once it has run:
     its markup and modules, the API's JSON, every plate with every field
     filled, the plan, the catalog record, the agents' file and the OG code. */
  const full = sites.map((s) => plateHTML(specimens({ ...s, price: { nzd: 3600 }, sale_state: 'for_sale', edition: { contract: '0xabc', tokens: [1, 2, 3] } },
    { gallery: 'k/g.jpg', before: 'k/b.jpg', after: 'k/a.jpg', detail: 'k/d.jpg' }), works[s.work_id], { usd: 0.6 })).join('');
  const built = [page, read('strip-plate.js'), read('strip-plan.js'), JSON.stringify(api), full, planSVG(sites),
    JSON.stringify(col), read('llms.txt'), read('api/og.js')].join('\n');
  is(`none of the ${terms.length} guarded terms appears in the built page`, terms.filter((t) => built.includes(t)).length, 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
