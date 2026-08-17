import fs from 'fs';
const html = fs.readFileSync('rrr.html','utf8');
const ids = [...new Set(html.match(/[0-9a-f]{64}i[0-9]+/g))];
// title/subtitle context from the page
const meta = {};
for (const id of ids) {
  const i = html.indexOf(id);
  const ctx = html.slice(Math.max(0, i - 600), i);
  const thought = ctx.match(/class="style1">([^<]+)</g)?.pop()?.replace(/.*>/, '').replace(/<+$/, '').trim();
  const title = ctx.match(/class="style5">([^<]+)</g)?.pop()?.replace(/.*>/, '').replace(/<+$/, '').trim();
  const sub = ctx.match(/class="style3">([^<]+)</g)?.pop()?.replace(/.*>/, '').replace(/<+$/, '').trim();
  meta[id] = { thought, title, sub };
}
const out = [];
for (const id of ids) {
  const r = await fetch('https://ordinals.com/r/inscription/' + id).then(r => r.json()).catch(e => ({ error: String(e) }));
  out.push({ id, ...meta[id], inscription_number: r.number, sat: r.sat, address: r.address, content_type: r.content_type, content_length: r.content_length, genesis_height: r.height, genesis_timestamp: r.timestamp ? new Date(r.timestamp * 1000).toISOString() : null, charms: r.charms, fee: r.fee, value: r.value });
  console.log(String(r.number).padEnd(10), (meta[id].title||'').padEnd(18), (meta[id].thought||'').padEnd(14), r.address, r.timestamp ? new Date(r.timestamp*1000).toISOString().slice(0,10) : '');
}
out.sort((a,b)=> (a.inscription_number||0)-(b.inscription_number||0));
fs.writeFileSync('raw/recursive-mind.json', JSON.stringify(out, null, 2));
const addrs = {};
for (const o of out) addrs[o.address] = (addrs[o.address]||0)+1;
console.log('\nowner addresses:', addrs);
