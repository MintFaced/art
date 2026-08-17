import { bsPaged } from './lib.mjs';
import fs from 'fs';
const wallets = JSON.parse(fs.readFileSync('wallets.json','utf8'));
const all = {};
for (const label of ['mintface.eth','ryanj.eth','mintestate.eth']) {
  const addr = wallets[label];
  const tr = await bsPaged(`/addresses/${addr}/token-transfers`, { params: { type: 'ERC-721,ERC-1155' } });
  console.log(label, 'total nft transfers', tr.length);
  const mints = tr.filter(t => /^0x0+$/i.test(t.from?.hash || ''));
  console.log(label, 'mints received', mints.length);
  all[label] = mints.map(t => ({
    contract: t.token?.address_hash || t.token?.address,
    contract_name: t.token?.name,
    type: t.token?.type,
    token_id: t.total?.token_id ?? t.token_id,
    value: t.total?.value,
    ts: t.timestamp,
    block: t.block_number,
    tx: t.transaction_hash || t.tx_hash,
  }));
}
fs.writeFileSync('raw/mints.json', JSON.stringify(all, null, 2));
for (const [label, m] of Object.entries(all)) {
  const by = {};
  for (const x of m) by[`${x.contract_name} | ${x.contract}`] = (by[`${x.contract_name} | ${x.contract}`]||0)+1;
  console.log('\n== '+label);
  for (const [k,v] of Object.entries(by).sort((a,b)=>b[1]-a[1])) console.log('  ['+v+']', k);
}
