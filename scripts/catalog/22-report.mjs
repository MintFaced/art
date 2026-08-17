import fs from 'fs';
const cat = JSON.parse(fs.readFileSync(new URL('../../catalog.json', import.meta.url).pathname, 'utf8'));
const row = (c) => {
  const w = c.works || [];
  const t = {};
  for (const x of w) t[x.status] = (t[x.status] || 0) + 1;
  const contract = (c.contracts || [])[0] || {};
  const addr = contract.address || contract.asset || contract.wallet || '';
  return `| ${c.title} | ${w.length} | ${t.available || 0} | ${t.acquired || 0} | ${t.vaulted || 0} | ${t.burned || 0} | \`${addr}\` |`;
};
const lines = [];
lines.push('| Collection | Works | Available | Acquired | Vaulted | Burned | Contract |');
lines.push('|---|---:|---:|---:|---:|---:|---|');
for (const c of cat.collections) if ((c.works || []).length) lines.push(row(c));
const total = cat.collections.reduce((n, c) => n + (c.works || []).length + (c.children ? c.children.reduce((s, ch) => s + (ch.works?.length || 0), 0) : 0), 0);
lines.push(`\n**${total} work records enumerated.**`);
fs.writeFileSync('report-table.md', lines.join('\n'));
console.log(lines.join('\n'));
