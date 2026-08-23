#!/usr/bin/env node
/* Editions whose artwork has gone missing from the chain's own pointers.
 *
 * Two faults, neither of them the record's:
 *
 *   the file is gone   Every token of Surreal Dreamooor points at one Arweave
 *                      transaction, and that transaction now 404s. The whole
 *                      edition renders blank, not one unlucky token.
 *   no metadata ever   Some Seize And Share editions carry no metadata at all
 *                      on the shared contract. Fifteen live tokens, none of
 *                      them naming or picturing anything, which is where the
 *                      "untitled" records came from.
 *
 * Repointing at a different token cannot help either case, because every token
 * in an edition shares the same metadata. What does help is that OpenSea cached
 * these works while they were still resolvable, and will still serve both the
 * image and the name.
 *
 * The cache is recorded as the image source and the name is restored where the
 * record had none. Needs OPENSEA_API_KEY.
 *
 *   node scripts/restore-lost-images.mjs --dry
 *   node scripts/restore-lost-images.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DRY = process.argv.includes('--dry');
const KEY = process.env.OPENSEA_API_KEY;
if (!KEY) { console.error('OPENSEA_API_KEY is not set'); process.exit(1); }
const ASSETS = 'https://assets.mintface.art';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function alive(url) {
  if (!url) return false;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { method: 'HEAD' });
      if (r.status === 200) return true;
      if (r.status === 404 || r.status === 403) return false;
    } catch (e) { /* a throw is not an answer */ }
    await sleep(400 * (i + 1));
  }
  return false;
}
async function osNft(contract, token) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(`https://api.opensea.io/api/v2/chain/ethereum/contract/${contract}/nfts/${token}`,
        { headers: { accept: 'application/json', 'x-api-key': KEY } });
      if (r.status === 429) { await sleep(1400 * (i + 1)); continue; }
      if (!r.ok) return null;
      return (await r.json()).nft || null;
    } catch (e) { await sleep(600 * (i + 1)); }
  }
  return null;
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
    const dg = w.digital || {};
    if (dg.chain !== 'ethereum' || !dg.contract || dg.token_id == null) continue;
    // an edition with nothing live is allowed to have nothing to show
    if (ed.type === 'edition' && ((ed.minted || 0) - (ed.burned || 0)) <= 0) continue;
    if (await alive(imageOf(w))) continue;

    const nft = await osNft(dg.contract, dg.token_id);
    await sleep(280);
    const img = nft && (nft.display_image_url || nft.image_url);
    if (!img || !(await alive(img))) {
      report.push({ id: w.id, ok: false, note: nft ? 'opensea has no usable image either' : 'opensea has no record' });
      continue;
    }
    const name = nft.name && !/^#?\d+$/.test(nft.name) ? nft.name : null;
    const renamed = name && (!w.title || /^untitled$/i.test(String(w.title).trim()));
    report.push({ id: w.id, ok: true, note: renamed ? `named "${name}"` : 'image restored' });
    if (!DRY) {
      dg.image = img;
      dg.image_source = 'opensea-cache';   // says plainly this is not the chain's pointer
      if (renamed) w.title = name;
      changed = true;
    }
  }
  if (changed && !DRY) fs.writeFileSync(p, JSON.stringify(d, null, 1) + (raw.endsWith('\n') ? '\n' : ''));
}

console.log(DRY ? 'DRY RUN' : 'WROTE');
for (const r of report) console.log(`  ${r.ok ? 'ok  ' : 'MISS'} ${r.id.padEnd(44)} ${r.note}`);
console.log(`\n${report.filter((r) => r.ok).length} restored, ${report.filter((r) => !r.ok).length} still missing`);
