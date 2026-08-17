import { ethCall, selector, padUint, decodeAddress, ensReverse, getJSON, BS } from './lib.mjs';
import fs from 'fs';
const FND = '0x3B3ee1931Dc30C1957379FAc9aba94D1C48a5405';
const d = JSON.parse(fs.readFileSync('raw/shared-foundation.json','utf8'));
const wallets = JSON.parse(fs.readFileSync('wallets.json','utf8'));
const artist = new Set(Object.values(wallets).map(a=>a&&a.toLowerCase()));
const sel = selector('tokenCreator(uint256)');
const out = [];
for (const t of d.tokens) {
  let creator = null;
  try { creator = decodeAddress(await ethCall(FND, sel + padUint(t.id))); } catch (e) { creator = 'ERR'; }
  const isArtist = creator && artist.has(creator.toLowerCase());
  const inst = t.instance;
  out.push({ id: t.id, name: inst?.metadata?.name, creator, isArtist, owner: inst?.owner?.hash, owner_ens: inst?.owner?.ens_domain_name, image: inst?.image_url, metadata: inst?.metadata });
  console.log(String(t.id).padEnd(8), (inst?.metadata?.name||'').slice(0,32).padEnd(34), creator, isArtist ? '  <-- ARTIST' : '');
}
fs.writeFileSync('raw/foundation-creators.json', JSON.stringify(out,null,2));
