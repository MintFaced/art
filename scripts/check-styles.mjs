#!/usr/bin/env node
// jsdom does not do layout, so a missing rule passes every DOM test. This walks
// the classes each page actually uses and checks a rule exists somewhere.
import fs from 'fs';
const ROOT = new URL('../', import.meta.url).pathname;
const shared = fs.readFileSync(ROOT + 'mintface.css', 'utf8');
const pages = ['w.html', 'c.html', 'home.html', 'collections.html', 'geodetic.html', 'vault.html', 'f.html', 'provenance.html', 'exhibitions.html'];
const IGNORE = new Set(['in', 'open', 'stale', 'skel', 'empty', 'single', 'annex']); // state classes toggled at runtime

let bad = 0;
for (const page of pages) {
  const src = fs.readFileSync(ROOT + page, 'utf8');
  const css = shared + '\n' + (src.match(/<style>([\s\S]*?)<\/style>/)?.[1] || '');
  const used = new Set();
  for (const m of src.matchAll(/class="([^"$]*?)"/g)) {
    for (const c of m[1].split(/\s+/)) if (c && !c.includes('${') && !IGNORE.has(c)) used.add(c);
  }
  for (const m of src.matchAll(/classList\.add\('([^']+)'\)/g)) if (!IGNORE.has(m[1])) used.add(m[1]);
  const missing = [...used].filter((c) => !new RegExp('\\.' + c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(css));
  if (missing.length) { bad++; console.log(`${page.padEnd(20)} no rule for: ${missing.join(', ')}`); }
  else console.log(`${page.padEnd(20)} every class has a rule`);
}
console.log(bad ? `\n${bad} page(s) with unstyled classes` : '\nall pages styled');
