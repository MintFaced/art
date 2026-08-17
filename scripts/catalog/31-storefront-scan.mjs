// Lazy minted tokens never touch the chain, so an indexer cannot see them, but
// OpenSea can. The storefront id encodes creator, index and supply, so the whole
// space that creator ever used can be walked directly.
import fs from 'fs';
import { mapLimit, sleep } from './lib.mjs';

const C = '0x495f947276749Ce646f68AC8c248420045cb7b5e';
const CREATOR = 'dd6b80649e8d472eb8fb52eb7eecfd2dc219ace7';
const MAX = Number(process.argv[2] || 400);

const idFor = (index, supply = 1) =>
  CREATOR + index.toString(16).padStart(14, '0') + supply.toString(16).padStart(10, '0');

const out = {};
let hits = 0, misses = 0;
await mapLimit(Array.from({ length: MAX }, (_, i) => i + 1), 4, async (index) => {
  const hex = idFor(index);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(`https://api.opensea.io/api/v1/metadata/${C}/0x${hex}`, { headers: { accept: 'application/json' } });
      if (r.status === 429 || r.status >= 500) { await sleep(1500 * (attempt + 1)); continue; }
      if (!r.ok) { misses++; return; }
      const j = await r.json();
      if (!j || !j.name) { misses++; return; }
      out[index] = {
        token_id: BigInt('0x' + hex).toString(),
        index,
        name: j.name,
        description: j.description || null,
        image: j.image || null,
        animation_url: j.animation_url || null,
        attributes: Array.isArray(j.traits)
          ? j.traits.filter((t) => t && t.trait_type && t.value != null && t.value !== '').map((t) => ({ trait_type: t.trait_type, value: t.value }))
          : null,
      };
      hits++;
      return;
    } catch { await sleep(600); }
  }
  misses++;
});

fs.writeFileSync('raw/storefront-scan.json', JSON.stringify(out, null, 1));
const gm = Object.values(out).filter((x) => /^Geodetic (Moment|Marker)/i.test(x.name));
const nums = [...new Set(gm.map((x) => Number((x.name.match(/#(\d+)/) || [])[1])).filter(Boolean))].sort((a, b) => a - b);
console.log(`indexes scanned ${MAX}, found ${hits}, empty ${misses}`);
console.log(`Geodetic Moments/Markers: ${gm.length} tokens, numbers ${nums.length}`);
const missing = [];
for (let i = 1; i <= 100; i++) if (!nums.includes(i)) missing.push(i);
console.log('still missing of 1 to 100:', missing.join(', ') || 'none');
