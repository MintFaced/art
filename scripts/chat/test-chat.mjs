#!/usr/bin/env node
/* The acceptance cases from docs/TAO-CHAT.md, item 11.
 *
 * The route is the real one. Real keys sign the real sentence, api/chat.js
 * verifies it with viem and reads TAO out of a register fixture, and the store
 * code writes through a stand-in Redis with a clock the test can wind forward
 * ... which is the only way to check a fifteen second floor without waiting
 * fifteen seconds.
 *
 *   node scripts/chat/test-chat.mjs
 */
import fs from 'node:fs';
import http from 'node:http';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';

/* ---------- a small Redis, with a clock ---------- */
let NOW = Date.now();
const advance = (ms) => { NOW += ms; };
const str = new Map();
const list = new Map();
const sets = new Map();
const ttl = new Map();
const alive = (k) => !ttl.has(k) || ttl.get(k) > NOW;
const reap = (k) => { if (!alive(k)) { str.delete(k); ttl.delete(k); } };
const L = (k) => { if (!list.has(k)) list.set(k, []); return list.get(k); };
const S = (k) => { if (!sets.has(k)) sets.set(k, new Set()); return sets.get(k); };
const hashes = new Map();
const H = (k) => { if (!hashes.has(k)) hashes.set(k, new Map()); return hashes.get(k); };

const redis = ([cmd, ...a]) => {
  const c = String(cmd).toUpperCase();
  switch (c) {
    case 'SET': {
      reap(a[0]);
      const nx = a.includes('NX');
      if (nx && str.has(a[0])) return null;
      str.set(a[0], a[1]);
      const i = a.indexOf('EX');
      if (i > -1) ttl.set(a[0], NOW + Number(a[i + 1]) * 1000); else ttl.delete(a[0]);
      return 'OK';
    }
    case 'GET': reap(a[0]); return str.has(a[0]) ? str.get(a[0]) : null;
    case 'MGET': return a.map((k) => { reap(k); return str.has(k) ? str.get(k) : null; });
    case 'DEL': { reap(a[0]); const had = str.delete(a[0]); ttl.delete(a[0]); return had ? 1 : 0; }
    case 'INCR': { reap(a[0]); const v = (Number(str.get(a[0])) || 0) + 1; str.set(a[0], String(v)); return v; }
    case 'EXPIRE': ttl.set(a[0], NOW + Number(a[1]) * 1000); return 1;
    case 'RPUSH': L(a[0]).push(...a.slice(1)); return L(a[0]).length;
    case 'LLEN': return L(a[0]).length;
    case 'LRANGE': {
      const rows = L(a[0]);
      let [s0, s1] = [Number(a[1]), Number(a[2])];
      if (s0 < 0) s0 = rows.length + s0;
      if (s1 < 0) s1 = rows.length + s1;
      return rows.slice(s0, s1 + 1);
    }
    case 'INCRBY': { reap(a[0]); const v = (Number(str.get(a[0])) || 0) + Number(a[1]); str.set(a[0], String(v)); return v; }
    case 'LTRIM': {
      const rows = L(a[0]);
      let [s0, s1] = [Number(a[1]), Number(a[2])];
      if (s0 < 0) s0 = Math.max(0, rows.length + s0);
      if (s1 < 0) s1 = rows.length + s1;
      list.set(a[0], rows.slice(s0, s1 + 1));
      return 'OK';
    }
    case 'HSET': { const h = H(a[0]); for (let i = 1; i < a.length; i += 2) h.set(a[i], a[i + 1]); return 1; }
    case 'HSETNX': { const h = H(a[0]); if (h.has(a[1])) return 0; h.set(a[1], a[2]); return 1; }
    case 'HGET': { const h = H(a[0]); return h.has(a[1]) ? h.get(a[1]) : null; }
    case 'HDEL': { const h = H(a[0]); return h.delete(a[1]) ? 1 : 0; }
    case 'HGETALL': { const out = []; for (const [k, v] of H(a[0])) out.push(k, v); return out; }
    case 'SADD': S(a[0]).add(a[1]); return 1;
    case 'SREM': return S(a[0]).delete(a[1]) ? 1 : 0;
    case 'SISMEMBER': return S(a[0]).has(a[1]) ? 1 : 0;
    case 'SMEMBERS': return [...S(a[0])];
    default: throw new Error(`the fake store has no ${c}`);
  }
};

/* ---------- the cast ---------- */
const artist = privateKeyToAccount(generatePrivateKey());
const visco = privateKeyToAccount(generatePrivateKey());
const oneCopy = privateKeyToAccount(generatePrivateKey());
const nobody = privateKeyToAccount(generatePrivateKey());
const loud = privateKeyToAccount(generatePrivateKey());
const A = (x) => x.address.toLowerCase();

const chatCfg = {
  version: 1, min_tao: 1, max_chars: 500,
  seconds_between: 15, burst: 10, burst_window_seconds: 600, page: 50, session_days: 30,
  reactions: ['\u{1F352}', '\u2764\ufe0f', '\u{1F44D}', '\u{1F525}', '\u{1F602}', '\u2726'],
  reaction_burst: 60,
};
const artistFixture = { wallets: { [A(artist)]: 'mintface.eth' } };
const taoFixture = {
  wallets: {
    [A(visco)]: { tao: 1493717 },
    [A(oneCopy)]: { tao: 4 },
    [A(loud)]: { tao: 90000 },
    [A(artist)]: { tao: 0 },
  },
};
const register = {
  collectors: [
    { address: A(visco), ens: 'visco.eth', display_name: null },
    { address: A(loud), ens: 'enthusiast.eth', display_name: null },
  ],
};
/* The room reads data/collectors-register.json rather than the index: the
   index holds only the eight hundred collectors with pages, and a wallet
   holding one edition copy is welcome here by design. */
const registerFile = {
  fields: ['address', 'name', 'ens', 'slug', 'private', 'works', 'unique', 'tao', 'rate', 'last', 'rank'],
  rows: [
    [A(visco), 'visco.eth', 'visco.eth', 'visco.eth', 0, 83, 11, 1493717, 1162, '2026-08-21', 1],
    [A(loud), 'enthusiast.eth', 'enthusiast.eth', 'enthusiast.eth', 0, 12, 3, 90000, 200, '2026-08-01', 2],
    [A(oneCopy), '', '', '', 0, 1, 0, 4, 4.2, '2026-08-20', 3],
    [A(nobody), '', '', '', 0, 0, 0, 0, 0, null, 4],
  ],
};

/* The catalogue, for the family cards. A work URL pasted into the room is
   answered off this rather than by fetching our own front end. */
const siteIndexFixture = {
  _meta: { version: '1.0.0' },
  work_index: { 'geodetic-1': 'geodetic-moments' },
  collections: [{ slug: 'geodetic-moments', title: 'Geodetic Moments', year: '2024', medium: 'Photography' }],
  config: {},
};
const collectionFixture = {
  slug: 'geodetic-moments', title: 'Geodetic Moments', year: '2024',
  works: [{
    id: 'geodetic-1', title: 'Road to Waipukurau', status: 'available',
    collection: 'geodetic-moments', assets: { display: 'geodetic-moments/1-display.webp' },
  }],
};

