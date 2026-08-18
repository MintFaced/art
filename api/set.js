import { siteIndex, siteOrigin, useRequestOrigin } from './_lib/data.js';
import { readState, stateConfigured } from './_lib/state.js';

/* The Geodetic Set: one work from each of five variants.

   The definition lives here rather than in the page, because the page can be
   edited by whoever is looking at it and the price cannot. Everything the
   builder offers is read from the same catalog the rest of the site reads, and
   filtered to what is actually for sale right now. */
export const SET = {
  slug: 'geodetic',
  title: 'The Geodetic Set',
  slots: [
    { key: 'geodetic-world', title: 'Geodetic World' },
    { key: 'geodetic-moments', title: 'Geodetic Moments' },
    { key: 'geodetic-memory', title: 'Geodetic Memory' },
    // Light or Dark satisfies this slot. Signal and Patrimora do not.
    { key: 'geodetic-onchain', title: 'Geodetic On-Chain', only: ['geodetic-onchain-1', 'geodetic-onchain-2'] },
    { key: 'geodetica', title: 'Geodetica' },
  ],
};

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
