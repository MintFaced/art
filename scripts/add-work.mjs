#!/usr/bin/env node
/**
 * Add a painting that is not on chain yet.
 *
 *   node scripts/add-work.mjs
 *
 * Answers six prompts, appends to data/source/recent-work.json, patches
 * catalog.json and rewrites the site data. The work shows as available and
 * says so on the page: not yet minted, tokenized on purchase, which puts the
 * collector's wallet first in the chain record.
 *
 * Images live wherever ASSETS_BASE points (the R2 bucket today). Drop the file
 * there first, then give this script the path inside the bucket, for example
 * recent/2026-still-water.jpg
 */
import fs from 'fs';
import readline from 'readline';
import { execFileSync } from 'child_process';

const ROOT = new URL('../', import.meta.url).pathname;
const SRC = ROOT + 'data/source/recent-work.json';
const CATALOG = ROOT + 'catalog.json';

// keep in step with the one line in mintface.js
const ASSETS_BASE = (fs.readFileSync(ROOT + 'mintface.js', 'utf8')
  .match(/const ASSETS_BASE = '([^']+)'/) || [])[1] || '';

// interactive when run by hand, queue driven when piped
const interactive = process.stdin.isTTY;
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: interactive });
const queue = [];
if (!interactive) {
  for await (const line of rl) queue.push(line);
}
const ask = (q, fallback) => {
  if (!interactive) {
    const a = (queue.shift() || '').trim();
    const v = a || fallback || '';
    console.log(`${q} ${v}`);
    return Promise.resolve(v);
  }
  return new Promise((res) => {
    rl.question(fallback ? `${q} [${fallback}] ` : `${q} `, (a) => res((a || '').trim() || fallback || ''));
  });
};
const num = (v) => (v === '' || v == null ? null : Number(v));

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function main() {
  if (!interactive) console.log('(reading answers from stdin)');
  console.log('\nA new work. Six questions, then it is live on the next push.\n');

  const title = await ask('Title?');
  if (!title) { console.log('No title, nothing added.'); rl.close(); return; }

  const year = await ask('Year?', String(new Date().getFullYear()));
  const medium = await ask('Medium?', 'Acrylic on canvas');
  const dims = await ask('Dimensions, W x H x D in cm?', '');
  const priceLine = await ask('Price in NZD, painting only, or "digital/painting/both"?', '');
  const image = await ask('Image path inside the assets bucket?', `recent/${year}-${slugify(title)}.jpg`);

  const [w, h, d] = dims.split(/[x×,]/).map((x) => num(x.trim()));
  const parts = priceLine.split('/').map((x) => num(x.trim()));
  const pricing = parts.length > 1
    ? { digital: parts[0] ?? null, painting: parts[1] ?? null, both: parts[2] ?? null }
    : { digital: null, painting: parts[0] ?? null, both: null };

  if (ASSETS_BASE && image) {
    const url = `${ASSETS_BASE}/${image}`;
    process.stdout.write(`Checking ${url} ... `);
    try {
      const r = await fetch(url, { method: 'HEAD' });
      console.log(r.ok ? 'found' : `not there yet (${r.status}), adding anyway`);
    } catch (e) {
      console.log('could not reach it, adding anyway');
    }
  }

  const src = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  let id = `recent-${slugify(title)}`;
  let n = 2;
  while (src.works.some((x) => x.id === id)) id = `recent-${slugify(title)}-${n++}`;

  const work = {
    id,
    title,
    year: Number(year) || year,
    medium,
    added: new Date().toISOString().slice(0, 10),
    assets: { image },
    digital: { chain: 'ethereum', standard: 'ERC-721', minted: false, tokenize_on_purchase: true },
    physical: {
      exists: true,
      width_cm: w ?? null,
      height_cm: h ?? null,
      depth_cm: d ?? null,
      ready_to_hang: true,
      framed: false,
      certificate: true,
    },
    pricing_nzd: pricing,
    status: 'available',
  };

  src.works.unshift(work);
  fs.writeFileSync(SRC, JSON.stringify(src, null, 2) + '\n');
  console.log(`\nAdded ${id} to data/source/recent-work.json`);

  // patch catalog.json in place so the site data can be rebuilt without chain access
  const cat = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
  const col = cat.collections.find((c) => c.slug === 'recent-work');
  if (col) {
    const full = {
      ...work,
      collection: 'recent-work',
      edition: { type: '1/1' },
      statement: work.statement || null,
      physical: { packaging: 'Ships boxed/crated, freight included', ...work.physical },
      collector: null,
    };
    col.works = [full, ...(col.works || []).filter((x) => x.id !== id)];
    col.counts = { works: col.works.length, available: col.works.filter((x) => x.status === 'available').length };
    fs.writeFileSync(CATALOG, JSON.stringify(cat, null, 2));
    console.log('Patched catalog.json');
  } else {
    console.log('No recent-work collection in catalog.json, run scripts/catalog/20-build.mjs');
  }

  try {
    execFileSync('node', [ROOT + 'scripts/catalog/30-split.mjs'], { stdio: 'inherit' });
  } catch (e) {
    console.log('Could not rebuild the site data, run scripts/catalog/30-split.mjs yourself');
  }

  console.log(`\nLive at /w/${id} once pushed:\n`);
  console.log(`  git add -A && git commit -m "Add ${title}" && git push\n`);
  rl.close();
}

main();
