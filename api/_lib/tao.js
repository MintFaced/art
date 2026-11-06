/* TAO ... Total Art Owned. Time-weighted patronage.
 *
 * Every day a wallet holds MintFace art it accrues TAO: 69/day per 1/1, and
 * 4.2/day per edition copy, per copy. Five copies of one edition accrue five
 * times over.
 *
 * The rule that gives the metric teeth: sold means subtracted, transferred
 * means kept. When a holding leaves through a sale, every day it ever earned
 * that wallet is taken back off their total. When it leaves as a gift, or
 * moves between someone's own wallets, the days already banked stay with the
 * sender and accrual simply stops. So a total can legitimately fall between
 * runs. That is the point.
 *
 * Pure and deterministic. Events and config in, totals out. Nothing carries
 * over between runs ... every figure is recomputed from the whole history each
 * time, so no total can drift, and the same logs always give the same TAO.
 *
 * Deliberately free of anything MintFace-specific: contracts, rates,
 * exclusions and the marketplace list all arrive as config. This module is
 * meant to lift out whole.
 */

const DAY = 86400;

/** How many copies an event moved. A record with no quantity is one copy, and
    a quantity of nothing moved nothing. */
export function copiesOf(qty) {
  if (qty == null || qty === '') return 1;
  const n = Number(qty);
  return Number.isNaN(n) ? 1 : Math.max(0, n);
}

/**
 * @param events  [{ contract, token, from, to, qty, ts, sale }] oldest first.
 *                `sale` is the exit classification: true when the transaction
 *                carried consideration.
 * @param tokens  Map "contract|token" -> { unique, work, collection, unique_from? }
 *                `unique_from` is when a token became a 1/1: a //STRIP accrues
 *                as an edition copy until it's redeemed as a painting.
 * @param cfg     parsed data/source/tao.json
 * @param now     unix seconds to accrue up to
 * @param opts.carries  (from, to) => true when two wallets are one collector.
 *                What a holding has earned then moves with it, into tao_held,
 *                on anything but a sale. The //STRIPS snapshot's rule, not the
 *                board's: it's for reading tao_held, and tao_total stays the
 *                board's figure only in a run without it.
 */
