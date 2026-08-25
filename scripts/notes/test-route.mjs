#!/usr/bin/env node
/* The route itself, end to end, on this machine.
 *
 * test-notes.mjs proves the rules. This proves the wiring: a real key signs the
 * real sentence, api/notes.js verifies it with viem, decides standing against a
 * real work record out of data/c, writes through the real store code, and the
 * page reads it back. The only stand-ins are Redis and two config files, both
 * served from a local origin the handler is pointed at.
 *
 * The point of it is the sentence. The browser builds that string and the
 * server rebuilds it, and if they ever drift by a comma every signature on the
 * site stops verifying with no other symptom.
 *
 *   node scripts/notes/test-route.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';

const ROOT = path.resolve(import.meta.dirname, '../..');

/* ---------- a small Redis over Upstash's REST shape ---------- */
const str = new Map();
const z = new Map();
const zset = (k) => { if (!z.has(k)) z.set(k, new Map()); return z.get(k); };
const sorted = (k) => [...zset(k).entries()].sort((a, b) => a[1] - b[1] || String(a[0]).localeCompare(String(b[0])));
const redis = ([cmd, ...a]) => {
  switch (String(cmd).toUpperCase()) {
    case 'SET': str.set(a[0], a[1]); return 'OK';
    case 'GET': return str.has(a[0]) ? str.get(a[0]) : null;
    case 'MGET': return a.map((k) => (str.has(k) ? str.get(k) : null));
    case 'DEL': return str.delete(a[0]) ? 1 : 0;
    case 'INCR': { const v = (Number(str.get(a[0])) || 0) + 1; str.set(a[0], String(v)); return v; }
    case 'EXPIRE': return 1;
    case 'ZADD': zset(a[0]).set(a[2], Number(a[1])); return 1;
    case 'ZREM': return zset(a[0]).delete(a[1]) ? 1 : 0;
    case 'ZCARD': return zset(a[0]).size;
    case 'ZRANGE': {
      const rows = sorted(a[0]).map(([m]) => m);
      const list = a.includes('REV') ? rows.slice().reverse() : rows;
      let [s0, s1] = [Number(a[1]), Number(a[2])];
      if (s0 < 0) s0 = list.length + s0;
      if (s1 < 0) s1 = list.length + s1;
      return list.slice(s0, s1 + 1);
    }
    case 'ZREMRANGEBYRANK': return 0;
    default: throw new Error(`no ${cmd}`);
  }
};

/* ---------- the cast, and a work that really exists ---------- */
const artistKey = generatePrivateKey();
const seniorKey = generatePrivateKey();
const smallKey = generatePrivateKey();
const artist = privateKeyToAccount(artistKey);
const senior = privateKeyToAccount(seniorKey);
const small = privateKeyToAccount(smallKey);

const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/index.json'), 'utf8'));
const WORK = 'geodetic-moments-1';
const slug = index.work_index[WORK];
if (!slug) { console.error(`${WORK} is not in the catalogue`); process.exit(1); }

const notesCfg = {
  version: 2,
  senior_tao: 69000, max_chars: 500, per_wallet_per_day: 20, fold_after: 3, index_keep: 200,
};
const artistFixture = { wallets: { [artist.address.toLowerCase()]: 'mintface.eth' } };
const taoFixture = {
  generated: new Date().toISOString(), rates: {}, counts: {},
  wallets: {
    [senior.address.toLowerCase()]: { tao: 210000, rate: 69, lost: 0, sales: 0, works: {} },
    [small.address.toLowerCase()]: { tao: 4200, rate: 4.2, lost: 0, sales: 0, works: {} },
  },
};