/* ---------- one origin ---------- */
const body = (req) => new Promise((res) => { let b = ''; req.on('data', (d) => { b += d; }).on('end', () => res(b)); });
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (u.pathname === '/pipeline' && req.method === 'POST') {
    const cmds = JSON.parse(await body(req));
    try { return send(200, cmds.map((x) => ({ result: redis(x) }))); }
    catch (e) { return send(200, [{ error: String(e.message) }]); }
  }
  if (u.pathname === '/data/source/chat.json') return send(200, chatCfg);
  if (u.pathname === '/data/source/artist.json') return send(200, artistFixture);
  if (u.pathname === '/data/tao.json') return send(200, taoFixture);
  if (u.pathname === '/data/collectors.json') return send(200, register);
  if (u.pathname === '/data/collectors-register.json') return send(200, registerFile);
  if (u.pathname === '/data/index.json') return send(200, siteIndexFixture);
  if (u.pathname === '/data/c/geodetic-moments.json') return send(200, collectionFixture);
  res.writeHead(404); res.end('no');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
process.env.KV_REST_API_URL = ORIGIN;
process.env.KV_REST_API_TOKEN = 'test';

const { GET, POST } = await import('../../api/chat.js');
const { chatMessage, chatStore, wearTao, sessionUntil, render } = await import('../../api/_lib/chat.js');
const { pipe } = await import('../../api/_lib/kv.js');
const { openCookies, clearCookies, corsFor, domainOk, TOKEN_COOKIE, WHO_COOKIE } = await import('../../api/_lib/session.js');

let failed = 0, ran = 0;
const ok = (cond, label, detail) => {
  ran++;
  if (!cond) failed++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n          ${detail}` : ''}`);
};
const head = (t) => console.log(`\n${t}\n${'='.repeat(74)}`);

