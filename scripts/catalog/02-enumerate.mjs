import { bsPaged, getJSON, BS, mapLimit, sleep } from './lib.mjs';
import fs from 'fs';

const CONTRACTS = JSON.parse(fs.readFileSync(process.argv[2] || 'contracts.json', 'utf8'));
fs.mkdirSync('raw', { recursive: true });

for (const c of CONTRACTS) {
  const file = `raw/${c.key}.json`;
  if (fs.existsSync(file) && !process.env.FORCE) { console.log('skip (cached)', c.key); continue; }
  const items = await bsPaged(`/tokens/${c.address}/instances`);
  console.log(c.key.padEnd(22), c.address, 'instances:', items.length);
  // ERC-1155: fetch holders per instance
  if (c.type === 'ERC-1155') {
    await mapLimit(items, 3, async (it) => {
      const h = await bsPaged(`/tokens/${c.address}/instances/${encodeURIComponent(it.id)}/holders`);
      it.__holders = h.map((x) => ({ address: x.address?.hash, ens: x.address?.ens_domain_name, value: x.value }));
      await sleep(120);
    });
  }
  fs.writeFileSync(file, JSON.stringify({ contract: c, items }, null, 2));
}
