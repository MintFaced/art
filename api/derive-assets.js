import sharp from 'sharp';
import { siteIndex, useRequestOrigin, siteOrigin } from './_lib/data.js';
import { putObject, alreadyThere, r2Configured } from './_lib/r2.js';

// The warm run stores masters, because the master is the work. Masters are not
// what a browser should be asked to download: the Geodetic World PNGs are 90MB
// each. This makes a display copy beside each one, keyed -display.webp, so the
// site can serve something sane and still have the master a click away.
const PUBLIC = process.env.ASSETS_PUBLIC_BASE || 'https://assets.mintface.art';
const json = (b, s = 200) => new Response(JSON.stringify(b, null, 1), { status: s, headers: { 'content-type': 'application/json' } });

// under this, the master is already a reasonable thing to send down the wire
const SMALL = 600 * 1024;
const LONG_EDGE = 2000;
// sharp reads these; video and vector are left alone
const RASTER = ['jpg', 'png', 'webp', 'avif', 'tif', 'gif'];
const MASTER_EXTS = ['jpg', 'png', 'svg', 'webp', 'gif', 'tif', 'avif', 'mp4', 'webm', 'mov'];

// what is actually stored for this work, and how big
async function findMaster(slug, id, kind) {
  for (const ext of MASTER_EXTS) {
    const key = `${slug}/${id}-${kind}.${ext}`;
    try {
      const r = await fetch(`${PUBLIC}/${key}`, { method: 'HEAD' });
      if (r.ok) return { key, ext, bytes: Number(r.headers.get('content-length') || 0) };
    } catch { /* try the next extension */ }
  }
  return null;
}

export async function GET(request) {
  useRequestOrigin(request);
  const url = new URL(request.url);
  const allowed = [process.env.CRON_SECRET, process.env.WARM_KEY].filter(Boolean);
  const given = (request.headers.get('authorization') || `Bearer ${url.searchParams.get('key') || ''}`).replace(/^Bearer\s+/, '');
  if (!allowed.length || !allowed.includes(given)) return new Response('no', { status: 401 });
  if (!r2Configured()) return json({ error: 'R2 is not configured' }, 503);

  const only = url.searchParams.get('collection');
  const limit = Number(url.searchParams.get('limit') || 8);
  const offset = Number(url.searchParams.get('offset') || 0);
  const dryRun = url.searchParams.get('dry') === '1';

  const idx = await siteIndex();
  const slugs = (only ? [only] : idx.collections.map((c) => c.slug)).filter(Boolean);

  const made = [], skipped = [], failed = [];
  let budget = limit;
  let cursor = only ? offset : 0;

  for (const slug of slugs) {
    if (budget <= 0) break;
    const col = await fetch(`${siteOrigin()}/data/c/${slug}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!col) continue;

    let seen = only ? offset : 0;
    for (const w of (col.works || []).slice(only ? offset : 0)) {
      if (budget <= 0) break;
      seen++;
      cursor = seen;
      const id = w.id || `${slug}-${w.token_id || 'x'}`;
      const displayKey = `${slug}/${id}-display.webp`;

      if (await alreadyThere(PUBLIC, displayKey)) { skipped.push({ id, why: 'already made' }); continue; }
      const master = await findMaster(slug, id, 'image');
      if (!master) { skipped.push({ id, why: 'no master warmed' }); continue; }
      if (!RASTER.includes(master.ext)) { skipped.push({ id, why: `${master.ext} is not resizable` }); continue; }
      if (master.bytes && master.bytes < SMALL) { skipped.push({ id, why: 'master is already small' }); continue; }

      budget--;
      if (dryRun) { made.push({ id, from: master.key, bytes: master.bytes, key: displayKey }); continue; }
      try {
        const res = await fetch(`${PUBLIC}/${master.key}`);
        if (!res.ok) throw new Error(`master ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        const out = await sharp(buf, { limitInputPixels: 2e9, sequentialRead: true, animated: master.ext === 'gif' })
          .rotate()
          .resize({ width: LONG_EDGE, height: LONG_EDGE, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 82, effort: 4 })
          .toBuffer();
        await putObject(displayKey, out, 'image/webp');
        made.push({ id, key: displayKey, from: master.bytes, to: out.length });
      } catch (err) {
        failed.push({ id, master: master.key, why: String(err.message || err) });
      }
    }
  }

  return json({
    made: made.length,
    skipped: skipped.length,
    failed: failed.length,
    next_offset: cursor,
    budget_left: budget,
    saved_bytes: made.reduce((n, m) => n + Math.max(0, (m.from || 0) - (m.to || 0)), 0),
    done: made.slice(0, 20),
    failures: failed.slice(0, 20),
  });
}
