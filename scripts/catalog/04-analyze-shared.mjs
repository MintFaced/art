import fs from 'fs';
const wallets = JSON.parse(fs.readFileSync('wallets.json','utf8'));
const artist = new Set(Object.values(wallets).map(a=>a&&a.toLowerCase()));

// --- OpenSea shared storefront: token id encodes creator ---
const os = JSON.parse(fs.readFileSync('raw/shared-opensea-storefront.json','utf8'));
const mine = [];
for (const t of os.tokens) {
  const hex = BigInt(t.id).toString(16).padStart(64,'0');
  const creator = '0x' + hex.slice(0,40);
  const index = parseInt(hex.slice(40,54),16);
  const supply = parseInt(hex.slice(54,64),16);
  t.__creator = creator; t.__index = index; t.__supply = supply;
  if (artist.has(creator)) mine.push(t);
}
console.log('opensea storefront: artist-created tokens', mine.length, 'of', os.tokens.length);
const byCreator = {};
for (const t of mine) byCreator[t.__creator] = (byCreator[t.__creator]||0)+1;
console.log(' by creator', byCreator);
const names = {};
for (const t of mine) { const n=(t.instance?.metadata?.name||'(none)').replace(/\s*#\d+\s*$/,'').trim(); names[n]=(names[n]||0)+1; }
console.log(' artist works by base name:'); for(const [n,c] of Object.entries(names).sort((a,b)=>b[1]-a[1])) console.log('   ['+c+']', JSON.stringify(n));
fs.writeFileSync('os-artist-tokens.json', JSON.stringify(mine,null,2));

// --- Foundation / rarible / minted: show artist-relevant detail ---
for (const key of ['foundation','rarible-1155','rarible-721','minted-networked']) {
  const d = JSON.parse(fs.readFileSync(`raw/shared-${key}.json`,'utf8'));
  console.log('\n=== '+key);
  for (const t of d.tokens) {
    const m = t.instance?.metadata || {};
    const mint = t.transfers.find(x=>/^0x0+$/.test(x.from||''));
    const owner = t.instance?.owner?.ens_domain_name || t.instance?.owner?.hash;
    console.log('  id', String(t.id).slice(0,20), '|', JSON.stringify(m.name||'').slice(0,45), '| owner', owner, '| minted', mint? mint.ts : '-', '| by', mint? (mint.to_ens||mint.to) : '');
  }
}