const get = async (qs = '') => {
  const r = await GET(new Request(`${ORIGIN}/api/chat${qs ? `?${qs}` : ''}`));
  return { status: r.status, body: await r.json() };
};
const post = async (account, payload) => {
  const issued = new Date().toISOString();
  const address = A(account);
  const signature = await account.signMessage({ message: chatMessage({ ...payload, address, issued }) });
  const r = await POST(new Request(`${ORIGIN}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...payload, address, issued, signature }),
  }));
  return { status: r.status, body: await r.json() };
};
const say = async (account, text) => { advance(20000); return post(account, { action: 'say', text }); };
const answer = async (account, text, reply) => { advance(20000); return post(account, { action: 'say', text, reply: String(reply) }); };
const react = async (account, target, emoji) => post(account, { action: 'react', target: String(target), emoji });
const CHERRY = '\u{1F352}';
const HEART = '\u2764\ufe0f';

/* The host this test's route is answering on. A sign-in names the site it was
   asked on, and the check accepts the two hosts of the family plus whatever
   host is answering ... which is what lets a preview deploy sign into itself,
   and what lets this run on the loopback. */
const HERE = new URL(ORIGIN).hostname;

/** The one signature, the way the page does it. */
const signIn = async (account, domain = HERE) => {
  const issued = new Date().toISOString();
  const address = A(account);
  const until = sessionUntil(issued, chatCfg.session_days);
  const signature = await account.signMessage({
    message: chatMessage({ action: 'sign in', address, issued, until, domain }),
  });
  const r = await POST(new Request(`${ORIGIN}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'sign in', address, issued, until, domain, signature }),
  }));
  return { status: r.status, body: await r.json(), cookies: r.headers.getSetCookie() };
};
const withToken = async (token, payload) => {
  const r = await POST(new Request(`${ORIGIN}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...payload, token }),
  }));
  return { status: r.status, body: await r.json() };
};

/* ================= speaking ================= */
head('Who may speak');
{
  const empty = await get();
  ok(empty.status === 200 && empty.body.store === true && empty.body.messages.length === 0,
    'an empty room reads as an empty room, with no wallet at all', `${empty.status}`);

  const a = await say(visco, 'The Geodetic works were the first ones I understood.');
  ok(a.status === 200 && a.body.ok, 'a wallet with TAO speaks', a.body.error);
  ok(a.body.message.n === 0 && a.body.message.name === 'visco.eth' && a.body.message.worn === '1.49M',
    'and the room wears their name and their TAO lightly',
    a.body.message ? `${a.body.message.name} · ${a.body.message.worn}` : '');

  const b = await say(oneCopy, 'One copy, one day, and here I am.');
  ok(b.status === 200 && b.body.ok, 'four TAO is a voice ... the threshold is where the brief put it', b.body.error);
  ok(b.body.message.worn === '4', 'a small holding is shown as it is', b.body.message && b.body.message.worn);

  const z = await say(nobody, 'Hello?');
  ok(z.status === 403 && /holding TAO/.test(z.body.error || ''), 'a wallet with no TAO is refused, and told why',
    `${z.status} ${z.body.error}`);

  const long = await say(visco, 'x'.repeat(501));
  ok(long.status === 400 && /500/.test(long.body.error || ''), 'five hundred characters is the limit', long.body.error);
  const empty2 = await say(visco, '   \n  ');
  ok(empty2.status === 400, 'and a message of nothing is nothing', empty2.body.error);
}

/* ================= the artist ================= */
head('The artist, who holds no TAO and never will');
{
  /* His wallets are excluded from accrual by design ... docs/TAO.md item 4 ...
     so a gate written as tao > 0 does not keep him one edition short of the
     door. It shuts it for good. */
  ok(taoFixture.wallets[A(artist)].tao === 0, 'the register says nought, correctly', '0 TAO');

  const view = await get(`viewer=${A(artist)}`);
  ok(view.body.me.can_speak === true, 'and he can speak anyway', JSON.stringify(view.body.me));
  ok(view.body.me.role === 'artist' && view.body.me.artist === true, 'named as the artist');
  ok(view.body.me.name === 'MintFace', 'called MintFace, not a null and not a hex string', view.body.me.name);
  ok(view.body.me.tao === null, 'and carrying no figure at all, because nought would be a lie');

  const said = await say(artist, 'The light in this one was an accident I kept.');
  ok(said.status === 200 && said.body.ok, 'he speaks', said.body.error);
  const m = said.body.message;
  ok(m.role === 'artist' && m.name === 'MintFace' && m.worn === null && m.tao === null,
    'and the message wears a label rather than a number',
    m ? `${m.name} · ${m.worn === null ? 'no figure' : m.worn}` : '');

  const anyone = await get();
  const his = anyone.body.messages.find((x) => x.address === A(artist));
  ok(his && his.role === 'artist' && his.worn === null,
    'which is how everyone else reads it too');

  /* A message written before any of this was known should still read as his,
     because the answer comes from the config as well as from the row. */
  const dbx = chatStore(pipe, chatCfg);
  await dbx.say({ address: A(artist), name: null, tao: 0, text: 'An older line.', at: new Date(NOW).toISOString(), deleted: false });
  const back = await get();
  const old = back.body.messages.find((x) => x.text === 'An older line.');
  ok(old && old.role === 'artist' && old.name === 'MintFace',
    'including one written before the row carried a role');
}

head('The moderation gate is the artist, not a threshold');
{
  const before = await get();
  const target = before.body.messages.find((x) => x.address === A(visco));
  const rich = await post(visco, { action: 'delete', target: String(target.n) });
  ok(rich.status === 403, '1.49M TAO does not buy the delete button', `${rich.status} ${rich.body.error}`);
  const his = await post(artist, { action: 'delete', target: String(target.n) });
  ok(his.status === 200, 'nought TAO and the artist wallet does', his.body.error);
  await post(artist, { action: 'restore', target: String(target.n) });
  const muteRich = await post(visco, { action: 'mute', target: A(loud) });
  ok(muteRich.status === 403, 'and the same for muting', `${muteRich.status} ${muteRich.body.error}`);
}

head('The signature is the whole authorisation');
{
  advance(20000);
  const issued = new Date().toISOString();
  const address = A(visco);
  const signature = await visco.signMessage({ message: chatMessage({ action: 'say', text: 'What I signed.', address, issued }) });
  const r = await POST(new Request(`${ORIGIN}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'say', text: 'What I sent.', address, issued, signature }),
  }));
  ok(r.status === 401, 'changing the words after signing is refused', String(r.status));

  const stale = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  const sig = await visco.signMessage({ message: chatMessage({ action: 'say', text: 'Old.', address, issued: stale }) });
  const r2 = await POST(new Request(`${ORIGIN}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'say', text: 'Old.', address, issued: stale, signature: sig }),
  }));
  ok(r2.status === 400, 'a signature twenty minutes old is refused', String(r2.status));
}

/* ================= reading, logged out ================= */
head('Reading takes nothing');
{
  const open = await get();
  // however many have been said by now ... a count pinned to a number here just
  // breaks whenever a case is added above it
  ok(open.body.messages.length > 0 && open.body.messages.length === open.body.total,
    'the whole room is public with no wallet and no sign-in',
    `${open.body.messages.length} of ${open.body.total} messages`);
  ok(open.body.me === null, 'and a reader is asked for nothing about themselves');
  ok(open.body.messages.every((m) => m.text && m.address && m.at),
    'every message carries its words, its wallet and its date');
}

/* ================= how often ================= */
head('How often anyone may speak');
{
  advance(20000);
  const first = await post(loud, { action: 'say', text: 'One.' });
  ok(first.status === 200, 'a message lands', first.body.error);
  const second = await post(loud, { action: 'say', text: 'Two, immediately.' });
  ok(second.status === 429 && /15 seconds/.test(second.body.error || ''),
    'a second one straight after is asked to wait', second.body.error);
  advance(16000);
  const third = await post(loud, { action: 'say', text: 'Two, a moment later.' });
  ok(third.status === 200, 'and lands sixteen seconds later', third.body.error);

  let stopped = null;
  for (let i = 0; i < 12 && !stopped; i++) {
    advance(20000);
    const r = await post(loud, { action: 'say', text: `Enthusiasm ${i}.` });
    if (r.status === 429) stopped = { i, error: r.body.error };
  }
  ok(stopped && /10 messages/.test(stopped.error || ''),
    'ten in ten minutes is where patient flooding stops', stopped ? stopped.error : 'never stopped');
  advance(11 * 60 * 1000);
  const later = await post(loud, { action: 'say', text: 'Later.' });
  ok(later.status === 200, 'and the window passes', later.body.error);
}

/* ================= moderation ================= */
head('The whole toolset');
{
  const before = await get();
  const target = before.body.messages.find((m) => m.address === A(oneCopy));

  const notArtist = await post(visco, { action: 'delete', target: String(target.n) });
  ok(notArtist.status === 403, 'only the artist moderates', `${notArtist.status} ${notArtist.body.error}`);

  const gone = await post(artist, { action: 'delete', target: String(target.n) });
  ok(gone.status === 200 && gone.body.deleted === true, 'the artist deletes a message', gone.body.error);

  const anon = await get();
  const row = anon.body.messages.find((m) => m.n === target.n);
  ok(row && row.deleted === true && row.text === null,
    'it is gone from the room, and the room does not pretend it was never said');
  const asArtist = await get(`viewer=${A(artist)}`);
  const seen = asArtist.body.messages.find((m) => m.n === target.n);
  ok(seen && seen.text, 'the artist can still read it, and put it back', seen && seen.deleted ? 'marked deleted' : '');
  await post(artist, { action: 'restore', target: String(target.n) });
  ok((await get()).body.messages.find((m) => m.n === target.n).text != null, 'restored');

  const muted = await post(artist, { action: 'mute', target: A(oneCopy) });
  ok(muted.status === 200 && muted.body.muted.includes(A(oneCopy)), 'the artist mutes a wallet', muted.body.error);
  advance(20000);
  const tried = await post(oneCopy, { action: 'say', text: 'Anyone?' });
  ok(tried.status === 403 && /muted/.test(tried.body.error || ''),
    'a muted wallet cannot speak, and is told plainly rather than left guessing', tried.body.error);
  const reading = await get(`viewer=${A(oneCopy)}`);
  ok(reading.body.messages.length > 0 && reading.body.me.muted === true && reading.body.me.can_speak === false,
    'and can still read the whole room');
  const noBadge = (await get()).body.messages.some((m) => JSON.stringify(m).includes('mute'));
  ok(!noBadge, 'with nothing anywhere in the room saying so');

  await post(artist, { action: 'unmute', target: A(oneCopy) });
  advance(20000);
  const back = await post(oneCopy, { action: 'say', text: 'Back.' });
  ok(back.status === 200, 'unmuting lets them back in', back.body.error);
}

/* ================= history ================= */
head('History, past a hundred');
{
  const db = chatStore(pipe, chatCfg);
  const start = await db.length();
  for (let i = 0; i < 140; i++) {
    await db.say({ address: A(visco), name: 'visco.eth', tao: 1493717, text: `Seeded ${i}.`, at: new Date(NOW + i).toISOString(), deleted: false });
  }
  const total = await db.length();
  ok(total === start + 140, `the log holds all ${total} of them`, `${start} before, ${total} after`);

  const first = await get();
  ok(first.body.messages.length === 50 && first.body.end === total && first.body.more === true,
    'the room opens on the last fifty', `${first.body.messages.length} of ${first.body.total}`);

  const seen = new Set();
  let cursor = first.body.start;
  first.body.messages.forEach((m) => seen.add(m.n));
  let pages = 1;
  while (cursor > 0 && pages < 20) {
    const p = await get(`before=${cursor}`);
    p.body.messages.forEach((m) => seen.add(m.n));
    cursor = p.body.start;
    pages++;
  }
  ok(seen.size === total, `paging backwards reaches every message`, `${seen.size} of ${total} over ${pages} pages`);
  const run = [...seen].sort((x, y) => x - y);
  ok(run.length === total && run.every((n, i) => n === i),
    'with no gaps and nothing counted twice', `${run[0]} to ${run[run.length - 1]}`);

  const poll = await get(`since=${total}`);
  ok(poll.body.messages.length === 0 && poll.body.total === total,
    'a poll of a quiet room comes back empty');
  advance(20000);
  await post(visco, { action: 'say', text: 'Something new.' });
  const poll2 = await get(`since=${total}`);
  ok(poll2.body.messages.length === 1 && poll2.body.messages[0].text === 'Something new.',
    'and picks up exactly what was said after it');
}

/* ================= one signature, then a week ================= */
head('One signature, then thirty days of it');
{
  const opened = await signIn(visco);
  ok(opened.status === 200 && opened.body.token && opened.body.until,
    'one signature opens the room', opened.body.error || `until ${opened.body.until}`);
  const token = opened.body.token;
  ok(token.length >= 32, 'the token is long enough not to be guessed', `${token.length} characters`);
  const lasts = (Date.parse(opened.body.until) - Date.now()) / 86400000;
  ok(Math.abs(lasts - chatCfg.session_days) < 0.01,
    'for exactly as long as the config says, and not a day the config does not say',
    `${lasts.toFixed(2)} days, config says ${chatCfg.session_days}`);

  advance(20000);
  const one = await withToken(token, { action: 'say', text: 'No wallet prompt for this one.' });
  ok(one.status === 200 && one.body.ok, 'and then messages need no signature at all', one.body.error);
  advance(20000);
  const two = await withToken(token, { action: 'say', text: 'Nor this one.' });
  ok(two.status === 200, 'nor the next', two.body.error);
  ok(two.body.message.address === A(visco), 'written under the wallet that signed in', two.body.message.address);

  /* The address comes from the token, never from the request. A field saying
     who you are, beside a token that already says so, is a lock with the door
     left open next to it. */
  advance(20000);
  const spoof = await withToken(token, { action: 'say', text: 'Signed, allegedly, by someone else.', address: A(loud) });
  ok(spoof.status === 200 && spoof.body.message.address === A(visco),
    'and an address in the body is ignored entirely', spoof.body.message.address);

  const junk = await withToken('0000000000000000000000000000000000000000', { action: 'say', text: 'Hello.' });
  ok(junk.status === 401 && junk.body.expired === true,
    'a token that means nothing is refused, and says to sign in again',
    `${junk.status} ${junk.body.error}`);

  const short = await withToken('abc', { action: 'say', text: 'Hello.' });
  ok(short.status === 401, 'and so is a stub of one');

  /* A session buys a week of talking in one room and nothing else. */
  const asRich = await withToken(token, { action: 'delete', target: '0' });
  ok(asRich.status === 403, 'a collector session does not become a moderator session',
    `${asRich.status} ${asRich.body.error}`);

  const gone = await withToken(token, { action: 'sign out' });
  ok(gone.status === 200 && gone.body.signed_out, 'signing out closes it');
  advance(20000);
  const after = await withToken(token, { action: 'say', text: 'Still here?' });
  ok(after.status === 401 && after.body.expired === true, 'and the token stops working at once',
    `${after.status} ${after.body.error}`);

  // signing per message still works, for a wallet that would rather
  advance(20000);
  const still = await say(visco, 'Signed this one by hand.');
  ok(still.status === 200, 'and signing each message is still a way to speak', still.body.error);
}

head('One name, in every place a person reads it');
{
  const text = chatMessage({ action: 'say', text: 'x', address: A(visco), issued: '2026-08-25T00:00:00.000Z' });
  ok(text.startsWith('MintFace ... Studio'), 'the sentence the wallet shows names Studio', text.split('\n')[0]);
  /* The browser's half of the sentence lives in mintface.js now, because the
     nav signs the sign-in one on every page of both sites and this page signs
     the rest of them. Two copies were bearable; four would not be. */
  const runtime = fs.readFileSync(new URL('../../mintface.js', import.meta.url), 'utf8');
  ok(runtime.includes("'MintFace ... Studio',"), 'and the browser builds the same first line');
  const page = fs.readFileSync(new URL('../../studio.html', import.meta.url), 'utf8');
  ok(!page.includes("'MintFace ... Studio',"), 'from one place, rather than once per page that signs something');
  ok(!/the room/i.test(text), 'with nothing left of the old name in it');
  const refused = await say(nobody, 'Let me in.');
  ok(/Studio is for anyone holding TAO/.test(refused.body.error || ''),
    'and the refusal calls it Studio too', refused.body.error);
}

head('The sentence says the date, not a length');
{
  /* If the closing lines said "for a week" and the config said thirty days,
     the wallet would be showing one thing and doing another. The only place a
     duration appears is the Until line, worked out from the config on both
     sides, so there is nothing to drift. */
  const issued = '2026-08-25T00:00:00.000Z';
  const until = sessionUntil(issued, chatCfg.session_days);
  const text = chatMessage({ action: 'sign in', address: A(visco), issued, until });
  ok(until === '2026-09-24T00:00:00.000Z', 'the date is the config applied to the moment of signing', until);
  ok(text.includes(`Until: ${until}`), 'and it is in the sentence the wallet shows');
  ok(!/\bweek\b|\bdays\b|\bmonth\b/i.test(text),
    'which is the only mention of how long it lasts',
    text.split('\n').filter((l) => /open|Until/.test(l)).join(' / '));

  // and both halves build it identically, which is the thing that breaks silently
  const runtime = fs.readFileSync(new URL('../../mintface.js', import.meta.url), 'utf8');
  const closing = 'Signing opens Studio until the date above. It moves nothing and spends nothing.';
  ok(runtime.includes(closing) && text.includes(closing),
    'the browser and the server write the same closing line');
}

head('The artist signs in the same way');
{
  const opened = await signIn(artist);
  ok(opened.status === 200 && opened.body.token, 'the artist opens a week too', opened.body.error);
  advance(20000);
  const said = await withToken(opened.body.token, { action: 'say', text: 'Working today.' });
  ok(said.status === 200 && said.body.message.role === 'artist',
    'and speaks as the artist without another prompt', said.body.error);
  const target = (await get()).body.messages.find((x) => x.address === A(visco));
  const cut = await withToken(opened.body.token, { action: 'delete', target: String(target.n) });
  ok(cut.status === 200 && cut.body.deleted === true,
    'and moderates without one either ... which is the whole point of the change', cut.body.error);
  await withToken(opened.body.token, { action: 'restore', target: String(target.n) });

  const muted = await withToken(opened.body.token, { action: 'mute', target: A(nobody) });
  ok(muted.status === 200, 'mute as well', muted.body.error);
  await withToken(opened.body.token, { action: 'unmute', target: A(nobody) });
}

head('A muted wallet cannot sign in around it');
{
  await post(artist, { action: 'mute', target: A(oneCopy) });
  const tried = await signIn(oneCopy);
  ok(tried.status === 403 && /muted/.test(tried.body.error || ''),
    'the door is shut at sign-in as well as at the message', `${tried.status} ${tried.body.error}`);
  await post(artist, { action: 'unmute', target: A(oneCopy) });
}

head('Wearing the leaderboard lightly');
{
  ok(wearTao(1493717) === '1.49M' && wearTao(69000) === '69K' && wearTao(4200) === '4.2K' && wearTao(4) === '4',
    'TAO reads roughly, not exactly',
    [1493717, 69000, 4200, 4].map(wearTao).join(', '));
}

head('The text layer, on messages already in the log');
{
  /* Nothing here is stored as markup. These are said as plain characters, the
     way every message in the room was said before any of this existed, and the
     links come out of the drawing rather than out of the row. */
  const raw = await say(visco, 'the piece is at https://x.com/mintface/status/1934 ... **worth a look**');
  ok(raw.status === 200, 'a message with a raw URL in it goes in as it always did', raw.body.error);
  const drawn = (await get()).body.messages.find((m) => m.n === raw.body.message.n);
  ok(drawn.text.includes('https://x.com/mintface/status/1934'),
    'the row still holds the characters that were typed', drawn.text);
  ok(drawn.html.includes('<a class="lnk" href="https://x.com/mintface/status/1934"'),
    'and it reads back with a working link, retroactively', drawn.html);
  ok(drawn.html.includes('<strong>worth a look</strong>'), 'and its markdown, likewise');

  const attack = await say(loud, '<script>alert(1)</script> and <img src=x onerror=alert(1)>');
  const shown = (await get()).body.messages.find((m) => m.n === attack.body.message.n);
  ok(!/<script|<img/i.test(shown.html) && shown.html.startsWith('&lt;script&gt;'),
    'and a tag somebody typed is text on a page kept forever', shown.html.slice(0, 60));
}

head('What the links turn out to be');
{
  const work = await say(visco, 'this one: https://mintface.art/w/geodetic-1');
  const who = await say(loud, 'and https://collectors.mintface.art/visco.eth knows it');
  const seeded = await say(oneCopy, 'the thread: https://x.com/mintface/status/1934');
  /* A card fetched once is kept forever, so the seeded one stands for a fetch
     that already happened ... which is exactly what every reader after the
     first one gets. */
  await pipe([['SET', 'chat:card:https://x.com/mintface/status/1934', JSON.stringify({
    kind: 'site', url: 'https://x.com/mintface/status/1934', domain: 'x.com',
    title: 'MintFace on X', description: 'Nine works, one road.',
  })]]);

  const ns = [work, who, seeded].map((r) => r.body.message.n).join(',');
  const d = (await get(`cards=${ns}`)).body;
  const w = d.cards['https://mintface.art/w/geodetic-1'];
  ok(w && w.kind === 'work' && w.title === 'Road to Waipukurau',
    'a work URL is answered off the catalogue, not scraped', JSON.stringify(w));
  ok(w && /Available/.test(w.note) && /Geodetic Moments/.test(w.note) && /display\.webp$/.test(w.thumb || ''),
    'with its collection, its standing and a thumbnail of our own', w && w.note);

  const c = d.cards['https://collectors.mintface.art/visco.eth'];
  ok(c && c.kind === 'collector' && c.title === 'visco.eth' && c.note === '1.49M TAO',
    'a collector URL is their name and their TAO, off the register', JSON.stringify(c));

  const x = d.cards['https://x.com/mintface/status/1934'];
  ok(x && x.title === 'MintFace on X' && x.domain === 'x.com' && !x.thumb,
    'and somebody else\'s link is a card of words, with no picture in it', JSON.stringify(x));
}

head('A preview is not a fetch anybody asked for');
{
  /* The room's own test server is on the loopback, so a URL pointing at it is
     the exact thing an SSRF would try ... and it is the one URL in this file
     that must come back with nothing. */
  const inside = await say(visco, `have a look at ${ORIGIN}/data/tao.json`);
  const d = (await get(`cards=${inside.body.message.n}`)).body;
  const key = Object.keys(d.cards)[0];
  ok(d.cards[key] === false, 'a link into a private address gets no card', `${key} → ${d.cards[key]}`);
  const [held] = await pipe([['GET', `chat:card:${key}`]]);
  ok(/"fail":true/.test(String(held)), 'and the room remembers not to try it again today', String(held));

  const none = (await get('cards=999999')).body;
  ok(none.cards && Object.keys(none.cards).length === 0,
    'and a message number that carries no link asks for nothing');
}

/* ================= answering somebody ================= */
head('A reply is a message number, and nothing else');
{
  advance(700000);       // a clean burst window: ten in ten minutes, and these say more
  const first = await say(visco, 'Waipukurau in that light is the whole collection.');
  const n = first.body.message.n;
  const back = await answer(oneCopy, 'It is the one I keep going back to.', n);
  ok(back.status === 200 && back.body.ok, 'a message may answer another one', back.body.error);
  ok(back.body.message.reply && back.body.message.reply.n === n,
    'and carries the number it is answering', JSON.stringify(back.body.message.reply));
  ok(back.body.message.reply.name === 'visco.eth',
    'said with the name the register gives that wallet today, not one stored on the row',
    back.body.message.reply.name);
  ok(back.body.message.reply.address === A(visco) && back.body.message.reply.url,
    'pointed at the person as well as the message', back.body.message.reply.url);

  /* The row keeps a number. Not a name, not an address, not a copy of the
     words ... which is the whole reason a rename reaches it. */
  const stored = await chatStore(pipe, chatCfg).get(back.body.message.n);
  ok(stored.reply === n && !('reply_name' in stored),
    'and the row itself holds the number alone', JSON.stringify(stored.reply));

  const anyone = (await get()).body.messages.find((m) => m.n === back.body.message.n);
  ok(anyone.reply && anyone.reply.n === n && anyone.reply.name === 'visco.eth',
    'which is how a reader with no wallet sees it too', JSON.stringify(anyone.reply));

  const nowhere = await answer(visco, 'Answering the void.', 999999);
  ok(nowhere.status === 404, 'answering a message that was never said is refused', `${nowhere.status}`);
  const negative = await answer(visco, 'Answering minus one.', -1);
  ok(negative.status === 400, 'and so is a number that is not a message', `${negative.status}`);
}

head('Changing what a reply answers, after signing, is refused');
{
  advance(700000);       // a clean burst window: ten in ten minutes, and these say more
  advance(20000);
  const issued = new Date().toISOString();
  const address = A(visco);
  const signature = await visco.signMessage({
    message: chatMessage({ action: 'say', text: 'Agreed.', reply: '0', address, issued }),
  });
  const r = await POST(new Request(`${ORIGIN}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'say', text: 'Agreed.', reply: '1', address, issued, signature }),
  }));
  ok(r.status === 401, 'the message a signature is hung under is part of what was signed', String(r.status));
}