/* ---------- one origin serving the site's data and the stand-in store ---------- */
const body = (req) => new Promise((res) => { let b = ''; req.on('data', (d) => { b += d; }).on('end', () => res(b)); });
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

  if (u.pathname === '/pipeline' && req.method === 'POST') {
    const cmds = JSON.parse(await body(req));
    try { return send(200, cmds.map((c) => ({ result: redis(c) }))); }
    catch (e) { return send(200, [{ error: String(e.message) }]); }
  }
  if (u.pathname === '/data/source/notes.json') return send(200, notesCfg);
  if (u.pathname === '/data/source/artist.json') return send(200, artistFixture);
  if (u.pathname === '/data/tao.json') return send(200, taoFixture);
  if (u.pathname === '/data/collectors.json') return send(200, { collectors: [] });

  const file = path.join(ROOT, u.pathname.replace(/^\/+/, ''));
  if (u.pathname.startsWith('/data/') && fs.existsSync(file)) {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(fs.readFileSync(file));
  }
  res.writeHead(404); res.end('no');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

process.env.KV_REST_API_URL = ORIGIN;
process.env.KV_REST_API_TOKEN = 'test';
// the chain is not part of this test; the catalogue answers instead, which is
// the fallback the route is written to take
process.env.ETH_RPC = `${ORIGIN}/no-rpc-here`;

const { GET, POST } = await import('../../api/notes.js');
const { noteMessage } = await import('../../api/_lib/notes.js');

let failed = 0, ran = 0;
const ok = (cond, label, detail) => {
  ran++;
  if (!cond) failed++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n          ${detail}` : ''}`);
};
const head = (t) => console.log(`\n${t}\n${'='.repeat(74)}`);

const get = async (qs) => {
  const r = await GET(new Request(`${ORIGIN}/api/notes?${qs}`));
  return { status: r.status, body: await r.json() };
};
/** Sign exactly the way the work page does, then post it. */
const post = async (account, payload) => {
  const issued = new Date().toISOString();
  const address = account.address.toLowerCase();
  const message = noteMessage({ ...payload, address, issued });
  const signature = await account.signMessage({ message });
  const r = await POST(new Request(`${ORIGIN}/api/notes`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...payload, address, issued, signature }),
  }));
  return { status: r.status, body: await r.json() };
};

head(`The route, against ${WORK} out of data/c/${slug}.json`);
{
  const empty = await get(`work=${WORK}`);
  ok(empty.status === 200 && empty.body.store === true && empty.body.notes.length === 0,
    'an unwritten work answers with an empty layer', `${empty.status}, ${empty.body.notes.length} notes`);

  const a = await post(artist, { action: 'write', work: WORK, text: 'Drawn from a survey peg above the harbour.', visibility: 'public' });
  ok(a.status === 200 && a.body.ok, 'the artist signs and the note lands', a.body.error || `id ${a.body.id}`);
  ok(a.body.notes[0] && a.body.notes[0].label === "Artist's note", 'labelled as the artist\'s');

  const s = await post(senior, { action: 'write', work: WORK, text: 'The one that made me look at the rest.', visibility: 'public' });
  ok(s.status === 200 && s.body.ok, 'a wallet with 210,000 TAO may write on it too', s.body.error);
  const seniorNote = (s.body.notes || []).find((x) => x.address === senior.address.toLowerCase());
  ok(seniorNote && seniorNote.tao === 210000, 'and their TAO at posting is carried', seniorNote && String(seniorNote.tao));

  const n = await post(small, { action: 'write', work: WORK, text: 'Nice.', visibility: 'public' });
  ok(n.status === 403 && /69,000/.test(n.body.error || ''), 'a wallet with 4,200 TAO is refused, and told why',
    `${n.status} ${n.body.error}`);

  const priv = await post(senior, { action: 'write', work: WORK, text: 'Quietly.', visibility: 'private' });
  ok(priv.status === 400, 'a senior collector may not write privately', `${priv.status} ${priv.body.error}`);
}

