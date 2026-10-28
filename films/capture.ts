/* The real pages the films hand over to, captured at DPR 2 (FILMS.md).
 *
 *   node capture.ts
 *
 * Each capture is a PNG in public/cap and an entry in data/captures.json with
 * the boxes of the parts the illustration assembles into, in CSS pixels from
 * the capture's own top left, plus the computed type of anything with words
 * in it. The films place every exploded part's last position from these, so
 * the handover from drawing to page lines up by construction rather than by
 * eye. Captured at 960 CSS px wide, which at DPR 2 is the film's 1920.
 *
 * Never opens /mintwork, any admin path, env or docs. The site's top bar is
 * hidden for the capture; there is no address bar in a headless capture.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(import.meta.dirname);
const CAP = path.join(ROOT, 'public', 'cap');
fs.mkdirSync(CAP, { recursive: true });
const script = JSON.parse(fs.readFileSync(path.join(ROOT, 'script.json'), 'utf8'));
const snapshot = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'snapshot.json'), 'utf8'));
/* Playwright is not a dependency of this package: the one already on this
   machine is used, as the site's own checks use it. PLAYWRIGHT_FROM points at
   any package.json that has it. */
const require = createRequire(process.env.PLAYWRIGHT_FROM || '/Users/ryanjennings/dev/memorial-configurator/package.json');
const { chromium } = require('playwright');

const W = 960, H = 540, DPR = 2;
const out: Record<string, any> = { _note: 'Written by capture.ts. Boxes are CSS px from the capture\'s top left; the PNG is at DPR 2.', taken_at: new Date().toISOString(), dpr: DPR };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR, reducedMotion: 'no-preference' });
const page = await ctx.newPage();
const FORBIDDEN = /\/mintwork|\/admin|\.env|docs\//i;
page.on('request', (r: any) => { if (FORBIDDEN.test(new URL(r.url()).pathname)) throw new Error(`capture asked for ${r.url()}`); });

const hideChrome = () => page.addStyleTag({ content: `.nav, header.nav, nav.nav, .topbar { visibility: hidden !important; }
  *, *::before, *::after { caret-color: transparent !important; }` });

/* A box, and the type of whatever it says, as the page computed them. */
const measure = (sel: string, origin: { x: number, y: number }, all = false) => page.evaluate(([sel, ox, oy, all]: any) => {
  const one = (el: Element) => {
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { x: +(b.x - ox).toFixed(1), y: +(b.y - oy).toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1),
      text: (el as HTMLElement).innerText ? (el as HTMLElement).innerText.trim().slice(0, 200) : '',
      font: { size: parseFloat(cs.fontSize), weight: cs.fontWeight, family: cs.fontFamily.split(',')[0].replace(/['"]/g, ''),
        tracking: cs.letterSpacing === 'normal' ? 0 : parseFloat(cs.letterSpacing), color: cs.color, transform: cs.textTransform } };
  };
  const els = [...document.querySelectorAll(sel)];
  return all ? els.map(one) : (els[0] ? one(els[0]) : null);
}, [sel, origin.x, origin.y, all]);

async function shot(name: string, clip: { x: number, y: number, width: number, height: number }) {
  const file = path.join(CAP, `${name}.png`);
  await page.screenshot({ path: file, clip });
  return `cap/${name}.png`;
}
const settle = async (ms = 900) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(ms); };
/* Scroll so a page y sits at the top of the viewport, and answer the viewport
   box of an element. Screenshots are clipped in viewport coordinates. */
const boxOf = (sel: string) => page.evaluate((s: string) => { const b = document.querySelector(s)!.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; }, sel);

/* ================================================================ studio */
console.log('studio');
await page.goto('https://mintface.art/studio', { waitUntil: 'networkidle' });
await hideChrome(); await settle(1500);

/* The palette pottles, as the strip in film 4 assembles into them. */
await page.evaluate(() => document.querySelector('.pots')!.scrollIntoView({ block: 'center' }));
await settle(400);
{
  const b = await boxOf('.pots');
  const clip = { x: b.x, y: b.y, width: b.width, height: b.height };
  out.pots = {
    image: await shot('studio-pots', clip), w: b.width, h: b.height,
    count: await measure('.pots .count', clip),
    pots: await page.evaluate(([ox, oy]: any) => [...document.querySelectorAll('.pot')].map((p) => {
      const r = (el: Element | null) => { if (!el) return null; const q = el.getBoundingClientRect(); return { x: +(q.x - ox).toFixed(1), y: +(q.y - oy).toFixed(1), w: +q.width.toFixed(1), h: +q.height.toFixed(1) }; };
      const paint = p.querySelector('path.paint');
      return { state: p.className.replace('pot', '').trim(), box: r(p), svg: r(p.querySelector('svg')), label: r(p.querySelector('.cap b')),
        hex: paint ? paint.getAttribute('fill') : null, title: p.getAttribute('title') };
    }), [clip.x, clip.y]),
  };
}

