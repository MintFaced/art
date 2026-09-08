#!/usr/bin/env node
/* THE STUDIO, ON THIS MACHINE, AGAINST NOTHING.
 *
 * Every TAO rule on this site is a comparison against what a wallet holds, and
 * the artist's wallet holds none by design ... so the branches that only run
 * for a collector with a modest balance were never being run at all. The
 * standing rule that came out of that (docs/AVS-NUDGES.md) is that a TAO-gated
 * path is walked by a limited-TAO wallet before it ships. This is where that
 * walk happens without spending anything, publishing anything, or touching the
 * register.
 *
 *   node scripts/dev/serve.mjs            ... http://localhost:3300/studio
 *   DEV_TAO=0xabc...:69000 node scripts/dev/serve.mjs
 *
 * WHAT IS REAL: the pages, the routes in api/, the arithmetic, the wallet, the
 * signature, the session, the rate limiter. You sign in with a real wallet and
 * weigh real numbers through the real route.
 *
 * WHAT IS NOT: three things, each replaced by a stub in this file rather than
 * by a credential.
 *   - THE REGISTER. `data/tao.json` is served with one wallet's balance added,
 *     computed nowhere and written to no file. The tracked file is untouched:
 *     nothing here can be committed by accident because nothing here is a
 *     change to anything.
 *   - THE REPOSITORY. Weighings commit to `.dev-store/repo/` instead of to
 *     GitHub. Seeded from the real files on first read, so the board starts
 *     where the live one is, and never written back.
 *   - THE STORE. Sessions, the live overlay and the rate limiter run against an
 *     in-process Redis in `.dev-store/kv.json` rather than Upstash. No
 *     credential of any kind is needed, and none of the site's are usable
 *     anyway: they are marked sensitive and come back as [SENSITIVE].
 *
 * Delete `.dev-store/` to start the board again from the live one.
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const PORT = Number(process.env.PORT || 3300);
const STORE = path.join(ROOT, '.dev-store');
const REPO_DIR = path.join(STORE, 'repo');
const KV_FILE = path.join(STORE, 'kv.json');
const HERE = `http://127.0.0.1:${PORT}`;

/* The wallet under test, and what it is pretending to hold. mintface.eth by
   default, because it is the wallet Ryan has in the browser ... any address
   works, and a plain collector address is the better read of the two if what
   you are checking is how a row looks in the ledger. */
const [DEV_ADDR, DEV_TAO] = String(process.env.DEV_TAO
  || '0xd40b63bf04a44e43fbfe5784bcf22acaab34a180:69000').split(':');
const testWallet = String(DEV_ADDR || '').toLowerCase();
const testTao = Math.max(0, Math.floor(Number(DEV_TAO) || 0));

/* Every route reads its config from the environment at import, so this is set
   before any of them is imported. Both stubs are this same server, one path in
   from the site itself. */
process.env.GITHUB_API_BASE = `${HERE}/__gh`;
process.env.GITHUB_TOKEN = process.env.GITHUB_TOKEN || 'dev-token-not-a-real-one';
process.env.GITHUB_REPO = process.env.GITHUB_REPO || 'MintFaced/art';
process.env.GITHUB_BRANCH = 'dev';
process.env.KV_REST_API_URL = `${HERE}/__kv`;
process.env.KV_REST_API_TOKEN = 'dev';
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

fs.mkdirSync(REPO_DIR, { recursive: true });

/* ----------------------------------------------------------------- the store
 *
 * Upstash's REST pipeline, in memory, with the two dozen commands this site
 * actually sends. Written to a file after every pipeline so a session survives
 * a restart ... signing in once an hour is a fine thing to ask of a browser and
 * a poor thing to ask of somebody testing a form.
 */
const kv = new Map();
try {
  for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(KV_FILE, 'utf8')))) kv.set(k, v);
} catch (err) { /* first run */ }
const saveKv = () => {
  try { fs.writeFileSync(KV_FILE, JSON.stringify(Object.fromEntries(kv), null, 1)); }
  catch (err) { /* a dev store that cannot be written is still a dev store */ }
};

