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
  if (!slug) return null;
  const r = await fetch(`${BASE}/data/c/${slug}.json`);
  if (!r.ok) return null;
  const col = await r.json();
  let work = (col.works || []).find((w) => w.id === id);
  if (!work && col.children) {
    for (const ch of col.children) {
      const hit = (ch.works || []).find((w) => w.id === id);
      if (hit) { work = hit; break; }
    }
  }
  return work ? { work, collection: col, meta: idx._meta } : null;
}

// what: digital | painting | both. Prices are NZD and live in the catalog only,
// never in the request, so a tampered client cannot set its own price.
export function priceNZD(work, what) {
  const p = work.pricing_nzd || {};
  const v = p[what];
  return typeof v === 'number' && v > 0 ? v : null;
}

export const siteOrigin = () => BASE;