/* The board's banked card, opened from its pottle the way a reader opens it. */
const slotOfBoard = snapshot.board.slot;
await page.locator('.pot').nth(slotOfBoard - 1).click();
await settle(1200);
const cardSel = `#nudge-${snapshot.board.id}`;
/* The card is taller than the 540 the films frame at; a taller window for
   this one capture changes nothing about the layout, which is set by width. */
await page.setViewportSize({ width: W, height: 1400 });
await page.evaluate((s: string) => { const el = document.querySelector(s)!; window.scrollTo(0, el.getBoundingClientRect().top + scrollY - 20); }, cardSel);
await settle(500);
{
  const card = await boxOf(cardSel);
  /* From the card's top to the foot of its standings: the part that is
     assembled. Everything below (every change, the line) is the record. */
  const last = await page.evaluate((s: string) => { const rows = [...document.querySelectorAll(`${s} tbody tr`)]; const tb = rows[0] && rows[0].closest('table'); const r = (tb || rows[rows.length - 1]).getBoundingClientRect(); return r.bottom; }, cardSel);
  const clip = { x: card.x - 8, y: card.y - 8, width: card.width + 16, height: Math.min(last - card.y + 16, 1200) };
  out.card = {
    image: await shot('studio-card', clip), w: clip.width, h: clip.height,
    q: await measure(`${cardSel} .q`, clip), when: await measure(`${cardSel} .when`, clip),
    note: await measure(`${cardSel} .note`, clip), promise: await measure(`${cardSel} .promise`, clip),
    bars: await page.evaluate(([s, ox, oy]: any) => {
      const host = document.querySelector(`${s} .bars`)!;
      const r = (el: Element) => { const q = el.getBoundingClientRect(); return { x: +(q.x - ox).toFixed(1), y: +(q.y - oy).toFixed(1), w: +q.width.toFixed(1), h: +q.height.toFixed(1) }; };
      return { box: r(host), fills: [...host.querySelectorAll('.fill')].map((f) => ({ track: r(f.parentElement!), fill: r(f) })),
        labels: [...host.querySelectorAll('span, b')].map((e) => ({ ...r(e), text: (e as HTMLElement).innerText })) };
    }, [cardSel, clip.x, clip.y]),
    tally: await measure(`${cardSel} .tally`, clip),
    head: await measure(`${cardSel} thead`, clip),
    rows: await page.evaluate(([s, ox, oy]: any) => {
      const r = (el: Element | null) => { if (!el) return null; const q = el.getBoundingClientRect(); return { x: +(q.x - ox).toFixed(1), y: +(q.y - oy).toFixed(1), w: +q.width.toFixed(1), h: +q.height.toFixed(1) }; };
      const table = document.querySelector(`${s} tbody`)!;
      return [...table.querySelectorAll('tr')].map((tr) => ({
        box: r(tr), dots: [...tr.querySelectorAll('.hexdot')].map((d) => ({ ...r(d), color: getComputedStyle(d).backgroundColor })),
        face: r(tr.querySelector('.pfp') || tr.querySelector('img')), name: (tr.querySelector('a') as HTMLElement | null)?.innerText || '',
        nameBox: r(tr.querySelector('a')), weight: r(tr.querySelector('td.w')), weightText: (tr.querySelector('td.w') as HTMLElement | null)?.innerText || '',
        note: r(tr.querySelector('td.t .cl, td.t')), noteText: (tr.querySelector('td.t') as HTMLElement | null)?.innerText || '',
      }));
    }, [cardSel, clip.x, clip.y]),
  };
}

await page.setViewportSize({ width: W, height: H });

