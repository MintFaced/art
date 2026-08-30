import { verifyMessage } from 'viem';
import { readFile, writeFile } from './_lib/repo.js';
import { siteOrigin, useRequestOrigin } from './_lib/data.js';
import { tally, latest, isOpen, weighMessage, proposeMessage, palette, checkHex, kindOf, lockRule, CANDIDATES, SIDES } from './_lib/nudges.js';
import { loadRegister } from './_lib/register.js';
import { storeConfigured, pipe } from './_lib/kv.js';

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
  const [nudges, weighings, tao] = await Promise.all([
    at('data/nudges.json'), at('data/nudge-weighings.json'), at('data/tao.json'),
  ]);
  return { nudges, weighings, tao };

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

  /* Who a ledger row is, said as the register reads them today. A weighing is
     a public record of who steered a decision, so the name on it has to be the
     name that person answers to now, and it has to lead somewhere. */
  const dress = (r) => {
    const w = register ? register.who(r.address) : null;
    return {
      address: r.address,
      name: (w && w.known ? w.name : null) || r.name || (w ? w.name : null) || null,
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
    };

    if (kindOf(n) === CANDIDATES) {
      const props = (data.weighings.proposals || []).filter((x) => x.nudge === n.id);
      // a banked nudge keeps what it closed with, whatever has happened since
      const p = n.banked ? n.banked : palette(rows, props, readTao, n);
      return {
        ...base,
        rule: p.rule || lockRule(n),
        total: p.total, collectors: p.collectors,
        leader: p.leader || null, locked: p.locked || null, why: p.why || null,
        progress: p.progress || null,
        /* The public record, one row per collector and the row is where they
           stand now. Newest first: on a board still forming, what just moved
           is the interesting part. */
        ledger: (p.ledger || []).map(dress),
        candidates: (p.candidates || []).map((c) => ({
          hex: c.hex, total: c.total, voters: c.voters, share: c.share,
          proposed_by: c.proposed_by || null,
          proposed_name: c.proposed_by && register
            ? ((register.who(c.proposed_by) || {}).name || c.proposed_name || null)
            : (c.proposed_name || null),
          proposed_url: c.proposed_by && register ? register.urlOf(c.proposed_by) : null,
          ledger: (c.ledger || []).map(dress),
        })),
        mine: mine ? { candidate: mine.candidate || null, amount: mine.amount, at: mine.at } : null,
        proposed: who ? Boolean(props.find((x) => lower(x.address) === lower(who))) : false,
      };
    }

    const t = n.banked ? n.banked : tally(rows, readTao);
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
    tao: who ? readTao(who) : null,
    rule: 'A nudge steers. It never commands. The studio may act with, against, or without the result.',
  });
}

