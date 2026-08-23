#!/usr/bin/env node
/* Show the working.
 *
 * A metric nobody can check by hand is a metric nobody should trust. This
 * picks four wallets that between them exercise every rule ... a long 1/1
 * holder, an edition-heavy holder, someone who sold, someone who gave art
 * away ... and prints the arithmetic behind each total, with the sale or
 * transfer verdict that decided it.
 *
 * Then it puts the top ten by TAO beside the top ten by works held. Those
 * lists diverging is the metric working: time held is not quantity bought.
 *
 *   node scripts/tao/report.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const load = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const CFG = load('data/source/tao.json');
const tao = load('data/tao.json');
const exits = load('data/tao/exits.json').exits;
const reg = load('data/collectors.json');
const DAY = 86400;

const name = new Map(reg.collectors.map((c) => [c.address, c.display_name || c.ens || c.address.slice(0, 10)]));
const who = (a) => name.get(a) || a.slice(0, 12);
const n = (x) => Math.round(x).toLocaleString('en-NZ');

const works = new Map();
const skip = new Set(CFG.scope.exclude_collections);
for (const f of fs.readdirSync(path.join(ROOT, 'data/c')).filter((x) => x.endsWith('.json'))) {
  const col = load(`data/c/${f}`);
  if (skip.has(col.slug)) continue;
  for (const w of [...(col.works || []), ...(col.children || []).flatMap((c) => c.works || [])]) {
    works.set(w.id, { title: w.title || w.id, unique: !((w.edition || {}).type && w.edition.type !== '1/1') });
  }
}

const rows = Object.entries(tao.wallets).map(([address, v]) => ({ address, ...v }));
const byTao = rows.slice().sort((a, b) => b.tao - a.tao);
const exitsBy = new Map();
for (const e of exits) {
  if (!exitsBy.has(e.address)) exitsBy.set(e.address, []);
  exitsBy.get(e.address).push(e);
}

/* ---------- four wallets, chosen for what they prove ---------- */
/* Four different people. Taking the first match each time returned the wallet
   at the top of the board four times over, which demonstrates nothing. */
const taken = new Set();
const pick = (label, test, rank) => {
  const pool = byTao.filter((w) => !taken.has(w.address) && test(w));
  const hit = rank ? pool.slice().sort(rank)[0] : pool[0];
  if (hit) taken.add(hit.address);
  return hit ? { label, w: hit } : null;
};
const unique = (id) => works.get(id) && works.get(id).unique;
const chosen = [
  pick('a long holder of 1/1s', (w) => Object.keys(w.works).some(unique) && w.tao > 50000),
  pick('an edition-heavy holder', (w) => Object.keys(w.works).length > 3 && !Object.keys(w.works).some(unique)),
  // the one with the most to lose, so the subtraction is visible
  pick('someone who sold', (w) => w.sales > 0 && w.lost > 0, (a, b) => b.lost - a.lost),
  // accrual stopped but the days stayed: the rule that rewards giving
  pick('someone who gave art away', (w) => (exitsBy.get(w.address) || []).some((e) => e.verdict === 'transfer' && e.tao > 0),
    (a, b) => (a.rate === 0 ? -1 : 0) - (b.rate === 0 ? -1 : 0)
      || (exitsBy.get(b.address) || []).reduce((n, e) => n + (e.verdict === 'transfer' ? e.tao : 0), 0)
       - (exitsBy.get(a.address) || []).reduce((n, e) => n + (e.verdict === 'transfer' ? e.tao : 0), 0)),
].filter(Boolean);

console.log('FOUR WALLETS, WITH THE ARITHMETIC\n' + '='.repeat(72));
for (const { label, w } of chosen) {
  console.log(`\n${who(w.address)}  ...  ${label}`);
  console.log(`  ${w.address}`);
  let sum = 0;
  const list = Object.entries(w.works).sort((a, b) => b[1] - a[1]);
  for (const [id, v] of list.slice(0, 8)) {
    const meta = works.get(id) || { title: id, unique: true };
    const rate = meta.unique ? CFG.rates.unique_per_day : CFG.rates.edition_copy_per_day;
    console.log(`    ${String(n(v)).padStart(9)}  ${meta.unique ? '1/1     ' : 'edition '} ${String(Math.round(v / rate)).padStart(5)} copy-days at ${rate}/day   ${meta.title.slice(0, 34)}`);
    sum += v;
  }
  if (list.length > 8) console.log(`    ${String(n(list.slice(8).reduce((a, b) => a + b[1], 0))).padStart(9)}  and ${list.length - 8} more works`);
  console.log(`    ${'-'.repeat(9)}`);
  console.log(`    ${String(n(w.tao)).padStart(9)}  TAO, accruing +${w.rate}/day`);
  const ex = (exitsBy.get(w.address) || []).sort((a, b) => b.at - a.at).slice(0, 4);
  if (ex.length) {
    console.log('    what has left:');
    for (const e of ex) {
      const d = new Date(e.at * 1000).toISOString().slice(0, 10);
      const verdict = e.verdict === 'sale' ? `SALE ... ${n(e.tao)} TAO taken back` : `transfer ... ${n(e.tao)} TAO kept`;
      console.log(`      ${d}  ${String(e.work || e.token).slice(0, 30).padEnd(32)} ${verdict}`);
    }
  }
  if (w.lost) console.log(`    ${n(w.lost)} TAO lost to ${w.sales} sale${w.sales === 1 ? '' : 's'} in total`);
}

