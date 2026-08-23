#!/usr/bin/env node
/* Repoint an edition at a token whose picture still exists.
 *
 * An edition record shows one token's metadata as the whole edition's image.
 * Nothing ever checked that the chosen token was a good choice, so an edition
 * of forty-eight with forty-eight live copies renders blank because the one
 * token it happens to point at had its Arweave file disappear, and an edition
 * of thirty-one with twelve holders renders blank and untitled because the
 * token it points at was burned and burned tokens carry no metadata.
 *
 * This walks the edition's own token ids, finds one that is alive and whose
 * image actually answers, and repoints the record at it. A title taken from
 * the dead token is replaced too, which is where "untitled" came from.
 *
 *   node scripts/fix-edition-representatives.mjs --dry
 *   node scripts/fix-edition-representatives.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DRY = process.argv.includes('--dry');
const BS = 'https://eth.blockscout.com/api/v2';
const ASSETS = 'https://assets.mintface.art';
const BURN = new Set(['0x0000000000000000000000000000000000000000', '0x000000000000000000000000000000000000dead']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function j(url) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers: { accept: 'application/json' } });
      if (r.ok) return r.json();
      if (r.status === 404) return null;
    } catch (e) { /* retry */ }
    await sleep(500 * (i + 1));
  }
  return null;
}
async function alive(url) {
  if (!url) return false;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { method: 'HEAD' });
      if (r.status === 200) return true;
      if (r.status === 404 || r.status === 403) return false;
    } catch (e) { /* a throw is not an answer; ask again */ }
    await sleep(400 * (i + 1));
  }
  return false;
}
const imageOf = (w) => {
  const m = w.assets && (w.assets.display || w.assets.image);
  return m ? `${ASSETS}/${m}` : ((w.digital || {}).image || null);
};

const report = [];
for (const f of fs.readdirSync(path.join(ROOT, 'data/c')).filter((n) => n.endsWith('.json'))) {
  const p = path.join(ROOT, 'data/c', f);
  const raw = fs.readFileSync(p, 'utf8');
  const d = JSON.parse(raw);
  if (d.slug === 'the-vault') continue;
  let changed = false;

  for (const w of d.works || []) {
    const ed = w.edition || {};
    if (ed.type !== 'edition') continue;
    const dg = w.digital || {};
    if (dg.chain !== 'ethereum' || !dg.contract) continue;
    const ids = w.token_ids || [];
    if (ids.length < 2) continue;

    const live = (ed.minted || ids.length) - (ed.burned || 0);
    if (live <= 0) continue;                       // genuinely gone: leave it be

    if (await alive(imageOf(w))) continue;         // the picture is fine

    // walk the edition for a token that is alive and shows something
    let picked = null;
    for (const id of ids) {
      if (String(id) === String(dg.token_id)) continue;
      const inst = await j(`${BS}/tokens/${dg.contract}/instances/${encodeURIComponent(id)}`);
      await sleep(90);
      if (!inst || !inst.metadata) continue;
      const owner = String(inst.owner?.hash || '').toLowerCase();
      if (owner && BURN.has(owner)) continue;
      const img = inst.metadata.image || inst.image_url || null;
      if (!img || !(await alive(img))) continue;
      picked = { id: String(id), image: img, name: inst.metadata.name || null, animation: inst.metadata.animation_url || null };
      break;
    }

    if (!picked) {
      report.push({ id: w.id, was: String(dg.token_id), to: null, note: 'no live token in the edition has a working image' });
      continue;
    }
    report.push({ id: w.id, was: String(dg.token_id), to: picked.id, note: `title "${w.title}" -> "${picked.name || w.title}"` });
    if (!DRY) {
      dg.token_id = picked.id;
      dg.image = picked.image;
      if (picked.animation) dg.animation = picked.animation;
      // a burned token carries no name, which is where "untitled" came from
      if (picked.name && (!w.title || /^untitled$/i.test(String(w.title).trim()))) w.title = picked.name;
      changed = true;
    }
  }
  if (changed && !DRY) fs.writeFileSync(p, JSON.stringify(d, null, 1) + (raw.endsWith('\n') ? '\n' : ''));
}

console.log(DRY ? 'DRY RUN' : 'WROTE');
for (const r of report) {
  console.log(`  ${r.id.padEnd(44)} token ${r.was} -> ${r.to || 'NONE'}   ${r.note}`);
}
console.log(`\n${report.filter((r) => r.to).length} repointed, ${report.filter((r) => !r.to).length} could not be`);
