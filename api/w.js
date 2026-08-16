import { findWork, useRequestOrigin, siteOrigin } from './_lib/data.js';

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
  return preview(work.digital?.image_source || work.digital?.image || work.image);
};

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
    const image = previewFor(work);
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
      `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">`,
      `<meta name="twitter:title" content="${esc(title)}">`,
      `<meta name="twitter:description" content="${esc(description)}">`,
      image ? `<meta name="twitter:image" content="${esc(image)}">` : '',
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
