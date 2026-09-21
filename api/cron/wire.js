/* The worker. Drains the wire to X, in order, once.
 *
 * ORDER IS THE POINT. A feed where a lock appears before the weigh-in that
 * carried it is a feed telling the story backwards, so this takes the queue
 * from the front and stops at the first thing it cannot send rather than
 * skipping past it. Late beats lost, and out-of-order is a third thing that is
 * worse than late.
 *
 * Every send is recorded against the event id before the next one starts, so a
 * run that dies halfway resumes rather than repeats. A retry after a timeout
 * where X did in fact post is the one case this cannot see; that is what the
 * id check at the top of each loop is for.
 */
import { peek, alreadySent, markSent, markDead, depth, compose, wireConfigured } from '../_lib/wire.js';
import { tweet, uploadMedia, xConfigured, xPaused, weight } from '../_lib/x.js';
import { readFile } from '../_lib/repo.js';
import { loadRegister } from '../_lib/register.js';
import { storeConfigured, pipe } from '../_lib/kv.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// per run. The schedule is what sets the rate; this is what stops one run
// spending its whole budget on a backlog and timing out mid-send.
const BATCH = Number(process.env.WIRE_BATCH || 8);
// between tweets. X's own limits are per fifteen minutes; this is manners.
const SPACING_MS = Number(process.env.WIRE_SPACING_MS || 2500);

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (!secret) {
    if (process.env.VERCEL_ENV === 'production') return new Response('cron secret is not set', { status: 503 });
  } else if (auth !== `Bearer ${secret}`) {
    return new Response('no', { status: 401 });
  }
  const url = new URL(request.url);
  const dry = url.searchParams.get('dry') === '1';
  const started = Date.now();

  const out = { sent: [], skipped: [], held: null, depth: 0, dry };

  if (!wireConfigured()) {
    return json({ ...out, summary: 'wire: no store, nothing queued and nothing to send' });
  }
  out.depth = await depth();

  /* The kill switch. The queue keeps filling while it is on, which is the
     whole design: pulling it costs the timeline its lateness and costs the
     record nothing. */
  if (xPaused()) {
    return json({ ...out, summary: `wire: paused, ${out.depth} waiting`, paused: true });
  }
  if (!xConfigured() && !dry) {
    return json({ ...out, summary: `wire: no credentials, ${out.depth} waiting`, unconfigured: true });
  }

  const site = process.env.SITE_ORIGIN || 'https://mintface.art';
  const overlay = await readOverlay();
  const register = await loadRegister(
    async (origin, path) => (await fetch(`${origin}/${path}`, { headers: { accept: 'application/json' } })).json(),
    site, storeConfigured() ? pipe : null,
  ).catch(() => null);

  const batch = await peek(BATCH);
  for (const ev of batch) {
    if (await alreadySent(ev.id)) { await markDead(ev.id, 'already sent'); continue; }

    /* Test events never reach the timeline. They are taken off the queue and
       written down rather than silently dropped, so "why did this not tweet"
       has an answer. */
    if (ev.test) {
      out.skipped.push({ id: ev.id, kind: ev.kind, why: 'test' });
      if (!dry) await markDead(ev.id, 'test mode ... never tweeted');
      continue;
    }

    const said = compose(ev, { overlay, register });
    if (!said || !said.text) {
      out.skipped.push({ id: ev.id, kind: ev.kind, why: 'nothing to say' });
      if (!dry) await markDead(ev.id, `no template for ${ev.kind}`);
      continue;
    }
    if (weight(said.text) > 280) {
      out.skipped.push({ id: ev.id, kind: ev.kind, why: `too long (${weight(said.text)})` });
      if (!dry) await markDead(ev.id, 'over 280');
      continue;
    }

    if (dry) { out.sent.push({ id: ev.id, kind: ev.kind, text: said.text, card: said.card || null }); continue; }

    try {
      /* The picture is best effort and the words are not. A card that will not
         render must not cost the tweet ... a sale nobody hears about is worse
         than a sale with no image beside it. */
      let media = [];
      if (said.card) {
        try {
          const r = await fetch(cardUrl(site, said, ev));
          if (r.ok) {
            const id = await uploadMedia(Buffer.from(await r.arrayBuffer()), 'image/png');
            if (id) media = [id];
          }
        } catch (e) { console.error('wire: card failed', ev.id, String(e && e.message ? e.message : e)); }
      }
      const id = await tweet(said.text, media);
      await markSent(ev.id, { tweet: id, media: media.length });
      out.sent.push({ id: ev.id, kind: ev.kind, tweet: id });
      await sleep(SPACING_MS);
    } catch (e) {
      const why = String(e && e.message ? e.message : e);
      if (e && e.retryable) {
        /* Stop here rather than stepping over it. The next run starts on this
           same event, which is what keeps the timeline in the order the studio
           actually happened in. */
        out.held = { id: ev.id, kind: ev.kind, why: why.slice(0, 200) };
        break;
      }
      out.skipped.push({ id: ev.id, kind: ev.kind, why: why.slice(0, 160) });
      await markDead(ev.id, why);
    }
  }

  out.depth = await depth();
  const summary = `wire: ${out.sent.length} ${dry ? 'would send' : 'sent'}`
    + (out.skipped.length ? `, ${out.skipped.length} skipped` : '')
    + (out.held ? `, held on ${out.held.kind}` : '')
    + `, ${out.depth} waiting, ${Math.round((Date.now() - started) / 1000)}s`;
  console.log(summary);
  return json({ ...out, summary });
}

const json = (b) => new Response(JSON.stringify(b, null, 1), { status: 200, headers: { 'content-type': 'application/json' } });

async function readOverlay() {
  try { return JSON.parse((await readFile('data/source/collector-overlay.json')).text) || null; }
  catch (e) { return null; }
}

/* What the card is drawn from. Every value is on the event already, so this is
   a URL rather than a second reading of the register. */
function cardUrl(site, said, ev) {
  const c = said.card || {};
  const q = new URLSearchParams({ wire: '1' });
  const p = ev.payload || {};
  if (c.hex) q.set('hex', c.hex);
  if (p.slots_row) q.set('slots', p.slots_row);
  if (c.kind === 'work' && p.image) return p.image;
  q.set('eyebrow', ev.kind === 'sale' ? 'COLLECTED' : `NUDGE #${p.number || p.slot || ''}`.trim());
  q.set('caption', String(said.text).split('\n')[0].slice(0, 120));
  if (p.name) q.set('name', p.name);
  if (p.figure) q.set('figure', p.figure);
  q.set('foot', 'MINTFACE.ART/STUDIO');
  return `${site}/api/og?${q}`;
}
