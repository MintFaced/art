// The OpenSea shared storefront has no per token metadata on chain: uri() points
// at an OpenSea endpoint. That endpoint needs no key and carries the image and
// the traits, both of which the catalog was missing.
import fs from 'fs';
import { mapLimit, sleep } from './lib.mjs';

const CONTRACT = '0x495f947276749Ce646f68AC8c248420045cb7b5e';
const META = (idHex) => `https://api.opensea.io/api/v1/metadata/${CONTRACT}/0x${idHex}`;

const works = JSON.parse(fs.readFileSync('/Users/ryanjennings/dev/art/data/c/geodetic-moments.json', 'utf8')).works;
const out = {};
let done = 0, failed = 0;

await mapLimit(works, 4, async (w) => {
  const hex = BigInt(w.digital.token_id).toString(16).padStart(64, '0');
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(META(hex), { headers: { accept: 'application/json' } });
      if (r.status === 429 || r.status >= 500) { await sleep(1200 * (attempt + 1)); continue; }
      if (!r.ok) break;
      const j = await r.json();
      out[w.digital.token_id] = {
        name: j.name || null,
        description: j.description || null,
        image: j.image || null,
        animation_url: j.animation_url || null,
        attributes: Array.isArray(j.traits)
          ? j.traits.filter((t) => t && t.trait_type && t.value != null && t.value !== '')
              .map((t) => ({ trait_type: t.trait_type, value: t.value }))
          : null,
      };
      done++;
      return;
    } catch (e) { await sleep(800); }
  }
  failed++;
});

fs.writeFileSync('raw/storefront-metadata.json', JSON.stringify(out, null, 1));
const withImg = Object.values(out).filter((x) => x.image).length;
const withTraits = Object.values(out).filter((x) => x.attributes && x.attributes.length).length;
console.log(`fetched ${done}, failed ${failed}`);
console.log(`  with an image : ${withImg}`);
console.log(`  with traits   : ${withTraits}`);
const hosts = {};
for (const x of Object.values(out)) if (x.image) { const h = new URL(x.image).host; hosts[h] = (hosts[h] || 0) + 1; }
console.log('  image hosts   :', hosts);
