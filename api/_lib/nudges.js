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
/* ------------------------------------------------------------- the COMBO
 *
 * A wallet may deploy the TAO of the vaults that have delegated to it. The
 * membership is verified against the chain when the weighing is made and
 * written onto the row, so reading the board afterwards is arithmetic rather
 * than a registry call for every visitor ... and so that a revocation shows up
 * where the doc says it does: at the close, clamping like a sale, rather than
 * silently rewriting a record that was true when it was made.
 *
 * NO WALLET'S TAO COUNTS TWICE. A vault's TAO is one thing and it is awarded
 * to exactly one claimant on any given nudge: itself, if it weighed here
 * directly, or the hot wallet that carries it in a COMBO. Where more than one
 * has a claim ... the vault connected directly after delegating, or two hot
 * wallets both carry it ... the LATEST ACT STANDS. The earlier position is
 * still in the ledger and still says what it said; it simply weighs what is
 * left, which is the same clamp a sale would have applied and reads the same
 * way on the card.
 *
 * A tie goes to the wallet itself. Somebody's own TAO is theirs by default and
 * only leaves on an act with a time on it.
 */
export function comboOwners(rows) {
  const acted = new Map();               // wallet -> its latest act, as a string
  const claims = new Map();              // claimed wallet -> [{ by, at }]
  const claim = (on, by, at) => {
    const k = lower(on);
    if (!k) return;
    if (!claims.has(k)) claims.set(k, []);
    claims.get(k).push({ by: lower(by), at: String(at || '') });
  };

  for (const r of rows || []) {
    const a = lower(r.address);
    if (!a) continue;
    const at = String(r.at || '');
    if (!acted.has(a) || at > acted.get(a)) acted.set(a, at);
  }
  /* A wallet that weighed claims its own TAO, at the moment it last acted. */
  for (const [a, at] of acted) claim(a, a, at);
  /* And claims every vault it was carrying when it acted. */
  for (const r of rows || []) {
    for (const m of r.combo || []) {
      if (lower(m) !== lower(r.address)) claim(m, r.address, r.at);
    }
  }

  const owner = new Map();
  for (const [on, list] of claims) {
    let best = null;
    for (const c of list) {
      if (!best) { best = c; continue; }
      if (c.at > best.at) { best = c; continue; }
      /* Same instant, and one of them is the wallet itself. It keeps it. */
      if (c.at === best.at && c.by === on) best = c;
    }
    owner.set(on, best.by);
  }
  return owner;
}

/**
 * What each wallet weighs with on THIS nudge, COMBO and all.
 *
 * Drop-in for the plain per-wallet reader every tally and board already takes,
 * so nothing downstream has to know whether a COMBO is involved. A wallet with
 * no delegation anywhere near it gets exactly the number it always got.
 */
/**
 * WHAT EACH WALLET WEIGHS WITH ON THIS NUDGE. One purse per COMBO.
 *
 * A COMBO is not a pile of wallets each spending its own TAO; it is one purse
 * that several wallets may draw on. The purse holds everything its members
 * hold, and every position any member has taken on this nudge draws from it.
 * That is what makes `available` mean what the doc says it means: the COMBO
 * total, minus whatever any member has already committed here.
 *
 * When the purse will not cover what has been asked of it, THE LATEST ACT
 * STANDS. The most recent position is met in full, then the one before it,
 * until the purse is empty; an older position weighs what is left. That is the
 * same clamp a sale applies, arriving for the same reason ... the TAO behind it
 * is not there any more ... and it reads the same way on the card, which is
 * why the vault-connects-directly case needs no special case.
 *
 * A wallet with no delegation anywhere near it is a purse of one and gets
 * exactly the number it always got: min(what it asked for, what it holds),
 * which is what spread() then scales its colours against.
 */
