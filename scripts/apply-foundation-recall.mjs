#!/usr/bin/env node
/* Bring the catalogue back in line after a Foundation recall.
 *
 * The nightly sweep will not do this, by design: putting a work back on sale
 * is the one change it is forbidden to make on its own, because a token
 * arriving in the artist's wallet looks the same whether it was recalled
 * deliberately or moved by accident. Recalling and relisting is Ryan saying
 * which, so this runs by hand and says exactly what it changed.
 *
 * Chain ownership decides, not the listing file. A work is only returned to
 * artist-held if the artist actually holds it now.
 *
 *   node scripts/apply-foundation-recall.mjs --dry
 *   node scripts/apply-foundation-recall.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DRY = process.argv.includes('--dry');
const RPC = process.env.ETH_RPC || 'https://ethereum-rpc.publicnode.com';
const ESCROW = '0xcda72070e455bb31c7690a170224ce43623d0b6f';
const ARTIST = {
  '0xd40b63bf04a44e43fbfe5784bcf22acaab34a180': 'mintface.eth',
  '0xdd6b80649e8d472eb8fb52eb7eecfd2dc219ace7': 'ryanj.eth',
  '0x7110733ab02b2a18a947e3912bf54136fbced169': 'mintfaced.eth',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const word = (v) => BigInt(v).toString(16).padStart(64, '0');
const addrWord = (a) => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');

async function ethCall(to, data) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }) });
      const j = await r.json();
      if (j.result && j.result !== '0x') return j.result;
      if (j.error) return null;
    } catch (e) { /* retry */ }
    await sleep(350 * (i + 1));
  }
  return null;
}
// 721 has an owner; 1155 has a balance, so ask the right question of each
async function holder(d) {
  if (d.standard === 'ERC-1155') {
    const bal = await ethCall(d.contract, '0x00fdd58e' + addrWord(ESCROW) + word(d.token_id));
    return bal && BigInt(bal) > 0n ? ESCROW : 'elsewhere';
  }
  const r = await ethCall(d.contract, '0x6352211e' + word(d.token_id));
  return r ? ('0x' + r.slice(-40)).toLowerCase() : null;
}

const marked = [];
for (const f of fs.readdirSync(path.join(ROOT, 'data/c')).filter((n) => n.endsWith('.json'))) {
  const col = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/c', f), 'utf8'));
  if (col.slug === 'the-vault') continue;
  for (const w of [...(col.works || []), ...(col.children || []).flatMap((c) => c.works || [])]) {
    const onFoundation = w.held_by === 'Foundation market escrow' || w.listed_on === 'Foundation';
    if (onFoundation && (w.digital || {}).contract) marked.push({ slug: col.slug, w });
  }
}
console.log(`${marked.length} works carry a Foundation marker`);

const recalled = [], stillEscrow = [], sold = [], unknown = [];
for (const m of marked) {
  const h = await holder(m.w.digital);
  await sleep(80);
  if (!h) { unknown.push(m); continue; }
  if (h === ESCROW) { stillEscrow.push(m); continue; }
  if (ARTIST[h]) { recalled.push({ ...m, name: ARTIST[h] }); continue; }
  sold.push({ ...m, owner: h });
}

if (!DRY) {
  const files = new Map();
  const load = (slug) => {
    if (!files.has(slug)) {
      const p = path.join(ROOT, `data/c/${slug}.json`);
      files.set(slug, { p, raw: fs.readFileSync(p, 'utf8'), data: JSON.parse(fs.readFileSync(p, 'utf8')) });
    }
    return files.get(slug);
  };
  const findWork = (slug, id) => {
    const d = load(slug).data;
    return (d.works || []).find((x) => x.id === id)
      || (d.children || []).flatMap((c) => c.works || []).find((x) => x.id === id);
  };
  for (const r of recalled) {
    const w = findWork(r.slug, r.w.id);
    if (!w) continue;
    w.held_by = r.name;
    w.listed_on = null;
    // it was already available; the marker was the only thing wrong
    if (w.status !== 'available') w.status = 'available';
  }
  // a work that quietly sold out of escrow is not returned to sale by this
  for (const s of sold) {
    const w = findWork(s.slug, s.w.id);
    if (!w) continue;
    w.listed_on = null;
  }
  for (const { p, raw, data } of files.values()) fs.writeFileSync(p, JSON.stringify(data, null, 1) + (raw.endsWith('\n') ? '\n' : ''));
}

const byCol = (list) => {
  const o = {};
  for (const x of list) o[x.slug] = (o[x.slug] || 0) + 1;
  return Object.entries(o).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ${n}`).join(', ');
};
console.log(DRY ? '\nDRY RUN' : '\nWROTE');
console.log(`  recalled to the artist: ${recalled.length}   ${byCol(recalled)}`);
console.log(`  still in escrow:        ${stillEscrow.length}   ${byCol(stillEscrow)}`);
console.log(`  sold out of escrow:     ${sold.length}   ${byCol(sold)}`);
console.log(`  could not be read:      ${unknown.length}   ${byCol(unknown)}`);
for (const s of sold) console.log(`    SOLD ${s.w.id} -> ${s.owner} (left alone, the sweep will attribute it)`);
for (const u of unknown) console.log(`    UNREAD ${u.w.id}`);
