import { siteIndex, useRequestOrigin } from './_lib/data.js';

/* Collection pages, with their own meta.
 *
 * c.html is one file serving thirty collections, so its head can only ever
 * describe the site in general. A crawler does not run the script that fills
 * the page in, which means every collection has been sharing the same preview.
 * The same trick /w/ already uses: fetch the static page, put the right head
 * on it, hand it back.
 */
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function GET(request) {
  const origin = useRequestOrigin(request);
  const slug = decodeURIComponent((new URL(request.url).pathname.match(/^\/c\/(.+?)\/?$/) || [])[1] || '');

  const page = await fetch(`${origin}/c.html`);
  let html = await page.text();

  let meta = null;
  try {
    const idx = await siteIndex();
    meta = (idx.collections || []).find((c) => c.slug === slug) || null;
  } catch (e) { /* the plain page is still a page */ }

  if (meta) {
    const n = meta.counts || {};
    const bits = [meta.year, meta.genre || meta.medium, n.works ? `${n.works} works` : null,
      n.available ? `${n.available} available` : null].filter(Boolean);
    const description = String(meta.card_statement || meta.statement || bits.join(' · ') || `${meta.title} by MintFace`).slice(0, 200);
    const image = `${origin}/api/og?collection=${encodeURIComponent(slug)}`;
    const url = `${origin}/c/${encodeURIComponent(slug)}`;
    const head = [
      `<title>${esc(meta.title)} ... MintFace</title>`,
      `<meta name="description" content="${esc(description)}">`,
      `<meta property="og:type" content="website">`,
      `<meta property="og:site_name" content="MintFace">`,
      `<meta property="og:title" content="${esc(meta.title)}">`,
      `<meta property="og:description" content="${esc(description)}">`,
      `<meta property="og:url" content="${esc(url)}">`,
      `<meta property="og:image" content="${esc(image)}">`,
      `<meta property="og:image:width" content="1200">`,
      `<meta property="og:image:height" content="630">`,
      `<meta property="og:image:alt" content="${esc(meta.title)}">`,
      `<meta name="twitter:card" content="summary_large_image">`,
      `<meta name="twitter:title" content="${esc(meta.title)}">`,
      `<meta name="twitter:description" content="${esc(description)}">`,
      `<meta name="twitter:image" content="${esc(image)}">`,
    ].join('\n');
    html = html
      .replace(/<title>[\s\S]*?<\/title>\s*/, '')
      .replace(/<meta name="description"[^>]*>\s*/, '')
      .replace(/<meta property="og:type"[^>]*>\s*/, '')
      .replace(/<meta property="og:site_name"[^>]*>\s*/, '')
      .replace('</head>', `${head}\n</head>`);
  }

  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400' },
  });
}
