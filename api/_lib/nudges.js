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

const lower = (a) => String(a || '').toLowerCase();

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

/* ------------------------------------------------------- allocations
 *
 * A collector spreads their TAO across as many colours as they like.
 *
 * The model before this one kept a single weighing per wallet, latest stands,
 * which meant weighing a second colour silently took the weight off the first.
 * 0xunix.eth did it twice on nudge #1 within an hour ... blue, then red, then
 * blue again ... which is what somebody looks like when they are fighting the
 * model rather than using it.
 *
 * So a wallet holds a map of colour to amount, and each signature sets one
 * entry in it. Changing red cannot touch blue, because red and blue are
 * different keys and the signature names one of them.
 *
 * A row is still an absolute amount rather than a delta. What a wallet signs
 * is "fifty thousand on this colour", which is a thing a person can read in a
 * prompt and check; "add ten thousand" is not, and a lost write would silently
 * change the answer rather than repeat it.
 */

/** Whether a row was written under the allocation model or before it. */
const isAlloc = (r) => Boolean(r && r.alloc);

/**
 * Every wallet's allocations, folded in order, and the history of the folding.
 *
 * The fold is what carries the old rows across untouched. Chronologically:
 * a row from before allocations REPLACES a wallet's whole map, because that is
 * precisely what it did at the time; a row since SETS one key. So a collector
 * who had a hundred thousand on one colour still has exactly that, on that
 * colour, and nothing they had already moved away from comes back to life.
 *
 * An amount of nought is how a colour is taken back, and it is a change like
 * any other rather than a deletion.
 */
export function allocations(rows) {
  const by = new Map();
  const history = [];
  const ordered = [...(rows || [])].sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));

  for (const r of ordered) {
    const address = lower(r.address);
    if (!address || !r.candidate) continue;
    const hex = String(r.candidate).toUpperCase();
    const amount = Math.max(0, Math.floor(Number(r.amount) || 0));
    if (!by.has(address)) by.set(address, new Map());
    const mine = by.get(address);

    const note = (colour, was, now) => {
      if (was === now) return;
      history.push({
        address, name: r.name || null, candidate: colour,
        delta: now - was, amount: now, at: r.at || null,
        signature: r.signature || null,
        /* Two entries can come from one signature, where a row from the old
           model moved weight rather than adding it. They are the same act and
           say so, so a card can draw them together and a reader can see that
           nobody weighed twice. */
        moved: colour !== hex,
      });
    };

    if (!isAlloc(r)) {
      /* The old model: this row was the wallet's whole position. Everything
         else they held goes to nought, which is what happened. */
      for (const [colour, was] of [...mine]) {
        if (colour === hex) continue;
        note(colour, was, 0);
        mine.delete(colour);
      }
    }
    const was = mine.get(hex) || 0;
    note(hex, was, amount);
    if (amount > 0) mine.set(hex, amount); else mine.delete(hex);
  }

  history.reverse();                       // newest first, as a record reads
  return { by, history };
}

/**
 * A wallet's allocations, brought inside what it actually holds.
 *
 * The clamp, generalised. A single weighing clamped to the wallet's TAO; a set
 * of them scales to fit it, in proportion, so a collector who sells down keeps
 * the shape of what they said while losing the size of it. Nothing is silently
 * rewritten: the stored amounts stand, and this is applied every time the board
 * is read, so the tally is never inflated and the wallet is told it is over.
 *
 * Floor, never round: the total after scaling is never more than what is held,
 * and a few TAO lost to rounding is the right direction to lose them in.
 */
