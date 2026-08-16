#!/usr/bin/env node
// Points the catalog at the mirror. The warm run fills R2 and the derive run
// makes display copies, but neither tells the site they exist. This walks what
// is actually in the bucket, checks each object is really there and really an
// image, and writes the key onto the work. Anything that fails a check keeps
// its origin URL and is listed in the report.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

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
    // ask for it uncompressed, or the CDN brotlis anything text shaped and
    // drops content-length, which reads as an empty file
    const r = await fetch(`${PUBLIC}/${key}`, { method: 'HEAD', headers: { 'accept-encoding': 'identity' } });
    // the listing is the uncompressed truth, the header is the confirmation
    const len = Number(r.headers.get('content-length') || 0) || inBucket.get(key) || 0;
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

const report = { patched: [], partial: [], untouched: [], rejected: [], withDisplay: [] };
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
    if (!Object.keys(found).length) { report.untouched.push({ id, slug, work: w, src: w.digital?.image_source || w.digital?.image || w.image || null }); continue; }
    w.assets = { ...(w.assets || {}), ...found };
    if (found.display) report.withDisplay.push(id);
    // a display copy without its master is fine, the origin is still the truth
    if (found.image || found.animation) report.patched.push(id);
    else report.partial.push(id);
  }
}
await Promise.all(Array.from({ length: 12 }, lane));

// Editions collapse in the split, so the warm run only ever saw one work per
// set and keyed it under a synthetic id that does not exist in the catalog.
// The members are the same file at the same URL, which is why they collapsed,
// so match them on that URL rather than on an id that was never shared.
const originToAssets = new Map();
const splitJobs = [];
for (const slug of readdirSync('data/c').filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''))) {
  let split;
  try { split = JSON.parse(readFileSync(`data/c/${slug}.json`, 'utf8')); } catch { continue; }
  for (const sw of split.works || []) {
    const src = sw.digital?.image_source || sw.digital?.image || sw.image;
    if (typeof src === 'string') splitJobs.push({ slug, id: sw.id, src });
  }
}
let splitCursor = 0;
async function splitLane() {
  while (splitCursor < splitJobs.length) {
    const { slug, id, src } = splitJobs[splitCursor++];
    if (originToAssets.has(src)) continue;
    const found = {};
    for (const [field, kind] of [['display', 'display'], ['image', 'image']]) {
      const key = findKey(slug, id, kind);
      if (key && (await verify(key)).ok) found[field] = key;
    }
    if (Object.keys(found).length && !originToAssets.has(src)) originToAssets.set(src, found);
  }
}
await Promise.all(Array.from({ length: 16 }, splitLane));

let shared = 0;
for (const u of report.untouched) {
  const assets = u.src ? originToAssets.get(u.src) : null;
  if (!assets) continue;
  u.work.assets = { ...(u.work.assets || {}), ...assets };
  u.shared = true;
  shared++;
}
report.untouched = report.untouched.filter((u) => !u.shared);
console.log(`${shared} edition members pointed at the file their set already mirrors`);

const dry = process.argv.includes('--dry');
if (!dry) writeFileSync('catalog.json', JSON.stringify(catalog, null, 1));
else console.log('dry run, catalog not written');
if (!dry) writeFileSync('docs/ASSETS-REPORT.json', JSON.stringify({
  bucket_objects: inBucket.size,
  bucket_bytes: listing.bytes,
  works_considered: jobs.length,
  patched: report.patched.length,
  with_display_copy: report.withDisplay.length,
  display_only: report.partial.length,
  shared_with_edition_sibling: shared,
  untouched: report.untouched.length,
  untouched_by_collection: report.untouched.reduce((a, u) => { a[u.slug] = (a[u.slug] || 0) + 1; return a; }, {}),
  untouched_sample: report.untouched.slice(0, 30).map((u) => ({ id: u.id, src: String(u.src).slice(0, 90) })),
  rejected: report.rejected.length,
  rejected_detail: report.rejected.slice(0, 60),
}, null, 1));

console.log(`patched ${report.patched.length} (${report.withDisplay.length} with a display copy), display only ${report.partial.length}, untouched ${report.untouched.length}, rejected ${report.rejected.length}`);
for (const r of report.rejected.slice(0, 10)) console.log(`  reject ${r.key} ... ${r.why}`);
const byCol = report.untouched.reduce((a, u) => { a[u.slug] = (a[u.slug] || 0) + 1; return a; }, {});
console.log('untouched by collection:');
for (const [k, v] of Object.entries(byCol).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);
