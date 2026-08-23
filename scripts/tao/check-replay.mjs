#!/usr/bin/env node
/* Does the history reproduce the present?
 *
 * TAO is only as good as the ownership history under it, and a history is easy
 * to get subtly wrong: a missed log, a mis-parsed batch transfer, a token id
 * read from the wrong word. None of that is visible in the event file itself,
 * which looks perfectly well-formed either way.
 *
 * So the events are replayed from the beginning and the balances they end at
 * are compared with the holders the catalogue already knows, which were
 * gathered independently by the ownership sweep. Two methods agreeing is
 * evidence. One method agreeing with itself is not.
 *
 *   node scripts/tao/check-replay.mjs [--verbose]
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const VERBOSE = process.argv.includes('--verbose');
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/source/tao.json'), 'utf8'));
const skip = new Set(CFG.scope.exclude_collections);
const BURN = new Set(['0x0000000000000000000000000000000000000000', '0x000000000000000000000000000000000000dead']);
/* Only collectors are compared. The catalogue deliberately records no holder
   for a work the artist still has, or one sitting in the vault or in market
   escrow ... "available" is not a person. Counting those as a disagreement
   would bury the real ones, which is exactly what it did on the first run. */
const NOBODY = new Set(Object.keys(CFG.exclusions).filter((k) => k.startsWith('0x')));

// ---- what the catalogue says is held now
const known = new Map();        // contract|token -> Map(addr -> qty)
const meta = new Map();
for (const f of fs.readdirSync(path.join(ROOT, 'data/c')).filter((n) => n.endsWith('.json'))) {
  const col = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/c', f), 'utf8'));
  if (skip.has(col.slug)) continue;
  for (const w of [...(col.works || []), ...(col.children || []).flatMap((c) => c.works || [])]) {
    const d = w.digital || {};
    if (d.chain !== 'ethereum' || !d.contract || d.token_id == null) continue;
    /* Compared per work, not per token id. An edition minted as ERC-721 is one
       work over many ids, and the catalogue records its holders once for the
       whole edition ... comparing those against one id's holders reported 57
       of 72 Seize And Share editions as wrong when every one of them was
       right. */
    const ids = w.token_ids && w.token_ids.length ? w.token_ids : [d.token_id];
    const c = d.contract.toLowerCase();
    meta.set(w.id, { work: w.id, collection: col.slug, unique: !((w.edition || {}).type && w.edition.type !== '1/1'),
      status: w.status, keys: ids.map((id) => `${c}|${id}`) });
    const m = new Map();
    if (w.collector && w.collector.address) m.set(w.collector.address.toLowerCase(), 1);
    for (const h of w.holders || []) if (h.address) m.set(h.address.toLowerCase(), Number(h.qty) || 1);
    known.set(w.id, m);
  }
}

// ---- what the events say is held now
const replayed = new Map();
let events = 0;
for (const f of fs.readdirSync(path.join(ROOT, 'data/tao/e')).filter((n) => n.endsWith('.json'))) {
  const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/tao/e', f), 'utf8'));
  const c = d.contract;
  for (const [token, from, to, qty] of d.events) {
    events++;
    const k = `${c}|${token}`;
    if (!replayed.has(k)) replayed.set(k, new Map());
    const m = replayed.get(k);
    const q = Number(qty) || 1;
    if (from && !BURN.has(from)) m.set(from, (m.get(from) || 0) - q);
    if (to && !BURN.has(to)) m.set(to, (m.get(to) || 0) + q);
  }
}
for (const m of replayed.values()) for (const [a, q] of m) if (q <= 0 || NOBODY.has(a)) m.delete(a);

// ---- compare
let agree = 0;
const wrong = [];
const byCollection = new Map();
for (const [k, want] of known) {
  const m = meta.get(k);
  // every token id belonging to this work, added together
  const got = new Map();
  for (const tk of m.keys) {
    for (const [a, q] of replayed.get(tk) || new Map()) got.set(a, (got.get(a) || 0) + q);
  }
  for (const [a, q] of got) if (q <= 0) got.delete(a);
  const holders = [...want.keys()].filter((a) => !NOBODY.has(a));
  const same = holders.length === got.size && holders.every((a) => got.get(a) === want.get(a));
  const slug = m.collection;
  if (!byCollection.has(slug)) byCollection.set(slug, { ok: 0, bad: 0 });
  if (same) { agree++; byCollection.get(slug).ok++; continue; }
  byCollection.get(slug).bad++;
  wrong.push({ k, work: m.work, collection: slug, unique: m.unique, status: m.status,
    want: [...want].filter(([a]) => !NOBODY.has(a)).map(([a, q]) => `${a.slice(0, 10)}:${q}`).join(' '),
    got: [...got].map(([a, q]) => `${a.slice(0, 10)}:${q}`).join(' ') });
}

console.log(`${events} events replayed over ${known.size} tokens`);
console.log(`${agree} tokens agree with the catalogue, ${wrong.length} disagree\n`);
for (const [slug, v] of [...byCollection].sort((a, b) => b[1].bad - a[1].bad)) {
  if (v.bad) console.log(`  ${slug.padEnd(22)} ${String(v.bad).padStart(4)} of ${v.ok + v.bad} disagree`);
}
if (VERBOSE) for (const w of wrong.slice(0, 40)) {
  console.log(`\n  ${w.work} (${w.status}${w.unique ? '' : ', edition'})\n    catalogue: ${w.want || '(none)'}\n    replay:    ${w.got || '(none)'}`);
}
console.log(`\n${((agree / known.size) * 100).toFixed(1)}% agreement`);
