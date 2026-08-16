#!/usr/bin/env node
// Points the catalog at the mirror. The warm run fills R2 and the derive run
// makes display copies, but neither tells the site they exist. This walks what
// is actually in the bucket, checks each object is really there and really an
// image, and writes the key onto the work. Anything that fails a check keeps
// its origin URL and is listed in the report.
import { readFileSync, writeFileSync } from 'node:fs';

const PUBLIC = process.env.ASSETS_PUBLIC_BASE || 'https://assets.mintface.art';
const ORIGIN = process.env.SEAL_ORIGIN || 'https://art-git-rebuild-mintfaceds-projects.vercel.app';
const KEY = process.env.WARM_KEY || readFileSync('/tmp/warmkey.txt', 'utf8').trim();
const MIN_BYTES = 1024;
const OK_TYPE = /^(image|video)\//;

const listing = await fetch(`${ORIGIN}/api/warm-assets?key=${KEY}&list=1&keys=1`).then((r) => r.json());
if (!listing.keys) throw new Error('no listing came back');
const inBucket = new Map();
for (const line of listing.keys) {
  const i = line.lastIndexOf(' ');
  inBucket.set(line.slice(0, i), Number(line.slice(i + 1)));
}
console.log(`bucket holds ${inBucket.size} objects`);

// one HEAD per key we intend to write, run a few at a time
const checked = new Map();
async function verify(key) {
  if (checked.has(key)) return checked.get(key);
  let out = { ok: false, why: 'not checked' };
  try {
    const r = await fetch(`${PUBLIC}/${key}`, { method: 'HEAD' });
    const len = Number(r.headers.get('content-length') || 0);
    const type = (r.headers.get('content-type') || '').split(';')[0];
    if (!r.ok) out = { ok: false, why: `HEAD ${r.status}` };
    else if (!(len > MIN_BYTES)) out = { ok: false, why: `only ${len} bytes` };
    else if (!OK_TYPE.test(type)) out = { ok: false, why: `content-type ${type || 'missing'}` };
    else out = { ok: true, bytes: len, type };
  } catch (e) { out = { ok: false, why: String(e.message || e) }; }
  checked.set(key, out);
  return out;
}

const EXTS = ['jpg', 'png', 'svg', 'webp', 'gif', 'tif', 'avif', 'mp4', 'webm', 'mov'];
const findKey = (slug, id, kind) => {
  for (const ext of EXTS) {
    const k = `${slug}/${id}-${kind}.${ext}`;
    if (inBucket.has(k)) return k;
  }
  return null;
};

const catalog = JSON.parse(readFileSync('catalog.json', 'utf8'));
const jobs = [];
for (const col of catalog.collections) {
  const lists = [col.works || [], ...(col.children || []).map((ch) => ch.works || [])];
  for (const works of lists) {
    for (const w of works) {
      const id = w.id || `${col.slug}-${w.digital?.token_id || 'x'}`;
      jobs.push({ w, slug: col.slug, id });
    }
  }
}
console.log(`${jobs.length} works to consider`);

const report = { patched: [], partial: [], untouched: [], rejected: [] };
let cursor = 0;
async function lane() {
  while (cursor < jobs.length) {
    const { w, slug, id } = jobs[cursor++];
    const found = {};
    for (const [field, kind] of [['display', 'display'], ['image', 'image'], ['animation', 'animation']]) {
      const key = findKey(slug, id, kind);
      if (!key) continue;
      const v = await verify(key);
      if (v.ok) found[field] = key;
      else report.rejected.push({ id, key, why: v.why });
    }
    if (!Object.keys(found).length) { report.untouched.push(id); continue; }
    w.assets = { ...(w.assets || {}), ...found };
    // a display copy without its master is fine, the origin is still the truth
    if (found.image) report.patched.push(id);
    else report.partial.push(id);
  }
}
await Promise.all(Array.from({ length: 12 }, lane));

writeFileSync('catalog.json', JSON.stringify(catalog, null, 1));
writeFileSync('docs/ASSETS-REPORT.json', JSON.stringify({
  bucket_objects: inBucket.size,
  bucket_bytes: listing.bytes,
  works_considered: jobs.length,
  patched: report.patched.length,
  display_only: report.partial.length,
  untouched: report.untouched.length,
  rejected: report.rejected.length,
  rejected_detail: report.rejected.slice(0, 60),
}, null, 1));

console.log(`patched ${report.patched.length}, display only ${report.partial.length}, untouched ${report.untouched.length}, rejected ${report.rejected.length}`);
for (const r of report.rejected.slice(0, 10)) console.log(`  reject ${r.key} ... ${r.why}`);
