import sharp from 'sharp';
import ffmpeg from 'ffmpeg-static';
import { execFile } from 'node:child_process';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { promisify } from 'node:util';
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
const MOVING = ['mp4', 'webm', 'mov'];
// a film of a painting does not need to arrive at full master weight
const VIDEO_SMALL = 8 * 1024 * 1024;
const VIDEO_WIDTH = 1280;
const run = promisify(execFile);
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

// One video down to something a browser can start playing immediately. The
// master stays where it is; this is the copy the page loads.
async function transcode(sourceUrl, key) {
  const inPath = `/tmp/in-${key.replace(/[^a-z0-9]/gi, '_')}`;
  const outPath = `${inPath}.out.mp4`;
  try {
    const res = await fetch(sourceUrl);
    if (!res.ok) throw new Error(`master ${res.status}`);
    await writeFile(inPath, Buffer.from(await res.arrayBuffer()));
    await run(ffmpeg, [
      '-y', '-i', inPath,
      // never upscale, keep even dimensions or h264 refuses
      '-vf', `scale='min(${VIDEO_WIDTH},iw)':-2`,
      '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'veryfast', '-crf', '26',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '96k',
      // the header goes first so playback can start before the file arrives
      '-movflags', '+faststart',
      outPath,
    ], { maxBuffer: 1 << 24 });
    const out = await readFile(outPath);
    if (!out.length) throw new Error('ffmpeg produced nothing');
    return out;
  } finally {
    await unlink(inPath).catch(() => {});
    await unlink(outPath).catch(() => {});
  }
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

      // a work can carry both a still and a film, and both want a light copy
      const wants = [];
      const stillMaster = await findMaster(slug, id, 'image');
      const filmMaster = await findMaster(slug, id, 'animation')
        || (stillMaster && MOVING.includes(stillMaster.ext) ? stillMaster : null);

      if (stillMaster && RASTER.includes(stillMaster.ext)) {
        wants.push({ kind: 'still', master: stillMaster, key: displayKey, small: SMALL });
      }
      if (filmMaster && MOVING.includes(filmMaster.ext)) {
        wants.push({ kind: 'film', master: filmMaster, key: `${slug}/${id}-display.mp4`, small: VIDEO_SMALL });
      }
      if (!wants.length) {
        skipped.push({ id, why: stillMaster ? `${stillMaster.ext} is not resizable` : 'no master warmed' });
        continue;
      }

      for (const want of wants) {
        if (budget <= 0) break;
        if (await alreadyThere(PUBLIC, want.key)) { skipped.push({ id, why: `${want.kind} already made` }); continue; }
        if (want.master.bytes && want.master.bytes < want.small) { skipped.push({ id, why: `${want.kind} master is already small` }); continue; }

        budget--;
        if (dryRun) { made.push({ id, from: want.master.key, bytes: want.master.bytes, key: want.key }); continue; }
        try {
          let out, type;
          if (want.kind === 'film') {
            out = await transcode(`${PUBLIC}/${want.master.key}`, want.key);
            type = 'video/mp4';
          } else {
            const res = await fetch(`${PUBLIC}/${want.master.key}`);
            if (!res.ok) throw new Error(`master ${res.status}`);
            const buf = Buffer.from(await res.arrayBuffer());
            out = await sharp(buf, { limitInputPixels: 2e9, sequentialRead: true, animated: want.master.ext === 'gif' })
              .rotate()
              .resize({ width: LONG_EDGE, height: LONG_EDGE, fit: 'inside', withoutEnlargement: true })
              .webp({ quality: 82, effort: 4 })
              .toBuffer();
            type = 'image/webp';
          }
          await putObject(want.key, out, type);
          made.push({ id, key: want.key, from: want.master.bytes, to: out.length });
        } catch (err) {
          failed.push({ id, master: want.master.key, why: String(err.message || err).slice(0, 180) });
        }
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
