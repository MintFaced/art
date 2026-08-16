import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

// A quote is a signed statement of the rates at a moment. It travels with the
// buyer rather than sitting in a database, and the server will not honour one it
// did not sign or one that has expired.
const SECRET = process.env.QUOTE_SECRET || '';
export const QUOTE_MINUTES = Number(process.env.QUOTE_MINUTES || 15);

const b64 = (s) => Buffer.from(s).toString('base64url');
const unb64 = (s) => Buffer.from(s, 'base64url').toString('utf8');

function sign(payload) {
  return createHmac('sha256', SECRET).update(payload).digest('base64url');
}

export function quoteConfigured() {
  return Boolean(SECRET);
}

export function issueQuote({ workId, rates }) {
  const now = Date.now();
  const body = {
    v: 1,
    id: randomBytes(8).toString('hex'),
    workId,
    rates,                                  // per one NZD
    issued: now,
    expires: now + QUOTE_MINUTES * 60 * 1000,
  };
  const payload = b64(JSON.stringify(body));
  return { token: `${payload}.${sign(payload)}`, ...body };
}

/**
 * Returns the quote body, or throws. `at` lets a payment be judged against the
 * moment it was mined rather than the moment it was reported.
 */
export function readQuote(token, { at = Date.now(), workId = null } = {}) {
  if (!SECRET) throw new Error('quotes are not configured');
  if (typeof token !== 'string' || !token.includes('.')) throw new Error('no quote supplied');
  const [payload, mac] = token.split('.');
  const expected = sign(payload);
  const a = Buffer.from(mac || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('that quote was not issued here');

  const body = JSON.parse(unb64(payload));
  if (workId && body.workId !== workId) throw new Error('that quote is for a different work');
  if (at > body.expires) throw new Error('that quote has expired, take a fresh one');
  return body;
}
