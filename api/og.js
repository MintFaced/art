import { ImageResponse } from '@vercel/og';
import { readFileSync } from 'node:fs';
import { nzdToUsd } from './_lib/fx.js';
import { loadRegister } from './_lib/register.js';
import { storeConfigured, pipe } from './_lib/kv.js';

/* Link previews as exhibition posters.
 *
 * One card, generated per request from the catalogue, so a work that sold on
 * Tuesday stops advertising Monday's price the moment the cache turns over.
 * Nothing is pre-rendered: a batch is stale the day after it is made.
 *
 * The site's own fonts are variable woff2, which Satori cannot read at all. It
 * takes static ttf buffers and nothing else, so the two weights the card uses
 * are checked in beside this file and handed over explicitly.
 */

const ORIGIN = process.env.SITE_ORIGIN || 'https://mintface.art';
const ASSETS = 'https://assets.mintface.art';
const PAPER = '#faf9f6';
const INK = '#14120f';
const MUTED = '#6e6a62';
const FAINT = '#a9a49a';
const RULE = '#e6e2da';
const GREEN = '#3f7d54';

/* new URL against import.meta.url is the form Vercel's bundler traces, so the
   ttf files are actually shipped with the function. A path built from cwd is
   invisible to it and the fonts simply would not be there. */
const font = (f) => readFileSync(new URL(`./_fonts/${f}`, import.meta.url));
let FONTS = null;
const fonts = () => (FONTS || (FONTS = [
  { name: 'Geist', data: font('Geist-Regular.ttf'), weight: 400, style: 'normal' },
  { name: 'Geist', data: font('Geist-Medium.ttf'), weight: 500, style: 'normal' },
  { name: 'Geist Mono', data: font('GeistMono-Regular.ttf'), weight: 400, style: 'normal' },
]));

const get = async (p) => {
  const r = await fetch(`${ORIGIN}/${p}`, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`${p}: ${r.status}`);
  return r.json();
};
/* An OG card is the register speaking to somebody who has not arrived yet, so
   it says the same name the register says. Held for the life of one invocation
   ... a card draws one name and there is nothing to gain by asking twice. */
let REGISTER;
const register = async () => {
  if (REGISTER !== undefined) return REGISTER;
  REGISTER = await loadRegister((_o, p) => get(p), ORIGIN, storeConfigured() ? pipe : null).catch(() => null);
  return REGISTER;
};
/** What to call a wallet on a card, or nothing where there is nothing to say. */
const nameOf = async (address, fallback = null) => {
  if (!address) return fallback;
  const reg = await register();
  if (!reg) return fallback;
  const who = reg.who(address);
  return who.private ? 'A PRIVATE COLLECTOR' : (who.name || fallback);
};

const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
const upper = (s) => String(s || '').toUpperCase();

/* Satori draws png and jpeg. It cannot decode webp, which is what the site's
   display copies are, and it chokes on the masters ... one Geodetic Moment
   jpeg is 11.5 MB. Both problems have the same answer, and the site already
   owns it: the same resizer the work pages use for scrapers, asked for a jpeg
   at card width. One image service, not a second one.

   The display copy goes in first because it is already the right size, so the
   resizer has the least to do. */
