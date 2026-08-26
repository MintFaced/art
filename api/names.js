import { verifyMessage } from 'viem';
import { useRequestOrigin, siteOrigin } from './_lib/data.js';
import { storeConfigured, pipe } from './_lib/kv.js';
import { loadRegister } from './_lib/register.js';
import {
  namesStore, nameMessage, checkName, claimedBy, fold, NAME_MAX,
} from './_lib/names.js';
import { chatStore } from './_lib/chat.js';
import { isArtist as artistIs } from './_lib/artist.js';

/* What a collector is called.
 *
 * The register has always been able to name somebody ... a reverse ENS record,
 * or a name Ryan wrote down ... and this is the third source: the name they
 * choose themselves. It sits between the two, under Ryan's overlay and over the
 * chain's answer, and it is the only one of the three that lives in the store
 * rather than in a file, because it changes when a person decides it does and
 * not when a cron runs.
 *
 * The same rig as the notes and the nudges: a wallet signs one sentence saying
 * what it wants to be called, and that signature authorises that one change.
 * No session ... a name is set twice a year, and a signature per change is the
 * right price for something everybody else has to read.
 *
 * Nothing here touches a slug. A URL is an address, a name is a label, and
 * keeping them apart is what stops a link rotting every time somebody has
 * second thoughts.
 */

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};
const json = (b, s = 200, headers = {}) => new Response(JSON.stringify(b, null, 1), {
  status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS, ...headers },
});
const lower = (a) => String(a || '').toLowerCase();
const ACTIONS = ['set', 'clear', 'reset'];

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

const at = async (origin, p) => {
  const r = await fetch(`${origin}/${p}`, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`${p}: ${r.status}`);
  return r.json();
};

/* ---------------------------------------------------------------- reading */

/** One collector, as a page that has to draw a name needs them. */
const card = (who) => ({
  address: who.address,
  name: who.name,
  slug: who.slug || null,
  ens: who.ens || null,
  url: who.url || (who.slug ? `https://collectors.mintface.art/${encodeURIComponent(who.slug)}` : null),
  source: who.source,
  private: Boolean(who.private),
  tao: who.tao || 0,
});

