#!/usr/bin/env node
/* STUDIO-OPEN: the room opens at the latest, and never at the head.
 *
 *   node scripts/studio/test-open.mjs
 *   STUDIO_SHOTS=<dir> node scripts/studio/test-open.mjs   (and the two screenshot strips)
 *
 * studio.html in a real browser, served from the checkout with gzip the way
 * Vercel serves it, against a stand-in room: 120 messages, pictures with and
 * without a stored size, two link cards near the foot, and the board as the
 * live route answered it on 14 November. Every other host fails to resolve,
 * so nothing here leaves the machine.
 *
 * What is measured is what the reader would see. Every animation frame
 * records whether the masthead was on screen and visible, and the moment
 * `.opening` comes off records where the composer is. The throttled runs are
 * Slow 4G and a CPU four times slower, as DevTools has them.
 *
 * Playwright comes from contracts/ (npm --prefix contracts ci), as the strips
 * tests take it. Where it is not installed this says so and that the opening
 * was NOT tested, rather than passing quietly.
 */
import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { extname, join, normalize } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

let pw = null;
for (const base of ['../../package.json', '../../contracts/package.json']) {
  try { pw = createRequire(new URL(base, import.meta.url))('playwright'); break; } catch (err) { /* next */ }
}
if (!pw) {
  console.log('\n  SKIPPED  scripts/studio/test-open.mjs: Playwright is not installed (npm --prefix contracts ci).');
  console.log('           The studio opening was NOT tested.\n');
  process.exit(0);
}

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SHOTS = process.env.STUDIO_SHOTS || '';
const BOARD = await readFile(new URL('./fixtures/nudge.json', import.meta.url), 'utf8');

let pass = 0, fail = 0;
const is = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label.padEnd(78) + (ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`));
  ok ? pass++ : fail++;
};
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

/* ---------- the room ---------- */
const TOTAL = 120, PAGE = 50;
const ARTIST = '0x00000000000000000000000000000000000000a1';
const PEOPLE = [
  { address: '0x1111111111111111111111111111111111111111', name: 'north.eth', tao: 52000, worn: '52K' },
  { address: '0x2222222222222222222222222222222222222222', name: 'lagoon.eth', tao: 9100, worn: '9.1K' },
  { address: '0x3333333333333333333333333333333333333333', name: 'pottle', tao: 640, worn: '640' },
  { address: ARTIST, name: 'MintFace', role: 'artist', tao: null, worn: null },
];
const SAID = [
  'The seventh is open.',
  'That green is closer to a pool than a lawn, which I think is the point of it.',
  'Morning. Is the laneway strip still drying or is it up?',
  'I keep coming back to the second one. It holds the wall better than I expected it would from the photographs, and the light at four in the afternoon does something to it that the mockup could not.',
  'Agreed.',
  'Weighed in on the teal. Not sure it wins but it should be on the board.',
  'Here is the wall before anything went on it.',
  'The red line is the bit everybody asks about.',
];
const SIZES = [[1500, 2000], [2000, 1500], [2000, 761], [1330, 410], [1125, 2000]];
const LINKS = { 116: 'https://example.com/strips/overview', 118: 'https://example.org/a-long-read' };
const message = (n) => {
  const who = PEOPLE[n % PEOPLE.length];
  const text = SAID[n % SAID.length];
  const link = LINKS[n];
  const size = SIZES[Math.floor(n / 9) % SIZES.length];
  /* Two from before sizes were kept, one on the first page and one behind it. */
  const image = n === 40 || n === 72 ? { url: `/__img/1200x900.jpg?n=${n}` }
    : n % 9 === 4 ? { url: `/__img/${size[0]}x${size[1]}.jpg?n=${n}`, w: size[0], h: size[1] } : null;
  return {
    n, address: who.address, name: who.name, role: who.role || null, tao: who.tao, worn: who.worn,
    url: `https://collectors.mintface.art/${who.name}`,
    at: new Date(Date.UTC(2026, 10, 14, 5, 0) - (TOTAL - n) * 37 * 60000).toISOString(),
    deleted: false, reply: null, reactions: n % 7 === 0 ? [{ emoji: '🔥', count: 2, mine: false }] : [],
    image, text: link ? `${link} ${text}` : text,
    html: link ? `<a class="lnk" href="${link}" target="_blank" rel="nofollow ugc noopener noreferrer">${link.replace('https://', '')}</a> ${text}` : text,
    links: link ? [link] : [], mentions: [],
  };
};
const ROWS = Array.from({ length: TOTAL }, (_, n) => message(n));
const head = { me: null, max_chars: 500, max_tags: 5, session_days: 7, sign_format: '4361',
  emoji: ['🍒', '❤️', '👍', '🔥', '😂', '✦', '💯', '🧧'], rx: 1, max_image_kb: 1200, store: true };
