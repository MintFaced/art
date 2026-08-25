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
  seconds_between: 15, burst: 10, burst_window_seconds: 600, page: 50, session_days: 7,
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
  res.writeHead(404); res.end('no');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
process.env.KV_REST_API_URL = ORIGIN;
process.env.KV_REST_API_TOKEN = 'test';

const { GET, POST } = await import('../../api/chat.js');
const { chatMessage, chatStore, wearTao, sessionUntil } = await import('../../api/_lib/chat.js');
const { pipe } = await import('../../api/_lib/kv.js');

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

/** The one signature, the way the page does it. */
const signIn = async (account) => {
  const issued = new Date().toISOString();
  const address = A(account);
  const until = sessionUntil(issued, chatCfg.session_days);
  const signature = await account.signMessage({ message: chatMessage({ action: 'sign in', address, issued, until }) });
  const r = await POST(new Request(`${ORIGIN}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'sign in', address, issued, until, signature }),
  }));
  return { status: r.status, body: await r.json() };
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
head('One signature, then a week of it');
{
  const opened = await signIn(visco);
  ok(opened.status === 200 && opened.body.token && opened.body.until,
    'one signature opens the room', opened.body.error || `until ${opened.body.until}`);
  const token = opened.body.token;
  ok(token.length >= 32, 'the token is long enough not to be guessed', `${token.length} characters`);
  ok(Date.parse(opened.body.until) - Date.now() > 6 * 86400000, 'and it lasts the week');

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

server.close();
console.log(`\n${'='.repeat(74)}`);
console.log(failed === 0 ? `All ${ran} checks pass.` : `${failed} of ${ran} checks failed.`);
process.exit(failed === 0 ? 0 : 1);
