#!/usr/bin/env node
/* The snapshot, on the rule Ryan set on 6 Nov 2026, and the tool that builds it.
 *
 * The first half is the arithmetic. The second runs the real command against
 * stub RPC servers and a real git remote, because what matters most here is what
 * it does when something is wrong: a table that's quietly different is worse
 * than no table at all, and after the first claim it can't be taken back.
 */
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeFunctionData, encodeFunctionResult, getAddress, parseAbi } from 'viem';
import { computeTao } from '../../api/_lib/tao.js';
import { allowances, proofOf, rootOf, struckOut } from '../../api/_lib/strips-snapshot.js';
import { buildTable, combosOf, delegatesOf, excludedKeys, holdings, oneCombo } from './snapshot-build.mjs';

let passes = 0; let fails = 0;
const is = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? passes += 1 : fails += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`}`);
};

const DAY = 86400;
const NOW = Math.floor(Date.now() / 1000);
const ago = (days) => NOW - days * DAY;
const wallet = (c) => `0x${c.repeat(40)}`;
const ZERO = wallet('0');
const NFT = wallet('a');
const EDITION = wallet('e');

const SOLD_ONE = wallet('1');
const EDITIONS = wallet('2');
const GIFTER = wallet('3');
const SOLD_ALL = wallet('4');
const GAVE_ALL = wallet('5');
const REBOUGHT = wallet('6');
const BUYER = wallet('7');
const FRIEND = wallet('8');
const WHALE = wallet('9');
const MINTFACE = wallet('d');
const RYAN = wallet('c');
const VAULT = wallet('b');
const SAFE = wallet('f');
const OWN = '0x40d2f4399d23f9afb82d0a6b73055f13208614f9';
/* one collector across a COMBO, and the same move with no COMBO behind it */
const OLD_HOME = `0x${'21'.repeat(20)}`;
const NEW_HOME = `0x${'31'.repeat(20)}`;
const LOOSE = `0x${'23'.repeat(20)}`;
const LOOSE_NEW = `0x${'24'.repeat(20)}`;
const SHARED_A = `0x${'25'.repeat(20)}`;
const SHARED_B = `0x${'26'.repeat(20)}`;
const SHARED_HOT = `0x${'27'.repeat(20)}`;
const SELLER = `0x${'28'.repeat(20)}`;
const SELLER_HOT = `0x${'29'.repeat(20)}`;
const SPLIT = `0x${'2a'.repeat(20)}`;
const SPLIT_HOT = `0x${'2b'.repeat(20)}`;
const CHAIN = `0x${'2c'.repeat(20)}`;
const CHAIN_HOT = `0x${'2d'.repeat(20)}`;
const DOOR = `0x${'2e'.repeat(20)}`;
const DOOR_FRIEND = `0x${'2f'.repeat(20)}`;

const CFG = {
  rates: { unique_per_day: 69, edition_copy_per_day: 4.2 },
  scope: { exclude_collections: [], chains: ['ethereum'] },
  exclusions: { _note: 'x', [MINTFACE]: 'mintface.eth', [RYAN]: 'ryanj.eth', [ZERO]: 'mint and burn' },
  weth: wallet('0'), marketplaces: {},
};

let n = 0;
const ev = (contract, token, from, to, qty, ts, sale = false) => ({ contract, token: String(token), from, to, qty, ts, block: ts, tx: `0x${(n += 1).toString(16).padStart(64, '0')}`, sale });
const mint = (contract, token, to, days, qty = 1) => ev(contract, token, ZERO, to, qty, ago(days));

