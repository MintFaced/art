import { getJSON, BS, mapLimit, sleep } from './lib.mjs';
import fs from 'fs';
const OS = '0x495f947276749Ce646f68AC8c248420045cb7b5e';
const wallets = JSON.parse(fs.readFileSync('wallets.json','utf8'));
const found = [];
for (const [label, addr] of [['ryanj.eth', wallets['ryanj.eth']], ['mintface.eth', wallets['mintface.eth']]]) {
  const creator = addr.toLowerCase().replace(/^0x/, '');
  const idxs = Array.from({ length: 400 }, (_, i) => i + 1);
  const res = await mapLimit(idxs, 4, async (i) => {
    const hex = creator + i.toString(16).padStart(14, '0') + (1).toString(16).padStart(10, '0');
    const id = BigInt('0x' + hex).toString();
    const inst = await getJSON(`${BS}/tokens/${OS}/instances/${id}`, { tries: 3 });
    await sleep(60);
    if (inst.__error || !inst.id) return null;
    return { creator: label, index: i, id, name: inst.metadata?.name, description: inst.metadata?.description, image: inst.image_url || inst.metadata?.image, animation: inst.animation_url, metadata: inst.metadata, holders: null };
  });
  const hits = res.filter(Boolean);
  console.log(label, 'found', hits.length, 'max index', Math.max(...hits.map(h=>h.index)));
  found.push(...hits);
}
fs.writeFileSync('raw/os-scan.json', JSON.stringify(found, null, 2));
console.log('total', found.length);
