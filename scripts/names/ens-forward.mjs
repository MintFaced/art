#!/usr/bin/env node
/* The forward-resolution pass, over the whole register.
 *
 * Asks the ENS subgraph which names point at each wallet that has no name from
 * a stronger tier, and writes down the ones where exactly one does. Run daily
 * by the ownership cron, which is what re-verifies them: a name re-pointed
 * somewhere else simply does not come back on the next pass.
 *
 *   node scripts/names/ens-forward.mjs --dry     ... report, write nothing
 *   node scripts/names/ens-forward.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { forwardPass } from '../../api/_lib/ens.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const DRY = process.argv.includes('--dry');
const load = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

const register = load('data/collectors-register.json');
const col = Object.fromEntries(register.fields.map((f, i) => [f, i]));
const rows = register.rows.map((r) => ({
  address: String(r[col.address]).toLowerCase(),
  name: r[col.name] || '',
  ens: r[col.ens] || '',
  private: Boolean(r[col.private]),
  tao: Number(r[col.tao]) || 0,
  rank: Number(r[col.rank]) || 0,
}));

/* Who is not asked about. A wallet the chain already names, or one Ryan has
   written down, is named by a stronger tier and stays that way whatever any
   pointer says. A private collector is not named at all. */
const skip = new Set(rows.filter((r) => r.ens || r.name || r.private).map((r) => r.address));
const all = rows.map((r) => r.address);

console.log(`Register: ${all.length} wallets`);
console.log(`  already named by a stronger tier: ${skip.size}`);
console.log(`  asking the subgraph about: ${all.length - skip.size}\n`);

const t0 = Date.now();
const pass = await forwardPass(all, { skip });
const secs = ((Date.now() - t0) / 1000).toFixed(1);

const named = Object.entries(pass.names)
  .map(([address, name]) => ({ ...rows.find((r) => r.address === address), fwd: name }))
  .sort((a, b) => (b.tao || 0) - (a.tao || 0));

console.log(`Named by forward resolution: ${pass.counts.named}   (${secs}s)`);
for (const r of named.slice(0, 40)) {
  console.log(`  ${r.fwd.padEnd(28)} ${r.address}  ${String(r.tao).padStart(9)} TAO  rank ${r.rank}`);
}
if (named.length > 40) console.log(`  ... and ${named.length - 40} more`);

const amb = Object.entries(pass.ambiguous)
  .map(([address, names]) => ({ ...rows.find((r) => r.address === address), names }))
  .sort((a, b) => (b.tao || 0) - (a.tao || 0));
console.log(`\nFell through as ambiguous: ${pass.counts.ambiguous}`);
for (const r of amb.slice(0, 15)) {
  console.log(`  ${r.address}  ${String(r.tao).padStart(9)} TAO  ${r.names.length} names: ${r.names.slice(0, 4).join(', ')}${r.names.length > 4 ? ' …' : ''}`);
}
if (amb.length > 15) console.log(`  ... and ${amb.length - 15} more`);
console.log(`\nStill a bare address: ${all.length - skip.size - pass.counts.named - pass.counts.ambiguous}`);

const file = {
  _note: 'Names that resolve forward to a wallet which publishes no reverse record. One name or none: a wallet two names point at is left as an address. Rebuilt by the daily ownership sweep, which is what re-verifies them. See docs/NAMES.md.',
  generated: new Date().toISOString(),
  source: 'ens-subgraph',
  counts: pass.counts,
  names: Object.fromEntries(Object.entries(pass.names).sort(([a], [b]) => a.localeCompare(b))),
  ambiguous: Object.fromEntries(Object.entries(pass.ambiguous).sort(([a], [b]) => a.localeCompare(b))),
};
if (DRY) {
  console.log('\n--dry: nothing written');
} else {
  fs.writeFileSync(path.join(ROOT, 'data/ens-forward.json'), JSON.stringify(file, null, 1) + '\n');
  console.log('\nwrote data/ens-forward.json');
}
