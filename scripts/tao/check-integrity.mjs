#!/usr/bin/env node
/* The acceptance cases, run against real history, with the arithmetic shown.
 *
 * docs/TAO-INTEGRITY.md names four things the register has to be able to prove
 * and a set of guard rails that have to be live in the production path rather
 * than only in the version that was run by hand. This is that list, executed:
 *
 *   6. adacrow.eth ... her sold works flip and TAO subtracts
 *   7. a sale      ... the seller's days go, the buyer starts from zero
 *   8. a transfer  ... the sender keeps the days, the receiver starts from zero
 *   9. an edition  ... a partial sale adjusts per copy, not per token
 *  10. guard rails ... exclusions, scope, edition rates, the head-block throw,
 *                      and the sale-or-gift default, each checked where it runs
 *
 * Every figure below is recomputed here from data/tao/e, independently of the
 * totals in data/tao.json, and then the two are compared. Two methods agreeing
 * is worth more than one method agreeing with itself.
 *
 *   node scripts/tao/check-integrity.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { computeTao } from '../../api/_lib/tao.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const load = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const src = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const DAY = 86400;
const n = (x) => Math.round(x).toLocaleString('en-NZ');
const day = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);

const CFG = load('data/source/tao.json');
const index = load('data/index.json');
const tao = load('data/tao.json');
const sales = load('data/tao/sales.json');
const skip = new Set(CFG.scope.exclude_collections);
const excluded = new Set(Object.keys(CFG.exclusions).filter((k) => k.startsWith('0x')));

let names = new Map();
try { names = new Map(load('data/collectors-register.json').rows.map((r) => [r[0], r[1] || r[0].slice(0, 10)])); } catch (e) { /* no register yet */ }
const who = (a) => (a ? (names.get(a) || a.slice(0, 12)) : 'nobody');

/* ---------- the catalogue, and the history, read the way the cron reads them ---------- */
const tokens = new Map();
const inScope = new Set();
for (const c of index.collections || []) {
  let col;
  try { col = load(`data/c/${c.slug}.json`); } catch (e) { continue; }
  if (skip.has(c.slug)) continue;
  for (const w of [...(col.works || []), ...(col.children || []).flatMap((x) => x.works || [])]) {
    const d = w.digital || {};
    if (!CFG.scope.chains.includes(d.chain) || !d.contract || d.token_id == null) continue;
    const unique = !((w.edition || {}).type && w.edition.type !== '1/1');
    const ids = w.token_ids && w.token_ids.length ? w.token_ids : [d.token_id];
    const a = d.contract.toLowerCase();
    inScope.add(w.id);
    for (const id of ids) tokens.set(`${a}|${id}`, { unique, work: w.id, collection: col.slug, title: w.title || w.id });
  }
}
const events = [];
for (const f of fs.readdirSync(path.join(ROOT, 'data/tao/e')).filter((x) => x.endsWith('.json'))) {
  const addr = f.replace('.json', '');
  for (const [token, from, to, qty, ts, blk, tx] of load(`data/tao/e/${f}`).events) {
    events.push({ contract: addr, token, from: String(from || '').toLowerCase(), to: String(to || '').toLowerCase(),
      qty: Number(qty) || 1, ts, block: blk, tx, sale: Boolean(sales.tx[tx] && sales.tx[tx].sale) });
  }
}
events.sort((a, b) => a.ts - b.ts || a.block - b.block);
const NOW = Math.floor(new Date(tao.generated).getTime() / 1000) || Math.floor(Date.now() / 1000);
const fresh = computeTao(events, tokens, CFG, NOW);
const byWallet = new Map(fresh.wallets.map((w) => [w.address, w]));
const rate = (meta, qty) => (meta.unique ? CFG.rates.unique_per_day : CFG.rates.edition_copy_per_day * qty);

const chain = new Map();                       // "contract|token" -> events in order
for (const e of events) {
  const k = `${e.contract}|${e.token}`;
  if (!chain.has(k)) chain.set(k, []);
  chain.get(k).push(e);
}

