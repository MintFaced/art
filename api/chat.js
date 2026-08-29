import { verifyMessage } from 'viem';
import { useRequestOrigin, siteOrigin } from './_lib/data.js';
import { storeConfigured, pipe } from './_lib/kv.js';
import { chatStore, chatMessage, checkMessage, checkReaction, marksOf, reactionSet, render, sessionUntil } from './_lib/chat.js';
import { loadArtist, isArtist as artistIs, taoGate, ARTIST_NAME } from './_lib/artist.js';
import { loadRegister } from './_lib/register.js';
import { parseTags, tagIndex } from './_lib/names.js';
import { linksIn } from './_lib/text.js';
import { cardStore, familyKind, fetchCard, ourCard } from './_lib/cards.js';
import { corsFor, cookieFrom, openCookies, clearCookies, domainOk, hostOf, TOKEN_COOKIE, WHO_COOKIE } from './_lib/session.js';
import { checkImage, imageKey, imageFingerprint } from './_lib/images.js';
import { putObject, r2Configured } from './_lib/r2.js';

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

/* The answer, and who may read it.
 *
 * A credentialed request cannot be answered with a wildcard, so the CORS
 * headers are worked out per request rather than written once: the family gets
 * its own origin echoed and permission to send the cookie, everything else
 * gets the wildcard the room has always answered with. See _lib/session.js. */
const respond = (request, b, s = 200, extra = null) => {
  const h = new Headers({ 'content-type': 'application/json', 'cache-control': 'no-store', ...corsFor(request) });
  for (const line of extra || []) h.append('set-cookie', line);
  return new Response(JSON.stringify(b, null, 1), { status: s, headers: h });
};
const lower = (a) => String(a || '').toLowerCase();
const ACTIONS = ['sign in', 'sign out', 'say', 'react', 'seen', 'delete', 'restore', 'mute', 'unmute'];

/* What one request for link previews may cost. A page is fifty messages, and
   a message may carry three links, so the caps are what keeps a page of the log
   from becoming a hundred and fifty outbound requests. The rest are asked for
   again on the next page, which is where a reader is going anyway. */
const MOST_ROWS = 60;
const MOST_CARDS = 24;
const MOST_FETCHES = 4;

