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
is('ten sites, numbered 1 to 10', sites.map((s) => s.no), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
is('status is only ever installed, approved or proposed', sites.every((s) => ['installed', 'approved', 'proposed'].includes(s.status)), true);
is('odd numbers on the north side, even on the south (King St apart)', sites.filter((s) => s.side !== 'king').every((s) => (numberOf(s) % 2 === 1) === (s.side === 'north')), true);
is('every field the doc names is present on every site', sites.every((s) => ['no', 'address', 'street', 'side', 'building', 'tenant', 'fascia_m', 'panels', 'size', 'status', 'installed_at', 'work_id', 'specimens', 'palette', 'price', 'sale_state', 'edition', 'lat', 'lng', 'notes'].every((k) => k in s)), true);

console.log('\n— counts, computed —');
is('1 installed, 2 approved, 7 proposed', counts(sites), { installed: 1, approved: 2, proposed: 7, total: 10 });
is('the count line', countLine(sites), '1 INSTALLED · 2 APPROVED · 7 PROPOSED');
is('and on a phone it says to scroll', countLine(sites, { scroll: true }).endsWith('SCROLL →'), true);

console.log('\n— the plan —');
const L = layout(sites);
const at = (n) => L.find((p) => numberOf(p.site) === n);
const street = L.filter((p) => p.kind === 'street').sort((a, b) => a.cx - b.cx).map((p) => numberOf(p.site));
is('numbers descend left to right, 402 first and 221 last', [street[0], street[street.length - 1], street.slice().sort((a, b) => b - a).join()], [402, 221, street.join()]);
const kingX = 760;
is('King Street cuts between the 300s and the 200s (311 and 230)', at(320).cx < kingX && at(311).cx < kingX && at(230).cx > kingX + 44, true);
const seven = L.find((p) => p.site.no === 7);
is('site 7 (118) is on King Street', [seven.kind, seven.bar.x >= kingX + 44], ['king', true]);
is('north of Heretaunga, its bar along King Street', [seven.bar.y + seven.bar.h <= 150, seven.bar.h > seven.bar.w], [true, true]);
is('north sites above the street, south below', L.filter((p) => p.kind === 'street').every((p) => (p.north ? p.bar.y + p.bar.h <= 150 : p.bar.y >= 210)), true);
is('a bar is as wide as its fascia: 6.0 m is 150 px, unknown is 1.2 m (30 px)', [at(320).bar.w, at(350).bar.w], [150, 30]);
const svg = planSVG(sites);
is('installed solid, approved an ink outline, proposed grey dashed', [
  /data-no="1"[^>]*><rect[^>]*fill="#141414"/.test(svg),
  /data-no="2"[^>]*><rect[^>]*fill="none" stroke="#141414"/.test(svg),
  /data-no="5"[^>]*><rect[^>]*stroke-dasharray="4 3"/.test(svg),
], [true, true, true]);
is('the legend says the three words', ['>INSTALLED<', '>APPROVED<', '>PROPOSED<'].every((w) => svg.includes(w)), true);
is('no colour but ink, grey, street and paper', [...new Set(svg.match(/#[0-9A-Fa-f]{6}/g))].sort(), ['#141414', '#6B6A64', '#C9C6BC', '#EEECE4', '#F8F7F3'].sort());
for (const north of [true, false]) {
  const side = L.filter((p) => p.kind === 'street' && p.north === north).sort((a, b) => a.cx - b.cx);
  let clash = false;
  for (let i = 1; i < side.length; i += 1) if (side[i].tier === side[i - 1].tier && side[i].cx - side[i - 1].cx < 110) clash = true;
  is(`${north ? 'north' : 'south'} labels never sit on top of each other`, clash, false);
}
const still = planSVG(sites, { interactive: false });
is('the dossier\'s static plan has no hover and no focus', [/tabindex|<style>/.test(still), still.includes('data-no=')], [false, false]);

console.log('\n— an eleventh site, with no code change —');
const ten = { no: 11, address: '300 West', street: 'Heretaunga St W', side: 'south', building: 'A test building', tenant: null, tenant_public: false, fascia_m: 3.0, panels: null, size: '3.0 m × 600 mm', status: 'proposed', installed_at: null, work_id: null, specimens: { gallery: null, before: null, after: null, detail: null }, palette: null, price: { nzd: null }, sale_state: null, edition: null, lat: null, lng: null, notes: null };
const more = [...sites, ten];
is('it is on the plan', planSVG(more).includes('data-no="11"'), true);
is('in the register', registerRows(more).map((r) => r.no).includes('11'), true);
is('and in the counts', counts(more), { installed: 1, approved: 2, proposed: 8, total: 11 });
is('placed on the south side between 320 and King Street', (() => { const l = layout(more); const p = l.find((q) => q.site.no === 11); return [p.north, p.cx > l.find((q) => q.site.no === 1).cx, p.cx < kingX]; })(), [false, true, true]);
is('through the API as well', publicSites({ sites: more }).length, 11);

console.log('\n— the API —');
const r = await GET();
const j = await r.json();
is('serves the sites and the counts, public and cached', [r.status, j.counts, j.sites.length, /public/.test(r.headers.get('cache-control'))], [200, { installed: 1, approved: 2, proposed: 7, total: 10 }, 10, true]);
is('editorial notes stay out of it', JSON.stringify(j).includes('"notes"'), false);
const withTenant = publicSites({ sites: [{ ...ten, tenant: 'Private Co', tenant_public: false }, { ...ten, no: 12, tenant: 'Public Co', tenant_public: true }] });
is('a tenant is named only where agreed', withTenant.map((s) => s.tenant), [null, 'Public Co']);
const vercel = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
is('and the raw file is not served past it', vercel.redirects.some((x) => x.source === '/data/strip-sites.json' && x.destination === '/api/strip-sites'), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