/* Eleven 1/1s and an edition */
const EVENTS = [
  /* sold 1 of 5, held 400 days, the sale at day 300 */
  ...[1, 2, 3, 4, 5].map((id) => mint(NFT, id, SOLD_ONE, 400)),
  ev(NFT, 5, SOLD_ONE, BUYER, 1, ago(100), true),
  /* five copies of an edition, two sold */
  mint(EDITION, 9, EDITIONS, 1000, 5),
  ev(EDITION, 9, EDITIONS, BUYER, 2, ago(100), true),
  /* two 1/1s, one given away halfway */
  mint(NFT, 6, GIFTER, 1000), mint(NFT, 7, GIFTER, 1000),
  ev(NFT, 7, GIFTER, FRIEND, 1, ago(500)),
  /* everything sold */
  mint(NFT, 8, SOLD_ALL, 2000),
  ev(NFT, 8, SOLD_ALL, BUYER, 1, ago(10), true),
  /* everything given away: banked TAO, and nothing held */
  mint(NFT, 10, GAVE_ALL, 2000),
  ev(NFT, 10, GAVE_ALL, FRIEND, 1, ago(10)),
  /* sold, then bought back yesterday */
  mint(NFT, 11, REBOUGHT, 2000),
  ev(NFT, 11, REBOUGHT, BUYER, 1, ago(10), true),
  ev(NFT, 11, BUYER, REBOUGHT, 1, ago(1), true),
  /* a clear two, for the delegation cases below */
  mint(NFT, 12, WHALE, 7000),
  /* a wallet that speaks through an excluded key, and a Safe with one on it */
  mint(NFT, 13, VAULT, 8000), mint(NFT, 14, SAFE, 8000),
  /* a wallet excluded by address, delegating to nobody */
  mint(NFT, 15, OWN, 8000),
  /* moved everything to a wallet it's a COMBO with, and holds nothing itself */
  mint(NFT, 16, OLD_HOME, 2000), ev(NFT, 16, OLD_HOME, NEW_HOME, 1, ago(100)),
  /* the same move to a wallet it has no link to */
  mint(NFT, 17, LOOSE, 2000), ev(NFT, 17, LOOSE, LOOSE_NEW, 1, ago(100)),
  /* two vaults of one hot wallet, moving between themselves */
  mint(NFT, 18, SHARED_A, 2000), ev(NFT, 18, SHARED_A, SHARED_B, 1, ago(100)),
  /* a sale inside a COMBO is still a sale */
  mint(NFT, 19, SELLER, 2000), ev(NFT, 19, SELLER, SELLER_HOT, 1, ago(100), true),
  /* 2 of 5 edition copies moved inside a COMBO */
  mint(EDITION, 20, SPLIT, 1000, 5), ev(EDITION, 20, SPLIT, SPLIT_HOT, 2, ago(100)),
  /* moved inside a COMBO, then sold from there */
  mint(NFT, 21, CHAIN, 2000), ev(NFT, 21, CHAIN, CHAIN_HOT, 1, ago(100)), ev(NFT, 21, CHAIN_HOT, BUYER, 1, ago(50), true),
  mint(NFT, 22, CHAIN_HOT, 3000),
  /* a wallet with an excluded signer, linked to a friend, handing its work over */
  mint(NFT, 23, DOOR, 3000), ev(NFT, 23, DOOR, DOOR_FRIEND, 1, ago(10)),
].sort((a, b) => a.ts - b.ts);

const META = new Map([...Array.from({ length: 23 }, (_, i) => [`${NFT}|${i + 1}`, { unique: true, work: `w${i + 1}`, collection: 'x' }]), [`${EDITION}|9`, { unique: false, work: 'ed', collection: 'x' }], [`${EDITION}|20`, { unique: false, work: 'ed2', collection: 'x' }]]);
const engine = () => computeTao(EVENTS, META, CFG, NOW).wallets;
const of = (w) => engine().find((x) => x.address === w);
const taoJson = (at = NOW) => {
  const earning = computeTao(EVENTS, META, CFG, at).wallets.filter((w) => w.tao_total > 0);
  return { generated: new Date(at * 1000).toISOString(), counts: { wallets: earning.length }, wallets: Object.fromEntries(earning.map((w) => [w.address, { tao: w.tao_total }])) };
};

console.log('\n— TAO, NFT by NFT —');
is('a wallet that sold 1 of 5 keeps the TAO on the 4', of(SOLD_ONE).tao_held, 4 * 400 * 69);
is('and only the sold one is taken back', of(SOLD_ONE).tao_lost, 300 * 69);
is('it still holds 4', of(SOLD_ONE).copies_held, 4);
is('so it clears the tier its 4 earn', allowances([{ wallet: SOLD_ONE, tao_total: of(SOLD_ONE).tao_held }])[0].free_mints, 1);
is('2 of 5 edition copies sold leaves 3 copies\' worth, to the unit', [of(EDITIONS).tao_held, of(EDITIONS).copies_held], [12600, 3]);
is('a gift stays banked in the wallet total', of(GIFTER).tao_total, 69000 + 34500);
is('but the snapshot counts what\'s held', of(GIFTER).tao_held, 69000);
is('nothing held, nothing counted, after a sale', [of(SOLD_ALL).tao_held, of(SOLD_ALL).copies_held], [0, 0]);
is('or after giving it all away, banked or not', [of(GAVE_ALL).tao_held, of(GAVE_ALL).copies_held, of(GAVE_ALL).tao_total > 130000], [0, 0, true]);
is('a sale and a buy back starts again from the day it came back', of(REBOUGHT).tao_held, 69);
is('a buyer starts from the day each one landed', of(BUYER).tao_held, 100 * 69 + 100 * 4.2 * 2 + 10 * 69 + 50 * 69);

const { rows, at } = holdings({ cfg: CFG, tokens: META, events: EVENTS, tao: taoJson() });
const row = (w) => rows.find((r) => r.wallet === w);
is('the table is current holders only', [row(SOLD_ALL), row(GAVE_ALL)], [undefined, undefined]);
is('holders are in it, at what they hold', row(SOLD_ONE).tao_total, 4 * 400 * 69);
is('it\'s taken at the moment of the TAO run', at, NOW);

