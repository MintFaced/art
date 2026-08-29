#!/usr/bin/env node
/* One sign-in, two hosts, checked against a deploy rather than a fixture.
 *
 * The acceptance case is "sign in on mintface.art, load collectors.mintface.art
 * fresh, name in the nav, no second prompt". A browser and a wallet would be
 * the honest way to run that, and there is no wallet here ... so this does the
 * two halves a browser would do: it signs the real sentence with a throwaway
 * key, takes the real Set-Cookie off the real route, and then spends that
 * cookie from the register's origin exactly as the register's nav would.
 *
 * It opens a session for a wallet nobody holds and closes it again.
 *
 *   node scripts/nav/check-sso.mjs                     ... production
 *   node scripts/nav/check-sso.mjs https://some-preview.vercel.app
 */
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { chatMessage, sessionUntil } from '../../api/_lib/chat.js';

const BASE = (process.argv[2] || 'https://mintface.art').replace(/\/$/, '');
const API = `${BASE}/api/chat`;
const CATALOGUE = new URL(BASE).hostname;
const REGISTER = 'collectors.mintface.art';

let failed = 0, ran = 0;
const ok = (cond, label, detail) => {
  ran++;
  if (!cond) failed++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n          ${detail}` : ''}`);
};
const head = (t) => console.log(`\n${t}\n${'='.repeat(74)}`);

const jarOf = (r) => (r.headers.getSetCookie ? r.headers.getSetCookie() : []);
const pairs = (jar) => jar.map((c) => c.split(';')[0]).filter((c) => !/=;?$/.test(c)).join('; ');

async function signIn(account, domain) {
  const address = account.address.toLowerCase();
  const issued = new Date().toISOString();
  const days = await fetch(`${API}?me=1`, { headers: { accept: 'application/json' } })
    .then((r) => r.json()).then((j) => Number(j.session_days) || 30);
  const until = sessionUntil(issued, days);
  const signature = await account.signMessage({
    message: chatMessage({ action: 'sign in', address, issued, until, domain }),
  });
  const r = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: `https://${domain}` },
    body: JSON.stringify({ action: 'sign in', address, issued, until, domain, signature }),
  });
  return { status: r.status, body: await r.json().catch(() => ({})), jar: jarOf(r) };
}

console.log(`Studio single sign-on, against ${BASE}\n`);
const account = privateKeyToAccount(generatePrivateKey());

head(`Signing in on the catalogue (${CATALOGUE})`);
let cookie = '';
{
  const opened = await signIn(account, CATALOGUE);
  ok(opened.status === 200 && opened.body.ok, 'a wallet signs in', opened.body.error || '');
  const jar = opened.jar;
  const tok = jar.find((c) => c.startsWith('mf_room='));
  const who = jar.find((c) => c.startsWith('mf_who='));
  ok(tok && who, 'and the deploy sets both cookies as two separate headers',
    jar.map((c) => c.split('=')[0]).join(', '));
  const family = CATALOGUE.endsWith('mintface.art');
  ok(!family || (/Domain=\.mintface\.art/.test(tok || '') && /Domain=\.mintface\.art/.test(who || '')),
    family ? 'scoped to the domain both hosts share' : 'a preview keeps its session to its own host',
    (tok || '').split(';').slice(1, 3).join(';'));
  ok(/HttpOnly/.test(tok || ''), 'the credential is HttpOnly');
  ok(!/HttpOnly/i.test(who || ''), 'and the one the nav draws from is readable');
  cookie = pairs(jar);
}

head(`Loading the register fresh (${REGISTER})`);
{
  /* What the register's nav does on a cold page: ask the catalogue's API who
     it is drawing, from the register's origin, with the shared cookie and no
     viewer in the query string at all. */
  const r = await fetch(`${API}?me=1`, {
    headers: { accept: 'application/json', origin: `https://${REGISTER}`, cookie },
  });
  const j = await r.json().catch(() => ({}));
  ok(r.headers.get('access-control-allow-origin') === `https://${REGISTER}`,
    'the room answers the register with its own origin, not a wildcard',
    r.headers.get('access-control-allow-origin'));
  ok(r.headers.get('access-control-allow-credentials') === 'true',
    'and lets it send the cookie');
  ok((r.headers.get('vary') || '').includes('Origin'), 'and says the answer varies by who asked');
  ok(j.me && j.me.role, 'and knows who is reading, from the cookie alone ... no second prompt',
    JSON.stringify(j.me && { role: j.me.role, can_speak: j.me.can_speak }));
}

head('Everybody else still reads it without a wallet');
{
  const r = await fetch(`${API}?me=1`, { headers: { origin: 'https://somebody.example' } });
  ok(r.headers.get('access-control-allow-origin') === '*',
    'the wildcard the room has always answered with is still there',
    r.headers.get('access-control-allow-origin'));
  ok(!r.headers.get('access-control-allow-credentials'), 'and it comes with no credentials');
}

head('And the reverse: signed in on the register');
{
  const other = privateKeyToAccount(generatePrivateKey());
  const opened = await signIn(other, REGISTER);
  ok(opened.status === 200 && opened.body.ok,
    'a sign-in signed for the register is taken by the catalogue that mints it', opened.body.error || '');
  const jar = pairs(opened.jar);
  const r = await fetch(`${API}?me=1`, {
    headers: { accept: 'application/json', origin: `https://${CATALOGUE}`, cookie: jar },
  });
  const j = await r.json().catch(() => ({}));
  ok(j.me && j.me.role, 'and it reads on the catalogue with no second prompt either',
    JSON.stringify(j.me && { role: j.me.role }));
  await fetch(API, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: jar },
    body: JSON.stringify({ action: 'sign out' }),
  }).catch(() => {});
}

head('A signature collected somewhere else is worth nothing here');
{
  const stranger = privateKeyToAccount(generatePrivateKey());
  const r = await signIn(stranger, 'mintface.art.evil.example');
  ok(r.status === 400, 'a sign-in signed for another site is refused', `${r.status} ${r.body.error || ''}`);
}

head('Signing out reaches the cookie');
{
  const r = await fetch(API, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ action: 'sign out' }),
  });
  const jar = jarOf(r);
  ok(r.status === 200 && jar.length && jar.every((c) => /Max-Age=0/.test(c)),
    'the server unsets what only the server can unset', `${jar.length} cleared`);
  const after = await fetch(`${API}?me=1`, { headers: { accept: 'application/json', cookie } })
    .then((x) => x.json()).catch(() => ({}));
  ok(!after.me, 'and the session is gone on both hosts at once');
}

console.log(`\n${'='.repeat(74)}`);
console.log(failed === 0 ? `All ${ran} checks pass.` : `${failed} of ${ran} checks failed.`);
process.exit(failed === 0 ? 0 : 1);
