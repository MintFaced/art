#!/usr/bin/env node
// Applies data/source/pricing-override.json to catalog.json, the same way the
// full build does, so repricing a collection does not mean re-reading the chain.
// Run the split afterwards.
import { readFileSync, writeFileSync } from 'node:fs';

const src = JSON.parse(readFileSync('data/source/pricing-override.json', 'utf8'));
const per = src.collections || {};
const catalog = JSON.parse(readFileSync('catalog.json', 'utf8'));

let touched = 0;
const report = [];
for (const c of catalog.collections) {
  const p = per[c.slug];
  if (!p) continue;
  let n = 0;
  const was = new Set();
  for (const w of c.works || []) {
    if (w.status !== 'available') continue;
    if (w.pricing_nzd && w.pricing_nzd.digital != null) was.add(w.pricing_nzd.digital);
    w.pricing_nzd = { ...(w.pricing_nzd || {}), digital: p.digital };
    if (p.listed_eth) w.listed_eth = p.listed_eth;
    // these are token only; nothing physical ships with them
    w.offers = { digital: p.digital != null, painting: false, both: false };
    n++;
    touched++;
  }
  report.push({ slug: c.slug, works: n, from: [...was], to: p.digital, eth: p.listed_eth });
}

writeFileSync('catalog.json', JSON.stringify(catalog, null, 1));
console.log(`priced ${touched} available works at ${src.converted_at.rate_nzd_per_eth} NZD/ETH, rounded to the ${src.rounding}\n`);
for (const r of report) {
  const from = r.from.length ? r.from.map((x) => `NZ$${x}`).join(', ') : 'nothing';
  console.log(`  ${r.slug.padEnd(20)} ${String(r.works).padStart(3)} works   ${from} -> NZ$${r.to}  (${r.eth} ETH)`);
}