const THUMB = 'https://images.weserv.nl/?url={url}&w=760&output=jpg&q=82';
const sized = (url) => {
  if (!url || url.startsWith('data:')) return null;
  return THUMB.replace('{url}', encodeURIComponent(url.replace(/^https?:\/\//, '')));
};
const imageOf = (w) => {
  if (!w) return null;
  const a = w.assets || {};
  const d = w.digital || {};
  const abs = (u) => (typeof u === 'string' && u.startsWith('/') ? `${ORIGIN}${u}` : u);
  const first = [
    a.display ? `${ASSETS}/${a.display}` : null,
    a.image ? `${ASSETS}/${a.image}` : null,
    abs(d.image || w.image || null),
  ].find(Boolean);
  return sized(first);
};

/* ---------- the card ---------- */
function Card({ image, title, lines, dot, tall }) {
  return {
    type: 'div',
    props: {
      style: { width: '1200px', height: '630px', display: 'flex', background: PAPER, fontFamily: 'Geist' },
      children: [
        // the work, letterboxed. Never cropped, never stretched: an artwork is
        // not a texture, and a strip painting is the whole point of the strip.
        { type: 'div', props: {
          style: { width: '630px', height: '630px', display: 'flex', alignItems: 'center',
            justifyContent: 'center', background: PAPER, padding: '46px' },
          children: image
            ? { type: 'img', props: { src: image, style: { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' } } }
            : { type: 'div', props: { style: { width: '100%', height: '100%', border: `1px solid ${RULE}` } } },
        } },
        { type: 'div', props: { style: { width: '1px', height: '630px', background: RULE, display: 'flex' } } },
        { type: 'div', props: {
          style: { flex: '1', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '64px 58px 46px' },
          children: [
            { type: 'div', props: { style: { display: 'flex', flexDirection: 'column' }, children: [
              { type: 'div', props: { style: {
                fontSize: tall ? '46px' : '58px', lineHeight: 1.03, letterSpacing: '-0.03em',
                color: INK, fontWeight: 400, display: 'flex' }, children: title } },
              { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', marginTop: '30px' },
                children: lines.filter(Boolean).map((l, i) => ({
                  type: 'div', props: {
                    key: String(i),
                    style: { fontFamily: 'Geist Mono', fontSize: '19px', letterSpacing: '0.13em',
                      color: i === 0 ? MUTED : INK, marginTop: i ? '14px' : '0', display: 'flex', alignItems: 'center' },
                    children: l,
                  },
                })) } },
              dot ? { type: 'div', props: {
                style: { display: 'flex', alignItems: 'center', marginTop: '18px' },
                children: [
                  { type: 'div', props: { style: { width: '11px', height: '11px', borderRadius: '11px', background: GREEN, marginRight: '12px', display: 'flex' } } },
                  { type: 'div', props: { style: { fontFamily: 'Geist Mono', fontSize: '19px', letterSpacing: '0.13em', color: INK, display: 'flex' }, children: dot } },
                ],
              } } : null,
            ].filter(Boolean) } },
            { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }, children: [
              { type: 'div', props: { style: { fontSize: '25px', letterSpacing: '-0.02em', color: INK, display: 'flex' }, children: 'MintFace' } },
              { type: 'div', props: { style: { fontFamily: 'Geist Mono', fontSize: '14px', letterSpacing: '0.13em', color: FAINT, marginTop: '9px', display: 'flex' }, children: '39.64°S 176.85°E' } },
            ] } },
          ],
        } },
      ],
    },
  };
}

/* ---------- what each kind of page says ---------- */
async function workCard(id) {
  const idx = await get('data/index.json');
  const slug = idx.work_index && idx.work_index[id];
  if (!slug) return null;
  const col = await get(`data/c/${slug}.json`);
  const work = (col.works || []).find((w) => w.id === id)
    || (col.children || []).flatMap((c) => c.works || []).find((w) => w.id === id);
  if (!work) return null;
  const meta = (idx.collections || []).find((c) => c.slug === slug) || {};

  const second = [upper(meta.title || col.title || slug), work.year || meta.year].filter(Boolean).join(' · ');
  let third = null;
  let dot = null;

  if (work.status === 'available') {
    const nzd = (work.pricing_nzd || {}).digital;
    const listings = await get('data/listings.json').catch(() => ({ works: {} }));
    const l = (listings.works || {})[id];
    const bits = [];
    if (typeof nzd === 'number' && nzd > 0) {
      try { bits.push('US' + money(nzd * (await nzdToUsd()))); } catch (e) { /* no rate, no figure */ }
    }
    if (l && l.price_eth > 0) bits.push(`${l.price_eth} ETH`);
    third = bits.join('  ·  ') || null;
    dot = 'AVAILABLE';
  } else if (work.status === 'acquired') {
    const c = work.collector || {};
    const fallback = c.display_name || c.ens || (c.address ? c.address.slice(0, 6) + '…' + c.address.slice(-4) : null);
    const who = await nameOf(c.address, fallback);
    third = who ? `COLLECTED BY ${upper(who)}` : 'COLLECTED';
  } else if (work.status === 'vaulted') {
    third = 'VAULTED · MINTESTATE.ETH';
  } else if (work.status === 'reserved') {
    third = 'RESERVED';
  } else if (work.status === 'sold_out') {
    third = 'SOLD OUT';
  }

  const title = work.title || id;
  return { image: imageOf(work), title, lines: [second, third], dot, tall: title.length > 26 };
}

async function collectionCard(slug) {
  const idx = await get('data/index.json');
  const meta = (idx.collections || []).find((c) => c.slug === slug);
  if (!meta) return null;
  const n = meta.counts || {};
  const avail = n.available || 0;
  const second = [meta.year, upper(meta.genre || meta.medium || ''), n.works ? `${n.works} WORKS` : null]
    .filter(Boolean).join(' · ');
  // a feature says what it is rather than counting itself
  const isFeature = meta.group === 'feature';
  const third = isFeature ? upper(meta.card_statement || meta.statement || '').slice(0, 64)
    : (meta.sold_out ? 'MINT SOLD OUT' : null);
  return {
    image: meta.cover ? imageOf(meta.cover) : null,
    title: meta.title || slug,
    lines: [second, third],
    dot: !isFeature && !meta.sold_out && avail > 0 ? `${avail} AVAILABLE` : null,
    tall: (meta.title || '').length > 26,
  };
}

async function collectorCard(slug) {
  const page = await get(`data/collectors/${encodeURIComponent(slug)}.json`).catch(() => null);
  if (!page || page.private) return null;
  const name = await nameOf(page.address,
    page.display_name || page.ens || (page.address.slice(0, 6) + '…' + page.address.slice(-4)));
  // their highest-earning holding stands for them
  const top = (page.works || []).slice().sort((a, b) => (b.tao || 0) - (a.tao || 0))[0];
  /* A collector's work rows carry one image key, and it is the webp display
     copy Satori cannot read. The real record has the jpeg beside it, so the
     work is fetched rather than guessed at from the key. */
  let image = null;
  if (top) {
    try {
      const idx = await get('data/index.json');
      const slug = idx.work_index && idx.work_index[top.id];
      if (slug) {
        const col = await get(`data/c/${slug}.json`);
        const w = (col.works || []).find((x) => x.id === top.id)
          || (col.children || []).flatMap((c) => c.works || []).find((x) => x.id === top.id);
        if (w) image = imageOf(w);
      }
    } catch (e) { /* the card stands without it */ }
  }
  return {
    image,
    title: name,
    lines: [
      `${page.counts.works} WORKS · TAO ${(page.tao || 0).toLocaleString('en-NZ')}`,
      page.tao_rank ? `RANK ${page.tao_rank.toLocaleString('en-NZ')}` : null,
    ],
    dot: null,
    tall: name.length > 22,
  };
}

async function pageCard(key) {
  const conf = await get('data/source/og-pages.json').catch(() => null);
  const p = conf && conf.pages && conf.pages[key];
  if (!p) return null;
  let image = null;
  if (p.work) {
    const idx = await get('data/index.json');
    const slug = idx.work_index && idx.work_index[p.work];
    if (slug) {
      const col = await get(`data/c/${slug}.json`);
      const w = (col.works || []).find((x) => x.id === p.work);
      if (w) image = imageOf(w);
    }
  }
  return { image, title: p.title, lines: [upper(p.line || ''), p.sub ? upper(p.sub) : null], dot: null, tall: (p.title || '').length > 24 };
}

export async function GET(request) {
  const url = new URL(request.url);
  const q = (k) => url.searchParams.get(k);
  let card = null;
  try {
    if (q('work')) card = await workCard(q('work'));
    else if (q('collection')) card = await collectionCard(q('collection'));
    else if (q('collector')) card = await collectorCard(q('collector'));
    else if (q('page')) card = await pageCard(q('page'));
  } catch (e) {
    // a card that quietly falls back looks identical to one that had nothing
    // to say, so the reason goes to the log either way
    console.error('og:', url.search, String(e && e.stack || e));
    card = null;
  }

  // anything unknown, private, or broken still gets a card rather than a hole
  if (!card) card = { image: null, title: 'MintFace', lines: ['PAINTINGS AND THEIR TOKENS', 'MINTFACE.ART'], dot: null, tall: false };

  return new ImageResponse(Card(card), {
    width: 1200,
    height: 630,
    fonts: fonts(),
    headers: {
      // an hour is short enough that a sale shows up the same day and long
      // enough that a shared link is not re-rendered for every reader
      'cache-control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
