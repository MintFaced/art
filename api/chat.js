import { verifyMessage } from 'viem';
import { useRequestOrigin, siteOrigin } from './_lib/data.js';
import { storeConfigured, pipe } from './_lib/kv.js';
import { chatStore, chatMessage, checkMessage, render, sessionUntil } from './_lib/chat.js';
import { loadArtist, isArtist as artistIs, taoGate, ARTIST_NAME } from './_lib/artist.js';

/* The room.
 *
 * Reading takes no wallet and no sign-in, because a room nobody can look into
 * is not part of a site, it is a door. Speaking takes any TAO at all, checked
 * against the register at the moment of speaking.
 *
 * The same rig as the notes and the nudges: a wallet signs a sentence saying
 * what it is about to say, and that signature authorises that one message.
 * There is no session, so there is nothing to expire and nothing to steal, and
 * the words approved in the wallet are the words that appear.
 */

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};
const json = (b, s = 200) => new Response(JSON.stringify(b, null, 1), {
  status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS },
});
const lower = (a) => String(a || '').toLowerCase();
const ACTIONS = ['sign in', 'sign out', 'say', 'delete', 'restore', 'mute', 'unmute'];

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

const at = async (origin, p) => {
  const r = await fetch(`${origin}/${p}`, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`${p}: ${r.status}`);
  return r.json();
};

async function config(origin) {
  const [cfg, artist] = await Promise.all([
    at(origin, 'data/source/chat.json'),
    loadArtist(at, origin),
  ]);
  cfg.artist = artist;
  return cfg;
}

const SHUT = 'Studio is for anyone holding TAO. One MintFace artwork, held a little while, is enough.';

/** What the register knows about a wallet: what it holds, and what to call it. */
async function whois(origin, address) {
  const a = lower(address);
  const [tao, name] = await Promise.all([
    at(origin, 'data/tao.json').then((t) => {
      const w = t.wallets && t.wallets[a];
      return w ? w.tao : 0;
    }).catch(() => 0),
    at(origin, 'data/collectors.json').then((r) => {
      const hit = (r.collectors || []).find((c) => lower(c.address) === a);
      return hit ? (hit.display_name || hit.ens || null) : null;
    }).catch(() => null),
  ]);
  return { tao, name };
}

/* ---------------------------------------------------------------- reading */

export async function GET(request) {
  const origin = useRequestOrigin(request) || siteOrigin();
  const url = new URL(request.url);
  const viewer = lower(url.searchParams.get('viewer') || '');
  const before = url.searchParams.get('before');
  const since = url.searchParams.get('since');

  if (!storeConfigured()) {
    return json({ messages: [], total: 0, more: false, store: false });
  }

  let cfg;
  try { cfg = await config(origin); } catch (e) { return json({ error: 'Studio is not reachable' }, 503); }
  const db = chatStore(pipe, cfg);
  const isArtist = Boolean(viewer && cfg.artist[viewer]);

  try {
    /* The poll. Nothing but what has been said since, so a quiet room costs a
       length and an empty answer. Fifteen hundred bytes a minute per reader,
       which is what a salon is worth and no more. */
    if (since != null) {
      const { rows, total } = await db.since(Number(since) || 0);
      return json({ messages: rows.map((r) => render(r, { isArtist, artist: cfg.artist })), total, store: true });
    }

    const page = await db.page({ before: before == null ? null : Number(before), limit: Number(cfg.page) || 50 });
    let me = null;
    if (/^0x[0-9a-f]{40}$/.test(viewer)) {
      const who = await whois(origin, viewer);
      const muted = await db.isMuted(viewer);
      const gate = taoGate({ artist: cfg.artist, address: viewer, tao: who.tao, min: cfg.min_tao || 1, why: SHUT });
      me = {
        tao: gate.role === 'artist' ? null : who.tao,
        name: gate.role === 'artist' ? ARTIST_NAME : who.name,
        role: gate.role,
        can_speak: gate.ok && !muted,
        muted,
        why: muted ? 'This wallet is muted in Studio. You can still read.' : (gate.ok ? null : gate.why),
        artist: isArtist,
      };
    }
    return json({
      messages: page.rows.map((r) => render(r, { isArtist, artist: cfg.artist })),
      start: page.start, end: page.end, total: page.total, more: page.more,
      me, max_chars: cfg.max_chars, session_days: Number(cfg.session_days || 7), store: true,
    });
  } catch (e) {
    return json({ error: 'Studio is not reachable' }, 503);
  }
}

/* ---------------------------------------------------------------- speaking */