/** Weigh, or weigh again. The latest stands. */
export async function POST(request) {
  const origin = useRequestOrigin(request) || siteOrigin();
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }

  const address = lower(body.address);
  const action = String(body.action || 'weigh');
  const side = String(body.side || '').toLowerCase();
  const amount = Math.floor(Number(body.amount));
  const issued = String(body.issued || '');
  const signature = String(body.signature || '');
  const nudgeId = String(body.nudge || '');

  if (!/^0x[0-9a-f]{40}$/.test(address)) return json({ error: 'that is not a wallet address' }, 400);
  if (!['weigh', 'propose'].includes(action)) return json({ error: 'no such action' }, 400);
  if (!signature.startsWith('0x')) return json({ error: 'a signature is required' }, 400);
  // an old signature should not sit around waiting to be replayed
  const age = Date.now() - Date.parse(issued);
  if (!Number.isFinite(age) || age < -60000 || age > 15 * 60 * 1000) {
    return json({ error: 'that signature has gone stale, please sign again' }, 400);
  }

  let data;
  try { data = await load(origin); } catch (e) { return json({ error: 'the studio is not reachable' }, 503); }

  const n = (data.nudges.nudges || []).find((x) => x.id === nudgeId);
  if (!n) return json({ error: 'no such nudge' }, 404);
  if (!isOpen(n)) return json({ error: 'this nudge has closed' }, 409);
  const candidates = kindOf(n) === CANDIDATES;

  const held = Math.floor(taoReader(data.tao)(address) || 0);
  if (held <= 0) return json({ error: 'this wallet holds no TAO yet' }, 403);

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
    const colour = checkHex(body.hex);
    if (colour.error) return json({ error: colour.error }, 400);

    const message = proposeMessage({ nudge: n.question, hex: colour.hex, address, issued });
    let good = false;
    try { good = await verifyMessage({ address, message, signature }); } catch (e) { good = false; }
    if (!good) return json({ error: 'that signature does not match the wallet' }, 401);

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
    store.proposals = [...(store.proposals || []), {
      nudge: n.id, hex: colour.hex, address,
      name: w0 && !w0.private ? w0.name : null,
      at: new Date().toISOString(), issued, signature,
    }];
    await writeFile('data/nudge-weighings.json', JSON.stringify(store, null, 1) + '\n',
      `Nudge ${n.number}: ${(w0 && w0.name) || address.slice(0, 10)} proposes ${colour.hex}`, file.sha);
    return json({ ok: true, hex: colour.hex,
      palette: palette(latest(store.weighings || [], n.id), (store.proposals || []).filter((x) => x.nudge === n.id), taoReader(data.tao), n) });
  }

  /* ---- weighing ---- */
  let candidate = null;
  if (candidates) {
    const colour = checkHex(body.candidate);
    if (colour.error) return json({ error: 'weigh behind one of the colours on the board' }, 400);
    candidate = colour.hex;
    const onBoard = (data.weighings.proposals || [])
      .some((x) => x.nudge === n.id && String(x.hex).toUpperCase() === candidate);
    if (!onBoard) return json({ error: 'that colour is not on the board. Propose it first.' }, 404);
  } else if (!SIDES.includes(side)) {
    return json({ error: 'a nudge is a yes or a no' }, 400);
  }
  if (!Number.isFinite(amount) || amount <= 0) return json({ error: 'weigh some TAO, or none at all' }, 400);
  if (amount > held) return json({ error: `that is more than this wallet holds. Its TAO is ${held.toLocaleString('en-NZ')}.` }, 400);

  const message = weighMessage({ nudge: n.question, side, candidate, amount, address, issued });
  let ok = false;
  try { ok = await verifyMessage({ address, message, signature }); } catch (e) { ok = false; }
  if (!ok) return json({ error: 'that signature does not match the wallet' }, 401);

  /* The register knows their name; the ledger keeps it rather than a hex
     string. It is only a fallback, since every read resolves the name again
     from the register ... but a weighing is a permanent record, and a record
     that can say who made it without a lookup is a better record. */
  const registerNow = await registerFor(origin);
  const whoNow = registerNow ? registerNow.who(address) : null;
  const name = whoNow && !whoNow.private ? whoNow.name : null;

  const file = await readFile('data/nudge-weighings.json');
  const store = JSON.parse(file.text);
  store.weighings = [...(store.weighings || []), {
    nudge: n.id, address, side: candidates ? null : side, candidate, amount, name,
    at: new Date().toISOString(), issued, signature,
  }];
  await writeFile('data/nudge-weighings.json', JSON.stringify(store, null, 1) + '\n',
    `Nudge ${n.number}: ${name || address.slice(0, 10)} weighs ${amount} on ${candidate || side}`, file.sha);

  const rows = latest(store.weighings, n.id);
  return json({ ok: true, ...(candidates
    ? { palette: palette(rows, (store.proposals || []).filter((x) => x.nudge === n.id), taoReader(data.tao), n) }
    : { tally: tally(rows, taoReader(data.tao)) }) });
}
