#!/usr/bin/env node
// Walks every collection the way the site does and asks whether the URLs it
// would produce actually answer. Catches a mirror that was pointed at the wrong
// key, a stale origin, or a plain http URL that would trip mixed content.
import { readFileSync, readdirSync } from 'node:fs';

const ASSETS = 'https://assets.mintface.art';
const sample = Number(process.env.CHECK_SAMPLE || 0);   // 0 checks everything

const resolve = (w) => {
  const a = w.assets || {};
  const src = w.digital?.image_source;
  const origin = (typeof src === 'string' && /^https?:\/\//.test(src)) ? src : (w.digital?.image || w.image || null);
  return {
    display: a.display ? `${ASSETS}/${a.display}` : null,
    master: a.image ? `${ASSETS}/${a.image}` : origin,
    animation: a.animation ? `${ASSETS}/${a.animation}` : (w.digital?.animation || null),
    origin,
  };
};

const bad = [], mixed = [], missing = [];
let checked = 0, works = 0;

async function head(url) {
  try {
    const r = await fetch(url, { method: 'HEAD', headers: { 'accept-encoding': 'identity' }, signal: AbortSignal.timeout(25000) });
    return r.status;
  } catch (e) { return String(e.name === 'TimeoutError' ? 'timeout' : e.message); }
}

const slugs = readdirSync('data/c').filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));
const queue = [];
for (const slug of slugs) {
  const col = JSON.parse(readFileSync(`data/c/${slug}.json`, 'utf8'));
  let list = col.works || [];
  if (sample) list = list.slice(0, sample);
  for (const w of list) {
    works++;
    const r = resolve(w);
    // what the grid asks for first, and what a work page shows
    const urls = [r.display, r.master].filter(Boolean);
    if (!urls.length && !r.animation) { missing.push(`${slug}/${w.id}`); continue; }
    for (const u of urls) {
      if (u.startsWith('http://')) mixed.push({ id: w.id, url: u });
      queue.push({ slug, id: w.id, url: u });
    }
  }
}

let cursor = 0;
async function lane() {
  while (cursor < queue.length) {
    const job = queue[cursor++];
    const status = await head(job.url);
    checked++;
    if (status !== 200) bad.push({ ...job, status });
  }
}
await Promise.all(Array.from({ length: 16 }, lane));

console.log(`${works} works, ${checked} urls checked`);
console.log(`served from the mirror: ${queue.filter((q) => q.url.startsWith(ASSETS)).length}`);
console.log(`plain http (mixed content): ${mixed.length}`);
console.log(`no image at all: ${missing.length}${missing.length ? ` (${missing.slice(0, 6).join(', ')})` : ''}`);
console.log(`did not answer 200: ${bad.length}`);
const byCol = {};
for (const b of bad) (byCol[b.slug] ||= []).push(b);
for (const [slug, list] of Object.entries(byCol).sort((a, c) => c[1].length - a[1].length)) {
  console.log(`  ${String(list.length).padStart(4)}  ${slug}   e.g. ${list[0].id} ${list[0].status} ${list[0].url.slice(0, 70)}`);
}
process.exit(bad.length ? 1 : 0);