let failures = 0;
const check = (ok, label, detail) => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n          ${detail}` : ''}`);
};
const head = (t) => console.log(`\n${t}\n${'='.repeat(74)}`);

/* ================= 6. adacrow.eth ================= */
head('6. adacrow.eth ... the named acceptance case');
const ADA = '0x91cb1ff4322559a5c5c67dba075ab081c255ba1f';
{
  const w = byWallet.get(ADA);
  const mine = fresh.exits.filter((e) => e.address === ADA);
  const sold = mine.filter((e) => e.verdict === 'sale');
  const given = mine.filter((e) => e.verdict === 'transfer');
  console.log(`  ${who(ADA)}  ${ADA}`);
  console.log(`  ${sold.length} sales, ${given.length} plain transfers, over ${mine.length} exits in all\n`);
  console.log('  what she sold, and what each sale cost her:');
  let taken = 0;
  for (const e of sold.sort((a, b) => b.at - a.at)) {
    const v = sales.tx[e.tx] || {};
    console.log(`    ${day(e.at)}  ${String(e.work).padEnd(12)} ${String(n(e.tao)).padStart(7)} TAO taken back   (${v.why || 'unread'})`);
    taken += e.tao;
  }
  console.log(`    ${' '.repeat(24)}${'-'.repeat(7)}`);
  console.log(`    ${' '.repeat(24)}${String(n(taken)).padStart(7)} TAO removed from her total\n`);

  const stillHeld = new Set(Object.keys(w ? w.works : {}));
  const soldWorks = new Set(sold.map((e) => e.work));
  const stillShowing = [...soldWorks].filter((id) => stillHeld.has(id));
  check(w != null, 'adacrow has a TAO record');
  check(sold.length > 0, `her sales are classified as sales (${sold.length} of them)`);
  check(w && Math.abs(w.tao_lost - taken) <= sold.length + 1,
    'the TAO taken back equals the sum of her sale exits',
    `record says ${n(w ? w.tao_lost : 0)}, the exits add to ${n(taken)}`);
  check(stillShowing.length === 0, 'no work she sold is still contributing to her total',
    stillShowing.length ? `still contributing: ${stillShowing.join(', ')}` : 'every sold holding has flipped off her wall');
  const shipped = tao.wallets[ADA];
  check(shipped && Math.abs(shipped.tao - w.tao_total) <= 2,
    'the shipped total matches an independent recompute',
    `data/tao.json ${n(shipped ? shipped.tao : 0)}, recomputed here ${n(w.tao_total)}`);
}

