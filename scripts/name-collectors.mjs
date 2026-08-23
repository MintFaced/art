#!/usr/bin/env node
/* Put names to the addresses in the register.
 *
 * Two faults, both of which leave a real collector reading as a bare 0x:
 *
 *   reverse missed   Enumeration took names from Blockscout, which only knows a
 *                    name if the address has set a reverse record and the
 *                    indexer has caught it. Asking a resolver directly finds
 *                    names Blockscout does not have.
 *
 *   reverse absent   firstladyart.eth resolves forward to its wallet but that
 *                    wallet publishes no reverse record, so no amount of asking
 *                    address-to-name will ever return it. The name is only
 *                    knowable from the other end ... and Ryan already wrote it
 *                    down in the overlay. So the overlay's own .eth names are
 *                    resolved forward and matched to the addresses they land on.
 *
 * Names are written onto the work records, which is where the register reads
 * them from. Nothing here invents a name: every one is either published on
 * chain or was recorded by Ryan.
 *
 *   node scripts/name-collectors.mjs --dry
 *   node scripts/name-collectors.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DRY = process.argv.includes('--dry');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ens(q) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`https://api.ensideas.com/ens/resolve/${encodeURIComponent(q)}`);
      if (r.ok) return r.json();
      if (r.status === 404) return null;
    } catch (e) { /* retry */ }
    await sleep(500 * (i + 1));
  }
  return null;
}

const load = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const reg = load('data/collectors.json');

// ---- 1. the names Ryan already wrote down, resolved forward
const overlay = load('data/source/overlay.json').works || {};
const written = new Set();
for (const v of Object.values(overlay)) {
  for (const n of [v.collector_display_name, (v.physical || {}).collector]) {
    if (typeof n === 'string' && /\.eth$/i.test(n.trim())) written.add(n.trim().toLowerCase());
  }
}
const byName = new Map();
for (const n of written) {
  const j = await ens(n);
  await sleep(260);
  if (j && j.address) byName.set(String(j.address).toLowerCase(), n);
}
console.log(`overlay names resolved forward: ${byName.size} of ${written.size}`);

// ---- 2. the addresses in the register with no name, asked directly
const unnamed = reg.collectors.filter((c) => !c.ens && !c.display_name).map((c) => c.address);
console.log(`registered addresses without a name: ${unnamed.length}`);
const byAddr = new Map();
let n = 0;
for (const a of unnamed) {
  if (byName.has(a)) continue;                 // already named from the overlay
  const j = await ens(a);
  await sleep(240);
  if (j && j.name) byAddr.set(a, j.name);
  if (++n % 50 === 0) process.stderr.write(`  asked ${n}/${unnamed.length}, found ${byAddr.size}\n`);
}
console.log(`reverse records Blockscout had missed: ${byAddr.size}`);

// ---- write them onto the work records the register reads
let touched = 0;
for (const f of fs.readdirSync(path.join(ROOT, 'data/c')).filter((x) => x.endsWith('.json'))) {
  const p = path.join(ROOT, 'data/c', f);
  const raw = fs.readFileSync(p, 'utf8');
  const d = JSON.parse(raw);
  let changed = false;
  const put = (row) => {
    const a = String(row.address || '').toLowerCase();
    if (!a) return;
    const ensName = byAddr.get(a);
    const given = byName.get(a);
    if (ensName && !row.ens) { if (!DRY) row.ens = ensName; changed = true; touched++; }
    // a name Ryan recorded is a display name, not a claim about reverse records
    if (given && !row.display_name) { if (!DRY) row.display_name = given; changed = true; touched++; }
  };
  for (const w of d.works || []) {
    if (w.collector) put(w.collector);
    for (const h of w.holders || []) put(h);
  }
  if (changed && !DRY) fs.writeFileSync(p, JSON.stringify(d, null, 1) + (raw.endsWith('\n') ? '\n' : ''));
}
console.log(`${DRY ? 'would name' : 'named'} ${touched} rows`);
