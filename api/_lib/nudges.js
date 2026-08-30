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

/* ---------------------------------------------------------- candidates
 *
 * A nudge can also be a question with no fixed answers: the collectors supply
 * those too. The pilot is a colour ... "choose a colour for the next Strip
 * Painting" ... and it is the shape any nudge takes when the studio wants the
 * options proposed rather than offered.
 *
 * A CANDIDATE IS A COLOUR. Not a row somebody owns: the hex is the identity,
 * so two collectors proposing the same red land on the same swatch rather than
 * splitting it, and the proposals list is a record of who said it first rather
 * than a set of things to reconcile.
 *
 * And it can decline to decide. A colour locks only if the leader carries
 * enough collectors and enough TAO, both, at close. A nudge that steered
 * without deciding is a real outcome and the card says so ... which is the
 * difference between a threshold and a formality.
 */
export const CANDIDATES = 'candidates';
export const kindOf = (n) => (n && n.kind === CANDIDATES ? CANDIDATES : 'binary');

/** The lock a candidate nudge is held to, with the pilot's numbers as default. */
export const lockRule = (n) => ({
  voters: Math.max(1, Math.floor(Number((n && n.lock && n.lock.voters) ?? 5))),
  tao: Math.max(0, Math.floor(Number((n && n.lock && n.lock.tao) ?? 500000))),
});

/** A colour, as the register will keep it: #RRGGBB, upper case, or nothing. */
export function checkHex(raw) {
  const t = String(raw == null ? '' : raw).trim();
  const m = /^#?([0-9a-fA-F]{6})$/.exec(t) || /^#?([0-9a-fA-F]{3})$/.exec(t);
  if (!m) return { error: 'a colour is six hex digits, like #C0392B' };
  const six = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return { hex: `#${six.toUpperCase()}` };
}

/** What a wallet signs to put a colour on the board. */
export function proposeMessage({ nudge, hex, address, issued }) {
  return [
    'MintFace Artist Virtual Studio',
    '',
    `Nudge: ${nudge}`,
    `Colour: ${hex}`,
    `Wallet: ${address}`,
    `Issued: ${issued}`,
    '',
    'Proposing puts this colour on the board for others to weigh.',
    'It moves nothing and spends nothing.',
  ].join('\n');
}

/**
 * The board: every colour proposed, with what is behind it.
 *
 * The clamp is the same clamp ... a weighing counts for no more than the
 * collector's TAO now, or at close once closed. A colour nobody has weighed on
 * is still on the board with nothing behind it, because the palette forming in
 * public is the point and an empty swatch is part of that picture.
 */
