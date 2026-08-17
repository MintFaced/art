import { bsPaged, getJSON, BS, mapLimit, sleep } from './lib.mjs';
import fs from 'fs';
const wallets = JSON.parse(fs.readFileSync('wallets.json','utf8'));
const SHARED = [
  { key: 'opensea-storefront', address: '0x495f947276749Ce646f68AC8c248420045cb7b5e' },
  { key: 'rarible-1155', address: '0xd07dc4262BCDbf85190C01c996b4C06a461d2430' },
  { key: 'rarible-721', address: '0x60F80121C31A0d46B5279700f9DF786054aa5eE5' },
  { key: 'foundation', address: '0x3B3ee1931Dc30C1957379FAc9aba94D1C48a5405' },
  { key: 'minted-networked', address: '0xa81f8083072F192948dcaE38DA5c0C6073DA979c' },
];
fs.mkdirSync('raw', { recursive: true });
for (const c of SHARED) {
  const out = new Map();
  for (const [label, addr] of Object.entries({ 'mintface.eth': wallets['mintface.eth'], 'ryanj.eth': wallets['ryanj.eth'], 'mintestate.eth': wallets['mintestate.eth'] })) {
    const tr = await bsPaged(`/addresses/${addr}/token-transfers`, { params: { token: c.address } });
    for (const t of tr) {
      const id = t.total?.token_id ?? t.token_id;
      if (id == null) continue;
      const rec = out.get(String(id)) || { id: String(id), transfers: [] };
      rec.transfers.push({ wallet: label, from: t.from?.hash, from_ens: t.from?.ens_domain_name, to: t.to?.hash, to_ens: t.to?.ens_domain_name, ts: t.timestamp, block: t.block_number, tx: t.transaction_hash || t.tx_hash, value: t.total?.value });
      out.set(String(id), rec);
    }
    console.log(c.key, label, 'transfers seen; unique ids so far', out.size);
    await sleep(200);
  }
  const ids = [...out.values()];
  await mapLimit(ids, 3, async (rec) => {
    const inst = await getJSON(`${BS}/tokens/${c.address}/instances/${encodeURIComponent(rec.id)}`);
    rec.instance = inst.__error ? null : inst;
    await sleep(100);
  });
  fs.writeFileSync(`raw/shared-${c.key}.json`, JSON.stringify({ contract: c, tokens: ids }, null, 2));
  console.log('WROTE', c.key, ids.length);
}