export async function GET(request) {
  const origin = useRequestOrigin(request) || siteOrigin();
  const url = new URL(request.url);
  const address = lower(url.searchParams.get('address') || '');
  const viewer = lower(url.searchParams.get('viewer') || '');
  const q = String(url.searchParams.get('q') || '').trim();
  const check = url.searchParams.get('check');
  const wantLog = url.searchParams.get('log');

  /* The whole overlay, small and cacheable.
   *
   * Every page that draws a name already has the register, which is a nightly
   * file a CDN is happy to hold for a day. What it does not have is the names
   * chosen since that file was written. So those are published on their own,
   * a few kilobytes of them, and laid over the record the way the live TAO
   * board is laid over a collector page. If it does not load, the page shows
   * the register's name ... a little behind, and never wrong in kind.
   *
   * Answered before the register is opened, and without it. This is the most
   * asked question on either site ... every page that draws a name asks it ...
   * and the answer is one hash in the store. Reading half a megabyte to hand
   * back four kilobytes would be a strange way to spend a request. */
  if (!address && !q && !wantLog && check == null) {
    if (!storeConfigured()) return json({ names: {}, count: 0, max_chars: NAME_MAX, store: false });
    const chosen = await namesStore(pipe).all().catch(() => null);
    if (!chosen) return json({ error: 'the register is not reachable' }, 503);
    return json(
      { names: chosen, count: Object.keys(chosen).length, max_chars: NAME_MAX, store: true },
      200,
      { 'cache-control': 'public, max-age=0, s-maxage=30, stale-while-revalidate=300' },
    );
  }

  let reg;
  try {
    reg = await loadRegister(at, origin, storeConfigured() ? pipe : null);
  } catch (e) {
    return json({ error: 'the register is not reachable' }, 503);
  }

  /* The change log. Ryan's, because it is the record of a power he holds and
     everybody else's name changes are nobody else's business. */
  if (wantLog) {
    if (!storeConfigured()) return json({ changes: [], store: false });
    if (!artistIs(reg.artist, viewer)) return json({ error: 'the register keeps its own log' }, 403);
    const changes = await namesStore(pipe).history(Math.min(500, Number(wantLog) || 100));
    return json({ changes, store: true });
  }

  /* Is this name going?
   *
   * Asked while somebody is still typing it, and answered without a signature,
   * because the alternative is a wallet prompt for a name that was never going
   * to be allowed. The server checks the same thing again when the signature
   * arrives ... this is a courtesy, not the guard, and a name can still be taken
   * in the seconds between. But on a hardware wallet the difference between
   * being told now and being told after a walk to the drawer is the whole of
   * whether the feature is pleasant to use.
   */
  if (check != null) {
    const me = /^0x[0-9a-f]{40}$/.test(address) ? address : null;
    const who = me ? reg.who(me) : null;
    const checked = checkName(check, { ens: who ? [who.ens, who.slug].filter(Boolean) : [] });
    if (checked.error) return json({ free: false, why: checked.error, name: String(check) });
    const taken = storeConfigured() ? await namesStore(pipe).taken().catch(() => ({})) : {};
    const clash = claimedBy(checked.key, { address: me || '', rows: reg.rows, taken });
    return json({ free: !clash, why: clash ? `That name is taken ... ${clash}.` : null, name: checked.name });
  }

  /* Autocomplete, for the @ in Studio.
   *
   * Ranked by TAO, because the register is ranked by TAO and a room where the
   * first suggestion is whoever sorts alphabetically is a room that has stopped
   * agreeing with the page beside it. A muted wallet is left out: muting is
   * quiet, and a name the room offers to put in somebody's mouth is not quiet.
   */
  if (q) {
    const limit = Math.min(12, Math.max(1, Number(url.searchParams.get('limit')) || 8));
    const key = fold(q);
    const raw = lower(q);
    const muted = new Set();
    if (storeConfigured()) {
      try { for (const m of await chatStore(pipe).muted()) muted.add(lower(m)); } catch (e) { /* the list is a courtesy */ }
    }

    const hits = [];
    const consider = (who) => {
      if (!who || who.private || muted.has(who.address)) return;
      const name = fold(who.name);
      const ens = fold(who.ens);
      let rank = null;
      if (key && name.startsWith(key)) rank = 0;
      else if (key && ens && ens.startsWith(key)) rank = 1;
      else if (who.address.startsWith(raw) && raw.length >= 3) rank = 2;
      else if (key && name.includes(key)) rank = 3;
      else if (key && ens && ens.includes(key)) rank = 4;
      if (rank === null) return;
      hits.push({ ...card(who), rank });
    };

    for (const [a] of reg.named) consider(reg.who(a));
    for (const [a] of reg.rows) consider(reg.who(a));
    hits.sort((x, y) => x.rank - y.rank || (y.tao || 0) - (x.tao || 0)
      || String(x.name).localeCompare(String(y.name)));
    return json({ q, collectors: hits.slice(0, limit).map(({ rank, ...c }) => c) });
  }

  /* One wallet: what it is called, where the name came from, and whether the
     person looking at it may change it. The page asks this before it offers an
     EDIT, so nobody is invited to sign something that will be refused. */
  if (!/^0x[0-9a-f]{40}$/.test(address)) return json({ error: 'that is not a wallet address' }, 400);
  const who = reg.who(address);
  const known = reg.rows.has(address) || reg.named.has(address);
  const mine = viewer && viewer === address;
  const me = mine
    ? {
      can_edit: known && !who.private && !who.fixed,
      why: !known
        ? 'This wallet holds no MintFace work yet, so the register has nowhere to write a name.'
        : who.private
          ? 'This wallet is recorded as a private collector, so no name would be shown.'
          : who.overlay
            ? 'MintFace has written a name beside this wallet, and that is the one the register shows. A name set here waits underneath it.'
            : null,
      /* Ryan's overlay outranks a self-set name, so a page that let somebody
         type one without saying so would be a page that quietly did nothing. */
      outranked: Boolean(who.overlay),
      self: who.self || null,
      max_chars: NAME_MAX,
    }
    : null;

  return json({ ...card(who), overlay: who.overlay || null, self: who.self || null, me,
    artist: artistIs(reg.artist, viewer), store: storeConfigured() });
}

/* ---------------------------------------------------------------- writing */