/* The room: the posts in the script's range, as they stand in the Studio. */
await page.goto('https://mintface.art/studio', { waitUntil: 'networkidle' });
await hideChrome(); await settle(1500);
{
  const [from, to] = script.chat_range;
  const ids = await page.evaluate(([a, b]: any) => [...document.querySelectorAll('#log .m')].map((m) => Number(m.id.replace('m-', ''))).filter((n) => n >= a && n <= b), [from, to]);
  if (!ids.length) throw new Error(`no chat posts ${from} to ${to} on /studio`);
  await page.evaluate((id: number) => { const el = document.getElementById(`m-${id}`)!; window.scrollTo(0, el.getBoundingClientRect().top + scrollY - 24); }, ids[0]);
  await settle(1200);
  const top = await boxOf(`#m-${ids[0]}`); const bot = await boxOf(`#m-${ids[ids.length - 1]}`);
  const clip = { x: top.x - 8, y: top.y - 8, width: top.width + 16, height: Math.min(bot.y + bot.height - top.y + 16, H - Math.max(0, top.y - 8)) };
  out.chat = {
    image: await shot('studio-chat', clip), w: clip.width, h: clip.height,
    posts: await page.evaluate(([list, ox, oy]: any) => list.map((id: number) => {
      const m = document.getElementById(`m-${id}`)!;
      const r = (el: Element | null) => { if (!el) return null; const q = el.getBoundingClientRect(); return { x: +(q.x - ox).toFixed(1), y: +(q.y - oy).toFixed(1), w: +q.width.toFixed(1), h: +q.height.toFixed(1) }; };
      const img = m.querySelector('.pic img, figure img, img.photo, .img img');
      return { n: id, box: r(m), artist: m.classList.contains('by-artist'), cont: m.classList.contains('cont'),
        face: r(m.querySelector('.who .pfp')), who: (m.querySelector('.who .nm') as HTMLElement | null)?.innerText || '',
        whoBox: r(m.querySelector('.who .nm')), meta: r(m.querySelector('.who .tao, .who .role, .who em')), at: r(m.querySelector('.who .at')),
        re: m.querySelector('.re') ? { ...r(m.querySelector('.re')), face: r(m.querySelector('.re .pfp')), name: (m.querySelector('.re .rn') as HTMLElement | null)?.innerText || '',
          quote: (m.querySelector('.re .rq') as HTMLElement | null)?.innerText || '' } : null,
        text: (m.querySelector(':scope > p') as HTMLElement | null)?.innerText || '', textBox: r(m.querySelector(':scope > p')),
        type: (() => { const pEl = m.querySelector(':scope > p'); if (!pEl) return null; const cs = getComputedStyle(pEl); return { size: parseFloat(cs.fontSize), line: parseFloat(cs.lineHeight) || null, color: cs.color }; })(),
        image: img ? { ...r(img), src: (img as HTMLImageElement).currentSrc || (img as HTMLImageElement).src } : null };
    }), [ids, clip.x, clip.y]),
  };
}

/* ============================================================== register */
console.log('register');
await page.goto('https://collectors.mintface.art/', { waitUntil: 'networkidle' });
await hideChrome(); await settle(2500);
{
  await page.evaluate(() => { const t = document.querySelector('.rows thead, .rows tr')!; window.scrollTo(0, t.getBoundingClientRect().top + scrollY - 12); });
  await settle(1500);
  const clip = { x: 0, y: 0, width: W, height: H };
  const rows = () => page.evaluate(() => [...document.querySelectorAll('.rows tbody tr')].slice(0, 14).map((tr) => {
    const r = (el: Element | null) => { if (!el) return null; const q = el.getBoundingClientRect(); return { x: +q.x.toFixed(1), y: +q.y.toFixed(1), w: +q.width.toFixed(1), h: +q.height.toFixed(1) }; };
    const cell = (c: string) => tr.querySelector(c) as HTMLElement | null;
    return { box: r(tr), pos: r(cell('.pos')), posText: cell('.pos')?.innerText || '', face: r(tr.querySelector('.pfp')),
      name: (tr.querySelector('.who > a') as HTMLElement | null)?.innerText || '',
      nameBox: r(tr.querySelector('.who > a')), dot: r(tr.querySelector('.who .dot')), works: r(cell('.c-works')), unique: r(cell('.c-unique')), tao: r(cell('.tao')),
      taoText: cell('.tao')?.innerText || '', worksText: cell('.c-works')?.innerText || '', uniqueText: cell('.c-unique')?.innerText || '' };
  }));
  out.register = { image: await shot('register', clip), w: W, h: H, head: await measure('.rows thead', clip), rows: await rows(),
    type: { name: await measure('.rows tbody tr .who > a', clip), num: await measure('.rows tbody tr .tao', clip), pos: await measure('.rows tbody tr .pos', clip) } };
  /* Held: a hover long enough to mean it on the collector the script holds,
     the way the register itself turns a face into what they have kept. */
  const rank = script.hold_rank;
  const face = page.locator('.rows tbody tr').nth(rank - 1).locator('.pfp');
  await face.hover(); await page.waitForTimeout(2400);
  out.register.hold = { rank, image: await shot('register-hold', clip),
    caption: await page.evaluate(() => { const el = document.querySelector('.holding')?.closest('tr')?.querySelector('.who'); if (!el) return null; const q = el.getBoundingClientRect(); return { x: q.x, y: q.y, w: q.width, h: q.height, text: (el as HTMLElement).innerText }; }) };
  await page.mouse.move(5, 5);
  /* The hold is filmed in close, so the same two frames again at DPR 4. */
  const ctx4 = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 4 });
  const p4 = await ctx4.newPage();
  await p4.goto('https://collectors.mintface.art/', { waitUntil: 'networkidle' });
  await p4.addStyleTag({ content: '.nav, header.nav, nav.nav, .topbar { visibility: hidden !important; }' });
  await p4.waitForTimeout(2500);
  await p4.evaluate(() => { const t = document.querySelector('.rows thead, .rows tr')!; window.scrollTo(0, t.getBoundingClientRect().top + scrollY - 12); });
  await p4.waitForTimeout(1500);
  await p4.screenshot({ path: path.join(CAP, 'register-4x.png'), clip });
  await p4.locator('.rows tbody tr').nth(rank - 1).locator('.pfp').hover(); await p4.waitForTimeout(2400);
  await p4.screenshot({ path: path.join(CAP, 'register-hold-4x.png'), clip });
  out.register.image4 = 'cap/register-4x.png';
  out.register.hold.image4 = 'cap/register-hold-4x.png';
  await ctx4.close();
}

