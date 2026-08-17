import { getJSON, BS, bsPaged, mapLimit, sleep } from './lib.mjs';
import fs from 'fs';
const EV = '0x4C03BCAD293fb0562D26FAa7D90A0cb3Ea74c919';
const wallets = JSON.parse(fs.readFileSync('wallets.json', 'utf8'));
const known = '112120649069925438432858119347465481415441762939268014343104260294108241684123';

const t = await getJSON(`${BS}/tokens/${EV}`);
console.log('contract:', t.name, '|', t.symbol, '|', t.type, '| holders', t.holders || t.holders_count);

// every EmblemVault token that has touched an artist wallet
const seen = new Map();
for (const label of ['mintface.eth', 'ryanj.eth', 'mintestate.eth']) {
  const tr = await bsPaged(`/addresses/${wallets[label]}/token-transfers`, { params: { token: EV } });
  for (const x of tr) {
    const id = String(x.total?.token_id ?? x.token_id);
    if (!seen.has(id)) seen.set(id, { id, transfers: [] });
    seen.get(id).transfers.push({ wallet: label, from: x.from?.hash, from_ens: x.from?.ens_domain_name, to: x.to?.hash, to_ens: x.to?.ens_domain_name, ts: x.timestamp, qty: x.total?.value });
  }
  console.log(label, 'unique EmblemVault tokens so far:', seen.size);
  await sleep(150);
}
if (!seen.has(known)) seen.set(known, { id: known, transfers: [] });

const out = [];
await mapLimit([...seen.values()], 3, async (rec) => {
  const inst = await getJSON(`${BS}/tokens/${EV}/instances/${rec.id}`);
  const holders = await bsPaged(`/tokens/${EV}/instances/${rec.id}/holders`, { max: 200 });
  out.push({
    id: rec.id,
    name: inst.metadata?.name || null,
    description: inst.metadata?.description || null,
    image: inst.image_url || inst.metadata?.image || null,
    external_url: inst.metadata?.external_url || null,
    attributes: inst.metadata?.attributes || null,
    holders: holders.map((h) => ({ address: h.address?.hash, ens: h.address?.ens_domain_name, qty: Number(h.value || 0) })),
    transfers: rec.transfers,
  });
  await sleep(100);
});
out.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
fs.writeFileSync('raw/emblem-vault.json', JSON.stringify(out, null, 2));
for (const o of out) {
  console.log('  ', (o.name || '(no metadata)').slice(0, 46).padEnd(48), 'holders', o.holders.length, '| id', o.id.slice(0, 14) + '...', o.id === known ? ' <-- FROGDNA per notes' : '');
}