export function OPTIONS(request) {
  return new Response(null, { status: 204, headers: corsFor(request) });
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

/** What the register knows about a wallet: what it holds, and what to call it.
 *
 * The name comes off the register rather than off data/collectors.json, which
 * holds only the eight hundred collectors with pages. A wallet holding a single
 * edition copy is welcome in Studio by design and was speaking under a short
 * address even where the chain had a name for it. */
async function whois(origin, address, register) {
  const a = lower(address);
  const tao = await at(origin, 'data/tao.json').then((t) => {
    const w = t.wallets && t.wallets[a];
    return w ? w.tao : 0;
  }).catch(() => 0);
  const who = register ? register.who(a) : null;
  return { tao, name: who && who.known ? who.name : null };
}

/** Where a wallet stands in the room: what to call it, whether it may speak,
 *  and what waited for it. Asked by the room when it draws a page, and by the
 *  nav on every page of both sites, and it must be the same answer to both. */
async function standing(db, origin, viewer, cfg, register, isArtist) {
  const who = await whois(origin, viewer, register);
  const muted = await db.isMuted(viewer);
  const gate = taoGate({ artist: cfg.artist, address: viewer, tao: who.tao, min: cfg.min_tao || 1, why: SHUT });
  /* Who has said your name since you were last in. Nothing is emailed and
     nothing is pushed: the cherry tells you, wherever on the site you are. */
  const seen = await db.lastSeen(viewer);
  const said = await db.mentionsSince(viewer, seen == null ? 0 : seen);
  return {
    tao: gate.role === 'artist' ? null : who.tao,
    name: gate.role === 'artist' ? ARTIST_NAME : who.name,
    role: gate.role,
    can_speak: gate.ok && !muted,
    muted,
    why: muted ? 'This wallet is muted in Studio. You can still read.' : (gate.ok ? null : gate.why),
    artist: isArtist,
    url: register ? register.urlOf(viewer) : null,
    /* A wallet that has never been in has never read any of it, so a first
       visit counts everything. It is the useful answer: arriving to find you
       were named is the whole reason the count exists.
       `next` is where the cherry takes you: the earliest one you have not
       read. The count is not cleared by arriving ... the cherry is the
       notifier, and an unread mark that clears itself the moment you glance at
       a page is not one. Pressing it is what marks it. */
    mentions: { unseen: said.unseen, total: said.total, next: said.next, first_visit: seen == null },
  };
}

/* What a page of the log needs beyond its own rows.
 *
 * Two lookups, both by message number and both batched: the messages these
 * ones are replying to, and the marks left under them. A reply stores a number
 * and nothing else ... not a name, not an address ... so the parent has to be
 * read to be drawn, and reading fifty of them in one MGET is the difference
 * between that being free and that being a page load.
 *
 * The rows already in hand stand in for themselves: a conversation is mostly
 * replies to things a few lines up, so most of this asks the store for nothing.
 */
async function dressing(db, rows, base) {
  const have = new Set(rows.map((r) => r.n));
  const want = [...new Set(rows
    .map((r) => Number(r.reply))
    .filter((n) => Number.isInteger(n) && n >= 0 && !have.has(n)))].slice(0, MOST_ROWS);
  const [fetched, reactions] = await Promise.all([
    want.length ? db.many(want).catch(() => []) : Promise.resolve([]),
    db.marks(rows.filter((r) => !r.deleted).map((r) => r.n)).catch(() => ({})),
  ]);
  const parents = {};
  for (const r of rows) parents[r.n] = r;
  for (const r of fetched) parents[r.n] = r;
  return { ...base, parents, reactions };
}

/* ---------------------------------------------------------------- reading */

export async function GET(request) {
  const origin = useRequestOrigin(request) || siteOrigin();
  const url = new URL(request.url);
  /* Who is reading. The page may say, and the room's own page does because it
     already knows. A page that does not ... the nav on the register, arriving
     with a cookie and nothing else ... is answered from the session instead,
     which is the whole point of the session being a cookie. */
  let viewer = lower(url.searchParams.get('viewer') || '');
  const before = url.searchParams.get('before');
  const since = url.searchParams.get('since');
  const cards = url.searchParams.get('cards');
  const rx = url.searchParams.get('rx');

  if (!storeConfigured()) {
    return respond(request, { messages: [], total: 0, more: false, store: false });
  }

  let cfg;
  try { cfg = await config(origin); } catch (e) { return respond(request, { error: 'Studio is not reachable' }, 503); }
  const db = chatStore(pipe, cfg);
  if (!viewer) {
    const held = cookieFrom(request, TOKEN_COOKIE);
    if (held) viewer = (await db.whoseSession(held).catch(() => null)) || '';
  }
  const isArtist = Boolean(viewer && cfg.artist[viewer]);

  /* Every name in the room is drawn from the register, because an old message
     shows what its author is called today rather than what they were called the
     day they said it.
     Asked for only when there is something to name. The register is half a
     megabyte and the poll runs every few seconds in every open tab, so a quiet
     room must not pay for it ... which is the whole reason the poll exists. A
     register that will not load is not fatal: the stored names stand in. */
  let waiting = null;
  const register = () => (waiting || (waiting = loadRegister(at, origin, pipe).catch(() => null)));

  try {
    /* The poll. Nothing but what has been said since, so a quiet room costs a
       length and an empty answer. Fifteen hundred bytes a minute per reader,
       which is what a salon is worth and no more. */
    if (since != null) {
      const { rows, total } = await db.since(Number(since) || 0);
      /* The marks are one number on the poll rather than a page of counts.
         A reader with fifty messages on screen cannot be asked what is under
         each of them every six seconds, and nearly always the answer is the
         same as last time ... so the room carries where the marks are up to,
         and the page goes and looks only when that has moved. */
      const marks = await db.marksVersion().catch(() => 0);
      if (!rows.length) return respond(request, { messages: [], total, rx: marks, store: true });
      const dress = await dressing(db, rows,
        { isArtist, artist: cfg.artist, register: await register(), viewer, cfg });
      return respond(request, { messages: rows.map((r) => render(r, dress)), total, rx: marks, store: true });
    }

    /* ---- who am I, and what waited for me ----
     *
     * The nav asks this on every page of both sites, so it answers without a
     * page of the log in it: a bar that put a name in a corner should not cost
     * fifty messages and their marks to draw. Everything else about `me` is
     * worked out exactly as the room works it out, because it is the same
     * answer to the same question. */
    if (url.searchParams.get('me') != null) {
      const days = Number(cfg.session_days || 7);
      if (!/^0x[0-9a-f]{40}$/.test(viewer)) return respond(request, { me: null, session_days: days, store: true });
      return respond(request, { me: await standing(db, origin, viewer, cfg, await register(), isArtist), session_days: days, store: true });
    }

    /* ---- what is under a message now ----
       Asked for by number, the way the cards are, and answered without the
       messages themselves: a mark arriving is no reason to redraw a room with
       somebody's half-written sentence in it. */
    if (rx != null) {
      const ns = String(rx).split(',').map(Number).filter((n) => Number.isInteger(n) && n >= 0);
      const rows = await db.many(ns.slice(0, MOST_ROWS));
      const held = await db.marks(rows.filter((r) => !r.deleted).map((r) => r.n));
      const out = {};
      for (const row of rows) out[row.n] = row.deleted ? [] : marksOf(held[row.n], viewer, cfg);
      return respond(request, { reactions: out, rx: await db.marksVersion().catch(() => 0), store: true });
    }

    /* ---- what the links turn out to be ----
     *
     * Asked for by message number, after a page has been drawn, and answered
     * from the URLs those rows actually carry. That is the whole of the SSRF
     * story: the room never fetches a URL somebody hands it, only URLs already
     * in the log, which took TAO and a signature to put there. Everything else
     * ... the scheme, the hostname, every redirect ... is checked again in
     * api/_lib/cards.js before a single request leaves.
     *
     * A second request rather than part of the page, because a preview is worth
     * waiting for and a message is not. The room draws, and the cards arrive
     * under it a moment later.
     */
    if (cards != null) {
      const ns = String(cards).split(',').map(Number).filter((n) => Number.isInteger(n) && n >= 0);
      const rows = await db.many(ns.slice(0, MOST_ROWS));
      const urls = [];
      for (const row of rows) {
        if (!row || row.deleted) continue;
        for (const u of linksIn(row.text)) if (!urls.includes(u)) urls.push(u);
      }
      const want = urls.slice(0, MOST_CARDS);
      const ours = want.filter((u) => familyKind(u));
      const theirs = want.filter((u) => !familyKind(u));
      const store = cardStore(pipe);
      const held = theirs.length ? await store.many(theirs).catch(() => ({})) : {};
      const missing = theirs.filter((u) => !held[u]).slice(0, MOST_FETCHES);
      const mine = ours.length
        ? await register().then((r) => Promise.all(ours.map(async (u) =>
          [u, await ourCard(u, { origin, at, register: r }).catch(() => null)])))
        : [];
      /* Fetched once and kept, so the log never goes back to a site it has
         already read ... including the failures, which are kept for a day so a
         page that is down does not cost every reader a timeout. */
      const got = await Promise.all(missing.map(async (u) => {
        const c = await fetchCard(u).catch(() => null);
        await store.keep(u, c).catch(() => { /* the card stands without being kept */ });
        return [u, c];
      }));
      const out = {};
      for (const u of theirs) if (held[u]) out[u] = held[u].fail ? false : held[u];
      for (const [u, c] of got) out[u] = c || false;
      for (const [u, c] of mine) out[u] = c || false;
      return respond(request, { cards: out, store: true });
    }

    const base = { isArtist, artist: cfg.artist, register: await register(), viewer, cfg };
    const page = await db.page({ before: before == null ? null : Number(before), limit: Number(cfg.page) || 50 });
    const dress = await dressing(db, page.rows, base);
    const me = /^0x[0-9a-f]{40}$/.test(viewer)
      ? await standing(db, origin, viewer, cfg, dress.register, isArtist)
      : null;
    return respond(request, {
      messages: page.rows.map((r) => render(r, dress)),
      start: page.start, end: page.end, total: page.total, more: page.more,
      me, max_chars: cfg.max_chars, max_tags: Number(cfg.max_tags || 5),
      session_days: Number(cfg.session_days || 7),
      emoji: reactionSet(cfg), rx: await db.marksVersion().catch(() => 0),
      max_image_kb: Number(cfg.max_image_kb || 1200), store: true,
    });
  } catch (e) {
    return respond(request, { error: 'Studio is not reachable' }, 503);
  }
}

/* ---------------------------------------------------------------- speaking */

export async function POST(request) {
  const origin = useRequestOrigin(request) || siteOrigin();
  if (!storeConfigured()) return respond(request, { error: 'Studio is not open yet' }, 503);

  let body;
  try { body = await request.json(); } catch { return respond(request, { error: 'bad request' }, 400); }

  const action = String(body.action || 'say');
  const signature = String(body.signature || '');
  const issued = String(body.issued || '');
  /* The cookie first, and the body only where there is no cookie.
     The browser stops handling the token at all once it is HttpOnly; what is
     left of the body path is the sign-per-message rig, which is still a
     supported way to speak, and the acceptance cases, which have no cookie jar
     and drive the route directly. */
  const token = cookieFrom(request, TOKEN_COOKIE) || String(body.token || '');

  if (!ACTIONS.includes(action)) return respond(request, { error: 'no such action' }, 400);

  let cfg;
  try { cfg = await config(origin); } catch (e) { return respond(request, { error: 'Studio is not reachable' }, 503); }
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
    if (!address) return respond(request, { error: 'that sign-in has run out. Sign in again.', expired: true }, 401);
    bySession = true;
  } else {
    address = lower(body.address);
    if (!/^0x[0-9a-f]{40}$/.test(address)) return respond(request, { error: 'that is not a wallet address' }, 400);
    if (!signature.startsWith('0x')) return respond(request, { error: 'a signature is required' }, 400);
    const age = Date.now() - Date.parse(issued);
    if (!Number.isFinite(age) || age < -60000 || age > 15 * 60 * 1000) {
      return respond(request, { error: 'that signature has gone stale, please sign again' }, 400);
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
    if (!until) return respond(request, { error: 'bad request' }, 400);
    /* Where this was signed, named in the sentence the wallet showed.
       It is not what lets the session cross the two hosts ... one API mints it
       and one API validates it, and it would cross without this. What it buys
       is that a signature collected on some other site cannot be spent here. */
    const domain = String(body.domain || '');
    if (!domainOk(domain, request)) {
      return respond(request, { error: 'that signature was not signed for this site' }, 400);
    }
    if (!(await verify({ action: 'sign in', until, domain }))) {
      return respond(request, { error: 'that signature does not match the wallet' }, 401);
    }
    if (await db.isMuted(address)) {
      return respond(request, { error: 'This wallet is muted in Studio. You can still read.' }, 403);
    }
    const fresh = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
    const seconds = days * 86400;
    await db.openSession(fresh, address, seconds);
    /* Scoped to the parent domain, so signing in on the catalogue signs you in
       on the register. Same registrable domain, so Lax is enough and nothing
       here is a third-party cookie. */
    return respond(request, { ok: true, token: fresh, until, address }, 200,
      openCookies({ token: fresh, address, until, host: hostOf(request), seconds }));
  }
  if (action === 'sign out') {
    await db.closeSession(token);
    return respond(request, { ok: true, signed_out: true }, 200, clearCookies(hostOf(request)));
  }

  /* ---- I have read the room ----
     Sent by the page once it has drawn the mention count, so the count is
     cleared by the visit that showed it rather than by the next one. It needs a
     sign-in and nothing else: a signature per glance would be absurd, and the
     worst a stolen token can do here is mark somebody's own mentions read. */
  if (action === 'seen') {
    if (!bySession) return respond(request, { error: 'sign in first' }, 401);
    await db.markSeen(address, await db.length());
    return respond(request, { ok: true, seen: true });
  }

  /* ---- a mark under something somebody said ----
   *
   * The same door as speaking: TAO to leave one, nothing at all to read them.
   * A reaction is a smaller thing than a sentence and it is still a thing you
   * did in a room kept forever, so it is signed like one ... and the mark and
   * the message it is under are both in the sentence, so a page cannot hang a
   * fire under a message you meant to put a cherry on.
   *
   * Pressing it again takes it back. One of each per wallet per message is a
   * fact about the key it is stored under rather than a rule anything has to
   * enforce.
   */
  if (action === 'react') {
    const n = Number(body.target);
    if (!Number.isInteger(n) || n < 0) return respond(request, { error: 'react to which message?' }, 400);
    const mark = checkReaction(body.emoji, cfg);
    if (mark.error) return respond(request, { error: mark.error }, 400);

    const row = await db.get(n);
    if (!row) return respond(request, { error: 'no such message' }, 404);
    /* A deleted message takes its marks down with it, so it cannot take new
       ones. The ones already there stay in the data with everything else. */
    if (row.deleted) return respond(request, { error: 'that message was taken down' }, 400);

    if (await db.isMuted(address)) {
      return respond(request, { error: 'This wallet is muted in Studio. You can still read.' }, 403);
    }
    const reg = await loadRegister(at, origin, pipe).catch(() => null);
    const me = await whois(origin, address, reg);
    const may = taoGate({ artist: cfg.artist, address, tao: me.tao, min: cfg.min_tao || 1, why: SHUT });
    if (!may.ok) return respond(request, { error: may.why, tao: may.tao }, 403);

    if (!(await verify({ action: 'react', emoji: mark.emoji, target: String(body.target) }))) {
      return respond(request, { error: 'that signature does not match the wallet' }, 401);
    }
    const spent = await db.spendMarks(address);
    if (spent.error) return respond(request, { error: spent.error }, 429);

    const put = await db.react(n, address, mark.emoji);
    const held = await db.marks([n]);
    return respond(request, { ok: true, n, emoji: mark.emoji, on: put.on,
      reactions: marksOf(held[n], address, cfg), rx: await db.marksVersion().catch(() => 0) });
  }

  /* ---- the whole moderation toolset ---- */
  if (action !== 'say') {
    if (!isArtist) return respond(request, { error: 'Studio is moderated by the artist' }, 403);

    if (action === 'mute' || action === 'unmute') {
      const target = lower(body.target);
      if (!/^0x[0-9a-f]{40}$/.test(target)) return respond(request, { error: 'mute a wallet address' }, 400);
      if (!(await verify({ action, target }))) return respond(request, { error: 'that signature does not match the wallet' }, 401);
      if (action === 'mute') await db.mute(target); else await db.unmute(target);
      return respond(request, { ok: true, muted: await db.muted() });
    }

    /* One field, `target`, for every moderation action: the wallet for a mute,
       the message number for a deletion. It is sent and signed identically, so
       there is no mapping between what the browser puts in the body and what it
       puts in the sentence, and therefore nothing for the two to disagree
       about. Signatures that fail for a field name are unbearable to debug. */
    const n = Number(body.target);
    if (!Number.isInteger(n) || n < 0) return respond(request, { error: 'which message?' }, 400);
    const row = await db.get(n);
    if (!row) return respond(request, { error: 'no such message' }, 404);
    if (!(await verify({ action, target: String(body.target) }))) {
      return respond(request, { error: 'that signature does not match the wallet' }, 401);
    }
    row.deleted = action === 'delete';
    await db.save(row);
    const register = await loadRegister(at, origin, pipe).catch(() => null);
    /* Dressed like any other row, so putting a message back puts its marks and
       its reply line back with it rather than leaving them off until a reload. */
    const dress = await dressing(db, [row],
      { isArtist: true, artist: cfg.artist, register, viewer: address, cfg });
    return respond(request, { ok: true, n, deleted: row.deleted, message: render(row, dress) });
  }

  /* ---- saying something ---- */
  const text = checkMessage(body.text, cfg);
  if (text.error) return respond(request, { error: text.error }, 400);

  /* What this is answering, if anything.
   *
   * A message number, checked here and stored as a number: not a name, not an
   * address, not a copy of what was said. That is what lets a reply survive
   * everything downstream of it ... the author renaming, the register learning
   * an ENS it did not have, the parent being taken down and put back. The
   * number was handed out once and is never reused, which is the same property
   * the whole log is built on.
   *
   * It goes in the sentence, so a page cannot quietly hang somebody's words
   * under a message they never read. */
  let reply = null;
  let answered = null;
  if (body.reply != null && body.reply !== '') {
    reply = Number(body.reply);
    if (!Number.isInteger(reply) || reply < 0) return respond(request, { error: 'reply to which message?' }, 400);
    const parent = await db.get(reply);
    if (!parent) return respond(request, { error: 'no such message' }, 404);
    if (parent.deleted) return respond(request, { error: 'that message was taken down' }, 400);
    answered = lower(parent.address) || null;
  }

  if (await db.isMuted(address)) {
    return respond(request, { error: 'This wallet is muted in Studio. You can still read.' }, 403);
  }

  /* The picture, checked before the signature is, because the signature covers
     it: a wallet signing words with a photograph attached is signing both, and
     the fingerprint the sentence carries has to be of bytes this side has
     actually looked at. Nothing is spent and nothing is stored until it has
     passed everything a message has to pass. */
  const shot = checkImage(body.image, cfg);
  if (shot.error) return respond(request, { error: shot.error }, 400);
  if (!shot.none && !r2Configured()) {
    return respond(request, { error: 'Studio cannot take pictures just now' }, 503);
  }

  const register = await loadRegister(at, origin, pipe).catch(() => null);
  const who = await whois(origin, address, register);
  const gate = taoGate({ artist: cfg.artist, address, tao: who.tao, min: cfg.min_tao || 1, why: SHUT });
  if (!gate.ok) return respond(request, { error: gate.why, tao: gate.tao }, 403);

  /* Who was tagged, worked out here rather than taken from the body.
   *
   * The browser sends the sentence and nothing else. If it sent the wallets as
   * well, a page could quietly tag somebody the words never named ... which is
   * how a tag stops being a thing you said and becomes a thing done to you. So
   * the text is read against the register on this side, and the wallets that
   * come out of that reading are the tags.
   *
   * What is stored is the wallet and where in the sentence it was written. The
   * name is never stored, because the name is the part that changes. */
  const found = register ? parseTags(text.text, tagIndex(register)) : [];
  const mentions = found.map((m) => ({ start: m.start, len: m.len, address: m.address }));
  const distinct = [...new Set(mentions.map((m) => m.address))];
  const maxTags = Number(cfg.max_tags || 5);
  if (distinct.length > maxTags) {
    return respond(request, { error: `${distinct.length} names in one message, and Studio's limit is ${maxTags}.` }, 400);
  }

  /* The picture is in the sentence as its own fingerprint. A wallet signing
     words with a photograph attached is signing both, and a page that could
     swap the photograph after the fact would be putting a picture into a
     permanent log under somebody's name without asking. */
  if (!(await verify({
    action: 'say', text: text.text,
    reply: reply == null ? null : String(reply),
    image: shot.none ? null : imageFingerprint(shot.bytes),
  }))) {
    return respond(request, { error: 'that signature does not match the wallet' }, 401);
  }

  /* Spent only once the message is known to be good, so a refusal for its
     words does not also cost somebody their fifteen seconds. */
  const spend = await db.spend(address);
  if (spend.error) return respond(request, { error: spend.error }, 429);
  const spentTags = await db.spendTags(address, distinct.length, cfg);
  if (spentTags.error) return respond(request, { error: spentTags.error }, 429);

  let image = null;
  if (!shot.none) {
    const key = imageKey(shot.ext);
    try {
      await putObject(key, shot.bytes, shot.type);
    } catch (e) {
      return respond(request, { error: 'that picture would not go up. Try again in a moment.' }, 502);
    }
    image = { key, type: shot.type, w: shot.w, h: shot.h, bytes: shot.bytes.length };
  }

  const row = await db.say({
    address, role: gate.role,
    name: gate.role === 'artist' ? ARTIST_NAME : who.name,
    tao: gate.role === 'artist' ? 0 : who.tao,
    text: text.text, mentions, reply, image, at: new Date().toISOString(), deleted: false,
  });
  /* Tagging yourself is a way of writing, not a way of being told ... and
     answering somebody is telling them, whether or not their name is in the
     sentence. A reply that did not reach the person it was written to would be
     a reply nobody ever saw, and the cherry is the only notifier this room
     has. Replying to yourself, like naming yourself, is neither. */
  const told = new Set(distinct);
  if (answered) told.add(answered);
  await db.mention([...told].filter((a) => a !== address), row.n);
  const dress = await dressing(db, [row],
    { isArtist, artist: cfg.artist, register, viewer: address, cfg });
  return respond(request, { ok: true, message: render(row, dress) });
}
