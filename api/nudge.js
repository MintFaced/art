import { verifyMessage } from 'viem';
import { readFile, writeFile } from './_lib/repo.js';
import { siteOrigin, useRequestOrigin } from './_lib/data.js';
import { tally, latest, isOpen, weighMessage, proposeMessage, palette, standing, allocations, checkChange, spread, checkHex, kindOf, lockRule, nudgeStore, withLive, comboReader, comboOf, CANDIDATES, SIDES } from './_lib/nudges.js';
import { comboFor, soloOnly, comboMark } from './_lib/combo.js';
import { seriesState, constraintFor, checkCandidate, slotLine, seriesProvenanceLine } from './_lib/palette.js';
import { loadRegister } from './_lib/register.js';
import { storeConfigured, pipe } from './_lib/kv.js';
import { chatStore, SCOPE_WEIGH } from './_lib/chat.js';
import { cookieFrom, TOKEN_COOKIE } from './_lib/session.js';

/* Weighing TAO behind a Yes or a No.
 *
 * No gas, no tokens moved, nothing on chain. A wallet signs a plain sentence
 * saying what it is doing, and that signature is kept beside the weighing as
 * the audit trail. The TAO itself never moves: it is read from the register,
 * weighed, and stays exactly where it was.
 */

const json = (b, s = 200) => new Response(JSON.stringify(b, null, 1), {
  status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});
const lower = (a) => String(a || '').toLowerCase();