export function comboReader(taoOf, rows) {
  const owner = comboOwners(rows);
  const solo = (a) => Math.max(0, Math.floor(Number(taoOf(a)) || 0));

  /* Every wallet that has taken a position here, and what it asked for. */
  const { by } = allocations(rows);
  const asked = new Map();
  for (const [a, mine] of by) asked.set(a, [...mine.values()].reduce((n, v) => n + v, 0));
  const acted = new Map();
  for (const r of rows || []) {
    const a = lower(r.address);
    const at = String(r.at || '');
    if (a && (!acted.has(a) || at > acted.get(a))) acted.set(a, at);
  }

  /* The purses. A wallet's TAO goes into the purse of whoever owns it, and a
     wallet that owns nothing but itself is its own purse of one. */
  const purses = new Map();
  const purseOf = new Map();
  const open = (holder) => {
    if (!purses.has(holder)) purses.set(holder, { total: 0, members: new Set([holder]) });
    return purses.get(holder);
  };
  for (const [on, holder] of owner) {
    const p = open(holder);
    p.total += solo(on);
    p.members.add(on);
    purseOf.set(on, holder);
  }

  /* Met latest first, each within what it actually asked for. */
  const held = new Map();
  for (const [holder, p] of purses) {
    let left = p.total;
    const order = [...p.members].sort((a, b) => String(acted.get(b) || '').localeCompare(String(acted.get(a) || '')));
    for (const m of order) {
      const want = Math.max(0, Math.floor(asked.get(m) || 0));
      const give = Math.min(want, left);
      held.set(m, give);
      left -= give;
    }
    p.spent = p.total - left;
    p.left = left;
    p.holder = holder;
  }

  const read = (address) => {
    const a = lower(address);
    if (held.has(a)) return held.get(a);
    /* Nobody here has taken a position, so what they weigh with is what they
       have ... which is what a board asks when it is about to be told. */
    if (purseOf.has(a)) return purses.get(purseOf.get(a)).left;
    return solo(a);
  };

  /**
   * The purse behind one wallet, for the card that has to say what is spare.
   *
   * `extra` is a COMBO read live off the chain a moment ago that the rows do
   * not know about yet ... the first weighing of a brand new delegation, where
   * nothing on this nudge has ever recorded it. Those vaults join the purse
   * here so the collector is offered the TAO they actually have.
   */
  read.purse = (address, extra = []) => {
    const a = lower(address);
    const seen = new Set(purseOf.has(a) ? purses.get(purseOf.get(a)).members : [a]);
    let total = purseOf.has(a) ? purses.get(purseOf.get(a)).total : solo(a);
    for (const v of extra || []) {
      const m = lower(v);
      /* Not one already in somebody else's purse: a vault another hot wallet
         took later is not this one's to offer. */
      if (seen.has(m) || (purseOf.has(m) && purseOf.get(m) !== a)) continue;
      seen.add(m);
      total += solo(m);
    }
    let spent = 0;
    for (const m of seen) spent += Math.max(0, Math.floor(asked.get(m) || 0));
    return { total, spent, available: Math.max(0, total - spent), members: [...seen] };
  };

  return read;
}