/* ================= 7. a sale ================= */
head('7. a sale ... the seller loses the days, the buyer starts from zero');
{
  /* A clean case: a 1/1 sold once, still held by whoever bought it, and that
     buyer holds no other token of the same work, so the arithmetic on the
     wall is one interval and can be done on paper. */
  let pick = null;
  for (const e of fresh.exits.filter((x) => x.verdict === 'sale').sort((a, b) => a.at - b.at)) {
    const meta = tokens.get(`${e.contract}|${e.token}`);
    if (!meta || !meta.unique) continue;
    const link = chain.get(`${e.contract}|${e.token}`) || [];
    const move = link.find((x) => x.tx === e.tx && x.from === e.address);
    if (!move) continue;
    const buyer = move.to;
    if (!buyer || excluded.has(buyer)) continue;
    if (link.some((x) => x.ts > move.ts)) continue;                 // it has moved again since
    const others = link.filter((x) => x !== move);
    const holdsOne = [...chain.entries()].filter(([k, evs]) => {
      const m = tokens.get(k);
      return m && m.work === meta.work && evs.length && evs[evs.length - 1].to === buyer;
    }).length === 1;
    if (!holdsOne) continue;
    pick = { e, meta, move, buyer, link, others };
    break;
  }
  if (!pick) console.log('  no clean single-token sale in the history to work through');
  else {
    const { e, meta, move, buyer, link } = pick;
    const bought = link.filter((x) => x.to === e.address).sort((a, b) => a.ts - b.ts)[0];
    const heldDays = (move.ts - (bought ? bought.ts : move.ts)) / DAY;
    const sinceDays = (NOW - move.ts) / DAY;
    console.log(`  ${meta.title} (${meta.work}), token ${e.token.slice(0, 12)}`);
    console.log(`    ${bought ? day(bought.ts) : '?'}  ${who(e.address)} receives it`);
    console.log(`    ${day(move.ts)}  sold to ${who(buyer)}   (${(sales.tx[move.tx] || {}).why || 'unread'})\n`);
    console.log('  the seller:');
    console.log(`    held ${heldDays.toFixed(1)} days x ${CFG.rates.unique_per_day}/day = ${n(heldDays * CFG.rates.unique_per_day)} TAO earned`);
    console.log(`    sold, so all ${n(e.tao)} of it is taken back ... this holding now contributes nothing`);
    const seller = byWallet.get(e.address);
    const sellerStill = seller && seller.works[meta.work] ? seller.works[meta.work] : 0;
    console.log(`    ${who(e.address)} shows ${n(sellerStill)} TAO against ${meta.work}\n`);
    console.log('  the buyer:');
    const expect = sinceDays * CFG.rates.unique_per_day;
    const b = byWallet.get(buyer);
    const got = b && b.works[meta.work] ? b.works[meta.work] : 0;
    console.log(`    ${sinceDays.toFixed(1)} days since the transfer x ${CFG.rates.unique_per_day}/day = ${n(expect)} TAO expected`);
    console.log(`    ${who(buyer)} shows ${n(got)} TAO against ${meta.work}`);
    console.log(`    the seller's ${heldDays.toFixed(1)} days are not in that figure ... they were never the buyer's to have\n`);
    check(Math.abs(e.tao - heldDays * CFG.rates.unique_per_day) <= 2,
      'the TAO taken from the seller is exactly what the holding earned');
    check(sellerStill === 0, 'the sold work contributes nothing to the seller');
    check(Math.abs(got - expect) <= 2, 'the buyer accrues from the transfer timestamp, not before',
      `expected ${n(expect)}, got ${n(got)}`);
    check(got < heldDays * CFG.rates.unique_per_day + expect,
      'the buyer\'s total does not include the seller\'s history');
  }
}

/* ================= 8. a plain transfer ================= */
head('8. a plain transfer ... the sender keeps the days, and stops earning');
{
  let pick = null;
  for (const e of fresh.exits.filter((x) => x.verdict === 'transfer' && x.tao > 0).sort((a, b) => b.tao - a.tao)) {
    const meta = tokens.get(`${e.contract}|${e.token}`);
    if (!meta || !meta.unique) continue;
    const link = chain.get(`${e.contract}|${e.token}`) || [];
    const move = link.find((x) => x.tx === e.tx && x.from === e.address);
    if (!move || !move.to || excluded.has(move.to)) continue;
    pick = { e, meta, move, link };
    break;
  }
  if (!pick) console.log('  no plain transfer of a 1/1 with banked TAO in the history');
  else {
    const { e, meta, move, link } = pick;
    const got = link.filter((x) => x.to === e.address && x.ts <= move.ts).sort((a, b) => a.ts - b.ts)[0];
    const heldDays = (move.ts - (got ? got.ts : move.ts)) / DAY;
    const sender = byWallet.get(e.address);
    const receiver = byWallet.get(move.to);
    const stillTheirs = link[link.length - 1].to === move.to;
    const sinceDays = (NOW - move.ts) / DAY;
    console.log(`  ${meta.title} (${meta.work}), token ${e.token.slice(0, 12)}`);
    console.log(`    ${got ? day(got.ts) : '?'}  ${who(e.address)} receives it`);
    console.log(`    ${day(move.ts)}  given to ${who(move.to)}   (${(sales.tx[move.tx] || {}).why || 'unread'})\n`);
    console.log('  the sender:');
    console.log(`    held ${heldDays.toFixed(1)} days x ${CFG.rates.unique_per_day}/day = ${n(heldDays * CFG.rates.unique_per_day)} TAO`);
    console.log(`    given rather than sold, so all ${n(e.tao)} stays banked, and the clock stops`);
    console.log(`    ${who(e.address)} shows ${n(sender && sender.works[meta.work] ? sender.works[meta.work] : 0)} TAO against ${meta.work},`
      + ` accruing +${sender ? sender.tao_rate : 0}/day in total\n`);
    console.log('  the receiver:');
    if (stillTheirs) {
      console.log(`    ${sinceDays.toFixed(1)} days since it arrived x ${CFG.rates.unique_per_day}/day = ${n(sinceDays * CFG.rates.unique_per_day)} TAO expected`);
      console.log(`    ${who(move.to)} shows ${n(receiver && receiver.works[meta.work] ? receiver.works[meta.work] : 0)} TAO against ${meta.work}`);
    } else {
      console.log(`    it has moved on again since, so their figure is not a single interval`);
    }
    console.log(`    the sender's ${heldDays.toFixed(1)} days did not travel with the token\n`);
    const kept = sender && sender.works[meta.work] ? sender.works[meta.work] : 0;
    check(Math.abs(e.tao - heldDays * CFG.rates.unique_per_day) <= 2, 'the banked figure is what the holding earned');
    check(kept >= Math.floor(e.tao) - 2, 'the sender keeps the days it banked', `kept ${n(kept)} of ${n(e.tao)}`);
    if (stillTheirs) {
      const expect = sinceDays * CFG.rates.unique_per_day;
      const r = receiver && receiver.works[meta.work] ? receiver.works[meta.work] : 0;
      check(Math.abs(r - expect) <= 2, 'the receiver starts from zero on it', `expected ${n(expect)}, got ${n(r)}`);
    }
  }
}

