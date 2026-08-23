import { send, templates, emailConfigured } from './_lib/email.js';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const HEX = /^0x[0-9a-fA-F]{40}$/;
const ENS = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)*\.eth$/i;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const trim = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

/* A painting collector sending the address their token should go to.
 *
 * The same checks the page makes, made again here, because a form can be
 * bypassed and a mistyped address sends the artwork somewhere unrecoverable.
 * Anything the reader sees back is phrased the way the page phrases things:
 * what is missing, not what they did wrong. */
export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return json({ say: 'Something got lost on the way. Please try once more.' }, 400); }

  const name = trim(body.name, 120);
  const email = trim(body.email, 200);
  const address = trim(body.address, 120).replace(/\s+/g, '');
  const works = trim(body.works, 600);

  if (!name) return json({ say: 'I need a name to go with the address.' }, 400);
  if (!EMAIL.test(email)) return json({ say: 'That email address looks incomplete ... could you check it over?' }, 400);
  if (!HEX.test(address) && !ENS.test(address)) {
    return json({ say: 'That does not look like a wallet address yet. A full one is 42 characters starting with 0x, or a name ending in .eth.' }, 400);
  }

  if (!emailConfigured()) {
    return json({ say: 'I cannot take it through the site just now. Please email art@mintface.art with your address and I will transfer it by hand.' }, 503);
  }

  // the artist's copy is the one that must not be lost, so it goes first
  const to = process.env.EMAIL_TO_CLAIMS || 'art@mintface.art';
  const notice = templates.claimNotice({ name, email, address, works });
  await send({ to, subject: notice.subject, text: notice.text });

  const ack = templates.claimReceived({ name });
  await send({ to: email, subject: ack.subject, text: ack.text }).catch((e) => console.error('claim ack', e));

  return json({ ok: true });
}