/* ---------- the two leaderboards ---------- */
const byWorks = reg.collectors.slice().sort((a, b) => b.counts.works - a.counts.works);
console.log('\n\nTOP TEN, TWO WAYS\n' + '='.repeat(72));
console.log('  by TAO (time held)                          by works held (quantity)');
for (let i = 0; i < 10; i++) {
  const a = byTao[i], b = byWorks[i];
  const l = a ? `${String(i + 1).padStart(2)}. ${who(a.address).slice(0, 22).padEnd(23)} ${String(n(a.tao)).padStart(10)}` : '';
  const r = b ? `${String(i + 1).padStart(2)}. ${String(b.display_name || b.ens || b.address.slice(0, 10)).slice(0, 22).padEnd(23)} ${String(b.counts.works).padStart(5)}` : '';
  console.log('  ' + l.padEnd(44) + r);
}
const topTao = new Set(byTao.slice(0, 10).map((w) => w.address));
const topWorks = new Set(byWorks.slice(0, 10).map((c) => c.address));
const overlap = [...topTao].filter((a) => topWorks.has(a)).length;
console.log(`\n  ${overlap} of 10 appear on both lists. The divergence is the metric working.`);

/* ---------- anything absurd ---------- */
console.log('\n\nSANITY\n' + '='.repeat(72));
/* The ceiling has to allow for copies. An edition holder with thirty copies of
   one work legitimately earns thirty times what one copy earns, so a per-wallet
   ceiling of one-copy-per-work flags honest collectors and hides real faults.
   The invariant that actually holds: no work can pay out for more copies than
   were ever minted, and a 1/1 is one copy by definition. */
// the oldest event, not the oldest exit: art is minted long before any of it
// leaves, and dating the ceiling from the first exit makes it too tight
let oldest = Infinity;
for (const f of fs.readdirSync(path.join(ROOT, 'data/tao/e')).filter((x) => x.endsWith('.json'))) {
  for (const e of load(`data/tao/e/${f}`).events) if (e[4] && e[4] < oldest) oldest = e[4];
}
const maxDays = Math.ceil((Date.now() / 1000 - oldest) / DAY);
const minted = new Map();
for (const f of fs.readdirSync(path.join(ROOT, 'data/c')).filter((x) => x.endsWith('.json'))) {
  const col = load(`data/c/${f}`);
  if (skip.has(col.slug)) continue;
  for (const w of [...(col.works || []), ...(col.children || []).flatMap((c) => c.works || [])]) {
    // some records give the edition size as `of` and never counted a mint
    const ed = w.edition || {};
    minted.set(w.id, ed.minted || ed.of || 1);
  }
}
const impossible = [];
for (const w of byTao) {
  for (const [id, v] of Object.entries(w.works)) {
    const meta = works.get(id);
    if (!meta) continue;
    const cap = maxDays * (meta.unique ? CFG.rates.unique_per_day : CFG.rates.edition_copy_per_day * (minted.get(id) || 1));
    if (v > cap * 1.02) impossible.push({ w, id, v, cap, title: meta.title });
  }
}
console.log(`  oldest event ${new Date(oldest * 1000).toISOString().slice(0, 10)}, ${maxDays} days ago`);
console.log(`  ${impossible.length} work contributions exceed what that work could ever have paid out`);
for (const x of impossible.slice(0, 8)) console.log(`    ${who(x.w.address)}  ${n(x.v)} on ${x.title} (ceiling ${n(x.cap)})`);
const rounded = byTao.filter((w) => w.tao > 0 && !Object.keys(w.works).length).length;
console.log(`  ${rounded} wallets show a total with no work breakdown ... held for under a day, floored to nothing per work`);
const noRate = byTao.filter((w) => w.tao > 0 && w.rate === 0).length;
console.log(`  ${noRate} wallets hold TAO but accrue nothing ... they gave art away rather than selling it`);
console.log(`  ${tao.counts.sales} sales took back ${n(tao.counts.tao_lost_to_sales)} TAO`);
console.log(`  ${n(tao.counts.tao_live)} TAO live across ${tao.counts.wallets} wallets`);
