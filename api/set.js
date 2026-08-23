import { siteIndex, siteOrigin, useRequestOrigin } from './_lib/data.js';
import { readState, stateConfigured } from './_lib/state.js';

/* The Geodetic Set: one work from each of five variants.

   The definition is not here any more. It lives in data/sets.json, which the
   collector meters on collectors.mintface.art read as well ... one truth, two
   surfaces. A set changed there changes what is sold and what is measured, in
   the same commit. */
import { SET } from './_lib/sets.js';
export { SET };

const json = (b, s = 200) => new Response(JSON.stringify(b), {
  status: s,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

const sellable = (w) =>
  w.status === 'available'
  && w.offers && w.offers.digital === true
  && w.pricing_nzd && typeof w.pricing_nzd.digital === 'number' && w.pricing_nzd.digital > 0;

// The live ledger wins over the catalog. Read once for the whole set: asking
// per work meant a couple of hundred round trips to answer one page.
async function ledger() {
  if (!stateConfigured()) return {};
  try {
    const { state } = await readState();
    return (state && state.works) || {};
  } catch { return {}; }
}

export async function GET(request) {
  useRequestOrigin(request);
  await siteIndex();
  const live = await ledger();
  const out = [];
  for (const slot of SET.slots) {
    const col = await fetch(`${siteOrigin()}/data/c/${slot.key}.json`)
      .then((r) => (r.ok ? r.json() : null)).catch(() => null);
    let works = (col && col.works) || [];
    if (slot.only) works = works.filter((w) => slot.only.includes(w.id));
    works = works.map((w) => (live[w.id]?.status ? { ...w, status: live[w.id].status } : w));
    works = works.filter(sellable);
    out.push({
      key: slot.key,
      title: slot.title,
      works: works.map((w) => ({
        id: w.id,
        title: w.title,
        nzd: w.pricing_nzd.digital,
        image: w.assets && (w.assets.display || w.assets.image)
          ? `https://assets.mintface.art/${w.assets.display || w.assets.image}`
          : (w.digital?.image_source || w.digital?.image || w.image || null),
        aspect: w.orientation === 'portrait' ? 0.75 : w.orientation === 'landscape' ? 1.4 : 1,
      })),
    });
  }
  // a set is only as available as its scarcest slot
  const remaining = out.reduce((n, s) => Math.min(n, s.works.length), Infinity);
  return json({
    slug: SET.slug,
    title: SET.title,
    slots: out,
    remaining: remaining === Infinity ? 0 : remaining,
    complete: out.every((s) => s.works.length > 0),
  });
}