export function spread(alloc, held) {
  const entries = [...(alloc || new Map())];
  const asked = entries.reduce((a, [, v]) => a + v, 0);
  const have = Math.max(0, Math.floor(Number(held) || 0));
  if (asked <= have) return { weights: new Map(entries), asked, over: 0 };
  const weights = new Map();
  for (const [hex, amount] of entries) {
    weights.set(hex, asked > 0 ? Math.floor((amount * have) / asked) : 0);
  }
  return { weights, asked, over: asked - have };
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
    if (!by.has(key)) by.set(key, { hex: key, total: 0, voters: 0, wallets: [], proposed_by: null, proposed_at: null, proposed_name: null });
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

  /* Every wallet's map, folded from its signatures, then brought inside what
     that wallet actually holds. The scaling is applied here rather than
     written down, so the board is never inflated and the stored amounts stay
     exactly what somebody signed for. */
  const { by: alloc, history } = allocations(weighings);
  const names = new Map();
  for (const w of weighings || []) if (w.name) names.set(lower(w.address), w.name);

  const over = [];
  const collectors = new Set();
  for (const [address, mine] of alloc) {
    const held = Math.max(0, Math.floor(taoOf(address) || 0));
    const fit = spread(mine, held);
    if (fit.over > 0) over.push({ address, name: names.get(address) || null, asked: fit.asked, held, over: fit.over });
    for (const [hex, weight] of fit.weights) {
      const c = put(hex);
      c.wallets.push({ address, name: names.get(address) || null, amount: mine.get(hex) || 0, weight,
        clamped: weight < (mine.get(hex) || 0) });
      if (weight <= 0) continue;
      c.total += weight;
      /* A wallet counts once on a colour, however it got there ... and once on
         the nudge, however many colours it split across. */
      c.voters += 1;
      collectors.add(address);
    }
  }

  const candidates = [...by.values()];
  const total = candidates.reduce((a, c) => a + c.total, 0);
  for (const c of candidates) {
    c.share = total ? c.total / total : 0;
    c.wallets.sort((a, b) => (b.weight - a.weight) || String(a.address).localeCompare(String(b.address)));
  }
  /* Sorted by weight, so the palette reads as it stands. Ties fall back to
     whichever was proposed first, which is the only tiebreak that is not
     arbitrary and does not move under anybody. */
  candidates.sort((a, b) => (b.total - a.total)
    || (b.voters - a.voters)
    || String(a.proposed_at || '').localeCompare(String(b.proposed_at || '')));

  const rule = lockRule(n);
  const leader = candidates[0] || null;
  /* Enough weight on the leading colour AND enough distinct wallets carrying
     some of it. Either alone is a way to be decided by one wallet or by a
     crowd holding nothing. A wallet that split across three colours counts
     towards this one only for the part it put here. */
  const holds = Boolean(leader && leader.voters >= rule.voters && leader.total >= rule.tao);
  return {
    kind: CANDIDATES,
    candidates,
    /* The record: every allocation change, newest first. */
    ledger: history,
    /* Who is currently promising more than they hold. Not rewritten, because
       what they signed is what they signed ... scaled where it is read, and
       said here so they can be asked to put it right. */
    over,
    total,
    collectors: collectors.size,
    rule,
    /* How far the lock is, said as two fractions rather than as a verdict.
       The room can see exactly what is short, and by how much, while there is
       still time to do something about it. */
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

/** What one wallet has allocated, and what is left of its TAO to allocate. */
export function standing(weighings, address, taoOf) {
  const { by } = allocations(weighings);
  const mine = by.get(lower(address)) || new Map();
  const held = Math.max(0, Math.floor(taoOf(address) || 0));
  const fit = spread(mine, held);
  return {
    allocations: [...mine].map(([hex, amount]) => ({ hex, amount, weight: fit.weights.get(hex) || 0 })),
    asked: fit.asked,
    held,
    available: Math.max(0, held - fit.asked),
    over: fit.over,
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

/* ---------------------------------------------------------- the overlay
 *
 * A weighing is not a nightly thing.
 *
 * The permanent record of every proposal and every weighing, with the
 * signature that made it, is `data/nudge-weighings.json` in the repo. That
 * file is written the moment somebody signs ... and it is *served* from the
 * last deploy, which is a different thing. This site does not deploy on push,
 * so a collector could sign for a colour, be told it was on the board, and
 * find the board empty. That happened, four minutes after nudge #1 opened.
 *
 * So the store carries what has been said since the last deploy, and every
 * read lays it over the file. It is the same arrangement the names layer
 * already makes for exactly the same reason: the record is a file rebuilt on a
 * schedule, and the thing somebody just did is not.
 *
 * Deduplicated by signature, which is unique per act and already in both
 * copies, so a row that has since made it into the file appears once.
 */
const LIVE = 'nudge:live';
const LIVE_KEPT = 5000;

/* How often a wallet may move its weight about.
 *
 * The signature used to be the limiter. A wallet prompt per act is a rate
 * limit somebody's hand enforces, and taking it away takes that away with it
 * ... which matters more here than it looks, because every weighing is a
 * commit to the repository. A loop would be a commit storm against somebody
 * else's API before it was anything else.
 *
 * So: a few seconds between acts, and a cap over ten minutes that is generous
 * for somebody spreading TAO across a board and mean for a script. */
const WEIGH_FLOOR_SECONDS = 4;
const WEIGH_BURST = 40;
const WEIGH_WINDOW = 600;

export function nudgeStore(pipe) {
  const parse = (x) => { try { return typeof x === 'string' ? JSON.parse(x) : x; } catch (e) { return null; } };
  const floorKey = (a) => `nudge:floor:${String(a).toLowerCase()}`;
  const burstKey = (a) => `nudge:burst:${String(a).toLowerCase()}`;
  return {
    /* Spent only once an act is known to be good, so being refused for what it
       said does not also cost somebody their few seconds. */
    async spend(address) {
      const [floor] = await pipe([['SET', floorKey(address), '1', 'NX', 'EX', String(WEIGH_FLOOR_SECONDS)]]);
      if (floor === null) return { error: `one at a time. A moment.` };
      const [count] = await pipe([['INCR', burstKey(address)]]);
      if (Number(count) === 1) await pipe([['EXPIRE', burstKey(address), String(WEIGH_WINDOW)]]);
      if (Number(count) > WEIGH_BURST) {
        return { error: `${WEIGH_BURST} changes in ${Math.round(WEIGH_WINDOW / 60)} minutes is plenty. Let it settle.` };
      }
      return { ok: true };
    },
    async add(row) {
      await pipe([['RPUSH', LIVE, JSON.stringify(row)], ['LTRIM', LIVE, String(-LIVE_KEPT), '-1']]);
      return row;
    },
    async live() {
      const [rows] = await pipe([['LRANGE', LIVE, '0', '-1']]);
      return (rows || []).map(parse).filter(Boolean);
    },
  };
}

/** The file, with anything said since it was last deployed laid over it. */
export function withLive(file, live) {
  const seen = new Set();
  const out = { weighings: [], proposals: [] };
  const put = (row, into) => {
    /* Deduplicated by whatever names the act uniquely: the signature where one
       was given, and otherwise the session and the moment, which together are
       as unique as a signature and are both already on the row. */
    const key = row && row.signature ? String(row.signature)
      : (row && row.session ? `${row.session}@${row.at}@${row.candidate || row.hex || ''}` : null);
    if (key) { if (seen.has(key)) return; seen.add(key); }
    out[into].push(row);
  };
  for (const w of (file && file.weighings) || []) put(w, 'weighings');
  for (const p of (file && file.proposals) || []) put(p, 'proposals');
  for (const row of live || []) {
    if (!row) continue;
    if (row.hex && !row.candidate) put(row, 'proposals');
    else put(row, 'weighings');
  }
  return out;
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
