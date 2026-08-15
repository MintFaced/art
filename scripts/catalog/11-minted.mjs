import { bsPaged } from './lib.mjs';
import fs from 'fs';
const C = '0xa81f8083072F192948dcaE38DA5c0C6073DA979c';
const items = await bsPaged(`/tokens/${C}/instances`);
console.log('total instances', items.length);
const by = {};
for (const it of items) { const n = it.metadata?.name || '(none)'; by[n] = (by[n]||0)+1; }
for (const [n,c] of Object.entries(by).sort((a,b)=>b[1]-a[1]).slice(0,20)) console.log(' ['+c+']', JSON.stringify(n).slice(0,70));
fs.writeFileSync('raw/minted-all.json', JSON.stringify({ contract: C, items }, null, 2));
const gm = items.filter(i => /Geodetic Memory/i.test(i.metadata?.name||''));
const owners = {};
for (const t of gm) { const o = t.owner?.ens_domain_name || t.owner?.hash; owners[o]=(owners[o]||0)+1; }
console.log('Geodetic Memory tokens:', gm.length);
console.log('top owners:', Object.entries(owners).sort((a,b)=>b[1]-a[1]).slice(0,10));
