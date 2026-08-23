/* AVS nudges: the tally, and the rule that makes it mean something.
 *
 * A collector weighs TAO behind a Yes or a No. The TAO is weighed and kept ...
 * it never leaves their total, because it is influence rather than currency.
 * The artist steers; the collectors nudge.
 *
 * The clamp is the whole integrity of it. A weighing counts for no more than
 * the collector's TAO at the moment the nudge closes, so selling down after
 * weighing shrinks what you said. Weigh what you hold, hold what you weighed.
 * Without it, a wallet could weigh a million TAO on Monday and sell on Tuesday
 * and still have moved the answer.
 *
 * Pure: weighings and a TAO register in, a tally out.
 */

export const SIDES = ['yes', 'no'];

/** What a signer is asked to sign. Readable, and specific enough that a
 *  signature for one nudge cannot be replayed on another. */
export function weighMessage({ nudge, side, amount, address, issued }) {
  return [
    'MintFace Artist Virtual Studio',
    '',
    `Nudge: ${nudge}`,
    `Side: ${side.toUpperCase()}`,
    `Weight: ${amount} TAO`,
    `Wallet: ${address}`,
    `Issued: ${issued}`,
    '',
    'A nudge steers. It never commands.',
    'Weighing does not move or spend any TAO.',
  ].join('\n');
}

/** The live tally for one nudge.
 *  @param weighings  latest weighing per address, any order
 *  @param taoOf      address -> TAO now (or at close, once closed)
 */
export function tally(weighings, taoOf) {
  const rows = [];
  const totals = { yes: 0, no: 0 };
  const counts = { yes: 0, no: 0 };

  for (const w of weighings) {
    const held = Math.max(0, Math.floor(taoOf(w.address) || 0));
    // clamped, never inflated: what they said, or what they still hold
    const weight = Math.min(Math.floor(w.amount) || 0, held);
    if (!SIDES.includes(w.side)) continue;
    rows.push({ ...w, weight, clamped: weight < w.amount });
    if (weight <= 0) continue;
    totals[w.side] += weight;
    counts[w.side] += 1;
  }

  rows.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  const total = totals.yes + totals.no;
  return {
    totals,
    counts,
    total,
    collectors: counts.yes + counts.no,
    share: {
      yes: total ? totals.yes / total : 0,
      no: total ? totals.no / total : 0,
    },
    result: totals.yes === totals.no ? 'even' : (totals.yes > totals.no ? 'yes' : 'no'),
    ledger: rows,
  };
}

/** One weighing per wallet: the latest stands, so adjusting is just weighing
 *  again rather than an edit with a history to reconcile. */
export function latest(all, nudgeId) {
  const by = new Map();
  for (const w of all) {
    if (w.nudge !== nudgeId) continue;
    const prev = by.get(w.address);
    if (!prev || String(w.at) > String(prev.at)) by.set(w.address, w);
  }
  return [...by.values()];
}

export const isOpen = (n, now = new Date()) =>
  n.published !== false && !n.banked && new Date(n.closes).getTime() > now.getTime();

/** The line a work carries once a nudge shaped it. Permanent, and phrased the
 *  way the register phrases everything else. */
export const provenanceLine = (banked) =>
  `Steered by ${Math.round(banked.total).toLocaleString('en-NZ')} TAO across `
  + `${banked.collectors} collector${banked.collectors === 1 ? '' : 's'} · Nudge #${banked.number}`;
