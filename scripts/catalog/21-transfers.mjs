import { getJSON, BS, mapLimit, sleep } from './lib.mjs';
import fs from 'fs';
const KEYS = ['pixelarcade','artificial-flowers','patrimora','two-burdens','geodetic-ai','roads-and-rivers','geodetic-world','geodetica','visual-language','panoptic','wallet'];
const out = {};
for (const k of KEYS) {
  const { contract, items } = JSON.parse(fs.readFileSync(`raw/${k}.json`, 'utf8'));
  const res = {};
  let n = 0;
  await mapLimit(items, 4, async (it) => {
    const j = await getJSON(`${BS}/tokens/${contract.address}/instances/${encodeURIComponent(it.id)}/transfers`, { tries: 3 });
    const list = j.items || [];
    const first = list[list.length - 1], last = list[0];
    res[it.id] = {
      transfers: list.length,
      minted: first ? first.timestamp : null,
      mint_tx: first ? (first.transaction_hash || first.tx_hash) : null,
      last_transfer: last ? last.timestamp : null,
      last_to: last ? (last.to?.ens_domain_name || last.to?.hash) : null,
    };
    if (++n % 50 === 0) console.log(' ', k, n, '/', items.length);
    await sleep(50);
  });
  out[k] = res;
  console.log('done', k, Object.keys(res).length);
  fs.writeFileSync('raw/token-transfers.json', JSON.stringify(out, null, 2));
}
console.log('ALL DONE');