{
  const tampered = taoJson();
  tampered.wallets[SOLD_ONE].tao += 50;
  let said = null;
  try { holdings({ cfg: CFG, tokens: META, events: EVENTS, tao: tampered }); } catch (e) { said = e.message; }
  is('a history that doesn\'t reproduce data/tao.json stops the build', /doesn't reproduce/.test(said), true);
}

console.log('\n— where the site looks for a table —');
{
  const { forgetSnapshot, tableFor } = await import('../../api/_lib/strips-snapshot.js');
  const real = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url) => { asked.push(String(url)); return new Response('{"rows":[]}'); };
  const was = { ...process.env };
  delete process.env.STRIPS_SNAPSHOT_URL; delete process.env.SITE_ORIGIN;
  process.env.VERCEL_ENV = 'production'; process.env.VERCEL_URL = 'art-abc.vercel.app';
  forgetSnapshot();
  await tableFor(7);
  is('in production, the public address, not the deployment\'s own', asked, ['https://mintface.art/data/strips-snapshot-7.json']);
  process.env.SITE_ORIGIN = 'https://elsewhere.test';
  forgetSnapshot();
  await tableFor(7);
  is('unless SITE_ORIGIN says otherwise', asked.at(-1), 'https://elsewhere.test/data/strips-snapshot-7.json');
  globalThis.fetch = real;
  process.env = was;
  forgetSnapshot();
}

console.log('\n— a move to another wallet —');
{
  const hots = new Map([[OLD_HOME, [NEW_HOME]], [SHARED_A, [SHARED_HOT]], [SHARED_B, [SHARED_HOT]], [SELLER, [SELLER_HOT]], [SPLIT, [SPLIT_HOT]], [CHAIN, [CHAIN_HOT]]]);
  const d = { cfg: CFG, tokens: META, events: EVENTS, tao: taoJson() };
  const linked = holdings(d, oneCombo(hots)).rows;
  const tao = (list, w) => (list.find((r) => r.wallet === w) || {}).tao_total;
  is('with no COMBO, a new wallet starts from the day of the move', tao(linked, LOOSE_NEW), 100 * 69);
  is('and the old wallet is out, holding nothing', tao(linked, LOOSE), undefined);
  is('inside a COMBO the days move with the NFT', tao(linked, NEW_HOME), 2000 * 69);
  is('though the wallet it left holds nothing', tao(linked, OLD_HOME), undefined);
  is('with no link read, the same wallet starts over', tao(holdings(d).rows, NEW_HOME), 100 * 69);
  is('two vaults of one hot wallet are one COMBO', tao(linked, SHARED_B), 2000 * 69);
  is('a sale inside a COMBO costs the TAO like any sale', tao(linked, SELLER_HOT), 100 * 69);
  is('part of an edition moves its share, to the unit', [tao(linked, SPLIT), tao(linked, SPLIT_HOT)], [12600, 8400]);
  is('and the two add up to all five copies', tao(linked, SPLIT) + tao(linked, SPLIT_HOT), 5 * 1000 * 4.2);
  is('sold after a move inside a COMBO, it\'s gone like any sale, and nothing else goes with it', [tao(linked, CHAIN), tao(linked, CHAIN_HOT)], [undefined, 3000 * 69]);
  /* a carried sale takes back more than the wallet earned, so if the carry ever
     reached the run that's checked, this would stop with "doesn't reproduce" */
  is('the board\'s figures don\'t carry: tao.json still reproduces with a link read', holdings(d, oneCombo(hots)).rows.length > 0, true);
  is('a wallet can\'t be a COMBO with a stranger', oneCombo(hots)(OLD_HOME, LOOSE_NEW), false);
  is('whichever way round the link runs', [oneCombo(hots)(OLD_HOME, NEW_HOME), oneCombo(hots)(NEW_HOME, OLD_HOME)], [true, true]);

  const wide = await delegatesOf([OLD_HOME, WHALE, SPLIT], { delegations: async () => ({ v2: [[{ type_: 1, to: NEW_HOME, rights: `0x${'0'.repeat(64)}` }, { type_: 2, to: LOOSE, rights: `0x${'0'.repeat(64)}` }], [], [{ type_: 1, to: LOOSE, rights: `0x${'ab'.repeat(32)}` }]], v1: [[], [], [SPLIT]] }) });
  is('only a wallet-wide delegation is a COMBO, in the rights the site reads', [...wide], [[OLD_HOME, [NEW_HOME]]]);
  is('a vault counts on the hot wallet with the most TAO', [...combosOf([{ wallet: VAULT, tao_total: 5 }, { wallet: GIFTER, tao_total: 9 }, { wallet: FRIEND, tao_total: 1 }], new Map([[VAULT, [FRIEND, GIFTER]]]))], [[VAULT, GIFTER]]);
}

console.log('\n— exclusions, after delegation —');
const ROWS = [{ wallet: VAULT, tao_total: 500_000 }, { wallet: SOLD_ONE, tao_total: 200_000 }, { wallet: SAFE, tao_total: 600_000 }, { wallet: GIFTER, tao_total: 90_000 }, { wallet: EDITIONS, tao_total: 20_000 }];
{
  const combo = new Map([[VAULT, RYAN], [SAFE, SOLD_ONE], [EDITIONS, GIFTER]]);
  const keys = new Map([[RYAN, 'ryanj.eth'], [SAFE, 'mintface.eth signs for it']]);
  const table = allowances(ROWS, combo, keys);
  const find = (w) => table.find((r) => r.wallet === getAddress(w));
  is('a vault speaking through an excluded key goes with it', find(VAULT), undefined);
  is('the excluded key gets no row of its own', find(RYAN), undefined);
  is('nor does a wallet with an excluded signer', find(SAFE), undefined);
  is('whose TAO doesn\'t reach the wallet it speaks through', find(SOLD_ONE).free_mints, 1);
  is('everyone else\'s COMBO still adds up', find(GIFTER).free_mints, 1);
  is('and the reasons are kept', [...struckOut(ROWS, combo, keys)], [[VAULT, 'speaks through ryanj.eth'], [SAFE, 'mintface.eth signs for it']]);
  is('a table with exclusions still proves', proofOf(table, find(GIFTER)).length > 0, true);
  is('a wallet is out by address, on top of the TAO list', [excludedKeys(CFG)[OWN], excludedKeys(CFG)[RYAN]], ['excluded by the artist', 'ryanj.eth']);
}

