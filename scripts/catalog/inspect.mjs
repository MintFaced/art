import fs from 'fs';
for (const f of fs.readdirSync('raw').filter(f=>f.endsWith('.json'))) {
  const { contract, items } = JSON.parse(fs.readFileSync('raw/'+f,'utf8'));
  console.log('\n=== ' + contract.key + ' (' + items.length + ') ' + contract.address);
  const descs = {};
  for (const it of items) { const d = (it.metadata?.description||'').slice(0,70); descs[d]=(descs[d]||0)+1; }
  for (const [d,n] of Object.entries(descs)) console.log('   ['+n+'] desc: '+JSON.stringify(d));
  const sample = items.slice(0,4).concat(items.slice(-2));
  for (const it of sample) console.log('   #'+it.id, '|', JSON.stringify(it.metadata?.name), '| img', (it.image_url||'').slice(0,60), '| anim', (it.animation_url||'').slice(0,50), '| owner', it.owner?.ens_domain_name || it.owner?.hash || (it.__holders?.length+' holders'));
}