export function computeTao(events, tokens, cfg, now = Math.floor(Date.now() / 1000), { carries = null } = {}) {
  const rate1 = cfg.rates.unique_per_day;
  const rateE = cfg.rates.edition_copy_per_day;
  const excluded = new Set(Object.keys(cfg.exclusions).filter((k) => k.startsWith('0x')));

  const wallets = new Map();
  const of = (a) => {
    let w = wallets.get(a);
    if (!w) w = wallets.set(a, { address: a, total: 0, rate: 0, works: new Map(), lost: 0, kept: 0, sales: 0, gifts: 0, held: 0, copies: 0 }).get(a);
    return w;
  };

  // A 1/1 accrues at the flat rate; an edition accrues per copy held.
  const perDay = (meta, qty) => (meta.unique ? rate1 : rateE * qty);
  const earnedOver = (meta, qty, from, to) => {
    const at = meta.unique_from;
    if (at == null || to <= at) return ((to - from) / DAY) * perDay(meta, qty);
    if (from >= at) return ((to - from) / DAY) * rate1;
    return ((at - from) / DAY) * perDay(meta, qty) + ((to - at) / DAY) * rate1;
  };
  const bump = (w, workId, v) => w.works.set(workId, (w.works.get(workId) || 0) + v);

  /* One open holding per wallet per token, carrying the quantity, the moment
     the current balance began, and what this tenure has earned so far. A
     balance change is an interval boundary: what is earned to that point is
     realised, then accrual continues at the new balance. */
  const held = new Map();
  const key = (a, c, t) => `${a}|${c}|${t}`;

  // bring a holding's earnings up to `at`, crediting the wallet as we go
  const realise = (h, addr, c, t, at) => {
    const meta = tokens.get(`${c}|${t}`);
    if (!meta || at <= h.since) return;
    const gain = earnedOver(meta, h.qty, h.since, at);
    h.earned += gain;
    h.since = at;
    const w = of(addr);
    w.total += gain;
    bump(w, meta.work, gain);
  };

  const enter = (addr, c, t, qty, at) => {
    const k = key(addr, c, t);
    const h = held.get(k);
    if (!h) { held.set(k, { qty, since: at, earned: 0 }); return; }
    realise(h, addr, c, t, at);
    h.qty += qty;
  };

  const exits = [];
  const leave = (addr, c, t, qty, at, sale, tx) => {
    const k = key(addr, c, t);
    const h = held.get(k);
    // a wallet we have no open holding for: an exclusion, or history that
    // predates what we hold. Nothing to take back either way.
    if (!h || h.qty <= 0) return 0;
    realise(h, addr, c, t, at);
    const moved = Math.min(qty, h.qty);
    // a partial exit takes its share of what the tenure has earned
    const share = h.earned * (moved / h.qty);
    const meta = tokens.get(`${c}|${t}`);
    const w = of(addr);

    if (sale) {
      w.total -= share;
      if (meta) bump(w, meta.work, -share);
      w.lost += share;
      w.sales++;
    } else {
      w.kept += share;
      w.gifts++;
    }
    exits.push({ address: addr, contract: c, token: t, qty: moved, at, tx: tx || null,
      verdict: sale ? 'sale' : 'transfer', tao: Math.round(share), work: meta ? meta.work : null });

    h.earned -= share;
    h.qty -= moved;
    if (h.qty <= 0) held.delete(k);
    return share;
  };

  for (const e of events) {
    if (!tokens.has(`${e.contract}|${e.token}`)) continue;
    const from = String(e.from || '').toLowerCase();
    const to = String(e.to || '').toLowerCase();
    const qty = copiesOf(e.qty);
    if (!qty) continue;
    const left = from && !excluded.has(from) ? leave(from, e.contract, e.token, qty, e.ts, e.sale === true, e.tx) : 0;
    if (!to || excluded.has(to)) continue;
    enter(to, e.contract, e.token, qty, e.ts);
    if (left && carries && e.sale !== true && carries(from, to)) held.get(key(to, e.contract, e.token)).earned += left;
  }

  // whatever is still held accrues up to now, and sets the current rate
  for (const [k, h] of held) {
    const i = k.indexOf('|');
    const addr = k.slice(0, i);
    const rest = k.slice(i + 1);
    const j = rest.indexOf('|');
    const c = rest.slice(0, j);
    const t = rest.slice(j + 1);
    const meta = tokens.get(`${c}|${t}`);
    if (!meta) continue;
    realise(h, addr, c, t, now);
    const w = of(addr);
    w.rate += meta.unique_from != null && now >= meta.unique_from ? rate1 : perDay(meta, h.qty);
    w.held += h.earned;
    w.copies += h.qty;
  }

  const wallet = (w) => ({
    address: w.address,
    tao_total: Math.floor(Math.max(0, w.total)),
    /* The unrounded figure, carried alongside for one purpose: a board total is
       the sum of what everyone holds, not the sum of what everyone is shown.
       Flooring three and a half thousand wallets first and adding afterwards
       loses half a unit each, which is a couple of thousand TAO that exist and
       are not counted. Display floors. Totals do not. */
    tao_exact: Math.max(0, w.total),
    tao_rate: Math.round(w.rate * 10) / 10,
    tao_lost: Math.floor(w.lost),
    tao_kept: Math.floor(w.kept),
    /* What the wallet's current holdings have earned it, NFT by NFT, and nothing
       else: no days banked on anything it has sold or given away. The //STRIPS
       snapshot reads this, not tao_total. A holding that left in part took its
       share with it, so selling 1 of 5 leaves the 4. */
    tao_held: Math.floor(w.held),
    copies_held: w.copies,
    sales: w.sales,
    transfers_out: w.gifts,
    works: Object.fromEntries([...w.works.entries()]
      .map(([id, v]) => [id, Math.floor(Math.max(0, v))])
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])),
  });

  return {
    wallets: [...wallets.values()].map(wallet).sort((a, b) => b.tao_total - a.tao_total),
    exits,
  };
}
