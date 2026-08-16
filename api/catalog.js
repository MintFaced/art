import { siteIndex, siteOrigin, useRequestOrigin } from './_lib/data.js';
import { nzdToUsd } from './_lib/fx.js';

// The catalog, shaped for something that is reading rather than looking. The
// site's own data files are split for the browser; this puts a work's contract,
// token and price in one place so an agent does not have to learn our layout.
const json = (b, s = 200) => new Response(JSON.stringify(b, null, 1), {
  status: s,
  headers: {
    'content-type': 'application/json',
    'cache-control': 'public, max-age=300',
    'access-control-allow-origin': '*',
  },
});

// what a machine needs to decide and to act, and nothing else
function shape(w, col, rates) {
  const d = w.digital || {};
  const p = w.pricing_nzd || {};
  const nzd = [p.both, p.painting, p.digital].find((x) => typeof x === 'number' && x > 0) ?? null;
  const image = w.assets && w.assets.image
    ? `https://assets.mintface.art/${w.assets.image}`
    : (d.image_source && /^https?:/.test(d.image_source) ? d.image_source : d.image || null);
  return {
    id: w.id,
    title: w.title || null,
    collection: col.slug,
    year: w.year || col.year || null,
    status: w.status,
    chain: d.chain || null,
    standard: d.standard || null,
    contract: d.contract || null,
    token_id: d.token_id || null,
    edition: w.edition && w.edition.type === 'edition'
      ? { minted: w.edition.minted ?? null, live: w.edition.live ?? null }
      : null,
    price: nzd == null ? null : {
      nzd,
      usd: rates.usd ? Math.round(nzd * rates.usd) : null,
      eth: rates.eth ? Number((nzd * rates.eth).toFixed(5)) : null,
      listed_eth: w.listed_eth ?? null,
    },
    image,
    url: `${siteOrigin()}/w/${encodeURIComponent(w.id)}`,
  };
}

async function rates() {
  const out = { usd: null, eth: null };
  try { out.usd = await nzdToUsd(); } catch { /* quoted in NZD only */ }
  try {
    const r = await fetch('https://api.coinbase.com/v2/prices/ETH-NZD/spot').then((x) => x.json());
    const amount = Number(r?.data?.amount);
    if (amount > 0) out.eth = 1 / amount;
  } catch { /* quoted in NZD only */ }
  return out;
}

export async function GET(request) {
  useRequestOrigin(request);
  const url = new URL(request.url);
  const only = url.searchParams.get('collection');
  const idx = await siteIndex();
  const fx = await rates();

  const wanted = idx.collections.filter((c) => (only ? c.slug === only : true) && c.slug !== 'the-vault');
  if (only && !wanted.length) return json({ error: 'no such collection' }, 404);

  const out = [];
  for (const c of wanted) {
    const col = await fetch(`${siteOrigin()}/data/c/${c.slug}.json`)
      .then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!col) continue;
    out.push({
      slug: c.slug,
      title: c.title,
      year: c.year,
      genre: c.genre || null,
      medium: c.medium || null,
      statement: c.statement || null,
      counts: c.counts,
      contracts: col.contracts || null,
      works: (col.works || []).filter((w) => w.status !== 'burned').map((w) => shape(w, c, fx)),
    });
  }

  return json({
    artist: 'MintFace, Ryan Jennings, Hastings, New Zealand',
    site: siteOrigin(),
    currency: { master: 'NZD', note: 'Prices are stored in NZD. USD and ETH are quoted live and move with the rate.' },
    rates: { nzd_to_usd: fx.usd, nzd_to_eth: fx.eth, at: new Date().toISOString() },
    agents: 'Agents are welcome to purchase autonomously. See /llms.txt and /ai.',
    collections: out,
  });
}