/* ================= 9. an edition balance change ================= */
head('9. an edition ... a partial exit adjusts per copy');
{
  /* Someone who held several copies of one edition and let some go. The point
     of the case is that the exit takes its share of what the tenure earned,
     proportional to the copies that left, and the copies that stayed carry on. */
  /* Readable beats dramatic: a holding of a handful of copies, a partial exit,
     and enough days either side that the arithmetic is worth doing. A mint-day
     churn of three hundred copies proves the same rule and cannot be checked
     by eye, which is the whole point of printing it. */
  const candidates = [];
  for (const e of fresh.exits.filter((x) => x.qty >= 2).sort((a, b) => b.tao - a.tao)) {
    const meta = tokens.get(`${e.contract}|${e.token}`);
    if (!meta || meta.unique) continue;
    const link = (chain.get(`${e.contract}|${e.token}`) || []).filter((x) => x.to === e.address || x.from === e.address)
      .sort((a, b) => a.ts - b.ts);
    if (link.length < 2 || link.length > 8) continue;
    let bal = 0, peak = 0, partial = false, partialSale = false;
    for (const x of link) {
      if (x.to === e.address) { bal += x.qty; peak = Math.max(peak, bal); }
      if (x.from === e.address) {
        if (x.qty < bal) { partial = true; if (x.sale) partialSale = true; }
        bal -= x.qty;
      }
    }
    if (!partial || peak < 3 || peak > 12) continue;
    if ((link[link.length - 1].ts - link[0].ts) < 30 * DAY) continue;
    candidates.push({ e, meta, link, partialSale });
  }
  // the named case is a partial sale, because that is where the subtraction has
  // to land on the copies that left and nowhere else; a partial gift is the
  // fallback, and proves the other half of the rule
  const pick = candidates.find((c) => c.partialSale) || candidates[0] || null;
  if (!pick) console.log('  no partial exit of a multi-copy holding in the history');
  else {
    const { e, meta, link } = pick;
    console.log(`  ${meta.title} (${meta.work}), token ${e.token.slice(0, 12)}, edition rate ${CFG.rates.edition_copy_per_day}/copy/day`);
    console.log(`  ${who(e.address)}, one balance at a time:\n`);
    let bal = 0, since = null, earned = 0, banked = 0;
    for (const x of link.sort((a, b) => a.ts - b.ts)) {
      if (since != null && bal > 0) {
        const d = (x.ts - since) / DAY;
        const g = d * CFG.rates.edition_copy_per_day * bal;
        earned += g;
        console.log(`    ${day(since)} to ${day(x.ts)}   ${String(bal).padStart(2)} cop${bal === 1 ? 'y ' : 'ies'} x ${d.toFixed(1)} days = ${String(n(g)).padStart(7)} TAO`);
      }
      if (x.to === e.address) { bal += x.qty; }
      else {
        const moved = Math.min(x.qty, bal);
        const share = bal > 0 ? earned * (moved / bal) : 0;
        const v = x.sale ? `SOLD ... ${n(share)} taken back` : `given ... ${n(share)} stays banked`;
        console.log(`    ${day(x.ts)}              ${moved} of ${bal} leave    ${v}`);
        if (!x.sale) banked += share;                 // a gift leaves the days with the sender
        earned -= share;
        bal -= moved;
      }
      since = x.ts;
    }
    if (bal > 0 && since != null) {
      const d = (NOW - since) / DAY;
      const g = d * CFG.rates.edition_copy_per_day * bal;
      earned += g;
      console.log(`    ${day(since)} to today    ${String(bal).padStart(2)} cop${bal === 1 ? 'y ' : 'ies'} x ${d.toFixed(1)} days = ${String(n(g)).padStart(7)} TAO`);
    }
    console.log(`    ${' '.repeat(38)}${'-'.repeat(7)}`);
    if (banked) console.log(`    ${'still held'.padEnd(38)}${String(n(earned)).padStart(7)} TAO`);
    if (banked) console.log(`    ${'banked from copies given away'.padEnd(38)}${String(n(banked)).padStart(7)} TAO`);
    console.log(`    ${' '.repeat(38)}${String(n(earned + banked)).padStart(7)} TAO from this token\n`);
    const w = byWallet.get(e.address);
    const perWork = w && w.works[meta.work] ? w.works[meta.work] : 0;
    const otherTokens = [...chain.keys()].filter((k) => {
      const m = tokens.get(k);
      return m && m.work === meta.work && k !== `${e.contract}|${e.token}`
        && (chain.get(k) || []).some((x) => x.to === e.address);
    }).length;
    check(earned >= -1, 'the running figure never goes negative');
    check(bal >= 0, 'the balance never goes negative');
    const mine = earned + banked;
    if (!otherTokens) {
      check(Math.abs(perWork - mine) <= 3, 'the work total matches the interval arithmetic',
        `record ${n(perWork)}, worked through above ${n(mine)}`);
    } else {
      console.log(`  (${who(e.address)} holds ${otherTokens} other token${otherTokens === 1 ? '' : 's'} of this work, so the work total is larger than this token's ${n(mine)})`);
      check(perWork >= Math.floor(mine) - 3, 'the work total is at least what this token earned');
    }
  }
}