async function load(origin) {
  const at = async (p) => {
    const r = await fetch(`${origin}/${p}`, { headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error(`${p}: ${r.status}`);
    return r.json();
  };
  const [nudges, said, tao, live] = await Promise.all([
    at('data/nudges.json'), at('data/nudge-weighings.json'), at('data/tao.json'),
    /* What has been said since the last deploy. The file is served from the
       deployment and this site does not deploy on push, so without this a
       collector signs, is told it landed, and finds the board empty. */
    storeConfigured() ? nudgeStore(pipe).live().catch(() => []) : Promise.resolve([]),
  ]);
  return { nudges, weighings: withLive(said, live), tao };

}

const taoReader = (tao) => (addr) => {
  const w = tao.wallets && tao.wallets[lower(addr)];
  return w ? w.tao : 0;
};

const at = async (origin, p) => {
  const r = await fetch(`${origin}/${p}`, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`${p}: ${r.status}`);
  return r.json();
};

/* Who weighed in, named and linked as the register reads them today.
   A ledger is a public record of who steered a decision, so the name on it has
   to be the name that person answers to now ... and it has to lead somewhere,
   because a row that says a name and goes nowhere is a row you cannot check. */
const registerFor = (origin) => loadRegister(at, origin, storeConfigured() ? pipe : null).catch(() => null);

/** Everything the studio page needs, in one request. */
export async function GET(request) {
  const origin = useRequestOrigin(request) || siteOrigin();
  let data;
  try { data = await load(origin); } catch (e) { return json({ error: 'the studio is not reachable' }, 503); }
  const readTao = taoReader(data.tao);
  const register = await registerFor(origin);
  const url = new URL(request.url);
  const who = url.searchParams.get('address');

  /* WHO IS ASKING, AND WHO SPEAKS THROUGH THEM.
   *
   * One registry read for the reader in front of us, and none at all for the
   * anonymous majority: a page nobody has signed in on never touches the
   * chain. What it buys is that a collector who delegated a minute ago is
   * offered their vault's TAO on the first board they open, before any row
   * here has ever heard of it. */
  const mine = who ? await comboFor(data.tao, who).catch(() => soloOnly(data.tao, who))
    : { members: [], wallets: [], total: 0, combo: false, degraded: false };
  const vaults = mine.wallets.slice(1);

  /* What this wallet may still deploy here: its purse, less everything any
     member of it has already committed on this nudge. */
  const mineOn = (rows, addr, read) => {
    const base = standing(rows, addr, read);
    const purse = read.purse(addr, vaults);
    return {
      ...base,
      held: purse.total,
      available: purse.available,
      combo: mine.combo ? { wallets: mine.members.length, members: mine.wallets, mark: comboMark(mine.members.length) } : null,
    };
  };

  /* Who a ledger row is, said as the register reads them today. A weighing is
     a public record of who steered a decision, so the name on it has to be the
     name that person answers to now, and it has to lead somewhere. */
  const dress = (r) => {
    const w = register ? register.who(r.address) : null;
    return {
      address: r.address,
      /* The quiet marker, built the one way it is built everywhere. */
      combo: r.combo ? comboMark(r.combo) : null,
      name: (w && w.known ? w.name : null) || r.name || (w ? w.name : null) || null,
      delta: r.delta == null ? null : r.delta,
      moved: Boolean(r.moved),
      /* A private collector reads as the register reads them everywhere: named
         'Private collector', with no page to go to. `urlOf` already answers
         null for them, and the flag is here so a card can draw the row in the
         standing treatment rather than inferring it from a missing link. */
      private: Boolean(w && w.private),
      url: register ? register.urlOf(r.address) : null,
      side: r.side || null, candidate: r.candidate || null,
      weight: r.weight, at: r.at, clamped: Boolean(r.clamped),
    };
  };

  /* The arc, read once. Every card in this response places itself in it, and
     the strip that draws the twelve slots is the same reading. */
  const arc = seriesState(data.nudges);

  const out = (data.nudges.nudges || []).filter((n) => n.published !== false).map((n) => {
    const rows = latest(data.weighings.weighings || [], n.id);
    const mine = who ? rows.find((r) => lower(r.address) === lower(who)) : null;
    const base = {
      id: n.id, number: n.number, question: n.question, note: n.note || null,
      image: n.image || null, opens: n.opens || null, closes: n.closes,
      open: isOpen(n), banked: Boolean(n.banked), outcome: n.outcome || null,
      kind: kindOf(n),
      /* The pilot's promise, and the reason this one is not only a steer. It
         lives on the nudge rather than in the page, because it is a thing the
         studio undertook rather than a thing the page says. */
      promise: n.promise || null,
      /* Where this sits in the arc. A nudge is one question and also the Nth
         of twelve, and a card that says only the first of those leaves a
         reader thinking a colour was chosen on its own. */
      series: n.series || null,
      slot: n.slot != null ? Number(n.slot) : null,
      slot_line: arc ? slotLine(n, arc.slots) : null,
    };

    if (kindOf(n) === CANDIDATES) {
      const props = (data.weighings.proposals || []).filter((x) => x.nudge === n.id);
      /* Every row, not the latest one per wallet: a wallet holds a map now,
         and the fold is what turns its signatures into that map. */
      const forNudge = (data.weighings.weighings || []).filter((x) => x.nudge === n.id);
      /* And every COMBO those rows recorded, so a vault's TAO is weighed once
         and by whoever is entitled to it here. A board with no delegations
         anywhere in it reads exactly as it always did. */
      const readHere = comboReader(readTao, forNudge);
      // a banked nudge keeps what it closed with, whatever has happened since
      const p = n.banked ? n.banked : palette(forNudge, props, readHere, n);
      return {
        ...base,
        /* What a colour on this nudge has to stand clear of, and by how much.
           Null on the nudge that opened the palette: there was nothing to be
           different from, and a constraint drawn against nothing would be a
           rule invented to have one. */
        constraint: n.banked ? null : constraintFor(data.nudges, n, arc),
        rule: p.rule || lockRule(n),
        total: p.total, collectors: p.collectors,
        leader: p.leader || null, locked: p.locked || null, why: p.why || null,
        progress: p.progress || null,
        /* The public record: every allocation change, newest first. A single
           signature can produce two entries where a row from before the
           allocation model moved weight rather than adding it, and those say
           so, so nobody reads one act as two. */
        ledger: (p.ledger || []).map(dress),
        /* Who is currently promising more than they hold. Nothing is rewritten
           ... their allocations are scaled where the board is read ... and this
           is what lets a card ask them to put it right. */
        over: (p.over || []).map(dress),
        candidates: (p.candidates || []).map((c) => ({
          hex: c.hex, total: c.total, voters: c.voters, share: c.share,
          proposed_by: c.proposed_by || null,
          proposed_name: c.proposed_by && register
            ? ((register.who(c.proposed_by) || {}).name || c.proposed_name || null)
            : (c.proposed_name || null),
          proposed_url: c.proposed_by && register ? register.urlOf(c.proposed_by) : null,
          wallets: (c.wallets || []).map(dress),
        })),
        /* Everything the viewer needs to spread their own TAO: what they have
           put where, what it is worth now, and what is left to allocate. */
        mine: who ? mineOn(forNudge, who, readHere) : null,
        proposed: who ? Boolean(props.find((x) => lower(x.address) === lower(who))) : false,
      };
    }

    const t = n.banked ? n.banked : tally(rows, comboReader(readTao, rows));
    return {
      ...base,
      totals: t.totals, counts: t.counts, total: t.total, collectors: t.collectors,
      share: t.share, result: t.result,
      ledger: (t.ledger || []).map(dress),
      mine: mine ? { side: mine.side, amount: mine.amount, at: mine.at } : null,
    };
  }).sort((a, b) => Number(b.open) - Number(a.open) || String(b.closes).localeCompare(String(a.closes)));

  return json({
    nudges: out,
    /* WHO THIS BOARD IS ABOUT. Every personal thing in it ... where you stand,
       what is spare, whether you have proposed ... is answered for this
       address and for nobody else, so the page has to be able to tell whether
       the board in front of a reader is a board about them. It could not: it
       asked the cookie whether it might weigh and asked the payload where it
       stood, and a session opened after the board loaded made those two
       disagree. */
    viewer: who ? lower(who) : null,
    /* The whole series in one reading: twelve slots, what is locked, what is
       being asked, and the constraint on the next colour. The strip on
       /studio, on the collection page and in the maker are all this ... one
       config, so the maker's palette is complete the moment the last slot
       locks rather than being copied across at the end. */
    /* Without the red. It is the artist's constant, it is on the paintings and
       in the maker, and a page that never receives it cannot draw it. */
    series: arc ? { ...arc, fixed: null, clearance: null, provenance: seriesProvenanceLine(arc) } : null,
    /* The figure the composer puts beside the box: what this reader can
       actually weigh with, COMBO and all. */
    tao: who ? mine.total : null,
    /* And what that figure is made of, so the page can say so quietly rather
       than a collector wondering why their number grew. */
    combo: who && mine.combo
      ? { wallets: mine.members.length, mark: comboMark(mine.members.length), solo: mine.solo,
        members: mine.members.map((m) => ({ address: m.address, tao: m.tao, hot: Boolean(m.hot), scoped: Boolean(m.scoped) })) }
      : null,
    combo_degraded: Boolean(who && mine.degraded),
    rule: 'A nudge steers. It never commands. The studio may act with, against, or without the result.',
  });
}

/** Weigh, or weigh again. The latest stands. */
export async function POST(request) {
  const origin = useRequestOrigin(request) || siteOrigin();
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }

  /* Who is doing this.
   *
   * The session first, and where there is one the request is not asked: the
   * address in the body is ignored entirely, exactly as the room ignores it,
   * because a token that says who you are beside a field that also says so is
   * a lock with the door left open next to it.
   *
   * A session minted before weighing joined the sentence may not weigh. It is
   * a perfectly good session and it may still speak; nobody agreed to this
   * with it, so it is asked for one more signature the first time it tries. */
  let session = null;
  if (storeConfigured()) {
    const token = cookieFrom(request, TOKEN_COOKIE);
    if (token) session = await chatStore(pipe).session(token).catch(() => null);
  }
  if (session && session.scope < SCOPE_WEIGH) {
    return json({ error: 'that sign-in was opened before weighing joined it. Sign in again and it will not ask twice.', rescope: true }, 401);
  }
  const address = session ? session.address : lower(body.address);
  const action = String(body.action || 'weigh');
  const side = String(body.side || '').toLowerCase();
  const amount = Math.floor(Number(body.amount));
  const issued = String(body.issued || '');
  const signature = String(body.signature || '');
  const nudgeId = String(body.nudge || '');

  if (!/^0x[0-9a-f]{40}$/.test(address)) return json({ error: 'that is not a wallet address' }, 400);
  if (!['weigh', 'propose'].includes(action)) return json({ error: 'no such action' }, 400);
  if (!session) {
    /* Signing per act is still a way to do this, and still the only way
       without a session. */
    if (!signature.startsWith('0x')) return json({ error: 'a signature is required' }, 400);
    // an old signature should not sit around waiting to be replayed
    const age = Date.now() - Date.parse(issued);
    if (!Number.isFinite(age) || age < -60000 || age > 15 * 60 * 1000) {
      return json({ error: 'that signature has gone stale, please sign again' }, 400);
    }
  }

  /* The signature used to be the rate limit ... a wallet prompt per act is one
     somebody's hand enforces. Taking it away takes that with it, and every act
     here is a commit to the repository. */
  const spent = storeConfigured() ? await nudgeStore(pipe).spend(address).catch(() => ({ ok: true })) : { ok: true };
  if (spent.error) return json({ error: spent.error }, 429);

  let data;
  try { data = await load(origin); } catch (e) { return json({ error: 'the studio is not reachable' }, 503); }

  const n = (data.nudges.nudges || []).find((x) => x.id === nudgeId);
  if (!n) return json({ error: 'no such nudge' }, 404);
  if (!isOpen(n)) return json({ error: 'this nudge has closed' }, 409);
  const candidates = kindOf(n) === CANDIDATES;

  /* WHAT THIS WALLET MAY DEPLOY, ASKED OF THE CHAIN NOW.
   *
   * Weigh time is the second of the three moments the COMBO is read at, and it
   * is read fresh: a delegation revoked this morning must not be spendable
   * this afternoon because a cache had two minutes left on it. A registry that
   * cannot be reached leaves the wallet weighing solo, which is the additive
   * promise kept in the only direction it can be kept ... never less than the
   * wallet's own TAO, never more than the chain has just confirmed. */
  const live = await comboFor(data.tao, address, { fresh: true }).catch(() => soloOnly(data.tao, address));
  const vaults = live.wallets.slice(1);
  const rowsHere = (data.weighings.weighings || []).filter((x) => x.nudge === n.id);
  const readHere = comboReader(taoReader(data.tao), rowsHere);
  const purse = readHere.purse(address, vaults);
  const ownAsk = [...(allocations(rowsHere).by.get(address) || new Map()).values()]
    .reduce((a, v) => a + v, 0);
  /* The ceiling for THIS wallet: everything in the purse that is not already
     spoken for by another member of it. Its own current position is not spent
     against it ... it is the thing being changed. */
  const held = Math.max(0, purse.total - (purse.spent - ownAsk));
  if (purse.total <= 0) return json({ error: 'this wallet holds no TAO yet' }, 403);
  if (held <= 0) {
    return json({ error: `every TAO in this COMBO is already weighed on this nudge. Move some of it instead.` }, 400);
  }

  /* ---- putting a colour on the board ----
   *
   * Proposing is its own act with its own signature, and it is not a weighing:
   * a colour goes up with nothing behind it until somebody puts TAO there,
   * which is what "the palette forming in public" looks like.
   *
   * One per wallet per nudge, and final. A proposal is a thing other people
   * weigh on, so letting it be changed would move TAO somebody put behind one
   * colour onto another without asking them. */
  if (action === 'propose') {
    if (!candidates) return json({ error: 'this nudge is a yes or a no' }, 400);
    /* The picker enforces this too, so a collector never signs for a colour
       that is going to be refused ... but the picker is a courtesy and this is
       the check that counts. A colour has to belong to the streetscape space
       and stand clear of everything already locked, which is what keeps a
       twelve-colour palette from drifting into twelve warm mid-tones. */
    const bound = constraintFor(data.nudges, n);
    const colour = bound
      ? checkCandidate(body.hex, {
        against: bound.clearance,
        /* Only the community's colours may be named back. The red line holds
           the floor and is never the reason a refusal gives. */
        named: bound.against.map((a) => a.hex),
        floor: bound.floor,
        space: bound.space,
      })
      : checkHex(body.hex);
    if (colour.error) return json({ error: colour.error }, 400);

    if (!session) {
      const message = proposeMessage({ nudge: n.question, hex: colour.hex, address, issued });
      let good = false;
      try { good = await verifyMessage({ address, message, signature }); } catch (e) { good = false; }
      if (!good) return json({ error: 'that signature does not match the wallet' }, 401);
    }

    const file = await readFile('data/nudge-weighings.json');
    const store = JSON.parse(file.text);
    const props = (store.proposals || []).filter((x) => x.nudge === n.id);
    if (props.find((x) => lower(x.address) === address)) {
      return json({ error: 'this wallet has already put a colour on the board' }, 409);
    }
    /* The same colour twice is one swatch, so the second proposer is told
       rather than quietly adding nothing. */
    if (props.find((x) => String(x.hex).toUpperCase() === colour.hex)) {
      return json({ error: `${colour.hex} is already on the board. Weigh TAO behind it instead.` }, 409);
    }
    const registerHere = await registerFor(origin);
    const w0 = registerHere ? registerHere.who(address) : null;
    const row = {
      nudge: n.id, hex: colour.hex, address,
      name: w0 && !w0.private ? w0.name : null,
      at: new Date().toISOString(),
      /* What authorised this. A signature naming the colour, or the session ...
         by its public name, never its token ... which a signature opened. The
         chain is walkable either way: see sessionProof() in _lib/chat.js. */
      ...(session ? { session: session.id } : { issued, signature }),
    };
    store.proposals = [...(store.proposals || []), row];
    /* Both copies. The repo is the permanent record with the signature on it;
       the store is what the board reads until the next deploy carries the file
       out. The store write is not allowed to fail the request: the signature is
       already committed, and a colour that appears at the next deploy is worse
       than a colour that appears now but better than one that was refused after
       being signed for. */
    if (storeConfigured()) await nudgeStore(pipe).add(row).catch(() => {});
    await writeFile('data/nudge-weighings.json', JSON.stringify(store, null, 1) + '\n',
      `Nudge ${n.number}: ${(w0 && w0.name) || address.slice(0, 10)} proposes ${colour.hex}`, file.sha);
    return json({ ok: true, hex: colour.hex,
      palette: palette(latest(store.weighings || [], n.id), (store.proposals || []).filter((x) => x.nudge === n.id), taoReader(data.tao), n) });
  }

  /* ---- weighing ---- */
  let candidate = null;
  /* Where this is being moved from, where it is a move. Changing your mind is
     one act naming two colours, so that the position it lands on is the thing
     checked rather than the sum of the one being left and the one being
     taken ... which is never a position anybody asked for. */
  let from = null;
  let fromAmount = 0;
  if (candidates) {
    const colour = checkHex(body.candidate);
    if (colour.error) return json({ error: 'weigh behind one of the colours on the board' }, 400);
    candidate = colour.hex;
    const onBoard = (hex) => (data.weighings.proposals || [])
      .some((x) => x.nudge === n.id && String(x.hex).toUpperCase() === hex);
    if (!onBoard(candidate)) return json({ error: 'that colour is not on the board. Propose it first.' }, 404);
    if (body.from != null && String(body.from) !== '') {
      const src = checkHex(body.from);
      if (src.error) return json({ error: 'move it from one of the colours on the board' }, 400);
      from = src.hex;
      if (!onBoard(from)) return json({ error: 'that colour is not on the board.' }, 404);
      fromAmount = Math.floor(Number(body.from_amount) || 0);
    }
  } else if (!SIDES.includes(side)) {
    return json({ error: 'a nudge is a yes or a no' }, 400);
  }
  if (!Number.isFinite(amount) || amount < 0) return json({ error: 'weigh some TAO, or none at all' }, 400);
  /* Nought is how a colour is taken back, so it is allowed where there are
     colours to take back. On a yes or a no there is nothing to take back and
     nought is somebody who meant to type a number. */
  if (!candidates && amount <= 0) return json({ error: 'weigh some TAO, or none at all' }, 400);

  if (candidates) {
    /* The position this leaves the wallet in, judged against what it holds.
       Not the sum of what it had and what it is asking for: a collector moving
       everything from one colour to another never holds both, and refusing
       them for a total they were never going to be at is the bug this
       replaces. */
    const mine = allocations((data.weighings.weighings || []).filter((x) => x.nudge === n.id)).by.get(address)
      || new Map();
    const verdict = checkChange(mine, held, { candidate, amount, from, fromAmount });
    if (verdict.error) return json({ error: verdict.error }, 400);
  } else if (amount > held) {
    return json({ error: `that is more than this wallet holds. Its TAO is ${held.toLocaleString('en-NZ')}.` }, 400);
  }

  if (!session) {
    const message = weighMessage({ nudge: n.question, side, candidate, amount, from, fromAmount, address, issued });
    let ok = false;
    try { ok = await verifyMessage({ address, message, signature }); } catch (e) { ok = false; }
    if (!ok) return json({ error: 'that signature does not match the wallet' }, 401);
  }

  /* The register knows their name; the ledger keeps it rather than a hex
     string. It is only a fallback, since every read resolves the name again
     from the register ... but a weighing is a permanent record, and a record
     that can say who made it without a lookup is a better record. */
  const registerNow = await registerFor(origin);
  const whoNow = registerNow ? registerNow.who(address) : null;
  const name = whoNow && !whoNow.private ? whoNow.name : null;

  const file = await readFile('data/nudge-weighings.json');
  const store = JSON.parse(file.text);
  const row = {
    nudge: n.id, address, side: candidates ? null : side, candidate, amount, name,
    /* A move carries the colour it came off and what that colour keeps, both
       absolute. One row, because it is one act: the fold applies the source
       before the target, so no reading of this record ever shows the wallet on
       both at once. */
    ...(from ? { from, from_amount: fromAmount } : {}),
    /* Written under the allocation model. Rows without this are from before it
       and are folded as the whole of a wallet's position, which is what they
       were ... see allocations() in _lib/nudges.js. */
    ...(candidates ? { alloc: true } : {}),
    /* WHO THIS WALLET WAS CARRYING WHEN IT SIGNED, verified against the
       registry a moment ago. It is written down rather than looked up again
       because the board is read by everybody and the chain should not be: what
       was true at the moment of the act is what the record is of. The close
       asks the chain once more, and a delegation revoked in between clamps
       there exactly as a sale would. */
    ...(vaults.length ? { combo: vaults } : {}),
    at: new Date().toISOString(),
    ...(session ? { session: session.id } : { issued, signature }),
  };
  store.weighings = [...(store.weighings || []), row];
  if (storeConfigured()) await nudgeStore(pipe).add(row).catch(() => {});
  await writeFile('data/nudge-weighings.json', JSON.stringify(store, null, 1) + '\n',
    from
      ? `Nudge ${n.number}: ${name || address.slice(0, 10)} moves ${amount} to ${candidate} from ${from}`
      : `Nudge ${n.number}: ${name || address.slice(0, 10)} weighs ${amount} on ${candidate || side}`, file.sha);

  const rows = latest(store.weighings, n.id);
  if (candidates) {
    const forNudge = [...(data.weighings.weighings || []).filter((x) => x.nudge === n.id), row];
    const props = (store.proposals || []).filter((x) => x.nudge === n.id);
    const readBack = comboReader(taoReader(data.tao), forNudge);
    const back = readBack.purse(address, vaults);
    return json({ ok: true,
      palette: palette(forNudge, props, readBack, n),
      mine: { ...standing(forNudge, address, readBack), held: back.total, available: back.available },
      combo: live.combo ? { wallets: live.members.length, mark: comboMark(live.members.length) } : null });
  }
  return json({ ok: true, tally: tally(rows, comboReader(taoReader(data.tao), rows)) });
}