const pageOf = (start, end) => ({ messages: ROWS.slice(start, end), start, end, total: TOTAL, more: start > 0, ...head });

/* How slowly each part of the room answers, set per visit. */
const DEFAULT = { chat: 400, more: 300, nudge: 300, cards: 1500, img: 2000, abortChat: false };
let CFG = { ...DEFAULT };

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.webp': 'image/webp' };
const TEXT = /^(text\/|application\/json|image\/svg)/;
const pictures = new Map();
const picture = async (w, h) => {
  const k = `${w}x${h}`;
  if (!pictures.has(k)) {
    pictures.set(k, await sharp({ create: { width: w, height: h, channels: 3, background: { r: 120 + (w % 90), g: 140, b: 160 + (h % 80) } } })
      .jpeg({ quality: 60 }).toBuffer());
  }
  return pictures.get(k);
};

const send = (req, res, status, type, body) => {
  const zip = TEXT.test(type) && /gzip/.test(req.headers['accept-encoding'] || '');
  const out = zip ? gzipSync(body) : body;
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...(zip ? { 'content-encoding': 'gzip' } : {}) });
  res.end(out);
};
const json = (req, res, data) => send(req, res, 200, 'application/json', Buffer.from(JSON.stringify(data)));

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const q = url.searchParams;
  try {
    if (url.pathname === '/api/chat') {
      if (q.has('since')) return json(req, res, { messages: [], total: TOTAL, rx: 1, store: true });
      if (q.has('rx')) return json(req, res, { reactions: {}, rx: 1 });
      if (q.has('cards')) {
        await sleep(CFG.cards);
        const cards = {};
        for (const n of q.get('cards').split(',').map(Number)) {
          const u = LINKS[n];
          if (u) cards[u] = { url: u, domain: new URL(u).hostname, title: `A page at ${new URL(u).hostname}`, description: 'What the link turns out to be, in a line or two under its title.', thumb: '/__img/88x88.jpg' };
        }
        return json(req, res, { cards });
      }
      if (q.has('before')) {
        await sleep(CFG.more);
        const end = Number(q.get('before'));
        return json(req, res, pageOf(Math.max(0, end - PAGE), end));
      }
      if (CFG.abortChat) { req.socket.destroy(); return; }
      await sleep(CFG.chat);
      return json(req, res, pageOf(TOTAL - PAGE, TOTAL));
    }
    if (url.pathname === '/api/nudge') { await sleep(CFG.nudge); return send(req, res, 200, 'application/json', Buffer.from(BOARD)); }
    if (url.pathname.startsWith('/api/')) return send(req, res, 404, 'application/json', Buffer.from('{}'));
    const img = /^\/__img\/(\d+)x(\d+)\.jpg$/.exec(url.pathname);
    if (img) { await sleep(CFG.img); return send(req, res, 200, 'image/jpeg', await picture(Number(img[1]), Number(img[2]))); }
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^\/+/, '') || 'index.html';
    let file = join(ROOT, path);
    const s = await stat(file).catch(() => null);
    if (!s || s.isDirectory()) file = `${file.replace(/\/$/, '')}.html`;
    send(req, res, 200, TYPES[extname(file)] || 'application/octet-stream', await readFile(file));
  } catch (err) {
    if (!res.headersSent) send(req, res, err.code === 'ENOENT' ? 404 : 500, 'text/plain', Buffer.from(String(err.message)));
  }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const SITE = `http://127.0.0.1:${server.address().port}`;

