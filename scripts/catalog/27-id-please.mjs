import { getJSON, BS, bsPaged } from './lib.mjs';
import fs from 'fs';
const C = '0x33fd426905f149f8376e227d0c9d3340aad17af1';
const TOKEN = '362';
const inst = await getJSON(`${BS}/tokens/${C}/instances/${TOKEN}`);
const holders = await bsPaged(`/tokens/${C}/instances/${TOKEN}/holders`, { max: 1000 });
const transfers = await getJSON(`${BS}/tokens/${C}/instances/${TOKEN}/transfers`);
const list = transfers.items || [];
const first = list[list.length - 1];
const out = {
  contract: C, token_id: TOKEN,
  name: inst.metadata?.name, description: inst.metadata?.description,
  image: inst.image_url || inst.metadata?.image, animation: inst.animation_url || inst.metadata?.animation || null,
  attributes: inst.metadata?.attributes || null,
  minted: first ? first.timestamp : null,
  mint_tx: first ? (first.transaction_hash || first.tx_hash) : null,
  holders: holders.map((h) => ({ address: h.address?.hash, ens: h.address?.ens_domain_name, qty: Number(h.value || 0) })),
};
out.supply = out.holders.reduce((n, h) => n + h.qty, 0);
fs.writeFileSync('raw/id-please.json'.replace('.json', '-token.json'), JSON.stringify(out, null, 2));
console.log('name:', out.name, '| minted:', out.minted);
console.log('supply on chain:', out.supply, 'across', out.holders.length, 'holders');
console.log('attributes:', (out.attributes || []).map((a) => a.trait_type + '=' + a.value).join(' | ').slice(0, 240));
const wallets = JSON.parse(fs.readFileSync('wallets.json', 'utf8'));
for (const [label, addr] of Object.entries(wallets)) {
  const h = out.holders.find((x) => (x.address || '').toLowerCase() === (addr || '').toLowerCase());
  if (h) console.log('  held by', label, h.qty);
}