const alive = (key) => {
  const row = kv.get(key);
  if (!row) return null;
  if (row.exp && row.exp < Date.now()) { kv.delete(key); return null; }
  return row;
};
const put = (key, type, value, exp) => { kv.set(key, { t: type, v: value, exp: exp || null }); };
const listOf = (k) => (alive(k) || { v: [] }).v;
const hashOf = (k) => (alive(k) || { v: {} }).v;
const setOf = (k) => (alive(k) || { v: [] }).v;
const zsetOf = (k) => (alive(k) || { v: [] }).v;
const slice = (len, a, b) => {
  const s = a < 0 ? Math.max(0, len + a) : Math.min(a, len);
  const e = b < 0 ? len + b : Math.min(b, len - 1);
  return [s, e];
};

function command(cmd) {
  const [rawName, ...rest] = cmd;
  const name = String(rawName).toUpperCase();
  const key = rest[0];
  switch (name) {
    case 'GET': { const r = alive(key); return r ? r.v : null; }
    case 'MGET': return rest.map((k) => { const r = alive(k); return r ? r.v : null; });
    case 'SET': {
      const opts = rest.slice(2).map((x) => String(x).toUpperCase());
      const nx = opts.includes('NX');
      if (nx && alive(key)) return null;
      const exAt = opts.indexOf('EX');
      const exp = exAt >= 0 ? Date.now() + Number(rest[2 + exAt + 1]) * 1000 : null;
      put(key, 'str', String(rest[1]), exp);
      return 'OK';
    }
    case 'DEL': { let n = 0; for (const k of rest) if (kv.delete(k)) n += 1; return n; }
    case 'INCR': case 'INCRBY': {
      const by = name === 'INCR' ? 1 : Number(rest[1]) || 0;
      const now = Number((alive(key) || { v: '0' }).v) + by;
      put(key, 'str', String(now), (kv.get(key) || {}).exp);
      return now;
    }
    case 'EXPIRE': { const r = alive(key); if (!r) return 0; r.exp = Date.now() + Number(rest[1]) * 1000; return 1; }
    case 'RPUSH': { const l = [...listOf(key), ...rest.slice(1).map(String)]; put(key, 'list', l); return l.length; }
    case 'LLEN': return listOf(key).length;
    case 'LRANGE': { const l = listOf(key); const [s, e] = slice(l.length, Number(rest[1]), Number(rest[2])); return l.slice(s, e + 1); }
    case 'LTRIM': { const l = listOf(key); const [s, e] = slice(l.length, Number(rest[1]), Number(rest[2])); put(key, 'list', l.slice(s, e + 1)); return 'OK'; }
    case 'HSET': { const h = { ...hashOf(key) }; for (let i = 1; i < rest.length; i += 2) h[rest[i]] = String(rest[i + 1]); put(key, 'hash', h); return 1; }
    case 'HSETNX': { const h = { ...hashOf(key) }; if (h[rest[1]] !== undefined) return 0; h[rest[1]] = String(rest[2]); put(key, 'hash', h); return 1; }
    case 'HGET': { const h = hashOf(key); return h[rest[1]] === undefined ? null : h[rest[1]]; }
    case 'HGETALL': { const h = hashOf(key); return Object.entries(h).flat(); }
    case 'HDEL': { const h = { ...hashOf(key) }; let n = 0; for (const f of rest.slice(1)) if (delete h[f]) n += 1; put(key, 'hash', h); return n; }
    case 'SADD': { const s = new Set(setOf(key)); const before = s.size; for (const m of rest.slice(1)) s.add(String(m)); put(key, 'set', [...s]); return s.size - before; }
    case 'SREM': { const s = new Set(setOf(key)); const before = s.size; for (const m of rest.slice(1)) s.delete(String(m)); put(key, 'set', [...s]); return before - s.size; }
    case 'SMEMBERS': return setOf(key);
    case 'SISMEMBER': return setOf(key).includes(String(rest[1])) ? 1 : 0;
    case 'ZADD': {
      const z = [...zsetOf(key)].filter((r) => r.m !== String(rest[2]));
      z.push({ s: Number(rest[1]), m: String(rest[2]) });
      z.sort((a, b) => a.s - b.s || a.m.localeCompare(b.m));
      put(key, 'zset', z);
      return 1;
    }
    case 'ZREM': { const z = zsetOf(key).filter((r) => !rest.slice(1).map(String).includes(r.m)); put(key, 'zset', z); return 1; }
    case 'ZCARD': return zsetOf(key).length;
    case 'ZRANGE': {
      const rev = rest.map((x) => String(x).toUpperCase()).includes('REV');
      const z = rev ? [...zsetOf(key)].reverse() : zsetOf(key);
      const [s, e] = slice(z.length, Number(rest[1]), Number(rest[2]));
      return z.slice(s, e + 1).map((r) => r.m);
    }
    default: throw new Error(`the dev store has no ${name}`);
  }
}

