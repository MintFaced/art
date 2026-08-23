#!/usr/bin/env node
/* Give every collection card a thumbnail that actually resolves.
 *
 * A card with no cover renders as an empty box, which reads as a broken
 * collection rather than a quiet one. The rule is the site's own: prefer a work
 * that is available, since a card is an invitation before it is a record; fall
 * back to the strongest clean image otherwise, which is what an archive will
 * always need.
 *
 * "Clean" here means the image answers. Nothing is chosen sight unseen: every
 * candidate is fetched before it is written, and a collection with no working
 * image anywhere is reported rather than given a cover that will not load.
 *
 *   node scripts/fix-collection-covers.mjs --dry
 *   node scripts/fix-collection-covers.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DRY = process.argv.includes('--dry');
const ASSETS = 'https://assets.mintface.art';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function alive(u) {
  if (!u) return false;
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(u, { method: 'HEAD' });
      if (r.status === 200) return true;
      if (r.status === 404 || r.status === 403) return false;
    } catch (e) { /* ask again */ }
    await sleep(300);
  }
  return false;
}
const SITE = 'https://mintface.art';
const mirrored = (w) => (w.assets && (w.assets.display || w.assets.image)) || null;
// a few works are served from the repo itself, so a leading slash is a real
// image and not a missing one
const absolute = (u) => (typeof u === 'string' && u.startsWith('/') ? `${SITE}${u}` : u);
const urlOf = (w) => {
  const m = mirrored(w);
  return m ? `${ASSETS}/${m}` : absolute((w.digital && w.digital.image) || w.image || null);
};
const coverUrl = (c) => {
  if (!c.cover) return null;
  const a = c.cover.assets && (c.cover.assets.display || c.cover.assets.image);
  return a ? `${ASSETS}/${a}` : absolute(c.cover.image || null);
};

const idxPath = path.join(ROOT, 'data/index.json');
const raw = fs.readFileSync(idxPath, 'utf8');
const idx = JSON.parse(raw);
const report = [];

for (const c of idx.collections) {
  if (await alive(coverUrl(c))) continue;                 // already fine

  let col = null;
  try { col = JSON.parse(fs.readFileSync(path.join(ROOT, `data/c/${c.slug}.json`), 'utf8')); }
  catch (e) { report.push({ slug: c.slug, why: 'no collection file' }); continue; }

  const works = (col.works || []).filter((w) => w.status !== 'burned');
  // available first, then whatever is left; a mirrored copy beats an origin
  // a recovered image is one we have already proven answers, so it ranks with
  // the mirrored copies rather than with the untested origins
  const good = (w) => Boolean(mirrored(w) || (w.digital && w.digital.image_recovered_from));
  const order = [
    ...works.filter((w) => w.status === 'available' && good(w)),
    ...works.filter((w) => w.status === 'available' && !good(w)),
    ...works.filter((w) => w.status !== 'available' && good(w)),
    ...works.filter((w) => w.status !== 'available' && !good(w)),
  ];

  let picked = null;
  let tried = 0;
  for (const w of order) {
    if (tried >= 25) break;                                // do not walk a whole collection
    const u = urlOf(w);
    if (!u) continue;
    tried++;
    if (!(await alive(u))) continue;
    picked = w;
    break;
  }

  if (!picked) { report.push({ slug: c.slug, why: `no working image in ${works.length} works (tried ${tried})` }); continue; }

  const cover = {
    id: picked.id,
    image: (picked.digital && picked.digital.image) || picked.image || null,
    ...(mirrored(picked) ? { assets: picked.assets } : {}),
    ...(picked.orientation ? { orientation: picked.orientation } : {}),
  };
  report.push({ slug: c.slug, picked: picked.id, status: picked.status, mirrored: Boolean(mirrored(picked)) });
  if (!DRY) c.cover = cover;
}

if (!DRY) fs.writeFileSync(idxPath, JSON.stringify(idx, null, 1) + (raw.endsWith('\n') ? '\n' : ''));

console.log(DRY ? 'DRY RUN' : 'WROTE');
for (const r of report) {
  if (r.why) console.log(`  UNRESOLVED ${r.slug.padEnd(20)} ${r.why}`);
  else console.log(`  cover      ${r.slug.padEnd(20)} ${r.picked}  (${r.status}${r.mirrored ? ', mirrored' : ', origin'})`);
}
const stuck = report.filter((r) => r.why);
console.log(`\n${report.length - stuck.length} covers set, ${stuck.length} still without a usable image`);
