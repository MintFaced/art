import { ensResolve, ensReverse } from './lib.mjs';
import fs from 'fs';
const names = ['mintface.eth', 'ryanj.eth', 'mintestate.eth', 'mintfaced.eth'];
const out = {};
for (const n of names) {
  const a = await ensResolve(n).catch((e) => 'ERR ' + e);
  out[n] = a;
  console.log(n, '→', a);
}
for (const [n, a] of Object.entries(out)) {
  if (a && a.startsWith('0x')) console.log('reverse', a, '→', await ensReverse(a).catch(e=>'ERR'+e));
}
fs.writeFileSync('wallets.json', JSON.stringify(out, null, 2));
