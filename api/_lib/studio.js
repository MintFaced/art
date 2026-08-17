import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

// The studio is one person with a phone. The secret path keeps it from being
// found; the password is the lock. A session is a signed statement with an
// expiry rather than anything stored, so there is nothing to leak at rest.
const SECRET = process.env.STUDIO_SECRET || process.env.QUOTE_SECRET || '';
const PASSWORD = process.env.STUDIO_PASSWORD || '';
export const STUDIO_PATH = process.env.STUDIO_PATH || '';
const HOURS = Number(process.env.STUDIO_SESSION_HOURS || 12);
export const COOKIE = 'mf_studio';

export const studioConfigured = () => Boolean(SECRET && PASSWORD && STUDIO_PATH);

const sign = (payload) => createHmac('sha256', SECRET).update(payload).digest('base64url');

// constant time, so a wrong password cannot be found a character at a time
function same(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

export const passwordOk = (given) => Boolean(PASSWORD) && same(given || '', PASSWORD);

export function issueSession() {
  const body = Buffer.from(JSON.stringify({
    v: 1,
    id: randomBytes(8).toString('hex'),
    exp: Date.now() + HOURS * 3600 * 1000,
  })).toString('base64url');
  return `${body}.${sign(body)}`;
}

export function sessionOk(token) {
  if (!token || !SECRET) return false;
  const [body, mac] = String(token).split('.');
  if (!body || !mac) return false;
  if (!same(mac, sign(body))) return false;
  try {
    const j = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return j.exp > Date.now();
  } catch { return false; }
}

export function sessionFrom(request) {
  const raw = request.headers.get('cookie') || '';
  const hit = raw.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${COOKIE}=`));
  return hit ? decodeURIComponent(hit.slice(COOKIE.length + 1)) : null;
}

export const cookieHeader = (token) =>
  `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${HOURS * 3600}`;

// Login attempts, kept in memory. Fluid Compute reuses instances, so this
// slows a guesser down; it is not a distributed limiter and does not pretend
// to be one.
const attempts = new Map();
export function tooManyAttempts(ip) {
  const now = Date.now();
  const rec = attempts.get(ip) || { n: 0, until: 0 };
  if (rec.until > now) return true;
  return false;
}
export function noteAttempt(ip, ok) {
  const now = Date.now();
  const rec = attempts.get(ip) || { n: 0, until: 0 };
  if (ok) { attempts.delete(ip); return; }
  rec.n += 1;
  // back off hard after five, so guessing costs real time
  if (rec.n >= 5) { rec.until = now + Math.min(30, 2 ** (rec.n - 4)) * 60 * 1000; }
  attempts.set(ip, rec);
}