export async function POST(request) {
  const origin = useRequestOrigin(request) || siteOrigin();
  if (!storeConfigured()) return json({ error: 'names are not open yet' }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }

  const action = String(body.action || 'set');
  if (!ACTIONS.includes(action)) return json({ error: 'no such action' }, 400);

  const address = lower(body.address);
  const signature = String(body.signature || '');
  const issued = String(body.issued || '');
  if (!/^0x[0-9a-f]{40}$/.test(address)) return json({ error: 'that is not a wallet address' }, 400);
  if (!signature.startsWith('0x')) return json({ error: 'a signature is required' }, 400);
  const age = Date.now() - Date.parse(issued);
  if (!Number.isFinite(age) || age < -60000 || age > 15 * 60 * 1000) {
    return json({ error: 'that signature has gone stale, please sign again' }, 400);
  }

  let reg;
  try {
    reg = await loadRegister(at, origin, pipe);
  } catch (e) {
    return json({ error: 'the register is not reachable' }, 503);
  }
  const db = namesStore(pipe);
  const isArtist = artistIs(reg.artist, address);

  const verify = async (payload) => {
    const message = nameMessage({ ...payload, address, issued });
    try { return await verifyMessage({ address, message, signature }); } catch (e) { return false; }
  };

  /* Ryan clears a name. The same quiet power as taking a note down: it removes
     what somebody chose and leaves them their ENS, which is theirs on chain and
     was never his to take. */
  if (action === 'reset') {
    if (!isArtist) return json({ error: 'the register is kept by the artist' }, 403);
    const target = lower(body.target);
    if (!/^0x[0-9a-f]{40}$/.test(target)) return json({ error: 'reset a wallet address' }, 400);
    if (!(await verify({ action: 'reset', target }))) {
      return json({ error: 'that signature does not match the wallet' }, 401);
    }
    const had = await db.get(target);
    if (had) await db.release(fold(had));
    await db.clear(target);
    await db.note({ at: new Date().toISOString(), action: 'reset', address: target, from: had || null, to: null, by: address });
    return json({ ok: true, address: target, was: had || null, name: reg.who(target).name });
  }

  /* From here it is somebody changing their own name, and only their own: the
     address the signature proves is the address the change lands on, and no
     field in the body can point it anywhere else. */
  const who = reg.who(address);
  if (!reg.rows.has(address)) {
    return json({ error: 'This wallet holds no MintFace work yet. Acquire one and the register will have somewhere to write a name.' }, 403);
  }
  if (who.private) {
    return json({ error: 'This wallet is recorded as a private collector, so no name would be shown.' }, 403);
  }
  if (await chatStore(pipe).isMuted(address)) {
    return json({ error: 'This wallet is muted. It can still read.' }, 403);
  }

  const had = await db.get(address);

  if (action === 'clear') {
    if (!(await verify({ action: 'clear' }))) {
      return json({ error: 'that signature does not match the wallet' }, 401);
    }
    if (had) await db.release(fold(had));
    await db.clear(address);
    await db.note({ at: new Date().toISOString(), action: 'clear', address, from: had || null, to: null, by: address });
    // what they fall back to: their ENS, or the address
    const after = reg.who(address);
    return json({ ok: true, address, name: after.overlay || after.ens || null, self: null });
  }

  const checked = checkName(body.name, { ens: [who.ens, who.slug].filter(Boolean) });
  if (checked.error) return json({ error: checked.error }, 400);

  /* Uniqueness before the signature is verified. The page has already asked the
     same question through `?check=` while the name was being typed, so this is
     the one that counts ... a name can be taken in the seconds between somebody
     reading "that name is free" and their wallet answering. */
  const taken = await db.taken();
  const clash = claimedBy(checked.key, { address, rows: reg.rows, taken });
  if (clash) return json({ error: `That name is taken ... ${clash}.` }, 409);

  if (!(await verify({ action: 'set', name: checked.name }))) {
    return json({ error: 'that signature does not match the wallet' }, 401);
  }

  /* The claim is the lock. Two wallets signing the same name in the same second
     both reach here, and exactly one of them gets the key back. */
  const got = await db.claim(checked.key, address);
  if (!got.ok) return json({ error: 'That name has just been taken.' }, 409);
  if (had && fold(had) !== checked.key) await db.release(fold(had));
  await db.set(address, checked.name);
  await db.note({ at: new Date().toISOString(), action: 'set', address, from: had || null, to: checked.name, by: address });

  const after = reg.who(address);
  return json({
    ok: true, address, self: checked.name,
    // what the register will actually show, which is not always what was set
    name: after.overlay || checked.name,
    outranked: Boolean(after.overlay),
  });
}
