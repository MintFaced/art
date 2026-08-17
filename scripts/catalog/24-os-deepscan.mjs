// The 22 unlocated Geodetic Moments: brute the OpenSea storefront id space.
// id = creator(20 bytes) + index(7 bytes) + supply(5 bytes)
import { getJSON, BS, mapLimit, sleep } from './lib.mjs';
import fs from 'fs';
const OS = '0x495f947276749Ce646f68AC8c248420045cb7b5e';
const wallets = JSON.parse(fs.readFileSync('wallets.json', 'utf8'));
const creator = wallets['ryanj.eth'].toLowerCase().replace(/^0x/, '');
const known = JSON.parse(fs.readFileSync('raw/os-scan.json', 'utf8'));
const knownIdx = new Set(known.map((k) => k.index));

const mkId = (i, supply) => BigInt('0x' + creator + i.toString(16).padStart(14, '0') + supply.toString(16).padStart(10, '0')).toString();

const jobs = [];
for (let i = 401; i <= 1500; i++) jobs.push([i, 1]);                    // longer index range
for (let i = 1; i <= 400; i++) if (!knownIdx.has(i))
  for (const s of [2, 3, 4, 5, 10, 20, 25, 50, 100]) jobs.push([i, s]); // edition supplies at unused indices
console.log('probes:', jobs.length);

const hits = [];
let n = 0;
await mapLimit(jobs, 5, async ([i, s]) => {
  const id = mkId(i, s);
  const inst = await getJSON(`${BS}/tokens/${OS}/instances/${id}`, { tries: 2, timeout: 25000 });
  if (++n % 400 === 0) console.log('  ', n, '/', jobs.length, 'hits', hits.length);
  if (inst.__error || !inst.id) return;
  hits.push({ index: i, supply: s, id, name: inst.metadata?.name, image: inst.image_url || inst.metadata?.image, animation: inst.animation_url, description: inst.metadata?.description, metadata: inst.metadata });
  console.log('   HIT idx', i, 'supply', s, JSON.stringify(inst.metadata?.name));
  await sleep(40);
});
fs.writeFileSync('raw/os-deepscan.json', JSON.stringify(hits, null, 2));
console.log('DONE. new tokens:', hits.length);
