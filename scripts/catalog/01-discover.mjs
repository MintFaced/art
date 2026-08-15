import { bsPaged, getJSON, BS } from './lib.mjs';
import fs from 'fs';

const wallets = JSON.parse(fs.readFileSync('wallets.json', 'utf8'));
const targets = {
  'mintface.eth': wallets['mintface.eth'],
  'ryanj.eth': wallets['ryanj.eth'],
  'mintestate.eth': wallets['mintestate.eth'],
};

const pool = new Map(); // lowercase addr -> {address,name,type,heldBy:{}}
for (const [label, addr] of Object.entries(targets)) {
  const items = await bsPaged(`/addresses/${addr}/nft/collections`, { params: { type: 'ERC-721,ERC-1155' } });
  console.log(label, 'collections:', items.length);
  for (const it of items) {
    const t = it.token || {};
    const a = (t.address_hash || t.address || '').toLowerCase();
    if (!a) continue;
    if (!pool.has(a)) pool.set(a, { address: t.address_hash || t.address, name: t.name, symbol: t.symbol, type: t.type, total_supply: t.total_supply, holders: t.holders || t.holders_count, heldBy: {} });
    pool.get(a).heldBy[label] = Number(it.amount || (it.token_instances || []).length || 0);
  }
}
fs.writeFileSync('pool.json', JSON.stringify([...pool.values()], null, 2));
console.log('pool size', pool.size);

// truncated patterns from the seed
const truncs = {
  pixelarcade: '0x97536e...ba30e8',
  'artificial-flowers': '0xd64ac5...be90d',
  patrimora: '0xEabffd...502d8',
  'two-burdens': '0xe1d1f9...ed09',
  'hidden-landscapes': '0x38bae1...6045',
  'geodetic-illusions': '0x38bae1...6045',
  'roads-and-rivers': '0x18bd00...ee67',
  'geodetic-world': '0xe16c77...d396',
  geodetica: '0xf6f44f...2933',
  'geodetic-moments': '0x495f94...b7b5e',
  'geodetic-memory': '0xa81f80...979c',
};
const matches = {};
for (const [slug, pat] of Object.entries(truncs)) {
  const [pre, suf] = pat.toLowerCase().split('...');
  const hits = [...pool.values()].filter((c) => {
    const a = c.address.toLowerCase();
    return a.startsWith(pre) && a.endsWith(suf);
  });
  matches[slug] = hits;
  console.log(slug.padEnd(20), pat.padEnd(24), hits.length ? hits.map((h) => `${h.address} "${h.name}" ${h.type}`).join(' | ') : 'NO MATCH IN POOL');
}
fs.writeFileSync('trunc-matches.json', JSON.stringify(matches, null, 2));