/* -------------------------------------------------------------- the repository
 *
 * GitHub's contents API, over a directory. A weighing is a commit on this site,
 * and a weighing made while testing is a commit nobody asked for ... so it
 * lands here. Seeded from the working tree the first time a path is read, so
 * the local board opens where the live one is.
 */
const ghPath = (p) => path.join(REPO_DIR, p);
const sha = (text) => `dev${Buffer.from(text).length.toString(16)}${text.length.toString(16)}`;

async function ghGet(p) {
  let text = null;
  try { text = await fsp.readFile(ghPath(p), 'utf8'); }
  catch (err) {
    try {
      text = await fsp.readFile(path.join(ROOT, p), 'utf8');
      await fsp.mkdir(path.dirname(ghPath(p)), { recursive: true });
      await fsp.writeFile(ghPath(p), text);
    } catch (err2) { return null; }
  }
  return { sha: sha(text), content: Buffer.from(text, 'utf8').toString('base64'), encoding: 'base64' };
}
async function ghPut(p, body) {
  const text = Buffer.from(String(body.content || ''), 'base64').toString('utf8');
  await fsp.mkdir(path.dirname(ghPath(p)), { recursive: true });
  await fsp.writeFile(ghPath(p), text);
  console.log(`   commit  ${p}  ${String(body.message || '').slice(0, 80)}`);
  return { content: { sha: sha(text) }, commit: { sha: sha(text) } };
}

/* ------------------------------------------------------------- the register
 *
 * One wallet's balance, added on the way out. The file on disk is not touched,
 * so there is nothing here to commit by accident and nothing to put back.
 */
async function taoWithTestWallet() {
  const raw = JSON.parse(await fsp.readFile(path.join(ROOT, 'data/tao.json'), 'utf8'));
  if (!testWallet || !testTao) return raw;
  const had = Boolean(raw.wallets[testWallet]);
  raw.wallets = { ...raw.wallets, [testWallet]: { tao: testTao, rate: 0, lost: 0, sales: 0, works: { 'dev-fixture': testTao } } };
  raw.counts = { ...raw.counts, wallets: (raw.counts.wallets || 0) + (had ? 0 : 1) };
  raw._note = `LOCAL DEV. ${testWallet} is holding ${testTao.toLocaleString('en-NZ')} TAO that does not exist. ${raw._note || ''}`;
  return raw;
}

/* ------------------------------------------------------------------ the site */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8', '.mp4': 'video/mp4', '.webm': 'video/webm' };

const rewrites = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')).rewrites || [];
/* vercel.json's rewrites, for the handful that matter locally. A static file
   always wins first, which is what cleanUrls does on the deployment. */
const rewriteFor = (pathname) => {
  for (const r of rewrites) {
    const names = [];
    const rx = new RegExp('^' + r.source.replace(/:[a-zA-Z]+\*?/g, (m) => { names.push(m.slice(1)); return '([^/]+)'; }) + '$');
    const m = rx.exec(pathname);
    if (m) return { to: r.destination.replace(/:[a-zA-Z]+/g, (n) => m[names.indexOf(n.slice(1)) + 1] || ''), params: names.map((n, i) => [n, m[i + 1]]) };
  }
  return null;
};

const staticFile = async (pathname) => {
  const tries = [pathname, `${pathname}.html`, path.join(pathname, 'index.html')];
  for (const t of tries) {
    const file = path.join(ROOT, t);
    if (!file.startsWith(ROOT)) continue;
    try { const s = await fsp.stat(file); if (s.isFile()) return file; } catch (err) { /* next */ }
  }
  return null;
};