/** Which wallets one address is weighing on behalf of here, itself aside. */
export function comboOf(rows, address) {
  const a = lower(address);
  const owner = comboOwners(rows);
  const out = [];
  for (const [on, by] of owner) if (by === a && on !== a) out.push(on);
  return out.sort();
}

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
        /* What this act was made of, as the row itself recorded it. The log is
           the record of how the board got here, so a row weighed by a COMBO
           says so where it happened rather than only in today's standings. */
        combo: (r.combo || []).length ? (r.combo || []).length + 1 : null,
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
    } else if (r.from) {
      /* A move: the one act names both keys. The colour it came off is set
         first, so a wallet that put everything it holds on another colour is
         never momentarily on both ... which is the state the sum was checked
         against, and the reason a legal move was refused. */
      const src = String(r.from).toUpperCase();
      if (src !== hex) {
        const before = mine.get(src) || 0;
        const after = Math.max(0, Math.floor(Number(r.from_amount) || 0));
        note(src, before, after);
        if (after > 0) mine.set(src, after); else mine.delete(src);
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
  /* How many wallets each row is speaking for, so the ledger can say so. A
     weighing carried by a COMBO is still one collector steering one decision;
     the marker says what it was made of and claims nothing else. */
  const owner = comboOwners(weighings);
  const carries = new Map();
  for (const [on, by] of owner) if (on !== by) carries.set(by, (carries.get(by) || 0) + 1);

  const over = [];
  const collectors = new Set();
  for (const [address, mine] of alloc) {
    const held = Math.max(0, Math.floor(taoOf(address) || 0));
    const fit = spread(mine, held);
    if (fit.over > 0) over.push({ address, name: names.get(address) || null, asked: fit.asked, held, over: fit.over });
    for (const [hex, weight] of fit.weights) {
      const c = put(hex);
      c.wallets.push({ address, name: names.get(address) || null, amount: mine.get(hex) || 0, weight,
        clamped: weight < (mine.get(hex) || 0),
        combo: carries.has(address) ? carries.get(address) + 1 : null });
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

/* ------------------------------------------------------------- changing
 *
 * CHANGING YOUR MIND IS A FIRST-CLASS ACT, and it is one act.
 *
 * A collector with everything they hold on one colour could not put it on
 * another. Each signature set one key, so asking for the second colour was
 * asking for a position that added up to twice their TAO for as long as it
 * took to check ... and it was refused for holding more TAO than the wallet
 * has, which was true of the sum and never true of the collector. Moving
 * 13,749 from one colour to another is always legal: it is the same TAO.
 *
 * So a change names both keys, both absolute, and is checked against the state
 * it LEAVES BEHIND rather than the sum of the old one and the new. Taking a
 * colour back and putting it on another are the same act, so a lost write
 * cannot leave a wallet with its TAO on neither.
 */

/** One wallet's map, with a change applied. Both keys absolute; the colour it
 *  came off is set first, so a move is never momentarily on both. */
export function changed(mine, { candidate, amount, from, fromAmount } = {}) {
  const next = new Map(mine || []);
  const set = (hex, v) => {
    const key = String(hex).toUpperCase();
    const n = Math.max(0, Math.floor(Number(v) || 0));
    if (n > 0) next.set(key, n); else next.delete(key);
  };
  if (from && String(from).toUpperCase() !== String(candidate).toUpperCase()) set(from, fromAmount);
  if (candidate) set(candidate, amount);
  return next;
}

/**
 * Whether a change is one this wallet may make, judged on where it lands.
 *
 * The only question a weighing has ever asked is whether the whole position
 * fits inside what the wallet holds. This asks it of the position the change
 * produces, which is the one the collector is actually taking.
 */
export function checkChange(mine, held, { candidate, amount, from, fromAmount } = {}) {
  const have = Math.max(0, Math.floor(Number(held) || 0));
  const want = Math.floor(Number(amount));
  if (!candidate) return { error: 'weigh behind one of the colours on the board' };
  if (!Number.isFinite(want) || want < 0) return { error: 'weigh some TAO, or none at all' };

  const target = String(candidate).toUpperCase();
  const src = from ? String(from).toUpperCase() : null;
  if (src) {
    if (src === target) return { error: 'a move goes from one colour to another' };
    const on = (mine && mine.get(src)) || 0;
    if (on <= 0) return { error: `there is nothing on ${src} to move.` };
    const keeps = Math.floor(Number(fromAmount));
    /* A move only ever takes TAO off the colour it names. Letting it add there
       would be a second weighing riding on the first, unsaid in the sentence
       the wallet signed. */
    if (!Number.isFinite(keeps) || keeps < 0 || keeps > on) {
      return { error: `a move takes TAO off ${src}, it cannot add to it.` };
    }
  }

  const next = changed(mine, { candidate: target, amount: want, from: src, fromAmount });
  const total = [...next.values()].reduce((a, v) => a + v, 0);
  if (total > have) {
    const elsewhere = total - want;
    return { error: elsewhere > 0
      ? `That would put ${total.toLocaleString('en-NZ')} TAO on the board and this wallet holds ${have.toLocaleString('en-NZ')}. `
        + `${elsewhere.toLocaleString('en-NZ')} is on other colours ... move some of it here instead.`
      : `That is more than this wallet holds. Its TAO is ${have.toLocaleString('en-NZ')}.` };
  }
  return { ok: true, next, total };
}

/** What a signer is asked to sign. Readable, and specific enough that a
 *  signature for one nudge cannot be replayed on another. */
export function weighMessage({ nudge, side, candidate, amount, from, fromAmount, address, issued }) {
  return [
    'MintFace Artist Virtual Studio',
    '',
    `Nudge: ${nudge}`,
    /* A colour where the nudge has candidates, a side where it does not. One
       line either way, and it names the thing the TAO is going behind, so a
       signature for one colour cannot be spent on another. */
    ...(candidate ? [`Colour: ${String(candidate).toUpperCase()}`] : [`Side: ${String(side).toUpperCase()}`]),
    `Weight: ${amount} TAO`,
    /* A move says where it came from and what that colour keeps, both
       absolute, because "moved ten thousand" is not a thing a person can check
       in a prompt and "#0E5890 keeps nought" is. */
    ...(from ? [`Moved from: ${String(from).toUpperCase()}`, `Which keeps: ${Math.max(0, Math.floor(Number(fromAmount) || 0))} TAO`] : []),
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
/* WHO IS BEHIND A COLOUR, and the whole of the guard on editing one.
 *
 * A proposer may change or withdraw their own candidate while they are the
 * only wallet standing on it. The moment somebody else weighs, it stops being
 * theirs to rewrite: the colour belongs to the board, and TAO other people put
 * behind it is not the proposer's to vaporise. They may still move their own
 * weight off it exactly as anybody may.
 *
 * Nought backers counts as sole. A colour nobody has weighed on yet is still
 * entirely the proposer's ... including their own nought. */
export function backersOf(candidate) {
  return ((candidate && candidate.wallets) || [])
    .filter((w) => Number(w.weight) > 0)
    .map((w) => lower(w.address));
}

export function mayEdit(candidate, address) {
  const a = lower(address);
  if (!candidate || lower(candidate.proposed_by) !== a) return false;
  const backers = backersOf(candidate);
  return backers.length === 0 || (backers.length === 1 && backers[0] === a);
}

/* A colour changed, and a colour taken back off the board.
 *
 * These name the colour they are about at both ends, so a signature for one
 * swap cannot be spent on another, and they say plainly what does and does not
 * happen to the TAO ... which is the only question a proposer pressing either
 * of them actually has. */
export function replaceMessage({ nudge, hex, to, address, issued }) {
  return [
    'MintFace Artist Virtual Studio',
    '',
    `Nudge: ${nudge}`,
    `Colour: ${String(hex).toUpperCase()}`,
    `Becomes: ${String(to).toUpperCase()}`,
    `Wallet: ${address}`,
    `Issued: ${issued}`,
    '',
    'Changing a colour you proposed, while you are the only wallet behind it.',
    'Your weight stays on it. It moves nothing and spends nothing.',
  ].join('\n');
}

export function withdrawMessage({ nudge, hex, address, issued }) {
  return [
    'MintFace Artist Virtual Studio',
    '',
    `Nudge: ${nudge}`,
    `Colour: ${String(hex).toUpperCase()}`,
    `Wallet: ${address}`,
    `Issued: ${issued}`,
    '',
    'Taking a colour you proposed back off the board.',
    'Any weight you had on it returns to your spare. It spends nothing.',
  ].join('\n');
}

/* THE BOARD IS STATE, NOT ONLY A LOG.
 *
 * Weighings are appended forever and folded; a proposal says which colours are
 * on the board NOW, and a proposer may change or withdraw their own. The file
 * is the record and is written on every act, but this deploy does not rebuild
 * itself when the file moves, so an edit that lived only in the file would not
 * be seen until somebody shipped. The overlay therefore carries edits as well
 * as additions, and they are applied over the file after everything is in.
 *
 * Idempotent on purpose. Once the file has caught up, an edit finds nothing
 * left to change ... a replaced proposal is already at its new colour, a
 * withdrawn one is already gone ... and does nothing at all. */
const EDITS = new Set(['replace', 'withdraw']);

export function withLive(file, live) {
  const seen = new Set();
  const out = { weighings: [], proposals: [] };
  const edits = [];
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
    if (EDITS.has(row.action)) { edits.push(row); continue; }
    if (row.hex && !row.candidate) put(row, 'proposals');
    else put(row, 'weighings');
  }

  /* In the order they were made, so two edits to one colour land the way they
     were pressed rather than the way a list happened to be read. */
  for (const ed of edits.slice().sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')))) {
    const i = out.proposals.findIndex((p) => p.nudge === ed.nudge
      && String(p.hex).toUpperCase() === String(ed.hex).toUpperCase());
    if (i < 0) continue;
    /* Only ever its own proposer's. The route checks this too and is the check
       that counts; this is so a stray row can never rewrite somebody else's
       colour on the way through. */
    if (lower(out.proposals[i].address) !== lower(ed.address)) continue;
    if (ed.action === 'withdraw') { out.proposals.splice(i, 1); continue; }
    if (ed.to) {
      out.proposals[i] = { ...out.proposals[i], hex: String(ed.to).toUpperCase(),
        replaced_from: out.proposals[i].hex, replaced_at: ed.at || null };
    }
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

/* ------------------------------------------------------------- banking
 *
 * The frozen record. At the close date the tally stops being a live reading
 * and becomes a thing that never moves again, so this is a projection rather
 * than a reference: what banks is a copy, taken once, of what the board said
 * at close.
 *
 * It lives here rather than in the cron because the cron is the one caller
 * that can never be run twice to check. A nudge banks once, forever, and a
 * record frozen wrong is not a bug you fix ... it is a decision somebody has
 * to be told was taken on the wrong numbers.
 */

/** What a candidate nudge banks: the board, the lock or the reason there is
 *  none, and who stood where when it closed. */
export function bankCandidates(p, n) {
  return {
    number: n.number, kind: CANDIDATES, rule: p.rule,
    total: p.total, collectors: p.collectors,
    leader: p.leader, locked: p.locked, why: p.why, progress: p.progress,
    /* Frozen with everything else. The card keeps showing who stood where at
       close, whatever anybody does with their TAO afterwards. */
    ledger: (p.ledger || []).map((r) => ({ address: r.address, name: r.name || null,
      candidate: r.candidate, weight: r.weight, at: r.at, clamped: Boolean(r.clamped) })),
    candidates: (p.candidates || []).map((c) => ({
      hex: c.hex, total: c.total, voters: c.voters, share: c.share,
      proposed_by: c.proposed_by || null, proposed_name: c.proposed_name || null,
      /* WALLETS, not ledger. A candidate carried a `ledger` before weighing
         split across colours; the fold renamed it, and this projection was not
         renamed with it. Nothing noticed, because no candidate nudge had ever
         closed ... which is exactly the kind of code path that is only ever
         run when it matters. */
      wallets: (c.wallets || []).map((r) => ({ address: r.address, name: r.name || null,
        amount: r.amount, weight: r.weight, clamped: Boolean(r.clamped) })),
    })),
    banked_at: new Date().toISOString(),
  };
}

/** What a yes-or-no nudge banks. */
export function bankTally(t, n) {
  return {
    number: n.number, totals: t.totals, counts: t.counts, total: t.total,
    collectors: t.collectors, share: t.share, result: t.result,
    ledger: (t.ledger || []).map((r) => ({ address: r.address, name: r.name || null,
      side: r.side, weight: r.weight, at: r.at, clamped: Boolean(r.clamped) })),
    banked_at: new Date().toISOString(),
  };
}

/**
 * The weighings a nudge is banked from.
 *
 * THE TWO KINDS COUNT DIFFERENTLY AND THIS IS WHERE THAT IS SAID. A yes or a
 * no keeps one weighing per wallet and the latest stands. A board of colours
 * does not: a wallet holds a map, built by folding every row it ever signed,
 * and taking only the latest one throws away every colour but the last it
 * touched. On nudge #1 that was the difference between a colour locking and
 * nothing locking at all ... 0xunix.eth had a hundred thousand on the blue and
 * a hundred thousand on the red, and the blue needed them to be its fifth
 * collector.
 */
export const bankingRows = (all, n) =>
  (kindOf(n) === CANDIDATES
    ? (all || []).filter((x) => x.nudge === n.id)
    : latest(all || [], n.id));

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