head('Being answered is being told');
{
  advance(700000);       // a clean burst window: ten in ten minutes, and these say more
  const before = (await get(`viewer=${A(loud)}`)).body.me.mentions;
  const his = await say(loud, 'The Geodetic prints read differently in person.');
  const reply = await answer(visco, 'They do. The paper is half of it.', his.body.message.n);
  ok(reply.status === 200, 'somebody answers, naming nobody', reply.body.error);
  const after = (await get(`viewer=${A(loud)}`)).body.me.mentions;
  ok(after.unseen === before.unseen + 1,
    'and the person answered is told, though their name is nowhere in the sentence',
    `${before.unseen} → ${after.unseen}`);

  /* Answering yourself is a way of writing, not a way of being told. */
  const mine = (await get(`viewer=${A(visco)}`)).body.me.mentions;
  await answer(visco, 'Though the light does most of it.', reply.body.message.n);
  const still = (await get(`viewer=${A(visco)}`)).body.me.mentions;
  ok(still.unseen === mine.unseen, 'answering yourself is not', `${mine.unseen} → ${still.unseen}`);
}

head('The cherry takes you to the earliest one you have not read');
{
  const m = (await get(`viewer=${A(loud)}`)).body.me.mentions;
  ok(Number.isInteger(m.next), 'the room says where to go, not just how many', String(m.next));
  ok(m.unseen === m.total && m.next != null,
    'and it is the earliest of them, because that is where reading starts',
    `${m.unseen} unseen of ${m.total}, first at ${m.next}`);

  const opened = await signIn(loud);
  const read = await withToken(opened.body.token, { action: 'seen' });
  ok(read.status === 200 && read.body.seen, 'pressing it marks them read', read.body.error);
  const done = (await get(`viewer=${A(loud)}`)).body.me.mentions;
  ok(done.unseen === 0 && done.next === null,
    'and the cherry has nowhere left to take you', JSON.stringify(done));
  await withToken(opened.body.token, { action: 'sign out' });
}

