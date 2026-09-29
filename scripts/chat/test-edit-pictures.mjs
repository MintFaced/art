#!/usr/bin/env node
/* Studio chat: editing your own message for an hour, and pictures from phones.
 *
 * Drives the real route (api/chat.js) with the store in memory, R2 caught at
 * the door, and the site's data read from this checkout. The pictures are the
 * fixtures in scripts/chat/fixtures: a JPEG and a HEIC that carry what a phone
 * writes ... an iPhone make and model, GPS coordinates, and a rotation ... and
 * the check is on the bytes that would have gone into the bucket.
 *
 *   node scripts/chat/test-edit-pictures.mjs
 */
import { readFileSync, existsSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
let pass = 0, fail = 0;
const is = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label.padEnd(66) + (ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`));
  ok ? pass++ : fail++;
};

/* ---- the world, in memory ---- */
process.env.KV_REST_API_URL = 'http://kv.fake';
process.env.KV_REST_API_TOKEN = 'fake';
Object.assign(process.env, { R2_ACCOUNT_ID: 'acct', R2_BUCKET: 'bucket', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's' });
delete process.env.SITE_ORIGIN;
const KV = new Map();
const EXP = new Map();
function kv([cmd, ...a]) {
  const C = cmd.toUpperCase();
  for (const [k, t] of EXP) if (t < Date.now()) { KV.delete(k); EXP.delete(k); }
  const g = (k) => KV.get(k);
  switch (C) {
    case 'GET': { const v = g(a[0]); return typeof v === 'string' ? v : null; }
    case 'SET': {
      if (a.includes('NX') && KV.has(a[0])) return null;
      KV.set(a[0], a[1]);
      const ex = a.indexOf('EX'); if (ex > 0) EXP.set(a[0], Date.now() + Number(a[ex + 1]) * 1000);
      return 'OK';
    }
    case 'DEL': a.forEach((k) => KV.delete(k)); return 1;
    case 'EXPIRE': EXP.set(a[0], Date.now() + Number(a[1]) * 1000); return 1;
    case 'INCR': { const v = Number(g(a[0]) || 0) + 1; KV.set(a[0], String(v)); return v; }
    case 'INCRBY': { const v = Number(g(a[0]) || 0) + Number(a[1]); KV.set(a[0], String(v)); return v; }
    case 'TTL': return 60;
    case 'EXISTS': return KV.has(a[0]) ? 1 : 0;
    case 'SADD': { const s = g(a[0]) || new Set(); a.slice(1).forEach((x) => s.add(x)); KV.set(a[0], s); return 1; }
    case 'SREM': { const s = g(a[0]); if (s) a.slice(1).forEach((x) => s.delete(x)); return 1; }
    case 'SISMEMBER': { const s = g(a[0]); return s && s.has(a[1]) ? 1 : 0; }
    case 'SMEMBERS': { const s = g(a[0]); return s ? [...s] : []; }
    case 'HGET': { const h = g(a[0]); return h && h.has(a[1]) ? h.get(a[1]) : null; }
    case 'HSET': { const h = g(a[0]) || new Map(); for (let i = 1; i < a.length; i += 2) h.set(a[i], a[i + 1]); KV.set(a[0], h); return 1; }
    case 'HDEL': { const h = g(a[0]); if (h) a.slice(1).forEach((x) => h.delete(x)); return 1; }
    case 'HGETALL': { const h = g(a[0]); return h ? [...h].flat() : []; }
    case 'HINCRBY': { const h = g(a[0]) || new Map(); const v = Number(h.get(a[1]) || 0) + Number(a[2]); h.set(a[1], String(v)); KV.set(a[0], h); return v; }
    case 'LLEN': return (g(a[0]) || []).length;
    case 'RPUSH': case 'LPUSH': {
      const l = g(a[0]) || []; const items = a.slice(1);
      if (C === 'RPUSH') l.push(...items); else l.unshift(...items.reverse());
      KV.set(a[0], l); return l.length;
    }
    case 'LRANGE': { const l = g(a[0]) || []; const e = Number(a[2]); return l.slice(Number(a[1]) < 0 ? l.length + Number(a[1]) : Number(a[1]), e < 0 ? l.length + e + 1 : e + 1); }
    case 'LTRIM': { const l = g(a[0]) || []; const st = Number(a[1]) < 0 ? Math.max(0, l.length + Number(a[1])) : Number(a[1]); const en = Number(a[2]) < 0 ? l.length + Number(a[2]) : Number(a[2]); KV.set(a[0], l.slice(st, en + 1)); return 'OK'; }
    default: throw new Error(`fake kv: ${C}`);
  }
}
const PUT = new Map();                               // what went into the bucket, by key
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url.startsWith('http://kv.fake')) {
    return new Response(JSON.stringify(JSON.parse(init.body).map((c) => ({ result: kv(c) }))), { status: 200 });
  }
  if (url.startsWith('http://localhost:3000/')) {
    const file = new URL(new URL(url).pathname.slice(1), ROOT);
    return existsSync(file) ? new Response(readFileSync(file), { status: 200 }) : new Response('no', { status: 404 });
  }
  if (/r2\.cloudflarestorage\.com/.test(url)) {
    if ((init.method || 'GET') === 'PUT') {
      const key = decodeURIComponent(new URL(url).pathname.split('/').slice(2).join('/'));
      PUT.set(key, Buffer.from(init.body instanceof Uint8Array ? init.body : await new Response(init.body).arrayBuffer()));
    }
    return new Response('', { status: 200 });
  }
  /* The chain: nobody delegates to anybody here, and a node that will not
     answer is how the COMBO reads that. */
  if (/publicnode|llamarpc|cloudflare-eth|rpc/.test(url)) return new Response('no', { status: 503 });
  return realFetch(input, init);
};

const { POST } = await import('../../api/chat.js');
const { chatStore, keys } = await import('../../api/_lib/chat.js');
const { pipe } = await import('../../api/_lib/kv.js');
const sharpMod = await import('sharp');
const sharp = sharpMod.default;
const { hasMetadata } = await import('../../api/_lib/images.js');

const cfg = JSON.parse(readFileSync(new URL('data/source/chat.json', ROOT), 'utf8'));
const db = chatStore(pipe, cfg);
const VISCO = '0x8be5a2df6488b0937299d27f092716f4a9ab2fd8';           // holds TAO, can speak
const reg = JSON.parse(readFileSync(new URL('data/collectors-register.json', ROOT), 'utf8'));
const named = (reg.rows || reg).filter((r) => Array.isArray(r) && /\.eth$/.test(String(r[1] || '')) && r[0] !== VISCO).slice(0, 3);
const [A, B, C] = named.map((r) => ({ address: r[0], name: r[1] }));
const OTHER = A.address;

const TOKEN = 'a'.repeat(64);
const TOKEN2 = 'b'.repeat(64);
await db.openSession(TOKEN, VISCO, 3600);
await db.openSession(TOKEN2, OTHER, 3600);

const post = async (payload, file = null) => {
  let req;
  if (file) {
    const form = new FormData();
    form.set('payload', JSON.stringify(payload));
    form.set('image', new Blob([file.bytes], { type: file.type }), file.name);
    req = new Request('http://localhost:3000/api/chat', { method: 'POST', body: form });
  } else {
    req = new Request('http://localhost:3000/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  }
  const res = await POST(req);
  return { status: res.status, body: await res.json() };
};

/* A tiny EXIF reader: is there a TIFF block, and does it point at GPS? */
function exifOf(buf) {
  for (let i = 0; i + 8 < buf.length; i += 1) {
    const le = buf[i] === 0x49 && buf[i + 1] === 0x49 && buf[i + 2] === 0x2a && buf[i + 3] === 0;
    const be = buf[i] === 0x4d && buf[i + 1] === 0x4d && buf[i + 2] === 0 && buf[i + 3] === 0x2a;
    if (!le && !be) continue;
    const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
    const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
    try {
      const ifd = i + u32(i + 4); const n = u16(ifd);
      if (n > 64) continue;
      const tags = []; for (let k = 0; k < n; k += 1) tags.push(u16(ifd + 2 + 12 * k));
      return { exif: true, gps: tags.includes(0x8825), orientation: tags.includes(0x0112) };
    } catch (e) { continue; }
  }
  return { exif: false, gps: false, orientation: false };
}
const red = async (bytes) => {
  const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
  const px = (x, y) => { const i = (y * info.width + x) * info.channels; return data[i] > 150 && data[i + 1] < 80 && data[i + 2] < 80; };
  return { topRight: px(info.width - 10, 10), topLeft: px(10, 10), w: info.width, h: info.height };
};

try {
  console.log('\n— pictures from phones —');
  for (const [file, type] of [['phone.heic', 'image/heic'], ['phone.jpg', 'image/jpeg']]) {
    const bytes = readFileSync(new URL(`scripts/chat/fixtures/${file}`, ROOT));
    const src = exifOf(bytes);
    is(`${file} really carries GPS and an orientation going in`, [src.gps, src.orientation], [true, true]);
    PUT.clear();
    await pipe([['DEL', `chat:spend:${VISCO}`]]).catch(() => null);
    for (const k of [...KV.keys()]) if (/spend|rate|burst|floor/.test(k)) KV.delete(k);
    const r = await post({ action: 'say', text: `A photo, ${file}`, token: TOKEN }, { bytes, type, name: file });
    is(`${file} posts`, r.status, 200);
    const [key, stored] = [...PUT.entries()][0] || [];
    is(`${file} is stored as a JPEG under chat/`, [/^chat\/\d{4}\/[0-9a-f]{24}\.jpg$/.test(key || ''), (await sharp(stored).metadata()).format], [true, 'jpeg']);
    const out = exifOf(stored);
    is(`${file} stored: no EXIF, no GPS, no orientation tag`, [out.exif, out.gps, out.orientation, hasMetadata(stored)], [false, false, false, false]);
    is(`${file} stored: no camera name anywhere in the bytes`, /iPhone|Apple/.test(stored.toString('latin1')), false);
    const shape = await red(stored);
    is(`${file} stored the right way up`, [shape.w, shape.h, shape.topRight, shape.topLeft], [300, 400, true, false]);
    is(`${file}: the message says how big it is`, [r.body.message.image && r.body.message.image.w, r.body.message.image && r.body.message.image.h], [300, 400]);
  }
  const big = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: '#888' } }).png().toBuffer();
  for (const k of [...KV.keys()]) if (/spend|rate|burst|floor/.test(k)) KV.delete(k);
  PUT.clear();
  const rb = await post({ action: 'say', text: 'A big one', token: TOKEN }, { bytes: big, type: 'image/png', name: 'big.png' });
  const [, bigStored] = [...PUT.entries()][0] || [];
  const bm = bigStored ? await sharp(bigStored).metadata() : {};
  is('a large PNG comes down to 2000 on its long edge, as a JPEG', [rb.status, bm.width, bm.height, bm.format], [200, 2000, 1500, 'jpeg']);
  const junk = Buffer.from('not a picture at all, just words in a file');
  const rj = await post({ action: 'say', text: 'Junk', token: TOKEN }, { bytes: junk, type: 'image/jpeg', name: 'x.jpg' });
  is('a file that is not a picture is refused, and says what is taken', [rj.status, /JPEG, PNG, WebP and HEIC/.test(rj.body.error)], [400, true]);

  console.log('\n— editing your own message —');
  for (const k of [...KV.keys()]) if (/spend|rate|burst|floor/.test(k)) KV.delete(k);
  const said = await post({ action: 'say', text: `Hello @${A.name}`, token: TOKEN });
  const n = said.body.message.n;
  /* A reply and a reaction hanging off it, from somebody else. */
  const parent = await db.get(n);
  const reply = await db.say({ ...parent, n: undefined, address: OTHER, text: 'Answering', reply: n, mentions: [], image: null, at: new Date().toISOString() });
  await db.react(n, OTHER, '🍒');
  const mentionsOf = async (a) => ((await pipe([['LRANGE', keys.mentions(a), '0', '-1']]))[0] || []).map(Number);
  const aBefore = (await mentionsOf(A.address)).length;

  /* 59 minutes old. */
  await db.save({ ...(await db.get(n)), at: new Date(Date.now() - 59 * 60 * 1000).toISOString() });
  const e1 = await post({ action: 'edit', n, text: `Hello @${A.name} and @${B.name}`, token: TOKEN });
  is('an edit at 59 minutes goes through', e1.status, 200); if (e1.status !== 200) console.log('        ', JSON.stringify(e1.body));
  is('and the message says it was edited', e1.body.message.edited, true);
  is('the new words are what it says now', e1.body.message.text, `Hello @${A.name} and @${B.name}`);
  is('only the newly named are told', [(await mentionsOf(A.address)).length - aBefore, (await mentionsOf(B.address)).includes(n)], [0, true]);
  is('the reply still answers it', (await db.get(reply.n)).reply, n);
  const marks = await db.marks([n]);
  is('the reaction is still under it', JSON.stringify(marks).includes('🍒'), true);
  const hist = await db.edits(n);
  is('what it said before is kept for moderation', hist.map((h) => h.text), [`Hello @${A.name}`]);
  const read = await (await import('../../api/chat.js')).GET(new Request('http://localhost:3000/api/chat'));
  is('and never served to the room', JSON.stringify(await read.json()).includes('"replaced_at"'), false);

  const e2 = await post({ action: 'edit', n, text: 'Someone else', token: TOKEN2 });
  is('nobody else can edit it', e2.status, 403);

  await db.save({ ...(await db.get(n)), at: new Date(Date.now() - 61 * 60 * 1000).toISOString() });
  const e3 = await post({ action: 'edit', n, text: 'Too late', token: TOKEN });
  is('an edit at 61 minutes is refused by the server', [e3.status, e3.body.window], [403, true]);
  is('and the message is untouched', (await db.get(n)).text, `Hello @${A.name} and @${B.name}`);

  const e4 = await post({ action: 'edit', n: n, text: 'No session', address: VISCO, signature: '0x00', issued: new Date().toISOString() });
  is('an edit without a session is refused', e4.status === 401 || e4.status === 400, true);

  /* Taking a picture off. */
  for (const k of [...KV.keys()]) if (/spend|rate|burst|floor/.test(k)) KV.delete(k);
  const withPic = await post({ action: 'say', text: 'With a picture', token: TOKEN },
    { bytes: readFileSync(new URL('scripts/chat/fixtures/phone.jpg', ROOT)), type: 'image/jpeg', name: 'p.jpg' });
  const m2 = withPic.body.message.n;
  const e5 = await post({ action: 'edit', n: m2, text: 'With a picture, now without', remove_image: true, token: TOKEN });
  is('the picture can be taken off in an edit', [e5.status, e5.body.message.image], [200, null]);
  const e6 = await post({ action: 'edit', n: m2, text: 'And one back on', token: TOKEN },
    { bytes: readFileSync(new URL('scripts/chat/fixtures/phone.jpg', ROOT)), type: 'image/jpeg', name: 'p.jpg' });
  is('but an edit cannot put one on', [e6.status, e6.body.message && e6.body.message.image], [200, null]);
} catch (err) {
  console.error('\nERROR', err);
  fail += 1;
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
