/* One sign-in, two hosts.
 *
 * mintface.art and collectors.mintface.art are one site wearing two names, and
 * a reader who has said who they are on one of them has said it on both. The
 * two are the same registrable domain, so this is plain same-site sharing: a
 * cookie scoped to the parent, SameSite=Lax, and none of the SameSite=None
 * acrobatics a genuinely cross-site session would need.
 *
 * Worth being clear about what is NOT here, because the obvious next question
 * is where the shared signing key lives. There isn't one, and there is nothing
 * to mirror into the register's project. The register is a static deploy with
 * no functions of its own: every call it makes goes to this API. So there is
 * exactly one thing that mints sessions and exactly one thing that validates
 * them, and the token is an opaque random string looked up in the store rather
 * than a signed blob anything has to decode. A second validator would need a
 * shared secret. There is no second validator.
 */

/* The token, and a small readable companion.
 *
 * The token is HttpOnly ... it never touches JavaScript again once it is set,
 * which is a straight improvement on the localStorage it replaces. But a nav
 * that cannot tell a signed-in reader from a signed-out one without asking the
 * server would have to ask on every page of the site, for everybody, including
 * the many readers who have never signed in. So a second cookie carries the
 * two facts the bar needs to draw itself and nothing else: which wallet, and
 * until when. Both are public; neither is a credential. */
export const TOKEN_COOKIE = 'mf_room';
export const WHO_COOKIE = 'mf_who';

/* The pair, and the parent they share. A host outside the family ... a preview
   deploy on vercel.app ... is a different registrable domain, so it gets a
   cookie of its own host and no sharing, which is correct: a preview should
   not be able to set a cookie for production and production's session should
   not follow a reader into a preview. */
export const HOSTS = ['mintface.art', 'collectors.mintface.art'];
const PARENT = '.mintface.art';
const family = (host) => HOSTS.includes(String(host || '').toLowerCase());

export function hostOf(request) {
  try { return new URL(request.url).hostname.toLowerCase(); } catch (e) { return ''; }
}

/** Where a session set from this host should live. */
const scope = (host) => (family(host) ? `; Domain=${PARENT}` : '');

const one = (name, value, host, seconds) =>
  `${name}=${encodeURIComponent(value)}${scope(host)}; Path=/; Secure; SameSite=Lax; Max-Age=${Math.floor(seconds)}`;

/** Two Set-Cookie lines: the credential, and what the bar draws. */
export function openCookies({ token, address, until, host, seconds }) {
  return [
    `${one(TOKEN_COOKIE, token, host, seconds)}; HttpOnly`,
    one(WHO_COOKIE, `${address}|${until}`, host, seconds),
  ];
}

/* Cleared on both the parent and this host. A session opened before the cookie
   re-scoped is sitting on the host rather than the parent, and signing out has
   to reach it or it comes back on the next page. */
export function clearCookies(host) {
  const kill = (name, dom) => `${name}=; ${dom}Path=/; Secure; SameSite=Lax; Max-Age=0`;
  const out = [];
  for (const name of [TOKEN_COOKIE, WHO_COOKIE]) {
    out.push(kill(name, ''));
    if (family(host)) out.push(kill(name, `Domain=${PARENT}; `));
  }
  return out;
}

export function cookieFrom(request, name) {
  const raw = (request.headers.get('cookie') || '');
  for (const bit of raw.split(';')) {
    const s = bit.trim();
    if (s.startsWith(`${name}=`)) return decodeURIComponent(s.slice(name.length + 1));
  }
  return null;
}

/* ---------------------------------------------------------------- CORS */

/* A credentialed request cannot be answered with a wildcard, and reading this
   room has always been open to anything that asks. So both are true at once:
   the family gets its own origin echoed and permission to send the cookie,
   and everybody else gets the wildcard they had before, without credentials.
   Vary: Origin, because the two answers differ and a cache must not hand one
   reader the other's. */
export function corsFor(request) {
  const origin = request.headers.get('origin') || '';
  let host = '';
  try { host = new URL(origin).hostname.toLowerCase(); } catch (e) { host = ''; }
  const base = {
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    vary: 'Origin',
  };
  if (origin && family(host)) {
    return { ...base, 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' };
  }
  return { ...base, 'access-control-allow-origin': '*' };
}

/* ------------------------------------------------------- domain binding */

/**
 * Which hosts a sign-in may be signed for.
 *
 * The sentence a wallet approves names the site it was asked on, and this is
 * what that name is checked against: the two hosts of the family, plus whatever
 * host is answering the request, so a preview deploy can sign into itself.
 *
 * Note what this does and does not buy. It is not the reason a session crosses
 * the two hosts ... it crosses because one API mints it and one API validates
 * it, and it would cross without a domain in the sentence at all. What it buys
 * is that a signature collected somewhere else, for something else, cannot be
 * spent here: the sentence says where it was for.
 */
export function domainOk(domain, request) {
  const d = String(domain || '').toLowerCase();
  if (!d) return false;
  return family(d) || d === hostOf(request);
}
