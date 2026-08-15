import { findWork, siteOrigin, useRequestOrigin } from './_lib/data.js';
import { writeWorkState, workState, stateConfigured } from './_lib/state.js';
import { send, templates } from './_lib/email.js';

const DAYS = Number(process.env.RESERVE_DAYS || 14);
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const looksLikeEmail = (s) => typeof s === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);

// A fortnight, free, no card. The work shows as reserved and quietly returns if
// nobody follows through.
export async function POST(request) {
  useRequestOrigin(request);
  if (!stateConfigured()) {
    return json({ error: 'sale state is not configured yet, email ryan@mintface.art and it will be handled by hand' }, 503);
  }
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }

  const { workId, name, email } = body || {};
  if (!workId) return json({ error: 'workId is required' }, 400);
  if (!looksLikeEmail(email)) return json({ error: 'a real email address is required' }, 400);

  const hit = await findWork(workId);
  if (!hit) return json({ error: 'no such work' }, 404);

  let status = hit.work.status;
  const live = await workState(workId);
  if (live && live.status) status = live.status;
  if (status !== 'available') return json({ error: `this work is ${status}` }, 409);

  const now = new Date();
  const until = new Date(now.getTime() + DAYS * 24 * 60 * 60 * 1000);
  const title = hit.work.title || workId;

  await writeWorkState(workId, {
    status: 'reserved',
    reserve: {
      name: (name || '').slice(0, 120) || null,
      email,
      from: now.toISOString(),
      expires: until.toISOString(),
      reminded: false,
    },
  }, `Reserved: ${title} for ${email} until ${until.toISOString().slice(0, 10)}`);

  const url = `${siteOrigin()}/w/${encodeURIComponent(workId)}`;
  const untilText = until.toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' });
  const t = templates.reserved({ name, title, until: untilText, url });
  await send({ to: email, subject: t.subject, text: t.text }).catch((e) => console.error('reserve email', e));
  await send({
    to: process.env.EMAIL_TO_ARTIST || 'ryan@mintface.art',
    subject: `Held ... ${title}`,
    text: `${title} is held for ${name || 'someone'} (${email}) until ${untilText}.`,
  }).catch(() => {});

  return json({ ok: true, status: 'reserved', expires: until.toISOString(), days: DAYS });
}