head('The signature is the whole authorisation');
{
  const issued = new Date().toISOString();
  const address = senior.address.toLowerCase();
  // signed for one text, submitted with another
  const signature = await senior.signMessage({
    message: noteMessage({ action: 'write', work: WORK, text: 'What I signed.', visibility: 'public', address, issued }),
  });
  const r = await POST(new Request(`${ORIGIN}/api/notes`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'write', work: WORK, text: 'What I sent.', visibility: 'public', address, issued, signature }),
  }));
  ok(r.status === 401, 'changing the words after signing is refused', `${r.status} ${(await r.json()).error}`);

  const stale = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  const sig2 = await senior.signMessage({
    message: noteMessage({ action: 'write', work: WORK, text: 'Old.', visibility: 'public', address, issued: stale }),
  });
  const r2 = await POST(new Request(`${ORIGIN}/api/notes`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'write', work: WORK, text: 'Old.', visibility: 'public', address, issued: stale, signature: sig2 }),
  }));
  const b2 = await r2.json();
  ok(r2.status === 400 && /stale/.test(b2.error || ''), 'a signature twenty minutes old is refused', `${r2.status} ${b2.error}`);

  const wrong = await post(small, { action: 'write', work: 'not-a-work-at-all', text: 'Hello.', visibility: 'public' });
  ok(wrong.status === 404, 'a note on a work that does not exist is refused', String(wrong.status));
}

head('Editing, hiding, deleting, and who may');
{
  const mine = (await get(`work=${WORK}`)).body.notes.find((x) => x.kind === 'artist');
  const edit = await post(artist, { action: 'edit', id: mine.id, work: WORK, text: 'Drawn from a survey peg above the harbour, in the rain.' });
  ok(edit.status === 200, 'the author edits their own', edit.body.error);
  const after = (await get(`work=${WORK}`)).body.notes.find((x) => x.id === mine.id);
  ok(after && after.edited === true && /rain/.test(after.text), 'and it shows as edited');

  const notMine = await post(senior, { action: 'edit', id: mine.id, work: WORK, text: 'Actually...' });
  ok(notMine.status === 403, 'somebody else cannot edit it', `${notMine.status} ${notMine.body.error}`);

  const target = (await get(`work=${WORK}`)).body.notes.find((x) => x.address === senior.address.toLowerCase());
  const notArtist = await post(senior, { action: 'hide', id: target.id, work: WORK });
  ok(notArtist.status === 403, 'only the artist may hide', `${notArtist.status} ${notArtist.body.error}`);

  const hid = await post(artist, { action: 'hide', id: target.id, work: WORK });
  ok(hid.status === 200 && hid.body.hidden === true, 'the artist hides it', hid.body.error);
  const seen = await get(`work=${WORK}`);
  ok(!seen.body.notes.some((x) => x.id === target.id), 'and it is gone from the page');
  const stream = await get('recent=50');
  ok(!stream.body.notes.some((x) => x.id === target.id), 'and out of the stream');
  await post(artist, { action: 'show', id: target.id, work: WORK });

  const gone = await post(senior, { action: 'delete', id: target.id, work: WORK });
  ok(gone.status === 200, 'the author deletes their own', gone.body.error);
  ok(!(await get(`work=${WORK}`)).body.notes.some((x) => x.id === target.id), 'and it is gone for good');
}

head('What the page is told before it offers a form');
{
  const asSmall = await get(`work=${WORK}&viewer=${small.address.toLowerCase()}`);
  ok(asSmall.body.me && asSmall.body.me.can_write === false && /69,000/.test(asSmall.body.me.why),
    'a wallet below the line is told so before it signs anything', asSmall.body.me && asSmall.body.me.why);
  const asSenior = await get(`work=${WORK}&viewer=${senior.address.toLowerCase()}`);
  ok(asSenior.body.me && asSenior.body.me.can_write === true && asSenior.body.me.can_be_private === false,
    'a senior collector is offered a form, without the private toggle');
  const anon = await get(`work=${WORK}`);
  ok(anon.body.me === null, 'and a page with no wallet is told nothing about anyone');
}

head("A collector's own line");
{
  const line = await get(`address=${artist.address.toLowerCase()}`);
  ok(line.body.count === 1 && line.body.notes[0].work === WORK,
    'the count and the works behind it', `${line.body.count} notes`);
}

server.close();
console.log(`\n${'='.repeat(74)}`);
console.log(failed === 0 ? `All ${ran} checks pass.` : `${failed} of ${ran} checks failed.`);
process.exit(failed === 0 ? 0 : 1);