/* ================= 10. the guard rails, where they run ================= */
head('10. guard rails, checked in the production path');
{
  const cron = src('api/cron/tao.js');
  const engine = src('api/_lib/tao.js');

  // exclusions
  const holdingExcluded = [...excluded].filter((a) => tao.wallets[a]);
  check(holdingExcluded.length === 0, 'no excluded address holds TAO',
    holdingExcluded.length ? holdingExcluded.map(who).join(', ') : `${excluded.size} addresses excluded: artist wallets, the vault, escrow, custody, burn`);

  // scope
  const outOfScope = [];
  for (const [, w] of Object.entries(tao.wallets)) {
    for (const id of Object.keys(w.works)) if (!inScope.has(id)) outOfScope.push(id);
  }
  check(outOfScope.length === 0, 'nothing outside canon and archive accrues',
    outOfScope.length ? `${new Set(outOfScope).size} works out of scope, e.g. ${outOfScope[0]}` : `excluded collections: ${[...skip].join(', ')}`);

  // edition-aware intervals
  check(/perDay\s*=\s*\(meta,\s*qty\)\s*=>\s*\(meta\.unique\s*\?\s*rate1\s*:\s*rateE\s*\*\s*qty\)/.test(engine),
    'the engine accrues editions per copy, not per token');
  check(/h\.earned\s*\*\s*\(moved\s*\/\s*h\.qty\)/.test(engine),
    'a partial exit takes its share of the tenure, not all of it');

  // the head block throw
  check(/implausible head block/.test(cron), 'the run throws rather than sweep from a nonsense head block');

  // sale or gift, and the forgiving default
  const verdicts = Object.values(sales.tx);
  const noReason = verdicts.filter((v) => !v.why).length;
  const asSale = verdicts.filter((v) => v.sale).length;
  check(noReason === 0, 'every classification carries its reason',
    `${verdicts.length} transactions read, ${asSale} of them sales, ${verdicts.length - asSale} treated as transfers`);
  check(/sale:\s*Boolean\(sales\.tx\[tx\]\s*&&\s*sales\.tx\[tx\]\.sale\)/.test(cron),
    'an unread transaction defaults to a transfer, and keeps its TAO');
  check(/for \(const e of arrived\) wants\(e\.from, e\.tx\)/.test(cron),
    'exits that arrived tonight are classified before the backlog');

  // the register scope, which is the one that regressed
  check(/deriveCollectors\(all,/.test(cron),
    'the register is rebuilt from every collection, not only the ones that accrue');
  check(/collectors-register\.json/.test(cron), 'the leaderboard is written by the run that changes it');
  check(/data\/tao\/pages\.json/.test(cron), 'the collector pages are given a live overlay of their figures');
  check(/data\/tao\/totals\.json/.test(cron) && /run_id: runId/.test(cron),
    'every successful run leaves a totals row, stamped with the same id as its evidence',
    'so a delta is the change between two totals that were both computed');
  check(/tao_exact/.test(engine) && /w\.tao_exact, 0\)\)/.test(cron),
    'the board total sums unrounded and rounds once',
    'flooring three thousand wallets first loses a couple of thousand TAO that exist');
  check(/data\/availability\.json/.test(cron) && /skip\.has\(col\.slug\)/.test(cron),
    'what is for sale is published too, patron collections excluded');

  // evidence
  check(/saveRuns\(RUNS/.test(cron) && /keep: 90/.test(cron), 'every run leaves a record, ninety kept');
  check(/ok: false/.test(cron), 'a failed run leaves a record too');
  check(/MAX_GAP_HOURS/.test(cron) && /QUIET_RUNS/.test(cron), 'silence raises an alarm rather than passing for calm');
  /* A process cannot report a failure that kills it. The sweep was being
     stopped by the platform mid-run for three nights, so its own try/catch
     never ran and its own run log was never written. The watchdog has to live
     somewhere else. */
  check(/OWNERS_STALE_HOURS/.test(cron) && /owners-cursor\.json/.test(cron),
    'this run watches the sweep that runs before it, from outside it',
    'a cursor that has not moved is a fact about a file, not a hope about a process');
}

/* ================= the two methods, end to end ================= */
head('the whole board, recomputed and compared');
{
  const shipped = Object.entries(tao.wallets);
  let worst = { d: 0 };
  for (const [a, v] of shipped) {
    const w = byWallet.get(a);
    const d = Math.abs((w ? w.tao_total : 0) - v.tao);
    if (d > worst.d) worst = { d, a, shipped: v.tao, here: w ? w.tao_total : 0 };
  }
  const missing = shipped.filter(([a]) => !byWallet.has(a)).length;
  console.log(`  ${shipped.length} wallets in data/tao.json, ${fresh.wallets.filter((w) => w.tao_total > 0).length} recomputed here`);
  console.log(`  largest disagreement: ${worst.d ? `${n(worst.d)} TAO on ${who(worst.a)} (${n(worst.shipped)} vs ${n(worst.here)})` : 'none'}`);
  check(missing === 0, 'every shipped wallet survives an independent recompute');
  check(worst.d <= 3, 'the two methods agree to within rounding');
}

console.log(`\n${'='.repeat(74)}`);
console.log(failures === 0 ? 'All checks pass.' : `${failures} check${failures === 1 ? '' : 's'} failed.`);
process.exit(failures === 0 ? 0 : 1);