/* ================= the marks ================= */
head('A mark under something somebody said');
{
  advance(700000);       // a clean burst window: ten in ten minutes, and these say more
  const said = await say(visco, 'This is the one.');
  const n = said.body.message.n;

  const one = await react(oneCopy, n, CHERRY);
  ok(one.status === 200 && one.body.on === true, 'a wallet with TAO leaves a mark', one.body.error);
  ok(one.body.reactions.length === 1 && one.body.reactions[0].count === 1 && one.body.reactions[0].mine,
    'counted, and known to be theirs', JSON.stringify(one.body.reactions));

  const again = await react(oneCopy, n, CHERRY);
  ok(again.status === 200 && again.body.on === false, 'pressing it again takes it back', again.body.error);
  ok(again.body.reactions.length === 0, 'and the count goes with it', JSON.stringify(again.body.reactions));

  await react(oneCopy, n, CHERRY);
  const twice = await react(oneCopy, n, CHERRY);
  await react(oneCopy, n, CHERRY);
  ok(twice.body.on === false, 'one of each per wallet per message, whatever the order of pressing');

  const two = await react(loud, n, CHERRY);
  ok(two.body.reactions[0].count === 2, 'two wallets are two', JSON.stringify(two.body.reactions));
  const heart = await react(loud, n, HEART);
  ok(heart.body.reactions.length === 2, 'and one wallet may leave more than one kind',
    JSON.stringify(heart.body.reactions));

  /* Reading them takes nothing, like everything else in this room ... and a
     reader with no wallet is nobody's mark. */
  const open = (await get()).body.messages.find((x) => x.n === n);
  ok(open.reactions.length === 2 && open.reactions.every((r) => r.mine === false),
    'a reader with no wallet sees the marks and owns none of them', JSON.stringify(open.reactions));
  const his = (await get(`viewer=${A(loud)}`)).body.messages.find((x) => x.n === n);
  ok(his.reactions.every((r) => r.mine === true), 'and the wallet that left them is told which are theirs');

  /* The order is the config's order, so the room reads the same everywhere. */
  ok(open.reactions[0].emoji === CHERRY && open.reactions[1].emoji === HEART,
    'drawn in the order the config sets, not the order they arrived',
    open.reactions.map((r) => r.emoji).join(' '));

  const junk = await react(visco, n, '\u{1F480}');
  ok(junk.status === 400, 'a mark Studio does not offer is refused', `${junk.status} ${junk.body.error}`);
  const empty = await react(visco, n, '');
  ok(empty.status === 400, 'and so is nothing at all');
  const nowhere = await react(visco, 999999, CHERRY);
  ok(nowhere.status === 404, 'and a message that was never said');
}

