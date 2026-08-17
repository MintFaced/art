import fs from 'fs';
const html = fs.readFileSync('ordaddr.html','utf8');
const ids = [...new Set(html.match(/[0-9a-f]{64}i[0-9]+/g))];
const known = new Set(JSON.parse(fs.readFileSync('raw/recursive-mind.json','utf8')).map(x=>x.id));
console.log('inscriptions at artist ordinals address:', ids.length, '| new (not on rrrecursive.com):', ids.filter(i=>!known.has(i)).length);
const out = [];
for (const id of ids) {
  const r = await fetch('https://ordinals.com/r/inscription/'+id).then(r=>r.json()).catch(e=>({error:String(e)}));
  let meta = null;
  if ((r.content_type||'').includes('json') || (r.content_type||'').includes('text')) {
    meta = await fetch('https://ordinals.com/content/'+id).then(r=>r.text()).catch(()=>null);
    if (meta) meta = meta.slice(0,300);
  }
  out.push({ id, number: r.number, content_type: r.content_type, height: r.height, ts: r.timestamp? new Date(r.timestamp*1000).toISOString():null, address: r.address, known: known.has(id), preview: meta });
  console.log(String(r.number).padEnd(10), (r.content_type||'').padEnd(16), r.timestamp? new Date(r.timestamp*1000).toISOString().slice(0,10):'', known.has(id)?'(recursive-mind)':'(NEW)', meta?JSON.stringify(meta).slice(0,90):'');
}
fs.writeFileSync('raw/ord-address.json', JSON.stringify(out,null,2));
