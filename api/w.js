import { findWork, useRequestOrigin, siteOrigin } from './_lib/data.js';
import { one, storeConfigured } from './_lib/kv.js';

/* The rail's record for a work, read straight from the store rather than
   through api/_lib/aab.js, so every work page does not load the chain client to
   answer one question. The key is aab.js's K.order. */
const railRecord = async (id) => {
  const v = await one('GET', `aab:o:${id}`);
  try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; }
};
const weiToEth = (wei) => Number(BigInt(wei) / 10n ** 12n) / 1e6;

// image_source is a URL to the same bytes somewhere more reliable. Anything
// that is not a URL is a credit, and a credit is not somewhere to fetch from.
const betterUrl = (s) => (typeof s === 'string' && /^https?:\/\//.test(s) ? s : null);

// A shared link should preview the art. Static HTML cannot carry per work meta
// tags, so /w/:id comes through here: the same page, with its own title, image
// and description written into the head before it leaves.
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ASSETS = process.env.ASSETS_PUBLIC_BASE || 'https://assets.mintface.art';
const THUMB = 'https://images.weserv.nl/?url={url}&w=1200&output=jpg&q=82';
const preview = (url) => {
  if (!url || url.startsWith('data:')) return null;
  if (url.startsWith('/')) return null;
  return THUMB.replace('{url}', encodeURIComponent(url.replace(/^https?:\/\//, '')));
};

// What a scraper should be handed. A display copy is already the right size and
// on our own domain, so it goes out as is. Anything else still goes through the
// resizer, because some of these masters are ninety megabytes.
const previewFor = (work) => {
  const a = work.assets || {};
  if (a.display) return `${ASSETS}/${a.display}`;
  if (a.image && /\.(jpe?g|png|webp|gif)$/i.test(a.image)) return preview(`${ASSETS}/${a.image}`);
  return preview(betterUrl(work.digital?.image_source) || work.digital?.image || work.image);
};

/* What a shopping agent reads without reading any docs: the work as a
   schema.org Product, with its offers. The list offer is the one a person
   pays; the rail offer is there only while a live signed order is, and its url
   is the door that serves it. */
async function jsonLd({ work, collection, title, description, url, image, origin }) {
  const d = work.digital || {};
  const nzd = work.pricing_nzd && typeof work.pricing_nzd.digital === 'number' ? work.pricing_nzd.digital : null;
  const available = work.status === 'available';
  const offers = [];
  if (nzd != null) {
    offers.push({ '@type': 'Offer', price: String(nzd), priceCurrency: 'NZD', url,
      availability: `https://schema.org/${available ? 'InStock' : 'SoldOut'}` });
  }
  if (available && storeConfigured()) {
    try {
      const rec = await railRecord(work.id);
      if (rec && Date.parse(rec.expires) > Date.now()) {
        offers.push({ '@type': 'Offer', price: String(weiToEth(rec.rail_wei)), priceCurrency: 'ETH',
          url: `${origin}/ai/buy/${encodeURIComponent(work.id)}`, availability: 'https://schema.org/InStock',
          priceValidUntil: rec.expires.slice(0, 10),
          description: 'The agent rail: 25% under list for AI buyers, settled on Ethereum by filling a signed Seaport order. GET the url for the order.' });
      }
    } catch { /* the list offer stands on its own */ }
  }
  const ld = {
    '@context': 'https://schema.org',
    '@type': ['Product', 'VisualArtwork'],
    name: title,
    description: String(description).replace(/&middot;/g, '·'),
    url,
    image,
    creator: { '@type': 'Person', name: 'MintFace', alternateName: 'Ryan Jennings', url: 'https://mintface.art' },
    brand: { '@type': 'Brand', name: 'MintFace' },
    ...(collection && collection.title ? { isPartOf: { '@type': 'CreativeWorkSeries', name: collection.title } } : {}),
    ...(work.year ? { dateCreated: String(work.year) } : {}),
    ...(d.contract ? { identifier: `${d.chain || 'ethereum'}:${d.contract}:${d.token_id ?? ''}` } : {}),
    ...(offers.length ? { offers: offers.length === 1 ? offers[0] : offers } : {}),
  };
  return `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`;
}

export async function GET(request) {
  const origin = useRequestOrigin(request);
  const id = decodeURIComponent((new URL(request.url).pathname.match(/^\/w\/(.+?)\/?$/) || [])[1] || '');

  const page = await fetch(`${origin}/w.html`);
  let html = await page.text();

  let hit = null;
  try { hit = id ? await findWork(id) : null; } catch { /* fall through to the plain page */ }

  if (hit) {
    const { work, collection } = hit;
    const numeric = /^#?\d+$/.test((work.title || '').trim());
    const title = numeric ? `${collection.title} ${work.title.startsWith('#') ? work.title : '#' + work.title}` : (work.title || 'Untitled');
    const price = work.pricing_nzd && work.pricing_nzd.digital != null
      ? `NZ$${Math.round(work.pricing_nzd.digital).toLocaleString('en-NZ')}`
      : null;
    const bits = [collection.title, work.year || collection.year, price].filter(Boolean);
    const description = (work.statement || bits.join(' &middot; ') || `${title} by MintFace`).slice(0, 200);
    /* The card is generated from the catalogue rather than being the artwork
       itself, so a share carries the price, the status and the attribution as
       they are right now. previewFor stays as the fallback for anything the
       renderer cannot draw. */
    const image = `${origin}/api/og?work=${encodeURIComponent(work.id)}`;
    void previewFor;
    const url = `${origin}/w/${encodeURIComponent(work.id)}`;

    const meta = [
      `<title>${esc(title)} ... MintFace</title>`,
      `<meta name="description" content="${esc(description)}">`,
      `<meta property="og:type" content="article">`,
      `<meta property="og:site_name" content="MintFace">`,
      `<meta property="og:title" content="${esc(title)}">`,
      `<meta property="og:description" content="${esc(description)}">`,
      `<meta property="og:url" content="${esc(url)}">`,
      image ? `<meta property="og:image" content="${esc(image)}">` : '',
      image ? `<meta property="og:image:alt" content="${esc(title)}">` : '',
      `<meta property="og:image:width" content="1200">`,
      `<meta property="og:image:height" content="630">`,
      `<meta name="twitter:card" content="summary_large_image">`,
      `<meta name="twitter:title" content="${esc(title)}">`,
      `<meta name="twitter:description" content="${esc(description)}">`,
      image ? `<meta name="twitter:image" content="${esc(image)}">` : '',
      await jsonLd({ work, collection, title, description, url, image, origin }),
    ].filter(Boolean).join('\n');

    html = html
      .replace(/<title>[\s\S]*?<\/title>\s*/, '')
      .replace(/<meta name="description"[^>]*>\s*/, '')
      .replace(/<meta property="og:type"[^>]*>\s*/, '')
      .replace(/<meta property="og:site_name"[^>]*>\s*/, '')
      .replace('</head>', `${meta}\n</head>`);
  }

  return new Response(html, {
    status: hit || !id ? 200 : 404,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=86400',
    },
  });
}