head('Reacting takes TAO, like speaking');
{
  advance(700000);       // a clean burst window: ten in ten minutes, and these say more
  const said = await say(visco, 'Marks cost what words cost.');
  const n = said.body.message.n;
  const broke = await react(nobody, n, CHERRY);
  ok(broke.status === 403 && /holding TAO/.test(broke.body.error || ''),
    'a wallet with no TAO cannot leave one, and is told why', `${broke.status} ${broke.body.error}`);

  const quiet = privateKeyToAccount(generatePrivateKey());
  taoFixture.wallets[A(quiet)] = { tao: 12 };
  await post(artist, { action: 'mute', target: A(quiet) });
  const muted = await react(quiet, n, CHERRY);
  ok(muted.status === 403 && /muted/.test(muted.body.error || ''),
    'and a muted wallet cannot react around the mute', `${muted.status} ${muted.body.error}`);
  await post(artist, { action: 'unmute', target: A(quiet) });
  const freed = await react(quiet, n, CHERRY);
  ok(freed.status === 200, 'and can once it is lifted', freed.body.error);

  /* The mark and the message it goes under are both in the sentence. */
  const issued = new Date().toISOString();
  const address = A(visco);
  const signature = await visco.signMessage({
    message: chatMessage({ action: 'react', emoji: CHERRY, target: String(n), address, issued }),
  });
  const swapped = await POST(new Request(`${ORIGIN}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'react', emoji: HEART, target: String(n), address, issued, signature }),
  }));
  ok(swapped.status === 401, 'so a cherry cannot be signed and a heart sent', String(swapped.status));
}

head('Taking a message down takes its marks with it');
{
  advance(700000);       // a clean burst window: ten in ten minutes, and these say more
  const said = await say(visco, 'Something that will not last.');
  const n = said.body.message.n;
  await react(oneCopy, n, CHERRY);
  await react(loud, n, HEART);
  const up = (await get()).body.messages.find((x) => x.n === n);
  ok(up.reactions.length === 2, 'two marks under it', JSON.stringify(up.reactions));

  const down = await post(artist, { action: 'delete', target: String(n) });
  ok(down.status === 200 && down.body.message.reactions.length === 0,
    'taken down, and the marks go with it', JSON.stringify(down.body.message.reactions));
  const gone = (await get()).body.messages.find((x) => x.n === n);
  ok(gone.text === null && gone.reactions.length === 0,
    'which is what everybody else sees too', JSON.stringify(gone.reactions));

  const late = await react(visco, n, CHERRY);
  ok(late.status === 400, 'and nothing new can be put under a gap', `${late.status} ${late.body.error}`);
  const answering = await answer(visco, 'Answering something that is not there.', n);
  ok(answering.status === 400, 'nor answered', `${answering.status} ${answering.body.error}`);

  /* Hidden, not removed. Everything in this room is kept. */
  const back = await post(artist, { action: 'restore', target: String(n) });
  ok(back.status === 200 && back.body.message.reactions.length === 2,
    'and putting it back puts them back, because nothing was ever deleted',
    JSON.stringify(back.body.message.reactions));
}

head('The marks are one number on the poll');
{
  advance(700000);       // a clean burst window: ten in ten minutes, and these say more
  const said = await say(visco, 'A quiet room costs a digit.');
  const n = said.body.message.n;
  const first = (await get(`since=${(await get()).body.total}`)).body;
  ok(Number.isInteger(first.rx), 'the poll carries where the marks are up to', String(first.rx));
  await react(loud, n, CHERRY);
  const second = (await get(`since=${(await get()).body.total}`)).body;
  ok(second.rx > first.rx, 'and it moves when somebody reacts', `${first.rx} → ${second.rx}`);

  const asked = (await get(`rx=${n}&viewer=${A(loud)}`)).body;
  ok(asked.reactions[n] && asked.reactions[n][0].count === 1 && asked.reactions[n][0].mine,
    'so the page can ask what is under a message without asking for the message',
    JSON.stringify(asked.reactions[n]));
  const stranger = (await get(`rx=${n}`)).body;
  ok(stranger.reactions[n][0].mine === false, 'and a reader with no wallet owns none of it');
}

head('The room hands the page its own alphabet');
{
  const d = (await get()).body;
  ok(Array.isArray(d.emoji) && d.emoji.length && d.emoji.length <= 8,
    'the marks come from the config, and there are fewer than eight of them',
    (d.emoji || []).join(' '));
  ok(d.emoji[0] === CHERRY, 'the cherry first, because it is the house one', d.emoji[0]);
  const page = fs.readFileSync(new URL('../../studio.html', import.meta.url), 'utf8');
  ok(!/const EMOJI = \[/.test(page) && /ROOM\.emoji = d\.emoji/.test(page),
    'and the page draws the set it is given rather than one of its own');
}

head('The page opens at the latest thing anybody said');
{
  const d = (await get()).body;
  ok(d.end === d.total, 'a page with no `before` on it ends at the newest message',
    `${d.start}\u2013${d.end} of ${d.total}`);
  const page = fs.readFileSync(new URL('../../studio.html', import.meta.url), 'utf8');
  ok(/load\(\{ bottom: sent == null \}\)/.test(page),
    'and the room is opened at the foot of it, unless the cherry sent you to a message');
  ok(/IntersectionObserver/.test(page), 'with earlier arriving upward as a reader goes looking');
  ok(/Shift|shiftKey/.test(page) && /ev\.key === 'Enter' && !ev\.shiftKey/.test(page),
    'return sends, and shift and return is a new line');
  ok(/hover: none/.test(page) && /!TOUCH/.test(page),
    'except on a touch screen, where return stays the return key');
}

head('What the nav asks, on every page of both sites');
{
  advance(700000);
  /* The bar at the top of both deploys needs two facts and no messages. A
     component that put a name in a corner by fetching fifty rows and their
     marks would be paying for the room on every page of the catalogue. */
  const light = await get(`me=1&viewer=${A(visco)}`);
  ok(light.status === 200 && light.body.me, 'the room answers who a wallet is', light.body.error);
  ok(light.body.messages === undefined,
    'without a page of the log in it', JSON.stringify(Object.keys(light.body)));
  ok(light.body.me.name === 'visco.eth' && light.body.me.url,
    'with the name to draw and the page to link it to', `${light.body.me.name} ${light.body.me.url}`);
  ok(Number.isInteger(light.body.session_days),
    'and how long one signature lasts, so the nav can sign in without asking twice',
    String(light.body.session_days));

  /* The same answer to the same question, whoever is asking. A nav showing a
     different number from the room it links into is worse than no number. */
  const full = await get(`viewer=${A(visco)}`);
  ok(JSON.stringify(light.body.me) === JSON.stringify(full.body.me),
    'and it is the very same standing the room draws its own page from');

  const nobodyAtAll = await get('me=1');
  ok(nobodyAtAll.status === 200 && nobodyAtAll.body.me === null && nobodyAtAll.body.session_days,
    'a reader with no wallet is nobody, and is still told what a signature would buy',
    JSON.stringify(nobodyAtAll.body));
  const junk = await get('me=1&viewer=not-a-wallet');
  ok(junk.status === 200 && junk.body.me === null, 'and so is a viewer that is not an address');
}

/* ================= one sign-in, two hosts ================= */
head('The sentence names the site it was asked on');
{
  advance(700000);
  const good = await signIn(visco, 'mintface.art');
  ok(good.status === 200 && good.body.token, 'a sign-in signed for the catalogue is taken', good.body.error);
  const other = await signIn(visco, 'collectors.mintface.art');
  ok(other.status === 200 && other.body.token,
    'and one signed for the register is taken by the same API, which is the whole trick',
    other.body.error);
  const mine = await signIn(visco, HERE);
  ok(mine.status === 200, 'and one signed for whatever host is answering, so a preview signs into itself');

  const elsewhere = await signIn(visco, 'mintface.art.evil.example');
  ok(elsewhere.status === 400 && /not signed for this site/.test(elsewhere.body.error || ''),
    'a signature collected somewhere else cannot be spent here',
    `${elsewhere.status} ${elsewhere.body.error}`);
  const lookalike = await signIn(visco, 'mintfaceart');
  ok(lookalike.status === 400, 'nor one signed for a name that only reads like ours');

  /* And it is in the sentence, not merely in the request. A domain the server
     checks but the wallet never showed would be a promise to nobody. */
  const text = chatMessage({ action: 'sign in', address: A(visco),
    issued: '2026-08-29T00:00:00.000Z', until: '2026-09-28T00:00:00.000Z', domain: 'mintface.art' });
  ok(text.includes('Domain: mintface.art'), 'and the wallet is shown the site it is signing for',
    text.split('\n')[3]);
  const swapped = await (async () => {
    const issued = new Date().toISOString();
    const address = A(visco);
    const until = sessionUntil(issued, chatCfg.session_days);
    const signature = await visco.signMessage({
      message: chatMessage({ action: 'sign in', address, issued, until, domain: 'mintface.art' }),
    });
    const r = await POST(new Request(`${ORIGIN}/api/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'sign in', address, issued, until,
        domain: 'collectors.mintface.art', signature }),
    }));
    return { status: r.status };
  })();
  ok(swapped.status === 401, 'so the site cannot be changed after signing', String(swapped.status));

  const none = await (async () => {
    const issued = new Date().toISOString();
    const address = A(visco);
    const until = sessionUntil(issued, chatCfg.session_days);
    const signature = await visco.signMessage({ message: chatMessage({ action: 'sign in', address, issued, until }) });
    const r = await POST(new Request(`${ORIGIN}/api/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'sign in', address, issued, until, signature }),
    }));
    return { status: r.status };
  })();
  ok(none.status === 400, 'and a sign-in that names no site at all is not taken', String(none.status));
}

head('The session is a cookie the two hosts share');
{
  advance(700000);
  const opened = await signIn(visco, 'mintface.art');
  const jar = opened.cookies || [];
  const tok = jar.find((c) => c.startsWith(`${TOKEN_COOKIE}=`));
  const who = jar.find((c) => c.startsWith(`${WHO_COOKIE}=`));
  ok(tok && who, 'signing in sets two cookies', jar.map((c) => c.split('=')[0]).join(', '));
  ok(/HttpOnly/.test(tok), 'the credential is HttpOnly, so no script on either site can read it again');
  ok(!/HttpOnly/i.test(who), 'and the one the nav draws from is not, because that is its whole job');
  ok(/^mf_who=0x[0-9a-f]{40}%7C/i.test(who) || /^mf_who=0x[0-9a-f]{40}\|/i.test(who),
    'and it carries a wallet and a date, which are public, and nothing else', who.split(';')[0]);
  ok(/Secure/.test(tok) && /SameSite=Lax/.test(tok),
    'Secure, and Lax ... the two hosts are one registrable domain, so nothing here is third-party');

  /* The scoping itself, checked on the real hostnames rather than on the
     loopback this route is answering from. */
  const real = openCookies({ token: 'x'.repeat(64), address: A(visco), until: '2026-09-28T00:00:00.000Z',
    host: 'mintface.art', seconds: 2592000 });
  ok(real.every((c) => c.includes('Domain=.mintface.art')),
    'set from the catalogue, it is scoped to the domain both hosts share', real[0].split(';')[1]);
  const fromPeople = openCookies({ token: 'x'.repeat(64), address: A(visco), until: '2026-09-28T00:00:00.000Z',
    host: 'collectors.mintface.art', seconds: 2592000 });
  ok(fromPeople.every((c) => c.includes('Domain=.mintface.art')),
    'and set from the register, the very same scope, so it goes both ways');
  const preview = openCookies({ token: 'x'.repeat(64), address: A(visco), until: '2026-09-28T00:00:00.000Z',
    host: 'art-abc123.vercel.app', seconds: 2592000 });
  ok(preview.every((c) => !/Domain=/.test(c)),
    'a preview deploy is a different registrable domain and keeps its session to itself');

  ok(clearCookies('mintface.art').filter((c) => /Domain=\.mintface\.art/.test(c)).length === 2
    && clearCookies('mintface.art').filter((c) => !/Domain=/.test(c)).length === 2,
    'and signing out clears both the parent and the host, so a session from before the re-scope goes too',
    `${clearCookies('mintface.art').length} lines`);
}

head('The cookie is what speaks, and the body no longer has to');
{
  advance(700000);
  const opened = await signIn(visco, 'mintface.art');
  const jar = opened.cookies || [];
  const cookie = jar.map((c) => c.split(';')[0]).join('; ');

  const said = await (async () => {
    const r = await POST(new Request(`${ORIGIN}/api/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ action: 'say', text: 'Said with a cookie and nothing else.' }),
    }));
    return { status: r.status, body: await r.json() };
  })();
  ok(said.status === 200 && said.body.message.address === A(visco),
    'a message with no token in it at all, written under the wallet the cookie stands for',
    said.body.error || said.body.message.address);

  /* Who is reading, answered from the session rather than from a query string.
     The nav on the register arrives with a cookie and nothing else. */
  const seen = await GET(new Request(`${ORIGIN}/api/chat?me=1`, { headers: { cookie } }));
  const body = await seen.json();
  ok(body.me && body.me.name === 'visco.eth' && body.me.url,
    'and the nav is told whose name to draw without having to say whose name to draw',
    JSON.stringify(body.me && { name: body.me.name, url: body.me.url }));

  const out = await (async () => {
    const r = await POST(new Request(`${ORIGIN}/api/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ action: 'sign out' }),
    }));
    return { status: r.status, cookies: r.headers.getSetCookie() };
  })();
  ok(out.status === 200 && out.cookies.every((c) => /Max-Age=0/.test(c)),
    'and signing out unsets them, which only the server can do to an HttpOnly cookie',
    `${out.cookies.length} cleared`);
  const after = await (async () => {
    const r = await POST(new Request(`${ORIGIN}/api/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ action: 'say', text: 'Still here?' }),
    }));
    return r.status;
  })();
  ok(after === 401 || after === 400, 'and the cookie stops working at once', String(after));
}

