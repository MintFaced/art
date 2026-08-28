/* What a link in the room turns out to be.
 *
 * A URL on its own is a stub: it says a site and nothing about what is there.
 * So a message carrying one gets a small card under it, in the register's own
 * voice ... a hairline, the domain in mono, the title in the sans ... and the
 * room stays a room rather than becoming a feed of other people's cards.
 *
 * No images from anywhere else, on purpose. A preview that hotlinks somebody's
 * three megabyte banner puts it in a log kept forever, pointed at a server that
 * never agreed to serve it. Words are what this room is for anyway.
 *
 * The family discount. mintface.art and collectors.mintface.art are not
 * scraped: a work URL becomes a work card off the catalogue and a collector URL
 * becomes their name and their TAO off the register, both read fresh every
 * time. The register quoting itself should look native, and a work that sold
 * this morning should say so this afternoon.
 *
 * And the fetch is on a short leash. Only URLs already in the log are ever
 * fetched ... which took TAO and a signature to put there ... every hop is
 * checked again before it is followed, and nothing that resolves to a name a
 * private network could answer is fetched at all. A room that will fetch a URL
 * for you is a room that can be pointed at a metadata endpoint, and this one
 * will not be.
 */
import { hostOf } from './text.js';
import { findWork } from './data.js';
import { wearTao } from './chat.js';

const ASSETS = process.env.ASSETS_PUBLIC_BASE || 'https://assets.mintface.art';
const PROXY = 'https://images.weserv.nl/?url={url}&w={w}&output=webp&q=80&n=-1';
const UA = 'MintFaceStudio/1.0 (+https://mintface.art/chat) link preview';

/* ------------------------------------------------------------- the guard */

/* Names that are not the public internet however they are spelled. The list is
   short because the rules underneath it are strict: a hostname that is not
   dotted, or whose last label is not letters, is not a domain ... which is what
   catches 127.0.0.1, 0x7f.1, 2130706433 and every other way of writing an
   address that looks like a name. */
const PRIVATE = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|onion|test|invalid|example)$/i;

/** Whether this URL may be fetched at all. */
export function mayFetch(raw) {
  let u;
  try { u = new URL(String(raw || '')); } catch (e) { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (u.username || u.password) return false;
  if (u.port && u.port !== '80' && u.port !== '443') return false;
  const host = u.hostname.toLowerCase();
  if (host.startsWith('[')) return false;                      // an IPv6 literal
  if (!host.includes('.')) return false;
  if (PRIVATE.test(host)) return false;
  const tld = host.split('.').pop();
  if (!/^[a-z]{2,}$/.test(tld)) return false;                  // an address wearing a domain's clothes
  if (String(raw).length > 400) return false;
  return true;
}

/* ------------------------------------------------------- reading a page */

const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'" };
const unentity = (s) => String(s || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body) => {
  const key = body.toLowerCase();
  if (ENTITY[key]) return ENTITY[key];
  if (key[0] === '#') {
    const n = key[1] === 'x' ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
    return Number.isFinite(n) && n > 8 && n < 0x10ffff ? String.fromCodePoint(n) : whole;
  }
  return whole;
});
const tidy = (s, max) => unentity(s).replace(/\s+/g, ' ').replace(/\p{C}/gu, '').trim().slice(0, max);

const ATTR = (tag, name) => {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[2] != null ? m[2] : (m[3] != null ? m[3] : m[4])) : null;
};

/**
 * The three facts a card is made of, off the head of a page.
 * Open Graph first because it is what a site says about itself on purpose; the
 * <title> is the fallback, since a page with neither is a page with nothing to
 * show and gets no card at all.
 */
export function readCard(html, url) {
  const s = String(html || '');
  const head = s.slice(0, 300000).split(/<\/head>/i)[0];
  const meta = {};
  for (const m of head.matchAll(/<meta\s[^>]*>/gi)) {
    const tag = m[0];
    const key = (ATTR(tag, 'property') || ATTR(tag, 'name') || '').toLowerCase();
    const content = ATTR(tag, 'content');
    if (key && content && meta[key] == null) meta[key] = content;
  }
  const titled = (head.match(/<title[^>]*>([\s\S]{0,400}?)<\/title>/i) || [])[1] || '';
  const title = tidy(meta['og:title'] || meta['twitter:title'] || titled, 120);
  if (!title) return null;
  return {
    kind: 'site',
    url,
    domain: (hostOf(url) || '').replace(/^www\./, ''),
    title,
    description: tidy(meta['og:description'] || meta['twitter:description'] || meta.description || '', 190) || null,
  };
}

/**
 * Fetch one, or nothing.
 *
 * Redirects are followed by hand so every hop is put back through the guard:
 * a URL that passes and then 302s to somewhere on the loopback is the oldest
 * way through a check that only looked once.
 *
 * @param get  the fetch to use. Injected so the acceptance cases can serve a
 *             fixture without the checks having to be loosened for them.
 */
