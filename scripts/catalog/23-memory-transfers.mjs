import { getJSON, BS, mapLimit, sleep } from './lib.mjs';
import fs from 'fs';
const C = '0xa81f8083072F192948dcaE38DA5c0C6073DA979c';
const { items } = JSON.parse(fs.readFileSync('raw/minted-all.json', 'utf8'));
const gm = items.filter((i) => /Geodetic Memory/i.test(i.metadata?.name || ''));
const out = JSON.parse(fs.readFileSync('raw/token-transfers.json', 'utf8'));
const res = {};
let n = 0;
await mapLimit(gm, 4, async (it) => {
  const j = await getJSON(`${BS}/tokens/${C}/instances/${encodeURIComponent(it.id)}/transfers`, { tries: 3 });
  const list = j.items || [];
  const first = list[list.length - 1], last = list[0];
  res[it.id] = { transfers: list.length, minted: first?.timestamp || null, mint_tx: first ? (first.transaction_hash || first.tx_hash) : null, last_transfer: last?.timestamp || null, last_to: last ? (last.to?.ens_domain_name || last.to?.hash) : null };
  if (++n % 100 === 0) { console.log('  ', n, '/', gm.length); fs.writeFileSync('raw/token-transfers.json', JSON.stringify({ ...out, 'minted-all': res }, null, 2)); }
  await sleep(50);
});
fs.writeFileSync('raw/token-transfers.json', JSON.stringify({ ...out, 'minted-all': res }, null, 2));
console.log('DONE geodetic memory', Object.keys(res).length);