export function palette(weighings, proposals, taoOf, n = null) {
  const by = new Map();
  const put = (hex) => {
    const key = String(hex).toUpperCase();
    if (!by.has(key)) by.set(key, { hex: key, total: 0, voters: 0, ledger: [], proposed_by: null, proposed_at: null, proposed_name: null });
    return by.get(key);
  };

  for (const p of proposals || []) {
    const c = put(p.hex);
    /* First said wins the credit, and nothing after it changes that. */
    if (!c.proposed_at || String(p.at) < String(c.proposed_at)) {
      c.proposed_at = p.at || null;
      c.proposed_by = p.address || null;
      c.proposed_name = p.name || null;
    }
  }

  for (const w of weighings || []) {
    if (!w.candidate) continue;
    const c = put(w.candidate);
    const held = Math.max(0, Math.floor(taoOf(w.address) || 0));
    const weight = Math.min(Math.floor(w.amount) || 0, held);
    c.ledger.push({ ...w, weight, clamped: weight < w.amount });
    if (weight <= 0) continue;
    c.total += weight;
    c.voters += 1;
  }

  const candidates = [...by.values()];
  const total = candidates.reduce((a, c) => a + c.total, 0);
  const collectors = new Set();
  for (const c of candidates) for (const r of c.ledger) if (r.weight > 0) collectors.add(String(r.address).toLowerCase());
  for (const c of candidates) {
    c.share = total ? c.total / total : 0;
    c.ledger.sort((a, b) => (b.weight - a.weight) || String(b.at || '').localeCompare(String(a.at || '')));
  }
  /* Sorted by weight, so the palette reads as it stands. Ties fall back to
     whichever was proposed first, which is the only tiebreak that is not
     arbitrary and does not move under anybody. */
  candidates.sort((a, b) => (b.total - a.total)
    || (b.voters - a.voters)
    || String(a.proposed_at || '').localeCompare(String(b.proposed_at || '')));

  /* The ledger: one row per collector, and the row is where they stand now.
   *
   * This is handed `latest()` output, so a collector who re-weighed or moved
   * from one colour to another is already one row rather than a history ...
   * which is what the card is for. The history is in the weighings file, which
   * keeps every signature; the card is who stands where.
   *
   * Newest first, because the interesting question about a board that is still
   * forming is what just moved. */
  const ledger = [];
  for (const c of candidates) for (const r of c.ledger) ledger.push({ ...r, candidate: c.hex });
  ledger.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));

  const rule = lockRule(n);
  const leader = candidates[0] || null;
  /* Enough people AND enough weight, on the leader, at close. Either alone is
     a way to be decided by one wallet or by a crowd holding nothing. */
  const holds = Boolean(leader && leader.voters >= rule.voters && leader.total >= rule.tao);
  return {
    kind: CANDIDATES,
    candidates,
    ledger,
    total,
    collectors: collectors.size,
    rule,
    /* How far the lock is, said as two fractions rather than as a verdict.
       The room can see exactly what is short, and by how much, while there is
       still time to do something about it ... which is the whole reason a
       threshold is published before it is met. */
    progress: {
      voters: { at: leader ? leader.voters : 0, of: rule.voters },
      tao: { at: leader ? leader.total : 0, of: rule.tao },
    },
    leader: leader ? { hex: leader.hex, total: leader.total, voters: leader.voters } : null,
    locked: holds ? { hex: leader.hex, total: leader.total, voters: leader.voters } : null,
    /* Said in the same breath as the numbers, so a card never has to work out
       why nothing locked. */
    why: holds ? null : (!leader
      ? 'Nobody proposed a colour.'
      : leader.voters < rule.voters && leader.total < rule.tao
        ? `The leading colour needs ${rule.voters} collectors and ${rule.tao.toLocaleString('en-NZ')} TAO. It has ${leader.voters} and ${Math.round(leader.total).toLocaleString('en-NZ')}.`
        : leader.voters < rule.voters
          ? `The leading colour has the TAO and needs ${rule.voters} collectors. It has ${leader.voters}.`
          : `The leading colour has the collectors and needs ${rule.tao.toLocaleString('en-NZ')} TAO. It has ${Math.round(leader.total).toLocaleString('en-NZ')}.`),
  };
}

/** What a signer is asked to sign. Readable, and specific enough that a
 *  signature for one nudge cannot be replayed on another. */
export function weighMessage({ nudge, side, candidate, amount, address, issued }) {
  return [
    'MintFace Artist Virtual Studio',
    '',
    `Nudge: ${nudge}`,
    /* A colour where the nudge has candidates, a side where it does not. One
       line either way, and it names the thing the TAO is going behind, so a
       signature for one colour cannot be spent on another. */
    ...(candidate ? [`Colour: ${String(candidate).toUpperCase()}`] : [`Side: ${String(side).toUpperCase()}`]),
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
  (banked && banked.locked
    /* A locked colour names itself. The line is what a work carries forever,
       and "steered by" is not the whole truth where the studio undertook to
       paint the answer ... it was chosen. */
    ? `Colour chosen by ${Math.round(banked.total).toLocaleString('en-NZ')} TAO across `
      + `${banked.collectors} collector${banked.collectors === 1 ? '' : 's'} · ${banked.locked.hex} · Nudge #${banked.number}`
    : `Steered by ${Math.round(banked.total).toLocaleString('en-NZ')} TAO across `
      + `${banked.collectors} collector${banked.collectors === 1 ? '' : 's'} · Nudge #${banked.number}`);
