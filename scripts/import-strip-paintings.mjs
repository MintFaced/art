#!/usr/bin/env node
/* Puts the strip painting images in R2 under strip-paintings/ and points the
 * source records at them.
 *
 * The write goes through api/_lib/r2.js ... the same signed client api/warm-assets.js
 * and api/derive-assets.js use, reading R2_ACCOUNT_ID / R2_BUCKET /
 * R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY from the environment. No key of its
 * own, and no hop through a deployment: one credential path for the bucket, the
 * standing one. That module reads its env at import, so the env file is loaded
 * before it is pulled in.
 *
 * The files are already web sized, so nothing is resized or re-encoded: what is
 * on disk goes up, keyed by its filename, and the manifest goes up beside them
 * as the record of where each one came from.
 *
 *   vercel env pull .env.r2.local --environment=production
 *   node --env-file=.env.r2.local scripts/import-strip-paintings.mjs --dry
 *   node --env-file=.env.r2.local scripts/import-strip-paintings.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const ROOT = new URL('../', import.meta.url).pathname;
const DIR = 'assets/strip-paintings';
const SOURCE = 'data/source/strip-paintings.json';
const PUBLIC = process.env.ASSETS_PUBLIC_BASE || 'https://assets.mintface.art';
const dry = process.argv.includes('--dry');

const { putObject, alreadyThere, r2Configured } = await import(`${ROOT}api/_lib/r2.js`);

const TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', json: 'application/json' };

const manifest = JSON.parse(readFileSync(`${ROOT}${DIR}/manifest.json`, 'utf8'));
const src = JSON.parse(readFileSync(ROOT + SOURCE, 'utf8'));

// the manifest is the list of what belongs in the bucket, plus itself
const files = [...manifest.map((m) => m.file), 'manifest.json'];

/* What is missing, asked of the public domain first. A bucket that already
   holds everything needs no credential at all, and a re-run after the files
   have landed should be able to finish the records rather than stopping to ask
   for a key it has nothing to spend. */
const keyOf = (file) => `strip-paintings/${file}`;
const missing = [];
for (const file of files) {
  const key = keyOf(file);
  if (await alreadyThere(PUBLIC, key)) { console.log(`  = ${key}`); continue; }
  missing.push(file);
  console.log(`  ${dry ? 'would put' : 'to put'} ${key}`);
}

/* `vercel env pull` hands back the literal [SENSITIVE] for anything marked
   sensitive on the project, which is a non-empty string and so reads as
   configured. Caught here rather than as a signing failure against a host
   called [SENSITIVE].r2.cloudflarestorage.com. */
const placeholder = ['R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']
  .filter((k) => /^\[SENSITIVE\]$/.test(process.env[k] || ''));

if (!dry && missing.length && (placeholder.length || !r2Configured())) {
  console.error(`\n${missing.length} file(s) are not in the bucket and R2 is not configured here.`);
  if (placeholder.length) {
    console.error(`${placeholder.join(', ')} came back as [SENSITIVE]. They are marked sensitive on\n`
      + 'the Vercel project, so `vercel env pull` cannot read them back ... only re-enter them.');
  }
  console.error('Set R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY in this\n'
    + 'shell, or run this where they already exist.');
  process.exit(1);
}

let up = 0, failed = 0;
const already = files.length - missing.length;
for (const file of missing) {
  const key = keyOf(file);
  const ext = (file.match(/\.([a-z0-9]+)$/i) || [])[1].toLowerCase();
  if (dry) continue;
  try {
    await putObject(key, readFileSync(`${ROOT}${DIR}/${file}`), TYPES[ext] || 'application/octet-stream');
    up++; console.log(`  + ${key}`);
  } catch (e) {
    failed++; console.log(`  ! ${key}: ${String(e.message || e).slice(0, 120)}`);
  }
}

if (failed) { console.error(`${failed} file(s) did not land. The records are left alone.`); process.exit(1); }

/* Only once every file is actually in the bucket. A record pointed at a key
   that is not there is a collection of broken pictures, and the local path it
   would replace works. */
if (!dry) {
  let moved = 0;
  for (const w of src.works || []) {
    const file = String(w.image || '').split('/').pop();
    if (!file || !files.includes(file)) continue;
    w.assets = { ...(w.assets || {}), image: `strip-paintings/${file}` };
    delete w.image;
    moved++;
  }
  writeFileSync(ROOT + SOURCE, JSON.stringify(src, null, 2) + '\n');
  execFileSync('node', [`${ROOT}scripts/build-strip-paintings.mjs`], { stdio: 'inherit' });
  console.log(`${up} uploaded, ${already} already there, ${moved} record(s) now read from R2`);
}
