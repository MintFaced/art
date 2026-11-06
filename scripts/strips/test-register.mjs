#!/usr/bin/env node
/* //STRIPS in the nightly TAO run, cold and for real: nothing dry, the chain,
 * the repo and the store faked, two nights in a row.
 *
 * The run keeps a per-contract event file and a cursor, and it moves that
 * cursor past whatever it didn't keep. Two things follow, and neither shows up
 * in a test of the arithmetic:
 *
 *   a contract with no file is skipped, so a new core earns nobody anything;
 *   a token missing from tonight's list loses its mint for good, because the
 *   list comes from the store and the chain doesn't wait for it.
 */
import { readFile } from 'node:fs/promises';

process.env.CRON_SECRET = '';
process.env.ETHERSCAN_API_KEY = 'test-key';
process.env.SITE_ORIGIN = 'https://test.invalid';
process.env.VERCEL_ENV = 'test';
process.env.GITHUB_TOKEN = 'test-token';
process.env.KV_REST_API_URL = 'https://kv.invalid';
process.env.KV_REST_API_TOKEN = 'test-token';
delete process.env.EMAIL_TO_ARTIST;

const CORE = `0x${'c'.repeat(40)}`;
const FIRST_BLOCK = 25_000_000;
process.env.STRIPS_DEPLOYMENT = JSON.stringify({ chain_id: 1, core: CORE, extension: `0x${'e'.repeat(40)}`, first_block: FIRST_BLOCK });

let passes = 0; let fails = 0;
const is = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? passes += 1 : fails += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`}`);
};

const DAY = 86400;
const NOW = Math.floor(Date.now() / 1000);
const FIRST = `0x${'a'.repeat(40)}`;
const SECOND = `0x${'b'.repeat(40)}`;
const ZERO = `0x${'0'.repeat(40)}`;
const word = (a) => `0x${a.slice(2).padStart(64, '0')}`;
const T721 = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const log = (id, to, block, ts) => ({
  topics: [T721, word(ZERO), word(to), `0x${id.toString(16).padStart(64, '0')}`],
  blockNumber: `0x${block.toString(16)}`, timeStamp: `0x${ts.toString(16)}`, transactionHash: `0x${String(id).padStart(64, '0')}`,
});

/* Two mints. The second landed after the store's list was last rebuilt. */
const CHAIN = [log(1, FIRST, FIRST_BLOCK + 10, NOW - 10 * DAY), log(2, SECOND, FIRST_BLOCK + 20, NOW - 5 * DAY)];
const listed = (id) => ({ id, held_since: 0, redeemed_at: 0 });

const CFG = JSON.parse(await readFile(new URL('../../data/source/tao.json', import.meta.url), 'utf8'));
const world = {
  head: FIRST_BLOCK + 100,
  gallery: [listed(1)],
  siteDown: new Set(),
  repo: new Map(),
  site: new Map(Object.entries({
    'data/source/tao.json': CFG,
    'data/index.json': { collections: [] },
    'data/owners-cursor.json': { updated: new Date().toISOString(), last_block: FIRST_BLOCK },
  })),
  swept: [],
};
world.repo.set('data/owners-cursor.json', JSON.stringify({ updated: new Date().toISOString(), last_block: FIRST_BLOCK }));

const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith(process.env.KV_REST_API_URL)) {
    const cmds = JSON.parse(init.body);
    return reply(cmds.map(([op, key]) => ({ result: op === 'GET' && key === 'strips:gallery' ? JSON.stringify(world.gallery) : null })));
  }
  if (u.includes('etherscan')) {
    const q = new URL(u).searchParams;
    if (q.get('action') !== 'getLogs' || q.get('address') !== CORE) return reply({ status: '0', message: 'No records found', result: [] });
    world.swept.push(Number(q.get('fromBlock')));
    const from = Number(q.get('fromBlock')); const to = Number(q.get('toBlock'));
    const hit = CHAIN.filter((l) => parseInt(l.blockNumber, 16) >= from && parseInt(l.blockNumber, 16) <= to);
    return hit.length ? reply({ status: '1', result: hit }) : reply({ status: '0', message: 'No records found', result: [] });
  }
  if (init.method === 'POST') return reply({ jsonrpc: '2.0', id: 1, result: `0x${world.head.toString(16)}` });
  if (u.includes('api.github.com')) {
    const m = /\/contents\/([^?]+)/.exec(u);
    const path = m ? decodeURIComponent(m[1]) : '';
    if (init.method === 'PUT') {
      world.repo.set(path, Buffer.from(JSON.parse(init.body).content, 'base64').toString('utf8'));
      return reply({ content: { sha: 'written' } });
    }
    if (world.repo.has(path)) return reply({ sha: 'stored', content: Buffer.from(world.repo.get(path), 'utf8').toString('base64') });
    return reply({ message: 'Not Found' }, 404);
  }
  const path = u.slice(process.env.SITE_ORIGIN.length + 1).split('?')[0];
  if (world.siteDown.has(path)) return reply({ message: 'bad gateway' }, 502);
  if (world.site.has(path)) return reply(world.site.get(path));
  return reply({ message: 'not found' }, 404);
};

const { GET } = await import('../../api/cron/tao.js');
const night = async () => {
  world.swept = [];
  const res = await GET(new Request('https://test.invalid/api/cron/tao'));
  const body = await res.json();
  if (res.status !== 200) console.log('     error:', body.error);
  return { status: res.status, body };
};
const FILE = `data/tao/e/${CORE}.json`;
const file = () => (world.repo.has(FILE) ? JSON.parse(world.repo.get(FILE)) : null);
const taoOf = (who) => (JSON.parse(world.repo.get('data/tao.json') || '{"wallets":{}}').wallets[who] || {}).tao ?? null;
const noHistory = (b) => (b.alarms || []).some((a) => /no event history/.test(a));

console.log('\n— a blip is not a missing file —');
{
  world.siteDown.add(FILE);
  const { status, body } = await night();
  is('the run still finishes', status, 200);
  is('the core is not swept from its first block', world.swept, []);
  is('nothing is written for it', file(), null);
  is('and the run says so', noHistory(body), true);
  world.siteDown.clear();
}

console.log('\n— the first night, with no event file —');
{
  const { status, body } = await night();
  is('the run finishes', status, 200);
  is('the core needs no backfill', noHistory(body), false);
  is('it starts at the first block', world.swept[0], FIRST_BLOCK);
  is('the cursor reaches the head', file() && file().cursor, world.head);
  is('the listed mint is kept', Boolean(file() && file().events.some((e) => e[0] === '1')), true);
  is('so is the one the list has not caught up with', Boolean(file() && file().events.some((e) => e[0] === '2')), true);
  is('its holder earns 4.2 a day', taoOf(FIRST), 42);
  is('the unlisted one earns nothing tonight', taoOf(SECOND), null);
}

console.log('\n— the second night, once the list has caught up —');
{
  /* what was written has deployed, and the chain has moved on */
  world.site.set(FILE, file());
  world.head += 50;
  world.gallery = [listed(1), listed(2)];
  const { status } = await night();
  is('the run finishes', status, 200);
  is('it carries on from the cursor', world.swept[0], FIRST_BLOCK + 101);
  is('the late mint earns from the day it happened', taoOf(SECOND), 21);
  is('the first holder is unchanged', taoOf(FIRST), 42);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