export async function POST(request) {
  const origin = useRequestOrigin(request) || siteOrigin();
  if (!storeConfigured()) return json({ error: 'Studio is not open yet' }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }

  const action = String(body.action || 'say');
  const signature = String(body.signature || '');
  const issued = String(body.issued || '');
  const token = String(body.token || '');

  if (!ACTIONS.includes(action)) return json({ error: 'no such action' }, 400);

  let cfg;
  try { cfg = await config(origin); } catch (e) { return json({ error: 'Studio is not reachable' }, 503); }
  const db = chatStore(pipe, cfg);

  /* Who is doing this, settled once and before anything else.
     A session says so, and where it does the request is not asked ... the
     address in the body is ignored entirely, because a token that says who you
     are and a field that also says who you are is a lock with the door left
     open beside it. Without a session, the signature says so instead, and that
     is still a supported way to speak: signing every message is the right trade
     for a wallet you touch twice a year. */
  let address = null;
  let bySession = false;
  if (token && action !== 'sign in') {
    address = await db.whoseSession(token);
    if (!address) return json({ error: 'that sign-in has run out. Sign in again.', expired: true }, 401);
    bySession = true;
  } else {
    address = lower(body.address);
    if (!/^0x[0-9a-f]{40}$/.test(address)) return json({ error: 'that is not a wallet address' }, 400);
    if (!signature.startsWith('0x')) return json({ error: 'a signature is required' }, 400);
    const age = Date.now() - Date.parse(issued);
    if (!Number.isFinite(age) || age < -60000 || age > 15 * 60 * 1000) {
      return json({ error: 'that signature has gone stale, please sign again' }, 400);
    }
  }

  const isArtist = Boolean(cfg.artist[address]);
  const verify = async (payload) => {
    if (bySession) return true;                     // already established, once
    const message = chatMessage({ ...payload, address, issued });
    try { return await verifyMessage({ address, message, signature }); } catch (e) { return false; }
  };

  /* ---- opening and closing the week ---- */
  if (action === 'sign in') {
    const days = Number(cfg.session_days || 7);
    const until = sessionUntil(issued, days);
    if (!until) return json({ error: 'bad request' }, 400);
    if (!(await verify({ action: 'sign in', until }))) {
      return json({ error: 'that signature does not match the wallet' }, 401);
    }
    if (await db.isMuted(address)) {
      return json({ error: 'This wallet is muted in Studio. You can still read.' }, 403);
    }
    const fresh = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
    await db.openSession(fresh, address, days * 86400);
    return json({ ok: true, token: fresh, until, address });
  }
  if (action === 'sign out') {
    await db.closeSession(token);
    return json({ ok: true, signed_out: true });
  }

  /* ---- the whole moderation toolset ---- */
  if (action !== 'say') {
    if (!isArtist) return json({ error: 'Studio is moderated by the artist' }, 403);

    if (action === 'mute' || action === 'unmute') {
      const target = lower(body.target);
      if (!/^0x[0-9a-f]{40}$/.test(target)) return json({ error: 'mute a wallet address' }, 400);
      if (!(await verify({ action, target }))) return json({ error: 'that signature does not match the wallet' }, 401);
      if (action === 'mute') await db.mute(target); else await db.unmute(target);
      return json({ ok: true, muted: await db.muted() });
    }

    /* One field, `target`, for every moderation action: the wallet for a mute,
       the message number for a deletion. It is sent and signed identically, so
       there is no mapping between what the browser puts in the body and what it
       puts in the sentence, and therefore nothing for the two to disagree
       about. Signatures that fail for a field name are unbearable to debug. */
    const n = Number(body.target);
    if (!Number.isInteger(n) || n < 0) return json({ error: 'which message?' }, 400);
    const row = await db.get(n);
    if (!row) return json({ error: 'no such message' }, 404);
    if (!(await verify({ action, target: String(body.target) }))) {
      return json({ error: 'that signature does not match the wallet' }, 401);
    }
    row.deleted = action === 'delete';
    await db.save(row);
    return json({ ok: true, n, deleted: row.deleted, message: render(row, { isArtist: true, artist: cfg.artist }) });
  }

  /* ---- saying something ---- */
  const text = checkMessage(body.text, cfg);
  if (text.error) return json({ error: text.error }, 400);

  if (await db.isMuted(address)) {
    return json({ error: 'This wallet is muted in Studio. You can still read.' }, 403);
  }

  const who = await whois(origin, address);
  const gate = taoGate({ artist: cfg.artist, address, tao: who.tao, min: cfg.min_tao || 1, why: SHUT });
  if (!gate.ok) return json({ error: gate.why, tao: gate.tao }, 403);

  if (!(await verify({ action: 'say', text: text.text }))) {
    return json({ error: 'that signature does not match the wallet' }, 401);
  }

  /* Spent only once the message is known to be good, so a refusal for its
     words does not also cost somebody their fifteen seconds. */
  const spend = await db.spend(address);
  if (spend.error) return json({ error: spend.error }, 429);

  const row = await db.say({
    address, role: gate.role,
    name: gate.role === 'artist' ? ARTIST_NAME : who.name,
    tao: gate.role === 'artist' ? 0 : who.tao,
    text: text.text, at: new Date().toISOString(), deleted: false,
  });
  return json({ ok: true, message: render(row, { isArtist, artist: cfg.artist }) });
}
