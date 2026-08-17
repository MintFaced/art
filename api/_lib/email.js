import { describeWhat } from './data.js';
import { Resend } from 'resend';

const KEY = process.env.RESEND_API_KEY;
const FROM = process.env.EMAIL_FROM || 'MintFace <art@mintface.art>';
const BCC = process.env.EMAIL_BCC || null;

const resend = KEY ? new Resend(KEY) : null;

export function emailConfigured() {
  return Boolean(resend);
}

// Plain text. The site is quiet, the emails should be too.
export async function send({ to, subject, text }) {
  if (!resend) return { skipped: 'RESEND_API_KEY is not set' };
  const { data, error } = await resend.emails.send({
    from: FROM,
    to,
    subject,
    text,
    ...(BCC ? { bcc: BCC } : {}),
  });
  if (error) throw new Error(`resend: ${error.message || error}`);
  return data;
}

export const templates = {
  reserved: ({ name, title, until, url }) => ({
    subject: `Reserved for you ... ${title}`,
    text: `${name ? name + ',' : 'Hello,'}

${title} is held for you until ${until}. Nothing has been charged.

If you would like it, reply to this email or return to the work and choose how you would like to pay.

${url}

If the fortnight passes without word, the hold lifts quietly and the work goes back up.

Ryan
MintFace`,
  }),
  reminder: ({ name, title, until, url }) => ({
    subject: `Two days left ... ${title}`,
    text: `${name ? name + ',' : 'Hello,'}

A note that the hold on ${title} lifts on ${until}.

${url}

No obligation either way. If you would rather let it go, you need do nothing.

Ryan
MintFace`,
  }),
  released: ({ name, title }) => ({
    subject: `The hold has lifted ... ${title}`,
    text: `${name ? name + ',' : 'Hello,'}

The fortnight is up, so ${title} is available again.

If the timing was simply wrong, tell me and I will hold it again.

Ryan
MintFace`,
  }),
  sold: ({ title, what, amount, currency, email, shipping }) => ({
    subject: `Sold ... ${title}`,
    text: `${title} sold.

What: ${describeWhat(what)}
Paid: ${amount} ${currency}
Buyer: ${email || 'no email on the session'}
${shipping ? `Ship to:\n${shipping}\n` : ''}
The work is marked as collected on the site. The token still needs transferring by hand.`,
  }),
};