/* ================================================================== home */
console.log('home');
await page.goto('https://mintface.art/', { waitUntil: 'networkidle' });
await hideChrome(); await settle(2000);
{
  await page.evaluate(() => { const el = document.getElementById('stripHome')!; window.scrollTo(0, el.getBoundingClientRect().top + scrollY - 28); });
  await settle(800);
  const b = await boxOf('#stripHome');
  const clip = { x: b.x, y: Math.max(0, b.y), width: b.width, height: Math.min(b.height, H) };
  const parts = async () => ({
    range: await measure('#shLen', clip), ticks: await measure('.sh-ticks span', clip, true), stage: await measure('.sh-stage', clip),
    /* The painting inside the stage: the canvas is the stage's size, so its
       painted pixels are read to find where the strip actually is. */
    strip: await page.evaluate(([ox, oy]: any) => {
      const cv = document.querySelector('.sh-stage canvas') as HTMLCanvasElement | null; if (!cv) return null;
      const q = cv.getBoundingClientRect(); const d = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data;
      let x0 = cv.width, y0 = cv.height, x1 = -1, y1 = -1;
      for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) if (d[(y * cv.width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 < 0) return null; const kx = q.width / cv.width, ky = q.height / cv.height;
      return { x: q.x - ox + x0 * kx, y: q.y - oy + y0 * ky, w: (x1 - x0 + 1) * kx, h: (y1 - y0 + 1) * ky };
    }, [clip.x, clip.y]),
    price: await page.evaluate(([ox, oy]: any) => {
      /* The smallest element whose words are the price line. */
      const hits = [...document.querySelectorAll('#stripHome *')].filter((e) => /\bCM\b.*NZD/i.test((e as HTMLElement).innerText || ''));
      const el = hits.sort((a, b) => a.getBoundingClientRect().width * a.getBoundingClientRect().height - b.getBoundingClientRect().width * b.getBoundingClientRect().height)[0];
      if (!el) return null; const q = el.getBoundingClientRect(); return { x: q.x - ox, y: q.y - oy, w: q.width, h: q.height, text: (el as HTMLElement).innerText };
    }, [clip.x, clip.y]),
    thumb: await page.evaluate(([ox, oy]: any) => { const r = document.getElementById('shLen') as HTMLInputElement; const q = r.getBoundingClientRect(); const t = (Number(r.value) - Number(r.min)) / (Number(r.max) - Number(r.min)); return { x: q.x - ox, y: q.y - oy, w: q.width, h: q.height, t, value: Number(r.value) }; }, [clip.x, clip.y]),
    head: await measure('#stripHome h2, #stripHome h1', clip),
  });
  const { min, max, step } = snapshot.slider;
  const frames = [];
  for (let v = min; v <= max; v += step) {
    await page.evaluate((x: number) => { const r = document.getElementById('shLen') as HTMLInputElement; r.value = String(x); r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); }, v);
    await page.waitForTimeout(450);
    frames.push({ value: v, image: await shot(`home-${v}`, clip), parts: await parts() });
  }
  out.home = { w: clip.width, h: clip.height, frames };
}

await browser.close();
fs.writeFileSync(path.join(ROOT, 'data', 'captures.json'), JSON.stringify(out, null, 1) + '\n');

/* The chat posts on screen go into the credits, by number. */
const creditsPath = path.join(ROOT, 'data', 'credits.json');
const credits = JSON.parse(fs.readFileSync(creditsPath, 'utf8'));
credits.chat = (out.chat.posts || []).map((p: any) => ({ n: p.n, who: p.who.split('\n')[0], text: p.text.slice(0, 160) }));
fs.writeFileSync(creditsPath, JSON.stringify(credits, null, 1) + '\n');
console.log(`captured: pots, card (${out.card.rows.length} rows), chat (${out.chat.posts.length} posts), register (${out.register.rows.length} rows + hold), home (${out.home.frames.length} lengths)`);
