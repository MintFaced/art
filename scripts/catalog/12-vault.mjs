import { bsPaged } from './lib.mjs';
import fs from 'fs';
const wallets = JSON.parse(fs.readFileSync('wallets.json','utf8'));
const out = {};
for (const label of ['mintestate.eth','ryanj.eth','mintface.eth']) {
  const items = await bsPaged(`/addresses/${wallets[label]}/nft`, { params: { type: 'ERC-721,ERC-1155' } });
  out[label] = items.map(i => ({
    contract: i.token?.address_hash || i.token?.address,
    contract_name: i.token?.name,
    type: i.token?.type,
    id: i.id,
    name: i.metadata?.name,
    image: i.image_url || i.metadata?.image,
    animation: i.animation_url,
    value: i.value,
  }));
  console.log(label, 'nfts held:', out[label].length);
}
fs.writeFileSync('raw/holdings.json', JSON.stringify(out, null, 2));
const v = out['mintestate.eth'];
const byC = {};
for (const t of v) byC[`${t.contract_name} | ${t.contract}`] = (byC[`${t.contract_name} | ${t.contract}`]||0)+1;
console.log('\n== VAULT (mintestate.eth) by collection:');
for (const [k,c] of Object.entries(byC).sort((a,b)=>b[1]-a[1])) console.log('  ['+c+']', k);
