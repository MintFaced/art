import { siteIndex, useRequestOrigin, siteOrigin } from './_lib/data.js';
import { putObject, alreadyThere, r2Configured } from './_lib/r2.js';

// Walks the catalog, pulls every artwork from wherever it currently lives, and
// puts a copy in R2 keyed by work id. IPFS and marketplace CDNs are too slow and
// too changeable to sell from; this makes the origin a fallback rather than the
// path everyone waits on.
const PUBLIC = process.env.ASSETS_PUBLIC_BASE || 'https://assets.mintface.art';
const json = (b, s = 200) => new Response(JSON.stringify(b, null, 1), { status: s, headers: { 'content-type': 'application/json' } });

const extFor = (type, url) => {
  const m = (url.match(/\.([a-z0-9]{2,4})(\?|#|$)/i) || [])[1];
  if (m) return m.toLowerCase();
  if (/svg/.test(type)) return 'svg';
  if (/png/.test(type)) return 'png';
  if (/gif/.test(type)) return 'gif';
  if (/mp4/.test(type)) return 'mp4';
  if (/webp/.test(type)) return 'webp';
  return 'jpg';
};

export async function GET(request) {
  useRequestOrigin(request);
  const url = new URL(request.url);
  // WARM_KEY exists so this can be run without handing out the cron secret
  const allowed = [process.env.CRON_SECRET, process.env.WARM_KEY].filter(Boolean);
  const given = (request.headers.get('authorization') || `Bearer ${url.searchParams.get('key') || ''}`).replace(/^Bearer\s+/, '');
  if (!allowed.length || !allowed.includes(given)) return new Response('no', { status: 401 });
  if (!r2Configured()) return json({ error: 'R2 is not configured' }, 503);

  const only = url.searchParams.get('collection');
  const limit = Number(url.searchParams.get('limit') || 40);
  const dryRun = url.searchParams.get('dry') === '1';

  const idx = await siteIndex();
  const slugs = (only ? [only] : idx.collections.map((c) => c.slug)).filter(Boolean);

  const done = [], skipped = [], failed = [];
  let budget = limit;

  for (const slug of slugs) {
    if (budget <= 0) break;
    const col = await fetch(`${siteOrigin()}/data/c/${slug}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!col) continue;

    for (const w of col.works || []) {
      if (budget <= 0) break;
      const targets = [
        ['image', w.digital?.image_source || w.digital?.image || w.image],
        ['animation', w.digital?.animation],
      ].filter(([, u]) => typeof u === 'string' && /^https?:\/\//.test(u));

      for (const [kind, src] of targets) {
        if (budget <= 0) break;
        const idPart = w.id || `${slug}-${w.token_id || 'x'}`;
        const guessKey = `${slug}/${idPart}-${kind}`;
        if (await alreadyThere(PUBLIC, `${guessKey}.jpg`) || await alreadyThere(PUBLIC, `${guessKey}.svg`)) {
          skipped.push(idPart);
          continue;
        }
        budget--;
        if (dryRun) { done.push({ id: idPart, kind, src, key: guessKey }); continue; }
        try {
          const res = await fetch(src, { headers: { accept: 'image/*,video/*,*/*' } });
          if (!res.ok) throw new Error(`origin ${res.status}`);
          const type = res.headers.get('content-type') || '';
          const buf = Buffer.from(await res.arrayBuffer());
          if (!buf.length) throw new Error('empty body');
          const key = `${guessKey}.${extFor(type, src)}`;
          await putObject(key, buf, type.split(';')[0] || undefined);
          done.push({ id: idPart, kind, key, bytes: buf.length });
        } catch (err) {
          failed.push({ id: idPart, kind, src: src.slice(0, 90), why: String(err.message || err) });
        }
      }
    }
  }

  return json({
    warmed: done.length,
    skipped: skipped.length,
    failed: failed.length,
    budget_left: budget,
    done: done.slice(0, 30),
    failures: failed.slice(0, 30),
  });
}
