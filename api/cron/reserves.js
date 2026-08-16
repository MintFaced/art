import { readState, writeWorkState } from '../_lib/state.js';
import { findWork, siteOrigin, useRequestOrigin } from '../_lib/data.js';
import { send, templates } from '../_lib/email.js';

// Runs daily. Nudges on day twelve, lets go on day fourteen.
export async function GET(request) {
  useRequestOrigin(request);
  // fail closed: in production a missing secret is a misconfiguration, not an
  // invitation. Vercel Cron sends the secret as a bearer token.
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (!secret) {
    if (process.env.VERCEL_ENV === 'production') {
      return new Response('cron secret is not set', { status: 503 });
    }
  } else if (auth !== `Bearer ${secret}`) {
    return new Response('no', { status: 401 });
  }

  const { state } = await readState();
  const works = state.works || {};
  const now = Date.now();
  const acted = { reminded: [], released: [], unheld: [] };

  for (const [id, s] of Object.entries(works)) {
    // a checkout hold that outlived its session, in case the webhook never came
    if (s.status === 'pending' && s.pending?.expires && now > new Date(s.pending.expires).getTime() + 5 * 60 * 1000) {
      await writeWorkState(id, { status: 'available', pending: null, note: 'checkout hold timed out' },
        `Hold timed out: ${id}, back on sale`);
      acted.unheld.push(id);
      continue;
    }
    if (s.status !== 'reserved' || !s.reserve?.expires) continue;
    const expires = new Date(s.reserve.expires).getTime();
    const hit = await findWork(id);
    const title = hit?.work?.title || id;
    const url = `${siteOrigin()}/w/${encodeURIComponent(id)}`;
    const untilText = new Date(expires).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' });

    if (now >= expires) {
      await writeWorkState(id, { status: 'available', reserve: null, note: 'hold expired' },
        `Hold expired: ${title}, back on sale`);
      if (s.reserve.email) {
        const t = templates.released({ name: s.reserve.name, title });
        await send({ to: s.reserve.email, subject: t.subject, text: t.text }).catch(() => {});
      }
      acted.released.push(id);
      continue;
    }

    const twoDaysOut = expires - 2 * 24 * 60 * 60 * 1000;
    if (!s.reserve.reminded && now >= twoDaysOut) {
      if (s.reserve.email) {
        const t = templates.reminder({ name: s.reserve.name, title, until: untilText, url });
        await send({ to: s.reserve.email, subject: t.subject, text: t.text }).catch(() => {});
      }
      await writeWorkState(id, { reserve: { ...s.reserve, reminded: true } }, `Reminder sent: ${title}`);
      acted.reminded.push(id);
    }
  }

  return new Response(JSON.stringify(acted), { status: 200, headers: { 'content-type': 'application/json' } });
}
