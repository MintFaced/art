import { readFile, writeFile, repoConfigured } from './_lib/repo.js';
import { putObject, r2Configured } from './_lib/r2.js';
import { passwordOk, issueSession, sessionOk, sessionFrom, cookieHeader, studioConfigured, tooManyAttempts, noteAttempt } from './_lib/studio.js';

const SOURCE = 'data/source/recent-work.json';
const json = (b, s = 200, headers = {}) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json', ...headers } });

const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

// A work has to be worth publishing before it goes near the repo. Every rule
// here is also enforced on the phone; this is the one that counts.
function validate(w) {
  const bad = [];
  if (!w.title || !String(w.title).trim()) bad.push('a title');
  const d = w.dimensions || {};
  const nums = ['w', 'h'].map((k) => Number(d[k]));
  if (nums.some((n) => !(n > 0))) bad.push('width and height in cm');
  const price = (k) => (w.pricing_nzd && w.pricing_nzd[k] != null ? Number(w.pricing_nzd[k]) : null);
  for (const k of ['digital', 'painting', 'both']) {
    const v = price(k);
    if (v != null && !(v > 0)) bad.push(`a sensible ${k} price`);
  }
  const dig = price('digital');
  const pai = price('painting');
  const both = price('both');
  if (both != null) {
    const floor = Math.max(dig || 0, pai || 0);
    if (floor && both < floor) bad.push('a both price at least as much as the dearer single option');
    if (dig != null && pai != null && both > dig + pai) bad.push('a both price no more than the two added together');
  }
  if (!w.image) bad.push('a photograph');
  return bad;
}

export async function POST(request) {
  if (!studioConfigured()) return json({ error: 'the studio is not configured' }, 503);
  const url = new URL(request.url);
  const action = url.searchParams.get('do');
  const ip = request.headers.get('x-forwarded-for') || 'unknown';

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }

  if (action === 'login') {
    if (tooManyAttempts(ip)) return json({ error: 'too many tries, wait a few minutes' }, 429);
    const ok = passwordOk(body.password);
    noteAttempt(ip, ok);
    if (!ok) return json({ error: 'no' }, 401);
    return json({ ok: true }, 200, { 'set-cookie': cookieHeader(issueSession()) });
  }

  if (!sessionOk(sessionFrom(request))) return json({ error: 'sign in first' }, 401);

  if (action === 'upload') {
    if (!r2Configured()) return json({ error: 'no image store configured' }, 503);
    const m = /^data:(image\/(jpeg|png|webp));base64,(.+)$/.exec(String(body.data || ''));
    if (!m) return json({ error: 'send a jpeg, png or webp data url' }, 400);
    const buf = Buffer.from(m[3], 'base64');
    if (!buf.length) return json({ error: 'that photograph is empty' }, 400);
    if (buf.length > 12 * 1024 * 1024) return json({ error: 'that photograph is over 12MB, resize it first' }, 413);
    const ext = m[2] === 'jpeg' ? 'jpg' : m[2];
    const key = `recent/${slugify(body.slug) || Date.now().toString(36)}.${ext}`;
    await putObject(key, buf, m[1]);
    return json({ ok: true, key, url: `${process.env.ASSETS_PUBLIC_BASE || 'https://assets.mintface.art'}/${key}` });
  }

  if (action === 'publish') {
    if (!repoConfigured()) return json({ error: 'no repo token configured' }, 503);
    const w = body.work || {};
    const bad = validate(w);
    if (bad.length) return json({ error: `still needs ${bad.join(', ')}` }, 400);

    const { sha, text } = await readFile(SOURCE);
    const src = text ? JSON.parse(text) : { works: [] };
    src.works = src.works || [];

    const id = slugify(w.id || w.title);
    const now = new Date().toISOString();
    const record = {
      id,
      title: String(w.title).trim(),
      year: String(w.year || new Date().getFullYear()),
      medium: String(w.medium || 'Acrylic on canvas').trim(),
      edition: String(w.edition || '1/1').trim(),
      dimensions: {
        w: Number(w.dimensions.w), h: Number(w.dimensions.h),
        ...(Number(w.dimensions.d) > 0 ? { d: Number(w.dimensions.d) } : {}),
        unit: 'cm',
      },
      pricing_nzd: {
        digital: w.pricing_nzd?.digital != null ? Number(w.pricing_nzd.digital) : null,
        painting: w.pricing_nzd?.painting != null ? Number(w.pricing_nzd.painting) : null,
        both: w.pricing_nzd?.both != null ? Number(w.pricing_nzd.both) : null,
      },
      image: String(w.image),
      notes: w.notes ? String(w.notes) : null,
      hidden: w.hidden === true ? true : undefined,
      added: w.added || now,
      updated: now,
    };

    const at = src.works.findIndex((x) => x.id === id);
    const adding = at < 0;
    if (adding) src.works.push(record);
    else src.works[at] = { ...src.works[at], ...record, added: src.works[at].added || now };

    await writeFile(SOURCE, JSON.stringify(src, null, 2) + '\n',
      `studio: ${adding ? 'add' : 'update'} ${record.title}`, sha);

    return json({ ok: true, id, url: `/w/${encodeURIComponent(id)}`, adding });
  }

  return json({ error: 'unknown action' }, 400);
}

export async function GET(request) {
  if (!studioConfigured()) return json({ error: 'the studio is not configured' }, 503);
  if (!sessionOk(sessionFrom(request))) return json({ error: 'sign in first' }, 401);
  const { text } = await readFile(SOURCE);
  const src = text ? JSON.parse(text) : { works: [] };
  return json({ works: src.works || [] });
}