head('Credentials and a wildcard are not allowed together');
{
  const fam = corsFor(new Request('https://mintface.art/api/chat',
    { headers: { origin: 'https://collectors.mintface.art' } }));
  ok(fam['access-control-allow-origin'] === 'https://collectors.mintface.art'
    && fam['access-control-allow-credentials'] === 'true',
    'the register is answered with its own origin and permission to send the cookie',
    JSON.stringify(fam['access-control-allow-origin']));
  ok(fam.vary === 'Origin', 'and the answer says it varies by who asked, so no cache hands one reader the other\'s');

  const stranger = corsFor(new Request('https://mintface.art/api/chat',
    { headers: { origin: 'https://somebody.example' } }));
  ok(stranger['access-control-allow-origin'] === '*' && !stranger['access-control-allow-credentials'],
    'everybody else keeps the wildcard the room has always answered with, and gets no credentials',
    JSON.stringify(stranger['access-control-allow-origin']));
  const bare = corsFor(new Request('https://mintface.art/api/chat'));
  ok(bare['access-control-allow-origin'] === '*', 'and so does a request with no origin on it at all');

  ok(domainOk('collectors.mintface.art', new Request('https://mintface.art/api/chat'))
    && domainOk('mintface.art', new Request('https://mintface.art/api/chat'))
    && !domainOk('evil.example', new Request('https://mintface.art/api/chat')),
    'and the pair is a list of two, not a suffix match');
}