/* ---------- the command ---------- */

const AGGREGATE = parseAbi(['struct Call { address target; bool allowFailure; bytes callData; }', 'struct Result { bool success; bytes returnData; }', 'function aggregate3(Call[] calls) payable returns (Result[])']);
const CALLS = parseAbi(['function totalSupply(uint256) view returns (uint256)', 'struct Delegation { uint8 type_; address to; address from; bytes32 rights; address contract_; uint256 tokenId; uint256 amount; }', 'function getOutgoingDelegations(address from) view returns (Delegation[])', 'function getDelegatesForAll(address vault) view returns (address[])', 'function getOwners() view returns (address[])', 'function owner() view returns (address)', 'function ownerOf(uint256) view returns (address)', 'function balanceOf(address, uint256) view returns (uint256)']);
const HEAD = 26_000_000;

/* a provider, as far as the tool can tell */
function stub({ delegates = { [VAULT]: [RYAN], [OLD_HOME]: [NEW_HOME], [DOOR]: [DOOR_FRIEND] }, owners = { [SAFE]: [MINTFACE], [DOOR]: [MINTFACE] }, blockHash = `0x${'ab'.repeat(32)}`, dieAfterCalls = Infinity, lostMint = {}, silentSupply = false, moved = {} } = {}) {
  let calls = 0;
  /* what the chain holds: the events, unless a test says one got away */
  const holder = (token) => moved[token] || EVENTS.filter((e) => e.contract === NFT && e.token === String(token)).at(-1)?.to;
  const copies = (who, token) => EVENTS.filter((e) => e.contract === EDITION && e.token === String(token)).reduce((n, e) => n + (e.to === who ? e.qty : 0) - (e.from === who ? e.qty : 0), 0);
  const answer = (target, data) => {
    const { functionName, args } = decodeFunctionData({ abi: CALLS, data });
    const from = String(args && args[0]).toLowerCase();
    const reply = (result) => ({ success: true, returnData: encodeFunctionResult({ abi: CALLS, functionName, result }) });
    if (functionName === 'getDelegatesForAll') return reply(delegates[from] || []);
    if (functionName === 'ownerOf') return holder(args[0]) ? reply(getAddress(holder(args[0]))) : { success: false, returnData: '0x' };
    if (functionName === 'balanceOf') return reply(BigInt(copies(from, args[1])));
    if (functionName === 'totalSupply') return silentSupply ? { success: false, returnData: '0x' } : reply(BigInt(EVENTS.filter((e) => e.contract === EDITION && e.token === String(args[0])).reduce((n, e) => n + (/^0x0{40}$/.test(e.from) ? e.qty : 0) - (/^0x0{40}$/.test(e.to) ? e.qty : 0), 0) + (lostMint[args[0]] || 0)));
    if (functionName === 'getOutgoingDelegations') return reply([]);
    if (functionName === 'getOwners' && owners[target.toLowerCase()]) return reply(owners[target.toLowerCase()]);
    return { success: false, returnData: '0x' };
  };
  const one = ({ id, method, params }) => {
    const ok = (result) => ({ jsonrpc: '2.0', id, result });
    if (method === 'eth_chainId') return ok('0x1');
    if (method === 'eth_blockNumber') return ok(`0x${HEAD.toString(16)}`);
    if (method === 'eth_getBlockByNumber') return ok({ number: params[0], hash: blockHash, parentHash: blockHash, timestamp: `0x${NOW.toString(16)}`, transactions: [], logsBloom: null, nonce: null });
    if (method === 'eth_call') {
      const { args: [list] } = decodeFunctionData({ abi: AGGREGATE, data: params[0].data || params[0].input });
      return ok(encodeFunctionResult({ abi: AGGREGATE, functionName: 'aggregate3', result: list.map((c) => answer(c.target, c.callData)) }));
    }
    return { jsonrpc: '2.0', id, error: { code: -32601, message: method } };
  };
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const asked = JSON.parse(body);
      if ([asked].flat().some((r) => r.method === 'eth_call')) calls += 1;
      if (calls > dieAfterCalls) { res.statusCode = 503; res.end('gone'); return; }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(Array.isArray(asked) ? asked.map(one) : one(asked)));
    });
  });
  return new Promise((ok) => { server.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${server.address().port}`, stop: () => server.close() })); });
}

const SCRIPT = fileURLToPath(new URL('./snapshot.mjs', import.meta.url));
const AUDIT = fileURLToPath(new URL('./audit-snapshot.mjs', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'strips-snapshot-'));
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'pipe', encoding: 'utf8' });

let seq = 0;
function world({ tao = taoJson(), runs = { runs: [{ ok: true, at: new Date().toISOString() }] }, works = [SOLD_ONE, EDITIONS, GIFTER, BUYER, FRIEND, REBOUGHT, WHALE, VAULT, SAFE, OWN, NEW_HOME, LOOSE_NEW, SHARED_B, SELLER_HOT, SPLIT, SPLIT_HOT, CHAIN_HOT, DOOR_FRIEND] } = {}) {
  const dir = join(scratch, `w${seq += 1}`);
  const repo = join(dir, 'repo');
  mkdirSync(join(repo, 'data/tao/e'), { recursive: true });
  mkdirSync(join(repo, 'data/c'), { recursive: true });
  mkdirSync(join(repo, 'data/source'), { recursive: true });
  const put = (path, v) => writeFileSync(join(repo, 'data', path), JSON.stringify(v));
  put('source/tao.json', CFG);
  put('tao.json', tao);
  put('tao/runs.json', runs);
  put('tao/sales.json', { tx: Object.fromEntries(EVENTS.filter((e) => e.sale).map((e) => [e.tx, { sale: true }])) });
  for (const c of [NFT, EDITION]) put(`tao/e/${c}.json`, { contract: c, standard: c === EDITION ? 'ERC-1155' : 'ERC-721', events: EVENTS.filter((e) => e.contract === c).map((e) => [e.token, e.from, e.to, e.qty, e.ts, e.block, e.tx]) });
  put('c/x.json', { slug: 'x', works: [
    ...Array.from({ length: 23 }, (_, i) => ({ id: `w${i + 1}`, digital: { chain: 'ethereum', contract: NFT, token_id: i + 1 }, edition: { type: '1/1' } })),
    { id: 'ed', digital: { chain: 'ethereum', contract: EDITION, token_id: 9 }, edition: { type: 'open' } },
    { id: 'ed2', digital: { chain: 'ethereum', contract: EDITION, token_id: 20 }, edition: { type: 'open' } },
  ] });
  put('collectors-register.json', { generated: new Date().toISOString(), fields: ['address', 'works', 'tao'], rows: works.map((w) => [w, 1, 0]) });
  git(dir, 'init', '--quiet', '--bare', '--initial-branch=main', 'origin.git');
  git(repo, 'init', '--quiet', '--initial-branch=main');
  git(repo, 'remote', 'add', 'origin', join(dir, 'origin.git'));
  git(repo, 'add', '.');
  git(repo, 'commit', '--quiet', '-m', 'data');
  git(repo, 'push', '--quiet', 'origin', 'main');
  return { dir, repo, out: join(dir, 'out') };
}

const run = (w, a, b, extra = []) => new Promise((ok) => {
  const child = spawn(process.execPath, [SCRIPT, '--id', '1', '--repo', w.repo, '--out', w.out, '--rpc-a', a, '--rpc-b', b, ...extra], { stdio: ['ignore', 'pipe', 'pipe'] });
  let said = '';
  child.stdout.on('data', (c) => { said += c; });
  child.stderr.on('data', (c) => { said += c; });
  child.on('close', (code) => ok({ code, said }));
});
const audit = (w, rpc, path = join(w.out, 'strips-snapshot-1.json'), extra = []) => new Promise((ok) => {
  const child = spawn(process.execPath, [AUDIT, path, '--repo', w.repo, '--rpc', rpc, ...extra], { stdio: ['ignore', 'pipe', 'pipe'] });
  let said = '';
  child.stdout.on('data', (c) => { said += c; });
  child.stderr.on('data', (c) => { said += c; });
  child.on('close', (code) => ok({ code, said }));
});
const wrote = (w) => existsSync(join(w.out, 'strips-snapshot-1.json'));
const table = (w) => JSON.parse(readFileSync(join(w.out, 'strips-snapshot-1.json'), 'utf8'));

try {
  const a = await stub();
  const b = await stub();

  console.log('\n— the command, when all is well —');
  const good = world();
  const clean = await run(good, a.url, b.url);
  is('two providers that agree: exit 0', clean.code, 0);
  is('the table is written', wrote(good), true);
  const t = table(good);
  is('its root rebuilds from its rows', rootOf(t.rows), t.root);
  const d = { cfg: CFG, tokens: META, events: EVENTS, tao: taoJson() };
  const fake = { delegations: async (w) => ({ v2: w.map(() => []), v1: w.map((x) => ({ [VAULT]: [RYAN], [OLD_HOME]: [NEW_HOME], [DOOR]: [DOOR_FRIEND] }[x] || [])) }), signers: async (w) => new Map(w.map((x) => [x, x === SAFE || x === DOOR ? [MINTFACE] : []])) };
  is('the same root a direct build gives', t.root, (await buildTable(d, holdings(d).ever, fake)).root);
  is('a delegation from a wallet holding nothing is still read', t.rows.find((r) => r.wallet === getAddress(NEW_HOME)).tao_total, 2000 * 69);
  is('it records the block it read', [t.block, t.block_hash], [HEAD - 16, `0x${'ab'.repeat(32)}`]);
  is('and the commit', t.main_commit, git(good.repo, 'rev-parse', 'origin/main').trim());
  is('taken_at is the TAO run\'s, not the clock\'s', t.taken_at, NOW);
  is('the free mints add up', t.free_mints, t.rows.reduce((s, r) => s + r.free_mints, 0));
  is('the exclusion list is published with it', t.exclusions.wallets.map((x) => [x.wallet, x.why]).sort(), [[OWN, 'excluded by the artist'], [SAFE, 'mintface.eth signs for it'], [VAULT, 'speaks through ryanj.eth']].sort());
  is('with the keys it applied', [t.exclusions.keys[RYAN], t.exclusions.keys[OWN]], ['ryanj.eth', 'excluded by the artist']);
  is('a wallet can be out with no delegation to catch it', t.rows.some((r) => r.wallet === getAddress(OWN)), false);
  is('an excluded wallet\'s days don\'t walk out through a COMBO', t.rows.find((r) => r.wallet === getAddress(DOOR_FRIEND)).tao_total, 10 * 69);
  is('though the wallet holds nothing, so its signers had to be read anyway', t.rows.some((r) => r.wallet === getAddress(DOOR)), false);
  is('and as a CSV beside it', readFileSync(join(good.out, 'strips-snapshot-1-exclusions.csv'), 'utf8').includes('speaks through ryanj.eth'), true);
  is('the wallet that sold 1 of 5 is in at what its 4 earned', t.rows.find((r) => r.wallet === getAddress(SOLD_ONE)).tao_total, 4 * 400 * 69);
  is('a run again from the same state gives the same root', table(good).root, (await run(good, a.url, b.url), table(good).root));

  console.log('\n— the command, when a provider fails —');
  const dead = world();
  let r = await run(dead, a.url, 'http://127.0.0.1:9');
  is('a dead provider: exit 1', r.code, 1);
  is('and nothing is written', wrote(dead), false);
  is('and it says no', /NO SNAPSHOT/.test(r.said), true);

  const dies = await stub({ dieAfterCalls: 1 });
  const midway = world();
  r = await run(midway, a.url, dies.url);
  is('a provider that dies partway: exit 1', r.code, 1);
  is('and nothing is written', wrote(midway), false);
  dies.stop();

  const dies2 = await stub({ dieAfterCalls: 0 });
  const silent = world();
  r = await run(silent, dies2.url, b.url);
  is('dying on the delegation reads doesn\'t mean nobody delegated: exit 1', [r.code, wrote(silent)], [1, false]);
  dies2.stop();

  /* both agree the Safe has no signers, because neither could read it */
  const [late1, late2] = await Promise.all([stub({ dieAfterCalls: 2 }), stub({ dieAfterCalls: 2 })]);
  const unsigned = world();
  r = await run(unsigned, late1.url, late2.url);
  is('both dying on the signer reads doesn\'t mean nobody signs: exit 1', [r.code, wrote(unsigned)], [1, false]);
  late1.stop(); late2.stop();

  console.log('\n— the command, when the providers disagree —');
  const other = await stub({ delegates: {} });
  const split = world();
  r = await run(split, a.url, other.url);
  is('different delegations: exit 1', r.code, 1);
  is('no table', wrote(split), false);
  is('it names both roots', /different tables/.test(r.said), true);
  other.stop();

  const noSigner = await stub({ owners: {} });
  const split2 = world();
  r = await run(split2, a.url, noSigner.url);
  is('different signers: exit 1', [r.code, wrote(split2)], [1, false]);
  noSigner.stop();

  const fork = await stub({ blockHash: `0x${'cd'.repeat(32)}` });
  const forked = world();
  r = await run(forked, a.url, fork.url);
  is('a different block at the same height: exit 1', [r.code, wrote(forked), /disagree about block/.test(r.said)], [1, false, true]);
  fork.stop();

  const same = world();
  r = await run(same, a.url, `${a.url}/v2`);
  is('the same provider twice isn\'t two providers', [r.code, wrote(same)], [1, false]);

  console.log('\n— the command, when the data is behind —');
  const behind = world();
  const ahead = join(behind.dir, 'other');
  git(behind.dir, 'clone', '--quiet', join(behind.dir, 'origin.git'), 'other');
  writeFileSync(join(ahead, 'data/collectors-register.json'), '{"generated":"newer","fields":[],"rows":[]}');
  git(ahead, 'add', '.');
  git(ahead, 'commit', '--quiet', '-m', 'the nightly run');
  git(ahead, 'push', '--quiet', 'origin', 'main');
  r = await run(behind, a.url, b.url);
  is('a register behind origin/main: exit 1', [r.code, wrote(behind), /not current with origin\/main/.test(r.said)], [1, false, true]);

  const dirty = world();
  writeFileSync(join(dirty.repo, 'data/tao/sales.json'), '{"tx":{}}');
  r = await run(dirty, a.url, b.url);
  is('a local edit is the same as being behind: exit 1', [r.code, wrote(dirty)], [1, false]);

  console.log('\n— a quantity of nothing —');
  const plainRun = world();
  await run(plainRun, a.url, b.url);
  const nothing = world();
  const nftFile = join(nothing.repo, `data/tao/e/${NFT}.json`);
  const held = JSON.parse(readFileSync(nftFile, 'utf8'));
  const rows1 = table(plainRun).rows;
  const nobody = `0x${'ab'.repeat(20)}`;
  for (let i = 0; i < 40; i += 1) held.events.push(['1', `0x${'cd'.repeat(20)}`, nobody, 0, ago(200), 900 + i, `0x${String(i).padStart(64, '0')}`]);
  writeFileSync(nftFile, JSON.stringify(held));
  git(nothing.repo, 'add', '.');
  git(nothing.repo, 'commit', '--quiet', '-m', 'events');
  git(nothing.repo, 'push', '--quiet', 'origin', 'main');
  r = await run(nothing, a.url, b.url);
  is('it credits nobody and changes nothing', [r.code, table(nothing).root === table(plainRun).root, table(nothing).rows.some((x) => x.wallet.toLowerCase() === nobody), rows1.length > 0], [0, true, false, true]);
  r = await audit(nothing, a.url);
  is('and the audit has nothing to say about it', r.code, 0);

  const flagged = world();
  r = await run(flagged, a.url, b.url, ['--block', '5']);
  is('a flag it doesn\'t know is refused, not ignored', [r.code, wrote(flagged), /no such flag/.test(r.said)], [1, false, true]);

  const extra = world();
  writeFileSync(join(extra.repo, 'data/tao/e/0xnew.json'), '{"contract":"0xnew","events":[]}');
  r = await run(extra, a.url, b.url);
  is('so is a history file origin/main doesn\'t have', [r.code, wrote(extra)], [1, false]);

  const old = world({ tao: taoJson(NOW - 40 * 3600) });
  r = await run(old, a.url, b.url);
  is('last night\'s run missing: exit 1', [r.code, wrote(old), /hours old/.test(r.said)], [1, false, true]);

  const failed = world({ runs: { runs: [{ ok: false, at: 'x', error: 'etherscan' }] } });
  r = await run(failed, a.url, b.url);
  is('a failed TAO run: exit 1', [r.code, wrote(failed), /didn't finish/.test(r.said)], [1, false, true]);

  const stranger = world({ works: [EDITIONS] });
  r = await run(stranger, a.url, b.url);
  is('a claimant the register doesn\'t hold: exit 1', [r.code, wrote(stranger), /aren't holders/.test(r.said)], [1, false, true]);

  console.log('\n— the command, when there\'s already a table —');
  const twice = world();
  await run(twice, a.url, b.url);
  const first = table(twice).root;
  const changed = await stub({ delegates: {} });
  const changed2 = await stub({ delegates: {} });
  r = await run(twice, changed.url, changed2.url);
  is('a different root won\'t overwrite it: exit 1', [r.code, table(twice).root === first, /already holds/.test(r.said)], [1, true, true]);
  r = await run(twice, changed.url, changed2.url, ['--replace']);
  is('unless told to', [r.code, table(twice).root === first], [0, false]);
  changed.stop(); changed2.stop();

  console.log('\n— the audit —');
  const audited = world();
  await run(audited, a.url, b.url);
  const stamp = join(audited.out, 'strips-snapshot-1-audit.json');
  r = await audit(audited, a.url);
  is('a true table passes, and the pass is written down', [r.code, /Passed/.test(r.said), existsSync(stamp) && JSON.parse(readFileSync(stamp, 'utf8')).root === table(audited).root], [0, true, true]);

  /* NFT 16 sits with a wallet that has free mints only on this table's numbers */
  const clear = table(audited).rows.find((x) => x.free_mints > 0);
  const claimantToken = EVENTS.filter((e) => e.contract === NFT && e.to === clear.wallet.toLowerCase()).at(-1).token;
  const away = await stub({ moved: { [claimantToken]: BUYER } });
  r = await audit(audited, away.url);
  is('a claimant the chain says has sold: exit 1', [r.code, /doesn't match the chain/.test(r.said)], [1, true]);
  is('and an earlier pass goes', existsSync(stamp), false);
  away.stop();

  const lastHolder = new Map(EVENTS.filter((e) => e.contract === NFT).map((e) => [e.token, e.to]));
  const [smallToken, holder] = [...lastHolder].find(([, w]) => { const row = table(audited).rows.find((x) => x.wallet.toLowerCase() === w); return row && row.free_mints === 0 && w !== BUYER; });
  const small = await stub({ moved: { [smallToken]: BUYER } });
  r = await audit(audited, small.url);
  is('a holder with no free mints fails it too: exit 1', [r.code, /doesn't match the chain/.test(r.said), existsSync(stamp)], [1, true, false]);
  const acceptFile = join(audited.dir, 'accept.json');
  writeFileSync(acceptFile, JSON.stringify([{ wallet: holder, contract: NFT, token: smallToken }]));
  r = await audit(audited, small.url, undefined, ['--accept', acceptFile]);
  is('accepting one takes a reason', [r.code, /needs a wallet, a contract, a token and a reason/.test(r.said)], [1, true]);
  writeFileSync(acceptFile, JSON.stringify([{ wallet: holder, contract: NFT, token: smallToken, reason: 'sold after the TAO run' }]));
  r = await audit(audited, small.url, undefined, ['--accept', acceptFile]);
  is('with one it passes, and the reason goes on the record', [r.code, JSON.parse(readFileSync(stamp, 'utf8')).accepted.map((x) => x.reason)], [0, ['sold after the TAO run']]);
  small.stop();

  const unseen = Array.from({ length: 23 }, (_, i) => String(i + 1)).find((t) => !lastHolder.has(t));
  const stray = await stub({ moved: { [unseen]: BUYER } });
  r = await audit(audited, stray.url);
  is('a work the events never saw move, and the chain says someone holds: exit 1', [r.code, /doesn't match the chain/.test(r.said)], [1, true]);
  stray.stop();
  const lost = await stub({ lostMint: { 9: 1 } });
  r = await audit(audited, lost.url);
  is('a copy the chain has and the events don\'t: exit 1', [r.code, /supply/.test(r.said)], [1, true]);
  lost.stop();
  const quiet = await stub({ silentSupply: true });
  r = await audit(audited, quiet.url);
  is('an edition that won\'t state its supply is listed, not passed over', [r.code, JSON.parse(readFileSync(stamp, 'utf8')).supply_unchecked.length > 0], [0, true]);
  quiet.stop();

  mkdirSync(join(audited.dir, 'forged'), { recursive: true });
  const forged = join(audited.dir, 'forged', 'strips-snapshot-1.json');
  const edited = table(audited);
  edited.rows[0] = { ...edited.rows[0], tao_total: edited.rows[0].tao_total + 1 };
  writeFileSync(forged, JSON.stringify(edited));
  r = await audit(audited, a.url, forged);
  is('a row changed by a single TAO: exit 1', [r.code, /rebuild to the root/.test(r.said)], [1, true]);

  const greedy = table(audited);
  const up = greedy.rows.find((x) => x.free_mints === 0 && !x.hot);
  up.free_mints = 2;
  greedy.free_mints += 2;
  greedy.root = rootOf(greedy.rows);
  writeFileSync(forged, JSON.stringify(greedy));
  r = await audit(audited, a.url, forged);
  is('a wallet given more than its tier, root and all: exit 1', [r.code, /differ from a fresh build/.test(r.said)], [1, true]);

  const listed = table(audited);
  listed.exclusions.wallets.push({ wallet: listed.rows[0].wallet, why: 'x' });
  writeFileSync(forged, JSON.stringify(listed));
  r = await audit(audited, a.url, forged);
  is('a struck wallet with a row: exit 1', [r.code, /struck wallets aren't/.test(r.said)], [1, true]);

  /* each of these is an honest-looking file: the root and the total are rebuilt to fit */
  const tampered = async (name, change, re) => {
    const t = table(audited);
    change(t);
    t.free_mints = t.rows.reduce((n, x) => n + x.free_mints, 0);
    t.root = rootOf(t.rows);
    writeFileSync(forged, JSON.stringify(t));
    const out = await audit(audited, a.url, forged);
    is(name, [out.code, re.test(out.said)], [1, true]);
  };
  const claimantRow = (t) => t.rows.find((x) => x.free_mints > 0 && !x.hot);
  await tampered('an invented wallet', (t) => t.rows.push({ wallet: `0x${'be'.repeat(20)}`, tao_total: 420000, free_mints: 2 }), /differ from a fresh build/);
  await tampered('an invented row that only carries mints', (t) => t.rows.push({ wallet: `0x${'be'.repeat(20)}`, tao_total: 0, free_mints: 50, hot: t.rows[0].wallet }), /differ from a fresh build/);
  await tampered('a claimant deleted', (t) => t.rows.splice(t.rows.indexOf(claimantRow(t)), 1), /differ from a fresh build/);
  await tampered('a claimant zeroed', (t) => { const c = claimantRow(t); c.tao_total = 0; c.free_mints = 0; }, /differ from a fresh build/);
  await tampered('a stranger raised to the tier', (t) => { const c = t.rows.find((x) => x.free_mints === 0 && !x.hot && x.tao_total > 0); c.tao_total = 420000; c.free_mints = 2; }, /differ from a fresh build/);
  await tampered('a fake COMBO', (t) => { claimantRow(t).hot = t.rows.find((x) => x !== claimantRow(t)).wallet; }, /differ from a fresh build/);
  await tampered('the same wallet twice', (t) => t.rows.push({ ...t.rows[0] }), /two rows/);
  await tampered('an excluded key let back in', (t) => { delete t.exclusions.keys[Object.keys(t.exclusions.keys)[0]]; }, /excluded keys aren't/);
  await tampered('a strike removed', (t) => { t.exclusions.wallets = t.exclusions.wallets.slice(1); }, /struck wallets aren't/);
  await tampered('the rule rewritten', (t) => { t.rule = 'anything'; }, /rule isn't the rule/);
  await tampered('the id rewritten', (t) => { t.id = 9; }, /the table says snapshot 9/);
  await tampered('the commit rewritten', (t) => { t.main_commit = 'deadbeef'; }, /isn't on origin\/main/);
  await tampered('the block moved', (t) => { t.block_hash = `0x${'ee'.repeat(32)}`; }, /block \d+ is/);
  await tampered('the time moved', (t) => { t.taken_at -= 1; }, /taken_at is/);
  await tampered('the TAO run\'s date moved', (t) => { t.tao_generated = '2020-01-01'; }, /tao_generated/);

  r = await audit(audited, 'http://127.0.0.1:9');
  is('a dead provider isn\'t a clean audit: exit 1', r.code, 1);

  a.stop(); b.stop();
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
