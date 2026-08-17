import { getJSON, BS } from './lib.mjs';
const addrs = process.argv.slice(2);
for (const a of addrs) {
  const t = await getJSON(`${BS}/tokens/${a}`);
  console.log(a, '|', t.name, '|', t.symbol, '| type', t.type, '| supply', t.total_supply, '| holders', t.holders || t.holders_count);
}