/* ---------- what the reader saw ---------- */
const WATCH = () => {
  const o = window.__open = { frames: [], reveal: null, sawOpening: false };
  const sample = () => {
    const main = document.getElementById('main'), mast = document.querySelector('.mast'), speak = document.getElementById('speak');
    if (!main || !mast || !speak) return null;
    const hidden = getComputedStyle(main).visibility === 'hidden';
    const r = mast.getBoundingClientRect();
    return { t: Math.round(performance.now()), hidden, mastShown: !hidden && r.bottom > 0 && r.top < innerHeight,
      foot: Math.round(speak.getBoundingClientRect().bottom - innerHeight), y: Math.round(scrollY) };
  };
  o.sample = sample;
  (function tick() { const s = sample(); if (s) o.frames.push(s); requestAnimationFrame(tick); })();
  /* On the document rather than on <html>: this runs before the parser has
     made the root, and the class is added to it the moment it has. */
  new MutationObserver(() => {
    const root = document.documentElement;
    if (!root) return;
    if (root.classList.contains('opening')) o.sawOpening = true;
    else if (o.sawOpening && !o.reveal) o.reveal = sample();
  }).observe(document, { attributes: true, subtree: true, attributeFilter: ['class'] });
};

const IPHONE = (({ defaultBrowserType, ...d }) => d)(pw.devices['iPhone 13']);
const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
const LAUNCH = { args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] };
const chromium = await pw.chromium.launch(LAUNCH);

async function visit({ device = DESKTOP, browser = chromium, hash = '', throttle = false, cfg = {}, js = true, shots = '' } = {}) {
  CFG = { ...DEFAULT, ...cfg };
  const ctx = await browser.newContext({ ...device, javaScriptEnabled: js, reducedMotion: 'no-preference' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  if (js) await page.addInitScript(WATCH);
  const cast = [];
  let cdp = null;
  if (throttle || shots) {
    cdp = await ctx.newCDPSession(page);
    if (throttle) {
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 562.5, downloadThroughput: 180000, uploadThroughput: 84375 });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    }
    if (shots) {
      cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
        cast.push({ wall: metadata.timestamp * 1000, data });
        cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
      });
      await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, everyNthFrame: 1 });
    }
  }
  const started = Date.now();
  await page.goto(`${SITE}/studio${hash}`, { waitUntil: 'commit' });
  return { page, ctx, errors, cdp, cast, started };
}

const revealed = async (page, within = 12000) => {
  await page.waitForFunction(() => window.__open && window.__open.reveal, null, { timeout: within, polling: 50 });
  return page.evaluate(() => window.__open.reveal);
};
const framesOf = (page) => page.evaluate(() => window.__open.frames);
const now = (page) => page.evaluate(() => window.__open.sample());
const msgTop = (page, n) => page.evaluate((k) => {
  const el = document.getElementById(`m-${k}`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight };
}, n);

/* One frame per tenth of a second for six seconds, as one picture: the first
   three the spec asks for, and the three after, which is where a throttled
   phone actually opens and then holds while the cards land. */
