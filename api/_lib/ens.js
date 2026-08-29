/* Names that point at a wallet, when the wallet points at nothing.
 *
 * The register has three ways to name somebody already: what Ryan wrote down,
 * what they chose, and their reverse record. The third is the only one that
 * comes off the chain, and it has a hole in it: a reverse record is something
 * a wallet has to set, and plenty of people register a name, point it at their
 * wallet, and never set the primary. josephj.eth is the register's own case ...
 * the second largest holding on the board, reading as `0xe09c0d24`, while
 * josephj.eth has resolved to that wallet the whole time.
 *
 * So this asks the other question. Not "what is this address called", which is
 * the reverse record and has already been asked, but "what names resolve to
 * this address", which is a forward index and only the subgraph can answer.
 *
 * ONE NAME OR NONE. If exactly one name resolves to a wallet, that is what it
 * is called; if two do, or twenty, the register says the address. Ambiguity is
 * never guessed at, and the many-names case is precisely where an impersonation
 * would live: pointing a name at somebody else's wallet costs nothing and
 * proves nothing, and the only thing that makes a single pointer trustworthy is
 * that it is the only one. mintface.eth's own wallet has five names pointing at
 * it, which is what this rule is for.
 *
 * It is the weakest tier for a reason and it is flagged as such wherever it is
 * stored: a reverse record appearing anywhere outranks it, and so does anything
 * a person actually signed for.
 */

/* The endpoint is a name, not a URL buried in a call, because this one is on
   borrowed time: the hosted service it points at has been deprecated for a
   while and answers anyway. When it stops, the replacement is a Graph gateway
   URL with a key in it, and that is one environment variable rather than a
   deploy. */
export const ENS_SUBGRAPH = process.env.ENS_SUBGRAPH_URL
  || 'https://api.thegraph.com/subgraphs/name/ensdomains/ens';

/* How many wallets go in one question, and how many answers may come back.
   The subgraph caps a page at a thousand, so a batch that could return more
   than that has to be paged or it silently truncates ... and a truncated
   answer would read as "this wallet has one name" for a wallet that has six.
   Two hundred addresses at a time keeps the answer well inside one page even
   for a batch of unusually well-named wallets, and pages anyway. */
const BATCH = 200;
const PAGE = 1000;

const lower = (s) => String(s || '').toLowerCase();

const QUERY = `query($a:[String!],$skip:Int!){
  domains(where:{resolvedAddress_in:$a}, first:${PAGE}, skip:$skip, orderBy:id){
    name
    expiryDate
    resolvedAddress{id}
  }
}`;

/** A name that is a name: resolvable, unexpired, and shaped like one. */
export function usableName(d, now = Date.now()) {
  const name = String((d && d.name) || '');
  /* The subgraph writes a null name for a label it has never seen the preimage
     of ... `[9f8c...].eth`. A name nobody can read is not a name anybody is
     called, and it is not going on the register. */
  if (!name || name.includes('[') || !/^[a-z0-9._-]+\.eth$/.test(name)) return false;
  const exp = Number(d && d.expiryDate);
  /* Expiry is only set where the subgraph knows one. A subdomain has none and
     is judged by its parent, which is not asked here: an expired parent stops
     resolving, so the pointer this tier is built on stops pointing. */
  if (Number.isFinite(exp) && exp > 0 && exp * 1000 < now) return false;
  return true;
}

/**
 * Every name that resolves to each of these wallets.
 *
 * @returns Map(address -> [name, ...]), only for wallets something points at
 */
export async function namesPointingAt(addresses, { endpoint = ENS_SUBGRAPH, fetchImpl = fetch, now = Date.now() } = {}) {
  const want = [...new Set((addresses || []).map(lower).filter((a) => /^0x[0-9a-f]{40}$/.test(a)))];
  const out = new Map();
  for (let i = 0; i < want.length; i += BATCH) {
    const batch = want.slice(i, i + BATCH);
    let skip = 0;
    for (;;) {
      const rows = await ask(endpoint, fetchImpl, batch, skip);
      for (const d of rows) {
        if (!usableName(d, now)) continue;
        const a = lower(d.resolvedAddress && d.resolvedAddress.id);
        if (!a) continue;
        const held = out.get(a) || [];
        if (!held.includes(d.name)) held.push(d.name);
        out.set(a, held);
      }
      if (rows.length < PAGE) break;
      skip += PAGE;
    }
  }
  return out;
}

async function ask(endpoint, fetchImpl, batch, skip) {
  let last = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: QUERY, variables: { a: batch, skip } }),
      });
      if (!r.ok) { last = new Error(`subgraph ${r.status}`); }
      else {
        const j = await r.json();
        if (j.errors && j.errors.length) last = new Error(String(j.errors[0].message).slice(0, 160));
        else return (j.data && j.data.domains) || [];
      }
    } catch (e) { last = e; }
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
  throw last || new Error('the subgraph did not answer');
}

/**
 * The tier itself: what a wallet is called by forward resolution alone.
 *
 * @param names  every name pointing at the wallet
 * @returns { name } for exactly one, or { ambiguous: n } / null
 */
export function forwardName(names) {
  const list = [...new Set((names || []).map(lower))];
  if (list.length === 1) return { name: list[0] };
  if (list.length > 1) return { ambiguous: list.length, names: list };
  return null;
}

/**
 * The whole pass, over a list of wallets, ready to be written down.
 *
 * `skip` is the wallets that already have a name from a stronger tier. They are
 * not asked about at all: a reverse record outranks this, so a wallet that has
 * one is nobody's business here and asking would only cost a question.
 */
export async function forwardPass(addresses, { skip = new Set(), ...opts } = {}) {
  const ask = [...new Set((addresses || []).map(lower))].filter((a) => !skip.has(a));
  const found = await namesPointingAt(ask, opts);
  const names = {};
  const ambiguous = {};
  for (const [address, list] of found) {
    const r = forwardName(list);
    if (!r) continue;
    if (r.name) names[address] = r.name;
    else ambiguous[address] = r.names;
  }
  return {
    names,
    ambiguous,
    counts: { asked: ask.length, named: Object.keys(names).length, ambiguous: Object.keys(ambiguous).length },
  };
}