head("The reporter's sequence: reply once, then say two plain things");
{
  advance(700000);
  /* The report was two symptoms and one coercion. A message that answers
     nothing is stored with `reply: null`, and `Number(null)` is nought, which
     is a perfectly good message number: the first thing anybody ever said in
     this room. So every plain message written since replies shipped rendered
     as an answer to message zero, the name in that line was whoever said it,
     and clicking that name went to their first message. Nothing was sticky and
     nothing was overloaded in the state ... the render was simply lying. */
  const target = await say(visco, 'The one being answered.');
  const answered = await answer(oneCopy, 'Answering it, once.', target.body.message.n);
  ok(answered.body.message.reply && answered.body.message.reply.n === target.body.message.n,
    'the reply is a reply', JSON.stringify(answered.body.message.reply));

  const two = await say(oneCopy, 'A plain thing said afterwards.');
  const three = await say(oneCopy, 'And another plain thing.');
  ok(two.body.message.reply === null && three.body.message.reply === null,
    'and the two plain messages after it are plain',
    `${JSON.stringify(two.body.message.reply)} / ${JSON.stringify(three.body.message.reply)}`);

  /* And as anybody else reads them back, which is where it was seen. */
  const room = (await get()).body.messages;
  const plain = room.filter((m) => !m.deleted && m.reply === null);
  ok(plain.length > 5, 'and read back as plain by everybody else', `${plain.length} of ${room.length}`);
  const first = (await get('before=1')).body.messages[0];
  ok(first && first.n === 0 && first.reply === null,
    'the very first message in the room answers nothing, as it must',
    first ? `#${first.n} reply ${JSON.stringify(first.reply)}` : 'not found');
  ok(!room.some((m) => m.reply && m.reply.n === 0 && m.n !== 1),
    'and nothing that never answered it says it did');

  /* The row itself keeps a null, which is what the guard has to survive. */
  const stored = await chatStore(pipe, chatCfg).get(two.body.message.n);
  ok(stored.reply === null, 'the row stores a null rather than a number', JSON.stringify(stored.reply));
  ok(render(stored, {}).reply === null, 'and a null is not message zero');
  ok(render({ ...stored, reply: 0 }, { parents: { 0: { n: 0, address: A(visco), name: 'visco.eth' } } }).reply.n === 0,
    'while an actual answer to message zero still is one');
}

head('A name goes where the person is, and nowhere else');
{
  const page = fs.readFileSync(new URL('../../studio.html', import.meta.url), 'utf8');
  const line = page.slice(page.indexOf('function replyLine'), page.indexOf('function actsRow'));
  ok(/data-act="goto"[^>]*>&#8627;</.test(line.replace(/\s+/g, ' ')),
    'the arrow in a reply line is what goes to the message');
  ok(/replying to \$\{name\}/.test(line) && /r\.url \? `<a href=/.test(line),
    'and the name beside it is a link to their register page, like every other name');
  ok(!/data-act="goto"[^`]*\$\{label\}/.test(line),
    'the name is not also the control ... one action per element');

  const between = (from, to) => {
    const a = page.indexOf(from);
    const b = page.indexOf(to, a + 1);
    return a < 0 || b < 0 ? '' : page.slice(a, b);
  };
  const chip = between('function replyingTo()', '\n/*');
  ok(/data-act="unreply"/.test(chip) && /Replying to/.test(chip),
    'the chip says who is being answered and carries the way to take it off');
  ok(/ROOM\.replyTo = null;/.test(between("ev.key === 'Escape' && ROOM.replyTo", 'return;')),
    'and escape is the other way, because that is where a hand goes');
  const sent = between('async function sayIt(b)', 'A mark under something');
  ok(/ROOM\.replyTo = null;/.test(sent) && /const reply = ROOM\.replyTo;/.test(sent),
    'sending reads it once and clears it, so the next message is plain unless asked otherwise');
}

server.close();
console.log(`\n${'='.repeat(74)}`);
console.log(failed === 0 ? `All ${ran} checks pass.` : `${failed} of ${ran} checks failed.`);
process.exit(failed === 0 ? 0 : 1);
