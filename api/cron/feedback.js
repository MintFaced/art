/* The agent letterbox, once a day (AGENT-FEEDBACK.md).
 *
 * On a day with new notes, one plain-text email to Ryan: how many, the first
 * lines of three, and the paths agents missed most. First lines only, and as
 * text: the email carries nothing a mail client could render or follow, and
 * nothing is read or summarised by anything but Ryan.
 *
 * And the year's end for a note: done or won't do, and older than twelve
 * months, it is deleted.
 */
import { digest, markDigested, retire } from '../_lib/feedback.js';
import { send, emailConfigured } from '../_lib/email.js';
import { storeConfigured } from '../_lib/kv.js';

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (!secret) {
    if (process.env.VERCEL_ENV === 'production') return new Response('cron secret is not set', { status: 503 });
  } else if (auth !== `Bearer ${secret}`) {
    return new Response('no', { status: 401 });
  }
  if (!storeConfigured()) return new Response(JSON.stringify({ skipped: 'no store' }), { status: 200 });
  const dry = new URL(request.url).searchParams.get('dry') === '1';
  const d = await digest();
  let emailed = false;
  if (d && !dry && emailConfigured()) {
    await send({ to: process.env.EMAIL_TO_ARTIST || 'ryan@mintface.art', subject: d.subject, text: d.text });
    await markDigested(d.until);
    emailed = true;
  }
  const deleted = dry ? 0 : await retire();
  return new Response(JSON.stringify({ new_notes: d ? d.count : 0, emailed, deleted, dry }, null, 1),
    { status: 200, headers: { 'content-type': 'application/json' } });
}
