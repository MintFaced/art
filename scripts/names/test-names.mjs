#!/usr/bin/env node
/* The acceptance cases for names and for tagging.
 *
 * The routes are the real ones. Real keys sign the real sentences, api/names.js
 * and api/chat.js verify them with viem, and both read a register fixture and
 * write through a stand-in Redis. The two are run together on purpose: a name
 * is only worth setting because of where else it shows up, and the whole claim
 * of the design is that setting one in the register changes what the room says.
 *
 *   node scripts/names/test-names.mjs
 */
import http from 'node:http';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';

/* ---------- a small Redis ---------- */
let NOW = Date.now();
const advance = (ms) => { NOW += ms; };
const str = new Map();
const list = new Map();
const sets = new Map();
const hashes = new Map();
const ttl = new Map();
const alive = (k) => !ttl.has(k) || ttl.get(k) > NOW;
const reap = (k) => { if (!alive(k)) { str.delete(k); ttl.delete(k); } };
const L = (k) => { if (!list.has(k)) list.set(k, []); return list.get(k); };
const S = (k) => { if (!sets.has(k)) sets.set(k, new Set()); return sets.get(k); };
const H = (k) => { if (!hashes.has(k)) hashes.set(k, new Map()); return hashes.get(k); };

const redis = ([cmd, ...a]) => {
  const c = String(cmd).toUpperCase();
  switch (c) {
    case 'SET': {
      reap(a[0]);
      if (a.includes('NX') && str.has(a[0])) return null;
      str.set(a[0], a[1]);
      const i = a.indexOf('EX');
      if (i > -1) ttl.set(a[0], NOW + Number(a[i + 1]) * 1000); else ttl.delete(a[0]);
      return 'OK';
    }
    case 'GET': reap(a[0]); return str.has(a[0]) ? str.get(a[0]) : null;
    case 'MGET': return a.map((k) => { reap(k); return str.has(k) ? str.get(k) : null; });
    case 'DEL': { reap(a[0]); const had = str.delete(a[0]); ttl.delete(a[0]); return had ? 1 : 0; }
    case 'INCR': { reap(a[0]); const v = (Number(str.get(a[0])) || 0) + 1; str.set(a[0], String(v)); return v; }
    case 'INCRBY': { reap(a[0]); const v = (Number(str.get(a[0])) || 0) + Number(a[1]); str.set(a[0], String(v)); return v; }
    case 'EXPIRE': ttl.set(a[0], NOW + Number(a[1]) * 1000); return 1;
    case 'RPUSH': L(a[0]).push(...a.slice(1)); return L(a[0]).length;
    case 'LLEN': return L(a[0]).length;
    case 'LRANGE': {
      const rows = L(a[0]);
      let [s0, s1] = [Number(a[1]), Number(a[2])];
      if (s0 < 0) s0 = Math.max(0, rows.length + s0);
      if (s1 < 0) s1 = rows.length + s1;
      return rows.slice(s0, s1 + 1);
    }
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
const visco = privateKeyToAccount(generatePrivateKey());     // has an ENS and a page
const anon = privateKeyToAccount(generatePrivateKey());      // no ENS, has a page
const oneCopy = privateKeyToAccount(generatePrivateKey());   // on the register, no page
const written = privateKeyToAccount(generatePrivateKey());   // Ryan wrote a name down
const hushed = privateKeyToAccount(generatePrivateKey());    // muted in Studio
const stranger = privateKeyToAccount(generatePrivateKey());  // holds nothing
const A = (x) => x.address.toLowerCase();

const chatCfg = {
  version: 1, min_tao: 1, max_chars: 500, seconds_between: 15,
  burst: 10, max_tags: 3, tag_burst: 6, burst_window_seconds: 600, page: 50, session_days: 30,
};
const artistFixture = { wallets: { [A(artist)]: 'mintface.eth' } };
const taoFixture = {
  wallets: {
    [A(visco)]: { tao: 1493717 }, [A(anon)]: { tao: 4200 },
    [A(oneCopy)]: { tao: 4 }, [A(written)]: { tao: 70000 },
    [A(hushed)]: { tao: 500 }, [A(artist)]: { tao: 0 },
  },
};
const registerFile = {
  fields: ['address', 'name', 'ens', 'slug', 'private', 'works', 'unique', 'tao', 'rate', 'last', 'rank'],
  rows: [
    [A(visco), 'visco.eth', 'visco.eth', 'visco.eth', 0, 83, 11, 1493717, 1162, '2026-08-21', 1],
    [A(written), 'Gissie', 'gissie.eth', 'gissie.eth', 0, 40, 9, 70000, 400, '2026-08-01', 2],
    [A(anon), '', '', '0xaaaaaaaa', 0, 9, 3, 4200, 60, '2026-07-01', 3],
    [A(hushed), '', '', '0xbbbbbbbb', 0, 4, 1, 500, 20, '2026-06-01', 4],
    [A(oneCopy), '', '', '', 0, 1, 0, 4, 4.2, '2026-08-20', 5],
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
  if (u.pathname === '/data/collectors-register.json') return send(200, registerFile);
  res.writeHead(404); res.end('no');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
process.env.KV_REST_API_URL = ORIGIN;
process.env.KV_REST_API_TOKEN = 'test';

const NAMES = await import('../../api/names.js');
const CHAT = await import('../../api/chat.js');
const { nameMessage, fold, checkName, parseTags, tagIndex, naming, registerIndex } =
  await import('../../api/_lib/names.js');
const { chatMessage, sessionUntil } = await import('../../api/_lib/chat.js');
const { forgetRegister } = await import('../../api/_lib/register.js');

let failed = 0; let ran = 0;
const ok = (cond, label, detail) => {
  ran++;
  if (!cond) failed++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n          ${detail}` : ''}`);
};
const head = (t) => console.log(`\n${t}\n${'='.repeat(74)}`);

const names = async (qs = '') => {
  const r = await NAMES.GET(new Request(`${ORIGIN}/api/names${qs ? `?${qs}` : ''}`));
  return { status: r.status, body: await r.json() };
};
const setName = async (account, payload) => {
  const issued = new Date().toISOString();
  const address = A(account);
  const signature = await account.signMessage({ message: nameMessage({ ...payload, address, issued }) });
  const r = await NAMES.POST(new Request(`${ORIGIN}/api/names`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...payload, address, issued, signature }),
  }));
  return { status: r.status, body: await r.json() };
};
const room = async (qs = '') => {
  const r = await CHAT.GET(new Request(`${ORIGIN}/api/chat${qs ? `?${qs}` : ''}`));
  return { status: r.status, body: await r.json() };
};
const say = async (account, text) => {
  advance(20000);
  const issued = new Date().toISOString();
  const address = A(account);
  const payload = { action: 'say', text };
  const signature = await account.signMessage({ message: chatMessage({ ...payload, address, issued }) });
  const r = await CHAT.POST(new Request(`${ORIGIN}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...payload, address, issued, signature }),
  }));
  return { status: r.status, body: await r.json() };
};
const signIn = async (account) => {
  const issued = new Date().toISOString();
  const address = A(account);
  const until = sessionUntil(issued, chatCfg.session_days);
  const signature = await account.signMessage({ message: chatMessage({ action: 'sign in', address, issued, until }) });
  const r = await CHAT.POST(new Request(`${ORIGIN}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'sign in', address, issued, until, signature }),
  }));
  return (await r.json()).token;
};
const withToken = async (token, payload) => {
  const r = await CHAT.POST(new Request(`${ORIGIN}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...payload, token }),
  }));
  return { status: r.status, body: await r.json() };
};

/* ================= the rules, before the routes ================= */
head('A name is compared by what it looks like');
{
  ok(fold('MintFace') === fold('M1ntFace') && fold('MintFace') === fold('mint-face')
    && fold('MintFace') === fold('MINT FACE'),
    'case, spacing, punctuation and a one for an i are all the same name',
    [fold('MintFace'), fold('M1ntFace'), fold('mint-face'), fold('MINT FACE')].join(' / '));
  ok(checkName('MintFace').error && checkName('M1nt Face').error && checkName('mintface').error,
    'so the artist cannot be worn by anybody, however it is spelled',
    checkName('M1nt Face').error);
  ok(!checkName('Ryan OG').error && checkName('Ryan OG').name === 'Ryan OG',
    'an ordinary name is an ordinary name');
  ok(checkName('  Ryan   OG  ').name === 'Ryan OG',
    'and arrives tidied, so two names cannot differ by a space nobody can see');
  ok(Boolean(checkName('x'.repeat(33)).error) && !checkName('x'.repeat(32)).error,
    'thirty-two characters, and the thirty-third is refused',
    checkName('x'.repeat(33)).error);
  ok(Boolean(checkName('me@here').error), 'an @ is refused, because an @ is how a tag starts');
  ok(Boolean(checkName('somebody.eth').error), 'an .eth is claimed on chain rather than typed here');
  ok(!checkName('visco.eth', { ens: ['visco.eth'] }).error,
    'except by the wallet it already resolves to');
}

/* ================= setting one ================= */
head('A collector sets a name');
{
  const before = await names(`address=${A(anon)}`);
  ok(before.body.name === `${A(anon).slice(0, 6)}…${A(anon).slice(-4)}` && before.body.source === 'address',
    'a wallet with no ENS reads as its address until it says otherwise', before.body.name);

  const set = await setName(anon, { action: 'set', name: 'Ryan OG' });
  ok(set.status === 200 && set.body.ok && set.body.name === 'Ryan OG',
    'and then it reads as the name they chose', set.body.error);

  const after = await names(`address=${A(anon)}`);
  ok(after.body.name === 'Ryan OG' && after.body.source === 'self',
    'the register says so to everybody, not only to them');
  ok(after.body.slug === '0xaaaaaaaa',
    'and the URL has not moved, which is the whole point of it being a label',
    after.body.slug);
  ok(after.body.ens === null,
    'a wallet with no reverse record still has none ... a name is not a claim on chain');

  const overlay = await names(`address=${A(written)}`);
  ok(overlay.body.name === 'Gissie' && overlay.body.source === 'overlay',
    'a name MintFace wrote down reads as his, not as theirs');
}

head('What a collector may not be called');
{
  const mine = await setName(visco, { action: 'set', name: 'ryan og' });
  ok(mine.status === 409 && /taken/i.test(mine.body.error || ''),
    'the same name twice, however it is capitalised', `${mine.status} ${mine.body.error}`);

  const homoglyph = await setName(visco, { action: 'set', name: 'Ryan 0G' });
  ok(homoglyph.status === 409,
    'and the near miss, which is the one that matters', homoglyph.body.error);

  const wearing = await setName(visco, { action: 'set', name: 'gissie.eth' });
  ok(wearing.status !== 200 && /eth/i.test(wearing.body.error || ''),
    "another collector's .eth cannot be worn as a label", wearing.body.error);

  const written_ = await setName(visco, { action: 'set', name: 'Gissie' });
  ok(written_.status === 409,
    'nor a name MintFace has already written beside somebody else', written_.body.error);

  const house = await setName(visco, { action: 'set', name: 'MintFace' });
  ok(house.status === 400 && /register/.test(house.body.error || ''),
    'and the house keeps its own name', house.body.error);

  const nobody = await setName(stranger, { action: 'set', name: 'Passing Through' });
  ok(nobody.status === 403,
    'a wallet holding no MintFace work has nowhere to be named', nobody.body.error);

  const own = await setName(visco, { action: 'set', name: 'visco.eth' });
  ok(own.status === 200, 'a wallet may always be called what the chain calls it', own.body.error);
}

head('Asked before anybody is sent to their wallet');
{
  const free = await names(`check=${encodeURIComponent('Quite Free')}&address=${A(visco)}`);
  ok(free.body.free === true && !free.body.why, 'a name nobody has comes back free', JSON.stringify(free.body));

  const taken = await names(`check=${encodeURIComponent('ryan og')}&address=${A(visco)}`);
  ok(taken.body.free === false && /taken/i.test(taken.body.why || ''),
    'and one somebody has comes back with the reason', taken.body.why);

  const house = await names(`check=MintFace&address=${A(visco)}`);
  ok(house.body.free === false && /register/.test(house.body.why || ''),
    'the same answer the signature would have got, without the signature', house.body.why);

  const theirs = await names(`check=visco.eth&address=${A(visco)}`);
  ok(theirs.body.free === true, 'and a wallet may always be called what the chain calls it');

  const tidy = await names(`check=${encodeURIComponent('  Quite   Free  ')}&address=${A(visco)}`);
  ok(tidy.body.name === 'Quite Free',
    'the name it reports back is the tidied one, so nobody is surprised by what lands',
    tidy.body.name);

  /* It is a courtesy, not the guard. The check writes nothing, so the same
     name is still free afterwards and the signature is still what decides. */
  const again = await names(`check=${encodeURIComponent('Quite Free')}&address=${A(anon)}`);
  ok(again.body.free === true, 'asking does not reserve anything');
}

head('MintFace outranks, and can clear');
{
  const tried = await setName(written, { action: 'set', name: 'Gissie of Ariki' });
  ok(tried.status === 200 && tried.body.outranked === true && tried.body.name === 'Gissie',
    'a collector under an overlay may set a name, and is told it waits underneath',
    `${tried.body.name} / outranked ${tried.body.outranked}`);

  const reset = await setName(artist, { action: 'reset', target: A(anon) });
  ok(reset.status === 200 && reset.body.was === 'Ryan OG',
    'MintFace clears a name the same quiet way he takes a note down', reset.body.error);

  const after = await names(`address=${A(anon)}`);
  ok(after.body.source === 'address' && after.body.self === null,
    'and what is left is what the chain says, which was never his to take');

  const notHis = await setName(visco, { action: 'reset', target: A(written) });
  ok(notHis.status === 403, 'nobody else has that hand', `${notHis.status}`);

  const log = await names(`log=50&viewer=${A(artist)}`);
  ok(log.status === 200 && log.body.changes.some((x) => x.action === 'reset' && x.address === A(anon)),
    'and every change is written down');
  const hidden = await names(`log=50&viewer=${A(visco)}`);
  ok(hidden.status === 403, 'the log is his, as the power is', `${hidden.status}`);

  // put the name back for everything that follows
  await setName(anon, { action: 'set', name: 'Ryan OG' });
}

/* ================= it propagates ================= */
head('A name set in the register is the name the room uses');
{
  const said = await say(anon, 'The Geodetic works were the first ones I understood.');
  ok(said.status === 200 && said.body.message.name === 'Ryan OG',
    'a message carries the name, not the address', said.body.message && said.body.message.name);
  ok(said.body.message.url === `https://collectors.mintface.art/${'0xaaaaaaaa'}`,
    'and the name leads to their page', said.body.message && said.body.message.url);

  const small = await say(oneCopy, 'One copy, one day, and here I am.');
  ok(small.body.message.url === null,
    'a collector with no page is named without being linked ... the register shows the same restraint',
    String(small.body.message.url));

  const byArtist = await say(artist, 'Welcome in.');
  ok(byArtist.body.message.url === 'https://mintface.art/',
    'and MintFace leads to the front door, which is the only page he has',
    byArtist.body.message.url);
}

head('And renaming renames what was already said');
{
  const rename = await setName(anon, { action: 'set', name: 'Ariki' });
  ok(rename.status === 200, 'they change their mind the next day', rename.body.error);
  const now = await room();
  const first = now.body.messages.find((m) => m.address === A(anon));
  ok(first && first.name === 'Ariki',
    'and the message they left yesterday says so too',
    first && first.name);
  ok(first && first.n === 0,
    'without renumbering anything ... the log is untouched, only the reading of it changed');
  await setName(anon, { action: 'set', name: 'Ryan OG' });
}

/* ================= tagging ================= */
head('Typing @ finds people');
{
  const found = await names('q=ryan');
  ok(found.body.collectors.length >= 1 && found.body.collectors[0].name === 'Ryan OG',
    'by the name they chose', JSON.stringify(found.body.collectors.map((c) => c.name)));
  const byEns = await names('q=visco');
  ok(byEns.body.collectors.some((c) => c.address === A(visco)), 'by their .eth');
  const byAddress = await names(`q=${A(visco).slice(0, 10)}`);
  ok(byAddress.body.collectors.some((c) => c.address === A(visco)), 'by their wallet');
  const him = await names('q=mint');
  ok(him.body.collectors.some((c) => c.name === 'MintFace'),
    'and MintFace is in the list, though he is not in the register');

  // muted: quietly, which is the whole of what muting is
  await withToken(await signIn(artist), { action: 'mute', target: A(hushed) });
  await setName(hushed, { action: 'set', name: 'Loud One' })
    .then((r) => ok(r.status === 403, 'a muted wallet is not offered a name either', r.body.error));
  const quiet = await names('q=hush');
  ok(!quiet.body.collectors.some((c) => c.address === A(hushed)),
    'and a muted wallet is not autocompleted into anybody’s mouth');
}

head('A tag is a wallet, and only reads as a name');
{
  const said = await say(visco, 'Have you seen the new one, @Ryan OG? It is the best of them.');
  const m = said.body.message;
  ok(said.status === 200 && m.mentions.length === 1 && m.mentions[0].address === A(anon),
    'the wallet is what was stored', JSON.stringify(m.mentions));
  ok(m.mentions[0].len === 8 && m.text.slice(m.mentions[0].start, m.mentions[0].start + 8) === '@Ryan OG',
    'over exactly the characters that were typed, no more ... the question mark is not part of the name',
    m.text.slice(m.mentions[0].start, m.mentions[0].start + m.mentions[0].len));
  ok(m.mentions[0].url === 'https://collectors.mintface.art/0xaaaaaaaa',
    'and it links to them', m.mentions[0].url);

  const renamed = await setName(anon, { action: 'set', name: 'Ariki' });
  ok(renamed.status === 200, 'the next day they rename themselves', renamed.body.error);
  const after = await room();
  const then = after.body.messages.find((x) => (x.mentions || []).length && x.address === A(visco));
  ok(then && then.mentions[0].name === 'Ariki',
    'and the tag written yesterday says the new name today', then && then.mentions[0].name);
  ok(then && then.text.includes('@Ryan OG'),
    'while the sentence that was signed is still the sentence that was signed');
  await setName(anon, { action: 'set', name: 'Ryan OG' });
}

head('What an @ does not do');
{
  const mail = await say(visco, 'Write to me at hello@ryanog.example and I will answer.');
  ok(mail.body.message.mentions.length === 0,
    'an email address is not four tags and a surname', JSON.stringify(mail.body.message.mentions));

  const unknown = await say(visco, 'Ask @nobody-at-all about it.');
  ok(unknown.body.message.mentions.length === 0, 'an @ that lands on nobody is just an @');

  const own = await say(anon, 'Talking to myself, @Ryan OG.');
  ok(own.body.message.mentions.length === 1, 'you may write your own name');
  const mine = await room(`viewer=${A(anon)}`);
  ok(mine.body.me.mentions.unseen === 1,
    'and it does not count as being told ... only visco’s tag did',
    JSON.stringify(mine.body.me.mentions));
}

head('Being told, inside the room');
{
  const seen = await room(`viewer=${A(anon)}`);
  ok(seen.body.me.mentions.total >= 1, 'the count is there for the wallet that was named',
    JSON.stringify(seen.body.me.mentions));

  const token = await signIn(anon);
  await withToken(token, { action: 'seen' });
  const cleared = await room(`viewer=${A(anon)}`);
  ok(cleared.body.me.mentions.unseen === 0,
    'and the visit that showed it is the visit that clears it',
    JSON.stringify(cleared.body.me.mentions));

  await say(visco, 'One more for you @Ryan OG.');
  const again = await room(`viewer=${A(anon)}`);
  ok(again.body.me.mentions.unseen === 1, 'the next one counts again');

  const stranger_ = await room(`viewer=${A(visco)}`);
  ok(stranger_.body.me.mentions.unseen === 0,
    'and nobody else is told anything about it');
}

head('Tag spam runs out before the message limit does');
{
  const many = await say(visco, `@Ryan OG @visco.eth @gissie.eth @${A(oneCopy)} all at once.`);
  ok(many.status === 400 && /limit/.test(many.body.error || ''),
    'four names in one message, and Studio’s limit is three', `${many.status} ${many.body.error}`);

  let stopped = null;
  for (let i = 0; i < 6 && !stopped; i += 1) {
    const r = await say(visco, `@Ryan OG @gissie.eth number ${i}`);
    if (r.status === 429) stopped = r.body.error;
  }
  ok(stopped && /names/.test(stopped),
    'and a patient flood of two names a message runs out of names, not messages', stopped);
}

/* ================= the pure tag reader ================= */
head('A collector who sells up keeps their name on what they said');
{
  const gone = privateKeyToAccount(generatePrivateKey());
  taoFixture.wallets[gone.address.toLowerCase()] = { tao: 100 };
  registerFile.rows.push([gone.address.toLowerCase(), 'Departing', 'departing.eth',
    'departing.eth', 0, 3, 1, 100, 20, '2026-08-01', 6]);
  // the nightly half of the register is held for a minute, so a fixture that
  // moves between two requests has to say so
  forgetRegister();

  const before = await say(gone, 'Everything here has been a pleasure.');
  ok(before.body.message.name === 'Departing', 'named while they hold something',
    before.body.message && before.body.message.name);

  // and then they sell the lot, and leave the register with it
  registerFile.rows = registerFile.rows.filter((r) => r[0] !== gone.address.toLowerCase());
  forgetRegister();
  const after = await room();
  const theirs = after.body.messages.find((m) => m.address === gone.address.toLowerCase());
  ok(theirs && theirs.name === 'Departing',
    'and still named after they have gone ... the row keeps what it was written under',
    theirs && theirs.name);
  ok(theirs && theirs.url === null,
    'though there is no page left to lead to', theirs && String(theirs.url));
}

head('Longest match wins, so a name with a space in it is one name');
{
  const reg = naming(registerIndex(registerFile), { [A(anon)]: 'Ryan OG' });
  const idx = tagIndex(reg);
  const found = parseTags('cheers @Ryan OG and @Ryan, two different people', idx);
  ok(found.length === 1 && found[0].text === 'Ryan OG',
    'the longer of two readings is the one taken', JSON.stringify(found.map((f) => f.text)));
  const punctuated = parseTags('(@visco.eth) and @gissie.eth.', idx);
  ok(punctuated.length === 2 && punctuated[0].text === 'visco.eth' && punctuated[1].text === 'gissie.eth',
    'a bracket opens a tag and a full stop is not part of one',
    JSON.stringify(punctuated.map((f) => f.text)));
}

server.close();
console.log(`\n${'='.repeat(74)}`);
console.log(failed === 0 ? `All ${ran} checks pass.` : `${failed} of ${ran} checks failed.`);
process.exit(failed === 0 ? 0 : 1);
