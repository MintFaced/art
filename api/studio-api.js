import { readFile, writeFile, repoConfigured } from './_lib/repo.js';
import { putObject, r2Configured } from './_lib/r2.js';
import { passwordOk, issueSession, sessionOk, sessionFrom, cookieHeader, studioConfigured, tooManyAttempts, noteAttempt } from './_lib/studio.js';
import { bankingContext, bankNudge } from './_lib/banking.js';
import { kindOf, lockRule, lockLine, checkHex, CANDIDATES } from './_lib/nudges.js';
import { seriesState } from './_lib/palette.js';
import { enqueue, slotsRow } from './_lib/wire.js';

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

  /* Nudge authoring. A nudge is one question, a close date, and nothing else
     required. While it is open only the wording of the note and the image may
     be corrected: changing the question itself would silently re-purpose
     weighings that were made against different words, so that voids and
     restarts as a new nudge rather than editing in place. */
  if (action === 'nudge') {
    const question = String(body.question || '').trim();
    const closes = String(body.closes || '').trim();
    if (question.length < 8) return json({ error: 'ask something' }, 400);
    if (!Date.parse(closes)) return json({ error: 'a close date is required' }, 400);
    if (Date.parse(closes) < Date.now()) return json({ error: 'that date has already passed' }, 400);

    const file = await readFile('data/nudges.json');
    const store = JSON.parse(file.text);
    store.nudges = store.nudges || [];
    const number = store.next_number || (store.nudges.length + 1);
    const id = `nudge-${number}`;
    /* A nudge with candidates has no sides: the collectors propose the answers
       and weigh on them, and a colour locks only if the leader carries enough
       collectors and enough TAO at close. The thresholds live on the nudge so
       a later one can ask for more or less without a deploy, and `promise` is
       the studio undertaking to paint what locks ... which is the one thing
       that makes this more than a steer, and belongs on the record rather than
       in the page's copy. */
    const kind = body.kind === 'candidates' ? 'candidates' : 'binary';
    const lock = kind === 'candidates'
      ? { voters: Math.max(1, Math.floor(Number(body.lock_voters) || 5)),
        tao: Math.max(0, Math.floor(Number(body.lock_tao) || 500000)) }
      : null;
    /* Which arc this belongs to and which colour it fills.
       A slot is the whole of the constraint: everything a nudge must stand
       clear of is read from the slots below it at the moment it is asked, so
       an author names a number rather than a list of colours that would be
       wrong the day another one locked. A slot already filled is refused ...
       except where its nudge banked without locking, which is the case that
       has to stay open, because otherwise a palette that failed once is a
       palette that is short forever. */
    const series = String(body.series || '').trim() || null;
    const slot = body.slot != null ? Math.floor(Number(body.slot)) : null;
    if (series) {
      const arc = store.series;
      if (!arc || arc.id !== series) return json({ error: `no such series: ${series}` }, 400);
      if (!(slot >= 1 && slot <= Number(arc.slots))) {
        return json({ error: `a slot from 1 to ${arc.slots}` }, 400);
      }
      const taken = (store.nudges || []).find((x) => x.series === series && Number(x.slot) === slot
        && (!x.banked || (x.banked && x.banked.locked)));
      if (taken) {
        return json({ error: `slot ${slot} is ${taken.banked ? 'locked by' : 'already being asked by'} nudge #${taken.number}` }, 409);
      }
    }
    store.nudges.push({
      id, number, question, kind,
      ...(series ? { series, slot } : {}),
      ...(lock ? { lock } : {}),
      promise: String(body.promise || '').trim() || null,
      note: String(body.note || '').trim() || null,
      image: String(body.image || '').trim() || null,
      opens: new Date().toISOString(),
      closes: new Date(closes).toISOString(),
      published: body.publish !== false,
    });
    store.next_number = number + 1;
    await writeFile('data/nudges.json', JSON.stringify(store, null, 1) + '\n', `Nudge ${number}: ${question.slice(0, 60)}`, file.sha);
    /* On the wire, after the write. Never before: a tweet about a nudge that
       failed to save is a tweet about something that did not happen, and the
       repo is the record the timeline reports on rather than the other way
       round. enqueue never throws, so the round cannot fail on the bot. */
    await enqueue('nudge-open', {
      number, question, closes: new Date(closes).toISOString(), slot,
      slots_row: slotsRow(seriesState(store), slot),
    });
    return json({ ok: true, id, number });
  }

  /* ------------------------------------------------------------- nudges
   *
   * The close and open cycle used to be a directive each round: somebody ran
   * the numbers, somebody edited a file. Ten nudges remain in the series and
   * the artist should be able to run them from a phone, so the console gets
   * what the round actually needs ... what is open and how far it is, a close
   * that says exactly what it will write before it writes it, and a form for
   * the next one that fills in its own constraint and numbering.
   */
  if (action === 'nudge-state') {
    const site = process.env.SITE_ORIGIN || 'https://mintface.art';
    const at = async (path) => (await fetch(`${site}/${path}`, { headers: { accept: 'application/json' } })).json();
    const file = await readFile('data/nudges.json');
    const store = JSON.parse(file.text);
    const arc = seriesState(store) || null;
    const ctx = await bankingContext(at);

    /* Every published nudge that has not banked, with its board read live, so
       the console shows the same figures the public card does rather than a
       summary written for it. */
    const open = [];
    for (const n of store.nudges || []) {
      if (n.banked || n.published === false) continue;
      const { banked } = await bankNudge(n, ctx, null);
      open.push({
        id: n.id, number: n.number, question: n.question, kind: kindOf(n),
        closes: n.closes, series: n.series || null, slot: n.slot || null,
        rule: lockRule(n),
        total: banked.total, collectors: banked.collectors,
        leader: banked.leader || null,
        progress: banked.progress || null,
        /* What it would bank if it closed now on the thresholds alone. This is
           the honest default the button offers, before the artist overrides. */
        would: lockLine(banked),
        would_lock: Boolean(banked.locked),
        candidates: (banked.candidates || []).map((c) => ({ hex: c.hex, total: c.total, voters: c.voters })),
      });
    }
    return json({ ok: true, open, series: arc, next_number: store.next_number || null });
  }

  /* The close. `preview` writes nothing and returns the sentence the card will
     carry, which is the sentence the confirm step shows ... the same function
     composes both, so what the artist approves is what the record says. */
  if (action === 'nudge-close') {
    const site = process.env.SITE_ORIGIN || 'https://mintface.art';
    const at = async (path) => (await fetch(`${site}/${path}`, { headers: { accept: 'application/json' } })).json();
    const file = await readFile('data/nudges.json');
    const store = JSON.parse(file.text);
    const n = (store.nudges || []).find((x) => x.id === String(body.id));
    if (!n) return json({ error: 'no such nudge' }, 404);
    if (n.banked) return json({ error: `nudge #${n.number} is already banked` }, 409);

    /* An artist lock names its colour. Absent, the thresholds decide, which is
       simply the cron's close run early. */
    let decision = null;
    if (body.lock) {
      const h = checkHex(body.hex || '');
      if (h.error) return json({ error: h.error }, 400);
      if (kindOf(n) !== CANDIDATES) return json({ error: 'only a board of colours locks a colour' }, 400);
      decision = { by: 'artist', hex: h.hex };
    }

    const dropped = [];
    const ctx = await bankingContext(at);
    const { banked } = await bankNudge(n, ctx, decision, dropped);
    const line = lockLine(banked);

    if (body.preview) {
      return json({ ok: true, preview: true, line, dropped,
        locked: banked.locked || null, locked_by: banked.locked_by || null,
        met: banked.met || null, rule: banked.rule || null,
        progress: banked.progress || null,
        closed_early: banked.closed_early || null });
    }

    n.banked = banked;
    await writeFile('data/nudges.json', JSON.stringify(store, null, 1) + '\n',
      `Nudge ${n.number}: ${banked.locked ? `locked ${banked.locked.hex}` : 'banked, nothing locked'}`, file.sha);
    if (banked.locked) {
      const arc = seriesState(store);
      await enqueue('nudge-lock', {
        number: n.number, hex: banked.locked.hex, total: banked.locked.total, voters: banked.locked.voters,
        slot: n.slot || null, slots: (arc && arc.slots) || 12,
        locked_by: banked.locked_by, met: banked.met, rule: banked.rule,
        slots_row: slotsRow(arc),
      });
    }
    return json({ ok: true, line, dropped, locked: banked.locked || null, locked_by: banked.locked_by || null });
  }

  // what happened after a nudge banked, written on the record
  if (action === 'nudge-outcome') {
    const file = await readFile('data/nudges.json');
    const store = JSON.parse(file.text);
    const n = (store.nudges || []).find((x) => x.id === String(body.id));
    if (!n) return json({ error: 'no such nudge' }, 404);
    n.outcome = String(body.outcome || '').trim() || null;
    await writeFile('data/nudges.json', JSON.stringify(store, null, 1) + '\n', `Nudge ${n.number}: outcome`, file.sha);
    return json({ ok: true });
  }

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
      medium: String(w.medium || 'Acrylic on timber').trim(),
      edition: String(w.edition || '1/1').trim(),
      statement: w.statement ? String(w.statement).trim() : null,
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
