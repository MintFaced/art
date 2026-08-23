#!/usr/bin/env node
/* Turn the ownership history into TAO.
 *
 * Reads the cached events, the sale classifications and the catalogue, hands
 * them to the engine, and writes data/tao.json. Every run recomputes from the
 * whole history ... no running total is stored anywhere, so nothing drifts and
 * the same events always give the same answer.
 *
 *   node scripts/tao/build.mjs [--dry]
 */
import fs from 'node:fs';
import path from 'node:path';
import { computeTao } from '../../api/_lib/tao.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const DRY = process.argv.includes('--dry');
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/source/tao.json'), 'utf8'));
const skip = new Set(CFG.scope.exclude_collections);

/* ---------- what each token is ----------
   An edition minted as ERC-721 is one work over many token ids: every id is a
   copy, so each accrues at the edition rate and they all report as one work. */
const tokens = new Map();
const works = new Map();
for (const f of fs.readdirSync(path.join(ROOT, 'data/c')).filter((n) => n.endsWith('.json'))) {
  const col = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/c', f), 'utf8'));
  if (skip.has(col.slug)) continue;
  for (const w of [...(col.works || []), ...(col.children || []).flatMap((c) => c.works || [])]) {
    const d = w.digital || {};
    if (!CFG.scope.chains.includes(d.chain) || !d.contract || d.token_id == null) continue;
    const unique = !((w.edition || {}).type && w.edition.type !== '1/1');
    const ids = w.token_ids && w.token_ids.length ? w.token_ids : [d.token_id];
    for (const id of ids) tokens.set(`${d.contract.toLowerCase()}|${id}`, { unique, work: w.id, collection: col.slug });
    works.set(w.id, { title: w.title || w.id, collection: col.slug, unique });
  }
}

/* ---------- the history ---------- */
let sales = { tx: {} };
try { sales = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/tao/sales.json'), 'utf8')); } catch (e) { /* none yet */ }

const events = [];
for (const f of fs.readdirSync(path.join(ROOT, 'data/tao/e')).filter((n) => n.endsWith('.json'))) {
  const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/tao/e', f), 'utf8'));
  for (const [token, from, to, qty, ts, block, tx] of d.events) {
    events.push({ contract: d.contract, token, from, to, qty: Number(qty) || 1, ts, block, tx,
      sale: Boolean(sales.tx[tx] && sales.tx[tx].sale) });
  }
}
// one timeline across every contract, oldest first
events.sort((a, b) => a.ts - b.ts || a.block - b.block);

const now = Math.floor(Date.now() / 1000);
const { wallets, exits } = computeTao(events, tokens, CFG, now);
const held = wallets.filter((w) => w.tao_total > 0);

const out = {
  _note: 'TAO, recomputed in full from data/tao/e on every run. Nothing here is edited by hand ... see docs/TAO.md.',
  generated: new Date(now * 1000).toISOString(),
  rates: CFG.rates,
  counts: {
    wallets: held.length,
    events: events.length,
    exits: exits.length,
    sales: exits.filter((e) => e.verdict === 'sale').length,
    transfers: exits.filter((e) => e.verdict === 'transfer').length,
    tao_live: held.reduce((n, w) => n + w.tao_total, 0),
    tao_lost_to_sales: wallets.reduce((n, w) => n + w.tao_lost, 0),
  },
  wallets: Object.fromEntries(held.map((w) => [w.address, {
    tao: w.tao_total, rate: w.tao_rate, lost: w.tao_lost, sales: w.sales, works: w.works,
  }])),
};

if (!DRY) {
  fs.writeFileSync(path.join(ROOT, 'data/tao.json'), JSON.stringify(out, null, 1));
  // the audit trail: every exit, its verdict, and what it cost
  fs.writeFileSync(path.join(ROOT, 'data/tao/exits.json'), JSON.stringify({
    _note: 'Every time art left a wallet, how it was classified, and the TAO that moved or was taken back.',
    generated: out.generated,
    exits: exits.sort((a, b) => b.at - a.at),
  }, null, 1));
}

console.log(DRY ? 'DRY RUN' : 'WROTE data/tao.json');
console.log(`  ${out.counts.events} events over ${tokens.size} token ids`);
console.log(`  ${out.counts.wallets} wallets hold TAO, ${out.counts.tao_live.toLocaleString('en-NZ')} live`);
console.log(`  ${out.counts.exits} exits: ${out.counts.sales} sales, ${out.counts.transfers} transfers`);
console.log(`  ${Math.round(out.counts.tao_lost_to_sales).toLocaleString('en-NZ')} TAO taken back by sales`);
console.log('\n  top 10 by TAO');
for (const w of held.slice(0, 10)) {
  console.log(`    ${w.address.slice(0, 12)}  ${String(w.tao_total).padStart(9)}  +${w.tao_rate}/day  ${Object.keys(w.works).length} works`);
}
