#!/usr/bin/env node
/* Reads each site design's render and writes the twelve colours it is painted
 * in, weighted by how much of the painting each one covers, to
 * data/strip-palettes.json. The home page's commission block draws a palette
 * from there on every visit (/api/strip-render).
 *
 * A render is horizontal bands, so each row is one colour: the row's median
 * across the middle of the panel, which steps over any edge or label. Runs of
 * like rows are one band, like bands are one colour, the red line is left out
 * (every painting gets it anyway), and the twelve that cover most are kept.
 *
 *   node scripts/strip/derive-palettes.mjs
 */
import fs from 'node:fs';
import sharp from 'sharp';

const ROOT = new URL('../../', import.meta.url).pathname;
const R = (p) => JSON.parse(fs.readFileSync(ROOT + p, 'utf8'));
const works = R('data/source/strip-paintings.json').works.filter((w) => w.group === 'site-design');
const sites = R('data/strip-sites.json').sites;

const RED = [0xd3, 0x20, 0x11];
const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const hex = (c) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s[s.length >> 1]; };

async function paletteOf(file) {
  const { data, info } = await sharp(ROOT + file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;
  const cols = Array.from({ length: 21 }, (_, i) => Math.round(W * (0.3 + 0.4 * (i / 20))));
  const rows = [];
  for (let y = 0; y < H; y += 1) {
    const px = cols.map((x) => { const i = (y * W + x) * 3; return [data[i], data[i + 1], data[i + 2]]; });
    rows.push([0, 1, 2].map((k) => median(px.map((p) => p[k]))));
  }
  // bands: a run of rows that stay within a JPEG's noise of the run's start
  const bands = [];
  for (const c of rows) {
    const b = bands[bands.length - 1];
    if (b && d2(b.first, c) < 400) { b.n += 1; b.sum = b.sum.map((v, k) => v + c[k]); }
    else bands.push({ first: c, n: 1, sum: c.slice() });
  }
  // colours: like bands together, weighted by the rows they cover
  const colours = [];
  for (const b of bands) {
    if (b.n < 2) continue; // an antialiased seam, not a band
    const c = b.sum.map((v) => v / b.n);
    if (d2(c, RED) < 2500) continue;
    const hit = colours.find((x) => d2(x.rgb, c) < 900);
    if (hit) { hit.rgb = hit.rgb.map((v, k) => (v * hit.n + c[k] * b.n) / (hit.n + b.n)); hit.n += b.n; }
    else colours.push({ rgb: c, n: b.n });
  }
  const top = colours.sort((a, b) => b.n - a.n).slice(0, 12);
  const total = top.reduce((s, x) => s + x.n, 0) || 1;
  return top.map((x) => ({ hex: hex(x.rgb), w: Math.max(1, Math.round((x.n / total) * 100)) }));
}

const palettes = [];
for (const w of works.sort((a, b) => (a.site || 0) - (b.site || 0))) {
  const file = `assets/strip-paintings/${w.assets.image.split('/').pop()}`;
  const site = sites.find((s) => s.work_id === w.id);
  const colours = await paletteOf(file);
  palettes.push({ id: `site-${w.site}`, work: w.id, address: site ? site.address : null, from: file.split('/').pop(), colours });
  console.log(`${w.id.padEnd(22)} ${String(site ? site.address : '-').padEnd(9)} ${colours.length} colours  ${colours.map((c) => `${c.hex}:${c.w}`).join(' ')}`);
}

fs.writeFileSync(`${ROOT}data/strip-palettes.json`, `${JSON.stringify({
  _note: 'The site palettes the home page commission block draws from, one per site design, read off each render by scripts/strip/derive-palettes.mjs: twelve colours at most, weighted by how much of the painting each covers, the red line left out because every painting carries it. Rerun the script when a render changes. The collectors\' palette is not here: /api/strip-render reads it live from the nudges.',
  palettes,
}, null, 1)}\n`);
