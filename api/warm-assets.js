import { siteIndex, useRequestOrigin, siteOrigin } from './_lib/data.js';
import { putObject, deleteObject, listObjects, alreadyThere, r2Configured } from './_lib/r2.js';

// image_source is a URL to the same bytes somewhere more reliable. Anything
// that is not a URL is a credit, and a credit is not somewhere to fetch from.
const betterUrl = (s) => (typeof s === 'string' && /^https?:\/\//.test(s) ? s : null);

// Walks the catalog, pulls every artwork from wherever it currently lives, and
// puts a copy in R2 keyed by work id. IPFS and marketplace CDNs are too slow and
// too changeable to sell from; this makes the origin a fallback rather than the
// path everyone waits on.
const PUBLIC = process.env.ASSETS_PUBLIC_BASE || 'https://assets.mintface.art';
const json = (b, s = 200) => new Response(JSON.stringify(b, null, 1), { status: s, headers: { 'content-type': 'application/json' } });

// what the server says it is beats what the URL implies: several of these
// masters are TIFFs behind an extensionless arweave URL
const BY_TYPE = [
  [/svg/, 'svg'], [/png/, 'png'], [/gif/, 'gif'], [/webp/, 'webp'], [/avif/, 'avif'],
  [/tiff/, 'tif'], [/mp4/, 'mp4'], [/webm/, 'webm'], [/quicktime|mov/, 'mov'], [/jpe?g/, 'jpg'],
];
const extFor = (type, url) => {
  for (const [re, ext] of BY_TYPE) if (re.test(type)) return ext;
  const m = (url.match(/\.([a-z0-9]{2,4})(\?|#|$)/i) || [])[1];
  return m ? m.toLowerCase() : 'bin';
};

export async function POST(request) {
  return GET(request);
}

export async function GET(request) {
  useRequestOrigin(request);
  const url = new URL(request.url);
  // WARM_KEY exists so this can be run without handing out the cron secret
  const allowed = [process.env.CRON_SECRET, process.env.WARM_KEY].filter(Boolean);
  const given = (request.headers.get('authorization') || `Bearer ${url.searchParams.get('key') || ''}`).replace(/^Bearer\s+/, '');
  if (!allowed.length || !allowed.includes(given)) return new Response('no', { status: 401 });
  if (!r2Configured()) return json({ error: 'R2 is not configured' }, 503);

  // put takes a body and stores it at a key. The warm run pulls from a URL,
  // but a painting photographed this morning is only on a laptop.
  if (request.method === 'POST' && url.searchParams.get('put')) {
    const key = url.searchParams.get('put');
    if (!/^[a-z0-9][a-z0-9/_.-]{2,120}$/i.test(key)) return json({ error: 'that is not a key' }, 400);
    const type = request.headers.get('content-type') || 'application/octet-stream';
    if (!/^(image|video)\//.test(type)) return json({ error: 'images and video only' }, 415);
    const buf = Buffer.from(await request.arrayBuffer());
    if (!buf.length) return json({ error: 'empty body' }, 400);
    if (buf.length > 25 * 1024 * 1024) return json({ error: 'over 25MB' }, 413);
    await putObject(key, buf, type.split(';')[0]);
    return json({ ok: true, key, bytes: buf.length, url: `${PUBLIC}/${key}` });
  }

  // purge takes a comma separated list of keys, for clearing a bad run
  const purge = url.searchParams.get('purge');
  if (purge) {
    const keys = purge.split(',').map((k) => k.trim()).filter(Boolean);
    const gone = [], stuck = [];
    for (const k of keys) {
      try { await deleteObject(k); gone.push(k); }
      catch (e) { stuck.push({ key: k, why: String(e.message || e) }); }
    }
    return json({ deleted: gone, failed: stuck });
  }

  // survey mode: what is actually in the bucket, and how big
  if (url.searchParams.get('list')) {
    const all = await listObjects(url.searchParams.get('prefix') || '');
    const bytes = all.reduce((n, o) => n + o.size, 0);
    const byCollection = {};
    for (const o of all) {
      const slug = o.key.split('/')[0];
      const c = (byCollection[slug] ||= { objects: 0, bytes: 0 });
      c.objects++;
      c.bytes += o.size;
    }
    return json({
      objects: all.length,
      bytes,
      largest: [...all].sort((a, b) => b.size - a.size).slice(0, 40),
      by_collection: byCollection,
      keys: url.searchParams.get('keys') ? all.map((o) => `${o.key} ${o.size}`) : undefined,
    });
  }

  const only = url.searchParams.get('collection');
  const limit = Number(url.searchParams.get('limit') || 40);
  // works already dealt with, so a long collection does not re-check its whole
  // head on every pass
  const offset = Number(url.searchParams.get('offset') || 0);
  const dryRun = url.searchParams.get('dry') === '1';

  const idx = await siteIndex();
  const slugs = (only ? [only] : idx.collections.filter((c) => c.display !== false).map((c) => c.slug)).filter(Boolean);

  const done = [], skipped = [], failed = [];
  let budget = limit;
  let cursor = only ? offset : 0;

  for (const slug of slugs) {
    if (budget <= 0) break;
    const col = await fetch(`${siteOrigin()}/data/c/${slug}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!col) continue;

    const works = (col.works || []).slice(only ? offset : 0);
    let seen = only ? offset : 0;
    for (const w of works) {
      if (budget <= 0) break;
      seen++;
      const targets = [
        ['image', betterUrl(w.digital?.image_source) || w.digital?.image || w.image],
        ['animation', w.digital?.animation],
      ].filter(([, u]) => typeof u === 'string' && /^https?:\/\//.test(u));

      cursor = seen;
      for (const [kind, src] of targets) {
        if (budget <= 0) break;
        const idPart = w.id || `${slug}-${w.token_id || 'x'}`;
        const guessKey = `${slug}/${idPart}-${kind}`;
        const exts = ['jpg', 'tif', 'png', 'svg', 'gif', 'webp', 'mp4'];
        let found = false;
        for (const ext of exts) { if (await alreadyThere(PUBLIC, `${guessKey}.${ext}`)) { found = true; break; } }
        if (found) {
          skipped.push(idPart);
          continue;
        }
        budget--;
        if (dryRun) { done.push({ id: idPart, kind, src, key: guessKey }); continue; }
        // one gateway being slow or down is not the file being gone, so an
        // ipfs source gets a second gateway before it counts as a failure
        const attempts = [src];
        const cid = src.match(/\/ipfs\/(.+)$/);
        if (cid && !/\/\/ipfs\.io\//.test(src)) attempts.push(`https://ipfs.io/ipfs/${cid[1]}`);
        try {
          let res, lastWhy;
          for (const attempt of attempts) {
            try {
              res = await fetch(attempt, { headers: { accept: 'image/*,video/*,*/*' } });
              if (res.ok) break;
              lastWhy = `origin ${res.status}`;
              res = null;
            } catch (e) { lastWhy = String(e.message || e); res = null; }
          }
          if (!res) throw new Error(lastWhy || 'no gateway answered');
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
    next_offset: cursor,
    budget_left: budget,
    done: done.slice(0, 30),
    failures: failed.slice(0, 30),
  });
}
