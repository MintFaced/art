// Blockscout truncates long metadata at 4096 characters, which cuts a fully
// on-chain SVG in half. These read the token's own uri() instead.
import fs from 'fs';
import { ethCall, selector, padUint, decodeString } from './lib.mjs';

const C = '0x7b5ccc13ffacf2bc8204be1359a3eea3cae4dce4';
const out = {};
for (const id of [1, 2, 3, 4, 5]) {
  const raw = decodeString(await ethCall(C, selector('uri(uint256)') + padUint(id)));
  if (!raw) { console.log(id, 'no uri'); continue; }
  let meta = null;
  if (raw.startsWith('data:')) {
    const body = raw.slice(raw.indexOf(',') + 1);
    const text = raw.includes(';base64')
      ? Buffer.from(body, 'base64').toString('utf8')
      : (() => { try { return decodeURIComponent(body); } catch { return body; } })();
    try { meta = JSON.parse(text); }
    catch { meta = { name: null, image: raw }; }   // some tokens inline the SVG directly
  } else {
    meta = await fetch(raw.replace('ipfs://', 'https://gateway.pinata.cloud/ipfs/')).then((r) => r.json()).catch(() => null);
  }
  if (!meta) { console.log(id, 'no metadata'); continue; }
  // pull the image straight out of the JSON text: some of these carry percent
  // escapes that a strict decoder rejects
  const m = raw.startsWith('data:')
    ? raw.slice(raw.indexOf(',') + 1).match(/"image"\s*:\s*"([^"]*)"/)
    : null;
  const rawImage = m ? m[1] : (meta && (meta.image || meta.image_data)) || null;
  let usable = null;
  if (rawImage && rawImage.startsWith('data:')) {
    let svg = rawImage.slice(rawImage.indexOf(',') + 1);
    let decoded = null;
    try { decoded = decodeURIComponent(svg); } catch { decoded = null; }
    usable = decoded && /<\/svg>\s*$/.test(decoded) ? rawImage : null;
    if (!usable) console.log(`   token ${id}: the on chain svg is incomplete, ${svg.length} chars and no closing tag`);
  } else if (rawImage) {
    usable = rawImage;
  }

  out[id] = {
    image_broken: Boolean(rawImage && !usable),
    name: meta.name || null,
    description: meta.description || null,
    image: usable || null,
    animation_url: meta.animation_url || null,
    attributes: Array.isArray(meta.attributes) && meta.attributes.length ? meta.attributes : null,
  };
  const img = out[id].image || '';
  console.log(String(id).padEnd(3), (meta.name || '').padEnd(24), img.startsWith('data:') ? `inline ${img.length} chars` : img.slice(0, 60));
}
fs.writeFileSync('raw/onchain-svg.json', JSON.stringify(out, null, 1));
