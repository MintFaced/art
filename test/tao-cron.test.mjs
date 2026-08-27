/* Run the nightly TAO cron cold, end to end, with the chain and the repo faked.
 *
 * This exists because of a temporal dead zone. `ownersAge` was read by the run
 * record and declared twenty lines below it, so every night the cron threw
 * `Cannot access 'ownersAge' before initialization` ... at the very last step,
 * after all the work was done and before any of it was written down. Nothing
 * caught it earlier because nothing had ever executed that path outside
 * production: the file parses perfectly, a linter that does not follow control
 * flow is happy, and the failure is a runtime one in the last five per cent of
 * a five minute job.
 *
 * So the test is not "does it compute the right total". It is "does every line
 * of this run actually execute". A TDZ, a typo in a rarely-taken branch, an
 * await on something undefined ... all of them are invisible to everything
 * except running the thing.
 *
 * Everything outside the process is faked: the site's own JSON, Etherscan, the
 * RPC head, and the GitHub API the repo writes through. It runs with dry=1, so
 * it computes everything and writes nothing.
 */
process.env.CRON_SECRET = '';
process.env.ETHERSCAN_API_KEY = 'test-key';
process.env.SITE_ORIGIN = 'https://test.invalid';
process.env.VERCEL_ENV = 'test';
delete process.env.EMAIL_TO_ARTIST;

import { readFile } from 'node:fs/promises';

let pass = 0; let fail = 0;
const is = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ok  ' : '  FAIL'}  ${name}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
};

/* ---- the world outside the process ---- */

const HEAD_BLOCK = 25_900_000;
const CONTRACT = `0x${'a'.repeat(40)}`;
const HOLDER = `0x${'b'.repeat(40)}`;

/* A catalogue small enough to read and big enough to exercise the arithmetic:
   one collection, one work, one holder who was minted it and still has it. */
/* The real configuration, read off disk rather than invented here. It is a
   config rather than data ... rates, scope, exclusions ... so it is stable, and
   using it means this test notices if its shape ever changes under the cron. */
const CFG = JSON.parse(await readFile(new URL('../data/source/tao.json', import.meta.url), 'utf8'));

const FIXTURES = {
  'data/source/tao.json': CFG,
  'data/index.json': { collections: [{ slug: 'canon' }] },
  'data/c/canon.json': {
    slug: 'canon',
    title: 'Canon',
    works: [{
      id: 'w1', title: 'A work',
      digital: { chain: 'ethereum', contract: CONTRACT, token_id: '1', standard: 'erc721' },
    }],
  },
  /* Fresh, so the stall alarm stays quiet and ownersAge takes its non-null
     branch ... which is the line that used to throw. */
  'data/owners-cursor.json': { updated: new Date().toISOString(), last_block: HEAD_BLOCK - 10 },
};

const asked = [];
const missing = [];

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  asked.push(u);
  const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  });

  /* The chain: no transfers anywhere, and a plausible head. */
  if (u.includes('etherscan')) return json({ status: '0', message: 'No records found', result: [] });
  if (init.method === 'POST' && u.includes('rpc')) return json({ jsonrpc: '2.0', id: 1, result: `0x${HEAD_BLOCK.toString(16)}` });

  /* The repo. Reads miss, which every caller treats as "first run"; nothing
     writes, because this runs dry. */
  if (u.includes('api.github.com')) return json({ message: 'Not Found' }, 404);

  /* The site's own JSON. Anything not in the fixtures 404s, which is what a
     first run sees and what every optional read is written to survive. */
  const path = u.startsWith(process.env.SITE_ORIGIN) ? u.slice(process.env.SITE_ORIGIN.length + 1) : u;
  if (path in FIXTURES) return json(FIXTURES[path]);
  missing.push(path);
  return json({ message: 'not found' }, 404);
};

/* ---- the run ---- */

const { GET } = await import('../api/cron/tao.js');

const res = await GET(new Request('https://test.invalid/api/cron/tao?dry=1'));
const body = await res.json();

/* The whole point. A TDZ does not throw out of GET ... GET catches everything
   and answers 500 with the reason ... so a test that only checked "it did not
   throw" would have passed every night this was broken. */
is('the cron completes', res.status, 200);
if (res.status !== 200) console.log('        error:', body.error);
is('and does not report a failure', body.ok, undefined === body.ok ? undefined : true);
is('it ran dry, so nothing was written', body.dry, true);

/* The line that used to throw, reached and evaluated. */
is('the run record exists', typeof body.run, 'object');
is('and carries the owners cursor age it could not read before',
  typeof body.run.owners_cursor_age_hours, 'number');
is('a fresh cursor raises no stall alarm',
  body.alarms.some((a) => String(a).includes('ownership sweep has not finished')), false);

/* Proof it really went all the way through rather than short-circuiting. */
is('it asked the chain for a head block', asked.some((u) => u.includes('rpc')), true);
is('it read the catalogue', asked.some((u) => u.includes('data/index.json')), true);
is('it read the owners cursor', asked.some((u) => u.includes('owners-cursor.json')), true);
is('it produced a summary', typeof body.summary, 'string');

/* And the stale branch, which is the other half of the same statement. */
{
  FIXTURES['data/owners-cursor.json'] = {
    updated: new Date(Date.now() - 1000 * 3600 * 72).toISOString(), last_block: 1,
  };
  const r2 = await GET(new Request('https://test.invalid/api/cron/tao?dry=1'));
  const b2 = await r2.json();
  is('a stale cursor still completes', r2.status, 200);
  is('and raises the alarm', b2.alarms.some((a) => String(a).includes('ownership sweep has not finished')), true);
  is('and still records the age', typeof b2.run.owners_cursor_age_hours, 'number');
}

if (missing.length) {
  console.log(`\n  (${new Set(missing).size} optional files 404'd, which is what a first run sees)`);
}
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
