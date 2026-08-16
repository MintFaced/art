// The catalog is static and public, so the functions read it over HTTP from the
// deployment they are running in rather than bundling a 5 MB file into every one.
// The origin of the request is the deployment the function is running in, which
// works in production, on previews and under vercel dev without any config.
const withScheme = (host) => (/^localhost|^127\./.test(host) ? `http://${host}` : `https://${host}`);

const ENV_BASE = process.env.SITE_ORIGIN
  || (process.env.VERCEL_URL ? withScheme(process.env.VERCEL_URL) : null)
  || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? withScheme(process.env.VERCEL_PROJECT_PRODUCTION_URL) : null)
  || 'http://localhost:3000';

let BASE = ENV_BASE;

export function useRequestOrigin(request) {
  try {
    if (request && request.url) BASE = new URL(request.url).origin;
  } catch { /* keep the env fallback */ }
  return BASE;
}

let indexCache = null;
let indexAt = 0;
const TTL = 60 * 1000;

export async function siteIndex() {
  if (indexCache && Date.now() - indexAt < TTL) return indexCache;
  const r = await fetch(`${BASE}/data/index.json`);
  if (!r.ok) throw new Error(`index ${r.status}`);
  indexCache = await r.json();
  indexAt = Date.now();
  return indexCache;
}

export async function findWork(id) {
  const idx = await siteIndex();
  const slug = idx.work_index[id];

  if (slug) {
    const r = await fetch(`${BASE}/data/c/${slug}.json`);
    if (r.ok) {
      const col = await r.json();
      let work = (col.works || []).find((w) => w.id === id);
      if (!work && col.children) {
        for (const ch of col.children) {
          const hit = (ch.works || []).find((w) => w.id === id);
          if (hit) { work = hit; break; }
        }
      }
      if (work) return { work, collection: col, meta: idx._meta };
    }
  }

  // Recent Work is written by the studio and read from source, since there is
  // no build step to fold a new painting into the split. It will not be in the
  // generated index at all, so this runs whether or not the id was found there.
  try {
    const src = await fetch(`${BASE}/data/source/recent-work.json`).then((r) => (r.ok ? r.json() : null));
    const hit = src && (src.works || []).find((w) => w.id === id && w.hidden !== true);
    if (hit) {
      const p = hit.pricing_nzd || {};
      const shaped = {
        ...hit,
        collection: 'recent-work',
        status: hit.status || 'available',
        offers: {
          digital: p.digital > 0,
          painting: p.painting > 0,
          both: p.both > 0,
        },
        digital: { minted: false, chain: 'ethereum', standard: 'ERC-721', image: hit.image || null },
      };
      // the collection carries whether framing is on offer and what it costs,
      // and the price of a framed option is derived from that, never sent
      const meta = (idx.collections || []).find((c) => c.slug === 'recent-work') || {};
      const cfg = idx.config || {};
      const col = {
        ...(src.collection || {}),
        slug: 'recent-work',
        physical: true,
        ...(meta.framing ? {
          framing: true,
          framing_fee_nzd: cfg.framing_fee_nzd,
          framing_fee_quoted: cfg.framing_fee_quoted,
        } : {}),
      };
      return { work: shaped, collection: col, meta: idx._meta };
    }
  } catch { /* the studio file is optional */ }

  return null;
}

// A framed option is the painting option plus one fee. It is never a stored
// price, so what a buyer is charged is always derived here rather than sent.
export const WHAT_BASE = {
  digital: 'digital',
  painting: 'painting',
  both: 'both',
  painting_framed: 'painting',
  both_framed: 'both',
};
export const isFramed = (what) => what === 'painting_framed' || what === 'both_framed';

// how a purchase reads in an email
export function describeWhat(what) {
  const base = WHAT_BASE[what] || 'digital';
  const painting = isFramed(what) ? 'the framed painting' : 'the painting';
  if (base === 'both') return `${painting} and the digital work`;
  if (base === 'painting') return painting;
  return 'the digital work';
}
export const includesPainting = (what) => {
  const base = WHAT_BASE[what];
  return base === 'painting' || base === 'both';
};

// what: digital | painting | both, framed or not. Prices live in the catalog
// only, never in the request, so a tampered client cannot set its own.
export function priceNZD(work, what, collection) {
  const base = WHAT_BASE[what] || what;
  const p = work.pricing_nzd || {};
  const v = p[base];
  if (!(typeof v === 'number' && v > 0)) return null;
  if (!isFramed(what)) return v;
  // framing is only on offer where the collection says so
  if (!collection || collection.framing !== true) return null;
  const fee = Number(collection.framing_fee_nzd);
  if (!(fee > 0)) return null;
  return v + fee;
}

// Some collections are listed in ETH. There the ETH figure is the price and the
// card currencies are converted from it, which is the reverse of everything else.
export function priceETH(work, what) {
  if (work.priced_in !== 'ETH') return null;
  // nothing listed in ETH offers framing, and mixing the two would mean
  // converting a fee back and forth on every quote
  if (isFramed(what)) return null;
  const v = (work.pricing_eth || {})[what];
  return typeof v === 'number' && v > 0 ? v : null;
}

export const siteOrigin = () => BASE;