/* A Node request, as a route sees it, and a route's answer, as Node sends it.
   The routes are plain Request in, Response out ... which is the whole reason
   this file can be short. */
async function runRoute(name, req, url, body) {
  const mod = await import(path.join(ROOT, 'api', `${name}.js`));
  const fn = mod[req.method] || (req.method === 'HEAD' ? mod.GET : null);
  if (!fn) return new Response('method not allowed', { status: 405 });
  const request = new Request(`${HERE}${url.pathname}${url.search}`, {
    method: req.method,
    headers: Object.entries(req.headers).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]),
    ...(body && body.length ? { body } : {}),
  });
  return fn(request);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, HERE);
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const send = (status, headers, payload) => { res.writeHead(status, headers); res.end(payload); };

  try {
    /* the store */
    if (url.pathname === '/__kv/pipeline') {
      const cmds = JSON.parse(body.toString('utf8') || '[]');
      const out = cmds.map((c) => { try { return { result: command(c) }; } catch (e) { return { error: e.message }; } });
      saveKv();
      return send(200, { 'content-type': 'application/json' }, JSON.stringify(out));
    }
    /* the repository */
    if (url.pathname.startsWith('/__gh/repos/')) {
      const p = decodeURIComponent(url.pathname.split('/contents/')[1] || '');
      if (req.method === 'GET') {
        const got = await ghGet(p);
        return got ? send(200, { 'content-type': 'application/json' }, JSON.stringify(got))
          : send(404, { 'content-type': 'application/json' }, '{"message":"Not Found"}');
      }
      if (req.method === 'PUT') {
        const out = await ghPut(p, JSON.parse(body.toString('utf8') || '{}'));
        return send(200, { 'content-type': 'application/json' }, JSON.stringify(out));
      }
    }
    /* the register, with the wallet under test in it */
    if (url.pathname === '/data/tao.json') {
      return send(200, { 'content-type': 'application/json', 'cache-control': 'no-store' },
        JSON.stringify(await taoWithTestWallet()));
    }

    /* the site: a file if there is one, then the rewrites, then the routes */
    const file = await staticFile(url.pathname === '/' ? '/index' : url.pathname);
    if (file) {
      const type = TYPES[path.extname(file)] || 'application/octet-stream';
      return send(200, { 'content-type': type, 'cache-control': 'no-store' }, await fsp.readFile(file));
    }
    let route = url.pathname.startsWith('/api/') ? url.pathname.slice(5) : null;
    if (!route) {
      const rw = rewriteFor(url.pathname);
      if (rw && rw.to.startsWith('/api/')) {
        route = rw.to.slice(5);
        for (const [k, v] of rw.params) url.searchParams.set(k, v);
      } else if (rw) {
        const f2 = await staticFile(rw.to);
        if (f2) return send(200, { 'content-type': TYPES[path.extname(f2)] || 'text/html; charset=utf-8' }, await fsp.readFile(f2));
      }
    }
    if (route) {
      const out = await runRoute(route.split('/')[0], req, url, body);
      const headers = {};
      for (const [k, v] of out.headers) headers[k] = v;
      const cookies = typeof out.headers.getSetCookie === 'function' ? out.headers.getSetCookie() : [];
      /* Secure cookies are allowed on localhost by every browser that matters,
         so the session works here exactly as it does on the site. */
      if (cookies.length) headers['set-cookie'] = cookies;
      return send(out.status, headers, Buffer.from(await out.arrayBuffer()));
    }
    return send(404, { 'content-type': 'text/plain' }, 'not here');
  } catch (err) {
    console.error(`   ${req.method} ${url.pathname}`, err);
    return send(500, { 'content-type': 'text/plain' }, String(err && err.stack || err));
  }
});

server.listen(PORT, () => {
  console.log(`\n  The studio, locally ....... http://localhost:${PORT}/studio`);
  console.log(`  Holding ${testTao.toLocaleString('en-NZ')} TAO ... ${testWallet}`);
  console.log(`  Weighings commit to ....... .dev-store/repo/data/nudge-weighings.json`);
  console.log(`  Sessions and the overlay .. .dev-store/kv.json`);
  console.log(`  The register on disk ...... untouched\n`);
});