export async function fetchCard(url, { get = fetch, hops = 2, ms = 4000, bytes = 256 * 1024 } = {}) {
  let here = String(url);
  for (let i = 0; i <= hops; i++) {
    if (!mayFetch(here)) return null;
    let r;
    try {
      r = await get(here, {
        redirect: 'manual',
        headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': UA },
        signal: AbortSignal.timeout(ms),
      });
    } catch (e) { return null; }
    if (r.status >= 300 && r.status < 400) {
      const next = r.headers.get('location');
      if (!next) return null;
      try { here = new URL(next, here).toString(); } catch (e) { return null; }
      continue;
    }
    if (!r.ok) return null;
    if (!/text\/html|application\/xhtml/i.test(r.headers.get('content-type') || '')) return null;
    let html = '';
    try {
      if (r.body && r.body.getReader) {
        const reader = r.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          html += decoder.decode(value, { stream: true });
          if (html.length >= bytes) { try { await reader.cancel(); } catch (e) { /* done reading */ } break; }
        }
      } else html = (await r.text()).slice(0, bytes);
    } catch (e) { return null; }
    return readCard(html, here);
  }
  return null;
}

/* ------------------------------------------------------ the family cards */

const FAMILY = /^(?:www\.)?(mintface\.art|collectors\.mintface\.art)$/i;
const path = (u) => u.pathname.replace(/\/+$/, '');

/** What one of ours points at, without fetching anything. */
export function familyKind(raw) {
  let u;
  try { u = new URL(String(raw || '')); } catch (e) { return null; }
  const host = (u.hostname || '').toLowerCase();
  if (!FAMILY.test(host)) return null;
  const p = path(u);
  if (/^collectors\./i.test(host)) {
    const slug = decodeURIComponent(p.slice(1));
    return slug && !slug.includes('/') ? { kind: 'collector', slug } : { kind: 'home' };
  }
  const w = p.match(/^\/w\/(.+)$/);
  if (w) return { kind: 'work', id: decodeURIComponent(w[1]) };
  const c = p.match(/^\/c\/(.+)$/);
  if (c) return { kind: 'collection', slug: decodeURIComponent(c[1]) };
  return { kind: 'home' };
}

const STATUS = {
  available: 'Available', acquired: 'Collected', vaulted: 'In the vault',
  sold_out: 'Sold out', burned: 'Burned', uninscribed: 'Uninscribed',
};

// a display copy is already the right size; anything else goes through the
// resizer, because some of these masters are ninety megabytes
function thumbFor(work, w = 200) {
  const a = work.assets || {};
  if (a.display) return `${ASSETS}/${a.display}`;
  const src = a.image ? `${ASSETS}/${a.image}` : null;
  if (!src) return null;
  return PROXY.replace('{url}', encodeURIComponent(src.replace(/^https?:\/\//, ''))).replace('{w}', String(w));
}

/**
 * A card off our own data. Never cached: a work that sold this morning should
 * say so this afternoon, and reading the catalogue costs a request we were
 * making anyway.
 *
 * @param at        (origin, path) => parsed json, the fetch the route has
 * @param register  api/_lib/register.js, for a collector URL
 */
export async function ourCard(url, { origin, at, register } = {}) {
  const what = familyKind(url);
  if (!what) return null;

  if (what.kind === 'work') {
    const hit = await findWork(what.id).catch(() => null);
    if (!hit) return null;
    const { work, collection } = hit;
    const numeric = /^#?\d+$/.test(String(work.title || '').trim());
    const title = numeric
      ? `${collection.title} ${String(work.title).startsWith('#') ? work.title : `#${work.title}`}`
      : (work.title || 'Untitled');
    return {
      kind: 'work', url, domain: 'mintface.art',
      title,
      note: [STATUS[work.status] || null, collection.title].filter(Boolean).join(' · '),
      thumb: thumbFor(work),
    };
  }

  if (what.kind === 'collection') {
    const idx = await at(origin, 'data/index.json').catch(() => null);
    const col = idx && (idx.collections || []).find((c) => c.slug === what.slug);
    if (!col) return null;
    return {
      kind: 'collection', url, domain: 'mintface.art',
      title: col.title || what.slug,
      note: [col.year, col.medium].filter(Boolean).join(' · ') || null,
    };
  }

  if (what.kind === 'collector' && register) {
    let address = null;
    for (const [a, row] of register.rows) {
      if (row.slug && row.slug.toLowerCase() === what.slug.toLowerCase()) { address = a; break; }
    }
    if (!address) return null;
    const who = register.who(address);
    if (who.private) return null;                    // a private collector has no page to preview
    return {
      kind: 'collector', url, domain: 'collectors.mintface.art',
      title: who.name,
      note: `${wearTao(who.tao)} TAO`,
    };
  }

  return null;
}

/* --------------------------------------------------------------- keeping */

/* One card per URL, kept with the log rather than with the message: the same
   link said twice is fetched once, and the room never goes back to a site it
   has already read. A failure is kept too, for a day ... long enough that a
   page that is down does not cost every reader a timeout, short enough that a
   page that comes back is seen to. */
export const cardKey = (url) => `chat:card:${url}`;
const FAILED_FOR = 86400;

export function cardStore(pipe) {
  const parse = (s) => { try { return typeof s === 'string' ? JSON.parse(s) : s; } catch (e) { return null; } };
  return {
    async many(urls) {
      const list = [...new Set(urls || [])];
      if (!list.length) return {};
      const [rows] = await pipe([['MGET', ...list.map(cardKey)]]);
      const out = {};
      list.forEach((u, i) => { const v = parse((rows || [])[i]); if (v) out[u] = v; });
      return out;
    },
    async keep(url, card) {
      await pipe(card
        ? [['SET', cardKey(url), JSON.stringify(card)]]
        : [['SET', cardKey(url), JSON.stringify({ fail: true }), 'EX', String(FAILED_FOR)]]);
      return card;
    },
  };
}
