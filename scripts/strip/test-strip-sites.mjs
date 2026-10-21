#!/usr/bin/env node
/* Strip Paintings slice 1 (docs/STRIP-MAP.md): the sites file, the counts,
 * the plan and the API, against the acceptance in the doc.
 *
 *   node scripts/strip/test-strip-sites.mjs
 */
import { readFileSync } from 'node:fs';
import { counts, countLine, layout, planSVG, registerRows, numberOf } from '../../strip-plan.js';
import { publicSites, GET } from '../../api/strip-sites.js';

let pass = 0, fail = 0;
const is = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label.padEnd(70) + (ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`));
  ok ? pass++ : fail++;
};
const file = JSON.parse(readFileSync(new URL('../../data/strip-sites.json', import.meta.url), 'utf8'));
const sites = file.sites;

console.log('\n— the file —');
is('twelve sites, numbered 1 to 12', sites.map((s) => s.no), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
is('status is only ever installed, approved or proposed', sites.every((s) => ['installed', 'approved', 'proposed'].includes(s.status)), true);
/* 328 West is on the north side although its number is even (Ryan, 15 October). */
is('odd numbers on the north side, even on the south (King St and 328 apart)', sites.filter((s) => s.side !== 'king' && numberOf(s) !== 328).every((s) => (numberOf(s) % 2 === 1) === (s.side === 'north')), true);
is('every field the doc names is present on every site', sites.every((s) => ['no', 'address', 'street', 'side', 'building', 'tenant', 'fascia_m', 'panels', 'size', 'status', 'installed_at', 'work_id', 'specimens', 'palette', 'price', 'sale_state', 'edition', 'lat', 'lng', 'notes'].every((k) => k in s)), true);

console.log('\n— counts, computed —');
is('5 installed, 1 approved, 6 proposed', counts(sites), { installed: 5, approved: 1, proposed: 6, total: 12 });
is('the count line', countLine(sites), '5 INSTALLED · 1 APPROVED · 6 PROPOSED');
is('and on a phone it says to scroll', countLine(sites, { scroll: true }).endsWith('SCROLL →'), true);

console.log('\n— the plan —');
const L = layout(sites);
const at = (n) => L.find((p) => numberOf(p.site) === n);
const street = L.filter((p) => p.kind === 'street').sort((a, b) => a.cx - b.cx).map((p) => numberOf(p.site));
is('numbers descend left to right, 402 first and 221 last', [street[0], street[street.length - 1], street.slice().sort((a, b) => b - a).join()], [402, 221, street.join()]);
const kingX = 760;
is('King Street cuts between the 300s and the 200s (311 and 230)', at(320).cx < kingX && at(311).cx < kingX && at(230).cx > kingX + 44, true);
const king = L.find((p) => p.site.no === 11);
is('site 11 (118) is on King Street', [king.kind, king.bar.x >= kingX + 44], ['king', true]);
is('north of Heretaunga, its bar along King Street', [king.bar.y + king.bar.h <= 150, king.bar.h > king.bar.w], [true, true]);
is('328 sits on the north side', at(328).north, true);
const lane = L.find((p) => p.site.no === 5);
const table = L.find((p) => p.site.no === 4);
is('300 West is up the laneway, straight above 328', [lane.kind, lane.cx, lane.bar.y + lane.bar.h < at(328).bar.y], ['lane', at(328).cx, true]);
is('… its box\'s top level with the top of King Street', lane.bar.y, 40);
is('the Coffee Stop table is in the same lane, a row nearer the street (lane_row 1)', [table.kind, table.cx, table.bar.y, table.bar.y + table.bar.h < at(328).bar.y], ['lane', at(328).cx, 64, true]);
is('… and it is not counted into the Heretaunga spread', L.filter((p) => p.kind === 'street').length, sites.filter((s) => s.side !== 'king' && s.side !== 'lane').length);
is('north sites above the street, south below', L.filter((p) => p.kind === 'street').every((p) => (p.north ? p.bar.y + p.bar.h <= 150 : p.bar.y >= 210)), true);
is('a bar is as wide as its fascia: 6.0 m is 150 px, unknown is 1.2 m (30 px)', [at(320).bar.w, at(350).bar.w], [150, 30]);
const svg = planSVG(sites);
/* Pandit (No. 8 since 21 October, 311 West) was approved on 18 October */
is('installed solid, approved an ink outline, proposed grey dashed', [
  /data-no="2"[^>]*><rect[^>]*fill="#141414"/.test(svg),
  /data-no="8"[^>]*><rect[^>]*fill="none" stroke="#141414"/.test(svg),
  /data-no="9"[^>]*><rect[^>]*stroke-dasharray="4 3"/.test(svg),
], [true, true, true]);
is('the laneway and its table are installed, so solid ink', [5, 4].map((n) => new RegExp(`data-no="${n}"[^>]*><rect[^>]*fill="#141414"`).test(svg)), [true, true]);
is('the legend says the three words', ['>INSTALLED<', '>APPROVED<', '>PROPOSED<'].every((w) => svg.includes(w)), true);
is('no colour but ink, grey, street and paper', [...new Set(svg.match(/#[0-9A-Fa-f]{6}/g))].sort(), ['#141414', '#6B6A64', '#C9C6BC', '#EEECE4', '#F8F7F3'].sort());
for (const north of [true, false]) {
  const side = L.filter((p) => p.kind === 'street' && p.north === north).sort((a, b) => a.cx - b.cx);
  let clash = false;
  for (let i = 1; i < side.length; i += 1) if (side[i].tier === side[i - 1].tier && side[i].cx - side[i - 1].cx < 110) clash = true;
  is(`${north ? 'north' : 'south'} labels never sit on top of each other`, clash, false);
}
/* Each lane box and its one-line label beside it (number and a name at its
   widest, sixteen characters), against every north label on whichever tier
   it landed, and against each other. */
const areaOf = (q) => ({ x0: q.bar.x, x1: q.bar.x + q.bar.w + 10 + 20 * 7.9, y0: q.bar.y - 2, y1: q.bar.y + q.bar.h + 2 });
const overlap = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
const hits = L.filter((p) => p.kind === 'street' && p.north).filter((p) => {
  const base = p.bar.y - 8 - p.tier * 38;
  const box = { x0: p.cx - 8 * 7.9, x1: p.cx + 8 * 7.9, y0: base - 30, y1: base + 3 };
  return [lane, table].some((q) => overlap(areaOf(q), box));
}).map((p) => numberOf(p.site));
is('the laneway, its table and their labels clear every north label', hits, []);
is('… and each other', overlap(areaOf(lane), areaOf(table)), false);
const still = planSVG(sites, { interactive: false });
is('the dossier\'s static plan has no hover and no focus', [/tabindex|<style>/.test(still), still.includes('data-no=')], [false, false]);

console.log('\n— a thirteenth site, with no code change —');
const ten = { no: 13, address: '302 West', street: 'Heretaunga St W', side: 'south', building: 'A test building', tenant: null, tenant_public: false, fascia_m: 3.0, panels: null, size: '3.0 m × 600 mm', status: 'proposed', installed_at: null, work_id: null, specimens: { gallery: null, before: null, after: null, detail: null }, palette: null, price: { nzd: null }, sale_state: null, edition: null, lat: null, lng: null, notes: null };
const more = [...sites, ten];
is('it is on the plan', planSVG(more).includes('data-no="13"'), true);
is('in the register', registerRows(more).map((r) => r.no).includes('13'), true);
is('and in the counts', counts(more), { installed: 5, approved: 1, proposed: 7, total: 13 });
is('placed on the south side between 320 and King Street', (() => { const l = layout(more); const p = l.find((q) => q.site.no === 13); return [p.north, p.cx > l.find((q) => q.site.no === 1).cx, p.cx < kingX]; })(), [false, true, true]);
is('through the API as well', publicSites({ sites: more }).length, 13);

console.log('\n— the API —');
const r = await GET();
const j = await r.json();
is('serves the sites and the counts, public and cached', [r.status, j.counts, j.sites.length, /public/.test(r.headers.get('cache-control'))], [200, { installed: 5, approved: 1, proposed: 6, total: 12 }, 12, true]);
is('editorial notes stay out of it', JSON.stringify(j).includes('"notes"'), false);
const withTenant = publicSites({ sites: [{ ...ten, tenant: 'Private Co', tenant_public: false }, { ...ten, no: 14, tenant: 'Public Co', tenant_public: true }] });
is('a tenant is named only where agreed', withTenant.map((s) => s.tenant), [null, 'Public Co']);
const vercel = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
is('and the raw file is not served past it', vercel.redirects.some((x) => x.source === '/data/strip-sites.json' && x.destination === '/api/strip-sites'), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
