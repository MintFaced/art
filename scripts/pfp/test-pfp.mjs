#!/usr/bin/env node
/* Faces (PFP.md): the picture service against the real routes, with the store
 * in memory, R2 caught at the door, and OpenSea, ENS and X answering from here.
 *
 *   node scripts/pfp/test-pfp.mjs
 */
import { readFileSync, existsSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
let pass = 0, fail = 0;
const is = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label.padEnd(70) + (ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`));
  ok ? pass++ : fail++;
};

/* ---- the world, in memory ---- */
Object.assign(process.env, {
  KV_REST_API_URL: 'http://kv.fake', KV_REST_API_TOKEN: 'fake',
  R2_ACCOUNT_ID: 'acct', R2_BUCKET: 'bucket', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's',
  STUDIO_SECRET: 'test-secret', OPENSEA_API_KEY: 'os-key', STUDIO_PASSWORD: 'pw', STUDIO_PATH: 'mintwork',
});
delete process.env.SITE_ORIGIN;
delete process.env.ASSETS_PUBLIC_BASE;
const KV = new Map();
function kv([cmd, ...a]) {
  const C = cmd.toUpperCase(); const g = (k) => KV.get(k);
  switch (C) {
    case 'GET': { const v = g(a[0]); return typeof v === 'string' ? v : null; }
    case 'SET': if (a.includes('NX') && KV.has(a[0])) return null; KV.set(a[0], a[1]); return 'OK';
    case 'DEL': a.forEach((k) => KV.delete(k)); return 1;
    case 'EXPIRE': return 1;
    case 'INCR': { const v = Number(g(a[0]) || 0) + 1; KV.set(a[0], String(v)); return v; }
    case 'EXISTS': return KV.has(a[0]) ? 1 : 0;
    case 'SADD': { const s = g(a[0]) || new Set(); a.slice(1).forEach((x) => s.add(x)); KV.set(a[0], s); return 1; }
    case 'SREM': { const s = g(a[0]); if (s) a.slice(1).forEach((x) => s.delete(x)); return 1; }
    case 'SCARD': { const s = g(a[0]); return s ? s.size : 0; }
    case 'SMEMBERS': { const s = g(a[0]); return s ? [...s] : []; }
    case 'HGET': { const h = g(a[0]); return h && h.has(a[1]) ? h.get(a[1]) : null; }
    case 'HSET': { const h = g(a[0]) || new Map(); for (let i = 1; i < a.length; i += 2) h.set(a[i], a[i + 1]); KV.set(a[0], h); return 1; }
    case 'HDEL': { const h = g(a[0]); if (h) a.slice(1).forEach((x) => h.delete(x)); return 1; }
    case 'HLEN': { const h = g(a[0]); return h ? h.size : 0; }
    case 'HGETALL': { const h = g(a[0]); return h ? [...h].flat() : []; }
    case 'TTL': return 60;
    default: throw new Error(`fake kv: ${C}`);
  }
}

const sharp = (await import('sharp')).default;
const png = (colour, w = 400, h = 400) => sharp({ create: { width: w, height: h, channels: 3, background: colour } }).png().toBuffer();
/* Half red, half blue, so a crop can be checked by what colour it came out. */
const halves = await sharp({ create: { width: 400, height: 200, channels: 3, background: '#ff0000' } })
  .composite([{ input: await png('#0000ff', 200, 200), left: 200, top: 0 }]).jpeg().toBuffer();

const PUT = new Map();
const PICS = new Map([
  /* OpenSea's image host answers in AVIF whatever it is asked for. */
  ['https://pics.example/os-visco.png', await sharp({ create: { width: 300, height: 300, channels: 3, background: '#11aa44' } }).avif().toBuffer()],
  ['https://pics.example/anim.gif', await sharp({ create: { width: 200, height: 200, channels: 3, background: '#aa7711' } }).gif().toBuffer()],
  ['https://pics.example/os-visco-2.png', await png('#22bb55')],
  ['https://pics.example/ens-b.png', await png('#aa1144')],
  ['https://pbs.example/x-c.jpg', await png('#4411aa')],
]);
const OPENSEA = new Map();                         // address -> { status, url }
const ASKED = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url.startsWith('http://kv.fake')) return new Response(JSON.stringify(JSON.parse(init.body).map((c) => ({ result: kv(c) }))));
  if (url.startsWith('http://localhost:3000/')) {
    const file = new URL(new URL(url).pathname.slice(1), ROOT);
    return existsSync(file) ? new Response(readFileSync(file)) : new Response('no', { status: 404 });
  }
  if (/r2\.cloudflarestorage\.com/.test(url)) {
    if ((init.method || 'GET') === 'PUT') {
      const key = decodeURIComponent(new URL(url).pathname.split('/').slice(2).join('/'));
      PUT.set(key, Buffer.from(init.body instanceof Uint8Array ? init.body : await new Response(init.body).arrayBuffer()));
    }
    return new Response('', { status: 200 });
  }
  if (url.startsWith('https://assets.mintface.art/')) {
    const b = PUT.get(url.slice('https://assets.mintface.art/'.length));
    return b ? new Response(b) : new Response('no', { status: 404 });
  }
  if (url.startsWith('https://api.opensea.io/api/v2/accounts/')) {
    const a = url.split('/').pop();
    ASKED.push(a);
    const o = OPENSEA.get(a) || { status: 404 };
    return new Response(JSON.stringify(o.url !== undefined ? { address: a, profile_image_url: o.url } : { errors: ['no'] }), { status: o.status || 200 });
  }
  if (PICS.has(url)) return new Response(PICS.get(url));
  if (/publicnode|llamarpc/.test(url)) return new Response('no', { status: 503 });
  return realFetch(input, init);
};

const route = await import('../../api/pfp.js');
const P = await import('../../api/_lib/pfp.js');
const { chatStore } = await import('../../api/_lib/chat.js');
const { pipe } = await import('../../api/_lib/kv.js');
const { issueSession } = await import('../../api/_lib/studio.js');
const { hasMetadata } = await import('../../api/_lib/images.js');

const reg = JSON.parse(readFileSync(new URL('data/collectors-register.json', ROOT), 'utf8'));
const f = (k) => reg.fields.indexOf(k);
const byRank = reg.rows.slice().sort((x, y) => x[f('rank')] - y[f('rank')]);
const [VISCO, B, C, D] = byRank.slice(0, 4).map((r) => r[f('address')]);
const cfg = JSON.parse(readFileSync(new URL('data/source/chat.json', ROOT), 'utf8'));
const db = chatStore(pipe, cfg);
await db.openSession('a'.repeat(64), VISCO, 3600);
await db.openSession('b'.repeat(64), B, 3600);
const ARTIST = issueSession();

const call = async (payload, { as = null, artist = false, file = null } = {}) => {
  const headers = {};
  const cookies = [];
  if (as) cookies.push(`mf_room=${as}`);
  if (artist) cookies.push(`mf_studio=${ARTIST}`);
  if (cookies.length) headers.cookie = cookies.join('; ');
  let body;
  if (file) {
    const form = new FormData();
    form.set('payload', JSON.stringify(payload));
    form.set('image', new Blob([file.bytes], { type: file.type }), file.name);
    body = form;
  } else { headers['content-type'] = 'application/json'; body = JSON.stringify(payload); }
  const r = await route.POST(new Request('http://localhost:3000/api/pfp', { method: 'POST', headers, body }));
  return { status: r.status, body: await r.json() };
};
const get = async (q) => {
  const r = await route.GET(new Request(`http://localhost:3000/api/pfp?${q}`));
  return { status: r.status, body: await r.json() };
};
const colourOf = async (buf) => {
  const s = await sharp(buf).stats();
  const [r, g, b] = s.channels.map((c) => Math.round(c.mean));
  return r > b ? 'red' : 'blue';
};
const ME = 'a'.repeat(64);
const jpg = readFileSync(new URL('scripts/chat/fixtures/phone.jpg', ROOT));
const heic = readFileSync(new URL('scripts/chat/fixtures/phone.heic', ROOT));

console.log('\n— who may change a face —');
const anon = await call({ action: 'remove' });
is('without a session: 401, and asked to sign in', [anon.status, anon.body.signin], [401, true]);
const theirs = await call({ action: 'remove', address: B }, { as: ME });
is('signed in, somebody else\'s: 403', theirs.status, 403);

console.log('\n— an upload from a phone —');
is('the fixture really does carry GPS and a rotation', await hasMetadata(jpg), true);
const st = await call({ action: 'stage' }, { as: ME, file: { bytes: jpg, type: 'image/jpeg', name: 'IMG_0001.JPG' } });
is('staged: a tmp id, a JPEG to crop over, its size', [st.status, /^[0-9a-f]{18}$/.test(st.body.tmp), /\/pfp\/tmp\/[0-9a-f]+\.jpg$/.test(st.body.url), st.body.w > 0], [200, true, true, true]);
const tmpKey = st.body.url.split('assets.mintface.art/')[1];
is('what was staged has no metadata left in it', await hasMetadata(PUT.get(tmpKey)), false);
const sv = await call({ action: 'save', tmp: st.body.tmp, crop: { cx: 0.5, cy: 0.5, zoom: 1.4 } }, { as: ME });
is('saved as an upload, by themselves', [sv.status, sv.body.pfp.source], [200, 'upload']);
const key = sv.body.pfp.url.split('assets.mintface.art/')[1];
const kept = await sharp(PUT.get(key)).metadata();
is('kept as a 512 webp', [kept.format, kept.width, kept.height], ['webp', 512, 512]);
is('with no EXIF in it', [Boolean(kept.exif), await hasMetadata(PUT.get(key))], [false, false]);
const smallMeta = await sharp(PUT.get(P.smallOf(key))).metadata();
is('and a 128 copy beside it for the small sizes', [smallMeta.width, sv.body.pfp.small.endsWith('-128.webp')], [128, true]);
is('the record says who uploaded it', JSON.parse(KV.get(`pfp:${VISCO}`)).uploaded_by, 'self');
const again = await call({ action: 'save', tmp: st.body.tmp }, { as: ME });
is('a staged picture is used once', again.status, 410);

const hs = await call({ action: 'stage' }, { as: ME, file: { bytes: heic, type: 'image/heic', name: 'IMG_0002.HEIC' } });
is('a HEIC off an iPhone stages as a JPEG', [hs.status, hs.body.url.endsWith('.jpg')], [200, true]);
is('with nothing of the phone left in it', await hasMetadata(PUT.get(hs.body.url.split('assets.mintface.art/')[1])), false);

console.log('\n— the crop is where it was put —');
const hv = await call({ action: 'stage' }, { as: ME, file: { bytes: halves, type: 'image/jpeg', name: 'halves.jpg' } });
const left = await call({ action: 'save', tmp: hv.body.tmp, crop: { cx: 0.1, cy: 0.5, zoom: 1 } }, { as: ME });
is('a crop to the left is the red half', await colourOf(PUT.get(left.body.pfp.url.split('assets.mintface.art/')[1])), 'red');
const hv2 = await call({ action: 'stage' }, { as: ME, file: { bytes: halves, type: 'image/jpeg', name: 'halves.jpg' } });
const right = await call({ action: 'save', tmp: hv2.body.tmp, crop: { cx: 0.9, cy: 0.5, zoom: 1 } }, { as: ME });
is('a crop to the right is the blue half', await colourOf(PUT.get(right.body.pfp.url.split('assets.mintface.art/')[1])), 'blue');
is('a new picture is a new key, so no cache serves the old one', left.body.pfp.url !== right.body.pfp.url, true);

console.log('\n— the artist —');
const noWho = await call({ action: 'remove' }, { artist: true });
is('the console without an address is somebody changing their own: sign in', noWho.status, 401);
const ah = await call({ action: 'stage', address: C }, { artist: true, file: { bytes: jpg, type: 'image/jpeg', name: 'c.jpg' } });
const as = await call({ action: 'save', address: C, tmp: ah.body.tmp }, { artist: true });
is('can set a top collector\'s picture', [as.status, as.body.pfp.source], [200, 'upload']);
is('recorded as the artist\'s, and not said in public', [JSON.parse(KV.get(`pfp:${C}`)).uploaded_by, 'uploaded_by' in (await get(`address=${C}`)).body], ['artist', false]);
await db.openSession('c'.repeat(64), C, 3600);
const ch = await call({ action: 'stage' }, { as: 'c'.repeat(64), file: { bytes: halves, type: 'image/jpeg', name: 'mine.jpg' } });
await call({ action: 'save', tmp: ch.body.tmp }, { as: 'c'.repeat(64) });
is('and the collector\'s own later upload replaces it', JSON.parse(KV.get(`pfp:${C}`)).uploaded_by, 'self');
const lost = await call({ action: 'save', tmp: st.body.tmp, address: C }, { artist: true });
is('nobody can save somebody else\'s staged picture', lost.status, 410);

console.log('\n— MintFace is one face —');
const MINTFACE = '0xd40b63bf04a44e43fbfe5784bcf22acaab34a180';
const RYANJ = '0xdd6b80649e8d472eb8fb52eb7eecfd2dc219ace7';
await db.openSession('r'.repeat(64), RYANJ, 3600);
const rs = await call({ action: 'stage' }, { as: 'r'.repeat(64), artist: true, file: { bytes: jpg, type: 'image/jpeg', name: 'mf.jpg' } });
const rv = await call({ action: 'save', tmp: rs.body.tmp }, { as: 'r'.repeat(64), artist: true });
is('Ryan on ryanj.eth, console cookie and all, changes his own face', [rs.status, rv.status], [200, 200]);
is('kept once, under mintface.eth', [rv.body.pfp.address, KV.has(`pfp:${RYANJ}`), JSON.parse(KV.get(`pfp:${MINTFACE}`)).source], [MINTFACE, false, 'upload']);
const viaR = await get(`address=${RYANJ}`);
is('and ryanj.eth is drawn with it', viaR.body.url, rv.body.pfp.url);
const allA = await get('all=1');
is('the register\'s map names the one face for every artist wallet', [allA.body.alias[RYANJ], Boolean(allA.body.map[MINTFACE])], [MINTFACE, true]);

console.log('\n— sources —');
OPENSEA.set(VISCO, { url: 'https://pics.example/os-visco.png' });
/* B's name: the register's own where it has one, which the round hands over
   rather than asking the chain again. */
const B_ENS = byRank[1][f('ens')] || byRank[1][f('fwd')] || 'b-collector.eth';
P.useChain({ getEnsName: async ({ address }) => (address === B ? B_ENS : null),
  getEnsAvatar: async ({ name }) => (name === B_ENS ? 'https://pics.example/ens-b.png' : null) });
KV.set('acct:bywallet', new Map([[D, 'acct-d'], [VISCO, 'acct-v'], [B, 'acct-d']]));
KV.set('acct:acct-d', new Map([['x_id', '1'], ['x_handle', 'dee'], ['x_avatar', 'https://pbs.example/x-c_normal.jpg'], ['created', '1']]));
KV.set('acct:acct-v', new Map([['x_id', '2'], ['x_handle', 'visco'], ['x_avatar', 'https://pbs.example/x-c_normal.jpg'], ['created', '1']]));
PICS.set('https://pbs.example/x-c.jpg', await png('#4411aa'));
const ux = await call({ action: 'use', source: 'x' }, { as: ME });
is('USE X after an upload switches the source', [ux.status, ux.body.pfp.source], [200, 'x']);
is('asking for the full-size X picture, not the 48px one', JSON.parse(KV.get(`pfp:${VISCO}`)).src_url, 'https://pbs.example/x-c.jpg');
const noEns = await call({ action: 'use', source: 'ens' }, { as: ME });
is('USE ENS with no ENS picture says so', [noEns.status, /No ENS picture/.test(noEns.body.error)], [404, true]);
const rm = await call({ action: 'remove' }, { as: ME });
is('REMOVE: back to the placeholder, source none', [rm.body.pfp.source, rm.body.pfp.url], ['none', null]);
is('and out of the map the register reads', (await get('all=1')).body.map[VISCO], undefined);

console.log('\n— the backfill, from rank 1 —');
/* Everybody but the three set by hand above starts empty. */
const rows = byRank.slice(0, 8).map((r) => ({ address: r[f('address')], ens: r[f('ens')] || null, fwd: r[f('fwd')] || null, private: false, rank: r[f('rank')] }));
const E = rows[4].address, F = rows[5].address, G = rows[6].address, H = rows[7].address;
rows[6].private = true;                                           // G is private
KV.delete(`pfp:${B}`); KV.delete(`pfp:${D}`);
OPENSEA.set(B, { url: 'https://static.opensea.io/opensea-static/opensea-profile/12.png' });   // a default: not a picture
OPENSEA.set(D, { status: 404 });
OPENSEA.set(E, { status: 429 });
let out = await P.round({ rows, batch: 8, pause: 0 });
is('rank 1 chose none, and is left alone', JSON.parse(KV.get(`pfp:${VISCO}`)).source, 'none');
is('an OpenSea default avatar falls through to ENS', JSON.parse(KV.get(`pfp:${B}`)).source, 'ens');
is('no OpenSea, no ENS, a linked X: X', JSON.parse(KV.get(`pfp:${D}`)).source, 'x');
is('OpenSea saying slow down stops the batch at that collector', [out.cursor, KV.has(`pfp:${E}`)], [4, false]);
is('hits are counted by source', [out.hits.ens, out.hits.x, out.hits.rate_limited], [1, 1, 1]);
OPENSEA.set(E, { status: 404 });
out = await P.round({ rows, batch: 8, pause: 0 });
is('the next run picks up from them', JSON.parse(KV.get(`pfp:${E}`)).source, 'none');
is('a private collector is never looked up', [KV.has(`pfp:${G}`), ASKED.includes(G)], [false, false]);
is('the round goes idle with a refresh a month out', [out.phase, Math.round((Date.parse(out.next_refresh) - Date.now()) / 86400000)], ['idle', 30]);
is('the upload by the collector at rank 3 was not touched', JSON.parse(KV.get(`pfp:${C}`)).source, 'upload');
const idle = await P.round({ rows, batch: 8, pause: 0 });
is('idle means nothing is asked', idle.did, 0);
const late = await P.round({ rows, batch: 8, pause: 0, now: Date.now() + 90 * 86400000, budget: -1 });
is('a batch out of time stops where it is and keeps its place', [late.phase, late.cursor, late.did], ['refresh', 0, 0]);
KV.set('pfp:job', JSON.stringify({ ...late, phase: 'idle', cursor: 0, next_refresh: new Date(Date.now() + 30 * 86400000).toISOString() }));

{
  const avif = await P.render(PICS.get('https://pics.example/os-visco.png'));
  const gif = await P.render(PICS.get('https://pics.example/anim.gif'));
  is('an AVIF or a GIF from a source renders to a face', [Boolean(avif.bytes), Boolean(gif.bytes)], [true, true]);
  const { processImage } = await import('../../api/_lib/images.js');
  is('while the Studio still takes only its four kinds', Boolean((await processImage(PICS.get('https://pics.example/os-visco.png'))).error), true);
}

console.log('\n— the monthly refresh —');
OPENSEA.set(VISCO, { url: 'https://pics.example/os-visco-2.png' });
OPENSEA.set(B, { url: 'https://pics.example/os-visco-2.png' });
const bx = await call({ action: 'use', source: 'x' }, { as: 'b'.repeat(64) });   // B picks X over their ENS
is('(B picked X)', bx.body.pfp && bx.body.pfp.source, 'x');
OPENSEA.set(E, { url: 'https://pics.example/os-visco.png' });
const beforeD = KV.get(`pfp:${D}`);
const month = Date.now() + 31 * 86400000;
out = await P.round({ rows, batch: 8, pause: 0, now: month });
is('REMOVE survives the refresh', JSON.parse(KV.get(`pfp:${VISCO}`)).source, 'none');
is('a source somebody picked is kept, though OpenSea comes first', JSON.parse(KV.get(`pfp:${B}`)).source, 'x');
is('an upload is never overwritten', JSON.parse(KV.get(`pfp:${C}`)).source, 'upload');
is('an unchanged source is not fetched again', KV.get(`pfp:${D}`), beforeD);
is('somebody with nothing who has since set an OpenSea picture gets it (AVIF)', JSON.parse(KV.get(`pfp:${E}`)).source, 'opensea');
is('and nothing was unreadable', out.hits.unreadable || 0, 0);
{
  /* A round from before AVIF was read starts again from rank 1. */
  KV.set('pfp:job', JSON.stringify({ phase: 'backfill', cursor: 80, hits: { unreadable: 55 } }));
  const again = await P.round({ rows, batch: 8, pause: 0 });
  is('a round from an older version goes round again from rank 1', [again.v, again.phase, again.hits.unreadable || 0], [P.ROUND_V, 'idle', 0]);
}

console.log('\n— reading —');
const all = await get('all=1');
is('the register\'s map: wallet to key name, and where they live', [all.status, all.body.base, /^[0-9a-f]{12}$/.test(all.body.map[D])], [200, 'https://assets.mintface.art/pfp', true]);
is('nothing in it points anywhere but our bucket', JSON.stringify(all.body).includes('opensea') || JSON.stringify(all.body).includes('pbs.'), false);
const one = await get(`address=${D}`);
is('one collector: source, picture, small copy', [one.body.source, one.body.url.startsWith('https://assets.mintface.art/pfp/'), one.body.small.endsWith('-128.webp')], ['x', true, true]);

console.log('\n— the console —');
const console_ = await import('../../api/studio-api.js');
const desk = async (body, cookie = `mf_studio=${ARTIST}`) => {
  const r = await console_.POST(new Request('http://localhost:3000/api/studio-api?do=pfp', { method: 'POST',
    headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
};
is('behind the password', (await desk({}, '')).status, 401);
const job = await desk({});
is('where the backfill is up to, and how many faces there are', [job.body.job.phase, job.body.pictures > 0, job.body.chose_none], ['idle', true, 1]);
const found = await desk({ q: C });
is('one collector found by wallet, with who set their picture', [found.body.found.address, found.body.found.record.uploaded_by], [C, 'self']);
const byName = byRank.find((r) => /\.eth$/.test(r[f('name')] || ''));
const named = await desk({ q: byName[f('name')] });
is('and by name', named.body.found && named.body.found.address, byName[f('address')]);

console.log('\n— fetching somebody else\'s picture —');
is('http is refused', (await P.fetchPicture('http://pics.example/a.png')).error, 'not a public https URL');
is('a private address is refused', (await P.fetchPicture('https://192.168.1.1/a.png')).error, 'not a public https URL');
is('so is localhost', (await P.fetchPicture('https://localhost/a.png')).error, 'not a public https URL');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