async function strip(v, name, until) {
  const sorted = v.cast.slice().sort((a, b) => a.wall - b.wall);
  if (!sorted.length) return;
  const meta = await sharp(Buffer.from(sorted[0].data, 'base64')).metadata();
  const W = 180, H = Math.round(W * meta.height / meta.width), COLS = 10, PAD = 6, LAB = 18;
  const tiles = [];
  for (let i = 1; i <= 60; i += 1) {
    const at = v.started + i * 100;
    const f = [...sorted].reverse().find((x) => x.wall <= at);
    const img = f ? await sharp(Buffer.from(f.data, 'base64')).resize(W, H).toBuffer()
      : await sharp({ create: { width: W, height: H, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
    const k = i - 1;
    const left = PAD + (k % COLS) * (W + PAD), top = PAD + Math.floor(k / COLS) * (H + LAB + PAD);
    const opened = until != null && i * 100 >= until;
    tiles.push({ input: img, left, top: top + LAB });
    tiles.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${LAB}"><text x="0" y="13" font-family="Menlo,monospace" font-size="12" fill="${opened ? '#0a7d32' : '#555'}">${(i / 10).toFixed(1)}s${opened ? ' · shown' : ''}</text></svg>`), left, top });
  }
  const rows = 6;
  await mkdir(SHOTS, { recursive: true });
  const out = join(SHOTS, `${name}.jpg`);
  await sharp({ create: { width: PAD + COLS * (W + PAD), height: PAD + rows * (H + LAB + PAD), channels: 3, background: '#f4f2ee' } })
    .composite(tiles).jpeg({ quality: 78 }).toFile(out);
  console.log(`         strip: ${out}`);
}

/* ---------- 1. throttled first load ---------- */
for (const [name, device] of [['iphone-13', IPHONE], ['desktop-1440', DESKTOP]]) {
  console.log(`\n— throttled first load, ${name}: Slow 4G, 4× CPU —`);
  const v = await visit({ device, throttle: true, shots: SHOTS ? name : '', cfg: { cards: 2600, img: 2500 } });
  const at = await revealed(v.page);
  const before = (await framesOf(v.page)).filter((f) => f.t < at.t);
  /* The room is drawn and put at its foot while hidden, which is the first
     frame that is anywhere but the top. The wait after it is 1200ms at most. */
  const drawn = (before.find((f) => f.y > 0) || {}).t;
  console.log(`         room drawn at ${(drawn / 1000).toFixed(2)}s, shown at ${(at.t / 1000).toFixed(2)}s (cards held back on purpose, to land after)`);
  is('shown no later than 1200ms after the room is drawn (one frame of slack)', drawn != null && at.t - drawn <= 1200 + 120, true);
  is('no frame before it shows the masthead', before.filter((f) => f.mastShown).length, 0);
  is('every frame before it is hidden', before.every((f) => f.hidden), true);
  is('at the reveal, the foot of the composer is on the foot of the screen (±4px)', Math.abs(at.foot) <= 4, true);
  await v.page.waitForFunction(() => performance.now() > 6000, null, { timeout: 15000, polling: 100 });
  const late = await now(v.page);
  const after = (await framesOf(v.page)).filter((f) => f.t >= at.t);
  is('at 6s, with the cards and pictures landed, still on the foot (±4px)', Math.abs(late.foot) <= 4, true);
  is('… and the masthead never on screen in any frame after it', after.filter((f) => f.mastShown).length, 0);
  is('the late cards did land in the room', await v.page.evaluate(() => document.querySelectorAll('.card').length), 2);
  is('no page errors', v.errors, []);
  if (SHOTS) { await v.cdp.send('Page.stopScreencast'); await strip(v, `studio-open-${name}`, at.t); }
  await v.ctx.close();
}

/* ---------- 2. the shelf arriving after the reveal, on a phone ---------- */
console.log('\n— the board answers after the wait, on a phone —');
{
  const v = await visit({ device: IPHONE, cfg: { nudge: 2600, cards: 300 } });
  const at = await revealed(v.page);
  is('shown at the foot before the board is in', [Math.abs(at.foot) <= 4, await v.page.evaluate(() => !document.querySelector('#pots .shelf'))], [true, true]);
  await v.page.waitForSelector('#pots .shelf', { timeout: 6000 });
  await sleep(300);
  const late = await now(v.page);
  is('the shelf lands above, and the composer is still on the foot (±4px)', Math.abs(late.foot) <= 4, true);
  await v.ctx.close();
}

/* ---------- 3. the reader has the scroll ---------- */
console.log('\n— reader control —');
{
  const v = await visit({ cfg: { cards: 3200 } });
  await revealed(v.page);
  await sleep(500);
  await v.page.mouse.move(500, 450);
  await v.page.mouse.wheel(0, -300);
  await sleep(400);
  const anchor = await v.page.evaluate(() => {
    const nav = document.getElementById('nav').getBoundingClientRect().bottom;
    const el = [...document.querySelectorAll('#log .m')].find((m) => m.getBoundingClientRect().top >= nav);
    return el ? { id: el.id, top: Math.round(el.getBoundingClientRect().top), y: Math.round(scrollY) } : null;
  });
  await v.page.waitForFunction(() => document.querySelectorAll('.card').length === 2, null, { timeout: 6000 });
  await sleep(700);
  const later = await v.page.evaluate((id) => ({ top: Math.round(document.getElementById(id).getBoundingClientRect().top), y: Math.round(scrollY) }), anchor.id);
  const foot = await now(v.page);
  is('scrolled up 300px: it moved', anchor.y > 0 && foot.foot > 200, true);
  is('the cards land after, and what the reader was reading has not moved (±4px)', Math.abs(later.top - anchor.top) <= 4, true);
  await v.ctx.close();
}

/* ---------- 4. the button ---------- */
console.log('\n— the Top / Bottom button —');
{
  const v = await visit({ cfg: { cards: 200, img: 100 } });
  await revealed(v.page);
  const btn = () => v.page.evaluate(() => {
    const b = document.getElementById('totop');
    return { hidden: b.hidden, lab: b.querySelector('.lab').textContent, aria: b.getAttribute('aria-label'), arw: b.querySelector('.arw').textContent };
  });
  const settle = async () => {
    let last = -1;
    for (let i = 0; i < 60; i += 1) {
      const y = await v.page.evaluate(() => Math.round(scrollY));
      if (y === last) return y;
      last = y;
      await sleep(80);
    }
    return last;
  };
  is('there on arrival, and says Top', await btn(), { hidden: false, lab: 'Top', aria: 'Back to the top', arw: '↑' });
  await v.page.click('#totop');
  is('click: arrives at the head', await settle(), 0);
  is('… and says Bottom', await btn(), { hidden: false, lab: 'Bottom', aria: 'Down to the latest', arw: '↓' });
  await v.page.click('#totop');
  await settle();
  is('click again: arrives at the foot (±4px)', Math.abs((await now(v.page)).foot) <= 4, true);
  is('… and says Top', (await btn()).lab, 'Top');
  is('… without loading history on the way past the head of the log', await v.page.evaluate(() => document.querySelectorAll('#log .m').length), 50);
  is('… and without focusing the composer', await v.page.evaluate(() => document.activeElement && document.activeElement.id === 'text'), false);
  await v.page.mouse.move(500, 450);
  await v.page.mouse.wheel(0, -400);
  await settle();
  is('midway up by hand from the foot, it keeps Top', (await btn()).lab, 'Top');
  await v.page.mouse.wheel(0, -100000);
  is('by hand to the head', await settle(), 0);
  is('… gives Bottom', (await btn()).lab, 'Bottom');
  await v.page.mouse.wheel(0, 900);
  await settle();
  is('midway down by hand, it keeps Bottom', (await btn()).lab, 'Bottom');
  await v.page.mouse.wheel(0, 100000);
  await settle();
  is('by hand to the foot gives Top', (await btn()).lab, 'Top');
  await v.ctx.close();
}

/* ---------- 5. deep links ---------- */
console.log('\n— deep links —');
for (const [name, device] of [['desktop', DESKTOP], ['phone', IPHONE]]) {
  const v = await visit({ device, hash: '#m-30' });
  const at = await revealed(v.page);
  const box = await msgTop(v.page, 30);
  const before = (await framesOf(v.page)).filter((f) => f.t < at.t);
  is(`${name}: #m-30, a page back, is shown there and nowhere first`, [box && box.top >= 0 && box.bottom <= box.vh, before.some((f) => !f.hidden)], [true, false]);
  is(`${name}: … not at the foot`, at.foot > 200, true);
  await v.ctx.close();
}
{
  const v = await visit({ hash: '#m-5', cfg: { more: 2000 } });
  const at = await revealed(v.page);
  const say = await v.page.evaluate(() => { const s = document.getElementById('say'); return s && !s.hidden ? s.textContent : null; });
  is(`#m-5 out of reach in 3s: shown at the foot at ${(at.t / 1000).toFixed(1)}s, with the line that says so`, [Math.abs(at.foot) <= 4, say], [true, 'That message is further back than Studio could reach.']);
  await sleep(2500);
  is('… and the walk that was called off does not take the reader anywhere later', Math.abs((await now(v.page)).foot) <= 4, true);
  await v.ctx.close();
}
for (const [name, device] of [['desktop', DESKTOP], ['phone', IPHONE]]) {
  const v = await visit({ device, hash: '#nudge-nudge-3' });
  const at = await revealed(v.page);
  const where = await v.page.evaluate(() => {
    const nav = document.getElementById('nav').getBoundingClientRect().bottom;
    const shelf = document.querySelector('#pots .shelf').getBoundingClientRect();
    const rec = document.getElementById('record');
    return { open: rec ? rec.textContent.includes('03') || rec.textContent.includes('#3') : false, shelf: shelf.top >= nav && shelf.bottom <= innerHeight };
  });
  is(`${name}: #nudge-nudge-3 is shown at the shelf, with that pot open`, where, { open: true, shelf: true });
  is(`${name}: … and not at the foot first`, (await framesOf(v.page)).filter((f) => f.t < at.t).every((f) => f.hidden), true);
  await sleep(1500);
  is(`${name}: … and the log has not loaded history under the shelf`, await v.page.evaluate(() => document.querySelectorAll('#log .m').length), 50);
  await v.ctx.close();
}
{
  const v = await visit({ device: IPHONE, hash: '#nudge-nudge-7' });
  await revealed(v.page);
  const card = await v.page.evaluate(() => {
    const nav = document.getElementById('nav').getBoundingClientRect().bottom;
    const r = document.getElementById('nudge-nudge-7').getBoundingClientRect();
    return r.top >= nav && r.top < nav + 40;
  });
  is('phone: #nudge-nudge-7, the open one, is shown at its card', card, true);
  await v.ctx.close();
}

/* ---------- 6. failures ---------- */
console.log('\n— failures —');
{
  const v = await visit({ js: false });
  await v.page.waitForLoadState('load');
  const seen = await v.page.evaluate(() => ({
    opening: document.documentElement.classList.contains('opening'),
    main: getComputedStyle(document.getElementById('main')).visibility,
    foot: getComputedStyle(document.querySelector('.foot')).visibility,
    loading: getComputedStyle(document.querySelector('.arriving')).display,
  }));
  is('without JavaScript nothing is hidden, and no Loading line', seen, { opening: false, main: 'visible', foot: 'visible', loading: 'none' });
  await v.ctx.close();
}
{
  const v = await visit({ cfg: { abortChat: true } });
  const at = await revealed(v.page, 5000);
  const quiet = await v.page.evaluate(() => (document.querySelector('#log .quiet-log') || {}).textContent || null);
  is(`/api/chat aborted: shown at ${(at.t / 1000).toFixed(2)}s (within 4s)`, at.t < 4000, true);
  is('… with the error state', quiet, 'The room could not be reached. Studio will keep trying.');
  CFG.abortChat = false;
  await v.page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await v.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await v.page.waitForFunction(() => document.querySelectorAll('#log .m').length === 50, null, { timeout: 9000 });
  is('… and the next poll asks for the room again, whole, and not from message nought', await v.page.evaluate(() => document.querySelector('#log .m').id), 'm-70');
  await v.ctx.close();
}

/* ---------- 7. Safari's engine ---------- */
console.log('\n— WebKit, iPhone 13 —');
{
  let webkit = null;
  try { webkit = await pw.webkit.launch(); } catch (err) { console.log('  (WebKit is not installed here; skipped)'); }
  if (webkit) {
    const { defaultBrowserType, ...d } = pw.devices['iPhone 13'];
    const v = await visit({ device: d, browser: webkit, cfg: { cards: 1800 } });
    const at = await revealed(v.page);
    is('shown on the foot (±4px), the masthead in no frame before it', [Math.abs(at.foot) <= 4, (await framesOf(v.page)).filter((f) => f.t < at.t && f.mastShown).length], [true, 0]);
    await v.page.waitForFunction(() => document.querySelectorAll('.card').length === 2, null, { timeout: 6000 });
    await sleep(300);
    is('the late cards land, and the foot holds (±4px)', Math.abs((await now(v.page)).foot) <= 4, true);
    await v.ctx.close();
    await webkit.close();
  }
}

await chromium.close();
server.close();
console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
